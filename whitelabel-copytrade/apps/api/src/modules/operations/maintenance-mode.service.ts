import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MaintenanceWindowService } from './maintenance-window.service';
import { OperationalAuditService } from './operational-audit.service';
import { OperationsPolicyService } from './operations-policy.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import {
  OperationalMaintenanceScope,
  OperationalMaintenanceState,
  redactSecrets,
} from './operations.types';

/**
 * Enforces operational maintenance state for supported scopes.
 * Must integrate with existing trading/live-gate/execution boundaries so maintenance mode
 * can restrict new actions without directly rewriting authoritative execution state.
 */

@Injectable()
export class MaintenanceModeService {
  private readonly logger = new Logger(MaintenanceModeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly maintenanceWindowService: MaintenanceWindowService,
    private readonly auditService: OperationalAuditService,
    private readonly policyService: OperationsPolicyService,
    private readonly redis: RedisService,
  ) {}

  private getMaintenanceKey(scope: OperationalMaintenanceScope, scopeTarget?: string | null, tenantId?: string | null): string {
    const parts = ['ops', 'maintenance', scope.toLowerCase()];
    if (tenantId) parts.push(`tenant:${tenantId}`);
    if (scopeTarget) parts.push(`target:${scopeTarget}`);
    return parts.join(':');
  }

  async isInMaintenance(params: {
    scope: OperationalMaintenanceScope;
    scopeTarget?: string | null;
    tenantId?: string | null;
  }): Promise<boolean> {
    const { scope, scopeTarget = null, tenantId = null } = params;

    // Check Redis fast path
    try {
      const key = this.getMaintenanceKey(scope, scopeTarget, tenantId);
      const val = await this.redis.client.get(key);
      if (val === 'ACTIVE') return true;
    } catch {}

    // Check DB authoritative windows
    try {
      const now = new Date();
      const where: any = {
        state: OperationalMaintenanceState.ACTIVE as any,
        scope: scope as any,
        scheduledStart: { lte: now },
        scheduledEnd: { gte: now },
      };
      if (scopeTarget) where.scopeTarget = scopeTarget;
      if (tenantId !== null) {
        where.OR = [{ tenantId }, { tenantId: null }, { scope: OperationalMaintenanceScope.PLATFORM }];
      } else {
        where.scope = { in: [scope, OperationalMaintenanceScope.PLATFORM] };
      }

      const active = await (this.prisma as any).operationalMaintenanceWindow.findFirst({ where });
      return !!active;
    } catch {
      return false;
    }
  }

  async enterMaintenance(params: {
    tenantId?: string | null;
    scope: OperationalMaintenanceScope;
    scopeTarget?: string | null;
    title: string;
    description?: string | null;
    scheduledStart?: Date;
    scheduledEnd?: Date;
    requestedBy?: string | null;
    correlationId?: string | null;
    isEmergency?: boolean;
  }): Promise<any> {
    const { tenantId = null, scope, scopeTarget = null, title, description = null, requestedBy = null, correlationId = null, isEmergency = false } = params;

    // Maintenance must be conflict-checked, time-bounded, auditable, authorization-controlled
    // Entering maintenance must not automatically cancel or mutate existing live orders unless existing authoritative service explicitly performs that operation

    const start = params.scheduledStart ?? new Date();
    const end = params.scheduledEnd ?? new Date(Date.now() + 60 * 60 * 1000); // default 1h

    // Create window via maintenance window service (which does conflict check)
    const window = await this.maintenanceWindowService.createWindow({
      tenantId: tenantId ?? null,
      scope,
      scopeTarget: scopeTarget ?? null,
      title,
      description,
      scheduledStart: start,
      scheduledEnd: end,
      requestedBy: requestedBy ?? null,
      correlationId: correlationId ?? null,
      isEmergency,
    });

    // Immediately transition to ACTIVE
    const activeWindow = await this.maintenanceWindowService.transitionWindow({
      tenantId: tenantId ?? null,
      windowId: window.id,
      toState: OperationalMaintenanceState.ACTIVE,
      actorId: requestedBy ?? null,
      reason: 'Enter maintenance mode',
      correlationId: correlationId ?? null,
    });

    // Set Redis flag for fast enforcement (does not rewrite execution state)
    try {
      const key = this.getMaintenanceKey(scope, scopeTarget, tenantId);
      await this.redis.client.set(key, 'ACTIVE', 'PX', end.getTime() - Date.now());
    } catch (e) {
      this.logger.warn(`Failed to set maintenance flag in Redis: ${(e as Error).message}`);
    }

    await this.auditService.record({
      tenantId: tenantId ?? null,
      eventType: 'MAINTENANCE_STARTED' as any,
      actorId: requestedBy ?? null,
      actorType: requestedBy ? 'USER' : 'SYSTEM',
      targetType: 'MAINTENANCE_WINDOW',
      targetId: activeWindow.id,
      evidence: redactSecrets({
        scope,
        scopeTarget,
        title,
        scheduledStart: start.toISOString(),
        scheduledEnd: end.toISOString(),
      }),
      correlationId: correlationId ?? null,
    });

    this.logger.log({
      event: 'operations.maintenance.entered',
      scope,
      scopeTarget,
      tenantId: tenantId ?? 'platform',
      windowId: activeWindow.id,
    });

    return activeWindow;
  }

