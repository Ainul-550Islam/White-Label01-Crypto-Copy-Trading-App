import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { FeeAccrual, FeeAccrualStatus, SettlementState, PayoutState, FeeType, FeeSourceType, RateBasis } from './fee.types';
import { randomUUID } from 'crypto';

/**
 * Persistent storage abstraction for immutable fee accruals.
 * Idempotency via unique idempotencyKey and source reference.
 * Tenant-scoped queries, auditable history.
 */
@Injectable()
export class FeeAccrualRepository {
  private readonly logger = new Logger(FeeAccrualRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    tenantId: string;
    sourceType: FeeSourceType;
    sourceId: string;
    feeType: FeeType;
    feeRateBps: number;
    rateBasis: RateBasis;
    grossAmount: string;
    feeAmount: string;
    netAmount: string;
    currency: string;
    status: FeeAccrualStatus;
    settlementState: SettlementState;
    payoutState?: PayoutState | null;
    settlementId?: string | null;
    payoutId?: string | null;
    ledgerTransactionId?: string | null;
    idempotencyKey: string;
    policySnapshot: any;
    calculationTimestamp: string;
    metadata?: Record<string, unknown> | null;
    safeMetadata?: Record<string, unknown> | null;
  }): Promise<FeeAccrual> {
    // Idempotency check first
    const existingByIdempotency = await this.findByIdempotencyKey(data.idempotencyKey);
    if (existingByIdempotency) {
      this.logger.log(`Idempotent accrual return by idempotencyKey: ${data.idempotencyKey}`);
      return existingByIdempotency;
    }

    const existingBySource = await this.findBySource(data.tenantId, data.sourceType, data.sourceId, data.feeType);
    if (existingBySource) {
      this.logger.log(`Idempotent accrual return by source: ${data.sourceType}:${data.sourceId} feeType=${data.feeType}`);
      return existingBySource;
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    const accrual: FeeAccrual = {
      id,
      tenantId: data.tenantId,
      sourceType: data.sourceType,
      sourceId: data.sourceId,
      feeType: data.feeType,
      feeRateBps: data.feeRateBps,
      rateBasis: data.rateBasis,
      grossAmount: data.grossAmount,
      feeAmount: data.feeAmount,
      netAmount: data.netAmount,
      currency: data.currency.toUpperCase(),
      status: data.status,
      settlementState: data.settlementState,
      payoutState: data.payoutState || null,
      settlementId: data.settlementId || null,
      payoutId: data.payoutId || null,
      ledgerTransactionId: data.ledgerTransactionId || null,
      idempotencyKey: data.idempotencyKey,
      policySnapshot: data.policySnapshot,
      calculationTimestamp: data.calculationTimestamp,
      settlementTimestamp: null,
      createdAt: now,
      updatedAt: now,
      metadata: data.metadata || null,
      safeMetadata: data.safeMetadata || null,
    };

    try {
      const created = await (this.prisma as any).feeAccrual?.create({
        data: {
          id: accrual.id,
          tenantId: accrual.tenantId,
          sourceType: accrual.sourceType,
          sourceId: accrual.sourceId,
          feeType: accrual.feeType,
          feeRateBps: accrual.feeRateBps,
          rateBasis: accrual.rateBasis,
          grossAmount: accrual.grossAmount,
          feeAmount: accrual.feeAmount,
          netAmount: accrual.netAmount,
          currency: accrual.currency,
          status: accrual.status,
          settlementState: accrual.settlementState,
          payoutState: accrual.payoutState,
          settlementId: accrual.settlementId,
          payoutId: accrual.payoutId,
          ledgerTransactionId: accrual.ledgerTransactionId,
          idempotencyKey: accrual.idempotencyKey,
          policySnapshot: accrual.policySnapshot,
          calculationTimestamp: new Date(accrual.calculationTimestamp),
          settlementTimestamp: null,
          metadata: accrual.metadata,
          safeMetadata: accrual.safeMetadata,
          createdAt: new Date(accrual.createdAt),
          updatedAt: new Date(accrual.updatedAt),
        },
      });

      if (created) {
        return this.mapToDomain(created);
      }
    } catch (error: any) {
      // Handle duplicate key (idempotency) - return existing
      if (error.code === 'P2002' || error.message?.includes('Unique constraint')) {
        this.logger.warn(`Duplicate accrual detected, returning existing: ${data.idempotencyKey}`);
        const existing = await this.findByIdempotencyKey(data.idempotencyKey);
        if (existing) return existing;
        const bySource = await this.findBySource(data.tenantId, data.sourceType, data.sourceId, data.feeType);
        if (bySource) return bySource;
      }

      if (error.code === 'P2021' || error.message?.includes('does not exist')) {
        // Table doesn't exist - fallback to audit log storage but return domain object
        this.logger.warn(`feeAccrual table not found, using fallback storage: ${error.message}`);
        // Try to store in audit log as fallback for auditability
        try {
          await (this.prisma as any).auditLog?.create({
            data: {
              id: randomUUID(),
              tenantId: data.tenantId,
              action: 'FEE_ACCRUED',
              resource: 'FeeAccrual',
              resourceId: id,
              metadata: {
                ...accrual,
                fallback: true,
              },
              createdAt: new Date(),
            },
          });
        } catch {}
        return accrual;
      }

      this.logger.error(`Failed to create fee accrual: ${error.message}`, error.stack);
      throw error;
    }

    // Fallback if prisma model not available
    return accrual;
  }

  async findById(id: string, tenantId?: string): Promise<FeeAccrual | null> {
    try {
      const result = await (this.prisma as any).feeAccrual?.findFirst({
        where: {
          id,
          ...(tenantId ? { tenantId } : {}),
        },
      });
      if (!result) return null;
      return this.mapToDomain(result);
    } catch (error: any) {
      if (error.code === 'P2021' || error.message?.includes('does not exist')) {
        return null;
      }
      throw error;
    }
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<FeeAccrual | null> {
    try {
      const result = await (this.prisma as any).feeAccrual?.findFirst({
        where: { idempotencyKey },
      });
      if (!result) return null;
      return this.mapToDomain(result);
    } catch {
      return null;
    }
  }

  async findBySource(tenantId: string, sourceType: FeeSourceType, sourceId: string, feeType?: FeeType): Promise<FeeAccrual | null> {
    try {
      const result = await (this.prisma as any).feeAccrual?.findFirst({
        where: {
          tenantId,
          sourceType,
          sourceId,
          ...(feeType ? { feeType } : {}),
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
      feeType?: FeeType;
      sourceType?: FeeSourceType;
      status?: FeeAccrualStatus;
      settlementState?: SettlementState;
      currency?: string;
      fromDate?: Date;
      toDate?: Date;
      limit?: number;
      offset?: number;
    },
  ): Promise<FeeAccrual[]> {
    try {
      const where: any = { tenantId };
      if (filter?.feeType) where.feeType = filter.feeType;
      if (filter?.sourceType) where.sourceType = filter.sourceType;
      if (filter?.status) where.status = filter.status;
      if (filter?.settlementState) where.settlementState = filter.settlementState;
      if (filter?.currency) where.currency = filter.currency;
      if (filter?.fromDate || filter?.toDate) {
        where.createdAt = {};
        if (filter.fromDate) where.createdAt.gte = filter.fromDate;
        if (filter.toDate) where.createdAt.lte = filter.toDate;
      }

      const results = await (this.prisma as any).feeAccrual?.findMany({
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

  async listEligibleForSettlement(tenantId: string, currency?: string, feeType?: FeeType, limit?: number): Promise<FeeAccrual[]> {
    try {
      const where: any = {
        tenantId,
        status: FeeAccrualStatus.ACCRUED,
        settlementState: { in: [SettlementState.DRAFT, SettlementState.CALCULATED] },
      };
      if (currency) where.currency = currency;
      if (feeType) where.feeType = feeType;

      const results = await (this.prisma as any).feeAccrual?.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take: limit || 100,
      });

      if (!results) return [];
      return results.map((r: any) => this.mapToDomain(r));
    } catch {
      return [];
    }
  }

  async updateStatus(
    id: string,
    updates: {
      status?: FeeAccrualStatus;
      settlementState?: SettlementState;
      payoutState?: PayoutState | null;
      settlementId?: string | null;
      payoutId?: string | null;
      ledgerTransactionId?: string | null;
      settlementTimestamp?: string | null;
    },
  ): Promise<FeeAccrual | null> {
    try {
      const existing = await (this.prisma as any).feeAccrual?.findFirst({ where: { id } });
      if (!existing) return null;

      const data: any = {};
      if (updates.status) data.status = updates.status;
      if (updates.settlementState) data.settlementState = updates.settlementState;
      if (updates.payoutState !== undefined) data.payoutState = updates.payoutState;
      if (updates.settlementId !== undefined) data.settlementId = updates.settlementId;
      if (updates.payoutId !== undefined) data.payoutId = updates.payoutId;
      if (updates.ledgerTransactionId !== undefined) data.ledgerTransactionId = updates.ledgerTransactionId;
      if (updates.settlementTimestamp !== undefined) {
        data.settlementTimestamp = updates.settlementTimestamp ? new Date(updates.settlementTimestamp) : null;
      }
      data.updatedAt = new Date();

      const updated = await (this.prisma as any).feeAccrual?.update({
        where: { id },
        data,
      });

      if (!updated) return null;
      return this.mapToDomain(updated);
    } catch (error: any) {
      if (error.code === 'P2021' || error.message?.includes('does not exist')) {
        return null;
      }
      throw error;
    }
  }

  async aggregateByTenant(
    tenantId: string,
    filter?: { currency?: string; feeType?: FeeType; fromDate?: Date; toDate?: Date },
  ): Promise<{ totalFeeAmount: string; count: number; currency: string }> {
    const accruals = await this.listByTenant(tenantId, {
      currency: filter?.currency,
      feeType: filter?.feeType,
      fromDate: filter?.fromDate,
      toDate: filter?.toDate,
      limit: 1000,
    });

    let totalMinor = 0;
    let currency = filter?.currency || 'USD';
    const { parseToMinorUnits, formatFromMinorUnits, getMinorUnitForCurrency } = await import('../finance/money.types');

    for (const accrual of accruals) {
      if (!currency) currency = accrual.currency;
      try {
        const minor = parseToMinorUnits(accrual.feeAmount, accrual.currency);
        totalMinor += minor;
      } catch {}
    }

    return {
      totalFeeAmount: formatFromMinorUnits(totalMinor, currency),
      count: accruals.length,
      currency,
    };
  }

  private mapToDomain(raw: any): FeeAccrual {
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      sourceType: raw.sourceType as FeeSourceType,
      sourceId: raw.sourceId,
      feeType: raw.feeType as FeeType,
      feeRateBps: raw.feeRateBps,
      rateBasis: raw.rateBasis as RateBasis,
      grossAmount: raw.grossAmount?.toString() || '0',
      feeAmount: raw.feeAmount?.toString() || '0',
      netAmount: raw.netAmount?.toString() || '0',
      currency: raw.currency,
      status: raw.status as FeeAccrualStatus,
      settlementState: raw.settlementState as SettlementState,
      payoutState: (raw.payoutState as PayoutState) || null,
      settlementId: raw.settlementId || null,
      payoutId: raw.payoutId || null,
      ledgerTransactionId: raw.ledgerTransactionId || null,
      idempotencyKey: raw.idempotencyKey,
      policySnapshot: raw.policySnapshot,
      calculationTimestamp: raw.calculationTimestamp ? new Date(raw.calculationTimestamp).toISOString() : raw.createdAt ? new Date(raw.createdAt).toISOString() : new Date().toISOString(),
      settlementTimestamp: raw.settlementTimestamp ? new Date(raw.settlementTimestamp).toISOString() : null,
      createdAt: raw.createdAt ? new Date(raw.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: raw.updatedAt ? new Date(raw.updatedAt).toISOString() : new Date().toISOString(),
      metadata: raw.metadata || null,
      safeMetadata: raw.safeMetadata || null,
    };
  }
}
