import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  ReportingPeriod,
  BillingHealthMetrics,
  MoneyAmount,
  zeroMoney,
  parseToMinorUnits,
  formatFromMinorUnits,
  getMinorUnitForCurrency,
  calculateRate,
} from './revenue-analytics.types';

/**
 * Billing health metrics: successful payments, failed payments, pending payments, dunning cases, recovery, overdue invoices, refund rate, payment success rate.
 * Does not fabricate missing timestamps.
 */
@Injectable()
export class BillingHealthService {
  private readonly logger = new Logger(BillingHealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async calculateBillingHealth(params: {
    tenantId?: string;
    currency?: string;
    period: ReportingPeriod;
  }): Promise<BillingHealthMetrics> {
    const currency = (params.currency || 'USD').toUpperCase();
    const { start, end } = this.parsePeriod(params.period);

    const payments = await this.fetchPayments({ tenantId: params.tenantId, currency, start, end });
    const invoices = await this.fetchInvoices({ tenantId: params.tenantId, currency, start, end });
    const refunds = await this.fetchRefunds({ tenantId: params.tenantId, currency, start, end });
    const dunningCases = await this.fetchDunningCases({ tenantId: params.tenantId, start, end });
    const checkouts = await this.fetchCheckouts({ tenantId: params.tenantId, start, end });

    let successful = 0;
    let failed = 0;
    let pending = 0;
    let totalProcessingMs = 0;
    let processingCount = 0;

    for (const p of payments) {
      const status = (p.status || '').toUpperCase();
      if (['SUCCEEDED', 'PAID', 'COMPLETED', 'CONFIRMED'].includes(status)) {
        successful++;
        // Average processing duration where timestamps exist
        if (p.createdAt && p.paidAt) {
          const created = new Date(p.createdAt).getTime();
          const paid = new Date(p.paidAt).getTime();
          if (!isNaN(created) && !isNaN(paid) && paid >= created) {
            totalProcessingMs += paid - created;
            processingCount++;
          }
        }
      } else if (['FAILED', 'CANCELLED', 'EXPIRED'].includes(status)) {
        failed++;
      } else {
        pending++;
      }
    }

    const totalPayments = payments.length;
    const paymentSuccessRate = calculateRate(successful, totalPayments);
    const paymentFailureRate = calculateRate(failed, totalPayments);
    const pendingRate = calculateRate(pending, totalPayments);

    let paidInvoices = 0;
    let overdueInvoices = 0;
    let outstandingInvoices = 0;

    for (const inv of invoices) {
      const status = (inv.status || '').toUpperCase();
      if (status === 'PAID') paidInvoices++;
      if (status === 'OVERDUE') overdueInvoices++;
      if (['OPEN', 'OVERDUE', 'PARTIALLY_PAID'].includes(status)) outstandingInvoices++;
    }

    const totalInvoices = invoices.length;
    const overdueRate = calculateRate(overdueInvoices, totalInvoices);

    const totalRefunds = refunds.length;
    const refundRate = calculateRate(totalRefunds, totalPayments);

    let refundMinor = 0;
    for (const r of refunds) {
      if (['SUCCEEDED', 'COMPLETED'].includes((r.status || '').toUpperCase())) {
        refundMinor += parseToMinorUnits(r.amount || '0', currency);
      }
    }

    let openDunning = 0;
    let recoveredDunning = 0;
    let failedDunning = 0;

    for (const d of dunningCases) {
      const status = (d.status || '').toUpperCase();
      if (status === 'ACTIVE') openDunning++;
      if (status === 'RECOVERED') recoveredDunning++;
      if (status === 'FAILED') failedDunning++;
    }

    const totalDunningResolved = recoveredDunning + failedDunning;
    const dunningRecoveryRate = calculateRate(recoveredDunning, totalDunningResolved);

    // Checkout conversion where source data exists
    let checkoutConversionRate: string | undefined;
    if (checkouts.length > 0) {
      const converted = checkouts.filter((c: any) => ['SUCCEEDED', 'COMPLETED', 'PAID'].includes((c.status || '').toUpperCase())).length;
      checkoutConversionRate = calculateRate(converted, checkouts.length);
    }

    const avgProcessingMs = processingCount > 0 ? Math.round(totalProcessingMs / processingCount) : undefined;

    return {
      period: params.period,
      currency,
      totalPayments,
      successfulPayments: successful,
      failedPayments: failed,
      pendingPayments: pending,
      paymentSuccessRate,
      paymentFailureRate,
      pendingRate,
      totalInvoices,
      paidInvoices,
      overdueInvoices,
      outstandingInvoices,
      overdueRate,
      totalRefunds,
      refundRate,
      refundAmount: { amount: formatFromMinorUnits(refundMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) },
      openDunningCases: openDunning,
      recoveredDunningCases: recoveredDunning,
      failedDunningCases: failedDunning,
      dunningRecoveryRate,
      averagePaymentProcessingDurationMs: avgProcessingMs,
      checkoutConversionRate,
      calculatedAt: new Date().toISOString(),
    };
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
      };
      if (params.tenantId) where.tenantId = params.tenantId;
      return await (this.prisma as any).dunningCase?.findMany({ where }) || [];
    } catch {
      return [];
    }
  }

  private async fetchCheckouts(params: { tenantId?: string; start: Date; end: Date }): Promise<any[]> {
    try {
      // Checkout data may be stored in payments with providerCheckoutId or separate table
      const where: any = {
        createdAt: { gte: params.start, lte: params.end },
      };
      if (params.tenantId) where.tenantId = params.tenantId;
      // Try to find checkout-related payments
      const payments = await (this.prisma as any).payment?.findMany({ where }) || [];
      return payments.filter((p: any) => p.providerCheckoutId || p.providerSessionId);
    } catch {
      return [];
    }
  }
}
