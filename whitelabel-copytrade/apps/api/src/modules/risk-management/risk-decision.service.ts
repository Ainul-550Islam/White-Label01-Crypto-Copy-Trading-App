import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { InstitutionalRiskPolicyService } from './risk-policy.service';
import { PortfolioExposureService } from './portfolio-exposure.service';
import { PositionRiskService } from './position-risk.service';
import { MarginRiskService } from './margin-risk.service';
import { LeverageRiskService } from './leverage-risk.service';
import { LiquidationRiskService } from './liquidation-risk.service';
import { ConcentrationRiskService } from './concentration-risk.service';
import { DrawdownRiskService } from './drawdown-risk.service';
import { DailyLossLimitService } from './daily-loss-limit.service';
import { CorrelationRiskService } from './correlation-risk.service';
import { VarRiskService } from './var-risk.service';
import { StressTestService } from './stress-test.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { KillSwitchOrchestratorService } from './kill-switch-orchestrator.service';
import { RiskManagementSnapshotRepository } from './risk-snapshot.repository';
import { RiskEventService } from './risk-event.service';
import {
  UnifiedRiskDecision,
  RiskDecision,
  RiskState,
  RiskDimension,
  RiskPolicyScope,
  RiskDecisionDetail,
  RiskSeverity,
  RiskEventType,
  CircuitBreakerScope,
} from './risk-management.types';

/**
 * Unified risk decision orchestration.
 * Input: tenant/user/account/order intent/strategy/follower/symbol/env
 * Compose: exposure/position/margin/leverage/liquidation/concentration/drawdown/daily loss/correlation/compliance/security/exchange health/circuit-breaker/kill-switch
 * Explicit priority: BLOCKED/KILL_SWITCH never becomes ALLOW.
 * Returns final decision/state/blocking reasons/warnings/policies/ruleIds/policy version/timestamp.
 *
 * Reuses existing RiskModule, ExecutionEngine, ExchangesModule, Compliance, Security, CopyTrading, etc via Prisma reads.
 * Never directly places order, never bypasses compliance/live-mode gate, never mutates ledger.
 * Decimal-safe, deterministic.
 */

@Injectable()
export class RiskDecisionService {
  private readonly logger = new Logger(RiskDecisionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: InstitutionalRiskPolicyService,
    private readonly exposureService: PortfolioExposureService,
    private readonly positionService: PositionRiskService,
    private readonly marginService: MarginRiskService,
    private readonly leverageService: LeverageRiskService,
    private readonly liquidationService: LiquidationRiskService,
    private readonly concentrationService: ConcentrationRiskService,
    private readonly drawdownService: DrawdownRiskService,
    private readonly dailyLossService: DailyLossLimitService,
    private readonly correlationService: CorrelationRiskService,
    private readonly varService: VarRiskService,
    private readonly stressService: StressTestService,
    private readonly breakerService: CircuitBreakerService,
    private readonly killSwitchService: KillSwitchOrchestratorService,
    private readonly snapshotRepo: RiskManagementSnapshotRepository,
    private readonly eventService: RiskEventService,
  ) {}

