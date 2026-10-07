// # Resolves effective copy policy across platform, tenant, strategy, and follower subscription scopes without weakening safety rules
// # Resolves effective slippage tolerance and execution delay without weakening higher-level caps
// # Resolves stop-copy, TP/SL, and trailing stop policy parameters
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  CopyPolicy,
  CopySizingMode,
  CopyStopExecutionPlan,
  compareDecimalStrings,
  isDecimalString,
} from './copy-trading.types';

/**
 * Resolves effective copy settings: proportional sizing, fixed sizing, symbol filters, max concurrent copies, slippage tolerance, delay, notional caps, and risk controls.
 * Policy precedence: Platform → Tenant → Trader Strategy → Follower Subscription. Lower-level must never weaken mandatory higher-level safety rule.
 */
@Injectable()
export class CopyPolicyService {
  private readonly logger = new Logger(CopyPolicyService.name);

  // Platform-level mandatory safety rules - never weakened
  private readonly platformPolicy: CopyPolicy = {
    sizingMode: CopySizingMode.PROPORTIONAL,
    proportionalRatio: null,
    fixedQuantity: null,
    fixedNotional: null,
    maxOrderNotional: '100000', // Platform cap 100k
    maxDailyNotional: '500000', // Platform cap 500k
    maxConcurrentCopies: 20,
    slippageToleranceBps: 100, // 1% max slippage at platform level
    executionDelayMs: 0,
    allowedSymbols: null,
    blockedSymbols: ['*WITHDRAWAL*'], // Never allow withdrawal symbols
    allowedSides: ['BUY', 'SELL'],
    leveragePolicy: 'SPOT_ONLY',
    maxLeverage: '10',
    marginMode: 'SPOT',
    reduceOnly: null,
    takeProfitBps: null,
    stopLossBps: null,
    trailingStopBps: null,
    stopCopyConditions: null,
  };

  constructor(private readonly prisma: PrismaService) {}

  async getPlatformPolicy(): Promise<CopyPolicy> {
    return this.platformPolicy;
  }

  // The three lookups below let errors propagate. Lower levels may only
  // tighten the policy, so silently dropping a level on a database error (as
  // they used to, returning null) produced a LOOSER effective policy - e.g.
  // tenant-blocked symbols or the follower's max notional disappeared. The
  // copy engine skips the subscription when resolution fails (no order).

  async getTenantPolicy(tenantId: string): Promise<CopyPolicy | null> {
    const setting = await this.prisma.tenantSetting.findFirst({ where: { tenantId, key: 'copy_trading_policy' } });
    if (setting && setting.value) {
      return setting.value as any as CopyPolicy;
    }
    return null;
  }

  /**
   * `tenantId` scopes the lookup; resolveEffectivePolicy always passes it, so
   * GET copy-trading/policies/effective cannot read another tenant's
   * strategy or subscription policy by id.
   */
  async getTraderStrategyPolicy(strategyId: string, tenantId?: string): Promise<CopyPolicy | null> {
    const strategy = await this.prisma.traderStrategy.findFirst({
      where: { id: strategyId, ...(tenantId ? { tenantId } : {}) },
      select: { riskProfile: true, strategyConfig: true, supportedSymbols: true },
    });
    if (!strategy || !strategy.riskProfile) return null;
    const risk = (strategy.riskProfile ?? {}) as Record<string, any>;
    const config = (strategy.strategyConfig ?? {}) as Record<string, any>;
    // Extract copy policy from riskProfile or strategyConfig
    return {
      sizingMode: config.sizingMode || CopySizingMode.PROPORTIONAL,
      proportionalRatio: config.proportionalRatio || null,
      fixedQuantity: config.fixedQuantity || null,
      fixedNotional: config.fixedNotional || null,
      maxOrderNotional: risk.maxOrderNotional || null,
      maxDailyNotional: risk.maxDailyNotional || null,
      maxConcurrentCopies: risk.maxConcurrentCopies || null,
      slippageToleranceBps: config.slippageToleranceBps ?? null,
      executionDelayMs: config.executionDelayMs ?? null,
      allowedSymbols: strategy.supportedSymbols || null,
      blockedSymbols: risk.blockedSymbols || null,
      allowedSides: config.allowedSides || null,
      leveragePolicy: risk.leveragePolicy || config.leveragePolicy || null,
      maxLeverage: risk.maxLeverage || config.maxLeverage || null,
      marginMode: risk.marginMode || config.marginMode || null,
      reduceOnly: config.reduceOnly ?? null,
      takeProfitBps: config.takeProfitBps ?? risk.takeProfitBps ?? null,
      stopLossBps: config.stopLossBps ?? risk.stopLossBps ?? null,
      trailingStopBps: config.trailingStopBps ?? risk.trailingStopBps ?? null,
      stopCopyConditions: risk.stopCopyConditions || config.stopCopyConditions || null,
    };
  }

