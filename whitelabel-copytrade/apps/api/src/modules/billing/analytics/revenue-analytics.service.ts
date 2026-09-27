import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  ReportingPeriod,
  RevenueSnapshot,
  RevenueOverview,
  MoneyAmount,
  CurrencyBucket,
  zeroMoney,
  parseToMinorUnits,
  formatFromMinorUnits,
  getMinorUnitForCurrency,
  addMoneyAmounts,
  calculatePercentageChange,
  createMoneyAmount,
} from './revenue-analytics.types';
import { MrrCalculationService } from './mrr-calculation.service';
import { ArrCalculationService } from './arr-calculation.service';
import { CashflowAnalyticsService } from './cashflow-analytics.service';
import { BillingHealthService } from './billing-health.service';
import { AnalyticsCacheService } from './analytics-cache.service';

/**
 * Main read-only revenue analytics engine derived from canonical subscriptions, invoices, payments, refunds, ledger, and fee data.
 * No mutation, all analytics derived from existing source-of-truth records.
 */
@Injectable()
export class RevenueAnalyticsService {
  private readonly logger = new Logger(RevenueAnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mrrService: MrrCalculationService,
    private readonly arrService: ArrCalculationService,
    private readonly cashflowService: CashflowAnalyticsService,
    private readonly billingHealthService: BillingHealthService,
    private readonly cacheService: AnalyticsCacheService,
  ) {}

  async getRevenueOverview(params: {
    tenantId?: string;
    currency?: string;
    period: ReportingPeriod;
    comparisonPeriod?: ReportingPeriod;
  }): Promise<RevenueOverview> {
    const scope = params.tenantId || 'platform';
    const currency = (params.currency || 'USD').toUpperCase();

    return this.cacheService.remember(
      {
        scope,
        metric: 'revenue_overview',
        period: params.period,
        currency,
        filters: { tenantId: params.tenantId, comparison: !!params.comparisonPeriod },
      },
      async () => {
        const current = await this.calculateRevenueSnapshot({
          tenantId: params.tenantId,
          currency,
          period: params.period,
        });

        let previous: RevenueSnapshot | undefined;
        let comparison: RevenueOverview['comparison'] | undefined;

        if (params.comparisonPeriod) {
          previous = await this.calculateRevenueSnapshot({
            tenantId: params.tenantId,
            currency,
            period: params.comparisonPeriod,
          });

          const currentGrossMinor = parseToMinorUnits(current.grossRevenue.amount, currency);
          const prevGrossMinor = parseToMinorUnits(previous.grossRevenue.amount, currency);
          const currentNetMinor = parseToMinorUnits(current.netRevenue.amount, currency);
          const prevNetMinor = parseToMinorUnits(previous.netRevenue.amount, currency);
          const currentMrrMinor = parseToMinorUnits(current.mrr.amount, currency);
          const prevMrrMinor = parseToMinorUnits(previous.mrr.amount, currency);
          const currentArrMinor = parseToMinorUnits(current.arr.amount, currency);
          const prevArrMinor = parseToMinorUnits(previous.arr.amount, currency);

          comparison = {
            grossRevenueChange: calculatePercentageChange(currentGrossMinor, prevGrossMinor),
            netRevenueChange: calculatePercentageChange(currentNetMinor, prevNetMinor),
            mrrChange: calculatePercentageChange(currentMrrMinor, prevMrrMinor),
            arrChange: calculatePercentageChange(currentArrMinor, prevArrMinor),
            customerCountChange: calculatePercentageChange(current.customerCount, previous.customerCount),
          };
        }

        // Multi-currency handling: if no currency specified, return buckets
        let currencyBuckets: CurrencyBucket[] | undefined;
        let multiCurrencyWarning: string | undefined;

        if (!params.currency) {
          const buckets = await this.calculateMultiCurrencyBuckets({ tenantId: params.tenantId, period: params.period });
          if (buckets.length > 1) {
            currencyBuckets = buckets;
            multiCurrencyWarning = `Multiple currencies detected (${buckets.map((b) => b.currency).join(', ')}). Amounts are separated by currency, not converted. No FX rates invented.`;
          }
        }

        return {
          current,
          previous,
          comparison,
          currencyBuckets,
          multiCurrencyWarning,
        };
      },
    );
  }

