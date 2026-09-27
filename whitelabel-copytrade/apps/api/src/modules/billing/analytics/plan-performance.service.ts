import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  ReportingPeriod,
  PlanPerformanceMetrics,
  MoneyAmount,
  BillingInterval,
  SubscriptionStatus,
  zeroMoney,
  parseToMinorUnits,
  formatFromMinorUnits,
  getMinorUnitForCurrency,
  calculateRate,
} from './revenue-analytics.types';

/**
 * Plan analytics for every canonical plan: subscribers, MRR, ARR, gross/net revenue, refunds, churn, upgrades, downgrades, tenure, utilization.
 * Reads from canonical plan catalog, no hardcoded plan definitions.
 */
@Injectable()
export class PlanPerformanceService {
  private readonly logger = new Logger(PlanPerformanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async calculatePlanPerformance(params: {
    currency?: string;
    period: ReportingPeriod;
    planId?: string;
  }): Promise<PlanPerformanceMetrics[]> {
    const currency = (params.currency || 'USD').toUpperCase();
    const { start, end } = this.parsePeriod(params.period);

    // Fetch canonical plans
    const plans = await this.fetchPlans({ currency, planId: params.planId });

    const results: PlanPerformanceMetrics[] = [];

    for (const plan of plans) {
      if (plan.currency?.toUpperCase() !== currency) continue;

      const subscriptions = await this.fetchSubscriptionsForPlan({ planId: plan.id, start, end });
      const payments = await this.fetchPaymentsForPlan({ planId: plan.id, currency, start, end });
      const refunds = await this.fetchRefundsForPlan({ planId: plan.id, currency, start, end });

      let active = 0;
      let trial = 0;
      let cancelled = 0;
      let newSubs = 0;
      let churned = 0;
      let totalTenureDays = 0;
      let upgradeCount = 0;
      let downgradeCount = 0;

      for (const sub of subscriptions) {
        if (sub.status === SubscriptionStatus.ACTIVE) active++;
        if (sub.status === SubscriptionStatus.TRIALING) trial++;
        if (sub.status === SubscriptionStatus.CANCELED) cancelled++;
        if (new Date(sub.createdAt) >= start && new Date(sub.createdAt) <= end) newSubs++;
        if (sub.canceledAt && new Date(sub.canceledAt) >= start && new Date(sub.canceledAt) <= end) churned++;

        const tenureMs = new Date(sub.currentPeriodEnd).getTime() - new Date(sub.currentPeriodStart).getTime();
        totalTenureDays += tenureMs / (1000 * 60 * 60 * 24);

        const meta = sub.metadata as any;
        if (meta?.changeType === 'UPGRADE') upgradeCount++;
        if (meta?.changeType === 'DOWNGRADE') downgradeCount++;
      }

      // MRR/ARR calculation for this plan
      const priceMinor = parseToMinorUnits(plan.price?.toString() || '0', currency);
      let mrrPerSubMinor = 0;
      let arrPerSubMinor = 0;

      switch (plan.interval) {
        case 'MONTHLY':
          mrrPerSubMinor = priceMinor;
          arrPerSubMinor = priceMinor * 12;
          break;
        case 'QUARTERLY':
          mrrPerSubMinor = Math.round(priceMinor / 3);
          arrPerSubMinor = priceMinor * 4;
          break;
        case 'YEARLY':
          mrrPerSubMinor = Math.round(priceMinor / 12);
          arrPerSubMinor = priceMinor;
          break;
        case 'LIFETIME':
          mrrPerSubMinor = 0;
          arrPerSubMinor = 0;
          break;
        default:
          mrrPerSubMinor = priceMinor;
          arrPerSubMinor = priceMinor * 12;
      }

      const activeCount = active;
      const mrrMinor = mrrPerSubMinor * activeCount;
      const arrMinor = arrPerSubMinor * activeCount;

      // Revenue from payments
      let grossMinor = 0;
      for (const p of payments) {
        if (['SUCCEEDED', 'PAID', 'COMPLETED'].includes((p.status || '').toUpperCase())) {
          grossMinor += parseToMinorUnits(p.amount || '0', currency);
        }
      }

      let refundMinor = 0;
      for (const r of refunds) {
        if (['SUCCEEDED', 'COMPLETED'].includes((r.status || '').toUpperCase())) {
          refundMinor += parseToMinorUnits(r.amount || '0', currency);
        }
      }

      const netMinor = grossMinor - refundMinor;
      const avgTenure = subscriptions.length > 0 ? totalTenureDays / subscriptions.length : 0;
      const churnRate = calculateRate(churned, subscriptions.length);

      // Utilization: from usage meters if available
      let utilizationRate: string | undefined;
      try {
        const usageMeters = await (this.prisma as any).usageMeter?.findMany({
          where: { createdAt: { gte: start, lte: end } },
        }) || [];
        if (usageMeters.length > 0) {
          const totalUsage = usageMeters.reduce((sum: number, m: any) => sum + (m.currentValue || 0), 0);
          const totalMax = usageMeters.reduce((sum: number, m: any) => sum + (m.maxValue || 0), 0);
          if (totalMax > 0) utilizationRate = calculateRate(totalUsage, totalMax);
        }
      } catch {}

      results.push({
        planId: plan.id,
        planCode: plan.code,
        planName: plan.name,
        currency,
        period: params.period,
        subscribers: subscriptions.length,
        activeSubscribers: active,
        trialSubscribers: trial,
        cancelledSubscribers: cancelled,
        newSubscribers: newSubs,
        churnedSubscribers: churned,
        mrr: { amount: formatFromMinorUnits(mrrMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) },
        arr: { amount: formatFromMinorUnits(arrMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) },
        grossRevenue: { amount: formatFromMinorUnits(grossMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) },
        netRevenue: { amount: formatFromMinorUnits(netMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) },
        refunds: { amount: formatFromMinorUnits(refundMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) },
        churnRate,
        upgradeCount,
        downgradeCount,
        averageTenureDays: Math.round(avgTenure * 100) / 100,
        utilizationRate,
        calculatedAt: new Date().toISOString(),
      });
    }

    return results;
  }

  async getTopPlansByRevenue(params: {
    currency?: string;
    period: ReportingPeriod;
    limit?: number;
  }): Promise<PlanPerformanceMetrics[]> {
    const all = await this.calculatePlanPerformance({ currency: params.currency, period: params.period });
    return all.sort((a, b) => parseToMinorUnits(b.grossRevenue.amount, b.currency) - parseToMinorUnits(a.grossRevenue.amount, a.currency)).slice(0, params.limit || 10);
  }

  private parsePeriod(period: ReportingPeriod): { start: Date; end: Date } {
    return { start: new Date(period.startDate), end: new Date(period.endDate) };
  }

  private async fetchPlans(params: { currency: string; planId?: string }): Promise<any[]> {
    try {
      const where: any = { isActive: true, deletedAt: null };
      if (params.planId) where.id = params.planId;
      // Currency filter not in DB for all, filter after
      const plans = await (this.prisma as any).subscriptionPlan?.findMany({ where }) || [];
      return plans.filter((p: any) => !params.currency || p.currency?.toUpperCase() === params.currency.toUpperCase());
    } catch (e: any) {
      this.logger.warn(`Failed to fetch plans: ${e.message}`);
      return [];
    }
  }

  private async fetchSubscriptionsForPlan(params: { planId: string; start: Date; end: Date }): Promise<any[]> {
    try {
      return await (this.prisma as any).tenantSubscription?.findMany({
        where: {
          planId: params.planId,
          createdAt: { lte: params.end },
          currentPeriodEnd: { gte: params.start },
        },
      }) || [];
    } catch {
      return [];
    }
  }

  private async fetchPaymentsForPlan(params: { planId: string; currency: string; start: Date; end: Date }): Promise<any[]> {
    try {
      return await (this.prisma as any).payment?.findMany({
        where: {
          planId: params.planId,
          currency: params.currency,
          createdAt: { gte: params.start, lte: params.end },
        },
      }) || [];
    } catch {
      return [];
    }
  }

  private async fetchRefundsForPlan(params: { planId: string; currency: string; start: Date; end: Date }): Promise<any[]> {
    try {
      // Refunds linked via payment -> plan, so we need to join
      const payments = await (this.prisma as any).payment?.findMany({ where: { planId: params.planId } }) || [];
      const paymentIds = payments.map((p: any) => p.id);
      if (paymentIds.length === 0) return [];
      return await (this.prisma as any).refund?.findMany({
        where: {
          paymentId: { in: paymentIds },
          currency: params.currency,
          createdAt: { gte: params.start, lte: params.end },
        },
      }) || [];
    } catch {
      return [];
    }
  }
}
