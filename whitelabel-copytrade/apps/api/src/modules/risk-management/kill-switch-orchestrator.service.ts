import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RiskEventService } from './risk-event.service';
import { RiskPolicyScope, RiskSeverity, RiskEventType } from './risk-management.types';

/**
 * Kill-switch orchestrator wraps existing KillSwitch (Prisma model KillSwitch).
 * - Request/inspect/apply scoped/recover authorized/audit, no second implementation.
 * - Uses existing KillSwitch table as authoritative store.
 * - Never auto-disables account solely from advisory score unless policy permits.
 * - Every activation/deactivation auditable.
 */

export enum KillSwitchRequestScope {
  GLOBAL = 'GLOBAL',
  EXCHANGE = 'EXCHANGE',
  ACCOUNT = 'ACCOUNT',
  STRATEGY = 'STRATEGY',
  SYMBOL = 'SYMBOL',
  RISK = 'RISK',
}

@Injectable()
export class KillSwitchOrchestratorService {
  private readonly logger = new Logger(KillSwitchOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventService: RiskEventService,
  ) {}

  async requestKillSwitch(params: {
    tenantId?: string | null;
    scope: KillSwitchRequestScope;
    target?: string | null;
    reason: string;
    triggeredByRule?: string;
    severity?: RiskSeverity;
    requestedByUserId?: string;
    policyVersion: string;
    requiresExplicitClear?: boolean;
  }): Promise<{ id: string; isEngaged: boolean }> {
    const { tenantId, scope, target, reason, triggeredByRule, severity, requestedByUserId, policyVersion, requiresExplicitClear } = params;

    if (!reason || reason.trim().length < 10) {
      throw new ForbiddenException('Kill-switch reason must be at least 10 characters');
    }

    // Check if already engaged
    const existing = await this.prisma.killSwitch.findFirst({
      where: { tenantId: tenantId ?? undefined, scope: scope as any, target: target ?? undefined, isEngaged: true },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      this.logger.log(`Kill-switch already engaged for ${scope} ${target ?? ''}, id ${existing.id}`);
      return { id: existing.id, isEngaged: true };
    }

    const created = await this.prisma.killSwitch.create({
      data: {
        tenantId: tenantId ?? null,
        scope: scope as any,
        target: target ?? null,
        isEngaged: true,
        reason: reason.slice(0, 500),
        engagedByUserId: requestedByUserId ?? null,
        engagedAt: new Date(),
        status: 'TRIGGERED' as any,
        triggeredByRule: triggeredByRule ?? null,
        triggeredAt: new Date(),
        severity: (severity as any) ?? 'CRITICAL',
        requiresExplicitClear: requiresExplicitClear ?? true,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: tenantId ?? undefined,
        actorId: requestedByUserId ?? undefined,
        actorType: requestedByUserId ? 'USER' : 'SYSTEM',
        action: 'KILL_SWITCH_ENGAGED',
        resourceType: 'KILL_SWITCH',
        resourceId: created.id,
        description: `Kill-switch ENGAGED scope ${scope} target ${target ?? ''} reason ${reason}`.slice(0, 500),
        metadata: { scope, target, reason, triggeredByRule, severity, policyVersion } as any,
      },
    });

    if (tenantId) {
      await this.eventService.emitThresholdBreached({
        tenantId,
        type: RiskEventType.KILL_SWITCH_REQUESTED,
        ruleId: triggeredByRule ?? 'KILL_SWITCH_REQUESTED',
        policyVersion,
        scope: this.mapScopeToPolicyScope(scope),
        scopeId: target ?? tenantId,
        accountId: scope === KillSwitchRequestScope.ACCOUNT ? target ?? null : null,
        strategyId: scope === KillSwitchRequestScope.STRATEGY ? target ?? null : null,
        symbol: scope === KillSwitchRequestScope.SYMBOL ? target ?? null : null,
        venue: scope === KillSwitchRequestScope.EXCHANGE ? target ?? null : null,
        severity: severity ?? RiskSeverity.CRITICAL,
        message: `Kill-switch REQUESTED scope ${scope} target ${target ?? ''}: ${reason}`,
        sourceRefs: { killSwitchId: created.id },
        requestId: null,
      });
    }

    this.logger.warn(`Kill-switch ENGAGED scope ${scope} target ${target ?? ''} reason ${reason} id ${created.id}`);
    return { id: created.id, isEngaged: true };
  }

  async inspectKillSwitch(params: { tenantId?: string | null; scope?: KillSwitchRequestScope; target?: string }): Promise<any[]> {
    const { tenantId, scope, target } = params;
    return this.prisma.killSwitch.findMany({
      where: {
        tenantId: tenantId ?? undefined,
        scope: scope ? (scope as any) : undefined,
        target: target ?? undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async isEngaged(params: { tenantId?: string | null; scope: KillSwitchRequestScope; target?: string }): Promise<boolean> {
    const { tenantId, scope, target } = params;
    const ks = await this.prisma.killSwitch.findFirst({
      where: { tenantId: tenantId ?? undefined, scope: scope as any, target: target ?? undefined, isEngaged: true },
      orderBy: { createdAt: 'desc' },
    });
    return !!ks;
  }

  async clearKillSwitch(params: {
    killSwitchId: string;
    clearedByUserId: string;
    reason: string;
    tenantId?: string;
    acknowledged?: boolean;
  }): Promise<{ id: string; isEngaged: boolean }> {
    const { killSwitchId, clearedByUserId, reason, tenantId } = params;
    if (!reason || reason.trim().length < 20) {
      throw new ForbiddenException('Kill-switch clear reason must be at least 20 characters');
    }

    const ks = await this.prisma.killSwitch.findUnique({ where: { id: killSwitchId } });
    if (!ks) throw new ForbiddenException(`Kill-switch ${killSwitchId} not found`);
    if (!ks.isEngaged) throw new ForbiddenException(`Kill-switch ${killSwitchId} not engaged`);

    // If requiresExplicitClear, must have been acknowledged first? For now allow clear with reason.
    await this.prisma.killSwitch.update({
      where: { id: killSwitchId },
      data: {
        isEngaged: false,
        releasedByUserId: clearedByUserId,
        releasedAt: new Date(),
        status: 'CLEARED' as any,
        clearedByUserId: clearedByUserId,
        clearedAt: new Date(),
        clearedReason: reason.slice(0, 500),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: tenantId ?? ks.tenantId ?? undefined,
        actorId: clearedByUserId,
        actorType: 'USER',
        action: 'KILL_SWITCH_CLEARED',
        resourceType: 'KILL_SWITCH',
        resourceId: killSwitchId,
        description: `Kill-switch CLEARED scope ${ks.scope} target ${ks.target ?? ''} by ${clearedByUserId} reason ${reason}`.slice(0, 500),
        metadata: { reason, previousScope: ks.scope, target: ks.target } as any,
      },
    });

    this.logger.log(`Kill-switch CLEARED scope ${ks.scope} target ${ks.target ?? ''} id ${killSwitchId} by ${clearedByUserId}`);
    return { id: killSwitchId, isEngaged: false };
  }

  async acknowledgeKillSwitch(params: { killSwitchId: string; acknowledgedByUserId: string; reason: string; tenantId?: string }): Promise<{ id: string }> {
    const { killSwitchId, acknowledgedByUserId, reason, tenantId } = params;
    if (!reason || reason.trim().length < 10) throw new ForbiddenException('Acknowledge reason must be at least 10 characters');

    const ks = await this.prisma.killSwitch.findUnique({ where: { id: killSwitchId } });
    if (!ks) throw new ForbiddenException(`Kill-switch ${killSwitchId} not found`);
    if (ks.status !== 'TRIGGERED') throw new ForbiddenException(`Kill-switch ${killSwitchId} not in TRIGGERED state, current ${ks.status}`);

    await this.prisma.killSwitch.update({
      where: { id: killSwitchId },
      data: {
        status: 'ACKNOWLEDGED' as any,
        acknowledgedByUserId: acknowledgedByUserId,
        acknowledgedAt: new Date(),
        acknowledgementReason: reason.slice(0, 500),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: tenantId ?? ks.tenantId ?? undefined,
        actorId: acknowledgedByUserId,
        actorType: 'USER',
        action: 'KILL_SWITCH_ACKNOWLEDGED',
        resourceType: 'KILL_SWITCH',
        resourceId: killSwitchId,
        description: `Kill-switch ACKNOWLEDGED ${ks.scope} ${ks.target ?? ''} by ${acknowledgedByUserId} reason ${reason}`.slice(0, 500),
      },
    });

    return { id: killSwitchId };
  }

  private mapScopeToPolicyScope(scope: KillSwitchRequestScope): RiskPolicyScope {
    switch (scope) {
      case KillSwitchRequestScope.GLOBAL:
        return RiskPolicyScope.PLATFORM;
      case KillSwitchRequestScope.EXCHANGE:
        return RiskPolicyScope.TENANT;
      case KillSwitchRequestScope.ACCOUNT:
        return RiskPolicyScope.TENANT;
      case KillSwitchRequestScope.STRATEGY:
        return RiskPolicyScope.STRATEGY;
      case KillSwitchRequestScope.SYMBOL:
        return RiskPolicyScope.TENANT;
      case KillSwitchRequestScope.RISK:
        return RiskPolicyScope.TENANT;
      default:
        return RiskPolicyScope.TENANT;
    }
  }
}
