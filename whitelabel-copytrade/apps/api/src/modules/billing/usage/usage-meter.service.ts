import { Injectable, Logger } from '@nestjs/common';
import { UsageMeterRepository } from './usage-meter.repository';
import { UsageEventRepository } from './usage-event.repository';
import { UsagePeriodService } from './usage-period.service';
import { MeterKey, UsageScope, MeterUnit, AggregationWindow, ProcessingState, PeriodType, UsageBucket, DurableUsageEvent } from './usage-metering.types';
import { randomUUID } from 'crypto';

/**
 * Main durable metering service: record usage, deduplicate events, update period totals,
 * update dimensions, expose normalized usage snapshots.
 * Does NOT decide whether action is allowed - runtime enforcement already does that.
 * Records what actually happened after successful business operations.
 */
@Injectable()
export class UsageMeterService {
  private readonly logger = new Logger(UsageMeterService.name);

  constructor(
    private readonly meterRepository: UsageMeterRepository,
    private readonly eventRepository: UsageEventRepository,
    private readonly periodService: UsagePeriodService,
  ) {}

  async recordUsage(params: {
    tenantId: string;
    meterKey: MeterKey;
    scope: UsageScope;
    subjectId?: string;
    resourceId?: string;
    quantity: number;
    unit?: MeterUnit;
    sourceType: string;
    sourceId: string;
    sourceEventId?: string;
    idempotencyKey?: string;
    timestamp?: Date;
    dimensions?: any;
    safeMetadata?: Record<string, unknown> | null;
  }): Promise<{ event: DurableUsageEvent; bucket: UsageBucket; isDuplicate: boolean }> {
    // Validate meter key
    const meterDef = this.meterRepository.getMeterDefinition(params.meterKey);
    if (!meterDef) {
      throw new Error(`Invalid meter key: ${params.meterKey}`);
    }

    // Validate scope
    if (!meterDef.scope.includes(params.scope)) {
      throw new Error(`Scope ${params.scope} not allowed for meter ${params.meterKey}. Allowed: ${meterDef.scope.join(',')}`);
    }

    // Validate quantity
    if (typeof params.quantity !== 'number' || isNaN(params.quantity)) {
      throw new Error(`Invalid quantity: ${params.quantity}`);
    }
    if (params.quantity < 0) {
      throw new Error('Usage quantity cannot be negative');
    }

    const idempotencyKey = params.idempotencyKey || this.generateIdempotencyKey(params.tenantId, params.meterKey, params.sourceId, params.scope, params.subjectId);

    // Deduplicate event - check idempotency and source
    const existingByIdempotency = await this.eventRepository.findByIdempotencyKey(idempotencyKey);
    if (existingByIdempotency) {
      this.logger.log(`Duplicate usage event by idempotencyKey: ${idempotencyKey} - returning existing`);
      const bucket = await this.meterRepository.getCurrentPeriodTotal({
        tenantId: params.tenantId,
        meterKey: params.meterKey,
        scope: params.scope,
        subjectId: params.subjectId,
        periodId: existingByIdempotency.periodId,
      });

      // Map to bucket domain for return
      const bucketDomain: UsageBucket = {
        id: bucket.bucketId || randomUUID(),
        tenantId: params.tenantId,
        meterKey: params.meterKey,
        scope: params.scope,
        subjectId: params.subjectId,
        window: AggregationWindow.MONTHLY,
        periodId: existingByIdempotency.periodId,
        periodStart: existingByIdempotency.periodStart,
        periodEnd: existingByIdempotency.periodEnd,
        totalQuantity: bucket.totalQuantity,
        eventCount: bucket.eventCount,
        unit: existingByIdempotency.unit,
        lastEventAt: existingByIdempotency.timestamp,
        createdAt: existingByIdempotency.createdAt,
        updatedAt: new Date().toISOString(),
      };

      return { event: existingByIdempotency, bucket: bucketDomain, isDuplicate: true };
    }

    const existingBySource = await this.eventRepository.findBySourceId(params.tenantId, params.sourceId, params.meterKey);
    if (existingBySource) {
      this.logger.log(`Duplicate usage event by source: ${params.sourceId} meter=${params.meterKey}`);
      const bucket = await this.meterRepository.getCurrentPeriodTotal({
        tenantId: params.tenantId,
        meterKey: params.meterKey,
        scope: params.scope,
        subjectId: params.subjectId,
        periodId: existingBySource.periodId,
      });

      const bucketDomain: UsageBucket = {
        id: bucket.bucketId || randomUUID(),
        tenantId: params.tenantId,
        meterKey: params.meterKey,
        scope: params.scope,
        subjectId: params.subjectId,
        window: AggregationWindow.MONTHLY,
        periodId: existingBySource.periodId,
        periodStart: existingBySource.periodStart,
        periodEnd: existingBySource.periodEnd,
        totalQuantity: bucket.totalQuantity,
        eventCount: bucket.eventCount,
        unit: existingBySource.unit,
        lastEventAt: existingBySource.timestamp,
        createdAt: existingBySource.createdAt,
        updatedAt: new Date().toISOString(),
      };

      return { event: existingBySource, bucket: bucketDomain, isDuplicate: true };
    }

    // Resolve period
    const timestamp = params.timestamp || new Date();
    const period = this.periodService.getPeriodForTimestamp(params.tenantId, timestamp, PeriodType.CALENDAR_MONTH);

    // Determine aggregation window
    const window = this.determineAggregationWindow(params.meterKey);

    // Write durable event first
    const event = await this.eventRepository.create({
      tenantId: params.tenantId,
      meterKey: params.meterKey,
      scope: params.scope,
      subjectId: params.subjectId,
      resourceId: params.resourceId,
      quantity: params.quantity,
      unit: params.unit || meterDef.unit,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      sourceEventId: params.sourceEventId,
      periodId: period.id,
      periodType: period.type,
      periodStart: new Date(period.start),
      periodEnd: new Date(period.end),
      timestamp,
      idempotencyKey,
      processingState: ProcessingState.PROCESSED,
      dimensions: {
        tenantId: params.tenantId,
        scope: params.scope,
        subjectId: params.subjectId,
        resourceId: params.resourceId,
        ...params.dimensions,
      },
      safeMetadata: this.sanitizeSafeMetadata(params.safeMetadata),
    });

    // Update durable counter atomically
    const bucket = await this.meterRepository.incrementUsageAtomic({
      tenantId: params.tenantId,
      meterKey: params.meterKey,
      scope: params.scope,
      subjectId: params.subjectId,
      quantity: params.quantity,
      unit: (params.unit || meterDef.unit) as string,
      window,
      periodId: period.id,
      periodStart: new Date(period.start),
      periodEnd: new Date(period.end),
      sourceEventId: params.sourceId,
      idempotencyKey,
    });

    this.logger.log(
      `Usage recorded tenant=${params.tenantId} meter=${params.meterKey} scope=${params.scope} subject=${params.subjectId || 'none'} quantity=${params.quantity} period=${period.id} bucketTotal=${bucket.totalQuantity}`,
    );

    return { event, bucket, isDuplicate: false };
  }

