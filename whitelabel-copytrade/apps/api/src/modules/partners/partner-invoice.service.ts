import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PartnerProfileService } from './partner-profile.service';
import { PartnerCommissionLedgerService } from './partner-commission-ledger.service';
import { PartnerSettlementService } from './partner-settlement.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Provides partner-facing invoice/revenue statements from persisted billing/finance/commission records
 * Does not create a second invoice authority - references authoritative billing truth only
 * Never mutates invoice directly - derivative statement layer
 */
export interface PartnerInvoiceStatement {
  id: string;
  partnerId: string;
  settlementId?: string | null;
  periodStart: string;
  periodEnd: string;
  currency: string;
  grossRevenue: string;
  discount: string;
  netEligibleRevenue: string;
  commissionAccrued: string;
  commissionReversed: string;
  commissionPayable: string;
  commissionCount: number;
  invoiceReferences: string[];
  paymentReferences: string[];
  subscriptionReferences: string[];
  generatedAt: string;
  calculationVersion: string;
  policyVersion: string;
  agreementVersion: string;
  isImmutable: boolean;
}

@Injectable()
export class PartnerInvoiceService {
  private readonly logger = new Logger(PartnerInvoiceService.name);

  constructor(
    private readonly profileService: PartnerProfileService,
    private readonly commissionLedger: PartnerCommissionLedgerService,
    private readonly settlementService: PartnerSettlementService,
    private readonly prisma: PrismaService,
  ) {}

  async generateStatement(params: {
    partnerId: string;
    periodStart: string;
    periodEnd: string;
    currency: string;
    settlementId?: string;
    correlationId: string;
  }): Promise<PartnerInvoiceStatement> {
    if (!params.partnerId || !params.periodStart || !params.periodEnd || !params.currency) {
      throw new BadRequestException('partnerId, periodStart, periodEnd, currency required');
    }

    await this.profileService.getProfile(params.partnerId);

    const periodStart = new Date(params.periodStart);
    const periodEnd = new Date(params.periodEnd);
    if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime()) || periodStart >= periodEnd) {
      throw new BadRequestException('invalid period');
    }

    let settlement: any = null;
    if (params.settlementId) {
      settlement = await this.settlementService.getSettlement(params.settlementId, params.partnerId);
    }

    const commissions = await this.commissionLedger.listCommissions(params.partnerId, { currency: params.currency });
    const inPeriod = commissions.filter(c => {
      const accrued = new Date(c.accruedAt);
      return accrued >= periodStart && accrued <= periodEnd;
    });

    let gross = '0';
    let discount = '0';
    let netEligible = '0';
    let accrued = '0';
    let reversed = '0';
    const invoiceRefs: string[] = [];
    const paymentRefs: string[] = [];
    const subRefs: string[] = [];

    for (const com of inPeriod) {
      gross = this.addDecimal(gross, com.grossRevenue, params.currency);
      discount = this.addDecimal(discount, com.discountAmount, params.currency);
      netEligible = this.addDecimal(netEligible, com.netEligibleRevenue, params.currency);
      if (com.state === 'ACCRUED' || com.state === 'SETTLED' || com.state === 'PAID') {
        accrued = this.addDecimal(accrued, com.commissionAmount, params.currency);
      } else if (com.state === 'REVERSED') {
        reversed = this.addDecimal(reversed, com.commissionAmount, params.currency);
      }
      if (com.sourceInvoiceId) invoiceRefs.push(com.sourceInvoiceId);
      if (com.sourcePaymentId) paymentRefs.push(com.sourcePaymentId);
      if (com.sourceSubscriptionId) subRefs.push(com.sourceSubscriptionId);
    }

    const payable = this.addDecimal(accrued, reversed, params.currency);

    const statement: PartnerInvoiceStatement = {
      id: `pstmt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      partnerId: params.partnerId,
      settlementId: settlement?.id ?? null,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      currency: params.currency.toUpperCase(),
      grossRevenue: gross,
      discount,
      netEligibleRevenue: netEligible,
      commissionAccrued: accrued,
      commissionReversed: reversed,
      commissionPayable: payable,
      commissionCount: inPeriod.length,
      invoiceReferences: [...new Set(invoiceRefs)],
      paymentReferences: [...new Set(paymentRefs)],
      subscriptionReferences: [...new Set(subRefs)],
      generatedAt: new Date().toISOString(),
      calculationVersion: '2026-01',
      policyVersion: settlement?.policyVersion ?? '2026-01',
      agreementVersion: settlement?.agreementVersion ?? 'v1',
      isImmutable: false,
    };

    this.logger.log(`partner invoice statement generated partner=${params.partnerId} payable=${payable} corr=${params.correlationId}`);
    return statement;
  }

  async listStatements(partnerId: string, filters?: { currency?: string }): Promise<PartnerInvoiceStatement[]> {
    // In production, this would query persisted statements
    // For now, generate from settlements
    const settlements = await this.settlementService.listSettlements(partnerId, { currency: filters?.currency });
    return settlements.map(s => ({
      id: `pstmt_${s.id}`,
      partnerId: s.partnerId,
      settlementId: s.id,
      periodStart: s.periodStart,
      periodEnd: s.periodEnd,
      currency: s.currency,
      grossRevenue: s.totalGrossRevenue,
      discount: s.totalDiscount,
      netEligibleRevenue: s.totalNetEligibleRevenue,
      commissionAccrued: s.totalCommissionAccrued,
      commissionReversed: s.totalCommissionReversed,
      commissionPayable: s.totalCommissionPayable,
      commissionCount: s.commissionCount,
      invoiceReferences: [],
      paymentReferences: [],
      subscriptionReferences: [],
      generatedAt: s.createdAt,
      calculationVersion: s.calculationVersion,
      policyVersion: s.policyVersion,
      agreementVersion: s.agreementVersion,
      isImmutable: true,
    }));
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
}
