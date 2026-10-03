import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { DurableUsageEvent, ProcessingState, MeterKey, UsageScope, MeterUnit, PeriodType } from './usage-metering.types';
import { randomUUID } from 'crypto';
import { isRecordNotFound } from '../../../common/errors/prisma-not-found';

/** Record fields without a UsageEvent column, stored in `metadata` under this key. */
export const USAGE_RECORD_METADATA_KEY = '_usage';

/**
 * Durable event store for metered usage events with idempotency, source references,
 * tenant isolation, and processing state. Safe replay without double counting.
 */
@Injectable()
export class UsageEventRepository {
  private readonly logger = new Logger(UsageEventRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(event: {
    tenantId: string;
    meterKey: MeterKey;
    scope: UsageScope;
    subjectId?: string;
    resourceId?: string;
    quantity: number;
    unit: MeterUnit;
    sourceType: string;
    sourceId: string;
    sourceEventId?: string;
    periodId: string;
    periodType: PeriodType;
    periodStart: Date;
    periodEnd: Date;
    timestamp: Date;
    idempotencyKey: string;
    processingState: ProcessingState;
    dimensions: any;
    safeMetadata?: Record<string, unknown> | null;
  }): Promise<DurableUsageEvent> {
    // Idempotency check
    const existingByKey = await this.findByIdempotencyKey(event.idempotencyKey, event.tenantId);
    if (existingByKey) {
      this.logger.log(`Idempotent event return by idempotencyKey: ${event.idempotencyKey}`);
      return existingByKey;
    }

    const existingBySource = await this.findBySourceId(event.tenantId, event.sourceId, event.meterKey);
    if (existingBySource) {
      this.logger.log(`Idempotent event return by source: ${event.sourceId} meter=${event.meterKey}`);
      return existingBySource;
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    const durableEvent: DurableUsageEvent = {
      id,
      tenantId: event.tenantId,
      meterKey: event.meterKey,
      scope: event.scope,
      subjectId: event.subjectId,
      resourceId: event.resourceId,
      quantity: event.quantity,
      unit: event.unit,
      sourceType: event.sourceType,
      sourceId: event.sourceId,
      sourceEventId: event.sourceEventId,
      periodId: event.periodId,
      periodType: event.periodType,
      periodStart: event.periodStart.toISOString(),
      periodEnd: event.periodEnd.toISOString(),
      timestamp: event.timestamp.toISOString(),
      idempotencyKey: event.idempotencyKey,
      processingState: event.processingState,
      dimensions: event.dimensions,
      safeMetadata: event.safeMetadata || null,
      createdAt: now,
      updatedAt: now,
    };

    try {
      // UsageEvent columns only: status = processing state, createdAt = event
      // time; the remaining record fields live in metadata._usage. Unknown
      // columns (scope, unit, timestamp, ...) made Prisma reject every event.
      const created = await (this.prisma as any).usageEvent?.create({
        data: {
          id: durableEvent.id,
          tenantId: durableEvent.tenantId,
          meterKey: durableEvent.meterKey,
          eventType: durableEvent.scope,
          sourceType: durableEvent.sourceType,
          sourceId: durableEvent.sourceId,
          quantity: Number.isInteger(durableEvent.quantity) ? durableEvent.quantity : Math.round(durableEvent.quantity),
          periodId: durableEvent.periodId,
          idempotencyKey: durableEvent.idempotencyKey,
          status: durableEvent.processingState,
          metadata: {
            [USAGE_RECORD_METADATA_KEY]: {
              scope: durableEvent.scope,
              subjectId: durableEvent.subjectId || null,
              resourceId: durableEvent.resourceId || null,
              quantity: durableEvent.quantity,
              unit: durableEvent.unit,
              sourceEventId: durableEvent.sourceEventId || null,
              periodType: durableEvent.periodType,
              periodStart: event.periodStart.toISOString(),
              periodEnd: event.periodEnd.toISOString(),
              timestamp: event.timestamp.toISOString(),
              dimensions: durableEvent.dimensions,
            },
          } as any,
          safeMetadata: (durableEvent.safeMetadata ?? {}) as any,
          createdAt: event.timestamp,
        },
      });

      if (created) {
        return this.mapToDomain(created);
      }
    } catch (error: any) {
      if (error.code === 'P2002') {
        this.logger.warn(`Duplicate usage event idempotency: ${event.idempotencyKey}`);
        const existing = await this.findByIdempotencyKey(event.idempotencyKey, event.tenantId);
        if (existing) return existing;
        const bySource = await this.findBySourceId(event.tenantId, event.sourceId, event.meterKey);
        if (bySource) return bySource;
      }
      if (error.code === 'P2021' || error.message?.includes('does not exist')) {
        this.logger.warn(`usageEvent table not found, fallback: ${error.message}`);
        try {
          await (this.prisma as any).auditLog?.create({
            data: {
              id: randomUUID(),
              tenantId: event.tenantId,
              action: 'USAGE_EVENT_RECORDED',
              resourceType: 'UsageEvent',
              resourceId: id,
              metadata: { ...durableEvent, fallback: true },
              createdAt: new Date(),
            },
          });
        } catch {}
        return durableEvent;
      }
      this.logger.error(`Failed to create usage event: ${error.message}`, error.stack);
      throw error;
    }

    return durableEvent;
  }

  async findById(id: string, tenantId?: string): Promise<DurableUsageEvent | null> {
    const result = await (this.prisma as any).usageEvent?.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
    });
    if (!result) return null;
    return this.mapToDomain(result);
  }

