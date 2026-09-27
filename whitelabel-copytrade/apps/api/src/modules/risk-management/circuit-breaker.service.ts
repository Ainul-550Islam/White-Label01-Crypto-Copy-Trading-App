import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { InstitutionalRiskPolicyService } from './risk-policy.service';
import { RiskEventService } from './risk-event.service';
import { CircuitBreakerScope, CircuitBreakerState, RiskPolicyScope, RiskSeverity, RiskEventType } from './risk-management.types';

/**
 * Circuit breaker service with scopes SYMBOL/STRATEGY/TRADER/ACCOUNT/TENANT/VENUE/PLATFORM.
 * Triggers: loss/drawdown/outage/stale data/execution failure/rate-limit/liquidation/concentration/compliance/security.
 * States CLOSED/OPEN/HALF_OPEN, policy-controlled recovery.
 * Every activation/deactivation auditable.
 * Never directly places orders except through kill-switch boundary when policy permits.
 */

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: InstitutionalRiskPolicyService,
    private readonly eventService: RiskEventService,
  ) {}

  async getBreakerStatus(params: { tenantId?: string | null; scope: CircuitBreakerScope; scopeId: string }): Promise<any | null> {
    const { tenantId, scope, scopeId } = params;
    return this.prisma.circuitBreakerRecord.findFirst({
      where: { tenantId: tenantId ?? undefined, scope: scope as any, scopeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listBreakers(params: { tenantId?: string | null; state?: CircuitBreakerState }): Promise<any[]> {
    const { tenantId, state } = params;
    return this.prisma.circuitBreakerRecord.findMany({
      where: { tenantId: tenantId ?? undefined, state: state as any },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async triggerBreaker(params: {
    tenantId?: string | null;
    scope: CircuitBreakerScope;
    scopeId: string;
    triggerType: string; // loss/drawdown/outage/stale data/execution failure/rate-limit/liquidation/concentration/compliance/security
    triggerRuleId?: string;
    reason: string;
    policyVersion: string;
    triggeredByUserId?: string;
    traderId?: string;
    strategyId?: string;
    accountId?: string;
  }): Promise<{ id: string; state: CircuitBreakerState }> {
    const { tenantId, scope, scopeId, triggerType, triggerRuleId, reason, policyVersion, triggeredByUserId, traderId, strategyId, accountId } = params;

    if (!reason || reason.trim().length < 10) {
      throw new ForbiddenException('Circuit breaker reason must be at least 10 characters');
    }

    // Check existing breaker: if already OPEN, do not duplicate unless reason changed significantly
    const existing = await this.prisma.circuitBreakerRecord.findFirst({
      where: { tenantId: tenantId ?? undefined, scope: scope as any, scopeId, state: 'OPEN' as any },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      this.logger.log(`Circuit breaker already OPEN for ${scope} ${scopeId}, existing ${existing.id}`);
      return { id: existing.id, state: CircuitBreakerState.OPEN };
    }

    const created = await this.prisma.circuitBreakerRecord.create({
      data: {
        tenantId: tenantId ?? null,
        scope: scope as any,
        scopeId,
        state: 'OPEN' as any,
        triggerType,
        triggerRuleId: triggerRuleId ?? null,
        reason: reason.slice(0, 1000),
        policyVersion,
        triggeredAt: new Date(),
        triggeredByUserId: triggeredByUserId ?? null,
        metadata: { traderId, strategyId, accountId } as any,
      },
    });

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        tenantId: tenantId ?? undefined,
        actorId: triggeredByUserId ?? undefined,
        actorType: triggeredByUserId ? 'USER' : 'SYSTEM',
        action: 'CIRCUIT_BREAKER_TRIGGERED',
        resourceType: 'CIRCUIT_BREAKER',
        resourceId: created.id,
        description: `Breaker OPEN ${scope} ${scopeId} trigger ${triggerType} rule ${triggerRuleId ?? ''} reason ${reason}`.slice(0, 500),
        metadata: { scope, scopeId, triggerType, triggerRuleId, reason, policyVersion } as any,
      },
    });

    // Emit risk event
    if (tenantId) {
      await this.eventService.emitThresholdBreached({
        tenantId,
        type: RiskEventType.CIRCUIT_BREAKER_TRIGGERED,
        ruleId: triggerRuleId ?? 'CIRCUIT_BREAKER_TRIGGERED',
        policyVersion,
        scope: this.mapScopeToPolicyScope(scope),
        scopeId,
        accountId: accountId ?? null,
        strategyId: strategyId ?? null,
        traderId: traderId ?? null,
        symbol: scope === CircuitBreakerScope.SYMBOL ? scopeId : null,
        venue: scope === CircuitBreakerScope.VENUE ? scopeId : null,
        severity: RiskSeverity.CRITICAL,
        message: `Circuit breaker TRIGGERED for ${scope} ${scopeId}: ${reason}`,
        sourceRefs: { breakerId: created.id, triggerType },
      });
    }

    this.logger.warn(`Circuit breaker TRIGGERED ${scope} ${scopeId} type ${triggerType} reason ${reason}`);
    return { id: created.id, state: CircuitBreakerState.OPEN };
  }

  async acknowledgeBreaker(params: { breakerId: string; acknowledgedByUserId: string; reason: string; tenantId?: string }): Promise<{ id: string }> {
    const { breakerId, acknowledgedByUserId, reason, tenantId } = params;
    const breaker = await this.prisma.circuitBreakerRecord.findUnique({ where: { id: breakerId } });
    if (!breaker) throw new ForbiddenException(`Breaker ${breakerId} not found`);
    if (breaker.state !== 'OPEN') throw new ForbiddenException(`Breaker ${breakerId} not in OPEN state, current ${breaker.state}`);

    await this.prisma.circuitBreakerRecord.update({
      where: { id: breakerId },
      data: { acknowledgedAt: new Date(), metadata: { ...(breaker.metadata as any), acknowledgedByUserId, acknowledgeReason: reason } as any },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: tenantId ?? breaker.tenantId ?? undefined,
        actorId: acknowledgedByUserId,
        actorType: 'USER',
        action: 'CIRCUIT_BREAKER_ACKNOWLEDGED',
        resourceType: 'CIRCUIT_BREAKER',
        resourceId: breakerId,
        description: `Breaker ACKNOWLEDGED ${breaker.scope} ${breaker.scopeId} by ${acknowledgedByUserId} reason ${reason}`.slice(0, 500),
      },
    });

    return { id: breakerId };
  }

  async clearBreaker(params: {
    breakerId: string;
    clearedByUserId: string;
    reason: string;
    tenantId?: string;
    requireExplicitClear?: boolean;
  }): Promise<{ id: string; state: CircuitBreakerState }> {
    const { breakerId, clearedByUserId, reason, tenantId } = params;
    if (!reason || reason.trim().length < 20) {
      throw new ForbiddenException('Clear reason must be at least 20 characters');
    }
    const breaker = await this.prisma.circuitBreakerRecord.findUnique({ where: { id: breakerId } });
    if (!breaker) throw new ForbiddenException(`Breaker ${breakerId} not found`);
    if (breaker.state !== 'OPEN' && breaker.state !== 'HALF_OPEN') {
      throw new ForbiddenException(`Breaker ${breakerId} not in clearable state, current ${breaker.state}`);
    }

    // Policy-controlled recovery: check if policy requires explicit clear
    // For now allow if reason provided

    await this.prisma.circuitBreakerRecord.update({
      where: { id: breakerId },
      data: { state: 'CLOSED' as any, clearedAt: new Date(), clearedByUserId, metadata: { ...(breaker.metadata as any), clearReason: reason } as any },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: tenantId ?? breaker.tenantId ?? undefined,
        actorId: clearedByUserId,
        actorType: 'USER',
        action: 'CIRCUIT_BREAKER_CLEARED',
        resourceType: 'CIRCUIT_BREAKER',
        resourceId: breakerId,
        description: `Breaker CLEARED ${breaker.scope} ${breaker.scopeId} by ${clearedByUserId} reason ${reason}`.slice(0, 500),
        metadata: { reason, previousState: breaker.state } as any,
      },
    });

    this.logger.log(`Circuit breaker CLEARED ${breaker.scope} ${breaker.scopeId} by ${clearedByUserId}`);
    return { id: breakerId, state: CircuitBreakerState.CLOSED };
  }

  async halfOpenBreaker(params: { breakerId: string; tenantId?: string }): Promise<{ id: string; state: CircuitBreakerState }> {
    const { breakerId, tenantId } = params;
    const breaker = await this.prisma.circuitBreakerRecord.findUnique({ where: { id: breakerId } });
    if (!breaker) throw new ForbiddenException(`Breaker ${breakerId} not found`);
    if (breaker.state !== 'OPEN') throw new ForbiddenException(`Breaker ${breakerId} not OPEN, cannot half-open`);

    await this.prisma.circuitBreakerRecord.update({
      where: { id: breakerId },
      data: { state: 'HALF_OPEN' as any, halfOpenAt: new Date() },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId: tenantId ?? breaker.tenantId ?? undefined,
        actorType: 'SYSTEM',
        action: 'CIRCUIT_BREAKER_HALF_OPEN',
        resourceType: 'CIRCUIT_BREAKER',
        resourceId: breakerId,
        description: `Breaker HALF_OPEN ${breaker.scope} ${breaker.scopeId}`.slice(0, 500),
      },
    });

    return { id: breakerId, state: CircuitBreakerState.HALF_OPEN };
  }

  async isBlocked(params: { tenantId?: string | null; scope: CircuitBreakerScope; scopeId: string }): Promise<boolean> {
    const breaker = await this.getBreakerStatus(params);
    return breaker?.state === 'OPEN' || breaker?.state === 'HALF_OPEN';
  }

  private mapScopeToPolicyScope(scope: CircuitBreakerScope): RiskPolicyScope {
    switch (scope) {
      case CircuitBreakerScope.SYMBOL:
        return RiskPolicyScope.TENANT;
      case CircuitBreakerScope.STRATEGY:
        return RiskPolicyScope.STRATEGY;
      case CircuitBreakerScope.TRADER:
        return RiskPolicyScope.TRADER;
      case CircuitBreakerScope.ACCOUNT:
        return RiskPolicyScope.TENANT;
      case CircuitBreakerScope.TENANT:
        return RiskPolicyScope.TENANT;
      case CircuitBreakerScope.VENUE:
        return RiskPolicyScope.TENANT;
      case CircuitBreakerScope.PLATFORM:
        return RiskPolicyScope.PLATFORM;
      default:
        return RiskPolicyScope.TENANT;
    }
  }
}
