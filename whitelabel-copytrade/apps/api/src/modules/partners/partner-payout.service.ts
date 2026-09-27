import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PartnerPayout, PartnerPayoutState, PARTNER_PAYOUT_TRANSITIONS, PartnerAuditAction, PartnerSettlementState } from './partner.types';
import { PartnerAuditService } from './partner-audit.service';
import { PartnerProfileService } from './partner-profile.service';
import { PartnerSettlementService } from './partner-settlement.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class PartnerPayoutService {
  private readonly logger = new Logger(PartnerPayoutService.name);
  private readonly inMemory: Map<string, PartnerPayout> = new Map();
  private readonly idemIndex: Map<string, string> = new Map();

  constructor(
    private readonly audit: PartnerAuditService,
    private readonly profileService: PartnerProfileService,
    private readonly settlementService: PartnerSettlementService,
    private readonly prisma: PrismaService,
  ) {}

  async requestPayout(params: {
    partnerId: string;
    settlementId: string;
    amount: string;
    currency: string;
    method: string;
    requestedBy: string;
    correlationId: string;
    idempotencyKey: string;
  }): Promise<PartnerPayout> {
    if (!params.partnerId || !params.settlementId || !params.amount || !params.currency || !params.idempotencyKey) {
      throw new BadRequestException('partnerId, settlementId, amount, currency, idempotencyKey required');
    }

    await this.profileService.getProfile(params.partnerId);

    // Idempotency
    if (this.idemIndex.has(params.idempotencyKey)) {
      const existingId = this.idemIndex.get(params.idempotencyKey)!;
      const existing = this.inMemory.get(existingId);
      if (existing) return existing;
    }

    // Settlement must exist and be in appropriate state
    const settlement = await this.settlementService.getSettlement(params.settlementId, params.partnerId);
    if (settlement.state !== PartnerSettlementState.LOCKED && settlement.state !== PartnerSettlementState.PAYOUT_REQUESTED && settlement.state !== PartnerSettlementState.COMPLETED) {
      throw new BadRequestException(`settlement must be LOCKED to request payout, current ${settlement.state}`);
    }

    if (settlement.totalCommissionPayable !== params.amount && this.compareDecimal(settlement.totalCommissionPayable, params.amount, params.currency) !== 0) {
      // Allow but warn if mismatch - should match
      this.logger.warn(`payout amount ${params.amount} differs from settlement payable ${settlement.totalCommissionPayable}`);
    }

    if (settlement.currency.toUpperCase() !== params.currency.toUpperCase()) {
      throw new BadRequestException(`currency mismatch settlement ${settlement.currency} vs payout ${params.currency}`);
    }

    const payout: PartnerPayout = {
      id: `ppay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      partnerId: params.partnerId,
      settlementId: params.settlementId,
      amount: params.amount,
      currency: params.currency.toUpperCase(),
      state: PartnerPayoutState.REQUESTED,
      method: params.method,
      providerPayoutId: null,
      providerReference: null,
      failureReason: null,
      requestedAt: new Date().toISOString(),
      requestedBy: params.requestedBy,
      approvedAt: null,
      approvedBy: null,
      submittedAt: null,
      completedAt: null,
      failedAt: null,
      reversedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      idempotencyKey: params.idempotencyKey,
      correlationId: params.correlationId,
    };

    this.inMemory.set(payout.id, payout);
    this.idemIndex.set(params.idempotencyKey, payout.id);

    try {
      await (this.prisma as any).partnerPayout?.create?.({
        data: {
          id: payout.id,
          partnerId: payout.partnerId,
          settlementId: payout.settlementId,
          amount: payout.amount,
          currency: payout.currency,
          state: payout.state,
          method: payout.method,
          requestedAt: new Date(payout.requestedAt),
          requestedBy: payout.requestedBy,
          createdAt: new Date(payout.createdAt),
          updatedAt: new Date(payout.updatedAt),
          idempotencyKey: payout.idempotencyKey,
          correlationId: payout.correlationId,
        },
      });
    } catch {
      this.logger.debug(`payout persist skipped id=${payout.id}`);
    }

    await this.audit.recordEvent({
      partnerId: params.partnerId,
      actorId: params.requestedBy,
      action: PartnerAuditAction.PAYOUT_REQUESTED,
      source: 'PARTNER_PAYOUT_SERVICE',
      correlationId: params.correlationId,
      safeEvidence: { payoutId: payout.id, settlementId: params.settlementId, amount: payout.amount, currency: payout.currency },
    });

    this.logger.log(`payout requested id=${payout.id} partner=${params.partnerId} amount=${params.amount} corr=${params.correlationId}`);
    return payout;
  }

  async transitionState(params: {
    payoutId: string;
    partnerId: string;
    targetState: PartnerPayoutState;
    correlationId: string;
    actorId: string;
    providerPayoutId?: string;
    providerReference?: string;
    failureReason?: string;
  }): Promise<PartnerPayout> {
    const payout = await this.getPayout(params.payoutId, params.partnerId);
    const allowed = PARTNER_PAYOUT_TRANSITIONS[payout.state];
    if (!allowed.includes(params.targetState)) throw new BadRequestException(`invalid transition ${payout.state} -> ${params.targetState}`);

    // COMPLETED requires authoritative payout evidence
    if (params.targetState === PartnerPayoutState.COMPLETED) {
      if (!params.providerPayoutId || !params.providerReference) {
        throw new BadRequestException('COMPLETED requires authoritative payout evidence providerPayoutId and providerReference');
      }
      payout.providerPayoutId = params.providerPayoutId;
      payout.providerReference = params.providerReference;
      payout.completedAt = new Date().toISOString();
    }

    if (params.targetState === PartnerPayoutState.APPROVED) {
      payout.approvedAt = new Date().toISOString();
      payout.approvedBy = params.actorId;
    }
    if (params.targetState === PartnerPayoutState.SUBMITTED) payout.submittedAt = new Date().toISOString();
    if (params.targetState === PartnerPayoutState.FAILED) {
      if (!params.failureReason) throw new BadRequestException('failureReason required for FAILED');
      payout.failureReason = params.failureReason;
      payout.failedAt = new Date().toISOString();
    }
    if (params.targetState === PartnerPayoutState.REVERSED) payout.reversedAt = new Date().toISOString();

    const prev = payout.state;
    payout.state = params.targetState;
    payout.updatedAt = new Date().toISOString();

    this.inMemory.set(payout.id, payout);
    try {
      await (this.prisma as any).partnerPayout?.update?.({
        where: { id: payout.id },
        data: {
          state: payout.state,
          providerPayoutId: payout.providerPayoutId,
          providerReference: payout.providerReference,
          failureReason: payout.failureReason,
          approvedAt: payout.approvedAt ? new Date(payout.approvedAt) : null,
          approvedBy: payout.approvedBy,
          submittedAt: payout.submittedAt ? new Date(payout.submittedAt) : null,
          completedAt: payout.completedAt ? new Date(payout.completedAt) : null,
          failedAt: payout.failedAt ? new Date(payout.failedAt) : null,
          reversedAt: payout.reversedAt ? new Date(payout.reversedAt) : null,
          updatedAt: new Date(payout.updatedAt),
        },
      });
    } catch {
      this.logger.debug(`payout transition persist skipped id=${payout.id}`);
    }

    const auditAction = params.targetState === PartnerPayoutState.COMPLETED ? PartnerAuditAction.PAYOUT_COMPLETED
      : params.targetState === PartnerPayoutState.FAILED ? PartnerAuditAction.PAYOUT_FAILED
      : params.targetState === PartnerPayoutState.REVERSED ? PartnerAuditAction.PAYOUT_REVERSED
      : PartnerAuditAction.PAYOUT_REQUESTED;

    await this.audit.recordEvent({
      partnerId: params.partnerId,
      actorId: params.actorId,
      action: auditAction,
      source: 'PARTNER_PAYOUT_SERVICE',
      correlationId: params.correlationId,
      safeEvidence: { payoutId: payout.id, from: prev, to: params.targetState, providerPayoutId: payout.providerPayoutId },
    });

    this.logger.log(`payout transition id=${payout.id} ${prev} -> ${params.targetState} corr=${params.correlationId}`);
    return payout;
  }

  async getPayout(payoutId: string, partnerId: string): Promise<PartnerPayout> {
    const mem = this.inMemory.get(payoutId);
    if (mem) {
      if (mem.partnerId !== partnerId) throw new BadRequestException('partner isolation violation');
      return mem;
    }
    try {
      const row = await (this.prisma as any).partnerPayout?.findUnique?.({ where: { id: payoutId } });
      if (row) {
        if (row.partnerId !== partnerId) throw new BadRequestException('partner isolation violation');
        const mapped = this.mapRow(row);
        this.inMemory.set(mapped.id, mapped);
        return mapped;
      }
    } catch {}
    throw new NotFoundException(`payout ${payoutId} not found`);
  }

  async listPayouts(partnerId: string, filters?: { settlementId?: string; state?: PartnerPayoutState }): Promise<PartnerPayout[]> {
    let list = [...this.inMemory.values()].filter(p => p.partnerId === partnerId);
    if (filters?.settlementId) list = list.filter(p => p.settlementId === filters.settlementId);
    if (filters?.state) list = list.filter(p => p.state === filters.state);
    try {
      const where: any = { partnerId };
      if (filters?.settlementId) where.settlementId = filters.settlementId;
      if (filters?.state) where.state = filters.state;
      const rows = await (this.prisma as any).partnerPayout?.findMany?.({ where, take: 500, orderBy: { createdAt: 'desc' } });
      if (rows && rows.length > 0) list = rows.map((r: any) => this.mapRow(r));
    } catch {}
    return list;
  }

  private compareDecimal(a: string, b: string, currency: string): number {
    const getMinor = (c: string) => {
      const map: Record<string, number> = { USD: 2, EUR: 2, GBP: 2, JPY: 0, USDT: 6, USDC: 6 };
      return map[c.toUpperCase()] ?? 2;
    };
    const toMinor = (amt: string, curr: string) => {
      const minor = getMinor(curr);
      const factor = Math.pow(10, minor);
      const parts = amt.toString().split('.');
      const intPart = BigInt(parts[0] || '0');
      let frac = parts[1] || '';
      if (frac.length > minor) frac = frac.slice(0, minor);
      while (frac.length < minor) frac += '0';
      const fracPart = BigInt(frac || '0');
      return intPart * BigInt(factor) + fracPart;
    };
    const aMinor = toMinor(a, currency);
    const bMinor = toMinor(b, currency);
    if (aMinor < bMinor) return -1;
    if (aMinor > bMinor) return 1;
    return 0;
  }

  private mapRow(row: any): PartnerPayout {
    return {
      id: row.id,
      partnerId: row.partnerId,
      settlementId: row.settlementId,
      amount: row.amount,
      currency: row.currency,
      state: row.state,
      method: row.method,
      providerPayoutId: row.providerPayoutId ?? null,
      providerReference: row.providerReference ?? null,
      failureReason: row.failureReason ?? null,
      requestedAt: row.requestedAt instanceof Date ? row.requestedAt.toISOString() : row.requestedAt,
      requestedBy: row.requestedBy,
      approvedAt: row.approvedAt ? (row.approvedAt instanceof Date ? row.approvedAt.toISOString() : row.approvedAt) : null,
      approvedBy: row.approvedBy ?? null,
      submittedAt: row.submittedAt ? (row.submittedAt instanceof Date ? row.submittedAt.toISOString() : row.submittedAt) : null,
      completedAt: row.completedAt ? (row.completedAt instanceof Date ? row.completedAt.toISOString() : row.completedAt) : null,
      failedAt: row.failedAt ? (row.failedAt instanceof Date ? row.failedAt.toISOString() : row.failedAt) : null,
      reversedAt: row.reversedAt ? (row.reversedAt instanceof Date ? row.reversedAt.toISOString() : row.reversedAt) : null,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
      idempotencyKey: row.idempotencyKey,
      correlationId: row.correlationId,
    };
  }
}
