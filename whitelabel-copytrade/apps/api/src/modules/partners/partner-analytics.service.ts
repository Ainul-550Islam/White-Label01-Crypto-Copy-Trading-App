import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PartnerProfileService } from './partner-profile.service';
import { PartnerTenantService } from './partner-tenant.service';
import { PartnerCommissionLedgerService } from './partner-commission-ledger.service';
import { PartnerPerformanceService } from './partner-performance.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface TimeSeriesPoint {
  period: string;
  periodStart: string;
  periodEnd: string;
  grossRevenue: string;
  netEligibleRevenue: string;
  commissionAccrued: string;
  commissionReversed: string;
  commissionPayable: string;
  newTenants: number;
  activeTenants: number;
  churnedTenants: number;
  activeSubscriptions: number;
  refunds: number;
  chargebacks: number;
}

export interface PartnerAnalytics {
  partnerId: string;
  granularity: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'LIFETIME';
  currency: string;
  periodStart: string;
  periodEnd: string;
  timeSeries: TimeSeriesPoint[];
  cohortByPlan: Array<{ planCode: string; tenantCount: number; revenue: string; commission: string }>;
  cohortByCampaign: Array<{ campaignId: string; tenantCount: number; revenue: string; commission: string }>;
  generatedAt: string;
  calculationVersion: string;
}

@Injectable()
export class PartnerAnalyticsService {
  private readonly logger = new Logger(PartnerAnalyticsService.name);

  constructor(
    private readonly profileService: PartnerProfileService,
    private readonly tenantService: PartnerTenantService,
    private readonly commissionLedger: PartnerCommissionLedgerService,
    private readonly performanceService: PartnerPerformanceService,
    private readonly prisma: PrismaService,
  ) {}

