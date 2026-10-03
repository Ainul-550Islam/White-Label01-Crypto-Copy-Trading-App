import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { FeeAccrual, FeeAccrualStatus, SettlementState, PayoutState, FeeType, FeeSourceType, RateBasis } from './fee.types';
import { randomUUID } from 'crypto';

/** Accrual fields without a FeeAccrual column, stored in `metadata` under this key. */
export const FEE_ACCRUAL_METADATA_KEY = '_fee';

export interface FeeAccrualExtras {
  netAmount?: string | null;
  payoutState?: string | null;
  payoutId?: string | null;
  ledgerTransactionId?: string | null;
  policySnapshot?: unknown;
  calculationTimestamp?: string | null;
}

/** Metadata JSON for a write: caller metadata (replacing the stored one when given) plus merged accrual fields. */
export function buildFeeAccrualMetadata(existing: unknown, userMetadata: Record<string, unknown> | null, extras: FeeAccrualExtras): Record<string, unknown> {
  const current: Record<string, unknown> = existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...(existing as Record<string, unknown>) } : {};
  const storedRaw = current[FEE_ACCRUAL_METADATA_KEY];
  const stored: Record<string, unknown> = storedRaw && typeof storedRaw === 'object' ? { ...(storedRaw as Record<string, unknown>) } : {};
  const user: Record<string, unknown> = userMetadata ? { ...userMetadata } : current;
  delete user[FEE_ACCRUAL_METADATA_KEY];
  for (const [key, value] of Object.entries(extras)) {
    if (value !== undefined) stored[key] = value;
  }
  return { ...user, [FEE_ACCRUAL_METADATA_KEY]: stored };
}

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
    const existingByIdempotency = await this.findByIdempotencyKey(data.idempotencyKey, data.tenantId);
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
      // FeeAccrual columns only (feeSourceType, sourceAmount, rateBps,
      // rateReference); the rest of the accrual lives in metadata._fee. The
      // previous column names made Prisma reject every accrual.
      const created = await (this.prisma as any).feeAccrual?.create({
        data: {
          id: accrual.id,
          tenantId: accrual.tenantId,
          feeType: accrual.feeType,
          feeSourceType: accrual.sourceType,
          sourceId: accrual.sourceId,
          sourceAmount: accrual.grossAmount,
          feeAmount: accrual.feeAmount,
          currency: accrual.currency,
          rateBps: accrual.feeRateBps ?? null,
          rateReference: accrual.rateBasis ?? null,
          status: accrual.status,
          settlementState: accrual.settlementState,
          settlementId: accrual.settlementId,
          settlementTimestamp: null,
          idempotencyKey: accrual.idempotencyKey,
          metadata: buildFeeAccrualMetadata(null, (accrual.metadata as any) ?? {}, {
            netAmount: accrual.netAmount,
            payoutState: accrual.payoutState,
            payoutId: accrual.payoutId,
            ledgerTransactionId: accrual.ledgerTransactionId,
            policySnapshot: accrual.policySnapshot,
            calculationTimestamp: new Date(accrual.calculationTimestamp).toISOString(),
          }) as any,
          safeMetadata: (accrual.safeMetadata ?? {}) as any,
          createdAt: new Date(accrual.createdAt),
        },
      });

      if (created) {
        return this.mapToDomain(created);
      }
    } catch (error: any) {
      // Handle duplicate key (idempotency) - return existing
      if (error.code === 'P2002' || error.message?.includes('Unique constraint')) {
        this.logger.warn(`Duplicate accrual detected, returning existing: ${data.idempotencyKey}`);
        const existing = await this.findByIdempotencyKey(data.idempotencyKey, data.tenantId);
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
              resourceType: 'FeeAccrual',
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

  async findByIdempotencyKey(idempotencyKey: string, tenantId: string): Promise<FeeAccrual | null> {
    const result = await (this.prisma as any).feeAccrual?.findFirst({
      where: { idempotencyKey, tenantId },
    });
    if (!result) return null;
    return this.mapToDomain(result);
  }

  async findBySource(tenantId: string, sourceType: FeeSourceType, sourceId: string, feeType?: FeeType): Promise<FeeAccrual | null> {
    const result = await (this.prisma as any).feeAccrual?.findFirst({
      where: {
        tenantId,
        feeSourceType: sourceType,
        sourceId,
        ...(feeType ? { feeType } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!result) return null;
    return this.mapToDomain(result);
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
    const where: any = { tenantId };
    if (filter?.feeType) where.feeType = filter.feeType;
    if (filter?.sourceType) where.feeSourceType = filter.sourceType;
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
  }

  async listEligibleForSettlement(tenantId: string, currency?: string, feeType?: FeeType, limit?: number): Promise<FeeAccrual[]> {
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
      if (updates.settlementId !== undefined) data.settlementId = updates.settlementId;
      const extras: FeeAccrualExtras = {};
      if (updates.payoutState !== undefined) extras.payoutState = updates.payoutState;
      if (updates.payoutId !== undefined) extras.payoutId = updates.payoutId;
      if (updates.ledgerTransactionId !== undefined) extras.ledgerTransactionId = updates.ledgerTransactionId;
      if (Object.keys(extras).length > 0) data.metadata = buildFeeAccrualMetadata(existing.metadata, null, extras);
      if (updates.settlementTimestamp !== undefined) {
        data.settlementTimestamp = updates.settlementTimestamp ? new Date(updates.settlementTimestamp) : null;
      }

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
    const metadata: Record<string, any> = raw.metadata && typeof raw.metadata === 'object' ? { ...raw.metadata } : {};
    const record: Record<string, any> = metadata[FEE_ACCRUAL_METADATA_KEY] && typeof metadata[FEE_ACCRUAL_METADATA_KEY] === 'object' ? metadata[FEE_ACCRUAL_METADATA_KEY] : {};
    delete metadata[FEE_ACCRUAL_METADATA_KEY];
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      sourceType: raw.feeSourceType as FeeSourceType,
      sourceId: raw.sourceId,
      feeType: raw.feeType as FeeType,
      feeRateBps: raw.rateBps,
      rateBasis: raw.rateReference as RateBasis,
      grossAmount: raw.sourceAmount?.toString() || '0',
      feeAmount: raw.feeAmount?.toString() || '0',
      netAmount: record.netAmount?.toString() || '0',
      currency: raw.currency,
      status: raw.status as FeeAccrualStatus,
      settlementState: raw.settlementState as SettlementState,
      payoutState: (record.payoutState as PayoutState) || null,
      settlementId: raw.settlementId || null,
      payoutId: record.payoutId || null,
      ledgerTransactionId: record.ledgerTransactionId || null,
      idempotencyKey: raw.idempotencyKey,
      policySnapshot: record.policySnapshot,
      calculationTimestamp: record.calculationTimestamp
        ? new Date(record.calculationTimestamp).toISOString()
        : raw.createdAt
          ? new Date(raw.createdAt).toISOString()
          : new Date().toISOString(),
      settlementTimestamp: raw.settlementTimestamp ? new Date(raw.settlementTimestamp).toISOString() : null,
      createdAt: raw.createdAt ? new Date(raw.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: raw.updatedAt ? new Date(raw.updatedAt).toISOString() : new Date().toISOString(),
      metadata: raw.metadata ? metadata : null,
      safeMetadata: raw.safeMetadata && Object.keys(raw.safeMetadata).length > 0 ? raw.safeMetadata : null,
    };
  }

}