  async getCurrentUsageSnapshot(params: {
    tenantId: string;
    meterKey: MeterKey;
    scope: UsageScope;
    subjectId?: string;
    periodId?: string;
  }): Promise<{ meterKey: MeterKey; current: number; periodId: string; lastEventAt: string | null }> {
    let periodId = params.periodId;
    if (!periodId) {
      const period = this.periodService.getCurrentCalendarMonthPeriod(params.tenantId);
      periodId = period.id;
    }

    const total = await this.meterRepository.getCurrentPeriodTotal({
      tenantId: params.tenantId,
      meterKey: params.meterKey,
      scope: params.scope,
      subjectId: params.subjectId,
      periodId,
    });

    // Try to get last event timestamp
    let lastEventAt: string | null = null;
    try {
      const events = await this.eventRepository.listByTenant(params.tenantId, {
        meterKey: params.meterKey,
        scope: params.scope,
        subjectId: params.subjectId,
        periodId,
        limit: 1,
      });
      if (events.length > 0) {
        lastEventAt = events[0].timestamp;
      }
    } catch {}

    return {
      meterKey: params.meterKey,
      current: total.totalQuantity,
      periodId,
      lastEventAt,
    };
  }

  async getTenantUsageOverview(
    tenantId: string,
    filter?: { meterKey?: MeterKey; fromDate?: Date; toDate?: Date },
  ): Promise<any[]> {
    return this.meterRepository.getTenantTotals(tenantId, filter?.meterKey, undefined, filter?.fromDate, filter?.toDate);
  }

  async getResourceUsage(tenantId: string, scope: UsageScope, subjectId: string, meterKey?: MeterKey): Promise<UsageBucket[]> {
    return this.meterRepository.getResourceTotals(tenantId, scope, subjectId, meterKey);
  }

  private determineAggregationWindow(meterKey: MeterKey): AggregationWindow {
    const def = this.meterRepository.getMeterDefinition(meterKey);
    if (!def) return AggregationWindow.MONTHLY;
    // Prefer monthly for most, minute for API requests
    if (meterKey === MeterKey.API_REQUESTS) return AggregationWindow.MINUTE;
    if (meterKey === MeterKey.WEBSOCKET_CONNECTIONS) return AggregationWindow.HOURLY;
    return AggregationWindow.MONTHLY;
  }

  private generateIdempotencyKey(tenantId: string, meterKey: MeterKey, sourceId: string, scope: UsageScope, subjectId?: string): string {
    return `usage_${tenantId}_${meterKey}_${sourceId}_${scope}_${subjectId || 'global'}`;
  }

  private sanitizeSafeMetadata(metadata?: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!metadata) return null;
    const forbidden = ['secret', 'apiKey', 'privateKey', 'accessToken', 'password', 'exchangeSecret', 'providerSecret', 'bankAccount', 'walletKey', 'private_key', 'credentials', 'exchangeKey', 'apiSecret'];
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(metadata)) {
      const lowerKey = key.toLowerCase();
      if (forbidden.some((f) => lowerKey.includes(f.toLowerCase()))) {
        safe[key] = '[REDACTED]';
      } else {
        safe[key] = value;
      }
    }
    return safe;
  }
}
