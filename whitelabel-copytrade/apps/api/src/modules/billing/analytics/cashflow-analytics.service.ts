import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  ReportingPeriod,
  MoneyAmount,
  CashflowSnapshot,
  zeroMoney,
  parseToMinorUnits,
  formatFromMinorUnits,
  getMinorUnitForCurrency,
} from './revenue-analytics.types';

/**
 * Cash collected, refunds, net cash, outstanding amounts, payment-failure impact, period cashflow
 * derived from canonical payment/invoice/ledger data.
 * Does NOT treat invoice as cash unless payment evidence supports it.
 */
@Injectable()
export class CashflowAnalyticsService {
  private readonly logger = new Logger(CashflowAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async calculateCashflow(params: {
    tenantId?: string;
    currency?: string;
    period: ReportingPeriod;
  }): Promise<CashflowSnapshot> {
    const currency = (params.currency || 'USD').toUpperCase();
    const { start, end } = this.parsePeriod(params.period);

    const payments = await this.fetchPayments({ tenantId: params.tenantId, currency, start, end });
    const invoices = await this.fetchInvoices({ tenantId: params.tenantId, currency, start, end });
    const refunds = await this.fetchRefunds({ tenantId: params.tenantId, currency, start, end });
    const dunningCases = await this.fetchDunningCases({ tenantId: params.tenantId, start, end });
    const feeSettlements = await this.fetchFeeSettlements({ tenantId: params.tenantId, currency, start, end });

    let collectedMinor = 0;
    let successfulMinor = 0;
    let failedMinor = 0;
    let pendingMinor = 0;
    let refundMinor = 0;
    let outstandingMinor = 0;
    let dunningExposureMinor = 0;
    let feePayoutMinor = 0;
    let taxCollectedMinor = 0;
    let grossCashInMinor = 0;
    let grossCashOutMinor = 0;

    let successfulCount = 0;
    let failedCount = 0;
    let pendingCount = 0;

    for (const p of payments) {
      const amountMinor = parseToMinorUnits(p.amount || '0', currency);
      const status = (p.status || '').toUpperCase();

      if (['SUCCEEDED', 'PAID', 'COMPLETED', 'CONFIRMED'].includes(status)) {
        collectedMinor += amountMinor;
        successfulMinor += amountMinor;
        grossCashInMinor += amountMinor;
        successfulCount++;
      } else if (['FAILED', 'CANCELLED', 'EXPIRED'].includes(status)) {
        failedMinor += amountMinor;
        failedCount++;
      } else if (['PENDING', 'CREATED', 'PROCESSING', 'REQUIRES_ACTION'].includes(status)) {
        pendingMinor += amountMinor;
        pendingCount++;
      }
    }

    for (const r of refunds) {
      if (['SUCCEEDED', 'COMPLETED', 'PROCESSED'].includes((r.status || '').toUpperCase())) {
        const amountMinor = parseToMinorUnits(r.amount || '0', currency);
        refundMinor += amountMinor;
        grossCashOutMinor += amountMinor;
      }
    }

    for (const inv of invoices) {
      if (['OPEN', 'OVERDUE', 'PARTIALLY_PAID'].includes((inv.status || '').toUpperCase())) {
        const dueMinor = parseToMinorUnits(inv.amountDue || inv.total || '0', currency);
        outstandingMinor += dueMinor;
      }
      const taxMinor = parseToMinorUnits(inv.taxTotal || '0', currency);
      taxCollectedMinor += taxMinor;
    }

    for (const d of dunningCases) {
      // Dunning exposure: payment amount that is at risk
      try {
        const payment = await (this.prisma as any).payment?.findFirst({ where: { id: d.paymentId } });
        if (payment && payment.currency?.toUpperCase() === currency) {
          dunningExposureMinor += parseToMinorUnits(payment.amount || '0', currency);
        }
      } catch {}
    }

    for (const fs of feeSettlements) {
      if (['PAID', 'FINALIZED'].includes((fs.status || '').toUpperCase())) {
        feePayoutMinor += parseToMinorUnits(fs.finalSettlementAmount || fs.grossFeeAmount || '0', currency);
      }
    }

    const netCashMinor = collectedMinor - refundMinor;

    const minorUnit = getMinorUnitForCurrency(currency);

    return {
      period: params.period,
      currency,
      collectedCash: { amount: formatFromMinorUnits(collectedMinor, currency), currency, minorUnit },
      successfulPaymentAmount: { amount: formatFromMinorUnits(successfulMinor, currency), currency, minorUnit },
      failedPaymentAmount: { amount: formatFromMinorUnits(failedMinor, currency), currency, minorUnit },
      pendingPaymentAmount: { amount: formatFromMinorUnits(pendingMinor, currency), currency, minorUnit },
      refunds: { amount: formatFromMinorUnits(refundMinor, currency), currency, minorUnit },
      netCash: { amount: formatFromMinorUnits(netCashMinor, currency), currency, minorUnit },
      outstandingInvoicesAmount: { amount: formatFromMinorUnits(outstandingMinor, currency), currency, minorUnit },
      dunningExposure: { amount: formatFromMinorUnits(dunningExposureMinor, currency), currency, minorUnit },
      feePayouts: { amount: formatFromMinorUnits(feePayoutMinor, currency), currency, minorUnit },
      taxCollected: { amount: formatFromMinorUnits(taxCollectedMinor, currency), currency, minorUnit },
      grossCashIn: { amount: formatFromMinorUnits(grossCashInMinor, currency), currency, minorUnit },
      grossCashOut: { amount: formatFromMinorUnits(grossCashOutMinor, currency), currency, minorUnit },
      source: {
        paymentCount: payments.length,
        invoiceCount: invoices.length,
        refundCount: refunds.length,
      },
      calculatedAt: new Date().toISOString(),
    };
  }

  async calculateOutstanding(params: { tenantId?: string; currency?: string }): Promise<{
    currency: string;
    outstandingAmount: MoneyAmount;
    overdueAmount: MoneyAmount;
    invoiceCount: number;
    overdueCount: number;
    calculatedAt: string;
  }> {
    const currency = (params.currency || 'USD').toUpperCase();
    try {
      const where: any = {
        currency,
        status: { in: ['OPEN', 'OVERDUE', 'PARTIALLY_PAID'] },
      };
      if (params.tenantId) where.tenantId = params.tenantId;

      const invoices = await (this.prisma as any).invoice?.findMany({ where }) || [];
      let outstandingMinor = 0;
      let overdueMinor = 0;
      let overdueCount = 0;

      for (const inv of invoices) {
        const dueMinor = parseToMinorUnits(inv.amountDue || inv.total || '0', currency);
        outstandingMinor += dueMinor;
        if ((inv.status || '').toUpperCase() === 'OVERDUE') {
          overdueMinor += dueMinor;
          overdueCount++;
        }
      }

      return {
        currency,
        outstandingAmount: { amount: formatFromMinorUnits(outstandingMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) },
        overdueAmount: { amount: formatFromMinorUnits(overdueMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) },
        invoiceCount: invoices.length,
        overdueCount,
        calculatedAt: new Date().toISOString(),
      };
    } catch (e: any) {
      this.logger.warn(`Failed to calculate outstanding: ${e.message}`);
      return {
        currency,
        outstandingAmount: zeroMoney(currency),
        overdueAmount: zeroMoney(currency),
        invoiceCount: 0,
        overdueCount: 0,
        calculatedAt: new Date().toISOString(),
      };
    }
  }

  private parsePeriod(period: ReportingPeriod): { start: Date; end: Date } {
    return { start: new Date(period.startDate), end: new Date(period.endDate) };
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

  private async fetchDunningCases(params: { tenantId?: string; start: Date; end: Date }): Promise<any[]> {
    try {
      const where: any = {
        createdAt: { gte: params.start, lte: params.end },
        status: { in: ['ACTIVE', 'RECOVERED', 'FAILED'] },
      };
      if (params.tenantId) where.tenantId = params.tenantId;
      return await (this.prisma as any).dunningCase?.findMany({ where }) || [];
    } catch {
      return [];
    }
  }

  private async fetchFeeSettlements(params: { tenantId?: string; currency: string; start: Date; end: Date }): Promise<any[]> {
    try {
      const where: any = {
        currency: params.currency,
        createdAt: { gte: params.start, lte: params.end },
      };
      if (params.tenantId) where.tenantId = params.tenantId;
      return await (this.prisma as any).feeSettlement?.findMany({ where }) || [];
    } catch {
      return [];
    }
  }
}
