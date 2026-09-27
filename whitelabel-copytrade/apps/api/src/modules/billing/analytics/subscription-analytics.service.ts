import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  ReportingPeriod,
  SubscriptionKpis,
  BillingInterval,
  SubscriptionStatus,
  calculateRate,
} from './revenue-analytics.types';

/**
 * Subscription lifecycle analytics: active/trial/cancelled/expired, upgrades, downgrades, renewals, plan distribution, interval distribution, retention.
 * Derive state from canonical subscription records/history, do not invent state transitions.
 */
@Injectable()
export class SubscriptionAnalyticsService {
  private readonly logger = new Logger(SubscriptionAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async calculateSubscriptionKpis(params: {
    tenantId?: string;
    period: ReportingPeriod;
  }): Promise<SubscriptionKpis> {
    const { start, end } = this.parsePeriod(params.period);

    const subscriptions = await this.fetchSubscriptionsInPeriod({ tenantId: params.tenantId, start, end });
    const allActive = await this.fetchCurrentActive({ tenantId: params.tenantId });

    let active = 0;
    let trial = 0;
    let cancelled = 0;
    let expired = 0;
    let scheduled = 0;
    let newSubs = 0;
    let renewed = 0;
    let churned = 0;
    let upgraded = 0;
    let downgraded = 0;
    let totalTenureDays = 0;
    let totalSeats = 0;

    const planDistributionMap = new Map<string, { planId: string; planCode: string; planName: string; count: number }>();
    const intervalDistributionMap = new Map<BillingInterval, number>();
    const statusDistributionMap = new Map<SubscriptionStatus, number>();

    for (const sub of subscriptions) {
      const status = sub.status as SubscriptionStatus;
      statusDistributionMap.set(status, (statusDistributionMap.get(status) || 0) + 1);

      if (status === SubscriptionStatus.ACTIVE) active++;
      if (status === SubscriptionStatus.TRIALING) trial++;
      if (status === SubscriptionStatus.CANCELED) cancelled++;
      if (status === SubscriptionStatus.EXPIRED) expired++;
      if (sub.cancelAtPeriodEnd) scheduled++;

      // New subscriptions created in period
      if (new Date(sub.createdAt) >= start && new Date(sub.createdAt) <= end) {
        newSubs++;
      }

      // Renewals: subscriptions whose currentPeriodStart is in period and not first creation
      if (new Date(sub.currentPeriodStart) >= start && new Date(sub.currentPeriodStart) <= end) {
        const created = new Date(sub.createdAt).getTime();
        const periodStart = new Date(sub.currentPeriodStart).getTime();
        if (Math.abs(periodStart - created) > 60 * 1000) {
          renewed++;
        }
      }

      // Churned: cancelled or expired in period
      if (sub.canceledAt && new Date(sub.canceledAt) >= start && new Date(sub.canceledAt) <= end) {
        churned++;
      }

      // Tenure
      const tenureMs = new Date(sub.currentPeriodEnd).getTime() - new Date(sub.currentPeriodStart).getTime();
      totalTenureDays += tenureMs / (1000 * 60 * 60 * 24);
      totalSeats += sub.seatsPurchased || 1;

      // Plan distribution
      const plan = sub.plan;
      if (plan) {
        const key = plan.id;
        if (!planDistributionMap.has(key)) {
          planDistributionMap.set(key, { planId: plan.id, planCode: plan.code, planName: plan.name, count: 0 });
        }
        planDistributionMap.get(key)!.count++;

        const interval = (plan.interval as BillingInterval) || BillingInterval.MONTHLY;
        intervalDistributionMap.set(interval, (intervalDistributionMap.get(interval) || 0) + 1);
      }

      // Upgrade/downgrade detection from metadata
      const metadata = sub.metadata as any;
      if (metadata?.changeType === 'UPGRADE' || metadata?.pendingPlanCode) {
        // Simple heuristic: if metadata indicates upgrade, count
        // More accurate would require plan change history
        if (metadata.changeType === 'UPGRADE') upgraded++;
        if (metadata.changeType === 'DOWNGRADE') downgraded++;
      }
    }

    // For upgrades/downgrades, also check plan change audit if available
    try {
      const auditLogs = await (this.prisma as any).auditLog?.findMany({
        where: {
          action: { in: ['SUBSCRIPTION_UPDATED', 'PLAN_CHANGED'] },
          createdAt: { gte: start, lte: end },
          ...(params.tenantId ? { tenantId: params.tenantId } : {}),
        },
      }) || [];

      for (const log of auditLogs) {
        const meta = log.metadata as any;
        if (meta?.changeType === 'UPGRADE') upgraded++;
        if (meta?.changeType === 'DOWNGRADE') downgraded++;
      }
    } catch {}

    const total = subscriptions.length || 1;

    const planDistribution = Array.from(planDistributionMap.values()).map((v) => ({
      ...v,
      percentage: calculateRate(v.count, total),
    }));

    const intervalDistribution = Array.from(intervalDistributionMap.entries()).map(([interval, count]) => ({
      interval,
      count,
      percentage: calculateRate(count, total),
    }));

    const statusDistribution = Array.from(statusDistributionMap.entries()).map(([status, count]) => ({
      status,
      count,
      percentage: calculateRate(count, total),
    }));

    const avgTenure = subscriptions.length > 0 ? totalTenureDays / subscriptions.length : 0;
    const avgSeats = subscriptions.length > 0 ? (totalSeats / subscriptions.length).toFixed(2) : '0.00';

    return {
      period: params.period,
      activeSubscriptions: allActive.length,
      trialSubscriptions: trial,
      cancelledSubscriptions: cancelled,
      expiredSubscriptions: expired,
      scheduledCancellations: scheduled,
      newSubscriptions: newSubs,
      renewedSubscriptions: renewed,
      churnedSubscriptions: churned,
      upgradedSubscriptions: upgraded,
      downgradedSubscriptions: downgraded,
      averageTenureDays: Math.round(avgTenure * 100) / 100,
      averageSeats: avgSeats,
      planDistribution,
      intervalDistribution,
      statusDistribution,
      calculatedAt: new Date().toISOString(),
    };
  }

  async getPlanDistribution(params: { tenantId?: string; asOfDate?: Date }): Promise<
    { planId: string; planCode: string; planName: string; count: number; percentage: string }[]
  > {
    const asOfDate = params.asOfDate || new Date();
    const active = await this.fetchCurrentActive({ tenantId: params.tenantId, asOfDate });
    const total = active.length || 1;
    const map = new Map<string, { planId: string; planCode: string; planName: string; count: number }>();

    for (const sub of active) {
      const plan = sub.plan;
      if (!plan) continue;
      const key = plan.id;
      if (!map.has(key)) map.set(key, { planId: plan.id, planCode: plan.code, planName: plan.name, count: 0 });
      map.get(key)!.count++;
    }

    return Array.from(map.values()).map((v) => ({ ...v, percentage: calculateRate(v.count, total) }));
  }

  async getIntervalDistribution(params: { tenantId?: string; asOfDate?: Date }): Promise<
    { interval: BillingInterval; count: number; percentage: string }[]
  > {
    const asOfDate = params.asOfDate || new Date();
    const active = await this.fetchCurrentActive({ tenantId: params.tenantId, asOfDate });
    const total = active.length || 1;
    const map = new Map<BillingInterval, number>();

    for (const sub of active) {
      const plan = sub.plan;
      if (!plan) continue;
      const interval = (plan.interval as BillingInterval) || BillingInterval.MONTHLY;
      map.set(interval, (map.get(interval) || 0) + 1);
    }

    return Array.from(map.entries()).map(([interval, count]) => ({
      interval,
      count,
      percentage: calculateRate(count, total),
    }));
  }

  private parsePeriod(period: ReportingPeriod): { start: Date; end: Date } {
    return { start: new Date(period.startDate), end: new Date(period.endDate) };
  }

  private async fetchSubscriptionsInPeriod(params: { tenantId?: string; start: Date; end: Date }): Promise<any[]> {
    try {
      const where: any = {
        createdAt: { lte: params.end },
        currentPeriodEnd: { gte: params.start },
      };
      if (params.tenantId) where.tenantId = params.tenantId;
      return await (this.prisma as any).tenantSubscription?.findMany({ where, include: { plan: true } }) || [];
    } catch (e: any) {
      this.logger.warn(`Failed to fetch subscriptions in period: ${e.message}`);
      return [];
    }
  }

  private async fetchCurrentActive(params: { tenantId?: string; asOfDate?: Date }): Promise<any[]> {
    const asOfDate = params.asOfDate || new Date();
    try {
      const where: any = {
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE] },
        currentPeriodEnd: { gte: asOfDate },
      };
      if (params.tenantId) where.tenantId = params.tenantId;
      return await (this.prisma as any).tenantSubscription?.findMany({ where, include: { plan: true } }) || [];
    } catch {
      return [];
    }
  }
}
