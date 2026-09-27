import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { OverageRecord, OverageStatus } from './overage.types';
import { MeterKey, MeterUnit } from './usage-metering.types';
import { randomUUID } from 'crypto';

/**
 * Persists overage records, period references, quantities, policy references, status, idempotency.
 */
@Injectable()
export class OverageRepository {
  private readonly logger = new Logger(OverageRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    tenantId: string;
    meterKey: MeterKey;
    limitKey: string;
    periodId: string;
    periodStart: Date;
    periodEnd: Date;
    allowedQuantity: number;
    actualQuantity: number;
    excessQuantity: number;
    unit: MeterUnit;
    policyReference: string | null;
    rateReference: string | null;
    rateBps: number | null;
    estimatedAmount: string | null;
    currency: string | null;
    status: OverageStatus;
    idempotencyKey: string;
    calculationTimestamp: Date;
    metadata?: Record<string, unknown> | null;
  }): Promise<OverageRecord> {
    // Idempotency check
    const existingByKey = await this.findByIdempotencyKey(data.idempotencyKey);
    if (existingByKey) {
      this.logger.log(`Idempotent overage return by idempotencyKey: ${data.idempotencyKey}`);
      return existingByKey;
    }

    const existingByPeriodMeter = await this.findByTenantPeriodMeter(data.tenantId, data.periodId, data.meterKey);
    if (existingByPeriodMeter) {
      this.logger.log(`Idempotent overage return by tenant+period+meter: ${data.tenantId} ${data.periodId} ${data.meterKey}`);
      return existingByPeriodMeter;
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    const record: OverageRecord = {
      id,
      tenantId: data.tenantId,
      meterKey: data.meterKey,
      limitKey: data.limitKey,
      periodId: data.periodId,
      periodStart: data.periodStart.toISOString(),
      periodEnd: data.periodEnd.toISOString(),
      allowedQuantity: data.allowedQuantity,
      actualQuantity: data.actualQuantity,
      excessQuantity: data.excessQuantity,
      unit: data.unit,
      policyReference: data.policyReference,
      rateReference: data.rateReference,
      rateBps: data.rateBps,
      estimatedAmount: data.estimatedAmount,
      currency: data.currency,
      status: data.status,
      idempotencyKey: data.idempotencyKey,
      calculationTimestamp: data.calculationTimestamp.toISOString(),
      createdAt: now,
      updatedAt: now,
      metadata: data.metadata || null,
    };

    try {
      const created = await (this.prisma as any).overageRecord?.create({
        data: {
          id: record.id,
          tenantId: record.tenantId,
          meterKey: record.meterKey,
          limitKey: record.limitKey,
          periodId: record.periodId,
          periodStart: data.periodStart,
          periodEnd: data.periodEnd,
          allowedQuantity: record.allowedQuantity,
          actualQuantity: record.actualQuantity,
          excessQuantity: record.excessQuantity,
          unit: record.unit,
          policyReference: record.policyReference,
          rateReference: record.rateReference,
          rateBps: record.rateBps,
          estimatedAmount: record.estimatedAmount,
          currency: record.currency,
          status: record.status,
          idempotencyKey: record.idempotencyKey,
          calculationTimestamp: data.calculationTimestamp,
          createdAt: new Date(record.createdAt),
          updatedAt: new Date(record.updatedAt),
          metadata: record.metadata,
        },
      });

      if (created) {
        return this.mapToDomain(created);
      }
    } catch (error: any) {
      if (error.code === 'P2002') {
        const existing = await this.findByIdempotencyKey(data.idempotencyKey);
        if (existing) return existing;
      }
      if (error.code === 'P2021' || error.message?.includes('does not exist')) {
        this.logger.warn(`overageRecord table not found, fallback: ${error.message}`);
        try {
          await (this.prisma as any).auditLog?.create({
            data: {
              id: randomUUID(),
              tenantId: data.tenantId,
              action: 'OVERAGE_DETECTED',
              resource: 'OverageRecord',
              resourceId: id,
              metadata: { ...record, fallback: true },
              createdAt: new Date(),
            },
          });
        } catch {}
        return record;
      }
      this.logger.error(`Failed to create overage record: ${error.message}`, error.stack);
      throw error;
    }

    return record;
  }

  async findById(id: string, tenantId?: string): Promise<OverageRecord | null> {
    try {
      const result = await (this.prisma as any).overageRecord?.findFirst({
        where: { id, ...(tenantId ? { tenantId } : {}) },
      });
      if (!result) return null;
      return this.mapToDomain(result);
    } catch {
      return null;
    }
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<OverageRecord | null> {
    try {
      const result = await (this.prisma as any).overageRecord?.findFirst({
        where: { idempotencyKey },
      });
      if (!result) return null;
      return this.mapToDomain(result);
    } catch {
      return null;
    }
  }

  async findByTenantPeriodMeter(tenantId: string, periodId: string, meterKey: MeterKey): Promise<OverageRecord | null> {
    try {
      const result = await (this.prisma as any).overageRecord?.findFirst({
        where: { tenantId, periodId, meterKey },
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
      periodId?: string;
      status?: OverageStatus;
      fromDate?: Date;
      toDate?: Date;
      limit?: number;
      offset?: number;
    },
  ): Promise<OverageRecord[]> {
    try {
      const where: any = { tenantId };
      if (filter?.meterKey) where.meterKey = filter.meterKey;
      if (filter?.periodId) where.periodId = filter.periodId;
      if (filter?.status) where.status = filter.status;
      if (filter?.fromDate || filter?.toDate) {
        where.periodStart = {};
        if (filter.fromDate) where.periodStart.gte = filter.fromDate;
        if (filter.toDate) where.periodStart.lte = filter.toDate;
      }

      const results = await (this.prisma as any).overageRecord?.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filter?.limit || 100,
        skip: filter?.offset || 0,
      });

      if (!results) return [];
      return results.map((r: any) => this.mapToDomain(r));
    } catch {
      return [];
    }
  }

  async updateStatus(id: string, status: OverageStatus, metadata?: Record<string, unknown>): Promise<OverageRecord | null> {
    try {
      const updated = await (this.prisma as any).overageRecord?.update({
        where: { id },
        data: {
          status,
          updatedAt: new Date(),
          ...(metadata ? { metadata } : {}),
        },
      });
      if (!updated) return null;
      return this.mapToDomain(updated);
    } catch {
      return null;
    }
  }

  private mapToDomain(raw: any): OverageRecord {
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      meterKey: raw.meterKey as MeterKey,
      limitKey: raw.limitKey,
      periodId: raw.periodId,
      periodStart: raw.periodStart ? new Date(raw.periodStart).toISOString() : new Date().toISOString(),
      periodEnd: raw.periodEnd ? new Date(raw.periodEnd).toISOString() : new Date().toISOString(),
      allowedQuantity: raw.allowedQuantity,
      actualQuantity: raw.actualQuantity,
      excessQuantity: raw.excessQuantity,
      unit: raw.unit as MeterUnit,
      policyReference: raw.policyReference || null,
      rateReference: raw.rateReference || null,
      rateBps: raw.rateBps || null,
      estimatedAmount: raw.estimatedAmount?.toString() || null,
      currency: raw.currency || null,
      status: raw.status as OverageStatus,
      idempotencyKey: raw.idempotencyKey,
      calculationTimestamp: raw.calculationTimestamp ? new Date(raw.calculationTimestamp).toISOString() : new Date().toISOString(),
      createdAt: raw.createdAt ? new Date(raw.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: raw.updatedAt ? new Date(raw.updatedAt).toISOString() : new Date().toISOString(),
      metadata: raw.metadata || null,
    };
  }
}
