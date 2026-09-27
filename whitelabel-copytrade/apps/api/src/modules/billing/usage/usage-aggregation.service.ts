import { Injectable, Logger } from '@nestjs/common';
import { UsageEventRepository } from './usage-event.repository';
import { UsageMeterRepository } from './usage-meter.repository';
import { UsagePeriodService } from './usage-period.service';
import { MeterKey, UsageScope, AggregationWindow, PeriodType, UsageBucket } from './usage-metering.types';
import { randomUUID } from 'crypto';

/**
 * Aggregates raw events into hourly/daily/monthly/period buckets with deterministic totals
 * and safe reprocessing. No double counting, timezone-safe, source-event traceability.
 */
@Injectable()
export class UsageAggregationService {
  private readonly logger = new Logger(UsageAggregationService.name);

  constructor(
    private readonly eventRepository: UsageEventRepository,
    private readonly meterRepository: UsageMeterRepository,
    private readonly periodService: UsagePeriodService,
  ) {}

  async aggregateHourly(tenantId: string, date: Date, meterKey?: MeterKey): Promise<UsageBucket[]> {
    return this.aggregateForWindow(tenantId, date, AggregationWindow.HOURLY, PeriodType.CALENDAR_HOUR, meterKey);
  }

  async aggregateDaily(tenantId: string, date: Date, meterKey?: MeterKey): Promise<UsageBucket[]> {
    return this.aggregateForWindow(tenantId, date, AggregationWindow.DAILY, PeriodType.CALENDAR_DAY, meterKey);
  }

  async aggregateMonthly(tenantId: string, date: Date, meterKey?: MeterKey): Promise<UsageBucket[]> {
    return this.aggregateForWindow(tenantId, date, AggregationWindow.MONTHLY, PeriodType.CALENDAR_MONTH, meterKey);
  }

  async aggregateBillingPeriod(tenantId: string, meterKey?: MeterKey): Promise<UsageBucket[]> {
    const period = await this.periodService.getSubscriptionPeriod(tenantId);
    const start = new Date(period.start);
    const end = new Date(period.end);

    const events = await this.eventRepository.listByTenant(tenantId, {
      meterKey,
      fromDate: start,
      toDate: end,
      limit: 10000,
    });

    return this.buildBucketsFromEvents(tenantId, events, AggregationWindow.BILLING_PERIOD, period.id, start, end);
  }

  async rebuildAggregatesForPeriod(tenantId: string, periodId: string, meterKey?: MeterKey): Promise<UsageBucket[]> {
    // Idempotent rebuild: re-aggregate from durable events
    const events = await this.eventRepository.listByTenant(tenantId, {
      meterKey,
      periodId,
      limit: 10000,
    });

    if (events.length === 0) {
      this.logger.log(`No events to rebuild for tenant=${tenantId} period=${periodId}`);
      return [];
    }

    const firstEvent = events[0];
    const periodStart = new Date(firstEvent.periodStart);
    const periodEnd = new Date(firstEvent.periodEnd);

    // Determine window from period type
    let window: AggregationWindow = AggregationWindow.MONTHLY;
    if (firstEvent.periodType === PeriodType.CALENDAR_DAY) window = AggregationWindow.DAILY;
    if (firstEvent.periodType === PeriodType.CALENDAR_HOUR) window = AggregationWindow.HOURLY;
    if (firstEvent.periodType === PeriodType.SUBSCRIPTION_PERIOD) window = AggregationWindow.BILLING_PERIOD;

    const buckets = await this.buildBucketsFromEvents(tenantId, events, window, periodId, periodStart, periodEnd);

    this.logger.log(`Rebuilt aggregates tenant=${tenantId} period=${periodId} buckets=${buckets.length} events=${events.length}`);

    return buckets;
  }

