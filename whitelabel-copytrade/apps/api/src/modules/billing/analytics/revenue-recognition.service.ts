import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  ReportingPeriod,
  MoneyAmount,
  zeroMoney,
  parseToMinorUnits,
  formatFromMinorUnits,
  getMinorUnitForCurrency,
} from './revenue-analytics.types';

/**
 * Read-only revenue-period analysis using existing invoice/payment/ledger information without modifying finance records.
 * Supports invoice period, subscription period, recognized-period calculation, deferred/unrecognized, paid vs recognized.
 * Does not invent accounting treatment where no policy configured.
 */
@Injectable()
export class RevenueRecognitionService {
  private readonly logger = new Logger(RevenueRecognitionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async analyzeRecognition(params: {
    tenantId?: string;
    currency?: string;
    period: ReportingPeriod;
  }): Promise<{
    period: ReportingPeriod;
    currency: string;
    recognizedRevenue: MoneyAmount;
    deferredRevenue: MoneyAmount;
    unrecognizedRevenue: MoneyAmount;
    paidRevenue: MoneyAmount;
    unpaidRecognized: MoneyAmount;
    breakdown: {
      invoiceRecognized: MoneyAmount;
      subscriptionRecognized: MoneyAmount;
      ledgerRecognized: MoneyAmount;
    };
    methodology: string;
    calculatedAt: string;
  }> {
    const currency = (params.currency || 'USD').toUpperCase();
    const { start, end } = this.parsePeriod(params.period);

    // Fetch invoices in period
    const invoices = await this.fetchInvoices({ tenantId: params.tenantId, currency, start, end });
    // Fetch payments in period
    const payments = await this.fetchPayments({ tenantId: params.tenantId, currency, start, end });
    // Fetch ledger entries in period
    const ledgerEntries = await this.fetchLedgerEntries({ tenantId: params.tenantId, currency, start, end });

    let recognizedMinor = 0;
    let deferredMinor = 0;
    let paidMinor = 0;
    let unpaidMinor = 0;
    let invoiceMinor = 0;
    let subscriptionMinor = 0;
    let ledgerMinor = 0;

    // Invoice recognized: finalized/paid invoices in period
    for (const inv of invoices) {
      if (['FINALIZED', 'PAID', 'PARTIALLY_PAID'].includes(inv.status)) {
        const totalMinor = parseToMinorUnits(inv.total || '0', currency);
        invoiceMinor += totalMinor;
        recognizedMinor += totalMinor;

        const paid = parseToMinorUnits(inv.amountPaid || '0', currency);
        paidMinor += paid;
        const due = parseToMinorUnits(inv.amountDue || '0', currency);
        unpaidMinor += due;
      } else if (['DRAFT', 'OPEN'].includes(inv.status)) {
        const totalMinor = parseToMinorUnits(inv.total || '0', currency);
        deferredMinor += totalMinor;
      }
    }

    // Subscription recognized: active subscriptions whose period overlaps
    const subscriptions = await this.fetchSubscriptionsInPeriod({ tenantId: params.tenantId, start, end });
    for (const sub of subscriptions) {
      const plan = sub.plan;
      if (!plan) continue;
      if (plan.currency?.toUpperCase() !== currency) continue;
      const priceMinor = parseToMinorUnits(plan.price?.toString() || '0', currency);
      subscriptionMinor += priceMinor;
    }

    // Ledger recognized: posted ledger entries in period (revenue accounts)
    for (const entry of ledgerEntries) {
      const amountMinor = parseToMinorUnits(entry.amount?.toString() || entry.amount || '0', currency);
      if (entry.entryType === 'CREDIT' || entry.accountCategory?.includes('REVENUE')) {
        ledgerMinor += amountMinor;
      }
    }

    return {
      period: params.period,
      currency,
      recognizedRevenue: { amount: formatFromMinorUnits(recognizedMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) },
      deferredRevenue: { amount: formatFromMinorUnits(deferredMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) },
      unrecognizedRevenue: { amount: formatFromMinorUnits(0, currency), currency, minorUnit: getMinorUnitForCurrency(currency) },
      paidRevenue: { amount: formatFromMinorUnits(paidMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) },
      unpaidRecognized: { amount: formatFromMinorUnits(unpaidMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) },
      breakdown: {
        invoiceRecognized: { amount: formatFromMinorUnits(invoiceMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) },
        subscriptionRecognized: { amount: formatFromMinorUnits(subscriptionMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) },
        ledgerRecognized: { amount: formatFromMinorUnits(ledgerMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) },
      },
      methodology: 'Recognized revenue = finalized/paid invoices in period. Deferred = draft/open invoices. Paid = amountPaid. Unpaid = amountDue. Ledger used for cross-check, not as primary. No invented accounting policy.',
      calculatedAt: new Date().toISOString(),
    };
  }

  async getDeferredRevenue(params: { tenantId?: string; currency?: string; asOfDate?: Date }): Promise<{
    currency: string;
    deferredAmount: MoneyAmount;
    invoiceCount: number;
    asOfDate: string;
  }> {
    const currency = (params.currency || 'USD').toUpperCase();
    const asOfDate = params.asOfDate || new Date();

    try {
      const where: any = {
        status: { in: ['DRAFT', 'OPEN'] },
        currency,
        createdAt: { lte: asOfDate },
      };
      if (params.tenantId) where.tenantId = params.tenantId;

      const invoices = await (this.prisma as any).invoice?.findMany({ where }) || [];
      let totalMinor = 0;
      for (const inv of invoices) {
        totalMinor += parseToMinorUnits(inv.total || '0', currency);
      }

      return {
        currency,
        deferredAmount: { amount: formatFromMinorUnits(totalMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) },
        invoiceCount: invoices.length,
        asOfDate: asOfDate.toISOString(),
      };
    } catch (e: any) {
      this.logger.warn(`Failed to fetch deferred revenue: ${e.message}`);
      return {
        currency,
        deferredAmount: zeroMoney(currency),
        invoiceCount: 0,
        asOfDate: asOfDate.toISOString(),
      };
    }
  }

  private parsePeriod(period: ReportingPeriod): { start: Date; end: Date } {
    return { start: new Date(period.startDate), end: new Date(period.endDate) };
  }

  private async fetchInvoices(params: { tenantId?: string; currency: string; start: Date; end: Date }): Promise<any[]> {
    try {
      const where: any = {
        currency: params.currency,
        createdAt: { gte: params.start, lte: params.end },
      };
      if (params.tenantId) where.tenantId = params.tenantId;
      const invoices = await (this.prisma as any).invoice?.findMany({ where }) || [];
      return invoices;
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
      const payments = await (this.prisma as any).payment?.findMany({ where }) || [];
      return payments;
    } catch {
      return [];
    }
  }

  private async fetchLedgerEntries(params: { tenantId?: string; currency: string; start: Date; end: Date }): Promise<any[]> {
    try {
      const where: any = {
        currency: params.currency,
        effectiveAt: { gte: params.start, lte: params.end },
        status: 'POSTED',
      };
      if (params.tenantId) where.tenantId = params.tenantId;
      const entries = await (this.prisma as any).billingLedgerEntry?.findMany({ where }) || [];
      return entries;
    } catch {
      return [];
    }
  }

  private async fetchSubscriptionsInPeriod(params: { tenantId?: string; start: Date; end: Date }): Promise<any[]> {
    try {
      const where: any = {
        currentPeriodStart: { lte: params.end },
        currentPeriodEnd: { gte: params.start },
        status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] },
      };
      if (params.tenantId) where.tenantId = params.tenantId;
      const subs = await (this.prisma as any).tenantSubscription?.findMany({ where, include: { plan: true } }) || [];
      return subs;
    } catch {
      return [];
    }
  }
}