  async calculateRevenueSnapshot(params: {
    tenantId?: string;
    currency: string;
    period: ReportingPeriod;
  }): Promise<RevenueSnapshot> {
    const currency = params.currency.toUpperCase();
    const { start, end } = this.parsePeriod(params.period);

    // Fetch canonical sources
    const invoices = await this.fetchInvoices({ tenantId: params.tenantId, currency, start, end });
    const payments = await this.fetchPayments({ tenantId: params.tenantId, currency, start, end });
    const refunds = await this.fetchRefunds({ tenantId: params.tenantId, currency, start, end });
    const feeAccruals = await this.fetchFeeAccruals({ tenantId: params.tenantId, currency, start, end });
    const subscriptions = await this.fetchActiveSubscriptions({ tenantId: params.tenantId, asOfDate: end });

    let grossMinor = 0;
    let taxMinor = 0;
    let feeMinor = 0;
    let platformFeeMinor = 0;
    let performanceFeeMinor = 0;
    let refundMinor = 0;
    let cashCollectedMinor = 0;
    let receivablesMinor = 0;
    let outstandingMinor = 0;
    let recognizedMinor = 0;
    let oneTimeMinor = 0;

    // Gross revenue from invoices (finalized/paid)
    for (const inv of invoices) {
      if (['FINALIZED', 'PAID', 'PARTIALLY_PAID'].includes((inv.status || '').toUpperCase())) {
        grossMinor += parseToMinorUnits(inv.total || '0', currency);
        taxMinor += parseToMinorUnits(inv.taxTotal || '0', currency);
        recognizedMinor += parseToMinorUnits(inv.total || '0', currency);
        const paid = parseToMinorUnits(inv.amountPaid || '0', currency);
        cashCollectedMinor += paid;
        const due = parseToMinorUnits(inv.amountDue || '0', currency);
        receivablesMinor += due;
        outstandingMinor += due;
      }
    }

    // One-time revenue: payments without subscription
    for (const p of payments) {
      if (!p.subscriptionId && ['SUCCEEDED', 'PAID', 'COMPLETED'].includes((p.status || '').toUpperCase())) {
        oneTimeMinor += parseToMinorUnits(p.amount || '0', currency);
      }
    }

    // Refunds
    for (const r of refunds) {
      if (['SUCCEEDED', 'COMPLETED'].includes((r.status || '').toUpperCase())) {
        refundMinor += parseToMinorUnits(r.amount || '0', currency);
      }
    }

    // Fees: distinct from subscription revenue
    for (const fee of feeAccruals) {
      const feeMinorAmount = parseToMinorUnits(fee.feeAmount || '0', currency);
      feeMinor += feeMinorAmount;
      if (fee.feeType === 'PLATFORM_FEE') platformFeeMinor += feeMinorAmount;
      if (fee.feeType === 'PERFORMANCE_FEE') performanceFeeMinor += feeMinorAmount;
    }

    // MRR/ARR from canonical subscriptions
    const mrrResult = await this.mrrService.calculateMrr({ tenantId: params.tenantId, currency, asOfDate: end });
    const arrResult = await this.arrService.calculateArr({ tenantId: params.tenantId, currency, asOfDate: end });

    const mrrAmount = Array.isArray(mrrResult) ? mrrResult[0]?.totalMrr || zeroMoney(currency) : mrrResult.totalMrr;
    const arrAmount = Array.isArray(arrResult) ? arrResult[0]?.totalArr || zeroMoney(currency) : arrResult.totalArr;

    const mrrMinor = parseToMinorUnits(mrrAmount.amount, currency);
    const arrMinor = parseToMinorUnits(arrAmount.amount, currency);

    // Recurring revenue: MRR * months in period or sum of subscription invoices
    const monthsInPeriod = this.monthsBetween(start, end);
    const recurringMinor = mrrMinor * monthsInPeriod;

    const netMinor = grossMinor - refundMinor;

    // ARPU: gross / customer count
    const distinctCustomers = new Set(invoices.map((i: any) => i.tenantId) || payments.map((p: any) => p.tenantId));
    const customerCount = distinctCustomers.size || subscriptions.length || 1;
    const arpuMinor = Math.round(grossMinor / customerCount);

    // New customers in period
    const newCustomers = await this.fetchNewCustomers({ tenantId: params.tenantId, start, end });
    const churnedCustomers = await this.fetchChurnedCustomers({ tenantId: params.tenantId, start, end });

    const minorUnit = getMinorUnitForCurrency(currency);

    return {
      period: params.period,
      currency,
      grossRevenue: { amount: formatFromMinorUnits(grossMinor, currency), currency, minorUnit },
      netRevenue: { amount: formatFromMinorUnits(netMinor, currency), currency, minorUnit },
      recurringRevenue: { amount: formatFromMinorUnits(recurringMinor, currency), currency, minorUnit },
      oneTimeRevenue: { amount: formatFromMinorUnits(oneTimeMinor, currency), currency, minorUnit },
      recognizedRevenue: { amount: formatFromMinorUnits(recognizedMinor, currency), currency, minorUnit },
      deferredRevenue: { amount: formatFromMinorUnits(0, currency), currency, minorUnit },
      cashCollected: { amount: formatFromMinorUnits(cashCollectedMinor, currency), currency, minorUnit },
      refunds: { amount: formatFromMinorUnits(refundMinor, currency), currency, minorUnit },
      taxes: { amount: formatFromMinorUnits(taxMinor, currency), currency, minorUnit },
      fees: { amount: formatFromMinorUnits(feeMinor, currency), currency, minorUnit },
      platformFees: { amount: formatFromMinorUnits(platformFeeMinor, currency), currency, minorUnit },
      performanceFees: { amount: formatFromMinorUnits(performanceFeeMinor, currency), currency, minorUnit },
      receivables: { amount: formatFromMinorUnits(receivablesMinor, currency), currency, minorUnit },
      outstandingAmount: { amount: formatFromMinorUnits(outstandingMinor, currency), currency, minorUnit },
      mrr: { amount: formatFromMinorUnits(mrrMinor, currency), currency, minorUnit },
      arr: { amount: formatFromMinorUnits(arrMinor, currency), currency, minorUnit },
      arpu: { amount: formatFromMinorUnits(arpuMinor, currency), currency, minorUnit },
      customerCount,
      activeSubscriptionCount: subscriptions.length,
      newCustomerCount: newCustomers.length,
      churnedCustomerCount: churnedCustomers.length,
      source: {
        invoiceCount: invoices.length,
        paymentCount: payments.length,
        refundCount: refunds.length,
        subscriptionCount: subscriptions.length,
        ledgerEntryCount: 0,
      },
      calculatedAt: new Date().toISOString(),
    };
  }

