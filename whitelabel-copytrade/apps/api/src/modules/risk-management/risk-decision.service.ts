import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { Decimal } from '../../common/decimal-string';
import { InstitutionalRiskPolicyService } from './risk-policy.service';
import { PortfolioExposureService } from './portfolio-exposure.service';
import { MONETARY_EXPOSURE_KEYS, validatedExposureCurrency } from './exposure-currency';
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
    private readonly outbox: OutboxService,
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
    /** Trusted OMS routing supplies the existing intent being rechecked. */
    excludePendingIntentId?: string;
    /** If supplied, reject a decision made for a different account owner. */
    expectedAccountOwnerId?: string | null;
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
      excludePendingIntentId,
      expectedAccountOwnerId,
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
    const unavailable = (dimension: RiskDimension, ruleId: string, reason: string) => {
      pushDetail({
        dimension,
        decision: RiskDecision.REVIEW_REQUIRED,
        state: RiskState.UNKNOWN,
        ruleId,
        policyVersion: policy.effectiveVersion,
        current: null,
        threshold: null,
        severity: RiskSeverity.WARNING,
        reason,
        timestamp: nowIso,
        scope: RiskPolicyScope.TENANT,
        scopeId: accountId ?? tenantId,
        isBlocking: false,
        isWarning: true,
      });
    };

    const policyCurrency = validatedExposureCurrency(policy);
    const hasMonetaryLimit = MONETARY_EXPOSURE_KEYS.some((key) => policy.thresholds[key] != null);
    if (orderIntent && hasMonetaryLimit && !policyCurrency) {
      unavailable(RiskDimension.EXPOSURE, 'POLICY_CURRENCY_UNAVAILABLE', 'The monetary risk policy has no verified, consistent currency.');
    }
    // The read-only projection below is not an atomic portfolio reservation.
    // It can prove a breach, but cannot approve competing aggregate-cap orders.
    if (orderIntent && [policy.thresholds.maxGrossExposure, policy.thresholds.maxNetExposure,
      policy.thresholds.maxSymbolExposure, policy.thresholds.maxVenueExposure, policy.thresholds.maxAccountExposure,
      policy.thresholds.maxStrategyExposure, policy.thresholds.maxTraderExposure, policy.thresholds.maxFollowerExposure,
      policy.thresholds.maxPositionNotional].some((value) => value != null)) {
      unavailable(RiskDimension.EXPOSURE, 'EXPOSURE_RESERVATION_UNAVAILABLE', 'An atomic exposure reservation is unavailable.');
    }
    if (orderIntent && policy.thresholds.maxAccountExposure != null && !accountId) {
      unavailable(RiskDimension.EXPOSURE, 'ACCOUNT_EXPOSURE_UNAVAILABLE', 'An account is required to evaluate the account exposure limit.');
    }

    // Only a priced BUY limit order supplies an intrinsic upper bound on its
    // quote notional. A market order has no execution-price ceiling; a SELL
    // limit sets a floor, not a ceiling. Treat either as unknown when monetary
    // limits need a projected amount rather than inventing a zero or using a
    // potentially stale mark as a guaranteed maximum.
    let orderNotionalUpperBound: Decimal | null = null;
    if (orderIntent) {
      const needsNotionalBound = [
        policy.thresholds.maxOrderNotional, policy.thresholds.maxGrossExposure,
        policy.thresholds.maxSymbolExposure, policy.thresholds.maxAccountExposure,
        policy.thresholds.marginCriticalUtilization, policy.thresholds.maxLeverageGross,
        policy.thresholds.maxLeverageNet, policy.thresholds.maxLeverageAccount,
        policy.thresholds.maxLeverageSymbol,
      ].some((value) => value != null);
      const plainPositive = /^\d{1,40}(?:\.\d{1,18})?$/;
      try {
        if (orderIntent.side === 'BUY' && orderIntent.orderType === 'LIMIT' &&
            typeof orderIntent.price === 'string' && plainPositive.test(orderIntent.price) &&
            plainPositive.test(orderIntent.quantity)) {
          const quantity = Decimal.parse(orderIntent.quantity);
          const price = Decimal.parse(orderIntent.price);
          if (!quantity.gt(Decimal.ZERO) || !price.gt(Decimal.ZERO)) throw new Error('non-positive order');
          orderNotionalUpperBound = quantity.mul(price);
        }
        if (needsNotionalBound && orderNotionalUpperBound === null) {
          unavailable(RiskDimension.EXPOSURE, 'ORDER_NOTIONAL_UNAVAILABLE', 'A safe order-notional upper bound is unavailable.');
        }
        // Comparison is deferred until the instrument quote is established
        // independently by the exposure service.
      } catch {
        unavailable(RiskDimension.EXPOSURE, 'ORDER_NOTIONAL_UNAVAILABLE', 'Order-notional evidence is invalid or unavailable.');
        orderNotionalUpperBound = null;
      }
    }

    // 1. Exposure
    try {
      // maxGrossExposure and the symbol threshold below are tenant-scoped.
      // Filtering the ledger to the candidate account understated a tenant
      // that also holds positions/orders elsewhere. Resolve the candidate's
      // market separately while aggregating the entire tenant.
      const exposure = await this.exposureService.calculateExposure({ tenantId,
        ...(orderIntent && symbol ? { candidateSymbol: symbol, ...(accountId ? { candidateAccountId: accountId } : {}) } : {}),
        ...(excludePendingIntentId ? { excludePendingIntentId } : {}) });
      const currencyMatches = !!policyCurrency && exposure.valuationCurrency === policyCurrency &&
        exposure.state !== RiskState.UNKNOWN && exposure.state !== RiskState.STALE &&
        Array.isArray(exposure.unknownPrices) && exposure.unknownPrices.length === 0;
      if (orderIntent && hasMonetaryLimit && !currencyMatches) {
        unavailable(RiskDimension.EXPOSURE, 'ORDER_CURRENCY_UNAVAILABLE', 'The order and exposure quote cannot be matched to the policy currency.');
      }
      if (orderIntent && currencyMatches && policy.thresholds.maxOrderNotional != null && orderNotionalUpperBound !== null) {
        const limit = Decimal.parse(policy.thresholds.maxOrderNotional);
        if (limit.isNegative()) throw new Error('invalid order-notional limit');
        if (orderNotionalUpperBound.gt(limit)) pushDetail({
          dimension: RiskDimension.EXPOSURE, decision: RiskDecision.BLOCK, state: RiskState.BLOCKED,
          ruleId: 'MAX_ORDER_NOTIONAL', policyVersion: policy.effectiveVersion,
          current: orderNotionalUpperBound.toString(), threshold: limit.toString(), severity: RiskSeverity.CRITICAL,
          reason: 'The order notional exceeds its configured limit.', timestamp: nowIso,
          scope: RiskPolicyScope.TENANT, scopeId: accountId ?? tenantId, isBlocking: true, isWarning: false,
        });
      }
      if (exposure.state === RiskState.BLOCKED && (!orderIntent || currencyMatches)) {
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
      } else if (exposure.state === RiskState.UNKNOWN) {
        unavailable(RiskDimension.EXPOSURE, 'MAX_GROSS_EXPOSURE', 'Exposure evidence is unavailable.');
      }
      if (Array.isArray(exposure.unknownPrices) && exposure.unknownPrices.length > 0) {
        unavailable(RiskDimension.EXPOSURE, 'EXPOSURE_PRICE_UNAVAILABLE', 'Some exposure valuation or attribution evidence is unavailable.');
      }
      // Open orders remain committed exposure. The proposed order is added
      // conservatively rather than letting several individually-small orders
      // pass the current-only check. These observations are not an atomic
      // reservation and are not a substitute for a live exposure ledger.
      if (orderIntent && currencyMatches && orderNotionalUpperBound !== null && policy.thresholds.maxGrossExposure != null) {
        const committed = Decimal.parse(exposure.totalExposure);
        const limit = Decimal.parse(policy.thresholds.maxGrossExposure);
        if (committed.isNegative() || limit.isNegative()) throw new Error('invalid gross exposure');
        const projected = committed.add(orderNotionalUpperBound);
        if (projected.gt(limit) && exposure.state !== RiskState.BLOCKED) {
          pushDetail({
            dimension: RiskDimension.EXPOSURE,
            decision: RiskDecision.BLOCK,
            state: RiskState.BLOCKED,
            ruleId: 'MAX_GROSS_EXPOSURE',
            policyVersion: policy.effectiveVersion,
            current: projected.toString(),
            threshold: limit.toString(),
            severity: RiskSeverity.CRITICAL,
            reason: 'Projected gross exposure exceeds its configured limit.',
            timestamp: nowIso,
            scope: RiskPolicyScope.TENANT,
            scopeId: tenantId,
            isBlocking: true,
            isWarning: false,
          });
        }
      }
      if (orderIntent && currencyMatches && symbol && orderNotionalUpperBound !== null && policy.thresholds.maxSymbolExposure != null) {
        const symExp = exposure.symbolExposures.find((s) => s.symbol === symbol);
        const committed = Decimal.parse(symExp ? symExp.totalExposure : '0');
        const limit = Decimal.parse(policy.thresholds.maxSymbolExposure);
        if (committed.isNegative() || limit.isNegative()) throw new Error('invalid symbol exposure');
        const projected = committed.add(orderNotionalUpperBound);
        if (projected.gt(limit)) {
          pushDetail({
            dimension: RiskDimension.EXPOSURE,
            decision: RiskDecision.BLOCK,
            state: RiskState.BLOCKED,
            ruleId: 'MAX_SYMBOL_EXPOSURE',
            policyVersion: policy.effectiveVersion,
            current: projected.toString(),
            threshold: limit.toString(),
            severity: RiskSeverity.CRITICAL,
            reason: 'Projected symbol exposure exceeds its configured limit.',
            timestamp: nowIso,
            scope: RiskPolicyScope.TENANT,
            scopeId: tenantId,
            isBlocking: true,
            isWarning: false,
          });
        }
      }
    } catch {
      unavailable(RiskDimension.EXPOSURE, 'MAX_GROSS_EXPOSURE', 'Exposure evaluation is unavailable.');
    }

    // maxAccountExposure is a different scope and must not be compared with a
    // tenant-wide number. Include all known account positions and outstanding
    // orders, then conservatively project this candidate. Missing marks,
    // unbounded orders or unmatched reservations require review, not approval.
    if (accountId && policy.thresholds.maxAccountExposure != null) {
      try {
        const accountExposure = await this.exposureService.calculateExposure({ tenantId, accountId,
          ...(orderIntent && symbol ? { candidateSymbol: symbol } : {}),
          ...(excludePendingIntentId ? { excludePendingIntentId } : {}) });
        if (accountExposure.state === RiskState.UNKNOWN || accountExposure.state === RiskState.STALE ||
            (Array.isArray(accountExposure.unknownPrices) && accountExposure.unknownPrices.length > 0)) {
          unavailable(RiskDimension.EXPOSURE, 'ACCOUNT_EXPOSURE_UNAVAILABLE', 'Account exposure evidence is incomplete or stale.');
        }
        const accountCurrencyMatches = !!policyCurrency && accountExposure.valuationCurrency === policyCurrency &&
          accountExposure.state !== RiskState.UNKNOWN && accountExposure.state !== RiskState.STALE &&
          Array.isArray(accountExposure.unknownPrices) && accountExposure.unknownPrices.length === 0;
        if (!accountCurrencyMatches) {
          unavailable(RiskDimension.EXPOSURE, 'ACCOUNT_EXPOSURE_CURRENCY_UNAVAILABLE', 'Account exposure and policy currencies cannot be matched.');
        }
        const committed = Decimal.parse(accountExposure.totalExposure);
        const limit = Decimal.parse(policy.thresholds.maxAccountExposure);
        if (committed.isNegative() || limit.isNegative()) throw new Error('invalid account exposure');
        const projected = orderIntent && orderNotionalUpperBound !== null ? committed.add(orderNotionalUpperBound) : committed;
        if (accountCurrencyMatches && projected.gt(limit)) {
          pushDetail({
            dimension: RiskDimension.EXPOSURE,
            decision: RiskDecision.BLOCK,
            state: RiskState.BLOCKED,
            ruleId: 'MAX_ACCOUNT_EXPOSURE',
            policyVersion: policy.effectiveVersion,
            current: projected.toString(),
            threshold: limit.toString(),
            severity: RiskSeverity.CRITICAL,
            reason: 'Projected account exposure exceeds its configured limit.',
            timestamp: nowIso,
            scope: RiskPolicyScope.TENANT,
            scopeId: accountId,
            isBlocking: true,
            isWarning: false,
          });
        }
      } catch {
        unavailable(RiskDimension.EXPOSURE, 'ACCOUNT_EXPOSURE_UNAVAILABLE', 'Account exposure evaluation is unavailable.');
      }
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
    } catch {
      unavailable(RiskDimension.POSITION, 'POSITION_RISK_UNAVAILABLE', 'Position risk evaluation is unavailable.');
    }

    // 3. Margin
    if (accountId) {
      try {
        const marginResults = await this.marginService.evaluateMargin({ tenantId, accountId, orderIntent: orderIntent ? { symbol: symbol ?? '', quantity: orderIntent.quantity, price: orderIntent.price ?? null, side: orderIntent.side } : null });
        if (policy.thresholds.marginCriticalUtilization != null && marginResults.length === 0) {
          unavailable(RiskDimension.MARGIN, 'MARGIN_RISK_UNAVAILABLE', 'Margin risk evidence is unavailable.');
        }
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
          } else if (mr.state === RiskState.UNKNOWN || mr.state === RiskState.STALE || mr.isStale ||
              (policy.thresholds.marginCriticalUtilization != null &&
               (mr.marginUtilizationPercent == null || (orderIntent != null && mr.projectedMarginUtilizationPercent == null)))) {
            unavailable(RiskDimension.MARGIN, 'MARGIN_RISK_UNAVAILABLE', 'Margin risk evidence is incomplete or stale.');
          }
        }
      } catch {
        unavailable(RiskDimension.MARGIN, 'MARGIN_RISK_UNAVAILABLE', 'Margin risk evaluation is unavailable.');
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
        if ((policy.thresholds.maxLeverageGross != null || policy.thresholds.maxLeverageNet != null ||
            policy.thresholds.maxLeverageAccount != null || policy.thresholds.maxLeverageSymbol != null) && levResults.length === 0) {
          unavailable(RiskDimension.LEVERAGE, 'LEVERAGE_RISK_UNAVAILABLE', 'Leverage evidence is unavailable.');
        }
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
          } else if (lr.state === RiskState.UNKNOWN || lr.state === RiskState.STALE ||
              (lr.policyMaxLeverage != null && lr.grossLeverage == null)) {
            unavailable(RiskDimension.LEVERAGE, 'LEVERAGE_RISK_UNAVAILABLE', 'Leverage evidence is incomplete or stale.');
          }
        }
      } catch {
        unavailable(RiskDimension.LEVERAGE, 'LEVERAGE_RISK_UNAVAILABLE', 'Leverage risk evaluation is unavailable.');
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
        } else if (l.state === RiskState.UNKNOWN || l.state === RiskState.STALE) {
          unavailable(RiskDimension.LIQUIDATION, 'LIQUIDATION_RISK_UNAVAILABLE', 'Liquidation evidence is incomplete or stale.');
        }
      }
    } catch {
      unavailable(RiskDimension.LIQUIDATION, 'LIQUIDATION_RISK_UNAVAILABLE', 'Liquidation risk evaluation is unavailable.');
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
    } catch {
      unavailable(RiskDimension.CONCENTRATION, 'CONCENTRATION_RISK_UNAVAILABLE', 'Concentration risk evaluation is unavailable.');
    }

    // 7. Drawdown
    try {
      const ddResults = await this.drawdownService.evaluateDrawdown({ tenantId, accountId, traderId, strategyId, followerId });
      if ((policy.thresholds.maxDrawdownPercent != null || policy.thresholds.maxIntradayDrawdownPercent != null) && ddResults.length === 0) {
        unavailable(RiskDimension.DRAWDOWN, 'DRAWDOWN_RISK_UNAVAILABLE', 'Drawdown evidence is unavailable.');
      }
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
        } else if (dd.state === RiskState.UNKNOWN || dd.state === RiskState.STALE ||
            (dd.thresholdPercent != null && dd.drawdownPercent == null) ||
            (policy.thresholds.maxIntradayDrawdownPercent != null && dd.intradayDrawdownPercent == null)) {
          unavailable(RiskDimension.DRAWDOWN, 'DRAWDOWN_RISK_UNAVAILABLE', 'Drawdown evidence is incomplete or stale.');
        } else if (policy.thresholds.maxIntradayDrawdownPercent != null && dd.intradayDrawdownPercent != null &&
            this.cmpDecimal(dd.intradayDrawdownPercent, policy.thresholds.maxIntradayDrawdownPercent) > 0) {
          pushDetail({
            dimension: RiskDimension.DRAWDOWN,
            decision: RiskDecision.BLOCK,
            state: RiskState.BLOCKED,
            ruleId: 'MAX_INTRADAY_DRAWDOWN',
            policyVersion: dd.policyVersion,
            current: dd.intradayDrawdownPercent,
            threshold: policy.thresholds.maxIntradayDrawdownPercent,
            severity: RiskSeverity.CRITICAL,
            reason: 'Intraday drawdown exceeds the configured limit.',
            timestamp: nowIso,
            scope: dd.scope,
            scopeId: dd.scopeId,
            isBlocking: true,
            isWarning: false,
          });
        }
      }
    } catch {
      unavailable(RiskDimension.DRAWDOWN, 'DRAWDOWN_RISK_UNAVAILABLE', 'Drawdown risk evaluation is unavailable.');
    }

    // 8. Daily loss
    try {
      const dlResults = await this.dailyLossService.evaluateDailyLoss({ tenantId, accountId, traderId, strategyId, followerId });
      if (policy.thresholds.maxDailyLoss != null && dlResults.length === 0) {
        unavailable(RiskDimension.DAILY_LOSS, 'DAILY_LOSS_UNAVAILABLE', 'Daily loss evidence is unavailable.');
      }
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
        } else if (policy.thresholds.maxDailyLoss != null &&
            (dl.state === RiskState.UNKNOWN || dl.state === RiskState.STALE || dl.dailyPnl == null)) {
          unavailable(RiskDimension.DAILY_LOSS, 'DAILY_LOSS_UNAVAILABLE', 'Daily loss evidence is incomplete or stale.');
        }
      }
    } catch {
      if (policy.thresholds.maxDailyLoss != null) {
        unavailable(RiskDimension.DAILY_LOSS, 'DAILY_LOSS_UNAVAILABLE', 'Daily loss evaluation is unavailable.');
      }
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
    } catch {
      this.logger.warn('Correlation evaluation unavailable.');
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
    } catch {
      this.logger.warn('Value-at-risk evaluation unavailable.');
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
    } catch {
      this.logger.warn('Stress evaluation unavailable.');
    }

    // An operator can act for another account. Screen both the actor and the
    // account's actual owner, not just the actor supplied by the caller. House
    // accounts may legitimately have no owner. An unreadable or missing
    // account is not evidence that no owner exists.
    const screeningSubjects = new Set<string>();
    if (userId) screeningSubjects.add(userId);
    if (accountId) {
      try {
        const account = await this.prisma.withTenantRls(tenantId, (tx) => tx.tradingAccount.findFirst({
          where: { id: accountId, tenantId, deletedAt: null },
          select: { userId: true },
        }));
        if (!account) {
          unavailable(RiskDimension.EXCHANGE_HEALTH, 'EXCHANGE_HEALTH_UNAVAILABLE', 'Trading account ownership is unavailable.');
        } else {
          if (expectedAccountOwnerId !== undefined && (account.userId ?? null) !== expectedAccountOwnerId) {
            unavailable(RiskDimension.EXCHANGE_HEALTH, 'ACCOUNT_OWNER_CHANGED', 'Trading account ownership changed during risk evaluation.');
          }
          if (account.userId) screeningSubjects.add(account.userId);
        }
      } catch {
        unavailable(RiskDimension.EXCHANGE_HEALTH, 'EXCHANGE_HEALTH_UNAVAILABLE', 'Trading account ownership could not be checked.');
      }
    }

    // 12. Compliance — a block for either subject prevents ALLOW.
    try {
      for (const subjectId of screeningSubjects) {
        const screening = await this.prisma.withTenantRls(tenantId, (tx) => tx.complianceScreeningRequest.findFirst({
          where: { tenantId, userId: subjectId, OR: [
            { status: { in: ['BLOCKED', 'REVIEW_REQUIRED'] } },
            { decision: { in: ['BLOCK', 'RESTRICT', 'REVIEW_REQUIRED'] } },
          ] },
          orderBy: { createdAt: 'desc' },
        }));
        if (screening?.status === 'BLOCKED' || screening?.decision === 'BLOCK') {
          pushDetail({
            dimension: RiskDimension.COMPLIANCE,
            decision: RiskDecision.BLOCK,
            state: RiskState.BLOCKED,
            ruleId: 'COMPLIANCE_BLOCK',
            policyVersion: policy.effectiveVersion,
            current: null,
            threshold: null,
            severity: RiskSeverity.CRITICAL,
            reason: 'Compliance screening blocks trading.',
            timestamp: nowIso,
            scope: RiskPolicyScope.TENANT,
            scopeId: tenantId,
            isBlocking: true,
            isWarning: false,
          });
        } else if (screening) {
          unavailable(RiskDimension.COMPLIANCE, 'COMPLIANCE_REVIEW_REQUIRED', 'Compliance screening requires review.');
        }
      }
    } catch {
      unavailable(RiskDimension.COMPLIANCE, 'COMPLIANCE_BLOCK', 'Compliance state could not be checked.');
    }

    // 13. Security — the account owner and the operator are both relevant.
    try {
      for (const subjectId of screeningSubjects) {
        const threat = await this.prisma.withTenantRls(tenantId, (tx) => tx.securityThreatSignal.findFirst({
          where: { tenantId, userId: subjectId, resolved: false, riskLevel: { in: ['HIGH', 'CRITICAL'] } },
          orderBy: { createdAt: 'desc' },
        }));
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
            reason: 'A security signal blocks trading for an involved user.',
            timestamp: nowIso,
            scope: RiskPolicyScope.TENANT,
            scopeId: tenantId,
            isBlocking: true,
            isWarning: false,
          });
        }
      }
    } catch {
      unavailable(RiskDimension.SECURITY, 'SECURITY_CHECK_UNAVAILABLE', 'Security state could not be checked.');
    }

    // 14. Exchange health — stale blocks live
    try {
      if (accountId) {
        const acc = await this.prisma.withTenantRls(tenantId, (tx) => tx.tradingAccount.findFirst({ where: { id: accountId, tenantId } }));
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
        } else {
          unavailable(RiskDimension.EXCHANGE_HEALTH, 'EXCHANGE_HEALTH_UNAVAILABLE', 'Trading account health is unavailable.');
        }
      }
    } catch {
      unavailable(RiskDimension.EXCHANGE_HEALTH, 'EXCHANGE_HEALTH_UNAVAILABLE', 'Exchange health could not be checked.');
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
    } catch {
      unavailable(RiskDimension.EXECUTION_HEALTH, 'CIRCUIT_BREAKER_UNAVAILABLE', 'Circuit-breaker state could not be checked.');
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
    } catch {
      unavailable(RiskDimension.EXECUTION_HEALTH, 'KILL_SWITCH_UNAVAILABLE', 'Kill-switch state could not be checked.');
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
      id: randomUUID(),
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

    // Persist a kill-switch-required decision and its developer event in one
    // tenant-RLS transaction. Other non-stop observations remain audit rows
    // only and do not masquerade as a triggered stop.
    const decisionData = {
      id: decision.id,
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
    };
    if (finalDecision === RiskDecision.KILL_SWITCH_REQUIRED) {
      await this.prisma.withTenantRls(tenantId, async (tx) => {
        await tx.riskDecisionRecord.create({ data: decisionData });
        await this.outbox.append(tx, {
          tenantId,
          aggregateType: 'risk.decision',
          aggregateId: decision.id,
          eventType: 'risk.stop_triggered',
          idempotencyKey: `risk-stop:${decision.id}`,
          payload: {
            decisionId: decision.id,
            ruleIds,
            policyVersion: policy.effectiveVersion,
            scope: RiskPolicyScope.TENANT,
            scopeId: accountId ?? strategyId ?? tenantId,
            severity: RiskSeverity.CRITICAL,
            triggeredAt: nowIso,
          },
        });
      });
    } else {
      await this.prisma.withTenantRls(tenantId, (tx) => tx.riskDecisionRecord.create({ data: decisionData }));
    }

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
