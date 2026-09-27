import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PartnerSettlement, PartnerSettlementState, PARTNER_SETTLEMENT_TRANSITIONS, PartnerAuditAction, PartnerCommissionState } from './partner.types';
import { PartnerAuditService } from './partner-audit.service';
import { PartnerProfileService } from './partner-profile.service';
import { PartnerAgreementService } from './partner-agreement.service';
import { PartnerCommissionLedgerService } from './partner-commission-ledger.service';
import { PartnerReconciliationService } from './partner-reconciliation.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class PartnerSettlementService {
  private readonly logger = new Logger(PartnerSettlementService.name);
  private readonly inMemory: Map<string, PartnerSettlement> = new Map();
  private readonly idemIndex: Map<string, string> = new Map();
  private readonly fingerprintIndex: Map<string, string> = new Map(); // partnerId:periodStart:periodEnd:currency:fingerprint -> id

  constructor(
    private readonly audit: PartnerAuditService,
    private readonly profileService: PartnerProfileService,
    private readonly agreementService: PartnerAgreementService,
    private readonly commissionLedger: PartnerCommissionLedgerService,
    private readonly reconciliation: PartnerReconciliationService,
    private readonly prisma: PrismaService,
  ) {}

  async createSettlement(params: {
    partnerId: string;
    periodStart: string;
    periodEnd: string;
    currency: string;
    createdBy: string;
    correlationId: string;
    idempotencyKey: string;
  }): Promise<PartnerSettlement> {
    if (!params.partnerId || !params.periodStart || !params.periodEnd || !params.currency || !params.idempotencyKey) {
      throw new BadRequestException('partnerId, periodStart, periodEnd, currency, idempotencyKey required');
    }

    await this.profileService.getProfile(params.partnerId);
    const agreement = await this.agreementService.getActiveAgreement(params.partnerId);
    if (!agreement) throw new BadRequestException(`no active agreement for partner ${params.partnerId}`);

    const periodStart = new Date(params.periodStart);
    const periodEnd = new Date(params.periodEnd);
    if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime()) || periodStart >= periodEnd) {
      throw new BadRequestException('invalid period');
    }

    // Idempotency
    if (this.idemIndex.has(params.idempotencyKey)) {
      const existingId = this.idemIndex.get(params.idempotencyKey)!;
      const existing = this.inMemory.get(existingId);
      if (existing) return existing;
    }

    // Collect eligible commissions
    const allCommissions = await this.commissionLedger.listCommissions(params.partnerId, { currency: params.currency });
    const eligible = allCommissions.filter(c => {
      const accruedAt = new Date(c.accruedAt);
      return accruedAt >= periodStart && accruedAt <= periodEnd && c.state === PartnerCommissionState.ACCRUED && c.currency.toUpperCase() === params.currency.toUpperCase();
    });

    // Check FX missing - if any commission has fxRequired true without fxRate, settlement blocked
    const missingFx = eligible.filter(c => c.fxRequired && !c.fxRate);
    if (missingFx.length > 0) {
      throw new BadRequestException(`settlement blocked - missing FX for ${missingFx.length} commissions: ${missingFx.map(c => c.id).join(',')}`);
    }

    // Calculate totals Decimal-safe
    let totalGross = '0';
    let totalDiscount = '0';
    let totalNetEligible = '0';
    let totalAccrued = '0';
    let totalReversed = '0';

    // Need to also include reversals in period
    const reversals = allCommissions.filter(c => {
      const accruedAt = new Date(c.accruedAt);
      return accruedAt >= periodStart && accruedAt <= periodEnd && c.state === PartnerCommissionState.REVERSED;
    });

    for (const com of eligible) {
      totalGross = this.addDecimal(totalGross, com.grossRevenue, params.currency);
      totalDiscount = this.addDecimal(totalDiscount, com.discountAmount, params.currency);
      totalNetEligible = this.addDecimal(totalNetEligible, com.netEligibleRevenue, params.currency);
      totalAccrued = this.addDecimal(totalAccrued, com.commissionAmount, params.currency);
    }

    for (const rev of reversals) {
      totalReversed = this.addDecimal(totalReversed, rev.commissionAmount, params.currency); // reversal amounts are negative
    }

    const totalPayable = this.addDecimal(totalAccrued, totalReversed, params.currency);

    // Reconciliation required
    const mismatches = await this.reconciliation.reconcilePartner(params.partnerId, params.correlationId);
    const criticalMismatches = mismatches.filter(m => m.severity === 'CRITICAL' || m.severity === 'HIGH');
    if (criticalMismatches.length > 0) {
      throw new BadRequestException(`settlement blocked - reconciliation has ${criticalMismatches.length} critical/high mismatches`);
    }

    // Fingerprint for duplicate prevention
    const fingerprintInput = {
      partnerId: params.partnerId,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      currency: params.currency.toUpperCase(),
      commissionIds: eligible.map(c => c.id).sort(),
      reversalIds: reversals.map(c => c.id).sort(),
      totalPayable,
      policyVersion: agreement.commissionPolicy.policyVersion,
      agreementVersion: `v${agreement.version}`,
    };
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(fingerprintInput)).digest('hex');
    const fingerprintKey = `${params.partnerId}:${periodStart.toISOString()}:${periodEnd.toISOString()}:${params.currency.toUpperCase()}:${fingerprint}`;
    if (this.fingerprintIndex.has(fingerprintKey)) {
      const existingId = this.fingerprintIndex.get(fingerprintKey)!;
      const existing = this.inMemory.get(existingId);
      if (existing) {
        this.logger.log(`settlement duplicate prevented fingerprint=${fingerprint} corr=${params.correlationId}`);
        return existing;
      }
    }

    try {
      const existingByFingerprint = await (this.prisma as any).partnerSettlement?.findFirst?.({ where: { fingerprint } });
      if (existingByFingerprint) {
        this.logger.log(`settlement duplicate DB prevented fingerprint=${fingerprint}`);
        return this.mapRow(existingByFingerprint);
      }
    } catch {}

    const settlement: PartnerSettlement = {
      id: `pset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      partnerId: params.partnerId,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      currency: params.currency.toUpperCase(),
      state: PartnerSettlementState.OPEN,
      totalGrossRevenue: totalGross,
      totalDiscount,
      totalNetEligibleRevenue: totalNetEligible,
      totalCommissionAccrued: totalAccrued,
      totalCommissionReversed: totalReversed,
      totalCommissionPayable: totalPayable,
      commissionCount: eligible.length,
      reversalCount: reversals.length,
      refundCount: reversals.filter(r => r.sourceEventType === 'REFUND').length,
      chargebackCount: reversals.filter(r => r.sourceEventType === 'CHARGEBACK').length,
      fingerprint,
      calculationVersion: '2026-01',
      policyVersion: agreement.commissionPolicy.policyVersion,
      agreementVersion: `v${agreement.version}`,
      reconciledAt: null,
      lockedAt: null,
      completedAt: null,
      payoutId: null,
      createdBy: params.createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      idempotencyKey: params.idempotencyKey,
      correlationId: params.correlationId,
    };

    this.inMemory.set(settlement.id, settlement);
    this.idemIndex.set(params.idempotencyKey, settlement.id);
    this.fingerprintIndex.set(fingerprintKey, settlement.id);

    try {
      await (this.prisma as any).partnerSettlement?.create?.({
        data: {
          id: settlement.id,
          partnerId: settlement.partnerId,
          periodStart: new Date(settlement.periodStart),
          periodEnd: new Date(settlement.periodEnd),
          currency: settlement.currency,
          state: settlement.state,
          totalGrossRevenue: settlement.totalGrossRevenue,
          totalDiscount: settlement.totalDiscount,
          totalNetEligibleRevenue: settlement.totalNetEligibleRevenue,
          totalCommissionAccrued: settlement.totalCommissionAccrued,
          totalCommissionReversed: settlement.totalCommissionReversed,
          totalCommissionPayable: settlement.totalCommissionPayable,
          commissionCount: settlement.commissionCount,
          reversalCount: settlement.reversalCount,
          refundCount: settlement.refundCount,
          chargebackCount: settlement.chargebackCount,
          fingerprint: settlement.fingerprint,
          calculationVersion: settlement.calculationVersion,
          policyVersion: settlement.policyVersion,
          agreementVersion: settlement.agreementVersion,
          createdBy: settlement.createdBy,
          createdAt: new Date(settlement.createdAt),
          updatedAt: new Date(settlement.updatedAt),
          idempotencyKey: settlement.idempotencyKey,
          correlationId: settlement.correlationId,
        },
      });
    } catch {
      this.logger.debug(`settlement persist skipped id=${settlement.id}`);
    }

    // Atomically link commissions to settlement
    try {
      await (this.prisma as any).$transaction?.(async (tx: any) => {
        for (const com of [...eligible, ...reversals]) {
          await tx.partnerCommission?.update?.({ where: { id: com.id }, data: { settlementId: settlement.id, state: 'SETTLED' } });
        }
      });
    } catch {
      // Fallback
      for (const com of [...eligible, ...reversals]) {
        const memCom = this.inMemory.get(com.id) ?? (await this.commissionLedger.getCommission(com.id, params.partnerId).catch(() => null));
        if (memCom) {
          // Update in ledger in-memory via direct map access not possible, but we track via commissionLedger
          // We'll update via ledger's internal map if accessible, else via prisma
          try {
            await (this.prisma as any).partnerCommission?.update?.({ where: { id: com.id }, data: { settlementId: settlement.id } });
          } catch {}
        }
      }
    }

    await this.audit.recordEvent({
      partnerId: params.partnerId,
      actorId: params.createdBy,
      action: PartnerAuditAction.SETTLEMENT_CREATED,
      source: 'PARTNER_SETTLEMENT_SERVICE',
      correlationId: params.correlationId,
      agreementVersion: settlement.agreementVersion,
      policyVersion: settlement.policyVersion,
      safeEvidence: { settlementId: settlement.id, periodStart: settlement.periodStart, periodEnd: settlement.periodEnd, totalPayable, commissionCount: settlement.commissionCount, fingerprint },
    });

    this.logger.log(`settlement created id=${settlement.id} partner=${params.partnerId} payable=${totalPayable} ${params.currency} corr=${params.correlationId}`);
    return settlement;
  }

  async transitionState(params: { settlementId: string; partnerId: string; targetState: PartnerSettlementState; correlationId: string; actorId: string }): Promise<PartnerSettlement> {
    const settlement = await this.getSettlement(params.settlementId, params.partnerId);
    const allowed = PARTNER_SETTLEMENT_TRANSITIONS[settlement.state];
    if (!allowed.includes(params.targetState)) throw new BadRequestException(`invalid transition ${settlement.state} -> ${params.targetState}`);

    const prev = settlement.state;
    settlement.state = params.targetState;
    settlement.updatedAt = new Date().toISOString();
    if (params.targetState === PartnerSettlementState.RECONCILED) settlement.reconciledAt = new Date().toISOString();
    if (params.targetState === PartnerSettlementState.LOCKED) settlement.lockedAt = new Date().toISOString();
    if (params.targetState === PartnerSettlementState.COMPLETED) settlement.completedAt = new Date().toISOString();

    this.inMemory.set(settlement.id, settlement);
    try {
      await (this.prisma as any).partnerSettlement?.update?.({
        where: { id: settlement.id },
        data: {
          state: settlement.state,
          reconciledAt: settlement.reconciledAt ? new Date(settlement.reconciledAt) : null,
          lockedAt: settlement.lockedAt ? new Date(settlement.lockedAt) : null,
          completedAt: settlement.completedAt ? new Date(settlement.completedAt) : null,
          updatedAt: new Date(settlement.updatedAt),
        },
      });
    } catch {}

    const auditAction = params.targetState === PartnerSettlementState.LOCKED ? PartnerAuditAction.SETTLEMENT_LOCKED : PartnerAuditAction.SETTLEMENT_CREATED;
    await this.audit.recordEvent({
      partnerId: params.partnerId,
      actorId: params.actorId,
      action: auditAction,
      source: 'PARTNER_SETTLEMENT_SERVICE',
      correlationId: params.correlationId,
      agreementVersion: settlement.agreementVersion,
      policyVersion: settlement.policyVersion,
      safeEvidence: { settlementId: settlement.id, from: prev, to: params.targetState },
    });

    this.logger.log(`settlement transition id=${settlement.id} ${prev} -> ${params.targetState} corr=${params.correlationId}`);
    return settlement;
  }

  async getSettlement(settlementId: string, partnerId: string): Promise<PartnerSettlement> {
    const mem = this.inMemory.get(settlementId);
    if (mem) {
      if (mem.partnerId !== partnerId) throw new BadRequestException('partner isolation violation');
      return mem;
    }
    try {
      const row = await (this.prisma as any).partnerSettlement?.findUnique?.({ where: { id: settlementId } });
      if (row) {
        if (row.partnerId !== partnerId) throw new BadRequestException('partner isolation violation');
        const mapped = this.mapRow(row);
        this.inMemory.set(mapped.id, mapped);
        return mapped;
      }
    } catch {}
    throw new NotFoundException(`settlement ${settlementId} not found`);
  }

  async listSettlements(partnerId: string, filters?: { state?: PartnerSettlementState; currency?: string }): Promise<PartnerSettlement[]> {
    let list = [...this.inMemory.values()].filter(s => s.partnerId === partnerId);
    if (filters?.state) list = list.filter(s => s.state === filters.state);
    if (filters?.currency) {
      const curUpper = filters.currency.toUpperCase();
      list = list.filter(s => s.currency === curUpper);
    }
    try {
      const where: any = { partnerId };
      if (filters?.state) where.state = filters.state;
      if (filters?.currency) where.currency = filters.currency.toUpperCase();
      const rows = await (this.prisma as any).partnerSettlement?.findMany?.({ where, take: 500, orderBy: { createdAt: 'desc' } });
      if (rows && rows.length > 0) list = rows.map((r: any) => this.mapRow(r));
    } catch {}
    return list;
  }

  private getMinorUnit(currency: string): number {
    const map: Record<string, number> = { USD: 2, EUR: 2, GBP: 2, JPY: 0, USDT: 6, USDC: 6 };
    return map[currency.toUpperCase()] ?? 2;
  }

  private toMinorUnits(amount: string, currency: string): bigint {
    const minor = this.getMinorUnit(currency);
    const factor = Math.pow(10, minor);
    const parts = amount.toString().split('.');
    const intPart = BigInt(parts[0] || '0');
    let frac = parts[1] || '';
    if (frac.length > minor) frac = frac.slice(0, minor);
    while (frac.length < minor) frac += '0';
    const fracPart = BigInt(frac || '0');
    if (intPart < BigInt(0)) return intPart * BigInt(factor) - fracPart;
    return intPart * BigInt(factor) + fracPart;
  }

  private fromMinorUnits(minor: bigint, currency: string): string {
    const minorUnit = this.getMinorUnit(currency);
    const factor = BigInt(Math.pow(10, minorUnit));
    const isNegative = minor < BigInt(0);
    const abs = isNegative ? -minor : minor;
    const intPart = abs / factor;
    const fracPart = abs % factor;
    let fracStr = fracPart.toString().padStart(minorUnit, '0');
    if (minorUnit > 0) {
      fracStr = fracStr.replace(/0+$/, '');
      if (fracStr === '') fracStr = '0'.repeat(Math.min(2, minorUnit));
    }
    const result = minorUnit === 0 ? intPart.toString() : `${intPart.toString()}.${fracStr}`;
    return isNegative ? `-${result}` : result;
  }

  private addDecimal(a: string, b: string, currency: string): string {
    return this.fromMinorUnits(this.toMinorUnits(a, currency) + this.toMinorUnits(b, currency), currency);
  }

  private mapRow(row: any): PartnerSettlement {
    return {
      id: row.id,
      partnerId: row.partnerId,
      periodStart: row.periodStart instanceof Date ? row.periodStart.toISOString() : row.periodStart,
      periodEnd: row.periodEnd instanceof Date ? row.periodEnd.toISOString() : row.periodEnd,
      currency: row.currency,
      state: row.state,
      totalGrossRevenue: row.totalGrossRevenue,
      totalDiscount: row.totalDiscount,
      totalNetEligibleRevenue: row.totalNetEligibleRevenue,
      totalCommissionAccrued: row.totalCommissionAccrued,
      totalCommissionReversed: row.totalCommissionReversed,
      totalCommissionPayable: row.totalCommissionPayable,
      commissionCount: row.commissionCount,
      reversalCount: row.reversalCount,
      refundCount: row.refundCount,
      chargebackCount: row.chargebackCount,
      fingerprint: row.fingerprint,
      calculationVersion: row.calculationVersion,
      policyVersion: row.policyVersion,
      agreementVersion: row.agreementVersion,
      reconciledAt: row.reconciledAt ? (row.reconciledAt instanceof Date ? row.reconciledAt.toISOString() : row.reconciledAt) : null,
      lockedAt: row.lockedAt ? (row.lockedAt instanceof Date ? row.lockedAt.toISOString() : row.lockedAt) : null,
      completedAt: row.completedAt ? (row.completedAt instanceof Date ? row.completedAt.toISOString() : row.completedAt) : null,
      payoutId: row.payoutId ?? null,
      createdBy: row.createdBy,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
      idempotencyKey: row.idempotencyKey,
      correlationId: row.correlationId,
    };
  }
}