  async getAnalytics(params: {
    partnerId: string;
    granularity: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'LIFETIME';
    periodStart: string;
    periodEnd: string;
    currency?: string;
    correlationId: string;
  }): Promise<PartnerAnalytics> {
    if (!params.partnerId || !params.periodStart || !params.periodEnd) throw new BadRequestException('partnerId, periodStart, periodEnd required');
    await this.profileService.getProfile(params.partnerId);

    const currency = (params.currency ?? 'USD').toUpperCase();
    const periodStart = new Date(params.periodStart);
    const periodEnd = new Date(params.periodEnd);
    if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime()) || periodStart >= periodEnd) throw new BadRequestException('invalid period');

    // No floating-point financial aggregation, no silent cross-currency summation
    const commissions = await this.commissionLedger.listCommissions(params.partnerId, { currency });
    const relationships = await this.tenantService.listTenantsForPartner(params.partnerId);

    const timeSeries = this.buildTimeSeries({
      granularity: params.granularity,
      periodStart,
      periodEnd,
      commissions,
      relationships,
      currency,
    });

    const cohortByPlan = await this.buildPlanCohort(params.partnerId, commissions, relationships, currency);
    const cohortByCampaign = await this.buildCampaignCohort(params.partnerId, commissions, relationships, currency);

    const analytics: PartnerAnalytics = {
      partnerId: params.partnerId,
      granularity: params.granularity,
      currency,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      timeSeries,
      cohortByPlan,
      cohortByCampaign,
      generatedAt: new Date().toISOString(),
      calculationVersion: '2026-01',
    };

    this.logger.log(`analytics generated partner=${params.partnerId} granularity=${params.granularity} points=${timeSeries.length} corr=${params.correlationId}`);
    return analytics;
  }

  private buildTimeSeries(params: {
    granularity: string;
    periodStart: Date;
    periodEnd: Date;
    commissions: any[];
    relationships: any[];
    currency: string;
  }): TimeSeriesPoint[] {
    const points: TimeSeriesPoint[] = [];
    const intervals = this.generateIntervals(params.granularity as any, params.periodStart, params.periodEnd);

    for (const interval of intervals) {
      const commissionsInInterval = params.commissions.filter(c => {
        const accrued = new Date(c.accruedAt);
        return accrued >= interval.start && accrued <= interval.end && c.currency.toUpperCase() === params.currency;
      });

      let gross = '0';
      let netEligible = '0';
      let accrued = '0';
      let reversed = '0';
      let refunds = 0;
      let chargebacks = 0;

      for (const com of commissionsInInterval) {
        gross = this.addDecimal(gross, com.grossRevenue, params.currency);
        netEligible = this.addDecimal(netEligible, com.netEligibleRevenue, params.currency);
        if (['ACCRUED', 'SETTLED', 'PAID', 'PAYOUT_PENDING'].includes(com.state)) {
          accrued = this.addDecimal(accrued, com.commissionAmount, params.currency);
        } else if (com.state === 'REVERSED') {
          reversed = this.addDecimal(reversed, com.commissionAmount, params.currency);
          if (com.sourceEventType === 'REFUND') refunds++;
          if (com.sourceEventType === 'CHARGEBACK') chargebacks++;
        }
      }

      const payable = this.addDecimal(accrued, reversed, params.currency);

      const newTenants = params.relationships.filter(r => {
        const assigned = new Date(r.assignedAt);
        return assigned >= interval.start && assigned <= interval.end;
      }).length;

      const activeTenants = params.relationships.filter(r => {
        const assigned = new Date(r.assignedAt);
        const terminated = r.terminatedAt ? new Date(r.terminatedAt) : null;
        return assigned <= interval.end && (!terminated || terminated > interval.end) && r.state === 'ACTIVE';
      }).length;

      const churnedTenants = params.relationships.filter(r => {
        if (!r.terminatedAt) return false;
        const terminated = new Date(r.terminatedAt);
        return terminated >= interval.start && terminated <= interval.end;
      }).length;

      points.push({
        period: interval.label,
        periodStart: interval.start.toISOString(),
        periodEnd: interval.end.toISOString(),
        grossRevenue: gross,
        netEligibleRevenue: netEligible,
        commissionAccrued: accrued,
        commissionReversed: reversed,
        commissionPayable: payable,
        newTenants,
        activeTenants,
        churnedTenants,
        activeSubscriptions: activeTenants, // simplified
        refunds,
        chargebacks,
      });
    }

    return points;
  }

  private async buildPlanCohort(partnerId: string, commissions: any[], relationships: any[], currency: string) {
    const map = new Map<string, { tenantCount: Set<string>; revenue: string; commission: string }>();
    for (const com of commissions) {
      if (com.currency.toUpperCase() !== currency) continue; // no silent cross-currency summation
      // Try to resolve plan from subscription
      const planCode = 'UNKNOWN';
      if (!map.has(planCode)) map.set(planCode, { tenantCount: new Set(), revenue: '0', commission: '0' });
      const entry = map.get(planCode)!;
      entry.tenantCount.add(com.tenantId);
      entry.revenue = this.addDecimal(entry.revenue, com.netEligibleRevenue, currency);
      if (['ACCRUED', 'SETTLED', 'PAID'].includes(com.state)) {
        entry.commission = this.addDecimal(entry.commission, com.commissionAmount, currency);
      }
    }
    return [...map.entries()].map(([planCode, data]) => ({
      planCode,
      tenantCount: data.tenantCount.size,
      revenue: data.revenue,
      commission: data.commission,
    }));
  }

  private async buildCampaignCohort(partnerId: string, commissions: any[], relationships: any[], currency: string) {
    const map = new Map<string, { tenantCount: Set<string>; revenue: string; commission: string }>();
    for (const rel of relationships) {
      const campaignId = rel.campaignId ?? 'DIRECT';
      if (!map.has(campaignId)) map.set(campaignId, { tenantCount: new Set(), revenue: '0', commission: '0' });
      map.get(campaignId)!.tenantCount.add(rel.tenantId);
    }
    for (const com of commissions) {
      if (com.currency.toUpperCase() !== currency) continue;
      // Find relationship for tenant to get campaign
      const rel = relationships.find(r => r.tenantId === com.tenantId);
      const campaignId = rel?.campaignId ?? 'DIRECT';
      if (!map.has(campaignId)) map.set(campaignId, { tenantCount: new Set(), revenue: '0', commission: '0' });
      const entry = map.get(campaignId)!;
      entry.revenue = this.addDecimal(entry.revenue, com.netEligibleRevenue, currency);
      if (['ACCRUED', 'SETTLED', 'PAID'].includes(com.state)) {
        entry.commission = this.addDecimal(entry.commission, com.commissionAmount, currency);
      }
    }
    return [...map.entries()].map(([campaignId, data]) => ({
      campaignId,
      tenantCount: data.tenantCount.size,
      revenue: data.revenue,
      commission: data.commission,
    }));
  }

  private generateIntervals(granularity: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'LIFETIME', start: Date, end: Date): Array<{ start: Date; end: Date; label: string }> {
    const intervals: Array<{ start: Date; end: Date; label: string }> = [];
    if (granularity === 'LIFETIME') {
      intervals.push({ start, end, label: 'LIFETIME' });
      return intervals;
    }

    let current = new Date(start);
    while (current < end) {
      let next: Date;
      let label: string;
      switch (granularity) {
        case 'DAILY':
          next = new Date(current.getTime() + 24 * 3600000);
          label = current.toISOString().slice(0, 10);
          break;
        case 'WEEKLY':
          next = new Date(current.getTime() + 7 * 24 * 3600000);
          label = `W${current.toISOString().slice(0, 10)}`;
          break;
        case 'MONTHLY':
          next = new Date(current.getFullYear(), current.getMonth() + 1, 1);
          label = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
          break;
        case 'QUARTERLY':
          const quarter = Math.floor(current.getMonth() / 3) + 1;
          next = new Date(current.getFullYear(), quarter * 3, 1);
          label = `${current.getFullYear()}-Q${quarter}`;
          break;
        default:
          next = new Date(current.getTime() + 24 * 3600000);
          label = current.toISOString().slice(0, 10);
      }
      if (next > end) next = new Date(end);
      intervals.push({ start: new Date(current), end: new Date(next), label });
      current = next;
    }
    return intervals;
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
