import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PartnerProfileService } from './partner-profile.service';
import { PartnerTenantService } from './partner-tenant.service';
import { PartnerCommissionLedgerService } from './partner-commission-ledger.service';
import { PartnerSettlementService } from './partner-settlement.service';
import { PartnerPayoutService } from './partner-payout.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface PartnerPerformance {
  partnerId: string;
  periodStart?: string;
  periodEnd?: string;
  referredTenants: number;
  activeTenants: number;
  conversionRate: string;
  mrrAttributed: string;
  grossAttributedRevenue: string;
  netEligibleRevenue: string;
  commissionAccrued: string;
  commissionReversed: string;
  commissionPayable: string;
  commissionPaid: string;
  pendingSettlement: string;
  pendingPayout: string;
  refunds: number;
  chargebacks: number;
  churnRate: string;
  activeSubscriptions: number;
  customerRetentionRate: string;
  generatedAt: string;
  currency: string;
  calculationVersion: string;
}

@Injectable()
export class PartnerPerformanceService {
  private readonly logger = new Logger(PartnerPerformanceService.name);

  constructor(
    private readonly profileService: PartnerProfileService,
    private readonly tenantService: PartnerTenantService,
    private readonly commissionLedger: PartnerCommissionLedgerService,
    private readonly settlementService: PartnerSettlementService,
    private readonly payoutService: PartnerPayoutService,
    private readonly prisma: PrismaService,
  ) {}

  async calculatePerformance(params: {
    partnerId: string;
    periodStart?: string;
    periodEnd?: string;
    currency?: string;
    correlationId: string;
  }): Promise<PartnerPerformance> {
    if (!params.partnerId) throw new BadRequestException('partnerId required');
    await this.profileService.getProfile(params.partnerId);

    const currency = (params.currency ?? 'USD').toUpperCase();
    const periodStart = params.periodStart ? new Date(params.periodStart) : null;
    const periodEnd = params.periodEnd ? new Date(params.periodEnd) : null;

    const relationships = await this.tenantService.listTenantsForPartner(params.partnerId);
    const referredTenants = relationships.length;
    const activeTenants = relationships.filter(r => r.state === 'ACTIVE').length;

    const commissions = await this.commissionLedger.listCommissions(params.partnerId, { currency });
    let filteredCommissions = commissions;
    if (periodStart && periodEnd) {
      filteredCommissions = commissions.filter(c => {
        const accrued = new Date(c.accruedAt);
        return accrued >= periodStart && accrued <= periodEnd;
      });
    }

    let grossAttributed = '0';
    let netEligible = '0';
    let commissionAccrued = '0';
    let commissionReversed = '0';
    let refunds = 0;
    let chargebacks = 0;

    for (const com of filteredCommissions) {
      grossAttributed = this.addDecimal(grossAttributed, com.grossRevenue, currency);
      netEligible = this.addDecimal(netEligible, com.netEligibleRevenue, currency);
      if (com.state === 'ACCRUED' || com.state === 'SETTLED' || com.state === 'PAID' || com.state === 'PAYOUT_PENDING') {
        commissionAccrued = this.addDecimal(commissionAccrued, com.commissionAmount, currency);
      } else if (com.state === 'REVERSED') {
        commissionReversed = this.addDecimal(commissionReversed, com.commissionAmount, currency);
        if (com.sourceEventType === 'REFUND') refunds++;
        if (com.sourceEventType === 'CHARGEBACK') chargebacks++;
      }
    }

    const commissionPayable = this.addDecimal(commissionAccrued, commissionReversed, currency);

    const settlements = await this.settlementService.listSettlements(params.partnerId, { currency });
    let pendingSettlement = '0';
    for (const s of settlements.filter(s => s.state === 'OPEN' || s.state === 'RECONCILED' || s.state === 'VALIDATED')) {
      pendingSettlement = this.addDecimal(pendingSettlement, s.totalCommissionPayable, currency);
    }

    const payouts = await this.payoutService.listPayouts(params.partnerId);
    let commissionPaid = '0';
    let pendingPayout = '0';
    for (const p of payouts) {
      if (p.currency.toUpperCase() !== currency) continue;
      if (p.state === 'COMPLETED') commissionPaid = this.addDecimal(commissionPaid, p.amount, currency);
      else if (['REQUESTED', 'APPROVED', 'SUBMITTED', 'PROCESSING'].includes(p.state)) pendingPayout = this.addDecimal(pendingPayout, p.amount, currency);
    }

    // MRR attributed - from subscriptions
    let mrrAttributed = '0';
    let activeSubscriptions = 0;
    try {
      const tenantIds = relationships.filter(r => r.state === 'ACTIVE').map(r => r.tenantId);
      for (const tenantId of tenantIds) {
        const subs = await (this.prisma as any).tenantSubscription?.findMany?.({ where: { tenantId, status: { in: ['ACTIVE', 'TRIALING'] } }, include: { plan: true } }) ?? [];
        activeSubscriptions += subs.length;
        for (const sub of subs) {
          const planPrice = sub.plan?.price ?? sub.plan?.amount ?? '0';
          // MRR approximation: if yearly, divide by 12 - Decimal-safe
          if (sub.plan?.interval === 'YEARLY') {
            const yearlyMinor = this.toMinorUnits(planPrice.toString(), currency);
            const monthlyMinor = yearlyMinor / BigInt(12);
            mrrAttributed = this.addDecimal(mrrAttributed, this.fromMinorUnits(monthlyMinor, currency), currency);
          } else {
            mrrAttributed = this.addDecimal(mrrAttributed, planPrice.toString(), currency);
          }
        }
      }
    } catch {
      this.logger.debug(`MRR calculation fallback partner=${params.partnerId}`);
    }

    const conversionRate = referredTenants > 0 ? ((activeTenants / referredTenants) * 100).toFixed(2) : '0.00';
    const churnRate = referredTenants > 0 ? (((referredTenants - activeTenants) / referredTenants) * 100).toFixed(2) : '0.00';
    const retentionRate = (100 - parseFloat(churnRate)).toFixed(2);

    const performance: PartnerPerformance = {
      partnerId: params.partnerId,
      periodStart: periodStart?.toISOString(),
      periodEnd: periodEnd?.toISOString(),
      referredTenants,
      activeTenants,
      conversionRate,
      mrrAttributed,
      grossAttributedRevenue: grossAttributed,
      netEligibleRevenue: netEligible,
      commissionAccrued,
      commissionReversed,
      commissionPayable,
      commissionPaid,
      pendingSettlement,
      pendingPayout,
      refunds,
      chargebacks,
      churnRate,
      activeSubscriptions,
      customerRetentionRate: retentionRate,
      generatedAt: new Date().toISOString(),
      currency,
      calculationVersion: '2026-01',
    };

    this.logger.log(`performance calculated partner=${params.partnerId} MRR=${mrrAttributed} payable=${commissionPayable} corr=${params.correlationId}`);
    return performance;
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