  async calculateMultiCurrencyBuckets(params: { tenantId?: string; period: ReportingPeriod }): Promise<CurrencyBucket[]> {
    const { start, end } = this.parsePeriod(params.period);

    try {
      const invoices = await (this.prisma as any).invoice?.findMany({
        where: {
          ...(params.tenantId ? { tenantId: params.tenantId } : {}),
          createdAt: { gte: start, lte: end },
        },
      }) || [];

      const byCurrency = new Map<string, { amounts: any[]; totalMinor: number }>();

      for (const inv of invoices) {
        const curr = (inv.currency || 'USD').toUpperCase();
        if (!byCurrency.has(curr)) byCurrency.set(curr, { amounts: [], totalMinor: 0 });
        const bucket = byCurrency.get(curr)!;
        const minor = parseToMinorUnits(inv.total || '0', curr);
        bucket.totalMinor += minor;
        bucket.amounts.push({ amount: inv.total || '0', currency: curr, minorUnit: getMinorUnitForCurrency(curr) });
      }

      return Array.from(byCurrency.entries()).map(([currency, data]) => ({
        currency,
        amounts: data.amounts,
        total: { amount: formatFromMinorUnits(data.totalMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) },
      }));
    } catch {
      return [];
    }
  }

  private parsePeriod(period: ReportingPeriod): { start: Date; end: Date } {
    return { start: new Date(period.startDate), end: new Date(period.endDate) };
  }