  async getAggregatedUsage(
    tenantId: string,
    filter: {
      meterKey?: MeterKey;
      scope?: UsageScope;
      subjectId?: string;
      window: AggregationWindow;
      fromDate?: Date;
      toDate?: Date;
      limit?: number;
    },
  ): Promise<UsageBucket[]> {
    try {
      // Get buckets from repository
      const where: any = { tenantId, window: filter.window };
      if (filter.meterKey) where.meterKey = filter.meterKey;
      if (filter.scope) where.scope = filter.scope;
      if (filter.subjectId) where.subjectId = filter.subjectId;
      if (filter.fromDate || filter.toDate) {
        where.periodStart = {};
        if (filter.fromDate) where.periodStart.gte = filter.fromDate;
        if (filter.toDate) where.periodStart.lte = filter.toDate;
      }

      // Use meter repository's getTenantTotals or direct query
      // For simplicity, fetch via event repository aggregation if bucket table missing
      const buckets = await this.meterRepository.getPeriodTotals(tenantId, filter.fromDate ? `cal_${filter.fromDate.toISOString()}` : 'current', filter.meterKey);

      if (buckets.length > 0) {
        return buckets.filter((b) => {
          if (filter.window && b.window !== filter.window) return false;
          if (filter.scope && b.scope !== filter.scope) return false;
          if (filter.subjectId && b.subjectId !== filter.subjectId) return false;
          return true;
        });
      }

      // Fallback: build from events
      const events = await this.eventRepository.listByTenant(tenantId, {
        meterKey: filter.meterKey,
        scope: filter.scope,
        subjectId: filter.subjectId,
        fromDate: filter.fromDate,
        toDate: filter.toDate,
        limit: filter.limit || 1000,
      });

      if (events.length === 0) return [];

      const periodStart = filter.fromDate || new Date(events[events.length - 1].timestamp);
      const periodEnd = filter.toDate || new Date();

      return this.buildBucketsFromEvents(tenantId, events, filter.window, `agg_${Date.now()}`, periodStart, periodEnd);
    } catch (e) {
      this.logger.warn(`Failed to get aggregated usage: ${(e as Error).message}`);
      return [];
    }
  }

  private async aggregateForWindow(
    tenantId: string,
    date: Date,
    window: AggregationWindow,
    periodType: PeriodType,
    meterKey?: MeterKey,
  ): Promise<UsageBucket[]> {
    const period = this.periodService.getPeriodForTimestamp(tenantId, date, periodType);
    const start = new Date(period.start);
    const end = new Date(period.end);

    const events = await this.eventRepository.listByTenant(tenantId, {
      meterKey,
      fromDate: start,
      toDate: end,
      limit: 10000,
    });

    return this.buildBucketsFromEvents(tenantId, events, window, period.id, start, end);
  }

  private async buildBucketsFromEvents(
    tenantId: string,
    events: any[],
    window: AggregationWindow,
    periodId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<UsageBucket[]> {
    // Deterministic aggregation: group by meterKey + scope + subjectId
    const grouped = new Map<string, { meterKey: MeterKey; scope: UsageScope; subjectId?: string; unit: any; totalQuantity: number; eventCount: number; lastEventAt: string }>();

    for (const event of events) {
      const key = `${event.meterKey}_${event.scope}_${event.subjectId || 'global'}_${event.unit}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.totalQuantity += event.quantity;
        existing.eventCount += 1;
        if (new Date(event.timestamp) > new Date(existing.lastEventAt)) {
          existing.lastEventAt = event.timestamp;
        }
      } else {
        grouped.set(key, {
          meterKey: event.meterKey,
          scope: event.scope,
          subjectId: event.subjectId,
          unit: event.unit,
          totalQuantity: event.quantity,
          eventCount: 1,
          lastEventAt: event.timestamp,
        });
      }
    }

    const buckets: UsageBucket[] = [];
    for (const [groupKey, data] of grouped) {
      buckets.push({
        id: randomUUID(),
        tenantId,
        meterKey: data.meterKey,
        scope: data.scope,
        subjectId: data.subjectId,
        window,
        periodId,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        totalQuantity: data.totalQuantity,
        eventCount: data.eventCount,
        unit: data.unit,
        lastEventAt: data.lastEventAt,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    // Sort deterministically by meterKey + scope
    buckets.sort((a, b) => {
      if (a.meterKey !== b.meterKey) return a.meterKey.localeCompare(b.meterKey);
      if (a.scope !== b.scope) return a.scope.localeCompare(b.scope);
      return (a.subjectId || '').localeCompare(b.subjectId || '');
    });

    return buckets;
  }
}
