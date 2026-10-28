import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { InstitutionalRiskPolicyService } from './risk-policy.service';
import { DailyLossResult, RiskPolicyScope, RiskSeverity, RiskState } from './risk-management.types';

/**
 * Evaluates daily loss only when a day-attributed PnL source is available.
 *
 * The current ledger has cumulative position realised PnL, unqualified
 * multi-asset balances and snapshots without a valuation currency or cash-flow
 * adjustments. None establishes either realised daily PnL or a complete
 * realised-plus-unrealised daily PnL. An equity difference cannot distinguish
 * trading profit/loss from deposits, withdrawals or conversion effects.
 * Therefore this service reports UNKNOWN rather than authorising against an
 * approximation. The caller treats UNKNOWN as review-required.
 */
@Injectable()
export class DailyLossLimitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: InstitutionalRiskPolicyService,
  ) {}

  async evaluateDailyLoss(params: {
    tenantId: string;
    accountId?: string;
    traderId?: string;
    strategyId?: string;
    followerId?: string;
  }): Promise<DailyLossResult[]> {
    const { tenantId, accountId, traderId, strategyId, followerId } = params;
    const policy = await this.policyService.resolveEffectivePolicy({
      tenantId,
      traderId: traderId ?? null,
      strategyId: strategyId ?? null,
      followerId: followerId ?? null,
    });
    const scope = followerId ? RiskPolicyScope.FOLLOWER
      : strategyId ? RiskPolicyScope.STRATEGY
      : traderId ? RiskPolicyScope.TRADER
      : RiskPolicyScope.TENANT;
    const scopeId = followerId ?? strategyId ?? traderId ?? accountId ?? tenantId;
    const tradingDay = new Date().toISOString().slice(0, 10);
    const resetAt = new Date(`${tradingDay}T00:00:00.000Z`);
    resetAt.setUTCDate(resetAt.getUTCDate() + 1);

    return [{
      tenantId, scope, scopeId, tradingDay,
      startingEquity: null, currentEquity: null,
      realizedPnl: null, unrealizedPnl: null, dailyPnl: null,
      threshold: policy.thresholds.maxDailyLoss ?? null,
      remainingBudget: null,
      isBreach: false,
      state: RiskState.UNKNOWN,
      ruleId: 'DAILY_LOSS_LIMIT',
      policyVersion: policy.effectiveVersion,
      reason: 'Authoritative day-attributed, cash-flow-adjusted PnL is unavailable for this scope.',
      severity: RiskSeverity.WARNING,
      resetAt: resetAt.toISOString(),
      sourceTimestamp: null,
    }];
  }
}
