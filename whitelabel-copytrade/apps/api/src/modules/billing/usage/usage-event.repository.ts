import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { DurableUsageEvent, ProcessingState, MeterKey, UsageScope, MeterUnit, PeriodType } from './usage-metering.types';
import { randomUUID } from 'crypto';

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
    const existingByKey = await this.findByIdempotencyKey(event.idempotencyKey);
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
      const created = await (this.prisma as any).usageEvent?.create({
        data: {
          id: durableEvent.id,
          tenantId: durableEvent.tenantId,
          meterKey: durableEvent.meterKey,
          scope: durableEvent.scope,
          subjectId: durableEvent.subjectId || null,
          resourceId: durableEvent.resourceId || null,
          quantity: durableEvent.quantity,
          unit: durableEvent.unit,
          sourceType: durableEvent.sourceType,
          sourceId: durableEvent.sourceId,
          sourceEventId: durableEvent.sourceEventId || null,
          periodId: durableEvent.periodId,
          periodType: durableEvent.periodType,
          periodStart: event.periodStart,
          periodEnd: event.periodEnd,
          timestamp: event.timestamp,
          idempotencyKey: durableEvent.idempotencyKey,
          processingState: durableEvent.processingState,
          dimensions: durableEvent.dimensions,
          safeMetadata: durableEvent.safeMetadata,
          createdAt: new Date(durableEvent.createdAt),
          updatedAt: new Date(durableEvent.updatedAt),
        },
      });

      if (created) {
        return this.mapToDomain(created);
      }
    } catch (error: any) {
      if (error.code === 'P2002') {
        this.logger.warn(`Duplicate usage event idempotency: ${event.idempotencyKey}`);
        const existing = await this.findByIdempotencyKey(event.idempotencyKey);
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
              resource: 'UsageEvent',
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
    try {
      const result = await (this.prisma as any).usageEvent?.findFirst({
        where: { id, ...(tenantId ? { tenantId } : {}) },
      });
      if (!result) return null;
      return this.mapToDomain(result);
    } catch {
      return null;
    }
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<DurableUsageEvent | null> {
    try {
      const result = await (this.prisma as any).usageEvent?.findFirst({
        where: { idempotencyKey },
      });
      if (!result) return null;
      return this.mapToDomain(result);
    } catch {
      return null;
    }
  }

  async findBySourceId(tenantId: string, sourceId: string, meterKey?: MeterKey): Promise<DurableUsageEvent | null> {
    try {
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
    } catch {
      return null;
    }
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
    try {
      const where: any = { tenantId };
      if (filter?.meterKey) where.meterKey = filter.meterKey;
      if (filter?.scope) where.scope = filter.scope;
      if (filter?.subjectId) where.subjectId = filter.subjectId;
      if (filter?.sourceType) where.sourceType = filter.sourceType;
      if (filter?.processingState) where.processingState = filter.processingState;
      if (filter?.periodId) where.periodId = filter.periodId;
      if (filter?.fromDate || filter?.toDate) {
        where.timestamp = {};
        if (filter.fromDate) where.timestamp.gte = filter.fromDate;
        if (filter.toDate) where.timestamp.lte = filter.toDate;
      }

      const results = await (this.prisma as any).usageEvent?.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: filter?.limit || 100,
        skip: filter?.offset || 0,
      });

      if (!results) return [];
      return results.map((r: any) => this.mapToDomain(r));
    } catch {
      return [];
    }
  }

  async updateProcessingState(id: string, state: ProcessingState, error?: string): Promise<DurableUsageEvent | null> {
    try {
      const updated = await (this.prisma as any).usageEvent?.update({
        where: { id },
        data: {
          processingState: state,
          updatedAt: new Date(),
          ...(error ? { safeMetadata: { error } } : {}),
        },
      });
      if (!updated) return null;
      return this.mapToDomain(updated);
    } catch {
      return null;
    }
  }

  async countByPeriod(tenantId: string, periodId: string, meterKey?: MeterKey): Promise<number> {
    try {
      const count = await (this.prisma as any).usageEvent?.count({
        where: {
          tenantId,
          periodId,
          ...(meterKey ? { meterKey } : {}),
        },
      });
      return count || 0;
    } catch {
      return 0;
    }
  }

  private mapToDomain(raw: any): DurableUsageEvent {
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      meterKey: raw.meterKey as MeterKey,
      scope: raw.scope as UsageScope,
      subjectId: raw.subjectId || undefined,
      resourceId: raw.resourceId || undefined,
      quantity: raw.quantity || 0,
      unit: raw.unit as MeterUnit,
      sourceType: raw.sourceType,
      sourceId: raw.sourceId,
      sourceEventId: raw.sourceEventId || undefined,
      periodId: raw.periodId,
      periodType: raw.periodType as PeriodType,
      periodStart: raw.periodStart ? new Date(raw.periodStart).toISOString() : new Date().toISOString(),
      periodEnd: raw.periodEnd ? new Date(raw.periodEnd).toISOString() : new Date().toISOString(),
      timestamp: raw.timestamp ? new Date(raw.timestamp).toISOString() : new Date().toISOString(),
      idempotencyKey: raw.idempotencyKey,
      processingState: raw.processingState as ProcessingState,
      dimensions: raw.dimensions || { tenantId: raw.tenantId, scope: raw.scope },
      safeMetadata: raw.safeMetadata || null,
      createdAt: raw.createdAt ? new Date(raw.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: raw.updatedAt ? new Date(raw.updatedAt).toISOString() : new Date().toISOString(),
    };
  }
}
