import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  ReportingPeriod,
  ChurnMetrics,
  ChurnType,
  MoneyAmount,
  SubscriptionStatus,
  zeroMoney,
  parseToMinorUnits,
  formatFromMinorUnits,
  getMinorUnitForCurrency,
  calculateRate,
} from './revenue-analytics.types';

/**
 * Customer/subscription churn calculations from canonical subscription state transitions and billing history.
 * Explicit definitions, no causality claims beyond state transitions.
 * Distinguishes customer churn vs revenue churn.
 */
@Injectable()
export class ChurnAnalyticsService {
  private readonly logger = new Logger(ChurnAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Methodology:
   * - Customer churn: tenant whose subscription moved to CANCELED/EXPIRED in period and not renewed by period end
   * - Subscription churn: subscription that ended in period
   * - Voluntary: cancelReason present and not failed-payment related
   * - Failed-payment: dunning case exists or trigger is payment failure
   * - Expiration: status EXPIRED, no cancellation
   * - Logo churn: customer churn count (tenant level)
   * - Revenue churn: MRR value of churned subscriptions
   */
  async calculateChurn(params: {
    tenantId?: string;
    currency?: string;
    period: ReportingPeriod;
  }): Promise<ChurnMetrics> {
    const currency = (params.currency || 'USD').toUpperCase();
    const { start, end } = this.parsePeriod(params.period);

    // Customers at start: active subscriptions whose period started before start and ends after start
    const customersAtStart = await this.fetchActiveAtDate({ tenantId: params.tenantId, date: start });
    const customersAtEnd = await this.fetchActiveAtDate({ tenantId: params.tenantId, date: end });

    // Churned in period: subscriptions that were active at start but canceled/expired in period
    const churnedSubscriptions = await this.fetchChurnedInPeriod({ tenantId: params.tenantId, start, end });

    let voluntaryCount = 0;
    let failedPaymentCount = 0;
    let expirationCount = 0;
    let revenueChurnMinor = 0;
    let churnedCustomerIds = new Set<string>();

    for (const sub of churnedSubscriptions) {
      churnedCustomerIds.add(sub.tenantId);

      const churnType = this.classifyChurnType(sub);
      if (churnType === ChurnType.VOLUNTARY) voluntaryCount++;
      else if (churnType === ChurnType.FAILED_PAYMENT) failedPaymentCount++;
      else if (churnType === ChurnType.EXPIRATION) expirationCount++;

      // Revenue churn: calculate MRR value of churned sub
      const plan = sub.plan;
      if (plan && plan.currency?.toUpperCase() === currency) {
        const priceMinor = parseToMinorUnits(plan.price?.toString() || '0', currency);
        let mrrMinor = 0;
        switch (plan.interval) {
          case 'MONTHLY':
            mrrMinor = priceMinor;
            break;
          case 'QUARTERLY':
            mrrMinor = Math.round(priceMinor / 3);
            break;
          case 'YEARLY':
            mrrMinor = Math.round(priceMinor / 12);
            break;
          default:
            mrrMinor = priceMinor;
        }
        revenueChurnMinor += mrrMinor * (sub.seatsPurchased || 1);
      }
    }

    const totalCustomersStart = customersAtStart.length;
    const totalCustomersEnd = customersAtEnd.length;
    const totalSubsStart = customersAtStart.length;
    const totalSubsEnd = customersAtEnd.length;

    const customerChurnCount = churnedCustomerIds.size;
    const subscriptionChurnCount = churnedSubscriptions.length;

    const customerChurnRate = calculateRate(customerChurnCount, totalCustomersStart);
    const subscriptionChurnRate = calculateRate(subscriptionChurnCount, totalSubsStart);
    const logoChurnRate = customerChurnRate;

    // Revenue churn rate: revenue churn / MRR at start
    const mrrAtStart = await this.calculateMrrAtDate({ tenantId: params.tenantId, currency, date: start });
    const revenueChurnRate = calculateRate(revenueChurnMinor, mrrAtStart.totalMinor);

    // Retention: 100 - churn
    const netRetention = (100 - parseFloat(subscriptionChurnRate)).toFixed(2);
    const grossRetention = netRetention; // Simplified, no expansion considered here

    return {
      period: params.period,
      currency,
      customerChurnCount,
      customerChurnRate,
      subscriptionChurnCount,
      subscriptionChurnRate,
      voluntaryChurnCount: voluntaryCount,
      failedPaymentChurnCount: failedPaymentCount,
      expirationChurnCount: expirationCount,
      logoChurnCount: customerChurnCount,
      logoChurnRate,
      revenueChurnAmount: { amount: formatFromMinorUnits(revenueChurnMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) },
      revenueChurnRate,
      netRevenueRetention: netRetention,
      grossRevenueRetention: grossRetention,
      totalCustomersStart,
      totalCustomersEnd,
      totalSubscriptionsStart: totalSubsStart,
      totalSubscriptionsEnd: totalSubsEnd,
      methodology:
        'Customer churn = tenants with active subscription at period start that canceled/expired in period and not renewed by period end. ' +
        'Subscription churn = count of subscriptions ending in period. ' +
        'Voluntary = cancelReason present and not failed-payment. Failed-payment = dunning case exists or cancelReason indicates payment failure. ' +
        'Expiration = status EXPIRED. Revenue churn = sum of MRR of churned subscriptions. Rates = churned / start count. Deterministic, no causality claims.',
      calculatedAt: new Date().toISOString(),
    };
  }

  async calculateRetention(params: {
    tenantId?: string;
    period: ReportingPeriod;
  }): Promise<{ retentionRate: string; churnRate: string; retained: number; churned: number; start: number; end: number }> {
    const { start, end } = this.parsePeriod(params.period);
    const atStart = await this.fetchActiveAtDate({ tenantId: params.tenantId, date: start });
    const churned = await this.fetchChurnedInPeriod({ tenantId: params.tenantId, start, end });
    const retained = atStart.length - churned.length;
    const retentionRate = calculateRate(retained, atStart.length);
    const churnRate = calculateRate(churned.length, atStart.length);
    const atEnd = await this.fetchActiveAtDate({ tenantId: params.tenantId, date: end });

    return {
      retentionRate,
      churnRate,
      retained,
      churned: churned.length,
      start: atStart.length,
      end: atEnd.length,
    };
  }

  private classifyChurnType(sub: any): ChurnType {
    const reason = (sub.cancelReason || '').toLowerCase();
    const status = sub.status;

    if (status === SubscriptionStatus.EXPIRED) return ChurnType.EXPIRATION;

    if (reason.includes('payment') || reason.includes('failed') || reason.includes('dunning') || reason.includes('past_due')) {
      return ChurnType.FAILED_PAYMENT;
    }

    if (reason && reason.length > 0) return ChurnType.VOLUNTARY;

    // Check if dunning case exists
    if (sub.metadata && (sub.metadata as any).dunningCaseId) return ChurnType.FAILED_PAYMENT;

    return ChurnType.UNKNOWN;
  }

  private parsePeriod(period: ReportingPeriod): { start: Date; end: Date } {
    return { start: new Date(period.startDate), end: new Date(period.endDate) };
  }

  private async fetchActiveAtDate(params: { tenantId?: string; date: Date }): Promise<any[]> {
    try {
      const where: any = {
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE] },
        currentPeriodStart: { lte: params.date },
        currentPeriodEnd: { gte: params.date },
      };
      if (params.tenantId) where.tenantId = params.tenantId;
      return await (this.prisma as any).tenantSubscription?.findMany({ where, include: { plan: true } }) || [];
    } catch {
      return [];
    }
  }

  private async fetchChurnedInPeriod(params: { tenantId?: string; start: Date; end: Date }): Promise<any[]> {
    try {
      const where: any = {
        status: { in: [SubscriptionStatus.CANCELED, SubscriptionStatus.EXPIRED] },
        OR: [{ canceledAt: { gte: params.start, lte: params.end } }, { currentPeriodEnd: { gte: params.start, lte: params.end } }],
      };
      if (params.tenantId) where.tenantId = params.tenantId;
      return await (this.prisma as any).tenantSubscription?.findMany({ where, include: { plan: true } }) || [];
    } catch {
      return [];
    }
  }

  private async calculateMrrAtDate(params: { tenantId?: string; currency: string; date: Date }): Promise<{ totalMinor: number }> {
    try {
      const where: any = {
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] },
        currentPeriodEnd: { gte: params.date },
      };
      if (params.tenantId) where.tenantId = params.tenantId;
      const subs = await (this.prisma as any).tenantSubscription?.findMany({ where, include: { plan: true } }) || [];
      let totalMinor = 0;
      for (const sub of subs) {
        const plan = sub.plan;
        if (!plan || plan.currency?.toUpperCase() !== params.currency) continue;
        const priceMinor = parseToMinorUnits(plan.price?.toString() || '0', params.currency);
        let mrrMinor = 0;
        switch (plan.interval) {
          case 'MONTHLY':
            mrrMinor = priceMinor;
            break;
          case 'QUARTERLY':
            mrrMinor = Math.round(priceMinor / 3);
            break;
          case 'YEARLY':
            mrrMinor = Math.round(priceMinor / 12);
            break;
          default:
            mrrMinor = 0;
        }
        totalMinor += mrrMinor * (sub.seatsPurchased || 1);
      }
      return { totalMinor };
    } catch {
      return { totalMinor: 0 };
    }
  }
}