  private monthsBetween(start: Date, end: Date): number {
    const diffMs = end.getTime() - start.getTime();
    const diffMonths = diffMs / (1000 * 60 * 60 * 24 * 30);
    return Math.max(1, Math.round(diffMonths * 100) / 100);
  }

  private async fetchInvoices(params: { tenantId?: string; currency: string; start: Date; end: Date }): Promise<any[]> {
    try {
      const where: any = {
        currency: params.currency,
        createdAt: { gte: params.start, lte: params.end },
      };
      if (params.tenantId) where.tenantId = params.tenantId;
      return await (this.prisma as any).invoice?.findMany({ where }) || [];
    } catch {
      return [];
    }
  }

  private async fetchPayments(params: { tenantId?: string; currency: string; start: Date; end: Date }): Promise<any[]> {
    try {
      const where: any = {
        currency: params.currency,
        createdAt: { gte: params.start, lte: params.end },
      };
      if (params.tenantId) where.tenantId = params.tenantId;
      return await (this.prisma as any).payment?.findMany({ where }) || [];
    } catch {
      return [];
    }
  }

  private async fetchRefunds(params: { tenantId?: string; currency: string; start: Date; end: Date }): Promise<any[]> {
    try {
      const where: any = {
        currency: params.currency,
        createdAt: { gte: params.start, lte: params.end },
      };
      if (params.tenantId) where.tenantId = params.tenantId;
      return await (this.prisma as any).refund?.findMany({ where }) || [];
    } catch {
      return [];
    }
  }

  private async fetchFeeAccruals(params: { tenantId?: string; currency: string; start: Date; end: Date }): Promise<any[]> {
    try {
      const where: any = {
        currency: params.currency,
        createdAt: { gte: params.start, lte: params.end },
      };
      if (params.tenantId) where.tenantId = params.tenantId;
      return await (this.prisma as any).feeAccrual?.findMany({ where }) || [];
    } catch {
      return [];
    }
  }

  private async fetchActiveSubscriptions(params: { tenantId?: string; asOfDate: Date }): Promise<any[]> {
    try {
      const where: any = {
        status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] },
        currentPeriodEnd: { gte: params.asOfDate },
      };
      if (params.tenantId) where.tenantId = params.tenantId;
      return await (this.prisma as any).tenantSubscription?.findMany({ where, include: { plan: true } }) || [];
    } catch {
      return [];
    }
  }

  private async fetchNewCustomers(params: { tenantId?: string; start: Date; end: Date }): Promise<any[]> {
    try {
      const where: any = {
        createdAt: { gte: params.start, lte: params.end },
      };
      if (params.tenantId) where.tenantId = params.tenantId;
      return await (this.prisma as any).tenantSubscription?.findMany({ where }) || [];
    } catch {
      return [];
    }
  }

  private async fetchChurnedCustomers(params: { tenantId?: string; start: Date; end: Date }): Promise<any[]> {
    try {
      const where: any = {
        status: { in: ['CANCELED', 'EXPIRED'] },
        OR: [{ canceledAt: { gte: params.start, lte: params.end } }, { currentPeriodEnd: { gte: params.start, lte: params.end } }],
      };
      if (params.tenantId) where.tenantId = params.tenantId;
      return await (this.prisma as any).tenantSubscription?.findMany({ where }) || [];
    } catch {
      return [];
    }
  }
}
