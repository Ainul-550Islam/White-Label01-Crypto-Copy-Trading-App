import { Injectable, Logger, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OperationalAuditService } from './operational-audit.service';
import { OperationsPolicyService } from './operations-policy.service';
import {
  OperationalDegradationLevel,
  deterministicIdempotencyKey,
  redactSecrets,
} from './operations.types';

/**
 * Represents controlled DEGRADED/READ_ONLY/PAUSED states for individual services or capabilities.
 * Must define allowed operations in each state and integrate with existing safety boundaries
 * instead of bypassing them.
 */

@Injectable()
export class ServiceDegradationService {
  private readonly logger = new Logger(ServiceDegradationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: OperationalAuditService,
    private readonly policyService: OperationsPolicyService,
  ) {}

  async setDegradation(params: {
    tenantId?: string | null;
    serviceName: string;
    capability?: string | null;
    level: OperationalDegradationLevel;
    reason: string;
    requestedBy?: string | null;
    approvedBy?: string | null;
    correlationId?: string | null;
    startsAt?: Date;
    endsAt?: Date | null;
  }): Promise<any> {
    const { tenantId = null, serviceName, capability = null, level, reason, requestedBy = null, approvedBy = null, correlationId = null } = params;

    if (!serviceName) throw new BadRequestException('serviceName required');
    if (!Object.values(OperationalDegradationLevel).includes(level)) throw new BadRequestException(`Invalid degradation level ${level}`);

    const { allowed, blocked } = this.policyService.getDegradationAllowedOperations(level);

    const idempotencyKey = deterministicIdempotencyKey({
      type: `degradation:${serviceName}`,
      tenantId: tenantId ?? null,
      scope: capability ?? serviceName,
      correlationId: correlationId ?? null,
      timestampBucket: new Date().toISOString().slice(0, 13),
    });

    // Check existing active degradation for same service
    try {
      const existing = await (this.prisma as any).operationalServiceDegradation.findFirst({
        where: {
          tenantId: tenantId ?? null,
          serviceName,
          capability: capability ?? null,
          endsAt: null,
        },
        orderBy: { createdAt: 'desc' },
      });
      if (existing && existing.level === level) {
        return existing; // idempotent
      }
      if (existing) {
        // Close previous
        await (this.prisma as any).operationalServiceDegradation.update({
          where: { id: existing.id },
          data: { endsAt: new Date() },
        });
      }
    } catch {}

    const created = await (this.prisma as any).operationalServiceDegradation.create({
      data: {
        tenantId: tenantId ?? null,
        serviceName,
        capability: capability ?? null,
        level: level as any,
        previousLevel: null,
        reason: reason.slice(0, 1000),
        requestedBy: requestedBy ?? null,
        approvedBy: approvedBy ?? null,
        allowedOperations: allowed,
        blockedOperations: blocked,
        startsAt: params.startsAt ?? new Date(),
        endsAt: params.endsAt ?? null,
        correlationId: correlationId ?? null,
        idempotencyKey,
      },
    });

    await this.auditService.record({
      tenantId: tenantId ?? null,
      eventType: 'DEGRADATION_CHANGED' as any,
      actorId: requestedBy ?? null,
      actorType: requestedBy ? 'USER' : 'SYSTEM',
      targetType: 'SERVICE_DEGRADATION',
      targetId: created.id,
      evidence: redactSecrets({
        serviceName,
        capability,
        level,
        allowed,
        blocked,
        reason,
      }),
      correlationId: correlationId ?? null,
    });

    this.logger.log({
      event: 'operations.degradation.changed',
      serviceName,
      level,
      tenantId: tenantId ?? 'platform',
    });

    return created;
  }

  async getCurrentDegradation(params: {
    tenantId?: string | null;
    serviceName: string;
    capability?: string | null;
  }): Promise<any | null> {
    try {
      const where: any = {
        serviceName: params.serviceName,
        endsAt: null,
      };
      if (params.tenantId !== undefined) where.tenantId = params.tenantId;
      if (params.capability) where.capability = params.capability;
      return await (this.prisma as any).operationalServiceDegradation.findFirst({
        where,
        orderBy: { createdAt: 'desc' },
      });
    } catch {
      return null;
    }
  }

  async listDegradations(params: {
    tenantId?: string | null;
    serviceName?: string;
    level?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { tenantId = null, serviceName, level, page = 1, limit = 20 } = params;
    const where: any = {};
    if (tenantId !== undefined && tenantId !== null) where.tenantId = tenantId;
    if (serviceName) where.serviceName = serviceName;
    if (level) where.level = level;

    try {
      const [data, total] = await Promise.all([
        (this.prisma as any).operationalServiceDegradation.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        (this.prisma as any).operationalServiceDegradation.count({ where }),
      ]);
      return { data, total, page, limit };
    } catch {
      return { data: [], total: 0, page, limit };
    }
  }

  async enforceAllowedOperation(params: {
    tenantId?: string | null;
    serviceName: string;
    capability?: string | null;
    operation: string;
  }): Promise<void> {
    const degradation = await this.getCurrentDegradation({
      tenantId: params.tenantId ?? null,
      serviceName: params.serviceName,
      capability: params.capability ?? null,
    });
    if (!degradation) return; // NORMAL

    const allowed = (degradation.allowedOperations as string[]) ?? [];
    const blocked = (degradation.blockedOperations as string[]) ?? [];

    if (blocked.includes(params.operation) || (allowed.length > 0 && !allowed.includes(params.operation))) {
      throw new BadRequestException(
        `Operation ${params.operation} blocked for service ${params.serviceName} in degradation level ${degradation.level}`,
      );
    }
  }

  async clearDegradation(params: {
    tenantId?: string | null;
    serviceName: string;
    capability?: string | null;
    actorId?: string | null;
    correlationId?: string | null;
  }): Promise<any> {
    const current = await this.getCurrentDegradation({
      tenantId: params.tenantId ?? null,
      serviceName: params.serviceName,
      capability: params.capability ?? null,
    });
    if (!current) throw new NotFoundException(`No active degradation for ${params.serviceName}`);

    const updated = await (this.prisma as any).operationalServiceDegradation.update({
      where: { id: current.id },
      data: { endsAt: new Date() },
    });

    await this.auditService.record({
      tenantId: params.tenantId ?? null,
      eventType: 'DEGRADATION_CHANGED' as any,
      actorId: params.actorId ?? null,
      actorType: params.actorId ? 'USER' : 'SYSTEM',
      targetType: 'SERVICE_DEGRADATION',
      targetId: current.id,
      evidence: redactSecrets({ serviceName: params.serviceName, previousLevel: current.level, newLevel: 'NORMAL' }),
      correlationId: params.correlationId ?? null,
    });

    return updated;
  }
}
