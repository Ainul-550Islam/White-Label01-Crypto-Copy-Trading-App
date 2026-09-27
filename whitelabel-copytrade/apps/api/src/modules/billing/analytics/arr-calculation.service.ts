import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  BillingInterval,
  SubscriptionStatus,
  MoneyAmount,
  ArrBreakdown,
  zeroMoney,
  parseToMinorUnits,
  formatFromMinorUnits,
  getMinorUnitForCurrency,
} from './revenue-analytics.types';

/**
 * Deterministic ARR calculation based on canonical recurring subscription state and normalized annual value.
 * MONTHLY × 12, QUARTERLY × 4, YEARLY × 1, LIFETIME excluded unless explicitly configured.
 * Uses canonical subscription state and price, Decimal-safe.
 */
@Injectable()
export class ArrCalculationService {
  private readonly logger = new Logger(ArrCalculationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async calculateArr(params: {
    tenantId?: string;
    currency?: string;
    asOfDate?: Date;
    includeTrials?: boolean;
    includeLifetimeAsRecurring?: boolean;
  }): Promise<ArrBreakdown | ArrBreakdown[]> {
    const asOfDate = params.asOfDate || new Date();
    const currencyFilter = params.currency?.toUpperCase();
    const includeTrials = params.includeTrials ?? false;
    const includeLifetime = params.includeLifetimeAsRecurring ?? false;

    const subscriptions = await this.fetchActiveSubscriptions({
      tenantId: params.tenantId,
      asOfDate,
      includeTrials,
    });

    if (subscriptions.length === 0) {
      const currency = currencyFilter || 'USD';
      return {
        totalArr: zeroMoney(currency),
        currency,
        activeSubscriptions: 0,
        calculationDate: asOfDate.toISOString(),
        methodology: 'Active recurring subscriptions normalized to annual: MONTHLY×12, QUARTERLY×4, YEARLY×1, LIFETIME excluded unless policy says recurring',
        byPlan: [],
        byInterval: [],
      };
    }

    const byCurrency = new Map<string, typeof subscriptions>();
    for (const sub of subscriptions) {
      const curr = (sub.plan?.currency || 'USD').toUpperCase();
      if (currencyFilter && curr !== currencyFilter) continue;
      if (!byCurrency.has(curr)) byCurrency.set(curr, []);
      byCurrency.get(curr)!.push(sub);
    }

    const results: ArrBreakdown[] = [];

    for (const [currency, subs] of byCurrency.entries()) {
      let totalMinor = 0;
      const byPlanMap = new Map<string, { planId: string; planCode: string; planName: string; arrMinor: number; count: number }>();
      const byIntervalMap = new Map<BillingInterval, { arrMinor: number; count: number }>();

      for (const sub of subs) {
        const plan = sub.plan;
        if (!plan) continue;

        const interval = (plan.interval as BillingInterval) || BillingInterval.MONTHLY;
        const priceStr = plan.price?.toString() || '0';
        const priceMinor = parseToMinorUnits(priceStr, currency);

        let arrMinor: number;
        switch (interval) {
          case BillingInterval.MONTHLY:
            arrMinor = priceMinor * 12;
            break;
          case BillingInterval.QUARTERLY:
            arrMinor = priceMinor * 4;
            break;
          case BillingInterval.YEARLY:
            arrMinor = priceMinor;
            break;
          case BillingInterval.LIFETIME:
            arrMinor = includeLifetime ? priceMinor : 0;
            break;
          default:
            arrMinor = priceMinor * 12;
        }

        const seats = sub.seatsPurchased || 1;
        if (seats > 1) arrMinor = arrMinor * seats;

        if (arrMinor === 0) continue;

        totalMinor += arrMinor;

        const planKey = plan.id;
        if (!byPlanMap.has(planKey)) {
          byPlanMap.set(planKey, { planId: plan.id, planCode: plan.code, planName: plan.name, arrMinor: 0, count: 0 });
        }
        const planAgg = byPlanMap.get(planKey)!;
        planAgg.arrMinor += arrMinor;
        planAgg.count += 1;

        if (!byIntervalMap.has(interval)) {
          byIntervalMap.set(interval, { arrMinor: 0, count: 0 });
        }
        const intervalAgg = byIntervalMap.get(interval)!;
        intervalAgg.arrMinor += arrMinor;
        intervalAgg.count += 1;
      }

      const totalArr = { amount: formatFromMinorUnits(totalMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) } as MoneyAmount;

      results.push({
        totalArr,
        currency,
        activeSubscriptions: subs.length,
        calculationDate: asOfDate.toISOString(),
        methodology: 'Active recurring subscriptions normalized to annual: MONTHLY×12, QUARTERLY×4, YEARLY×1, LIFETIME excluded unless policy says recurring. Decimal-safe minor-unit arithmetic.',
        byPlan: Array.from(byPlanMap.values()).map((v) => ({
          planId: v.planId,
          planCode: v.planCode,
          planName: v.planName,
          arr: { amount: formatFromMinorUnits(v.arrMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) },
          count: v.count,
        })),
        byInterval: Array.from(byIntervalMap.entries()).map(([interval, v]) => ({
          interval,
          arr: { amount: formatFromMinorUnits(v.arrMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) },
          count: v.count,
        })),
      });
    }

    if (currencyFilter) {
      return results[0] || {
        totalArr: zeroMoney(currencyFilter),
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

  async calculateArrForTenant(tenantId: string, currency?: string, asOfDate?: Date): Promise<ArrBreakdown> {
    const result = await this.calculateArr({ tenantId, currency, asOfDate });
    if (Array.isArray(result)) {
      return result[0] || {
        totalArr: zeroMoney(currency || 'USD'),
        currency: currency || 'USD',
        activeSubscriptions: 0,
        calculationDate: (asOfDate || new Date()).toISOString(),
        methodology: 'Tenant ARR',
        byPlan: [],
        byInterval: [],
      };
    }
    return result;
  }

  async calculatePlatformArr(currency?: string): Promise<ArrBreakdown[]> {
    const result = await this.calculateArr({ currency });
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
      this.logger.warn(`Failed to fetch active subscriptions for ARR: ${e.message}`);
      return [];
    }
  }

  normalizeToArr(price: string, interval: BillingInterval, currency: string, includeLifetime = false): MoneyAmount {
    const minor = parseToMinorUnits(price, currency);
    let arrMinor: number;
    switch (interval) {
      case BillingInterval.MONTHLY:
        arrMinor = minor * 12;
        break;
      case BillingInterval.QUARTERLY:
        arrMinor = minor * 4;
        break;
      case BillingInterval.YEARLY:
        arrMinor = minor;
        break;
      case BillingInterval.LIFETIME:
        arrMinor = includeLifetime ? minor : 0;
        break;
      default:
        arrMinor = minor * 12;
    }
    return { amount: formatFromMinorUnits(arrMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) };
  }
}