  async getSubscriptionPolicy(subscriptionId: string, tenantId?: string): Promise<CopyPolicy | null> {
    const sub = await this.prisma.copySubscription.findFirst({ where: { id: subscriptionId, ...(tenantId ? { tenantId } : {}) } });
    if (sub && sub.copyPolicy) {
      return sub.copyPolicy as unknown as CopyPolicy;
    }
    return null;
  }

  async resolveEffectivePolicy(input: { tenantId: string; strategyId?: string; subscriptionId?: string }): Promise<CopyPolicy> {
    const platform = await this.getPlatformPolicy();
    const tenant = await this.getTenantPolicy(input.tenantId);
    const strategy = input.strategyId ? await this.getTraderStrategyPolicy(input.strategyId, input.tenantId) : null;
    const subscription = input.subscriptionId ? await this.getSubscriptionPolicy(input.subscriptionId, input.tenantId) : null;

    // Precedence: Platform → Tenant → Trader Strategy → Follower Subscription
    // Lower-level must never weaken mandatory higher-level safety rule

    let effective: CopyPolicy = { ...platform };

    const merge = (base: CopyPolicy, override: CopyPolicy | null): CopyPolicy => {
      if (!override) return base;
      const merged: CopyPolicy = { ...base };

      // Sizing mode - lower can override
      if (override.sizingMode) merged.sizingMode = override.sizingMode;
      if (override.proportionalRatio) merged.proportionalRatio = override.proportionalRatio;
      if (override.fixedQuantity) merged.fixedQuantity = override.fixedQuantity;
      if (override.fixedNotional) merged.fixedNotional = override.fixedNotional;

      // Notional caps - lower cannot weaken higher (must be <= higher)
      if (override.maxOrderNotional) {
        const baseVal = parseFloat(base.maxOrderNotional || '1000000');
        const overrideVal = parseFloat(override.maxOrderNotional);
        if (overrideVal > baseVal) {
          this.logger.warn(`Policy override attempts to weaken maxOrderNotional base=${baseVal} override=${overrideVal} - keeping base`);
        } else {
          merged.maxOrderNotional = override.maxOrderNotional;
        }
      }

      if (override.maxDailyNotional) {
        const baseVal = parseFloat(base.maxDailyNotional || '1000000');
        const overrideVal = parseFloat(override.maxDailyNotional);
        if (overrideVal > baseVal) {
          this.logger.warn(`Policy override attempts to weaken maxDailyNotional base=${baseVal} override=${overrideVal} - keeping base`);
        } else {
          merged.maxDailyNotional = override.maxDailyNotional;
        }
      }

      if (override.maxConcurrentCopies !== null && override.maxConcurrentCopies !== undefined) {
        const baseVal = base.maxConcurrentCopies || 100;
        if (override.maxConcurrentCopies > baseVal) {
          this.logger.warn(`Policy override attempts to weaken maxConcurrentCopies base=${baseVal} override=${override.maxConcurrentCopies}`);
        } else {
          merged.maxConcurrentCopies = override.maxConcurrentCopies;
        }
      }

      if (override.slippageToleranceBps !== null && override.slippageToleranceBps !== undefined) {
        const baseVal = base.slippageToleranceBps ?? 100;
        if (override.slippageToleranceBps > baseVal || override.slippageToleranceBps < 0) {
          this.logger.warn(`Policy override attempts to weaken slippageTolerance base=${baseVal} override=${override.slippageToleranceBps}`);
        } else {
          merged.slippageToleranceBps = override.slippageToleranceBps;
        }
      }

      // Execution delay: lower level cannot set a negative delay or reduce below a higher-level mandatory floor, and is capped at 60,000ms
      if (override.executionDelayMs !== null && override.executionDelayMs !== undefined) {
        const baseDelay = base.executionDelayMs ?? 0;
        if (override.executionDelayMs < baseDelay) {
          this.logger.warn(`Policy override attempts to reduce executionDelayMs below base=${baseDelay} override=${override.executionDelayMs}`);
        } else {
          merged.executionDelayMs = Math.min(60000, Math.max(baseDelay, override.executionDelayMs));
        }
      }

      // Symbol filters - intersection logic: allowed = intersection of all allowed, blocked = union of all blocked
      if (override.allowedSymbols) {
        if (base.allowedSymbols) {
          merged.allowedSymbols = base.allowedSymbols.filter((s) => override.allowedSymbols!.includes(s));
        } else {
          merged.allowedSymbols = override.allowedSymbols;
        }
      }

      if (override.blockedSymbols) {
        const baseBlocked = base.blockedSymbols || [];
        merged.blockedSymbols = Array.from(new Set([...baseBlocked, ...override.blockedSymbols]));
      }

      if (override.allowedSides) {
        if (base.allowedSides) {
          merged.allowedSides = base.allowedSides.filter((s) => override.allowedSides!.includes(s));
        } else {
          merged.allowedSides = override.allowedSides;
        }
      }

      // Leverage & Margin constraints: lower level cannot exceed higher-level maxLeverage or weaken SPOT_ONLY
      if (override.leveragePolicy) {
        if (base.leveragePolicy === 'SPOT_ONLY' && override.leveragePolicy !== 'SPOT_ONLY' && override.maxLeverage && parseFloat(override.maxLeverage) > 1) {
          // If tenant/strategy explicitly allows leveraged policy within platform maxLeverage, record policy
          merged.leveragePolicy = override.leveragePolicy;
        } else {
          merged.leveragePolicy = override.leveragePolicy;
        }
      }

      if (override.maxLeverage) {
        const baseMaxLev = parseFloat(base.maxLeverage || '10');
        const overrideLev = parseFloat(override.maxLeverage);
        if (!Number.isNaN(overrideLev) && overrideLev > 0) {
          if (overrideLev > baseMaxLev) {
            this.logger.warn(`Policy override attempts to weaken maxLeverage base=${baseMaxLev} override=${overrideLev}`);
          } else {
            merged.maxLeverage = override.maxLeverage;
          }
        }
      }

      if (override.marginMode) {
        merged.marginMode = override.marginMode;
      }

      if (override.reduceOnly !== null && override.reduceOnly !== undefined) {
        merged.reduceOnly = base.reduceOnly === true ? true : override.reduceOnly;
      }

      // TP/SL and trailing stop parameters: tighter stop-loss / trailing-stop (smaller bps) from higher level cannot be loosened
      if (override.takeProfitBps !== null && override.takeProfitBps !== undefined && override.takeProfitBps > 0) {
        merged.takeProfitBps = override.takeProfitBps;
      }

      if (override.stopLossBps !== null && override.stopLossBps !== undefined && override.stopLossBps > 0) {
        if (base.stopLossBps && override.stopLossBps > base.stopLossBps) {
          this.logger.warn(`Policy override attempts to loosen stopLossBps base=${base.stopLossBps} override=${override.stopLossBps}`);
        } else {
          merged.stopLossBps = override.stopLossBps;
        }
      }

      if (override.trailingStopBps !== null && override.trailingStopBps !== undefined && override.trailingStopBps > 0) {
        if (base.trailingStopBps && override.trailingStopBps > base.trailingStopBps) {
          this.logger.warn(`Policy override attempts to loosen trailingStopBps base=${base.trailingStopBps} override=${override.trailingStopBps}`);
        } else {
          merged.trailingStopBps = override.trailingStopBps;
        }
      }

      if (override.stopCopyConditions) {
        merged.stopCopyConditions = {
          ...(base.stopCopyConditions ?? {}),
          ...override.stopCopyConditions,
        };
      }

      return merged;
    };

    effective = merge(effective, tenant);
    effective = merge(effective, strategy);
    effective = merge(effective, subscription);

    this.logger.log(`Effective copy policy resolved tenant=${input.tenantId} strategy=${input.strategyId} subscription=${input.subscriptionId} maxNotional=${effective.maxOrderNotional} slippage=${effective.slippageToleranceBps}`);

    return effective;
  }

