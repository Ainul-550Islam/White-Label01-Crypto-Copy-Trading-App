import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SettlementBatch, SettlementItem, SettlementState, FeeType } from './fee.types';
import { randomUUID } from 'crypto';

/**
 * Persistence abstraction for settlement batches, items, locks, status transitions.
 * Idempotent via idempotencyKey, prevents double settlement.
 */
@Injectable()
export class FeeSettlementRepository {
  private readonly logger = new Logger(FeeSettlementRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async createSettlement(data: {
    tenantId: string;
    currency: string;
    grossFeeAmount: string;
    adjustments?: string;
    finalSettlementAmount: string;
    numberOfAccruals: number;
    feeType: FeeType | 'MIXED';
    status: SettlementState;
    idempotencyKey: string;
    accrualIds: string[];
    metadata?: Record<string, unknown> | null;
  }): Promise<SettlementBatch> {
    // Idempotency check
    const existingByKey = await this.findByIdempotencyKey(data.idempotencyKey);
    if (existingByKey) {
      this.logger.log(`Idempotent settlement return by idempotencyKey: ${data.idempotencyKey}`);
      return existingByKey;
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    const settlement: SettlementBatch = {
      id,
      tenantId: data.tenantId,
      currency: data.currency.toUpperCase(),
      grossFeeAmount: data.grossFeeAmount,
      adjustments: data.adjustments || '0',
      finalSettlementAmount: data.finalSettlementAmount,
      numberOfAccruals: data.numberOfAccruals,
      feeType: data.feeType,
      status: data.status,
      idempotencyKey: data.idempotencyKey,
      accrualIds: data.accrualIds,
      createdAt: now,
      calculatedAt: data.status === SettlementState.CALCULATED || data.status === SettlementState.FINALIZED ? now : null,
      approvedAt: null,
      finalizedAt: data.status === SettlementState.FINALIZED ? now : null,
      paidAt: null,
      metadata: data.metadata || null,
    };

    try {
      const created = await (this.prisma as any).feeSettlement?.create({
        data: {
          id: settlement.id,
          tenantId: settlement.tenantId,
          currency: settlement.currency,
          grossFeeAmount: settlement.grossFeeAmount,
          adjustments: settlement.adjustments,
          finalSettlementAmount: settlement.finalSettlementAmount,
          numberOfAccruals: settlement.numberOfAccruals,
          feeType: settlement.feeType,
          status: settlement.status,
          idempotencyKey: settlement.idempotencyKey,
          accrualIds: settlement.accrualIds,
          createdAt: new Date(settlement.createdAt),
          calculatedAt: settlement.calculatedAt ? new Date(settlement.calculatedAt) : null,
          approvedAt: null,
          finalizedAt: settlement.finalizedAt ? new Date(settlement.finalizedAt) : null,
          paidAt: null,
          metadata: settlement.metadata,
        },
      });

      if (created) {
        // Create settlement items
        await this.createSettlementItems(id, data.accrualIds, data.tenantId, data.currency, data.feeType);

        return this.mapBatchToDomain(created);
      }
    } catch (error: any) {
      if (error.code === 'P2002') {
        this.logger.warn(`Duplicate settlement idempotency: ${data.idempotencyKey}`);
        const existing = await this.findByIdempotencyKey(data.idempotencyKey);
        if (existing) return existing;
      }
      if (error.code === 'P2021' || error.message?.includes('does not exist')) {
        this.logger.warn(`feeSettlement table not found, fallback: ${error.message}`);
        try {
          await (this.prisma as any).auditLog?.create({
            data: {
              id: randomUUID(),
              tenantId: data.tenantId,
              action: 'SETTLEMENT_CREATED',
              resource: 'FeeSettlement',
              resourceId: id,
              metadata: { ...settlement, fallback: true },
              createdAt: new Date(),
            },
          });
        } catch {}
        return settlement;
      }
      this.logger.error(`Failed to create settlement: ${error.message}`, error.stack);
      throw error;
    }

    return settlement;
  }

  private async createSettlementItems(settlementId: string, accrualIds: string[], tenantId: string, currency: string, feeType: FeeType | 'MIXED'): Promise<void> {
    try {
      // Fetch accruals to get fee amounts
      const accruals = await (this.prisma as any).feeAccrual?.findMany({
        where: { id: { in: accrualIds } },
      });

      if (!accruals || accruals.length === 0) {
        // Fallback: create items without amounts
        for (const accrualId of accrualIds) {
          try {
            await (this.prisma as any).feeSettlementItem?.create({
              data: {
                id: randomUUID(),
                settlementId,
                accrualId,
                tenantId,
                feeType: feeType === 'MIXED' ? 'PLATFORM_FEE' : feeType,
                feeAmount: '0',
                currency,
                status: SettlementState.DRAFT,
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            });
          } catch {}
        }
        return;
      }

      for (const accrual of accruals) {
        try {
          await (this.prisma as any).feeSettlementItem?.create({
            data: {
              id: randomUUID(),
              settlementId,
              accrualId: accrual.id,
              tenantId,
              feeType: accrual.feeType,
              feeAmount: accrual.feeAmount?.toString() || '0',
              currency: accrual.currency,
              status: SettlementState.DRAFT,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
        } catch (e: any) {
          if (e.code !== 'P2002') {
            this.logger.warn(`Failed to create settlement item for accrual ${accrual.id}: ${e.message}`);
          }
        }
      }
    } catch (e) {
      this.logger.warn(`Failed to create settlement items: ${(e as Error).message}`);
    }
  }

  async findById(id: string, tenantId?: string): Promise<SettlementBatch | null> {
    try {
      const result = await (this.prisma as any).feeSettlement?.findFirst({
        where: { id, ...(tenantId ? { tenantId } : {}) },
      });
      if (!result) return null;
      return this.mapBatchToDomain(result);
    } catch {
      return null;
    }
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<SettlementBatch | null> {
    try {
      const result = await (this.prisma as any).feeSettlement?.findFirst({
        where: { idempotencyKey },
      });
      if (!result) return null;
      return this.mapBatchToDomain(result);
    } catch {
      return null;
    }
  }

  async listByTenant(
    tenantId: string,
    filter?: {
      status?: SettlementState;
      currency?: string;
      feeType?: FeeType | 'MIXED';
      fromDate?: Date;
      toDate?: Date;
      limit?: number;
      offset?: number;
    },
  ): Promise<SettlementBatch[]> {
    try {
      const where: any = { tenantId };
      if (filter?.status) where.status = filter.status;
      if (filter?.currency) where.currency = filter.currency;
      if (filter?.feeType) where.feeType = filter.feeType;
      if (filter?.fromDate || filter?.toDate) {
        where.createdAt = {};
        if (filter.fromDate) where.createdAt.gte = filter.fromDate;
        if (filter.toDate) where.createdAt.lte = filter.toDate;
      }

      const results = await (this.prisma as any).feeSettlement?.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filter?.limit || 100,
        skip: filter?.offset || 0,
      });

      if (!results) return [];
      return results.map((r: any) => this.mapBatchToDomain(r));
    } catch {
      return [];
    }
  }

  async getSettlementItems(settlementId: string): Promise<SettlementItem[]> {
    try {
      const results = await (this.prisma as any).feeSettlementItem?.findMany({
        where: { settlementId },
        orderBy: { createdAt: 'asc' },
      });
      if (!results) return [];
      return results.map((r: any) => this.mapItemToDomain(r));
    } catch {
      return [];
    }
  }

  async updateStatus(
    id: string,
    status: SettlementState,
    extra?: { approvedAt?: string | null; finalizedAt?: string | null; paidAt?: string | null },
  ): Promise<SettlementBatch | null> {
    try {
      const data: any = { status, updatedAt: new Date() };
      if (extra?.approvedAt !== undefined) data.approvedAt = extra.approvedAt ? new Date(extra.approvedAt) : null;
      if (extra?.finalizedAt !== undefined) data.finalizedAt = extra.finalizedAt ? new Date(extra.finalizedAt) : null;
      if (extra?.paidAt !== undefined) data.paidAt = extra.paidAt ? new Date(extra.paidAt) : null;
      if (status === SettlementState.CALCULATED && !data.calculatedAt) data.calculatedAt = new Date();
      if (status === SettlementState.APPROVED && !data.approvedAt) data.approvedAt = new Date();
      if (status === SettlementState.FINALIZED && !data.finalizedAt) data.finalizedAt = new Date();
      if (status === SettlementState.PAID && !data.paidAt) data.paidAt = new Date();

      const updated = await (this.prisma as any).feeSettlement?.update({
        where: { id },
        data,
      });

      if (!updated) return null;
      return this.mapBatchToDomain(updated);
    } catch (error: any) {
      if (error.code === 'P2021' || error.message?.includes('does not exist')) return null;
      throw error;
    }
  }

  private mapBatchToDomain(raw: any): SettlementBatch {
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      currency: raw.currency,
      grossFeeAmount: raw.grossFeeAmount?.toString() || '0',
      adjustments: raw.adjustments?.toString() || '0',
      finalSettlementAmount: raw.finalSettlementAmount?.toString() || '0',
      numberOfAccruals: raw.numberOfAccruals,
      feeType: raw.feeType as FeeType | 'MIXED',
      status: raw.status as SettlementState,
      idempotencyKey: raw.idempotencyKey,
      accrualIds: raw.accrualIds || [],
      createdAt: raw.createdAt ? new Date(raw.createdAt).toISOString() : new Date().toISOString(),
      calculatedAt: raw.calculatedAt ? new Date(raw.calculatedAt).toISOString() : null,
      approvedAt: raw.approvedAt ? new Date(raw.approvedAt).toISOString() : null,
      finalizedAt: raw.finalizedAt ? new Date(raw.finalizedAt).toISOString() : null,
      paidAt: raw.paidAt ? new Date(raw.paidAt).toISOString() : null,
      metadata: raw.metadata || null,
    };
  }

  private mapItemToDomain(raw: any): SettlementItem {
    return {
      id: raw.id,
      settlementId: raw.settlementId,
      accrualId: raw.accrualId,
      tenantId: raw.tenantId,
      feeType: raw.feeType as FeeType,
      feeAmount: raw.feeAmount?.toString() || '0',
      currency: raw.currency,
      status: raw.status as SettlementState,
    };
  }
}
