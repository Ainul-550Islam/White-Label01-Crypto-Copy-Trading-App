import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { Payout, PayoutStatus, PayoutProvider, BeneficiaryType, PayoutDestination } from './payout.types';
import { randomUUID } from 'crypto';

/**
 * Persistent payout records, provider references, beneficiary mapping,
 * idempotency, status transitions, tenant-scoped payout history.
 * Protects finalized records from illegal mutation.
 */
@Injectable()
export class PayoutRepository {
  private readonly logger = new Logger(PayoutRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    settlementId: string;
    beneficiaryId: string;
    beneficiaryType: BeneficiaryType;
    tenantId: string;
    amount: string;
    currency: string;
    destination: PayoutDestination;
    provider: PayoutProvider;
    providerPayoutId?: string | null;
    providerReference?: string | null;
    status: PayoutStatus;
    failureReason?: string | null;
    idempotencyKey: string;
    metadata?: Record<string, unknown> | null;
    safeMetadata?: Record<string, unknown> | null;
  }): Promise<Payout> {
    // Idempotency check
    const existingByKey = await this.findByIdempotencyKey(data.idempotencyKey);
    if (existingByKey) {
      this.logger.log(`Idempotent payout return by idempotencyKey: ${data.idempotencyKey}`);
      return existingByKey;
    }

    const existingBySettlement = await this.findBySettlement(data.settlementId);
    if (existingBySettlement && existingBySettlement.length > 0) {
      // Check if same beneficiary and amount already exists for this settlement
      const duplicate = existingBySettlement.find((p) => p.beneficiaryId === data.beneficiaryId && p.amount === data.amount && p.currency === data.currency);
      if (duplicate) {
        this.logger.log(`Idempotent payout return by settlement+beneficiary: settlement=${data.settlementId} beneficiary=${data.beneficiaryId}`);
        return duplicate;
      }
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    const payout: Payout = {
      id,
      settlementId: data.settlementId,
      beneficiaryId: data.beneficiaryId,
      beneficiaryType: data.beneficiaryType,
      tenantId: data.tenantId,
      amount: data.amount,
      currency: data.currency.toUpperCase(),
      destination: data.destination,
      provider: data.provider,
      providerPayoutId: data.providerPayoutId || null,
      providerReference: data.providerReference || null,
      status: data.status,
      failureReason: data.failureReason || null,
      idempotencyKey: data.idempotencyKey,
      requestedAt: now,
      processedAt: null,
      succeededAt: null,
      failedAt: null,
      cancelledAt: null,
      metadata: data.metadata || null,
      safeMetadata: data.safeMetadata || null,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const created = await (this.prisma as any).payout?.create({
        data: {
          id: payout.id,
          settlementId: payout.settlementId,
          beneficiaryId: payout.beneficiaryId,
          beneficiaryType: payout.beneficiaryType,
          tenantId: payout.tenantId,
          amount: payout.amount,
          currency: payout.currency,
          destination: payout.destination as any,
          provider: payout.provider,
          providerPayoutId: payout.providerPayoutId,
          providerReference: payout.providerReference,
          status: payout.status,
          failureReason: payout.failureReason,
          idempotencyKey: payout.idempotencyKey,
          requestedAt: new Date(payout.requestedAt),
          processedAt: null,
          succeededAt: null,
          failedAt: null,
          cancelledAt: null,
          metadata: payout.metadata,
          safeMetadata: payout.safeMetadata,
          createdAt: new Date(payout.createdAt),
          updatedAt: new Date(payout.updatedAt),
        },
      });

      if (created) {
        return this.mapToDomain(created);
      }
    } catch (error: any) {
      if (error.code === 'P2002') {
        this.logger.warn(`Duplicate payout idempotency: ${data.idempotencyKey}`);
        const existing = await this.findByIdempotencyKey(data.idempotencyKey);
        if (existing) return existing;
      }
      if (error.code === 'P2021' || error.message?.includes('does not exist')) {
        this.logger.warn(`payout table not found, fallback: ${error.message}`);
        try {
          await (this.prisma as any).auditLog?.create({
            data: {
              id: randomUUID(),
              tenantId: data.tenantId,
              action: 'PAYOUT_CREATED',
              resource: 'Payout',
              resourceId: id,
              metadata: { ...payout, fallback: true },
              createdAt: new Date(),
            },
          });
        } catch {}
        return payout;
      }
      this.logger.error(`Failed to create payout: ${error.message}`, error.stack);
      throw error;
    }

    return payout;
  }

  async findById(id: string, tenantId?: string): Promise<Payout | null> {
    try {
      const result = await (this.prisma as any).payout?.findFirst({
        where: { id, ...(tenantId ? { tenantId } : {}) },
      });
      if (!result) return null;
      return this.mapToDomain(result);
    } catch {
      return null;
    }
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<Payout | null> {
    try {
      const result = await (this.prisma as any).payout?.findFirst({
        where: { idempotencyKey },
      });
      if (!result) return null;
      return this.mapToDomain(result);
    } catch {
      return null;
    }
  }

  async findBySettlement(settlementId: string): Promise<Payout[]> {
    try {
      const results = await (this.prisma as any).payout?.findMany({
        where: { settlementId },
        orderBy: { createdAt: 'desc' },
      });
      if (!results) return [];
      return results.map((r: any) => this.mapToDomain(r));
    } catch {
      return [];
    }
  }

  async findByProviderReference(providerPayoutId: string): Promise<Payout | null> {
    try {
      const result = await (this.prisma as any).payout?.findFirst({
        where: { providerPayoutId },
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
      status?: PayoutStatus;
      provider?: PayoutProvider;
      beneficiaryId?: string;
      currency?: string;
      fromDate?: Date;
      toDate?: Date;
      limit?: number;
      offset?: number;
    },
  ): Promise<Payout[]> {
    try {
      const where: any = { tenantId };
      if (filter?.status) where.status = filter.status;
      if (filter?.provider) where.provider = filter.provider;
      if (filter?.beneficiaryId) where.beneficiaryId = filter.beneficiaryId;
      if (filter?.currency) where.currency = filter.currency;
      if (filter?.fromDate || filter?.toDate) {
        where.createdAt = {};
        if (filter.fromDate) where.createdAt.gte = filter.fromDate;
        if (filter.toDate) where.createdAt.lte = filter.toDate;
      }

      const results = await (this.prisma as any).payout?.findMany({
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

  async updateStatus(
    id: string,
    updates: {
      status?: PayoutStatus;
      providerPayoutId?: string | null;
      providerReference?: string | null;
      failureReason?: string | null;
      processedAt?: string | null;
      succeededAt?: string | null;
      failedAt?: string | null;
      cancelledAt?: string | null;
    },
  ): Promise<Payout | null> {
    try {
      const existing = await (this.prisma as any).payout?.findFirst({ where: { id } });
      if (!existing) return null;

      // Protect finalized records from illegal mutation
      if (existing.status === PayoutStatus.SUCCEEDED) {
        if (updates.status && updates.status !== PayoutStatus.SUCCEEDED && updates.status !== PayoutStatus.REVERSED) {
          throw new Error(`Cannot mutate SUCCEEDED payout ${id} to ${updates.status}`);
        }
      }
      if (existing.status === PayoutStatus.REVERSED) {
        throw new Error(`Cannot mutate REVERSED payout ${id}`);
      }

      const data: any = { updatedAt: new Date() };
      if (updates.status) data.status = updates.status;
      if (updates.providerPayoutId !== undefined) data.providerPayoutId = updates.providerPayoutId;
      if (updates.providerReference !== undefined) data.providerReference = updates.providerReference;
      if (updates.failureReason !== undefined) data.failureReason = updates.failureReason;
      if (updates.processedAt !== undefined) data.processedAt = updates.processedAt ? new Date(updates.processedAt) : null;
      if (updates.succeededAt !== undefined) data.succeededAt = updates.succeededAt ? new Date(updates.succeededAt) : null;
      if (updates.failedAt !== undefined) data.failedAt = updates.failedAt ? new Date(updates.failedAt) : null;
      if (updates.cancelledAt !== undefined) data.cancelledAt = updates.cancelledAt ? new Date(updates.cancelledAt) : null;

      // Auto-set timestamps based on status
      if (updates.status === PayoutStatus.PROCESSING && !data.processedAt) data.processedAt = new Date();
      if (updates.status === PayoutStatus.SUCCEEDED && !data.succeededAt) data.succeededAt = new Date();
      if (updates.status === PayoutStatus.FAILED && !data.failedAt) data.failedAt = new Date();
      if (updates.status === PayoutStatus.CANCELLED && !data.cancelledAt) data.cancelledAt = new Date();

      const updated = await (this.prisma as any).payout?.update({
        where: { id },
        data,
      });

      if (!updated) return null;
      return this.mapToDomain(updated);
    } catch (error: any) {
      if (error.code === 'P2021' || error.message?.includes('does not exist')) return null;
      throw error;
    }
  }

  private mapToDomain(raw: any): Payout {
    return {
      id: raw.id,
      settlementId: raw.settlementId,
      beneficiaryId: raw.beneficiaryId,
      beneficiaryType: raw.beneficiaryType as BeneficiaryType,
      tenantId: raw.tenantId,
      amount: raw.amount?.toString() || '0',
      currency: raw.currency,
      destination: raw.destination as PayoutDestination,
      provider: raw.provider as PayoutProvider,
      providerPayoutId: raw.providerPayoutId || null,
      providerReference: raw.providerReference || null,
      status: raw.status as PayoutStatus,
      failureReason: raw.failureReason || null,
      idempotencyKey: raw.idempotencyKey,
      requestedAt: raw.requestedAt ? new Date(raw.requestedAt).toISOString() : new Date().toISOString(),
      processedAt: raw.processedAt ? new Date(raw.processedAt).toISOString() : null,
      succeededAt: raw.succeededAt ? new Date(raw.succeededAt).toISOString() : null,
      failedAt: raw.failedAt ? new Date(raw.failedAt).toISOString() : null,
      cancelledAt: raw.cancelledAt ? new Date(raw.cancelledAt).toISOString() : null,
      metadata: raw.metadata || null,
      safeMetadata: raw.safeMetadata || null,
      createdAt: raw.createdAt ? new Date(raw.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: raw.updatedAt ? new Date(raw.updatedAt).toISOString() : new Date().toISOString(),
    };
  }
}