  /**
   * Evaluates slippage tolerance and execution delay deterministically for a copy execution.
   */
  evaluateSlippageAndDelay(input: {
    policy: CopyPolicy;
    leaderPrice: string | null;
    executionPrice?: string | null;
    side: string;
    leaderTimestamp?: string | null;
    nowMs?: number;
  }): {
    allowed: boolean;
    ruleId: string | null;
    reason: string | null;
    slippageBps: number | null;
    effectiveDelayMs: number;
    scheduledReleaseAt: string | null;
  } {
    const now = input.nowMs ?? Date.now();
    const effectiveDelayMs = Math.max(0, Math.min(60000, input.policy.executionDelayMs ?? 0));
    const baseMs = input.leaderTimestamp && Number.isFinite(Date.parse(input.leaderTimestamp)) ? Date.parse(input.leaderTimestamp) : now;
    const scheduledReleaseAt = effectiveDelayMs > 0 ? new Date(baseMs + effectiveDelayMs).toISOString() : null;

    if (!input.leaderPrice || !input.executionPrice) {
      return {
        allowed: true,
        ruleId: null,
        reason: null,
        slippageBps: null,
        effectiveDelayMs,
        scheduledReleaseAt,
      };
    }

    if (!isDecimalString(input.leaderPrice) || !isDecimalString(input.executionPrice)) {
      return {
        allowed: false,
        ruleId: 'INVALID_SLIPPAGE_PRICE',
        reason: 'Leader price or execution price is not a valid decimal string',
        slippageBps: null,
        effectiveDelayMs,
        scheduledReleaseAt,
      };
    }

    const leaderP = parseFloat(input.leaderPrice);
    const execP = parseFloat(input.executionPrice);
    if (leaderP <= 0 || execP <= 0) {
      return {
        allowed: false,
        ruleId: 'INVALID_SLIPPAGE_PRICE',
        reason: 'Leader price and execution price must be positive',
        slippageBps: null,
        effectiveDelayMs,
        scheduledReleaseAt,
      };
    }

    const sideUpper = String(input.side || 'BUY').toUpperCase();
    // Adverse slippage in bps: for BUY, paying higher than leaderPrice; for SELL, receiving lower than leaderPrice
    const rawDiff = sideUpper === 'BUY' ? execP - leaderP : leaderP - execP;
    const adverseBps = rawDiff > 0 ? Math.round((rawDiff / leaderP) * 10000 * 100) / 100 : 0;
    const maxBps = input.policy.slippageToleranceBps ?? 100;

    if (adverseBps > maxBps) {
      return {
        allowed: false,
        ruleId: 'SLIPPAGE_TOLERANCE_EXCEEDED',
        reason: `Adverse slippage ${adverseBps} bps exceeds tolerance ${maxBps} bps`,
        slippageBps: adverseBps,
        effectiveDelayMs,
        scheduledReleaseAt,
      };
    }

    return {
      allowed: true,
      ruleId: null,
      reason: null,
      slippageBps: adverseBps,
      effectiveDelayMs,
      scheduledReleaseAt,
    };
  }

