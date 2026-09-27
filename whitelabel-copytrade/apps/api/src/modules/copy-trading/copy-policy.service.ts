import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CopyPolicy, CopySizingMode } from './copy-trading.types';

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
    leveragePolicy: null,
    reduceOnly: null,
    stopCopyConditions: null,
  };

  constructor(private readonly prisma: PrismaService) {}

  async getPlatformPolicy(): Promise<CopyPolicy> {
    return this.platformPolicy;
  }

  async getTenantPolicy(tenantId: string): Promise<CopyPolicy | null> {
    try {
      const setting = await this.prisma.tenantSetting.findFirst({ where: { tenantId, key: 'copy_trading_policy' } });
      if (setting && setting.value) {
        return setting.value as any as CopyPolicy;
      }
    } catch {}
    return null;
  }

  async getTraderStrategyPolicy(strategyId: string): Promise<CopyPolicy | null> {
    try {
      const strategy = await (this.prisma as any).traderStrategy?.findFirst({ where: { id: strategyId } });
      if (strategy && strategy.riskProfile) {
        // Extract copy policy from riskProfile or strategyConfig
        return {
          sizingMode: strategy.strategyConfig?.sizingMode || CopySizingMode.PROPORTIONAL,
          proportionalRatio: strategy.strategyConfig?.proportionalRatio || null,
          fixedQuantity: null,
          fixedNotional: null,
          maxOrderNotional: strategy.riskProfile?.maxOrderNotional || null,
          maxDailyNotional: strategy.riskProfile?.maxDailyNotional || null,
          maxConcurrentCopies: strategy.riskProfile?.maxConcurrentCopies || null,
          slippageToleranceBps: strategy.strategyConfig?.slippageToleranceBps || null,
          executionDelayMs: strategy.strategyConfig?.executionDelayMs || null,
          allowedSymbols: strategy.supportedSymbols || null,
          blockedSymbols: null,
          allowedSides: null,
          leveragePolicy: null,
          reduceOnly: null,
          stopCopyConditions: null,
        };
      }
    } catch {}
    return null;
  }

  async getSubscriptionPolicy(subscriptionId: string): Promise<CopyPolicy | null> {
    try {
      const sub = await (this.prisma as any).copySubscription?.findFirst({ where: { id: subscriptionId } });
      if (sub && sub.copyPolicy) {
        return sub.copyPolicy as CopyPolicy;
      }
    } catch {}
    return null;
  }

  async resolveEffectivePolicy(input: { tenantId: string; strategyId?: string; subscriptionId?: string }): Promise<CopyPolicy> {
    const platform = await this.getPlatformPolicy();
    const tenant = await this.getTenantPolicy(input.tenantId);
    const strategy = input.strategyId ? await this.getTraderStrategyPolicy(input.strategyId) : null;
    const subscription = input.subscriptionId ? await this.getSubscriptionPolicy(input.subscriptionId) : null;

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
        const baseVal = base.slippageToleranceBps || 100;
        if (override.slippageToleranceBps > baseVal) {
          this.logger.warn(`Policy override attempts to weaken slippageTolerance base=${baseVal} override=${override.slippageToleranceBps}`);
        } else {
          merged.slippageToleranceBps = override.slippageToleranceBps;
        }
      }

      if (override.executionDelayMs !== null && override.executionDelayMs !== undefined) {
        merged.executionDelayMs = override.executionDelayMs;
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

      if (override.leveragePolicy) merged.leveragePolicy = override.leveragePolicy;
      if (override.reduceOnly !== null && override.reduceOnly !== undefined) merged.reduceOnly = override.reduceOnly;
      if (override.stopCopyConditions) merged.stopCopyConditions = override.stopCopyConditions;

      return merged;
    };

    effective = merge(effective, tenant);
    effective = merge(effective, strategy);
    effective = merge(effective, subscription);

    this.logger.log(`Effective copy policy resolved tenant=${input.tenantId} strategy=${input.strategyId} subscription=${input.subscriptionId} maxNotional=${effective.maxOrderNotional} slippage=${effective.slippageToleranceBps}`);

    return effective;
  }

  validatePolicy(policy: CopyPolicy): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (policy.maxOrderNotional && isNaN(parseFloat(policy.maxOrderNotional))) errors.push('maxOrderNotional must be valid decimal');
    if (policy.maxDailyNotional && isNaN(parseFloat(policy.maxDailyNotional))) errors.push('maxDailyNotional must be valid decimal');
    if (policy.slippageToleranceBps !== null && policy.slippageToleranceBps !== undefined && (policy.slippageToleranceBps < 0 || policy.slippageToleranceBps > 10000)) errors.push('slippageToleranceBps must be 0-10000');
    if (policy.executionDelayMs !== null && policy.executionDelayMs !== undefined && policy.executionDelayMs < 0) errors.push('executionDelayMs must be >=0');
    if (policy.maxConcurrentCopies !== null && policy.maxConcurrentCopies !== undefined && policy.maxConcurrentCopies < 1) errors.push('maxConcurrentCopies must be >=1');

    // Platform mandatory caps
    const platformMaxOrder = parseFloat(this.platformPolicy.maxOrderNotional || '100000');
    if (policy.maxOrderNotional && parseFloat(policy.maxOrderNotional) > platformMaxOrder) errors.push(`maxOrderNotional cannot exceed platform cap ${platformMaxOrder}`);

    return { valid: errors.length === 0, errors };
  }
}
