import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  BillingInterval,
  SubscriptionStatus,
  MoneyAmount,
  MrrBreakdown,
  createMoneyAmount,
  zeroMoney,
  addMoneyAmounts,
  divideMoneyAmount,
  parseToMinorUnits,
  formatFromMinorUnits,
  getMinorUnitForCurrency,
} from './revenue-analytics.types';

/**
 * Deterministic MRR calculation from active recurring subscriptions using canonical plan/interval/price.
 * - MONTHLY: price
 * - QUARTERLY: price / 3
 * - YEARLY: price / 12
 * - LIFETIME: excluded unless explicitly configured as recurring-equivalent
 * Decimal-safe, no hardcoded prices, uses canonical subscription price.
 */
@Injectable()
export class MrrCalculationService {
  private readonly logger = new Logger(MrrCalculationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calculate MRR from canonical active subscriptions.
   * Tenant isolation enforced, currency buckets separated.
   */
  async calculateMrr(params: {
    tenantId?: string; // undefined = platform aggregate
    currency?: string; // if undefined, returns per-currency buckets
    asOfDate?: Date;
    includeTrials?: boolean;
    includeLifetimeAsRecurring?: boolean;
    lifetimeRecurringPolicy?: boolean;
  }): Promise<MrrBreakdown | MrrBreakdown[]> {
    const asOfDate = params.asOfDate || new Date();
    const currencyFilter = params.currency?.toUpperCase();
    const includeTrials = params.includeTrials ?? false;
    const includeLifetime = params.includeLifetimeAsRecurring ?? false;

    // Fetch active recurring subscriptions
    const subscriptions = await this.fetchActiveSubscriptions({
      tenantId: params.tenantId,
      asOfDate,
      includeTrials,
    });

    if (subscriptions.length === 0) {
      const currency = currencyFilter || 'USD';
      return {
        totalMrr: zeroMoney(currency),
        newMrr: zeroMoney(currency),
        expansionMrr: zeroMoney(currency),
        contractionMrr: zeroMoney(currency),
        churnedMrr: zeroMoney(currency),
        netNewMrr: zeroMoney(currency),
        currency,
        activeSubscriptions: 0,
        calculationDate: asOfDate.toISOString(),
        methodology: 'Active recurring subscriptions normalized to monthly: MONTHLY=price, QUARTERLY=price/3, YEARLY=price/12, LIFETIME excluded unless policy says recurring',
        byPlan: [],
        byInterval: [],
      };
    }

    // Group by currency
    const byCurrency = new Map<string, typeof subscriptions>();
    for (const sub of subscriptions) {
      const curr = (sub.plan?.currency || 'USD').toUpperCase();
      if (currencyFilter && curr !== currencyFilter) continue;
      if (!byCurrency.has(curr)) byCurrency.set(curr, []);
      byCurrency.get(curr)!.push(sub);
    }

    const results: MrrBreakdown[] = [];

    for (const [currency, subs] of byCurrency.entries()) {
      let totalMinor = 0;
      const byPlanMap = new Map<string, { planId: string; planCode: string; planName: string; mrrMinor: number; count: number }>();
      const byIntervalMap = new Map<BillingInterval, { mrrMinor: number; count: number }>();

      for (const sub of subs) {
        const plan = sub.plan;
        if (!plan) continue;

        const interval = (plan.interval as BillingInterval) || BillingInterval.MONTHLY;
        const priceStr = plan.price?.toString() || '0';
        const priceMinor = parseToMinorUnits(priceStr, currency);

        let mrrMinor: number;
        switch (interval) {
          case BillingInterval.MONTHLY:
            mrrMinor = priceMinor;
            break;
          case BillingInterval.QUARTERLY:
            mrrMinor = Math.round(priceMinor / 3);
            break;
          case BillingInterval.YEARLY:
            mrrMinor = Math.round(priceMinor / 12);
            break;
          case BillingInterval.LIFETIME:
            if (!includeLifetime) {
              mrrMinor = 0; // Excluded by default
            } else {
              // If explicitly configured as recurring-equivalent, treat as yearly/12 or as configured
              mrrMinor = Math.round(priceMinor / 12);
            }
            break;
          default:
            mrrMinor = priceMinor;
        }

        // Apply seats if >1 (if plan pricing is per seat, multiply)
        const seats = sub.seatsPurchased || 1;
        if (seats > 1) {
          mrrMinor = mrrMinor * seats;
        }

        if (mrrMinor === 0) continue;

        totalMinor += mrrMinor;

        // By plan
        const planKey = plan.id;
        if (!byPlanMap.has(planKey)) {
          byPlanMap.set(planKey, { planId: plan.id, planCode: plan.code, planName: plan.name, mrrMinor: 0, count: 0 });
        }
        const planAgg = byPlanMap.get(planKey)!;
        planAgg.mrrMinor += mrrMinor;
        planAgg.count += 1;

        // By interval
        if (!byIntervalMap.has(interval)) {
          byIntervalMap.set(interval, { mrrMinor: 0, count: 0 });
        }
        const intervalAgg = byIntervalMap.get(interval)!;
        intervalAgg.mrrMinor += mrrMinor;
        intervalAgg.count += 1;
      }

      const totalMrr = { amount: formatFromMinorUnits(totalMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) } as MoneyAmount;

      results.push({
        totalMrr,
        newMrr: zeroMoney(currency), // Calculated in revenue service with period comparison
        expansionMrr: zeroMoney(currency),
        contractionMrr: zeroMoney(currency),
        churnedMrr: zeroMoney(currency),
        netNewMrr: totalMrr,
        currency,
        activeSubscriptions: subs.length,
        calculationDate: asOfDate.toISOString(),
        methodology: 'Active recurring subscriptions normalized to monthly: MONTHLY=price, QUARTERLY=price/3, YEARLY=price/12, LIFETIME excluded unless policy says recurring. Decimal-safe minor-unit arithmetic.',
        byPlan: Array.from(byPlanMap.values()).map((v) => ({
          planId: v.planId,
          planCode: v.planCode,
          planName: v.planName,
          mrr: { amount: formatFromMinorUnits(v.mrrMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) },
          count: v.count,
        })),
        byInterval: Array.from(byIntervalMap.entries()).map(([interval, v]) => ({
          interval,
          mrr: { amount: formatFromMinorUnits(v.mrrMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) },
          count: v.count,
        })),
      });
    }

    if (currencyFilter) {
      return results[0] || {
        totalMrr: zeroMoney(currencyFilter),
        newMrr: zeroMoney(currencyFilter),
        expansionMrr: zeroMoney(currencyFilter),
        contractionMrr: zeroMoney(currencyFilter),
        churnedMrr: zeroMoney(currencyFilter),
        netNewMrr: zeroMoney(currencyFilter),
        currency: currencyFilter,
        activeSubscriptions: 0,
        calculationDate: asOfDate.toISOString(),
        methodology: 'No active subscriptions for currency',
        byPlan: [],
        byInterval: [],
      };
    }

    return results;
  }

  async calculateMrrForTenant(tenantId: string, currency?: string, asOfDate?: Date): Promise<MrrBreakdown> {
    const result = await this.calculateMrr({ tenantId, currency, asOfDate });
    if (Array.isArray(result)) {
      return result[0] || {
        totalMrr: zeroMoney(currency || 'USD'),
        newMrr: zeroMoney(currency || 'USD'),
        expansionMrr: zeroMoney(currency || 'USD'),
        contractionMrr: zeroMoney(currency || 'USD'),
        churnedMrr: zeroMoney(currency || 'USD'),
        netNewMrr: zeroMoney(currency || 'USD'),
        currency: currency || 'USD',
        activeSubscriptions: 0,
        calculationDate: (asOfDate || new Date()).toISOString(),
        methodology: 'Tenant MRR',
        byPlan: [],
        byInterval: [],
      };
    }
    return result;
  }

  async calculatePlatformMrr(currency?: string): Promise<MrrBreakdown[]> {
    const result = await this.calculateMrr({ currency });
    return Array.isArray(result) ? result : [result];
  }

  private async fetchActiveSubscriptions(params: { tenantId?: string; asOfDate: Date; includeTrials: boolean }): Promise<any[]> {
    const { tenantId, asOfDate, includeTrials } = params;
    const statuses = includeTrials
      ? [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE]
      : [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE];

    try {
      const where: any = {
        status: { in: statuses },
        currentPeriodEnd: { gte: asOfDate },
      };
      if (tenantId) where.tenantId = tenantId;

      const subs = await (this.prisma as any).tenantSubscription.findMany({
        where,
        include: { plan: true },
      });
      return subs || [];
    } catch (e: any) {
      this.logger.warn(`Failed to fetch active subscriptions: ${e.message}`);
      return [];
    }
  }

  /**
   * Normalize price to MRR based on interval - Decimal-safe
   */
  normalizeToMrr(price: string, interval: BillingInterval, currency: string, includeLifetime = false): MoneyAmount {
    const minor = parseToMinorUnits(price, currency);
    let mrrMinor: number;
    switch (interval) {
      case BillingInterval.MONTHLY:
        mrrMinor = minor;
        break;
      case BillingInterval.QUARTERLY:
        mrrMinor = Math.round(minor / 3);
        break;
      case BillingInterval.YEARLY:
        mrrMinor = Math.round(minor / 12);
        break;
      case BillingInterval.LIFETIME:
        mrrMinor = includeLifetime ? Math.round(minor / 12) : 0;
        break;
      default:
        mrrMinor = minor;
    }
    return { amount: formatFromMinorUnits(mrrMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) };
  }
}