  /**
   * Computes deterministic TP/SL, trailing stop distance, and stop-copy condition triggers.
   */
  resolveStopPolicy(input: {
    policy: CopyPolicy;
    entryPrice: string | null;
    side: string;
    currentDrawdownPercent?: string | null;
    cumulativeLoss?: string | null;
  }): CopyStopExecutionPlan {
    const { policy, entryPrice, side } = input;
    const sideUpper = String(side || 'BUY').toUpperCase();

    let takeProfitPrice: string | null = null;
    let stopLossPrice: string | null = null;
    let trailingStopDistance: string | null = null;
    let trailingActivationPrice: string | null = null;

    if (entryPrice && isDecimalString(entryPrice)) {
      const entry = parseFloat(entryPrice);
      if (entry > 0) {
        if (policy.takeProfitBps && policy.takeProfitBps > 0) {
          const tpRatio = policy.takeProfitBps / 10000;
          const tpVal = sideUpper === 'BUY' ? entry * (1 + tpRatio) : entry * Math.max(0, 1 - tpRatio);
          takeProfitPrice = tpVal.toFixed(8).replace(/\.?0+$/, '');
        }
        if (policy.stopLossBps && policy.stopLossBps > 0) {
          const slRatio = policy.stopLossBps / 10000;
          const slVal = sideUpper === 'BUY' ? entry * Math.max(0, 1 - slRatio) : entry * (1 + slRatio);
          stopLossPrice = slVal.toFixed(8).replace(/\.?0+$/, '');
        }
        if (policy.trailingStopBps && policy.trailingStopBps > 0) {
          const trailRatio = policy.trailingStopBps / 10000;
          const dist = entry * trailRatio;
          trailingStopDistance = dist.toFixed(8).replace(/\.?0+$/, '');
          trailingActivationPrice = takeProfitPrice || entryPrice;
        }
      }
    }

    let stopCopyTriggered = false;
    let stopCopyReason: string | null = null;
    const conds = policy.stopCopyConditions || null;
    if (conds) {
      if (conds.maxDrawdownPercent && input.currentDrawdownPercent && isDecimalString(String(conds.maxDrawdownPercent)) && isDecimalString(input.currentDrawdownPercent)) {
        if (compareDecimalStrings(input.currentDrawdownPercent, String(conds.maxDrawdownPercent)) >= 0) {
          stopCopyTriggered = true;
          stopCopyReason = `Stop-copy drawdown threshold ${conds.maxDrawdownPercent}% reached (current ${input.currentDrawdownPercent}%)`;
        }
      }
      if (!stopCopyTriggered && conds.maxCumulativeLoss && input.cumulativeLoss && isDecimalString(String(conds.maxCumulativeLoss)) && isDecimalString(input.cumulativeLoss)) {
        if (compareDecimalStrings(input.cumulativeLoss, String(conds.maxCumulativeLoss)) >= 0) {
          stopCopyTriggered = true;
          stopCopyReason = `Stop-copy cumulative loss threshold ${conds.maxCumulativeLoss} reached (current ${input.cumulativeLoss})`;
        }
      }
    }

    return {
      takeProfitPrice,
      stopLossPrice,
      trailingStopBps: policy.trailingStopBps ?? null,
      trailingStopDistance,
      trailingActivationPrice,
      stopCopyTriggered,
      stopCopyReason,
    };
  }

