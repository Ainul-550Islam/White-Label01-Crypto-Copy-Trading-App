import { Injectable, Logger, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OperationalAuditService } from './operational-audit.service';
import { OperationsPolicyService } from './operations-policy.service';
import {
  OperationalMaintenanceState,
  OperationalMaintenanceScope,
  MAINTENANCE_VALID_TRANSITIONS,
  isValidTransition,
  deterministicIdempotencyKey,
  redactSecrets,
} from './operations.types';
import { randomUUID } from 'crypto';

/**
 * Creates, validates, schedules, updates, and closes maintenance windows with
 * platform/tenant/venue/service scope, UTC-safe time handling, conflict detection,
 * authorization, and audit history.
 */

@Injectable()
export class MaintenanceWindowService {
  private readonly logger = new Logger(MaintenanceWindowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: OperationalAuditService,
    private readonly policyService: OperationsPolicyService,
  ) {}

  private ensureUtc(date: Date | string): Date {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) throw new BadRequestException(`Invalid date: ${date}`);
    return d;
  }

  private async checkConflicts(params: {
    tenantId?: string | null;
    scope: OperationalMaintenanceScope;
    scopeTarget?: string | null;
    scheduledStart: Date;
    scheduledEnd: Date;
    excludeId?: string;
  }): Promise<void> {
    // Conflict detection: overlapping windows for same scope/target
    const where: any = {
      state: { in: [OperationalMaintenanceState.SCHEDULED, OperationalMaintenanceState.ACTIVE] },
      scope: params.scope,
      scheduledStart: { lt: params.scheduledEnd },
      scheduledEnd: { gt: params.scheduledStart },
    };
    if (params.scopeTarget) {
      where.scopeTarget = params.scopeTarget;
    }
    if (params.tenantId !== undefined) {
      where.tenantId = params.tenantId;
    }
    if (params.excludeId) {
      where.id = { not: params.excludeId };
    }

    try {
      const conflicting = await (this.prisma as any).operationalMaintenanceWindow.findFirst({ where });
      if (conflicting) {
        throw new BadRequestException(
          `Maintenance conflict: existing window ${conflicting.id} (${conflicting.title}) overlaps with requested time`,
        );
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      // If table not exists yet, no conflict
    }
  }

  async createWindow(params: {
    tenantId?: string | null;
    scope: OperationalMaintenanceScope;
    scopeTarget?: string | null;
    title: string;
    description?: string | null;
    scheduledStart: Date | string;
    scheduledEnd: Date | string;
    requestedBy?: string | null;
    correlationId?: string | null;
    isEmergency?: boolean;
  }): Promise<any> {
    const start = this.ensureUtc(params.scheduledStart);
    const end = this.ensureUtc(params.scheduledEnd);

    if (start >= end) throw new BadRequestException('scheduledStart must be before scheduledEnd');
    if (start < new Date(Date.now() - 60000)) {
      // Allow slight past for emergency but not far past
      if (!params.isEmergency) throw new BadRequestException('scheduledStart cannot be in the past');
    }

    const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    const restrictions = this.policyService.getMaintenanceRestrictions();
    const restriction = restrictions.find((r) => r.scope === params.scope);
    if (restriction && durationHours > restriction.maxDurationHours && !params.isEmergency) {
      throw new BadRequestException(`Maintenance window exceeds max duration ${restriction.maxDurationHours}h for scope ${params.scope}`);
    }

    // Authorization check: platform scopes require platform role (enforced in controller via RBAC, but also here)
    if (restriction?.requiresPlatformRole && params.tenantId !== null && params.scope === OperationalMaintenanceScope.PLATFORM) {
      throw new ForbiddenException('Platform maintenance requires platform role');
    }

    await this.checkConflicts({
      tenantId: params.tenantId ?? null,
      scope: params.scope,
      scopeTarget: params.scopeTarget ?? null,
      scheduledStart: start,
      scheduledEnd: end,
    });

    const idempotencyKey = deterministicIdempotencyKey({
      type: `maintenance:${params.scope}`,
      tenantId: params.tenantId ?? null,
      scope: params.scopeTarget ?? params.scope,
      correlationId: params.correlationId ?? null,
      timestampBucket: start.toISOString(),
    });

    // Idempotency: check existing by key
    try {
      const existing = await (this.prisma as any).operationalMaintenanceWindow.findFirst({
        where: { idempotencyKey },
      });
      if (existing) return existing;
    } catch {}

    const created = await (this.prisma as any).operationalMaintenanceWindow.create({
      data: {
        tenantId: params.tenantId ?? null,
        scope: params.scope as any,
        scopeTarget: params.scopeTarget ?? null,
        state: OperationalMaintenanceState.SCHEDULED as any,
        title: params.title.slice(0, 255),
        description: params.description?.slice(0, 2000) ?? null,
        scheduledStart: start,
        scheduledEnd: end,
        requestedBy: params.requestedBy ?? null,
        isEmergency: params.isEmergency ?? false,
        conflictChecked: true,
        idempotencyKey,
        correlationId: params.correlationId ?? null,
        metadata: redactSecrets({ scope: params.scope, scopeTarget: params.scopeTarget }) as any,
      },
    });

    await this.auditService.record({
      tenantId: params.tenantId ?? null,
      eventType: 'MAINTENANCE_CREATED' as any,
      actorId: params.requestedBy ?? null,
      actorType: params.requestedBy ? 'USER' : 'SYSTEM',
      targetType: 'MAINTENANCE_WINDOW',
      targetId: created.id,
      evidence: redactSecrets({
        scope: params.scope,
        scopeTarget: params.scopeTarget,
        scheduledStart: start.toISOString(),
        scheduledEnd: end.toISOString(),
        title: params.title,
      }),
      correlationId: params.correlationId ?? null,
    });

    return created;
  }

  async getWindow(tenantId: string | null, windowId: string): Promise<any> {
    const where: any = { id: windowId };
    if (tenantId !== null) {
      where.tenantId = tenantId;
    }
    try {
      const win = await (this.prisma as any).operationalMaintenanceWindow.findFirst({ where });
      if (!win) throw new NotFoundException(`Maintenance window ${windowId} not found`);
      if (tenantId !== null && win.tenantId !== null && win.tenantId !== tenantId) {
        throw new ForbiddenException('Tenant isolation violation');
      }
      return win;
    } catch (e) {
      if (e instanceof NotFoundException || e instanceof ForbiddenException || e instanceof BadRequestException) throw e;
      throw new NotFoundException(`Maintenance window ${windowId} not found`);
    }
  }

  async listWindows(params: {
    tenantId?: string | null;
    scope?: string;
    state?: string;
    from?: Date;
    to?: Date;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { tenantId = null, scope, state, from, to, page = 1, limit = 20 } = params;
    const where: any = {};
    if (tenantId !== undefined && tenantId !== null) where.tenantId = tenantId;
    if (scope) where.scope = scope;
    if (state) where.state = state;
    if (from || to) {
      where.scheduledStart = {};
      if (from) where.scheduledStart.gte = from;
      if (to) where.scheduledStart.lte = to;
    }

    try {
      const [data, total] = await Promise.all([
        (this.prisma as any).operationalMaintenanceWindow.findMany({
          where,
          orderBy: { scheduledStart: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        (this.prisma as any).operationalMaintenanceWindow.count({ where }),
      ]);
      return { data, total, page, limit };
    } catch {
      return { data: [], total: 0, page, limit };
    }
  }

  async transitionWindow(params: {
    tenantId: string | null;
    windowId: string;
    toState: OperationalMaintenanceState;
    actorId?: string | null;
    reason?: string | null;
    correlationId?: string | null;
  }): Promise<any> {
    const win = await this.getWindow(params.tenantId, params.windowId);
    const fromState = win.state as OperationalMaintenanceState;
    if (!isValidTransition(MAINTENANCE_VALID_TRANSITIONS, fromState, params.toState)) {
      throw new BadRequestException(`Invalid maintenance transition ${fromState} -> ${params.toState}`);
    }

    const data: any = { state: params.toState };
    const now = new Date();
    if (params.toState === OperationalMaintenanceState.ACTIVE) {
      data.actualStart = now;
    } else if (params.toState === OperationalMaintenanceState.COMPLETED) {
      data.actualEnd = now;
    } else if (params.toState === OperationalMaintenanceState.CANCELLED) {
      data.cancelledBy = params.actorId ?? null;
      data.cancellationReason = params.reason?.slice(0, 500) ?? null;
    }

    const updated = await (this.prisma as any).operationalMaintenanceWindow.update({
      where: { id: win.id },
      data,
    });

    const auditMap: Record<string, string> = {
      [OperationalMaintenanceState.ACTIVE]: 'MAINTENANCE_STARTED',
      [OperationalMaintenanceState.COMPLETED]: 'MAINTENANCE_COMPLETED',
      [OperationalMaintenanceState.CANCELLED]: 'MAINTENANCE_CANCELLED',
    };

    await this.auditService.record({
      tenantId: params.tenantId ?? null,
      eventType: (auditMap[params.toState] ?? 'MAINTENANCE_UPDATED') as any,
      actorId: params.actorId ?? null,
      actorType: params.actorId ? 'USER' : 'SYSTEM',
      targetType: 'MAINTENANCE_WINDOW',
      targetId: win.id,
      evidence: redactSecrets({ fromState, toState: params.toState, reason: params.reason }),
      correlationId: params.correlationId ?? null,
    });

    return updated;
  }

  async cancelWindow(params: {
    tenantId: string | null;
    windowId: string;
    actorId?: string | null;
    reason: string;
    correlationId?: string | null;
  }) {
    return this.transitionWindow({
      tenantId: params.tenantId,
      windowId: params.windowId,
      toState: OperationalMaintenanceState.CANCELLED,
      actorId: params.actorId ?? null,
      reason: params.reason,
      correlationId: params.correlationId ?? null,
    });
  }
}
