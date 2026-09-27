import { Injectable, Logger } from '@nestjs/common';
import { UsageEventRepository } from './usage-event.repository';
import { UsageMeterRepository } from './usage-meter.repository';
import { UsagePeriodService } from './usage-period.service';
import { QuotaSnapshotService } from './quota-snapshot.service';
import { OverageService } from './overage.service';
import { MeterKey, UsageScope, AggregationWindow } from './usage-metering.types';

/**
 * Usage analytics for tenants/SaaS admins: period totals, trends, utilization,
 * top meters, limit pressure, overage exposure.
 * All based on canonical durable usage data, no independent counters.
 */
@Injectable()
export class UsageAnalyticsService {
  private readonly logger = new Logger(UsageAnalyticsService.name);

  constructor(
    private readonly eventRepository: UsageEventRepository,
    private readonly meterRepository: UsageMeterRepository,
    private readonly periodService: UsagePeriodService,
    private readonly quotaService: QuotaSnapshotService,
    private readonly overageService: OverageService,
  ) {}

  async getCurrentUsageOverview(tenantId: string, periodId?: string): Promise<any> {
    const quotaOverview = await this.quotaService.getTenantQuotaOverview(tenantId, periodId);
    const tenantTotals = await this.meterRepository.getTenantTotals(tenantId);

    const utilization = quotaOverview.map((q) => ({
      meterKey: q.meterKey,
      limitKey: q.limitKey,
      current: q.current,
      maximum: q.maximum,
      remaining: q.remaining,
      utilizationPercent: q.utilizationPercent,
      status: q.status,
      isEnforced: q.isEnforced,
    }));

    // Calculate limit pressure (how close to limits)
    const pressure = utilization
      .filter((u) => u.maximum !== null && u.utilizationPercent !== null)
      .sort((a, b) => (b.utilizationPercent || 0) - (a.utilizationPercent || 0))
      .slice(0, 5);

    return {
      tenantId,
      periodId: periodId || this.periodService.getCurrentCalendarMonthPeriod(tenantId).id,
      currentUsage: utilization,
      tenantTotals,
      limitPressure: pressure,
      fetchedAt: new Date().toISOString(),
    };
  }

  async getUsageTrends(
    tenantId: string,
    params: { meterKey?: MeterKey; days?: number; fromDate?: Date; toDate?: Date },
  ): Promise<any> {
    const days = params.days || 30;
    const toDate = params.toDate || new Date();
    const fromDate = params.fromDate || new Date(toDate.getTime() - days * 24 * 60 * 60 * 1000);

    const events = await this.eventRepository.listByTenant(tenantId, {
      meterKey: params.meterKey,
      fromDate,
      toDate,
      limit: 10000,
    });

    // Group by day
    const dailyMap = new Map<string, { date: string; totalQuantity: number; eventCount: number; meters: Record<string, number> }>();

    for (const event of events) {
      const dateKey = new Date(event.timestamp).toISOString().split('T')[0];
      const existing = dailyMap.get(dateKey) || { date: dateKey, totalQuantity: 0, eventCount: 0, meters: {} };
      existing.totalQuantity += event.quantity;
      existing.eventCount += 1;
      existing.meters[event.meterKey] = (existing.meters[event.meterKey] || 0) + event.quantity;
      dailyMap.set(dateKey, existing);
    }

    const dailyTrends = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    // Calculate trend direction
    let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    if (dailyTrends.length >= 2) {
      const recent = dailyTrends.slice(-7);
      const older = dailyTrends.slice(-14, -7);
      const recentAvg = recent.reduce((sum, d) => sum + d.totalQuantity, 0) / (recent.length || 1);
      const olderAvg = older.length > 0 ? older.reduce((sum, d) => sum + d.totalQuantity, 0) / older.length : recentAvg;
      if (recentAvg > olderAvg * 1.1) trend = 'increasing';
      else if (recentAvg < olderAvg * 0.9) trend = 'decreasing';
    }

    return {
      tenantId,
      meterKey: params.meterKey || 'ALL',
      period: { from: fromDate.toISOString(), to: toDate.toISOString(), days },
      dailyTrends,
      trend,
      totalEvents: events.length,
      totalQuantity: events.reduce((sum, e) => sum + e.quantity, 0),
      fetchedAt: new Date().toISOString(),
    };
  }

  async getTopMeters(tenantId: string, limit: number = 10, fromDate?: Date, toDate?: Date): Promise<any[]> {
    const totals = await this.meterRepository.getTenantTotals(tenantId, undefined, undefined, fromDate, toDate);

    return totals
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .slice(0, limit)
      .map((t) => ({
        meterKey: t.meterKey,
        totalQuantity: t.totalQuantity,
        eventCount: t.eventCount,
        averagePerEvent: t.eventCount > 0 ? t.totalQuantity / t.eventCount : 0,
      }));
  }