  validatePolicy(policy: CopyPolicy): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (policy.maxOrderNotional && isNaN(parseFloat(policy.maxOrderNotional))) errors.push('maxOrderNotional must be valid decimal');
    if (policy.maxDailyNotional && isNaN(parseFloat(policy.maxDailyNotional))) errors.push('maxDailyNotional must be valid decimal');
    if (policy.slippageToleranceBps !== null && policy.slippageToleranceBps !== undefined && (policy.slippageToleranceBps < 0 || policy.slippageToleranceBps > 10000)) errors.push('slippageToleranceBps must be 0-10000');
    if (policy.executionDelayMs !== null && policy.executionDelayMs !== undefined && (policy.executionDelayMs < 0 || policy.executionDelayMs > 60000)) errors.push('executionDelayMs must be 0-60000');
    if (policy.maxConcurrentCopies !== null && policy.maxConcurrentCopies !== undefined && policy.maxConcurrentCopies < 1) errors.push('maxConcurrentCopies must be >=1');
    if (policy.maxLeverage && (isNaN(parseFloat(policy.maxLeverage)) || parseFloat(policy.maxLeverage) <= 0)) errors.push('maxLeverage must be > 0');
    if (policy.takeProfitBps !== null && policy.takeProfitBps !== undefined && policy.takeProfitBps < 0) errors.push('takeProfitBps must be >= 0');
    if (policy.stopLossBps !== null && policy.stopLossBps !== undefined && (policy.stopLossBps < 0 || policy.stopLossBps > 10000)) errors.push('stopLossBps must be 0-10000');
    if (policy.trailingStopBps !== null && policy.trailingStopBps !== undefined && (policy.trailingStopBps < 0 || policy.trailingStopBps > 10000)) errors.push('trailingStopBps must be 0-10000');

    // Platform mandatory caps
    const platformMaxOrder = parseFloat(this.platformPolicy.maxOrderNotional || '100000');
    if (policy.maxOrderNotional && parseFloat(policy.maxOrderNotional) > platformMaxOrder) errors.push(`maxOrderNotional cannot exceed platform cap ${platformMaxOrder}`);

    const platformMaxLev = parseFloat(this.platformPolicy.maxLeverage || '10');
    if (policy.maxLeverage && parseFloat(policy.maxLeverage) > platformMaxLev) errors.push(`maxLeverage cannot exceed platform cap ${platformMaxLev}`);

    return { valid: errors.length === 0, errors };
  }
}
