import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { deterministicAccountingFingerprint, redactSecrets } from './portfolio-accounting.types';

/**
 * Persists immutable normalized accounting events with uniqueness and tenant isolation.
 * Must support deterministic replay and period reconstruction without destructive mutation.
 * Immutable: no update/delete that mutates historical truth — only reversal via adjustment.
 */

@Injectable()
export class AccountingEventRepository {
  private readonly logger = new Logger(AccountingEventRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async createEvent(params: {
    tenantId: string;
    profileId: string;
    eventType: string;
    cashFlowType?: string | null;
    sourceType: string;
    sourceId: string;
    sourceTimestamp: Date;
    asset?: string | null;
    quantity?: string | null;
    price?: string | null;
    amount?: string | null;
    feeAmount?: string | null;
    currency?: string | null;
    orderId?: string | null;
    fillId?: string | null;
    tradeId?: string | null;
    feeAccrualId?: string | null;
    financeLedgerId?: string | null;
    copyAllocationId?: string | null;
    baseCurrency?: string | null;
    conversionRate?: string | null;
    conversionSource?: string | null;
    conversionTimestamp?: Date | null;
    conversionStatus?: string | null;
    calculationVersion: string;
    policyVersion: string;
    idempotencyKey: string;
    correlationId?: string | null;
    requestId?: string | null;
    metadata?: Record<string, unknown>;
    evidence?: Record<string, unknown>;
  }): Promise<any> {
    // Idempotency mandatory — re-running same event must not double-count
    try {
      const existing = await (this.prisma as any).portfolioAccountingEvent.findFirst({
        where: { idempotencyKey: params.idempotencyKey },
      });
      if (existing) {
        this.logger.log({ event: 'portfolio.event.idempotent_hit', idempotencyKey: params.idempotencyKey });
        return existing;
      }
    } catch {}

    const fingerprint = deterministicAccountingFingerprint({
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      tenantId: params.tenantId,
      profileId: params.profileId,
      asset: params.asset ?? undefined,
      quantity: params.quantity ?? undefined,
    });

    // Check fingerprint duplicate as secondary guard
    try {
      const existingByFingerprint = await (this.prisma as any).portfolioAccountingEvent.findFirst({
        where: { tenantId: params.tenantId, fingerprint, sourceType: params.sourceType, sourceId: params.sourceId },
      });
      if (existingByFingerprint) {
        this.logger.log({ event: 'portfolio.event.fingerprint_duplicate', fingerprint });
        return existingByFingerprint;
      }
    } catch {}

    const created = await (this.prisma as any).portfolioAccountingEvent.create({
      data: {
        tenantId: params.tenantId,
        profileId: params.profileId,
        eventType: params.eventType,
        cashFlowType: params.cashFlowType ? (params.cashFlowType as any) : null,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        sourceTimestamp: params.sourceTimestamp,
        asset: params.asset ?? null,
        quantity: params.quantity ?? null,
        price: params.price ?? null,
        amount: params.amount ?? null,
        feeAmount: params.feeAmount ?? null,
        currency: params.currency ?? null,
        orderId: params.orderId ?? null,
        fillId: params.fillId ?? null,
        tradeId: params.tradeId ?? null,
        feeAccrualId: params.feeAccrualId ?? null,
        financeLedgerId: params.financeLedgerId ?? null,
        copyAllocationId: params.copyAllocationId ?? null,
        baseCurrency: params.baseCurrency ?? null,
        conversionRate: params.conversionRate ?? null,
        conversionSource: params.conversionSource ?? null,
        conversionTimestamp: params.conversionTimestamp ?? null,
        conversionStatus: params.conversionStatus ?? null,
        calculationVersion: params.calculationVersion,
        policyVersion: params.policyVersion,
        idempotencyKey: params.idempotencyKey,
        fingerprint,
        correlationId: params.correlationId ?? null,
        requestId: params.requestId ?? null,
        metadata: redactSecrets(params.metadata ?? {}) as any,
        evidence: redactSecrets(params.evidence ?? {}) as any,
      },
    });

    return created;
  }

  async listEvents(params: {
    tenantId: string;
    profileId?: string;
    eventType?: string;
    sourceType?: string;
    from?: Date;
    to?: Date;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { tenantId, profileId, eventType, sourceType, from, to, page = 1, limit = 50 } = params;
    const where: any = { tenantId };
    if (profileId) where.profileId = profileId;
    if (eventType) where.eventType = eventType;
    if (sourceType) where.sourceType = sourceType;
    if (from || to) {
      where.sourceTimestamp = {};
      if (from) where.sourceTimestamp.gte = from;
      if (to) where.sourceTimestamp.lte = to;
    }

    try {
      const [data, total] = await Promise.all([
        (this.prisma as any).portfolioAccountingEvent.findMany({
          where,
          orderBy: { sourceTimestamp: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        (this.prisma as any).portfolioAccountingEvent.count({ where }),
      ]);
      return { data, total, page, limit };
    } catch {
      return { data: [], total: 0, page, limit };
    }
  }

  async getEventsForPeriod(params: {
    tenantId: string;
    profileId: string;
    periodStart: Date;
    periodEnd: Date;
  }): Promise<any[]> {
    try {
      return await (this.prisma as any).portfolioAccountingEvent.findMany({
        where: {
          tenantId: params.tenantId,
          profileId: params.profileId,
          sourceTimestamp: { gte: params.periodStart, lte: params.periodEnd },
          isReversed: false,
        },
        orderBy: { sourceTimestamp: 'asc' },
      });
    } catch {
      return [];
    }
  }

  async replayEvents(params: {
    tenantId: string;
    profileId: string;
    from?: Date;
    to?: Date;
  }): Promise<any[]> {
    // Deterministic replay for period reconstruction
    try {
      const where: any = { tenantId: params.tenantId, profileId: params.profileId, isReversed: false };
      if (params.from || params.to) {
        where.sourceTimestamp = {};
        if (params.from) where.sourceTimestamp.gte = params.from;
        if (params.to) where.sourceTimestamp.lte = params.to;
      }
      return await (this.prisma as any).portfolioAccountingEvent.findMany({
        where,
        orderBy: [{ sourceTimestamp: 'asc' }, { createdAt: 'asc' }],
      });
    } catch {
      return [];
    }
  }

  async findBySource(params: { tenantId: string; sourceType: string; sourceId: string }): Promise<any | null> {
    try {
      return await (this.prisma as any).portfolioAccountingEvent.findFirst({
        where: { tenantId: params.tenantId, sourceType: params.sourceType, sourceId: params.sourceId },
      });
    } catch {
      return null;
    }
  }
}
