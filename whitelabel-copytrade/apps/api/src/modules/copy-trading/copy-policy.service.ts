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
  matchesSymbolRule,
} from './copy-trading.types';
import { Decimal, decimalFromScaled12, parseDecimalString } from '../../common/decimal-string';

/**
 * Whether adverse slippage was actually measured, stated explicitly because `slippageBps: null`
 * alone conflates two different situations: a movement too small to round to a displayed number,
 * and a movement nobody has taken yet. The copy record carries whichever it is.
 */
export type SlippageMeasurementState = 'MEASURED' | 'NOT_YET_MEASURED' | 'UNMEASURABLE';

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

      // Notional caps - lower cannot weaken higher (must be <= higher).
      //
      // Compared as exact decimals. These are money ceilings: deciding with a float means two
      // nearly-equal limits can order differently than they read, and an unparseable override would
      // be a silently-kept base. An override that cannot be parsed is treated as unweakenable too -
      // it is not evidence that the ceiling is safe to move.
      if (override.maxOrderNotional) {
        const baseNotional = Decimal.tryParse(base.maxOrderNotional ?? '1000000') ?? Decimal.parse('1000000');
        const overrideNotional = Decimal.tryParse(override.maxOrderNotional);
        if (!overrideNotional || overrideNotional.gt(baseNotional)) {
          this.logger.warn(`Policy override attempts to weaken maxOrderNotional base=${baseNotional.toString()} override=${override.maxOrderNotional} - keeping base`);
        } else {
          merged.maxOrderNotional = override.maxOrderNotional;
        }
      }

      if (override.maxDailyNotional) {
        const baseDaily = Decimal.tryParse(base.maxDailyNotional ?? '1000000') ?? Decimal.parse('1000000');
        const overrideDaily = Decimal.tryParse(override.maxDailyNotional);
        if (!overrideDaily || overrideDaily.gt(baseDaily)) {
          this.logger.warn(`Policy override attempts to weaken maxDailyNotional base=${baseDaily.toString()} override=${override.maxDailyNotional} - keeping base`);
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
        // Both branches of the original condition assigned the same value, so it was dead code
        // dressed as a rule. The rule that matters: SPOT_ONLY stays SPOT_ONLY unless a leverage
        // limit above 1 is actually supplied, and `maxLeverage` may not exceed the level it is
        // overriding.
        const suppliedLeverage = Decimal.tryParse(override.maxLeverage ?? '') ?? Decimal.ZERO;
        merged.leveragePolicy =
          base.leveragePolicy === 'SPOT_ONLY' &&
          override.leveragePolicy !== 'SPOT_ONLY' &&
          suppliedLeverage.lte(Decimal.ONE)
            ? base.leveragePolicy
            : override.leveragePolicy;
      }

      if (override.maxLeverage) {
        const baseMaxLev = Decimal.tryParse(base.maxLeverage ?? '10') ?? Decimal.parse('10');
        const overrideLev = Decimal.tryParse(override.maxLeverage);
        if (!overrideLev || !overrideLev.isPositive()) {
          // An unreadable or non-positive leverage limit is not a limit. Keep the base ceiling and
          // say so, rather than recording a value the venue would reject or read as unlimited.
          this.logger.warn(`Policy override carries an unusable maxLeverage override=${override.maxLeverage} - keeping base=${baseMaxLev.toString()}`);
        } else if (overrideLev.gt(baseMaxLev)) {
          this.logger.warn(`Policy override attempts to weaken maxLeverage base=${baseMaxLev.toString()} override=${overrideLev.toString()}`);
        } else {
          merged.maxLeverage = override.maxLeverage;
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
    slippageState: SlippageMeasurementState;
    effectiveDelayMs: number;
    scheduledReleaseAt: string | null;
  } {
    const now = input.nowMs ?? Date.now();
    const effectiveDelayMs = Math.max(0, Math.min(60000, input.policy.executionDelayMs ?? 0));
    const baseMs = input.leaderTimestamp && Number.isFinite(Date.parse(input.leaderTimestamp)) ? Date.parse(input.leaderTimestamp) : now;
    const scheduledReleaseAt = effectiveDelayMs > 0 ? new Date(baseMs + effectiveDelayMs).toISOString() : null;

    // No reference price means no baseline to measure against. The leader's fill price *is* the
    // slippage reference (see leader-event-source.service.ts), so its absence is a data fault
    // rather than an ordinary market order - and copying blind is the outcome this guardrail exists
    // to prevent. Refuse, and say which input was missing, instead of reporting a pass that was
    // never established.
    if (!input.leaderPrice) {
      return {
        allowed: false,
        ruleId: 'SLIPPAGE_REFERENCE_UNAVAILABLE',
        reason: 'Leader reference price is unavailable, so adverse slippage cannot be measured',
        slippageBps: null,
        slippageState: 'UNMEASURABLE',
        effectiveDelayMs,
        scheduledReleaseAt,
      };
    }

    if (!isDecimalString(input.leaderPrice)) {
      return {
        allowed: false,
        ruleId: 'INVALID_SLIPPAGE_PRICE',
        reason: 'Leader price is not a valid decimal string',
        slippageBps: null,
        slippageState: 'UNMEASURABLE',
        effectiveDelayMs,
        scheduledReleaseAt,
      };
    }

    // The follower's price is not known until it trades. Its absence is not a pass: the measurement
    // has not been taken, and the result says so rather than implying the movement was zero. What
    // constrains the fill in the meantime are the venue-side bounds on the mapped intent
    // (intent.slippageUpper / slippageLower), derived from this same tolerance.
    if (!input.executionPrice) {
      return {
        allowed: true,
        ruleId: null,
        reason: 'Follower execution price is not known yet; adverse slippage is not yet measured',
        slippageBps: null,
        slippageState: 'NOT_YET_MEASURED',
        effectiveDelayMs,
        scheduledReleaseAt,
      };
    }

    if (!isDecimalString(input.executionPrice)) {
      return {
        allowed: false,
        ruleId: 'INVALID_SLIPPAGE_PRICE',
        reason: 'Execution price is not a valid decimal string',
        slippageBps: null,
        slippageState: 'UNMEASURABLE',
        effectiveDelayMs,
        scheduledReleaseAt,
      };
    }

    // Exact decimals from here down. Prices arrive as decimal strings and are parsed into scale-12
    // integers, so the comparison that decides whether a customer's order may proceed is made on
    // exact values. The previous implementation divided IEEE doubles and rounded to two places
    // before comparing, which is not a basis for a verdict expressed in basis points.
    const leader = decimalFromScaled12(parseDecimalString(input.leaderPrice));
    const execution = decimalFromScaled12(parseDecimalString(input.executionPrice));

    if (!leader.isPositive() || !execution.isPositive()) {
      return {
        allowed: false,
        ruleId: 'INVALID_SLIPPAGE_PRICE',
        reason: 'Leader price and execution price must be positive',
        slippageBps: null,
        slippageState: 'UNMEASURABLE',
        effectiveDelayMs,
        scheduledReleaseAt,
      };
    }

    const sideUpper = String(input.side || 'BUY').toUpperCase();
    // Adverse slippage in bps: for BUY, paying higher than leaderPrice; for SELL, receiving lower
    // than leaderPrice. Favourable movement reports zero, never a negative allowance.
    const rawDiff = sideUpper === 'BUY' ? execution.sub(leader) : leader.sub(execution);
    const adverseBpsExact = rawDiff.isPositive()
      ? rawDiff.div(leader, 18, 'HALF_UP').mul(10_000).normalize()
      : Decimal.ZERO;

    // Compared unrounded; rounded only for the response field. Rounding first would let 25.004 bps
    // satisfy a 25 bps tolerance.
    const maxBpsExact = Decimal.parse(input.policy.slippageToleranceBps ?? 100);
    const displayedBps = Number(adverseBpsExact.toFixed(2, 'HALF_UP'));

    if (adverseBpsExact.gt(maxBpsExact)) {
      return {
        allowed: false,
        ruleId: 'SLIPPAGE_TOLERANCE_EXCEEDED',
        reason: `Adverse slippage ${adverseBpsExact.toString()} bps exceeds tolerance ${maxBpsExact.toString()} bps`,
        slippageBps: displayedBps,
        slippageState: 'MEASURED',
        effectiveDelayMs,
        scheduledReleaseAt,
      };
    }

    return {
      allowed: true,
      ruleId: null,
      reason: null,
      slippageBps: displayedBps,
      slippageState: 'MEASURED',
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
      const entry = decimalFromScaled12(parseDecimalString(entryPrice));
      if (entry.isPositive()) {
        // A bps delta is `entry * bps / 10000`, evaluated exactly at scale 18 and normalised. The
        // exit prices this produces are order instructions, so they are derived the same way the
        // order mapper derives its bounds rather than by scaling a double and trimming its digits.
        const deltaFor = (bps: number): Decimal =>
          entry.mul(Decimal.parse(bps)).div(10_000, 18, 'HALF_UP').normalize();
        const isBuy = sideUpper === 'BUY';

        if (policy.takeProfitBps && policy.takeProfitBps > 0) {
          const delta = deltaFor(policy.takeProfitBps);
          const raw = isBuy ? entry.add(delta) : entry.sub(delta);
          // A non-positive exit price is not a price. Omit it rather than emit 0, which downstream
          // would read as an instruction to exit at zero.
          takeProfitPrice = raw.isPositive() ? raw.toString() : null;
          if (!takeProfitPrice) {
            this.logger.warn(`takeProfitBps=${policy.takeProfitBps} against entry=${entryPrice} yields no positive price for a ${sideUpper}`);
          }
        }

        if (policy.stopLossBps && policy.stopLossBps > 0) {
          const delta = deltaFor(policy.stopLossBps);
          const raw = isBuy ? entry.sub(delta) : entry.add(delta);
          stopLossPrice = raw.isPositive() ? raw.toString() : null;
          if (!stopLossPrice) {
            // A stop-loss that cannot be expressed is a control that will not exist. Loud, not silent.
            this.logger.warn(`stopLossBps=${policy.stopLossBps} against entry=${entryPrice} yields no positive price for a ${sideUpper}; no stop-loss will be attached`);
          }
        }

        if (policy.trailingStopBps && policy.trailingStopBps > 0) {
          trailingStopDistance = deltaFor(policy.trailingStopBps).toString();
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

  /**
   * Validates the allow / deny symbol rules on a policy.
   *
   * Rules are globs (see `matchesSymbolRule`). Two failure modes are worth rejecting loudly because
   * both leave an operator believing in a restriction that does not exist:
   *
   *   - a rule that can never match anything - empty, padded with whitespace, or carrying a
   *     character no symbol contains. `'BTC USDT'` looks like a symbol and matches nothing.
   *   - a rule set that contradicts itself - a literal appearing in both lists, or a blocked glob
   *     that swallows an allowed entry, which makes the allow list unsatisfiable and blocks every
   *     copy the operator expected to permit.
   *
   * The platform's own `*WITHDRAWAL*` deny rule is a valid glob and passes; it is the matcher, not
   * this validator, that had to learn about patterns for that rule to mean anything.
   */
  validateSymbolRules(policy: CopyPolicy): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    const inspect = (rules: string[] | null | undefined, label: string): void => {
      if (rules === null || rules === undefined) return;
      if (!Array.isArray(rules)) {
        errors.push(`${label} must be an array of symbol rules`);
        return;
      }
      for (const rule of rules) {
        if (typeof rule !== 'string' || rule.trim().length === 0) {
          errors.push(`${label} contains an empty rule`);
          continue;
        }
        if (rule !== rule.trim()) {
          errors.push(`${label} rule "${rule}" has surrounding whitespace and will never match`);
        }
        if (/\s/.test(rule)) {
          errors.push(`${label} rule "${rule}" contains whitespace and will never match a symbol`);
        }
        if (!/^[A-Za-z0-9*._/$:-]+$/.test(rule)) {
          errors.push(`${label} rule "${rule}" contains characters that are not valid in a symbol or glob`);
        }
      }
    };

    inspect(policy.allowedSymbols, 'allowedSymbols');
    inspect(policy.blockedSymbols, 'blockedSymbols');

    const blocked = Array.isArray(policy.blockedSymbols) ? policy.blockedSymbols : [];
    const allowed = Array.isArray(policy.allowedSymbols) ? policy.allowedSymbols : [];

    if (blocked.some((rule) => rule.trim() === '*')) {
      errors.push("blockedSymbols '*' blocks every symbol");
    }

    for (const entry of allowed) {
      if (typeof entry !== 'string' || entry.length === 0) continue;
      const conflicting = blocked.find(
        (rule) => typeof rule === 'string' && !rule.includes('*') && rule.toUpperCase() === entry.toUpperCase(),
      );
      if (conflicting) {
        errors.push(`symbol ${entry} appears in both allowedSymbols and blockedSymbols`);
        continue;
      }
      // Only a literal allow entry can be swallowed unambiguously; comparing two globs would be a
      // claim this validator cannot support.
      if (!entry.includes('*')) {
        const swallower = blocked.find((rule) => typeof rule === 'string' && rule.includes('*') && matchesSymbolRule(rule, entry));
        if (swallower) {
          errors.push(`allowedSymbols entry ${entry} is blocked by rule ${swallower}, so no symbol can satisfy both`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  validatePolicy(policy: CopyPolicy): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (policy.maxOrderNotional && !isDecimalString(policy.maxOrderNotional)) errors.push('maxOrderNotional must be valid decimal');
    if (policy.maxDailyNotional && !isDecimalString(policy.maxDailyNotional)) errors.push('maxDailyNotional must be valid decimal');
    if (policy.slippageToleranceBps !== null && policy.slippageToleranceBps !== undefined && (policy.slippageToleranceBps < 0 || policy.slippageToleranceBps > 10000)) errors.push('slippageToleranceBps must be 0-10000');
    if (policy.executionDelayMs !== null && policy.executionDelayMs !== undefined && (policy.executionDelayMs < 0 || policy.executionDelayMs > 60000)) errors.push('executionDelayMs must be 0-60000');
    if (policy.maxConcurrentCopies !== null && policy.maxConcurrentCopies !== undefined && policy.maxConcurrentCopies < 1) errors.push('maxConcurrentCopies must be >=1');
    const parsedMaxLeverage = policy.maxLeverage ? Decimal.tryParse(policy.maxLeverage) : null;
    if (policy.maxLeverage && (!parsedMaxLeverage || !parsedMaxLeverage.isPositive())) errors.push('maxLeverage must be > 0');
    if (policy.takeProfitBps !== null && policy.takeProfitBps !== undefined && policy.takeProfitBps < 0) errors.push('takeProfitBps must be >= 0');
    if (policy.stopLossBps !== null && policy.stopLossBps !== undefined && (policy.stopLossBps < 0 || policy.stopLossBps > 10000)) errors.push('stopLossBps must be 0-10000');
    if (policy.trailingStopBps !== null && policy.trailingStopBps !== undefined && (policy.trailingStopBps < 0 || policy.trailingStopBps > 10000)) errors.push('trailingStopBps must be 0-10000');

    // Platform mandatory caps, compared exactly.
    const platformMaxOrder = this.platformPolicy.maxOrderNotional ?? '100000';
    if (policy.maxOrderNotional && compareDecimalStrings(policy.maxOrderNotional, platformMaxOrder) > 0) {
      errors.push(`maxOrderNotional cannot exceed platform cap ${platformMaxOrder}`);
    }

    const platformMaxLev = this.platformPolicy.maxLeverage ?? '10';
    if (parsedMaxLeverage && parsedMaxLeverage.gt(Decimal.parse(platformMaxLev))) {
      errors.push(`maxLeverage cannot exceed platform cap ${platformMaxLev}`);
    }

    return { valid: errors.length === 0, errors };
  }
}