  async getLimitPressure(tenantId: string): Promise<any[]> {
    const quotaOverview = await this.quotaService.getTenantQuotaOverview(tenantId);

    return quotaOverview
      .filter((q) => q.maximum !== null && q.utilizationPercent !== null)
      .map((q) => ({
        meterKey: q.meterKey,
        limitKey: q.limitKey,
        current: q.current,
        maximum: q.maximum,
        remaining: q.remaining,
        utilizationPercent: q.utilizationPercent,
        status: q.status,
        pressure: q.utilizationPercent || 0,
        isEnforced: q.isEnforced,
      }))
      .sort((a, b) => (b.utilizationPercent || 0) - (a.utilizationPercent || 0));
  }

  async getOverageExposure(tenantId: string, fromDate?: Date, toDate?: Date): Promise<any> {
    const overages = await this.overageService.listOverages(tenantId, {
      fromDate,
      toDate,
      limit: 100,
    });

    const totalExcess = overages.reduce((sum, o) => sum + (o.excessQuantity || 0), 0);
    const byMeter: Record<string, number> = {};
    const byStatus: Record<string, number> = {};

    for (const o of overages) {
      byMeter[o.meterKey] = (byMeter[o.meterKey] || 0) + o.excessQuantity;
      byStatus[o.status] = (byStatus[o.status] || 0) + 1;
    }

    return {
      tenantId,
      totalOverages: overages.length,
      totalExcessQuantity: totalExcess,
      byMeter,
      byStatus,
      overages: overages.slice(0, 20),
      fetchedAt: new Date().toISOString(),
    };
  }

  async getApiUsageAnalytics(tenantId: string, days: number = 7): Promise<any> {
    const toDate = new Date();
    const fromDate = new Date(toDate.getTime() - days * 24 * 60 * 60 * 1000);

    const events = await this.eventRepository.listByTenant(tenantId, {
      meterKey: MeterKey.API_REQUESTS,
      fromDate,
      toDate,
      limit: 10000,
    });

    const byEndpoint: Record<string, number> = {};
    const byIdentity: Record<string, number> = {};
    const hourlyMap = new Map<string, number>();

    for (const event of events) {
      const endpoint = (event.dimensions as any)?.endpoint || 'unknown';
      byEndpoint[endpoint] = (byEndpoint[endpoint] || 0) + 1;

      const identity = event.subjectId || 'unknown';
      byIdentity[identity] = (byIdentity[identity] || 0) + 1;

      const hourKey = new Date(event.timestamp).toISOString().substring(0, 13);
      hourlyMap.set(hourKey, (hourlyMap.get(hourKey) || 0) + event.quantity);
    }

    const hourlyTrends = Array.from(hourlyMap.entries())
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => a.hour.localeCompare(b.hour));

    return {
      tenantId,
      period: { from: fromDate.toISOString(), to: toDate.toISOString(), days },
      totalRequests: events.length,
      byEndpoint: Object.entries(byEndpoint)
        .map(([endpoint, count]) => ({ endpoint, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20),
      byIdentity: Object.entries(byIdentity)
        .map(([identity, count]) => ({ identity, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20),
      hourlyTrends,
      fetchedAt: new Date().toISOString(),
    };
  }

  async getProjectedUsage(tenantId: string, meterKey: MeterKey): Promise<any> {
    const currentPeriod = this.periodService.getCurrentCalendarMonthPeriod(tenantId);
    const start = new Date(currentPeriod.start);
    const now = new Date();
    const end = new Date(currentPeriod.end);

    const events = await this.eventRepository.listByTenant(tenantId, {
      meterKey,
      fromDate: start,
      toDate: now,
      limit: 10000,
    });

    const elapsedMs = now.getTime() - start.getTime();
    const totalPeriodMs = end.getTime() - start.getTime();
    const currentTotal = events.reduce((sum, e) => sum + e.quantity, 0);

    let projectedTotal = currentTotal;
    if (elapsedMs > 0 && totalPeriodMs > 0) {
      const progress = elapsedMs / totalPeriodMs;
      projectedTotal = progress > 0 ? Math.round(currentTotal / progress) : currentTotal;
    }

    const quota = await this.quotaService.getQuotaSnapshot({
      tenantId,
      meterKey,
      scope: UsageScope.TENANT,
      periodId: currentPeriod.id,
    });

    return {
      tenantId,
      meterKey,
      currentPeriod: {
        id: currentPeriod.id,
        start: currentPeriod.start,
        end: currentPeriod.end,
        elapsedDays: Math.floor(elapsedMs / (24 * 60 * 60 * 1000)),
        totalDays: Math.floor(totalPeriodMs / (24 * 60 * 60 * 1000)),
        progressPercent: totalPeriodMs > 0 ? Math.round((elapsedMs / totalPeriodMs) * 100) : 0,
      },
      currentTotal,
      projectedTotal,
      maximum: quota.maximum,
      projectedUtilization: quota.maximum ? Math.round((projectedTotal / quota.maximum) * 100) : null,
      willExceed: quota.maximum ? projectedTotal > quota.maximum : false,
      fetchedAt: new Date().toISOString(),
    };
  }
}