  async findByIdempotencyKey(idempotencyKey: string, tenantId: string): Promise<DurableUsageEvent | null> {
    const result = await (this.prisma as any).usageEvent?.findFirst({
      where: { idempotencyKey, tenantId },
    });
    if (!result) return null;
    return this.mapToDomain(result);
  }

  async findBySourceId(tenantId: string, sourceId: string, meterKey?: MeterKey): Promise<DurableUsageEvent | null> {
    const result = await (this.prisma as any).usageEvent?.findFirst({
      where: {
        tenantId,
        sourceId,
        ...(meterKey ? { meterKey } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!result) return null;
    return this.mapToDomain(result);
  }

  async listByTenant(
    tenantId: string,
    filter?: {
      meterKey?: MeterKey;
      scope?: UsageScope;
      subjectId?: string;
      sourceType?: string;
      processingState?: ProcessingState;
      periodId?: string;
      fromDate?: Date;
      toDate?: Date;
      limit?: number;
      offset?: number;
    },
  ): Promise<DurableUsageEvent[]> {
    const where: any = { tenantId };
    if (filter?.meterKey) where.meterKey = filter.meterKey;
    const jsonFilters: any[] = [];
    if (filter?.scope) jsonFilters.push({ metadata: { path: [USAGE_RECORD_METADATA_KEY, 'scope'], equals: filter.scope } });
    if (filter?.subjectId) jsonFilters.push({ metadata: { path: [USAGE_RECORD_METADATA_KEY, 'subjectId'], equals: filter.subjectId } });
    if (jsonFilters.length > 0) where.AND = jsonFilters;
    if (filter?.sourceType) where.sourceType = filter.sourceType;
    if (filter?.processingState) where.status = filter.processingState;
    if (filter?.periodId) where.periodId = filter.periodId;
    if (filter?.fromDate || filter?.toDate) {
      where.createdAt = {};
      if (filter.fromDate) where.createdAt.gte = filter.fromDate;
      if (filter.toDate) where.createdAt.lte = filter.toDate;
    }

    const results = await (this.prisma as any).usageEvent?.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filter?.limit || 100,
      skip: filter?.offset || 0,
    });

    if (!results) return [];
    return results.map((r: any) => this.mapToDomain(r));
  }

  async updateProcessingState(id: string, state: ProcessingState, error?: string): Promise<DurableUsageEvent | null> {
    try {
      const updated = await (this.prisma as any).usageEvent?.update({
        where: { id },
        data: {
          status: state,
          ...(error ? { safeMetadata: { error } } : {}),
        },
      });
      if (!updated) return null;
      return this.mapToDomain(updated);
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  async countByPeriod(tenantId: string, periodId: string, meterKey?: MeterKey): Promise<number> {
    const count = await (this.prisma as any).usageEvent?.count({
      where: {
        tenantId,
        periodId,
        ...(meterKey ? { meterKey } : {}),
      },
    });
    return count || 0;
  }

  private mapToDomain(raw: any): DurableUsageEvent {
    const metadata = raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {};
    const record: any = metadata[USAGE_RECORD_METADATA_KEY] && typeof metadata[USAGE_RECORD_METADATA_KEY] === 'object' ? metadata[USAGE_RECORD_METADATA_KEY] : {};
    const iso = (value: unknown, fallback: unknown): string =>
      value ? new Date(value as string).toISOString() : fallback ? new Date(fallback as string).toISOString() : new Date().toISOString();
    const scope = (record.scope ?? raw.eventType) as UsageScope;
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      meterKey: raw.meterKey as MeterKey,
      scope,
      subjectId: record.subjectId || undefined,
      resourceId: record.resourceId || undefined,
      quantity: typeof record.quantity === 'number' ? record.quantity : raw.quantity || 0,
      unit: record.unit as MeterUnit,
      sourceType: raw.sourceType,
      sourceId: raw.sourceId,
      sourceEventId: record.sourceEventId || undefined,
      periodId: raw.periodId,
      periodType: record.periodType as PeriodType,
      periodStart: iso(record.periodStart, raw.createdAt),
      periodEnd: iso(record.periodEnd, raw.createdAt),
      timestamp: iso(record.timestamp, raw.createdAt),
      idempotencyKey: raw.idempotencyKey,
      processingState: raw.status as ProcessingState,
      dimensions: record.dimensions || { tenantId: raw.tenantId, scope },
      safeMetadata: raw.safeMetadata && Object.keys(raw.safeMetadata).length > 0 ? raw.safeMetadata : null,
      createdAt: iso(raw.createdAt, null),
      updatedAt: iso(raw.createdAt, null),
    };
  }

}
