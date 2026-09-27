import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { InstitutionalRiskPolicyService } from './risk-policy.service';
import { PortfolioExposureService } from './portfolio-exposure.service';
import { PositionRiskService } from './position-risk.service';
import { MarginRiskService } from './margin-risk.service';
import { LeverageRiskService } from './leverage-risk.service';
import { ConcentrationRiskService } from './concentration-risk.service';
import { DrawdownRiskService } from './drawdown-risk.service';
import { DailyLossLimitService } from './daily-loss-limit.service';
import { RiskDecision, RiskState, RiskSeverity, RiskDimension, RiskPolicyScope, RiskDecisionDetail, UnifiedRiskDecision } from './risk-management.types';

/**
 * Pre-trade order risk flow:
 * Order Intent → Current Portfolio → Projected Portfolio → Exposure → Margin → Leverage → Concentration → Drawdown → Compliance → Security → Exchange Health → Decision
 *
 * Must NOT place order. Returns ALLOW/REDUCE/REVIEW_REQUIRED/BLOCK.
 * Decimal-safe, deterministic ruleId/policyVersion/reason, fail-closed.
 */

function isValidDecimal(v: any): boolean {
  return typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v);
}
const SCALE = 1_000_000_000_000n;
function parseScaled(s: string): bigint {
  const neg = s.startsWith('-');
  const clean = neg ? s.slice(1) : s;
  const [intP = '0', fracP = ''] = clean.split('.');
  const frac = (fracP + '0'.repeat(12)).slice(0, 12);
  const val = BigInt(intP) * SCALE + BigInt(frac || '0');
  return neg ? -val : val;
}
function formatScaled(b: bigint): string {
  const neg = b < 0n;
  const abs = neg ? -b : b;
  const intP = abs / SCALE;
  const frac = abs % SCALE;
  const fracStr = frac.toString().padStart(12, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + (fracStr ? `${intP}.${fracStr}` : `${intP}`);
}
function mul(a: string, b: string): string {
  return formatScaled((parseScaled(a) * parseScaled(b)) / SCALE);
}
function add(a: string, b: string): string {
  return formatScaled(parseScaled(a) + parseScaled(b));
}
function cmp(a: string, b: string): number {
  const av = parseScaled(a);
  const bv = parseScaled(b);
  return av < bv ? -1 : av > bv ? 1 : 0;
}

@Injectable()
export class OrderRiskService {
  private readonly logger = new Logger(OrderRiskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: InstitutionalRiskPolicyService,
    private readonly exposureService: PortfolioExposureService,
    private readonly positionRiskService: PositionRiskService,
    private readonly marginRiskService: MarginRiskService,
    private readonly leverageRiskService: LeverageRiskService,
    private readonly concentrationService: ConcentrationRiskService,
    private readonly drawdownService: DrawdownRiskService,
    private readonly dailyLossService: DailyLossLimitService,
  ) {}

  async checkOrderRisk(params: {
    tenantId: string;
    userId?: string;
    accountId: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: string; // decimal string, validated
    orderType: 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';
    price?: string | null;
    strategyId?: string;
    traderId?: string;
    followerId?: string;
    environment?: 'PAPER' | 'LIVE';
    requestId?: string;
  }): Promise<UnifiedRiskDecision> {
    const {
      tenantId,
      userId,
      accountId,
      symbol,
      side,
      quantity,
      orderType,
      price,
      strategyId,
      traderId,
      followerId,
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

    // 1. Validate order intent basics
    if (!isValidDecimal(quantity) || parseScaled(quantity) <= 0n) {
      const d: RiskDecisionDetail = {
        dimension: RiskDimension.POSITION,
        decision: RiskDecision.BLOCK,
        state: RiskState.BLOCKED,
        ruleId: 'MAX_ORDER_QUANTITY',
        policyVersion: policy.effectiveVersion,
        current: quantity,
        threshold: null,
        severity: RiskSeverity.CRITICAL,
        reason: `Invalid quantity ${quantity}`,
        timestamp: nowIso,
        scope: RiskPolicyScope.TENANT,
        scopeId: accountId,
        isBlocking: true,
        isWarning: false,
      };
      details.push(d);
      blockingReasons.push(d.reason);
      return this.finalizeDecision({
        tenantId,
        userId: userId ?? null,
        accountId,
        symbol,
        traderId: traderId ?? null,
        followerId: followerId ?? null,
        strategyId: strategyId ?? null,
        environment,
        policy,
        details,
        blockingReasons,
        warnings,
        requestId: requestId ?? null,
      });
    }

    // 2. Current portfolio exposure
    const exposure = await this.exposureService.calculateExposure({ tenantId, accountId, traderId, strategyId, followerId });
    if (exposure.state === RiskState.STALE) {
      const d: RiskDecisionDetail = {
        dimension: RiskDimension.MARKET_DATA,
        decision: RiskDecision.REVIEW_REQUIRED,
        state: RiskState.STALE,
        ruleId: 'MARKET_DATA_STALE',
        policyVersion: policy.effectiveVersion,
        current: null,
        threshold: policy.thresholds.marketDataMaxAgeMs.toString(),
        severity: RiskSeverity.WARNING,
        reason: `Market data stale for symbols: ${exposure.staleSymbols.join(',')}`,
        timestamp: nowIso,
        scope: RiskPolicyScope.TENANT,
        scopeId: tenantId,
        isBlocking: false,
        isWarning: true,
      };
      details.push(d);
      warnings.push(d.reason);
      if (environment === 'LIVE') {
        // Stale exchange health blocks live per policy
        d.decision = RiskDecision.BLOCK;
        d.isBlocking = true;
        blockingReasons.push(`Live trading blocked due to stale market data: ${d.reason}`);
      }
    }

    // 3. Projected exposure after order
    let orderNotional: string | null = null;
    if (isValidDecimal(price)) {
      orderNotional = mul(quantity, price!);
    } else if (orderType === 'MARKET') {
      // Use mark price from exposure if available
      const symExp = exposure.symbolExposures.find((s) => s.symbol === symbol);
      if (symExp?.price && isValidDecimal(symExp.price)) {
        orderNotional = mul(quantity, symExp.price);
      }
    }

    if (orderNotional) {
      // Check max order notional
      if (policy.thresholds.maxOrderNotional && isValidDecimal(policy.thresholds.maxOrderNotional)) {
        if (cmp(orderNotional, policy.thresholds.maxOrderNotional) > 0) {
          const d: RiskDecisionDetail = {
            dimension: RiskDimension.EXPOSURE,
            decision: RiskDecision.BLOCK,
            state: RiskState.BLOCKED,
            ruleId: 'MAX_ORDER_NOTIONAL',
            policyVersion: policy.effectiveVersion,
            current: orderNotional,
            threshold: policy.thresholds.maxOrderNotional,
            severity: RiskSeverity.CRITICAL,
            reason: `Order notional ${orderNotional} exceeds max ${policy.thresholds.maxOrderNotional}`,
            timestamp: nowIso,
            scope: RiskPolicyScope.TENANT,
            scopeId: accountId,
            isBlocking: true,
            isWarning: false,
          };
          details.push(d);
          blockingReasons.push(d.reason);
        }
      }

      // Check gross exposure projected
      if (policy.thresholds.maxGrossExposure && isValidDecimal(policy.thresholds.maxGrossExposure)) {
        const projectedGross = add(exposure.grossExposure, orderNotional);
        if (cmp(projectedGross, policy.thresholds.maxGrossExposure) > 0) {
          const d: RiskDecisionDetail = {
            dimension: RiskDimension.EXPOSURE,
            decision: RiskDecision.BLOCK,
            state: RiskState.BLOCKED,
            ruleId: 'MAX_GROSS_EXPOSURE',
            policyVersion: policy.effectiveVersion,
            current: projectedGross,
            threshold: policy.thresholds.maxGrossExposure,
            severity: RiskSeverity.CRITICAL,
            reason: `Projected gross exposure ${projectedGross} exceeds max ${policy.thresholds.maxGrossExposure}`,
            timestamp: nowIso,
            scope: RiskPolicyScope.TENANT,
            scopeId: tenantId,
            isBlocking: true,
            isWarning: false,
          };
          details.push(d);
          blockingReasons.push(d.reason);
        } else if (cmp(projectedGross, mul(policy.thresholds.maxGrossExposure, '0.9')) > 0) {
          const d: RiskDecisionDetail = {
            dimension: RiskDimension.EXPOSURE,
            decision: RiskDecision.REDUCE,
            state: RiskState.HIGH,
            ruleId: 'MAX_GROSS_EXPOSURE',
            policyVersion: policy.effectiveVersion,
            current: projectedGross,
            threshold: policy.thresholds.maxGrossExposure,
            severity: RiskSeverity.WARNING,
            reason: `Projected gross exposure ${projectedGross} approaching limit ${policy.thresholds.maxGrossExposure} (90%)`,
            timestamp: nowIso,
            scope: RiskPolicyScope.TENANT,
            scopeId: tenantId,
            isBlocking: false,
            isWarning: true,
          };
          details.push(d);
          warnings.push(d.reason);
        }
      }
    } else {
      const d: RiskDecisionDetail = {
        dimension: RiskDimension.EXPOSURE,
        decision: RiskDecision.REVIEW_REQUIRED,
        state: RiskState.UNKNOWN,
        ruleId: 'MAX_ORDER_NOTIONAL',
        policyVersion: policy.effectiveVersion,
        current: null,
        threshold: policy.thresholds.maxOrderNotional,
        severity: RiskSeverity.WARNING,
        reason: `Cannot compute order notional for ${symbol} — missing price and mark unavailable`,
        timestamp: nowIso,
        scope: RiskPolicyScope.TENANT,
        scopeId: accountId,
        isBlocking: false,
        isWarning: true,
      };
      details.push(d);
      warnings.push(d.reason);
    }

    // 4. Margin check
    try {
      const marginResults = await this.marginRiskService.evaluateMargin({ tenantId, accountId, orderIntent: { symbol, quantity, price: price ?? null, side } });
      for (const m of marginResults) {
        if (m.state === RiskState.BLOCKED || m.state === RiskState.CRITICAL) {
          const d: RiskDecisionDetail = {
            dimension: RiskDimension.MARGIN,
            decision: RiskDecision.BLOCK,
            state: m.state,
            ruleId: m.ruleId,
            policyVersion: m.policyVersion,
            current: m.marginUtilizationPercent,
            threshold: policy.thresholds.marginCriticalUtilization,
            severity: m.severity,
            reason: m.reason,
            timestamp: nowIso,
            scope: RiskPolicyScope.TENANT,
            scopeId: accountId,
            isBlocking: true,
            isWarning: false,
          };
          details.push(d);
          blockingReasons.push(d.reason);
        } else if (m.state === RiskState.HIGH || m.state === RiskState.ELEVATED) {
          const d: RiskDecisionDetail = {
            dimension: RiskDimension.MARGIN,
            decision: RiskDecision.REDUCE,
            state: m.state,
            ruleId: m.ruleId,
            policyVersion: m.policyVersion,
            current: m.marginUtilizationPercent,
            threshold: policy.thresholds.marginWarningUtilization,
            severity: m.severity,
            reason: m.reason,
            timestamp: nowIso,
            scope: RiskPolicyScope.TENANT,
            scopeId: accountId,
            isBlocking: false,
            isWarning: true,
          };
          details.push(d);
          warnings.push(d.reason);
        }
      }
    } catch (e) {
      const d: RiskDecisionDetail = {
        dimension: RiskDimension.MARGIN,
        decision: RiskDecision.REVIEW_REQUIRED,
        state: RiskState.UNKNOWN,
        ruleId: 'MARGIN_UTILIZATION',
        policyVersion: policy.effectiveVersion,
        current: null,
        threshold: policy.thresholds.marginCriticalUtilization,
        severity: RiskSeverity.WARNING,
        reason: `Margin evaluation failed: ${(e as Error).message}, fail-closed to REVIEW_REQUIRED`,
        timestamp: nowIso,
        scope: RiskPolicyScope.TENANT,
        scopeId: accountId,
        isBlocking: false,
        isWarning: true,
      };
      details.push(d);
      warnings.push(d.reason);
    }

    // 5. Leverage check
    try {
      const levResults = await this.leverageRiskService.evaluateLeverage({
        tenantId,
        accountId,
        symbol,
        orderIntent: { quantity, price: price ?? null, side },
      });
      for (const lev of levResults) {
        if (lev.isBreach) {
          const d: RiskDecisionDetail = {
            dimension: RiskDimension.LEVERAGE,
            decision: RiskDecision.BLOCK,
            state: lev.state,
            ruleId: lev.ruleId,
            policyVersion: lev.policyVersion,
            current: lev.projectedGrossLeverage ?? lev.grossLeverage,
            threshold: lev.policyMaxLeverage,
            severity: lev.severity,
            reason: lev.reason,
            timestamp: nowIso,
            scope: RiskPolicyScope.TENANT,
            scopeId: accountId,
            isBlocking: true,
            isWarning: false,
          };
          details.push(d);
          blockingReasons.push(d.reason);
        }
      }
    } catch (e) {
      const d: RiskDecisionDetail = {
        dimension: RiskDimension.LEVERAGE,
        decision: RiskDecision.REVIEW_REQUIRED,
        state: RiskState.UNKNOWN,
        ruleId: 'MAX_LEVERAGE_GROSS',
        policyVersion: policy.effectiveVersion,
        current: null,
        threshold: policy.thresholds.maxLeverageGross,
        severity: RiskSeverity.WARNING,
        reason: `Leverage evaluation failed: ${(e as Error).message}`,
        timestamp: nowIso,
        scope: RiskPolicyScope.TENANT,
        scopeId: accountId,
        isBlocking: false,
        isWarning: true,
      };
      details.push(d);
      warnings.push(d.reason);
    }

    // 6. Concentration check
    try {
      const concResults = await this.concentrationService.evaluateConcentration({
        tenantId,
        accountId,
        symbol,
        orderIntent: orderNotional ? { notional: orderNotional, symbol } : null,
      });
      for (const c of concResults) {
        if (c.isBreach) {
          const d: RiskDecisionDetail = {
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
          };
          details.push(d);
          blockingReasons.push(d.reason);
        }
      }
    } catch (e) {
      this.logger.warn(`Concentration check failed: ${(e as Error).message}`);
    }

    // 7. Drawdown check
    try {
      const ddResults = await this.drawdownService.evaluateDrawdown({ tenantId, accountId, traderId, strategyId, followerId });
      for (const dd of ddResults) {
        if (dd.isBreach) {
          const d: RiskDecisionDetail = {
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
            scope: RiskPolicyScope.TENANT,
            scopeId: accountId,
            isBlocking: true,
            isWarning: false,
          };
          details.push(d);
          blockingReasons.push(d.reason);
        }
      }
    } catch (e) {
      this.logger.warn(`Drawdown check failed: ${(e as Error).message}`);
    }

    // 8. Daily loss check
    try {
      const dlResults = await this.dailyLossService.evaluateDailyLoss({ tenantId, accountId, traderId, strategyId, followerId });
      for (const dl of dlResults) {
        if (dl.isBreach) {
          const d: RiskDecisionDetail = {
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
            scope: RiskPolicyScope.TENANT,
            scopeId: accountId,
            isBlocking: true,
            isWarning: false,
          };
          details.push(d);
          blockingReasons.push(d.reason);
        }
      }
    } catch (e) {
      this.logger.warn(`Daily loss check failed: ${(e as Error).message}`);
    }

    // 9. Compliance check (reuse existing ComplianceModule)
    try {
      // Compliance check via canonical compliance status — if user blocked, prevent ALLOW
      const screening = await this.prisma.complianceScreeningRequest.findFirst({
        where: { tenantId, userId: userId ?? undefined, status: 'BLOCKED' },
        orderBy: { createdAt: 'desc' },
      });
      if (screening) {
        const d: RiskDecisionDetail = {
          dimension: RiskDimension.COMPLIANCE,
          decision: RiskDecision.BLOCK,
          state: RiskState.BLOCKED,
          ruleId: 'COMPLIANCE_BLOCK',
          policyVersion: policy.effectiveVersion,
          current: null,
          threshold: null,
          severity: RiskSeverity.CRITICAL,
          reason: `Compliance BLOCK for user ${userId ?? 'unknown'} — screening ${screening.id} blocked`,
          timestamp: nowIso,
          scope: RiskPolicyScope.TENANT,
          scopeId: tenantId,
          isBlocking: true,
          isWarning: false,
        };
        details.push(d);
        blockingReasons.push(d.reason);
      }
    } catch (e) {
      this.logger.warn(`Compliance check failed: ${(e as Error).message}`);
      // Fail-closed for compliance: if compliance unavailable and policy requires, block
      const d: RiskDecisionDetail = {
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
      };
      details.push(d);
      warnings.push(d.reason);
    }

    // 10. Security check
    try {
      const threat = await this.prisma.securityThreatSignal.findFirst({
        where: { tenantId, userId: userId ?? undefined, resolved: false, riskLevel: { in: ['HIGH', 'CRITICAL'] } },
        orderBy: { createdAt: 'desc' },
      });
      if (threat) {
        const d: RiskDecisionDetail = {
          dimension: RiskDimension.SECURITY,
          decision: RiskDecision.BLOCK,
          state: RiskState.BLOCKED,
          ruleId: 'SECURITY_BLOCK',
          policyVersion: policy.effectiveVersion,
          current: null,
          threshold: null,
          severity: RiskSeverity.CRITICAL,
          reason: `Security BLOCK for user ${userId ?? 'unknown'} — threat ${threat.ruleId} level ${threat.riskLevel}`,
          timestamp: nowIso,
          scope: RiskPolicyScope.TENANT,
          scopeId: tenantId,
          isBlocking: true,
          isWarning: false,
        };
        details.push(d);
        blockingReasons.push(d.reason);
      }
    } catch (e) {
      this.logger.warn(`Security check failed: ${(e as Error).message}`);
    }

    // 11. Exchange health
    try {
      const account = await this.prisma.tradingAccount.findFirst({ where: { id: accountId, tenantId } });
      if (account) {
        const ageMs = account.lastVerifiedAt ? Date.now() - new Date(account.lastVerifiedAt).getTime() : Infinity;
        if (ageMs > policy.thresholds.exchangeHealthMaxAgeMs) {
          const d: RiskDecisionDetail = {
            dimension: RiskDimension.EXCHANGE_HEALTH,
            decision: environment === 'LIVE' ? RiskDecision.BLOCK : RiskDecision.REVIEW_REQUIRED,
            state: RiskState.STALE,
            ruleId: 'EXCHANGE_HEALTH_DEGRADED',
            policyVersion: policy.effectiveVersion,
            current: ageMs.toString(),
            threshold: policy.thresholds.exchangeHealthMaxAgeMs.toString(),
            severity: RiskSeverity.WARNING,
            reason: `Exchange health stale for account ${accountId}, last verified ${ageMs}ms ago > ${policy.thresholds.exchangeHealthMaxAgeMs}ms`,
            timestamp: nowIso,
            scope: RiskPolicyScope.TENANT,
            scopeId: accountId,
            isBlocking: environment === 'LIVE',
            isWarning: environment !== 'LIVE',
          };
          details.push(d);
          if (d.isBlocking) blockingReasons.push(d.reason);
          else warnings.push(d.reason);
        }
        if (account.status !== 'ACTIVE') {
          const d: RiskDecisionDetail = {
            dimension: RiskDimension.EXCHANGE_HEALTH,
            decision: RiskDecision.BLOCK,
            state: RiskState.BLOCKED,
            ruleId: 'EXCHANGE_HEALTH_DEGRADED',
            policyVersion: policy.effectiveVersion,
            current: account.status,
            threshold: 'ACTIVE',
            severity: RiskSeverity.CRITICAL,
            reason: `Trading account ${accountId} status ${account.status} not ACTIVE`,
            timestamp: nowIso,
            scope: RiskPolicyScope.TENANT,
            scopeId: accountId,
            isBlocking: true,
            isWarning: false,
          };
          details.push(d);
          blockingReasons.push(d.reason);
        }
      }
    } catch (e) {
      this.logger.warn(`Exchange health check failed: ${(e as Error).message}`);
    }

    return this.finalizeDecision({
      tenantId,
      userId: userId ?? null,
      accountId,
      symbol,
      traderId: traderId ?? null,
      followerId: followerId ?? null,
      strategyId: strategyId ?? null,
      environment,
      policy,
      details,
      blockingReasons,
      warnings,
      requestId: requestId ?? null,
    });
  }

  private finalizeDecision(params: {
    tenantId: string;
    userId: string | null;
    accountId: string;
    symbol: string;
    traderId: string | null;
    followerId: string | null;
    strategyId: string | null;
    environment: string;
    policy: any;
    details: RiskDecisionDetail[];
    blockingReasons: string[];
    warnings: string[];
    requestId: string | null;
  }): UnifiedRiskDecision {
    const { tenantId, userId, accountId, symbol, traderId, followerId, strategyId, environment, policy, details, blockingReasons, warnings, requestId } = params;

    let finalDecision: RiskDecision = RiskDecision.ALLOW;
    let finalState = RiskState.NORMAL;

    // Priority: BLOCKED/KILL_SWITCH never becomes ALLOW
    const hasBlock = details.some((d) => d.decision === RiskDecision.BLOCK || d.decision === RiskDecision.KILL_SWITCH_REQUIRED);
    const hasReview = details.some((d) => d.decision === RiskDecision.REVIEW_REQUIRED);
    const hasReduce = details.some((d) => d.decision === RiskDecision.REDUCE);
    const hasPause = details.some((d) => d.decision === RiskDecision.PAUSE);
    const hasStopCopy = details.some((d) => d.decision === RiskDecision.STOP_COPY);

    if (hasBlock) {
      finalDecision = RiskDecision.BLOCK;
      finalState = RiskState.BLOCKED;
    } else if (details.some((d) => d.decision === RiskDecision.KILL_SWITCH_REQUIRED)) {
      finalDecision = RiskDecision.KILL_SWITCH_REQUIRED;
      finalState = RiskState.CRITICAL;
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

    // If any STALE and live, block
    if (environment === 'LIVE' && details.some((d) => d.state === RiskState.STALE)) {
      finalDecision = RiskDecision.BLOCK;
      finalState = RiskState.STALE;
    }

    const ruleIds = Array.from(new Set(details.map((d) => d.ruleId)));

    return {
      id: `risk-dec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId,
      userId,
      accountId,
      symbol,
      venue: null,
      traderId,
      followerId,
      strategyId,
      orderIntentId: requestId,
      decision: finalDecision,
      state: finalState,
      blockingReasons,
      warnings,
      details,
      policies: policy.scopeChain.map((s: any) => ({ scope: s.scope, scopeId: s.scopeId, version: s.version.toString(), digest: s.digest })),
      ruleIds,
      policyVersion: policy.effectiveVersion,
      timestamp: new Date().toISOString(),
      requestId,
      environment,
      complianceDecision: details.find((d) => d.dimension === RiskDimension.COMPLIANCE)?.decision ?? null,
      securityDecision: details.find((d) => d.dimension === RiskDimension.SECURITY)?.decision ?? null,
      exchangeHealth: details.find((d) => d.dimension === RiskDimension.EXCHANGE_HEALTH)?.state ?? null,
      circuitBreaker: null,
      killSwitch: null,
    };
  }
}