  async exitMaintenance(params: {
    tenantId?: string | null;
    scope: OperationalMaintenanceScope;
    scopeTarget?: string | null;
    windowId?: string | null;
    requestedBy?: string | null;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId = null, scope, scopeTarget = null, windowId = null, requestedBy = null, correlationId = null } = params;

    let win: any;
    if (windowId) {
      win = await this.maintenanceWindowService.getWindow(tenantId, windowId);
    } else {
      // Find active window for scope
      try {
        const where: any = {
          state: OperationalMaintenanceState.ACTIVE as any,
          scope: scope as any,
        };
        if (scopeTarget) where.scopeTarget = scopeTarget;
        if (tenantId !== null) where.tenantId = tenantId;
        win = await (this.prisma as any).operationalMaintenanceWindow.findFirst({
          where,
          orderBy: { scheduledStart: 'desc' },
        });
      } catch {}
      if (!win) throw new BadRequestException(`No active maintenance window found for scope ${scope}`);
    }

    const completed = await this.maintenanceWindowService.transitionWindow({
      tenantId: tenantId ?? null,
      windowId: win.id,
      toState: OperationalMaintenanceState.COMPLETED,
      actorId: requestedBy ?? null,
      reason: 'Exit maintenance mode',
      correlationId: correlationId ?? null,
    });

    // Clear Redis flag
    try {
      const key = this.getMaintenanceKey(scope, scopeTarget, tenantId);
      await this.redis.client.del(key);
    } catch (e) {
      this.logger.warn(`Failed to clear maintenance flag in Redis: ${(e as Error).message}`);
    }

    await this.auditService.record({
      tenantId: tenantId ?? null,
      eventType: 'MAINTENANCE_COMPLETED' as any,
      actorId: requestedBy ?? null,
      actorType: requestedBy ? 'USER' : 'SYSTEM',
      targetType: 'MAINTENANCE_WINDOW',
      targetId: completed.id,
      evidence: redactSecrets({ scope, scopeTarget }),
      correlationId: correlationId ?? null,
    });

    return completed;
  }

  async enforceMaintenanceGate(params: {
    tenantId?: string | null;
    scope: OperationalMaintenanceScope;
    scopeTarget?: string | null;
    operation: string;
  }): Promise<void> {
    const inMaintenance = await this.isInMaintenance({
      scope: params.scope,
      scopeTarget: params.scopeTarget ?? null,
      tenantId: params.tenantId ?? null,
    });
    if (inMaintenance) {
      // Integrate with existing live-gate/execution boundaries — restrict new actions without rewriting execution state
      throw new BadRequestException(`Operation ${params.operation} blocked: maintenance active for ${params.scope}${params.scopeTarget ? `:${params.scopeTarget}` : ''}`);
    }
  }
}
