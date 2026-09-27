import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OperationalAuditEventType, redactSecrets } from './operations.types';

/**
 * Produces immutable operational audit records for readiness checks, dependency transitions,
 * incidents, escalations, maintenance changes, reconciliation runs, recovery actions,
 * and operator actions. Never store secrets or sensitive credential material.
 * Immutable: no update or delete methods exposed.
 */

@Injectable()
export class OperationalAuditService {
  private readonly logger = new Logger(OperationalAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(params: {
    tenantId: string | null;
    eventType: OperationalAuditEventType | string;
    actorId: string | null;
    actorType: string;
    targetType?: string | null;
    targetId?: string | null;
    evidence: Record<string, unknown>;
    correlationId?: string | null;
    requestId?: string | null;
  }): Promise<string | null> {
    const sanitizedEvidence = redactSecrets(params.evidence);

    try {
      const record = await (this.prisma as any).operationalAuditLog.create({
        data: {
          tenantId: params.tenantId ?? null,
          eventType: params.eventType as any,
          actorId: params.actorId ?? null,
          actorType: params.actorType,
          targetType: params.targetType ?? null,
          targetId: params.targetId ?? null,
          evidence: sanitizedEvidence as any,
          correlationId: params.correlationId ?? null,
          requestId: params.requestId ?? null,
        },
      });
      return record.id;
    } catch (e) {
      this.logger.warn(`Failed to write operational audit log: ${(e as Error).message}`);
      // Fallback to general audit log if operational table not available
      try {
        await this.prisma.auditLog.create({
          data: {
            tenantId: params.tenantId ?? null,
            actorType: (params.actorType as any) ?? 'SYSTEM',
            actorId: params.actorId ?? null,
            action: `OPERATIONAL_${params.eventType}`,
            outcome: 'SUCCESS' as any,
            resourceType: params.targetType ?? null,
            resourceId: params.targetId ?? null,
            description: `Operational audit ${params.eventType}`,
            metadata: sanitizedEvidence as any,
            requestId: params.requestId ?? null,
            correlationId: params.correlationId ?? null,
          } as any,
        });
      } catch {}
      return null;
    }
  }

  async list(params: {
    tenantId?: string | null;
    eventType?: string;
    targetType?: string;
    targetId?: string;
    correlationId?: string;
    from?: Date;
    to?: Date;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { tenantId, eventType, targetType, targetId, correlationId, from, to, page = 1, limit = 20 } = params;
    const where: any = {};
    if (tenantId !== undefined) {
      where.tenantId = tenantId;
    }
    if (eventType) where.eventType = eventType;
    if (targetType) where.targetType = targetType;
    if (targetId) where.targetId = targetId;
    if (correlationId) where.correlationId = correlationId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = from;
      if (to) where.createdAt.lte = to;
    }

    try {
      const [data, total] = await Promise.all([
        (this.prisma as any).operationalAuditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        (this.prisma as any).operationalAuditLog.count({ where }),
      ]);
      return { data, total, page, limit };
    } catch {
      return { data: [], total: 0, page, limit };
    }
  }

  async getByCorrelationId(correlationId: string, tenantId?: string | null): Promise<any[]> {
    try {
      const where: any = { correlationId };
      if (tenantId !== undefined) where.tenantId = tenantId;
      return await (this.prisma as any).operationalAuditLog.findMany({
        where,
        orderBy: { createdAt: 'asc' },
      });
    } catch {
      return [];
    }
  }
}
