import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PartnerCommission, PartnerCommissionState, PartnerAuditAction } from './partner.types';
import { PartnerAuditService } from './partner-audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class PartnerCommissionLedgerService {
  private readonly logger = new Logger(PartnerCommissionLedgerService.name);
  private readonly inMemory: Map<string, PartnerCommission> = new Map();
  private readonly idemIndex: Map<string, string> = new Map(); // idempotencyKey -> id
  private readonly sourceEventIndex: Map<string, string> = new Map(); // sourceEventId+partnerId -> id

  constructor(
    private readonly audit: PartnerAuditService,
    private readonly prisma: PrismaService,
  ) {}

  async accrueCommission(commission: PartnerCommission, actorId: string): Promise<PartnerCommission> {
    if (!commission) throw new BadRequestException('commission required');

    // Idempotency: duplicate billing/payment/fee events must not double-commission
    const idemKey = commission.idempotencyKey;
    if (this.idemIndex.has(idemKey)) {
      const existingId = this.idemIndex.get(idemKey)!;
      const existing = this.inMemory.get(existingId);
      if (existing) {
        this.logger.log(`commission ledger idempotent hit key=${idemKey}`);
        return existing;
      }
    }

    const sourceKey = `${commission.partnerId}:${commission.sourceEventId}`;
    if (this.sourceEventIndex.has(sourceKey)) {
      const existingId = this.sourceEventIndex.get(sourceKey)!;
      const existing = this.inMemory.get(existingId);
      if (existing) {
        this.logger.log(`commission duplicate source event blocked partner=${commission.partnerId} sourceEvent=${commission.sourceEventId}`);
        return existing;
      }
    }

    try {
      const existing = await (this.prisma as any).partnerCommission?.findFirst?.({ where: { idempotencyKey: idemKey } });
      if (existing) {
        this.logger.log(`commission ledger DB idempotent hit key=${idemKey}`);
        return this.mapRow(existing);
      }
      const existingSource = await (this.prisma as any).partnerCommission?.findFirst?.({ where: { partnerId: commission.partnerId, sourceEventId: commission.sourceEventId } });
      if (existingSource) {
        this.logger.log(`commission duplicate source event DB blocked partner=${commission.partnerId} sourceEvent=${commission.sourceEventId}`);
        return this.mapRow(existingSource);
      }
    } catch {}

    this.inMemory.set(commission.id, commission);
    this.idemIndex.set(idemKey, commission.id);
    this.sourceEventIndex.set(sourceKey, commission.id);

    try {
      await (this.prisma as any).partnerCommission?.create?.({
        data: {
          id: commission.id,
          partnerId: commission.partnerId,
          tenantId: commission.tenantId,
          sourcePaymentId: commission.sourcePaymentId,
          sourceInvoiceId: commission.sourceInvoiceId,
          sourceSubscriptionId: commission.sourceSubscriptionId,
          sourceFeeId: commission.sourceFeeId,
          sourceEventId: commission.sourceEventId,
          sourceEventType: commission.sourceEventType,
          grossRevenue: commission.grossRevenue,
          discountAmount: commission.discountAmount,
          netEligibleRevenue: commission.netEligibleRevenue,
          commissionRate: commission.commissionRate,
          commissionBasis: commission.commissionBasis,
          commissionModel: commission.commissionModel,
          commissionAmount: commission.commissionAmount,
          currency: commission.currency,
          sourceCurrency: commission.sourceCurrency,
          commissionCurrency: commission.commissionCurrency,
          fxRequired: commission.fxRequired,
          fxRate: commission.fxRate,
          fxTimestamp: commission.fxTimestamp ? new Date(commission.fxTimestamp) : null,
          fxSource: commission.fxSource,
          agreementVersion: commission.agreementVersion,
          policyVersion: commission.policyVersion,
          calculationVersion: commission.calculationVersion,
          state: commission.state,
          settlementId: commission.settlementId,
          payoutId: commission.payoutId,
          reversalOfId: commission.reversalOfId,
          createdAt: new Date(commission.createdAt),
          updatedAt: new Date(commission.updatedAt),
          accruedAt: new Date(commission.accruedAt),
          idempotencyKey: commission.idempotencyKey,
          correlationId: commission.correlationId,
        },
      });
    } catch {
      this.logger.debug(`commission ledger persist skipped id=${commission.id}`);
    }

    await this.audit.recordEvent({
      partnerId: commission.partnerId,
      tenantId: commission.tenantId,
      actorId,
      action: PartnerAuditAction.COMMISSION_ACCRUED,
      source: 'PARTNER_COMMISSION_LEDGER',
      correlationId: commission.correlationId,
      agreementVersion: commission.agreementVersion,
      policyVersion: commission.policyVersion,
      safeEvidence: {
        commissionId: commission.id,
        amount: commission.commissionAmount,
        currency: commission.currency,
        basis: commission.commissionBasis,
        model: commission.commissionModel,
        sourceEventId: commission.sourceEventId,
      },
    });

    this.logger.log(`commission accrued id=${commission.id} partner=${commission.partnerId} amount=${commission.commissionAmount} ${commission.currency} corr=${commission.correlationId}`);
    return commission;
  }

  async reverseCommission(params: {
    originalCommissionId: string;
    partnerId: string;
    tenantId: string;
    reversalReason: string;
    reversalType: 'REFUND' | 'CHARGEBACK' | 'CANCELLATION';
    reversalAmount?: string; // if proportional
    correlationId: string;
    actorId: string;
    idempotencyKey: string;
  }): Promise<PartnerCommission> {
    const original = await this.getCommission(params.originalCommissionId, params.partnerId);
    if (original.state === PartnerCommissionState.REVERSED) throw new BadRequestException('already reversed');

    // Idempotency for reversal
    if (this.idemIndex.has(params.idempotencyKey)) {
      const existingId = this.idemIndex.get(params.idempotencyKey)!;
      const existing = this.inMemory.get(existingId);
      if (existing) return existing;
    }

    const reversalAmount = params.reversalAmount ?? original.commissionAmount;
    // Never delete original - create reversal linked
    const reversal: PartnerCommission = {
      id: `pcom_rev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      partnerId: params.partnerId,
      tenantId: params.tenantId,
      sourcePaymentId: original.sourcePaymentId,
      sourceInvoiceId: original.sourceInvoiceId,
      sourceSubscriptionId: original.sourceSubscriptionId,
      sourceFeeId: original.sourceFeeId,
      sourceEventId: `${original.sourceEventId}_reversal_${params.reversalType}`,
      sourceEventType: original.sourceEventType,
      grossRevenue: `-${original.grossRevenue}`,
      discountAmount: original.discountAmount,
      netEligibleRevenue: `-${original.netEligibleRevenue}`,
      commissionRate: original.commissionRate,
      commissionBasis: original.commissionBasis,
      commissionModel: original.commissionModel,
      commissionAmount: `-${reversalAmount}`,
      currency: original.currency,
      sourceCurrency: original.sourceCurrency,
      commissionCurrency: original.commissionCurrency,
      fxRequired: original.fxRequired,
      fxRate: original.fxRate,
      fxTimestamp: original.fxTimestamp,
      fxSource: original.fxSource,
      agreementVersion: original.agreementVersion,
      policyVersion: original.policyVersion,
      calculationVersion: original.calculationVersion,
      state: PartnerCommissionState.REVERSED,
      settlementId: null,
      payoutId: null,
      reversalOfId: original.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      accruedAt: new Date().toISOString(),
      idempotencyKey: params.idempotencyKey,
      correlationId: params.correlationId,
    };

    this.inMemory.set(reversal.id, reversal);
    this.idemIndex.set(params.idempotencyKey, reversal.id);

    // Mark original as reversed
    original.state = PartnerCommissionState.REVERSED;
    original.updatedAt = new Date().toISOString();
    this.inMemory.set(original.id, original);

    try {
      await (this.prisma as any).$transaction?.(async (tx: any) => {
        await tx.partnerCommission?.create?.({
          data: {
            id: reversal.id,
            partnerId: reversal.partnerId,
            tenantId: reversal.tenantId,
            sourcePaymentId: reversal.sourcePaymentId,
            sourceInvoiceId: reversal.sourceInvoiceId,
            sourceSubscriptionId: reversal.sourceSubscriptionId,
            sourceFeeId: reversal.sourceFeeId,
            sourceEventId: reversal.sourceEventId,
            sourceEventType: reversal.sourceEventType,
            grossRevenue: reversal.grossRevenue,
            discountAmount: reversal.discountAmount,
            netEligibleRevenue: reversal.netEligibleRevenue,
            commissionRate: reversal.commissionRate,
            commissionBasis: reversal.commissionBasis,
            commissionModel: reversal.commissionModel,
            commissionAmount: reversal.commissionAmount,
            currency: reversal.currency,
            sourceCurrency: reversal.sourceCurrency,
            commissionCurrency: reversal.commissionCurrency,
            fxRequired: reversal.fxRequired,
            fxRate: reversal.fxRate,
            fxTimestamp: reversal.fxTimestamp ? new Date(reversal.fxTimestamp) : null,
            fxSource: reversal.fxSource,
            agreementVersion: reversal.agreementVersion,
            policyVersion: reversal.policyVersion,
            calculationVersion: reversal.calculationVersion,
            state: reversal.state,
            reversalOfId: reversal.reversalOfId,
            createdAt: new Date(reversal.createdAt),
            updatedAt: new Date(reversal.updatedAt),
            accruedAt: new Date(reversal.accruedAt),
            idempotencyKey: reversal.idempotencyKey,
            correlationId: reversal.correlationId,
          },
        });
        await tx.partnerCommission?.update?.({ where: { id: original.id }, data: { state: 'REVERSED', updatedAt: new Date() } });
      });
    } catch {
      this.logger.debug(`reversal persist skipped id=${reversal.id}`);
      try {
        await (this.prisma as any).partnerCommission?.create?.({
          data: {
            id: reversal.id,
            partnerId: reversal.partnerId,
            tenantId: reversal.tenantId,
            sourceEventId: reversal.sourceEventId,
            sourceEventType: reversal.sourceEventType,
            grossRevenue: reversal.grossRevenue,
            commissionAmount: reversal.commissionAmount,
            currency: reversal.currency,
            commissionBasis: reversal.commissionBasis,
            commissionModel: reversal.commissionModel,
            commissionRate: reversal.commissionRate,
            sourceCurrency: reversal.sourceCurrency,
            commissionCurrency: reversal.commissionCurrency,
            fxRequired: reversal.fxRequired,
            agreementVersion: reversal.agreementVersion,
            policyVersion: reversal.policyVersion,
            calculationVersion: reversal.calculationVersion,
            state: reversal.state,
            reversalOfId: reversal.reversalOfId,
            createdAt: new Date(reversal.createdAt),
            updatedAt: new Date(reversal.updatedAt),
            accruedAt: new Date(reversal.accruedAt),
            idempotencyKey: reversal.idempotencyKey,
            correlationId: reversal.correlationId,
            netEligibleRevenue: reversal.netEligibleRevenue,
            discountAmount: reversal.discountAmount,
          },
        });
        await (this.prisma as any).partnerCommission?.update?.({ where: { id: original.id }, data: { state: 'REVERSED' } });
      } catch {}
    }

    await this.audit.recordEvent({
      partnerId: params.partnerId,
      tenantId: params.tenantId,
      actorId: params.actorId,
      action: PartnerAuditAction.COMMISSION_REVERSED,
      source: 'PARTNER_COMMISSION_LEDGER',
      correlationId: params.correlationId,
      agreementVersion: original.agreementVersion,
      policyVersion: original.policyVersion,
      safeEvidence: { originalCommissionId: original.id, reversalId: reversal.id, reason: params.reversalReason, type: params.reversalType, amount: reversalAmount },
    });

    this.logger.log(`commission reversed original=${original.id} reversal=${reversal.id} reason=${params.reversalReason} corr=${params.correlationId}`);
    return reversal;
  }

  async getCommission(commissionId: string, partnerId: string): Promise<PartnerCommission> {
    const mem = this.inMemory.get(commissionId);
    if (mem) {
      if (mem.partnerId !== partnerId) throw new BadRequestException('partner isolation violation');
      return mem;
    }
    try {
      const row = await (this.prisma as any).partnerCommission?.findUnique?.({ where: { id: commissionId } });
      if (row) {
        if (row.partnerId !== partnerId) throw new BadRequestException('partner isolation violation');
        const mapped = this.mapRow(row);
        this.inMemory.set(mapped.id, mapped);
        return mapped;
      }
    } catch {}
    throw new BadRequestException(`commission ${commissionId} not found`);
  }

  async listCommissions(partnerId: string, filters?: { tenantId?: string; state?: PartnerCommissionState; settlementId?: string; currency?: string }): Promise<PartnerCommission[]> {
    let list = [...this.inMemory.values()].filter(c => c.partnerId === partnerId);
    if (filters?.tenantId) list = list.filter(c => c.tenantId === filters.tenantId);
    if (filters?.state) list = list.filter(c => c.state === filters.state);
    if (filters?.settlementId) list = list.filter(c => c.settlementId === filters.settlementId);
    if (filters?.currency) {
      const curUpper = filters.currency.toUpperCase();
      list = list.filter(c => c.currency === curUpper);
    }
    try {
      const where: any = { partnerId };
      if (filters?.tenantId) where.tenantId = filters.tenantId;
      if (filters?.state) where.state = filters.state;
      if (filters?.settlementId) where.settlementId = filters.settlementId;
      if (filters?.currency) where.currency = filters.currency.toUpperCase();
      const rows = await (this.prisma as any).partnerCommission?.findMany?.({ where, take: 1000, orderBy: { accruedAt: 'desc' } });
      if (rows && rows.length > 0) list = rows.map((r: any) => this.mapRow(r));
    } catch {}
    return list;
  }

  private mapRow(row: any): PartnerCommission {
    return {
      id: row.id,
      partnerId: row.partnerId,
      tenantId: row.tenantId,
      sourcePaymentId: row.sourcePaymentId ?? null,
      sourceInvoiceId: row.sourceInvoiceId ?? null,
      sourceSubscriptionId: row.sourceSubscriptionId ?? null,
      sourceFeeId: row.sourceFeeId ?? null,
      sourceEventId: row.sourceEventId,
      sourceEventType: row.sourceEventType,
      grossRevenue: row.grossRevenue,
      discountAmount: row.discountAmount,
      netEligibleRevenue: row.netEligibleRevenue,
      commissionRate: row.commissionRate,
      commissionBasis: row.commissionBasis,
      commissionModel: row.commissionModel,
      commissionAmount: row.commissionAmount,
      currency: row.currency,
      sourceCurrency: row.sourceCurrency,
      commissionCurrency: row.commissionCurrency,
      fxRequired: !!row.fxRequired,
      fxRate: row.fxRate ?? null,
      fxTimestamp: row.fxTimestamp ? (row.fxTimestamp instanceof Date ? row.fxTimestamp.toISOString() : row.fxTimestamp) : null,
      fxSource: row.fxSource ?? null,
      agreementVersion: row.agreementVersion,
      policyVersion: row.policyVersion,
      calculationVersion: row.calculationVersion,
      state: row.state,
      settlementId: row.settlementId ?? null,
      payoutId: row.payoutId ?? null,
      reversalOfId: row.reversalOfId ?? null,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
      accruedAt: row.accruedAt instanceof Date ? row.accruedAt.toISOString() : row.accruedAt,
      idempotencyKey: row.idempotencyKey,
      correlationId: row.correlationId,
    };
  }
}