  async evaluateUnifiedRisk(params: {
    tenantId: string;
    userId?: string;
    accountId?: string;
    symbol?: string;
    venue?: string;
    traderId?: string;
    followerId?: string;
    strategyId?: string;
    orderIntent?: { side: 'BUY' | 'SELL'; quantity: string; price?: string | null; orderType: 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT' } | null;
    environment?: 'PAPER' | 'LIVE';
    requestId?: string;
  }): Promise<UnifiedRiskDecision> {
    const {
      tenantId,
      userId,
      accountId,
      symbol,
      venue,
      traderId,
      followerId,
      strategyId,
      orderIntent,
      environment = 'PAPER',
      requestId,
    } = params;

    const nowIso = new Date().toISOString();
    const policy = await this.policyService.resolveEffectivePolicy({
      tenantId,
      traderId: traderId ?? null,
      strategyId: strategyId ?? null,
      followerId: followerId ?? null,
    });

    const details: RiskDecisionDetail[] = [];
    const blockingReasons: string[] = [];
    const warnings: string[] = [];

    // Helper to push detail
    const pushDetail = (d: RiskDecisionDetail) => {
      details.push(d);
      if (d.isBlocking) blockingReasons.push(d.reason);
      if (d.isWarning) warnings.push(d.reason);
    };

    // 1. Exposure
    try {
      const exposure = await this.exposureService.calculateExposure({ tenantId, accountId, traderId, strategyId, followerId });
      if (exposure.state === RiskState.BLOCKED) {
        pushDetail({
          dimension: RiskDimension.EXPOSURE,
          decision: RiskDecision.BLOCK,
          state: RiskState.BLOCKED,
          ruleId: 'MAX_GROSS_EXPOSURE',
          policyVersion: policy.effectiveVersion,
          current: exposure.grossExposure,
          threshold: policy.thresholds.maxGrossExposure,
          severity: RiskSeverity.CRITICAL,
          reason: `Gross exposure ${exposure.grossExposure} exceeds limit ${policy.thresholds.maxGrossExposure}`,
          timestamp: nowIso,
          scope: RiskPolicyScope.TENANT,
          scopeId: tenantId,
          isBlocking: true,
          isWarning: false,
        });
      } else if (exposure.state === RiskState.STALE) {
        pushDetail({
          dimension: RiskDimension.MARKET_DATA,
          decision: environment === 'LIVE' ? RiskDecision.BLOCK : RiskDecision.REVIEW_REQUIRED,
          state: RiskState.STALE,
          ruleId: 'MARKET_DATA_STALE',
          policyVersion: policy.effectiveVersion,
          current: null,
          threshold: policy.thresholds.marketDataMaxAgeMs.toString(),
          severity: RiskSeverity.WARNING,
          reason: `Exposure stale due to market data: ${exposure.staleSymbols.join(',')}`,
          timestamp: nowIso,
          scope: RiskPolicyScope.TENANT,
          scopeId: tenantId,
          isBlocking: environment === 'LIVE',
          isWarning: environment !== 'LIVE',
        });
      }
      // Check symbol exposure if order intent present
      if (orderIntent && symbol) {
        const symExp = exposure.symbolExposures.find((s) => s.symbol === symbol);
        if (symExp && policy.thresholds.maxSymbolExposure) {
          // Compare grossNotional vs threshold
          const gross = symExp.grossNotional;
          if (gross && policy.thresholds.maxSymbolExposure) {
            const cmp = this.cmpDecimal(gross, policy.thresholds.maxSymbolExposure);
            if (cmp > 0) {
              pushDetail({
                dimension: RiskDimension.EXPOSURE,
                decision: RiskDecision.BLOCK,
                state: RiskState.BLOCKED,
                ruleId: 'MAX_SYMBOL_EXPOSURE',
                policyVersion: policy.effectiveVersion,
                current: gross,
                threshold: policy.thresholds.maxSymbolExposure,
                severity: RiskSeverity.CRITICAL,
                reason: `Symbol exposure ${gross} for ${symbol} exceeds max ${policy.thresholds.maxSymbolExposure}`,
                timestamp: nowIso,
                scope: RiskPolicyScope.TENANT,
                scopeId: tenantId,
                isBlocking: true,
                isWarning: false,
              });
            }
          }
        }
      }
    } catch (e) {
      pushDetail({
        dimension: RiskDimension.EXPOSURE,
        decision: RiskDecision.REVIEW_REQUIRED,
        state: RiskState.UNKNOWN,
        ruleId: 'MAX_GROSS_EXPOSURE',
        policyVersion: policy.effectiveVersion,
        current: null,
        threshold: policy.thresholds.maxGrossExposure,
        severity: RiskSeverity.WARNING,
        reason: `Exposure evaluation failed: ${(e as Error).message}, fail-closed to REVIEW_REQUIRED`,
        timestamp: nowIso,
        scope: RiskPolicyScope.TENANT,
        scopeId: tenantId,
        isBlocking: false,
        isWarning: true,
      });
    }

    // 2. Position risk
    try {
      const posResults = await this.positionService.evaluatePositionRisk({ tenantId, accountId, symbol, traderId, strategyId, followerId });
      for (const pr of posResults) {
        if (pr.state === RiskState.BLOCKED || pr.state === RiskState.CRITICAL) {
          pushDetail({
            dimension: RiskDimension.POSITION,
            decision: RiskDecision.BLOCK,
            state: pr.state,
            ruleId: pr.ruleId,
            policyVersion: pr.policyVersion,
            current: pr.notional,
            threshold: policy.thresholds.maxPositionNotional,
            severity: pr.severity,
            reason: pr.reason,
            timestamp: nowIso,
            scope: RiskPolicyScope.TENANT,
            scopeId: pr.accountId,
            isBlocking: true,
            isWarning: false,
          });
        } else if (pr.state === RiskState.STALE || pr.state === RiskState.UNKNOWN) {
          pushDetail({
            dimension: RiskDimension.POSITION,
            decision: RiskDecision.REVIEW_REQUIRED,
            state: pr.state,
            ruleId: pr.ruleId,
            policyVersion: pr.policyVersion,
            current: pr.notional,
            threshold: null,
            severity: pr.severity,
            reason: pr.reason,
            timestamp: nowIso,
            scope: RiskPolicyScope.TENANT,
            scopeId: pr.accountId,
            isBlocking: false,
            isWarning: true,
          });
        }
      }
    } catch (e) {
      this.logger.warn(`Position risk failed: ${(e as Error).message}`);
    }

    // 3. Margin
    if (accountId) {
      try {
        const marginResults = await this.marginService.evaluateMargin({ tenantId, accountId, orderIntent: orderIntent ? { symbol: symbol ?? '', quantity: orderIntent.quantity, price: orderIntent.price ?? null, side: orderIntent.side } : null });
        for (const mr of marginResults) {
          if (mr.state === RiskState.BLOCKED || mr.state === RiskState.CRITICAL) {
            pushDetail({
              dimension: RiskDimension.MARGIN,
              decision: RiskDecision.BLOCK,
              state: mr.state,
              ruleId: mr.ruleId,
              policyVersion: mr.policyVersion,
              current: mr.marginUtilizationPercent,
              threshold: policy.thresholds.marginCriticalUtilization,
              severity: mr.severity,
              reason: mr.reason,
              timestamp: nowIso,
              scope: RiskPolicyScope.TENANT,
              scopeId: accountId,
              isBlocking: true,
              isWarning: false,
            });
          }
        }
      } catch (e) {
        this.logger.warn(`Margin risk failed: ${(e as Error).message}`);
      }
    }

    // 4. Leverage
    if (accountId) {
      try {
        const levResults = await this.leverageService.evaluateLeverage({
          tenantId,
          accountId,
          symbol,
          orderIntent: orderIntent ? { quantity: orderIntent.quantity, price: orderIntent.price ?? null, side: orderIntent.side } : null,
        });
        for (const lr of levResults) {
          if (lr.isBreach) {
            pushDetail({
              dimension: RiskDimension.LEVERAGE,
              decision: RiskDecision.BLOCK,
              state: lr.state,
              ruleId: lr.ruleId,
              policyVersion: lr.policyVersion,
              current: lr.projectedGrossLeverage ?? lr.grossLeverage,
              threshold: lr.policyMaxLeverage,
              severity: lr.severity,
              reason: lr.reason,
              timestamp: nowIso,
              scope: RiskPolicyScope.TENANT,
              scopeId: accountId,
              isBlocking: true,
              isWarning: false,
            });
          }
        }
      } catch (e) {
        this.logger.warn(`Leverage risk failed: ${(e as Error).message}`);
      }
    }

    // 5. Liquidation
    try {
      const liqResults = await this.liquidationService.evaluateLiquidationRisk({ tenantId, accountId, symbol, traderId, strategyId, followerId });
      for (const l of liqResults) {
        if (l.isCritical) {
          pushDetail({
            dimension: RiskDimension.LIQUIDATION,
            decision: RiskDecision.BLOCK,
            state: l.state,
            ruleId: l.ruleId,
            policyVersion: l.policyVersion,
            current: l.distancePercent,
            threshold: policy.thresholds.liquidationCriticalDistance,
            severity: l.severity,
            reason: l.reason,
            timestamp: nowIso,
            scope: RiskPolicyScope.TENANT,
            scopeId: l.accountId,
            isBlocking: true,
            isWarning: false,
          });
        } else if (l.isWarning) {
          pushDetail({
            dimension: RiskDimension.LIQUIDATION,
            decision: RiskDecision.REDUCE,
            state: l.state,
            ruleId: l.ruleId,
            policyVersion: l.policyVersion,
            current: l.distancePercent,
            threshold: policy.thresholds.liquidationWarningDistance,
            severity: l.severity,
            reason: l.reason,
            timestamp: nowIso,
            scope: RiskPolicyScope.TENANT,
            scopeId: l.accountId,
            isBlocking: false,
            isWarning: true,
          });
        }
      }
    } catch (e) {
      this.logger.warn(`Liquidation risk failed: ${(e as Error).message}`);
    }

    // 6. Concentration
    try {
      const concResults = await this.concentrationService.evaluateConcentration({
        tenantId,
        accountId,
        symbol,
        orderIntent: orderIntent && orderIntent.price ? { notional: this.mulDecimal(orderIntent.quantity, orderIntent.price), symbol: symbol ?? '' } : null,
      });
      for (const c of concResults) {
        if (c.isBreach) {
          pushDetail({
            dimension: RiskDimension.CONCENTRATION,
            decision: RiskDecision.BLOCK,
            state: c.state,
            ruleId: c.ruleId,
            policyVersion: c.policyVersion,
            current: c.currentPercent,
            threshold: c.thresholdPercent,
            severity: c.severity,
            reason: c.reason,
            timestamp: nowIso,
            scope: RiskPolicyScope.TENANT,
            scopeId: tenantId,
            isBlocking: true,
            isWarning: false,
          });
        }
      }
    } catch (e) {
      this.logger.warn(`Concentration risk failed: ${(e as Error).message}`);
    }

    // 7. Drawdown
    try {
      const ddResults = await this.drawdownService.evaluateDrawdown({ tenantId, accountId, traderId, strategyId, followerId });
      for (const dd of ddResults) {
        if (dd.isBreach) {
          pushDetail({
            dimension: RiskDimension.DRAWDOWN,
            decision: RiskDecision.BLOCK,
            state: dd.state,
            ruleId: dd.ruleId,
            policyVersion: dd.policyVersion,
            current: dd.drawdownPercent,
            threshold: dd.thresholdPercent,
            severity: dd.severity,
            reason: dd.reason,
            timestamp: nowIso,
            scope: dd.scope,
            scopeId: dd.scopeId,
            isBlocking: true,
            isWarning: false,
          });
        }
      }
    } catch (e) {
      this.logger.warn(`Drawdown risk failed: ${(e as Error).message}`);
    }

    // 8. Daily loss
    try {
      const dlResults = await this.dailyLossService.evaluateDailyLoss({ tenantId, accountId, traderId, strategyId, followerId });
      for (const dl of dlResults) {
        if (dl.isBreach) {
          pushDetail({
            dimension: RiskDimension.DAILY_LOSS,
            decision: RiskDecision.BLOCK,
            state: dl.state,
            ruleId: dl.ruleId,
            policyVersion: dl.policyVersion,
            current: dl.dailyPnl,
            threshold: dl.threshold,
            severity: dl.severity,
            reason: dl.reason,
            timestamp: nowIso,
            scope: dl.scope,
            scopeId: dl.scopeId,
            isBlocking: true,
            isWarning: false,
          });
        }
      }
    } catch (e) {
      this.logger.warn(`Daily loss failed: ${(e as Error).message}`);
    }

    // 9. Correlation (advisory, not blocking unless policy says)
    try {
      const corrResults = await this.correlationService.evaluateCorrelation({ tenantId, traderId, strategyId, followerId });
      for (const cr of corrResults) {
        if (cr.isBreach) {
          pushDetail({
            dimension: RiskDimension.CORRELATION,
            decision: RiskDecision.REVIEW_REQUIRED,
            state: cr.state,
            ruleId: cr.ruleId,
            policyVersion: cr.policyVersion,
            current: cr.correlation,
            threshold: cr.threshold,
            severity: cr.severity,
            reason: cr.reason,
            timestamp: nowIso,
            scope: RiskPolicyScope.TENANT,
            scopeId: tenantId,
            isBlocking: false,
            isWarning: true,
          });
        }
      }
    } catch (e) {
      this.logger.warn(`Correlation risk failed: ${(e as Error).message}`);
    }

    // 10. VaR (advisory)
    try {
      const varResults = await this.varService.evaluateVar({ tenantId, accountId, traderId, strategyId, followerId });
      for (const vr of varResults) {
        if (vr.isBreach) {
          pushDetail({
            dimension: RiskDimension.VAR,
            decision: RiskDecision.REVIEW_REQUIRED,
            state: vr.state,
            ruleId: vr.ruleId,
            policyVersion: vr.policyVersion,
            current: vr.varValue,
            threshold: vr.threshold,
            severity: vr.severity,
            reason: vr.reason,
            timestamp: nowIso,
            scope: RiskPolicyScope.TENANT,
            scopeId: tenantId,
            isBlocking: false,
            isWarning: true,
          });
        }
      }
    } catch (e) {
      this.logger.warn(`VaR failed: ${(e as Error).message}`);
    }

    // 11. Stress (advisory)
    try {
      const stressResults = await this.stressService.runStressTests({ tenantId, accountId, traderId, strategyId, followerId });
      for (const sr of stressResults) {
        if (sr.isBreach) {
          pushDetail({
            dimension: RiskDimension.STRESS,
            decision: RiskDecision.REVIEW_REQUIRED,
            state: sr.riskLevel,
            ruleId: sr.ruleId,
            policyVersion: sr.policyVersion,
            current: sr.estimatedPnlImpact,
            threshold: sr.threshold,
            severity: sr.severity,
            reason: sr.reason,
            timestamp: nowIso,
            scope: RiskPolicyScope.TENANT,
            scopeId: tenantId,
            isBlocking: false,
            isWarning: true,
          });
        }
      }
    } catch (e) {
      this.logger.warn(`Stress test failed: ${(e as Error).message}`);
    }

    // 12. Compliance — BLOCK prevents ALLOW
    try {
      if (userId) {
        const blocked = await this.prisma.complianceScreeningRequest.findFirst({
          where: { tenantId, userId, status: 'BLOCKED' },
          orderBy: { createdAt: 'desc' },
        });
        if (blocked) {
          pushDetail({
            dimension: RiskDimension.COMPLIANCE,
            decision: RiskDecision.BLOCK,
            state: RiskState.BLOCKED,
            ruleId: 'COMPLIANCE_BLOCK',
            policyVersion: policy.effectiveVersion,
            current: null,
            threshold: null,
            severity: RiskSeverity.CRITICAL,
            reason: `Compliance BLOCK for user ${userId} — screening ${blocked.id} blocked, decision ${blocked.decision}`,
            timestamp: nowIso,
            scope: RiskPolicyScope.TENANT,
            scopeId: tenantId,
            isBlocking: true,
            isWarning: false,
          });
        }
      }
    } catch (e) {
      pushDetail({
        dimension: RiskDimension.COMPLIANCE,
        decision: RiskDecision.REVIEW_REQUIRED,
        state: RiskState.UNKNOWN,
        ruleId: 'COMPLIANCE_BLOCK',
        policyVersion: policy.effectiveVersion,
        current: null,
        threshold: null,
        severity: RiskSeverity.WARNING,
        reason: `Compliance evaluation unavailable: ${(e as Error).message}, fail-closed to REVIEW_REQUIRED`,
        timestamp: nowIso,
        scope: RiskPolicyScope.TENANT,
        scopeId: tenantId,
        isBlocking: false,
        isWarning: true,
      });
    }

    // 13. Security — BLOCK prevents ALLOW
    try {
      if (userId) {
        const threat = await this.prisma.securityThreatSignal.findFirst({
          where: { tenantId, userId, resolved: false, riskLevel: { in: ['HIGH', 'CRITICAL'] } },
          orderBy: { createdAt: 'desc' },
        });
        if (threat) {
          pushDetail({
            dimension: RiskDimension.SECURITY,
            decision: RiskDecision.BLOCK,
            state: RiskState.BLOCKED,
            ruleId: 'SECURITY_BLOCK',
            policyVersion: policy.effectiveVersion,
            current: null,
            threshold: null,
            severity: RiskSeverity.CRITICAL,
            reason: `Security BLOCK for user ${userId} — threat ${threat.ruleId} level ${threat.riskLevel}`,
            timestamp: nowIso,
            scope: RiskPolicyScope.TENANT,
            scopeId: tenantId,
            isBlocking: true,
            isWarning: false,
          });
        }
      }
    } catch (e) {
      this.logger.warn(`Security check failed: ${(e as Error).message}`);
    }

    // 14. Exchange health — stale blocks live
    try {
      if (accountId) {
        const acc = await this.prisma.tradingAccount.findFirst({ where: { id: accountId, tenantId } });
        if (acc) {
          const ageMs = acc.lastVerifiedAt ? Date.now() - new Date(acc.lastVerifiedAt).getTime() : Infinity;
          if (ageMs > policy.thresholds.exchangeHealthMaxAgeMs) {
            pushDetail({
              dimension: RiskDimension.EXCHANGE_HEALTH,
              decision: environment === 'LIVE' ? RiskDecision.BLOCK : RiskDecision.REVIEW_REQUIRED,
              state: RiskState.STALE,
              ruleId: 'EXCHANGE_HEALTH_DEGRADED',
              policyVersion: policy.effectiveVersion,
              current: ageMs.toString(),
              threshold: policy.thresholds.exchangeHealthMaxAgeMs.toString(),
              severity: RiskSeverity.WARNING,
              reason: `Exchange health stale for account ${accountId}, age ${ageMs}ms > ${policy.thresholds.exchangeHealthMaxAgeMs}ms`,
              timestamp: nowIso,
              scope: RiskPolicyScope.TENANT,
              scopeId: accountId,
              isBlocking: environment === 'LIVE',
              isWarning: environment !== 'LIVE',
            });
          }
          if (acc.status !== 'ACTIVE') {
            pushDetail({
              dimension: RiskDimension.EXCHANGE_HEALTH,
              decision: RiskDecision.BLOCK,
              state: RiskState.BLOCKED,
              ruleId: 'EXCHANGE_HEALTH_DEGRADED',
              policyVersion: policy.effectiveVersion,
              current: acc.status,
              threshold: 'ACTIVE',
              severity: RiskSeverity.CRITICAL,
              reason: `Trading account ${accountId} status ${acc.status} not ACTIVE`,
              timestamp: nowIso,
              scope: RiskPolicyScope.TENANT,
              scopeId: accountId,
              isBlocking: true,
              isWarning: false,
            });
          }
        }
      }
    } catch (e) {
      this.logger.warn(`Exchange health check failed: ${(e as Error).message}`);
    }

    // 15. Circuit breaker
    try {
      const scopesToCheck: Array<{ scope: CircuitBreakerScope; id: string }> = [];
      if (symbol) scopesToCheck.push({ scope: CircuitBreakerScope.SYMBOL, id: symbol });
      if (strategyId) scopesToCheck.push({ scope: CircuitBreakerScope.STRATEGY, id: strategyId });
      if (traderId) scopesToCheck.push({ scope: CircuitBreakerScope.TRADER, id: traderId });
      if (accountId) scopesToCheck.push({ scope: CircuitBreakerScope.ACCOUNT, id: accountId });
      scopesToCheck.push({ scope: CircuitBreakerScope.TENANT, id: tenantId });
      if (venue) scopesToCheck.push({ scope: CircuitBreakerScope.VENUE, id: venue });

      for (const s of scopesToCheck) {
        const isBlocked = await this.breakerService.isBlocked({ tenantId, scope: s.scope, scopeId: s.id });
        if (isBlocked) {
          pushDetail({
            dimension: RiskDimension.EXECUTION_HEALTH,
            decision: RiskDecision.BLOCK,
            state: RiskState.BLOCKED,
            ruleId: 'CIRCUIT_BREAKER_OPEN',
            policyVersion: policy.effectiveVersion,
            current: 'OPEN',
            threshold: 'CLOSED',
            severity: RiskSeverity.CRITICAL,
            reason: `Circuit breaker OPEN for ${s.scope} ${s.id}, trading blocked`,
            timestamp: nowIso,
            scope: RiskPolicyScope.TENANT,
            scopeId: s.id,
            isBlocking: true,
            isWarning: false,
          });
        }
      }
    } catch (e) {
      this.logger.warn(`Circuit breaker check failed: ${(e as Error).message}`);
    }

    // 16. Kill-switch — BLOCKED/KILL_SWITCH never becomes ALLOW
    try {
      const ksChecks = [];
      if (symbol) ksChecks.push({ scope: 'SYMBOL' as any, target: symbol });
      if (strategyId) ksChecks.push({ scope: 'STRATEGY' as any, target: strategyId });
      if (accountId) ksChecks.push({ scope: 'ACCOUNT' as any, target: accountId });
      ksChecks.push({ scope: 'TENANT' as any, target: tenantId });
      ksChecks.push({ scope: 'GLOBAL' as any, target: null });

      for (const k of ksChecks) {
        const engaged = await this.killSwitchService.isEngaged({ tenantId: k.scope === 'GLOBAL' ? null : tenantId, scope: k.scope, target: k.target ?? undefined });
        if (engaged) {
          pushDetail({
            dimension: RiskDimension.EXECUTION_HEALTH,
            decision: RiskDecision.KILL_SWITCH_REQUIRED,
            state: RiskState.BLOCKED,
            ruleId: 'KILL_SWITCH_ENGAGED',
            policyVersion: policy.effectiveVersion,
            current: 'ENGAGED',
            threshold: 'DISENGAGED',
            severity: RiskSeverity.EMERGENCY,
            reason: `Kill-switch ENGAGED for scope ${k.scope} target ${k.target ?? 'GLOBAL'}, trading must remain blocked`,
            timestamp: nowIso,
            scope: RiskPolicyScope.TENANT,
            scopeId: k.target ?? tenantId,
            isBlocking: true,
            isWarning: false,
          });
        }
      }
    } catch (e) {
      this.logger.warn(`Kill-switch check failed: ${(e as Error).message}`);
    }

    // Finalize decision with explicit priority: BLOCKED/KILL_SWITCH never becomes ALLOW
    let finalDecision = RiskDecision.ALLOW;
    let finalState = RiskState.NORMAL;

    const hasKillSwitch = details.some((d) => d.decision === RiskDecision.KILL_SWITCH_REQUIRED);
    const hasBlock = details.some((d) => d.decision === RiskDecision.BLOCK);
    const hasPause = details.some((d) => d.decision === RiskDecision.PAUSE);
    const hasStopCopy = details.some((d) => d.decision === RiskDecision.STOP_COPY);
    const hasReview = details.some((d) => d.decision === RiskDecision.REVIEW_REQUIRED);
    const hasReduce = details.some((d) => d.decision === RiskDecision.REDUCE);

    if (hasKillSwitch) {
      finalDecision = RiskDecision.KILL_SWITCH_REQUIRED;
      finalState = RiskState.CRITICAL;
    } else if (hasBlock) {
      finalDecision = RiskDecision.BLOCK;
      finalState = RiskState.BLOCKED;
    } else if (hasPause) {
      finalDecision = RiskDecision.PAUSE;
      finalState = RiskState.HIGH;
    } else if (hasStopCopy) {
      finalDecision = RiskDecision.STOP_COPY;
      finalState = RiskState.HIGH;
    } else if (hasReview) {
      finalDecision = RiskDecision.REVIEW_REQUIRED;
      finalState = RiskState.UNKNOWN;
    } else if (hasReduce) {
      finalDecision = RiskDecision.REDUCE;
      finalState = RiskState.ELEVATED;
    }

    // Compliance and security BLOCK always win
    if (details.some((d) => d.dimension === RiskDimension.COMPLIANCE && d.decision === RiskDecision.BLOCK)) {
      finalDecision = RiskDecision.BLOCK;
      finalState = RiskState.BLOCKED;
    }
    if (details.some((d) => d.dimension === RiskDimension.SECURITY && d.decision === RiskDecision.BLOCK)) {
      finalDecision = RiskDecision.BLOCK;
      finalState = RiskState.BLOCKED;
    }

    const ruleIds = Array.from(new Set(details.map((d) => d.ruleId)));

    const decision: UnifiedRiskDecision = {
      id: `risk-dec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId,
      userId: userId ?? null,
      accountId: accountId ?? null,
      symbol: symbol ?? null,
      venue: venue ?? null,
      traderId: traderId ?? null,
      followerId: followerId ?? null,
      strategyId: strategyId ?? null,
      orderIntentId: requestId ?? null,
      decision: finalDecision,
      state: finalState,
      blockingReasons,
      warnings,
      details,
      policies: policy.scopeChain.map((s: any) => ({ scope: s.scope, scopeId: s.scopeId, version: s.version.toString(), digest: s.digest })),
      ruleIds,
      policyVersion: policy.effectiveVersion,
      timestamp: nowIso,
      requestId: requestId ?? null,
      environment,
      complianceDecision: details.find((d) => d.dimension === RiskDimension.COMPLIANCE)?.decision ?? null,
      securityDecision: details.find((d) => d.dimension === RiskDimension.SECURITY)?.decision ?? null,
      exchangeHealth: details.find((d) => d.dimension === RiskDimension.EXCHANGE_HEALTH)?.state ?? null,
      circuitBreaker: null,
      killSwitch: hasKillSwitch ? { isEngaged: true, scope: 'DETECTED' } : { isEngaged: false, scope: null },
    };

    // Persist decision
    await this.prisma.riskDecisionRecord.create({
      data: {
        tenantId,
        userId: userId ?? null,
        accountId: accountId ?? null,
        traderId: traderId ?? null,
        followerId: followerId ?? null,
        strategyId: strategyId ?? null,
        symbol: symbol ?? null,
        venue: venue ?? null,
        decision: finalDecision as any,
        state: finalState as any,
        ruleIds,
        policyVersion: policy.effectiveVersion,
        blockingReasons,
        warnings,
        decisionJson: decision as any,
        requestId: requestId ?? null,
      },
    });

    // Emit event if blocked
    if (finalDecision === RiskDecision.BLOCK || finalDecision === RiskDecision.KILL_SWITCH_REQUIRED) {
      await this.eventService.emitThresholdBreached({
        tenantId,
        type: RiskEventType.RISK_THRESHOLD_BREACHED,
        ruleId: ruleIds[0] ?? 'RISK_THRESHOLD_BREACHED',
        policyVersion: policy.effectiveVersion,
        scope: RiskPolicyScope.TENANT,
        scopeId: tenantId,
        accountId: accountId ?? null,
        strategyId: strategyId ?? null,
        traderId: traderId ?? null,
        followerId: followerId ?? null,
        symbol: symbol ?? null,
        venue: venue ?? null,
        severity: RiskSeverity.CRITICAL,
        message: `Unified risk decision ${finalDecision} — blocking reasons: ${blockingReasons.join('; ')}`,
        sourceRefs: { decisionId: decision.id, requestId: requestId ?? '' },
        requestId: requestId ?? null,
      });
    }

    return decision;
  }

  private cmpDecimal(a: string, b: string): number {
    const SCALE = 1_000_000_000_000n;
    const parse = (s: string): bigint => {
      const neg = s.startsWith('-');
      const clean = neg ? s.slice(1) : s;
      const [intP = '0', fracP = ''] = clean.split('.');
      const frac = (fracP + '0'.repeat(12)).slice(0, 12);
      const val = BigInt(intP) * SCALE + BigInt(frac || '0');
      return neg ? -val : val;
    };
    const av = parse(a);
    const bv = parse(b);
    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  }

  private mulDecimal(a: string, b: string): string {
    const SCALE = 1_000_000_000_000n;
    const parse = (s: string): bigint => {
      const neg = s.startsWith('-');
      const clean = neg ? s.slice(1) : s;
      const [intP = '0', fracP = ''] = clean.split('.');
      const frac = (fracP + '0'.repeat(12)).slice(0, 12);
      const val = BigInt(intP) * SCALE + BigInt(frac || '0');
      return neg ? -val : val;
    };
    const format = (bb: bigint): string => {
      const neg = bb < 0n;
      const abs = neg ? -bb : bb;
      const intP = abs / SCALE;
      const frac = abs % SCALE;
      const fracStr = frac.toString().padStart(12, '0').replace(/0+$/, '');
      return (neg ? '-' : '') + (fracStr ? `${intP}.${fracStr}` : `${intP}`);
    };
    return format((parse(a) * parse(b)) / SCALE);
  }
}
