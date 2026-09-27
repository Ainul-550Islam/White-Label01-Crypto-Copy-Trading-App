import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RiskEvent, RiskEventType, RiskSeverity, RiskPolicyScope } from './risk-management.types';

/**
 * Risk event emission for all threshold breaches.
 * Events: RISK_THRESHOLD_BREACHED, EXPOSURE_LIMIT_BREACHED, MARGIN_WARNING, LIQUIDATION_WARNING,
 * LEVERAGE_LIMIT_BREACHED, CONCENTRATION_BREACH, DRAWDOWN_BREACH, DAILY_LOSS_BREACH, CORRELATION_WARNING,
 * VAR_BREACH, STRESS_BREACH, MARKET_DATA_STALE, EXCHANGE_HEALTH_DEGRADED, EXECUTION_FAILURE_BURST,
 * CIRCUIT_BREAKER_TRIGGERED, KILL_SWITCH_REQUESTED.
 *
 * Includes ruleId/policyVersion/tenant/scope/source refs/timestamp, auditable.
 */

@Injectable()
export class RiskEventService {
  private readonly logger = new Logger(RiskEventService.name);

  constructor(private readonly prisma: PrismaService) {}

  async emitEvent(event: RiskEvent): Promise<{ id: string }> {
    // Persist to RiskEvent table (existing) for compatibility plus new audit
    const dedupeKey = `${event.type}:${event.ruleId}:${event.scope}:${event.scopeId ?? ''}:${event.symbol ?? ''}:${event.tenantId}:${event.policyVersion}`.slice(0, 64);

    try {
      const created = await this.prisma.riskEvent.create({
        data: {
          tenantId: event.tenantId,
          accountId: event.accountId ?? undefined,
          strategyId: event.strategyId ?? undefined,
          eventType: this.mapEventType(event.type),
          severity: event.severity as any,
          code: event.ruleId,
          message: event.message.slice(0, 1000),
          limitValue: event.threshold?.slice(0, 64) ?? null,
          observedValue: event.current?.slice(0, 64) ?? null,
          venue: event.venue as any,
          symbol: event.symbol ?? null,
          ruleId: event.ruleId,
          scope: event.scope,
          scopeTarget: event.scopeId ?? null,
          source: event.sourceRefs ? JSON.stringify(event.sourceRefs).slice(0, 64) : 'RISK_MANAGEMENT',
          isSimulated: false,
          dedupeKey,
          metadata: {
            policyVersion: event.policyVersion,
            sourceRefs: event.sourceRefs,
            traderId: event.traderId,
            followerId: event.followerId,
            requestId: event.requestId,
            type: event.type,
          } as any,
        },
      });

      // Also audit log
      await this.prisma.auditLog.create({
        data: {
          tenantId: event.tenantId,
          actorType: 'SYSTEM',
          action: `RISK_EVENT_${event.type}`,
          resourceType: 'RISK_EVENT',
          resourceId: created.id,
          description: `${event.type} ${event.ruleId} ${event.message}`.slice(0, 500),
          metadata: {
            ruleId: event.ruleId,
            policyVersion: event.policyVersion,
            severity: event.severity,
            scope: event.scope,
            scopeId: event.scopeId,
            current: event.current,
            threshold: event.threshold,
            sourceRefs: event.sourceRefs,
          } as any,
        },
      });

      this.logger.log(`Risk event ${event.type} ${event.ruleId} tenant ${event.tenantId} scope ${event.scope} ${event.scopeId ?? ''}`);
      return { id: created.id };
    } catch (e: any) {
      // Dedupe collision: if dedupeKey exists, fetch existing
      if (e.code === 'P2002') {
        const existing = await this.prisma.riskEvent.findFirst({
          where: { tenantId: event.tenantId, dedupeKey },
        });
        if (existing) return { id: existing.id };
      }
      throw e;
    }
  }

  async emitThresholdBreached(params: {
    tenantId: string;
    type: RiskEventType;
    ruleId: string;
    policyVersion: string;
    scope: RiskPolicyScope;
    scopeId?: string | null;
    accountId?: string | null;
    strategyId?: string | null;
    traderId?: string | null;
    followerId?: string | null;
    symbol?: string | null;
    venue?: string | null;
    severity: RiskSeverity;
    message: string;
    current?: string | null;
    threshold?: string | null;
    sourceRefs?: Record<string, string>;
    requestId?: string | null;
  }): Promise<{ id: string }> {
    const event: RiskEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId: params.tenantId,
      type: params.type,
      ruleId: params.ruleId,
      policyVersion: params.policyVersion,
      scope: params.scope,
      scopeId: params.scopeId ?? null,
      accountId: params.accountId ?? null,
      strategyId: params.strategyId ?? null,
      traderId: params.traderId ?? null,
      followerId: params.followerId ?? null,
      symbol: params.symbol ?? null,
      venue: params.venue ?? null,
      severity: params.severity,
      message: params.message,
      current: params.current ?? null,
      threshold: params.threshold ?? null,
      sourceRefs: params.sourceRefs ?? {},
      timestamp: new Date().toISOString(),
      requestId: params.requestId ?? null,
    };
    return this.emitEvent(event);
  }

  async getEventsByTenant(tenantId: string, limit = 100): Promise<any[]> {
    return this.prisma.riskEvent.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  private mapEventType(type: RiskEventType): any {
    // Map new event types to existing RiskEventType enum where possible, else fallback to LIMIT_BREACHED
    const mapping: Record<string, string> = {
      RISK_THRESHOLD_BREACHED: 'LIMIT_BREACHED',
      EXPOSURE_LIMIT_BREACHED: 'LIMIT_BREACHED',
      MARGIN_WARNING: 'LIMIT_BREACHED',
      LIQUIDATION_WARNING: 'LIMIT_BREACHED',
      LEVERAGE_LIMIT_BREACHED: 'LIMIT_BREACHED',
      CONCENTRATION_BREACH: 'LIMIT_BREACHED',
      DRAWDOWN_BREACH: 'LIMIT_BREACHED',
      DAILY_LOSS_BREACH: 'DAILY_LOSS_BREACHED',
      CORRELATION_WARNING: 'LIMIT_BREACHED',
      VAR_BREACH: 'LIMIT_BREACHED',
      STRESS_BREACH: 'LIMIT_BREACHED',
      MARKET_DATA_STALE: 'STALE_MARKET_DATA',
      EXCHANGE_HEALTH_DEGRADED: 'RISK_STATE_UNAVAILABLE',
      EXECUTION_FAILURE_BURST: 'ORDER_REJECTED',
      CIRCUIT_BREAKER_TRIGGERED: 'KILL_SWITCH_TRIGGERED',
      KILL_SWITCH_REQUESTED: 'KILL_SWITCH_TRIGGERED',
    };
    return mapping[type] ?? 'LIMIT_BREACHED';
  }
}
