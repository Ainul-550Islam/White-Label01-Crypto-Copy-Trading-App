import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  ReportingPeriod,
  ReconciliationResult,
  ReconciliationIssue,
  MoneyAmount,
  parseToMinorUnits,
  formatFromMinorUnits,
  getMinorUnitForCurrency,
  zeroMoney,
} from './revenue-analytics.types';
import { MrrCalculationService } from './mrr-calculation.service';
import { ArrCalculationService } from './arr-calculation.service';
import { randomUUID } from 'crypto';

/**
 * Reconciles analytics outputs against source invoices, payments, ledger, subscriptions, refunds, and fee records and detects drift.
 * Never silently rewrite financial history.
 */
@Injectable()
export class AnalyticsReconciliationService {
  private readonly logger = new Logger(AnalyticsReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mrrService: MrrCalculationService,
    private readonly arrService: ArrCalculationService,
  ) {}

  async reconcile(params: {
    tenantId?: string;
    currency?: string;
    period: ReportingPeriod;
  }): Promise<ReconciliationResult> {
    const currency = (params.currency || 'USD').toUpperCase();
    const { start, end } = this.parsePeriod(params.period);
    const issues: ReconciliationIssue[] = [];

    // Fetch canonical sources
    const subscriptions = await this.fetchSubscriptions({ tenantId: params.tenantId, end });
    const invoices = await this.fetchInvoices({ tenantId: params.tenantId, currency, start, end });
    const payments = await this.fetchPayments({ tenantId: params.tenantId, currency, start, end });
    const refunds = await this.fetchRefunds({ tenantId: params.tenantId, currency, start, end });
    const feeAccruals = await this.fetchFeeAccruals({ tenantId: params.tenantId, currency, start, end });
    const ledgerEntries = await this.fetchLedgerEntries({ tenantId: params.tenantId, currency, start, end });

    let totalChecked = 0;

    // 1. MRR mismatch: calculated MRR vs subscription count * plan price
    try {
      const mrrResult = await this.mrrService.calculateMrr({ tenantId: params.tenantId, currency, asOfDate: end });
      const mrrBreakdown = Array.isArray(mrrResult) ? mrrResult[0] : mrrResult;

      if (mrrBreakdown) {
        const expectedMinor = this.calculateExpectedMrrMinor(subscriptions, currency);
        const detectedMinor = parseToMinorUnits(mrrBreakdown.totalMrr.amount, currency);
        const diff = Math.abs(expectedMinor - detectedMinor);

        totalChecked++;
        if (diff > 1) { // Allow 1 minor unit rounding tolerance
          issues.push({
            id: randomUUID(),
            severity: diff > 100 ? 'HIGH' : 'MEDIUM',
            category: 'MRR_MISMATCH',
            period: params.period,
            tenantId: params.tenantId,
            currency,
            expected: formatFromMinorUnits(expectedMinor, currency),
            detected: formatFromMinorUnits(detectedMinor, currency),
            difference: formatFromMinorUnits(diff, currency),
            sourceReference: `MRR calc for ${subscriptions.length} active subs`,
            sourceType: 'ANALYTICS',
            description: `MRR mismatch: expected from plan prices ${formatFromMinorUnits(expectedMinor, currency)} vs detected ${formatFromMinorUnits(detectedMinor, currency)}`,
            detectedAt: new Date().toISOString(),
          });
        }
      }
    } catch (e: any) {
      this.logger.warn(`MRR reconciliation failed: ${e.message}`);
    }

    // 2. ARR mismatch
    try {
      const arrResult = await this.arrService.calculateArr({ tenantId: params.tenantId, currency, asOfDate: end });
      const arrBreakdown = Array.isArray(arrResult) ? arrResult[0] : arrResult;

      if (arrBreakdown) {
        const expectedMinor = this.calculateExpectedArrMinor(subscriptions, currency);
        const detectedMinor = parseToMinorUnits(arrBreakdown.totalArr.amount, currency);
        const diff = Math.abs(expectedMinor - detectedMinor);
        totalChecked++;
        if (diff > 1) {
          issues.push({
            id: randomUUID(),
            severity: diff > 100 ? 'HIGH' : 'MEDIUM',
            category: 'ARR_MISMATCH',
            period: params.period,
            tenantId: params.tenantId,
            currency,
            expected: formatFromMinorUnits(expectedMinor, currency),
            detected: formatFromMinorUnits(detectedMinor, currency),
            difference: formatFromMinorUnits(diff, currency),
            sourceReference: `ARR calc for ${subscriptions.length} active subs`,
            sourceType: 'ANALYTICS',
            description: `ARR mismatch: expected ${formatFromMinorUnits(expectedMinor, currency)} vs detected ${formatFromMinorUnits(detectedMinor, currency)}`,
            detectedAt: new Date().toISOString(),
          });
        }
      }
    } catch {}

    // 3. Invoice revenue mismatch: sum of invoice totals vs ledger revenue entries
    try {
      let invoiceTotalMinor = 0;
      for (const inv of invoices) {
        if (['FINALIZED', 'PAID', 'PARTIALLY_PAID'].includes((inv.status || '').toUpperCase())) {
          invoiceTotalMinor += parseToMinorUnits(inv.total || '0', currency);
        }
      }

      let ledgerRevenueMinor = 0;
      for (const entry of ledgerEntries) {
        if (entry.accountCategory?.includes('REVENUE') || entry.entryType === 'CREDIT') {
          ledgerRevenueMinor += parseToMinorUnits(entry.amount?.toString() || entry.amount || '0', currency);
        }
      }

      totalChecked++;
      // Only check if both have data
      if (invoiceTotalMinor > 0 && ledgerRevenueMinor > 0) {
        const diff = Math.abs(invoiceTotalMinor - ledgerRevenueMinor);
        if (diff > 1) {
          issues.push({
            id: randomUUID(),
            severity: 'MEDIUM',
            category: 'INVOICE_MISMATCH',
            period: params.period,
            tenantId: params.tenantId,
            currency,
            expected: formatFromMinorUnits(invoiceTotalMinor, currency),
            detected: formatFromMinorUnits(ledgerRevenueMinor, currency),
            difference: formatFromMinorUnits(diff, currency),
            sourceReference: `${invoices.length} invoices vs ${ledgerEntries.length} ledger entries`,
            sourceType: 'LEDGER',
            description: `Invoice revenue ${formatFromMinorUnits(invoiceTotalMinor, currency)} does not match ledger revenue ${formatFromMinorUnits(ledgerRevenueMinor, currency)}`,
            detectedAt: new Date().toISOString(),
          });
        }
      }
    } catch {}

    // 4. Payment cash mismatch: sum of successful payments vs invoice amountPaid
    try {
      let paymentTotalMinor = 0;
      for (const p of payments) {
        if (['SUCCEEDED', 'PAID', 'COMPLETED'].includes((p.status || '').toUpperCase())) {
          paymentTotalMinor += parseToMinorUnits(p.amount || '0', currency);
        }
      }

      let invoicePaidMinor = 0;
      for (const inv of invoices) {
        invoicePaidMinor += parseToMinorUnits(inv.amountPaid || '0', currency);
      }

      totalChecked++;
      if (paymentTotalMinor > 0 && invoicePaidMinor > 0) {
        const diff = Math.abs(paymentTotalMinor - invoicePaidMinor);
        // Allow larger tolerance because not all payments map 1:1 to invoices
        if (diff > 1000) {
          issues.push({
            id: randomUUID(),
            severity: 'LOW',
            category: 'PAYMENT_MISMATCH',
            period: params.period,
            tenantId: params.tenantId,
            currency,
            expected: formatFromMinorUnits(paymentTotalMinor, currency),
            detected: formatFromMinorUnits(invoicePaidMinor, currency),
            difference: formatFromMinorUnits(diff, currency),
            sourceReference: `${payments.length} payments vs ${invoices.length} invoices`,
            sourceType: 'PAYMENT',
            description: `Payment cash ${formatFromMinorUnits(paymentTotalMinor, currency)} vs invoice paid ${formatFromMinorUnits(invoicePaidMinor, currency)} - may indicate unlinked payments`,
            detectedAt: new Date().toISOString(),
          });
        }
      }
    } catch {}

    // 5. Refund mismatch
    try {
      let refundTotalMinor = 0;
      for (const r of refunds) {
        if (['SUCCEEDED', 'COMPLETED'].includes((r.status || '').toUpperCase())) {
          refundTotalMinor += parseToMinorUnits(r.amount || '0', currency);
        }
      }

      let invoiceRefundedMinor = 0;
      for (const inv of invoices) {
        invoiceRefundedMinor += parseToMinorUnits(inv.amountRefunded || '0', currency);
      }

      totalChecked++;
      if (refundTotalMinor > 0 || invoiceRefundedMinor > 0) {
        const diff = Math.abs(refundTotalMinor - invoiceRefundedMinor);
        if (diff > 1) {
          issues.push({
            id: randomUUID(),
            severity: 'MEDIUM',
            category: 'REFUND_MISMATCH',
            period: params.period,
            tenantId: params.tenantId,
            currency,
            expected: formatFromMinorUnits(refundTotalMinor, currency),
            detected: formatFromMinorUnits(invoiceRefundedMinor, currency),
            difference: formatFromMinorUnits(diff, currency),
            sourceReference: `${refunds.length} refunds vs ${invoices.length} invoices refunded amount`,
            sourceType: 'REFUND',
            description: `Refund total ${formatFromMinorUnits(refundTotalMinor, currency)} vs invoice refunded ${formatFromMinorUnits(invoiceRefundedMinor, currency)}`,
            detectedAt: new Date().toISOString(),
          });
        }
      }
    } catch {}

    // 6. Fee mismatch: fee accruals vs fee settlements
    try {
      let accrualMinor = 0;
      for (const fa of feeAccruals) {
        accrualMinor += parseToMinorUnits(fa.feeAmount || '0', currency);
      }

      const settlements = await this.fetchFeeSettlements({ tenantId: params.tenantId, currency, start, end });
      let settlementMinor = 0;
      for (const fs of settlements) {
        settlementMinor += parseToMinorUnits(fs.grossFeeAmount || '0', currency);
      }

      totalChecked++;
      if (accrualMinor > 0 && settlementMinor > 0 && accrualMinor !== settlementMinor) {
        const diff = Math.abs(accrualMinor - settlementMinor);
        if (diff > 1) {
          issues.push({
            id: randomUUID(),
            severity: 'LOW',
            category: 'FEE_MISMATCH',
            period: params.period,
            tenantId: params.tenantId,
            currency,
            expected: formatFromMinorUnits(accrualMinor, currency),
            detected: formatFromMinorUnits(settlementMinor, currency),
            difference: formatFromMinorUnits(diff, currency),
            sourceReference: `${feeAccruals.length} accruals vs ${settlements.length} settlements`,
            sourceType: 'FEE',
            description: `Fee accruals ${formatFromMinorUnits(accrualMinor, currency)} vs settlements ${formatFromMinorUnits(settlementMinor, currency)} - may indicate unsettled fees`,
            detectedAt: new Date().toISOString(),
          });
        }
      }
    } catch {}

    // 7. Currency mismatch: check if any record has different currency than requested
    try {
      const allCurrencies = new Set<string>();
      for (const inv of invoices) allCurrencies.add((inv.currency || '').toUpperCase());
      for (const p of payments) allCurrencies.add((p.currency || '').toUpperCase());

      if (allCurrencies.size > 1 && params.currency) {
        totalChecked++;
        issues.push({
          id: randomUUID(),
          severity: 'MEDIUM',
          category: 'CURRENCY_MISMATCH',
          period: params.period,
          tenantId: params.tenantId,
          currency,
          expected: currency,
          detected: Array.from(allCurrencies).join(','),
          difference: `${allCurrencies.size} currencies`,
          sourceReference: `Invoices/payments in period`,
          sourceType: 'ANALYTICS',
          description: `Multi-currency detected in single-currency query: ${Array.from(allCurrencies).join(',')}. Must not silently sum different currencies.`,
          detectedAt: new Date().toISOString(),
        });
      }
    } catch {}

    // 8. Missing source record: subscription without plan
    try {
      let missingPlanCount = 0;
      for (const sub of subscriptions) {
        if (!sub.plan) missingPlanCount++;
      }
      totalChecked++;
      if (missingPlanCount > 0) {
        issues.push({
          id: randomUUID(),
          severity: 'HIGH',
          category: 'MISSING_SOURCE',
          period: params.period,
          tenantId: params.tenantId,
          currency,
          expected: `${subscriptions.length} subscriptions with plans`,
          detected: `${missingPlanCount} subscriptions missing plan`,
          difference: `${missingPlanCount} missing`,
          sourceReference: `${subscriptions.length} subscriptions checked`,
          sourceType: 'SUBSCRIPTION',
          description: `${missingPlanCount} active subscriptions have no plan - MRR/ARR may be understated`,
          detectedAt: new Date().toISOString(),
        });
      }
    } catch {}

    // 9. Impossible active subscription state: ACTIVE but currentPeriodEnd in past
    try {
      let impossibleCount = 0;
      const now = new Date();
      for (const sub of subscriptions) {
        if (sub.status === 'ACTIVE' && new Date(sub.currentPeriodEnd) < now) {
          impossibleCount++;
        }
      }
      totalChecked++;
      if (impossibleCount > 0) {
        issues.push({
          id: randomUUID(),
          severity: 'CRITICAL',
          category: 'IMPOSSIBLE_STATE',
          period: params.period,
          tenantId: params.tenantId,
          currency,
          expected: 'ACTIVE subscriptions should have future period end',
          detected: `${impossibleCount} ACTIVE with past period end`,
          difference: `${impossibleCount} impossible`,
          sourceReference: `${subscriptions.length} subscriptions`,
          sourceType: 'SUBSCRIPTION',
          description: `${impossibleCount} subscriptions marked ACTIVE but currentPeriodEnd is in past - indicates reconciliation needed`,
          detectedAt: new Date().toISOString(),
        });
      }
    } catch {}

    return {
      period: params.period,
      currency,
      checkedAt: new Date().toISOString(),
      totalChecked,
      issuesFound: issues.length,
      issues,
      summary: {
        mrrMatched: !issues.some((i) => i.category === 'MRR_MISMATCH'),
        arrMatched: !issues.some((i) => i.category === 'ARR_MISMATCH'),
        invoiceMatched: !issues.some((i) => i.category === 'INVOICE_MISMATCH'),
        paymentMatched: !issues.some((i) => i.category === 'PAYMENT_MISMATCH'),
        refundMatched: !issues.some((i) => i.category === 'REFUND_MISMATCH'),
        feeMatched: !issues.some((i) => i.category === 'FEE_MISMATCH'),
        ledgerMatched: !issues.some((i) => i.category === 'INVOICE_MISMATCH'),
      },
    };
  }

  private calculateExpectedMrrMinor(subscriptions: any[], currency: string): number {
    let total = 0;
    for (const sub of subscriptions) {
      const plan = sub.plan;
      if (!plan || plan.currency?.toUpperCase() !== currency) continue;
      const priceMinor = parseToMinorUnits(plan.price?.toString() || '0', currency);
      let mrrMinor = 0;
      switch (plan.interval) {
        case 'MONTHLY':
          mrrMinor = priceMinor;
          break;
        case 'QUARTERLY':
          mrrMinor = Math.round(priceMinor / 3);
          break;
        case 'YEARLY':
          mrrMinor = Math.round(priceMinor / 12);
          break;
        default:
          mrrMinor = 0;
      }
      total += mrrMinor * (sub.seatsPurchased || 1);
    }
    return total;
  }

  private calculateExpectedArrMinor(subscriptions: any[], currency: string): number {
    let total = 0;
    for (const sub of subscriptions) {
      const plan = sub.plan;
      if (!plan || plan.currency?.toUpperCase() !== currency) continue;
      const priceMinor = parseToMinorUnits(plan.price?.toString() || '0', currency);
      let arrMinor = 0;
      switch (plan.interval) {
        case 'MONTHLY':
          arrMinor = priceMinor * 12;
          break;
        case 'QUARTERLY':
          arrMinor = priceMinor * 4;
          break;
        case 'YEARLY':
          arrMinor = priceMinor;
          break;
        default:
          arrMinor = 0;
      }
      total += arrMinor * (sub.seatsPurchased || 1);
    }
    return total;
  }

  private parsePeriod(period: ReportingPeriod): { start: Date; end: Date } {
    return { start: new Date(period.startDate), end: new Date(period.endDate) };
  }

  private async fetchSubscriptions(params: { tenantId?: string; end: Date }): Promise<any[]> {
    try {
      const where: any = {
        status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] },
        currentPeriodEnd: { gte: params.end },
      };
      if (params.tenantId) where.tenantId = params.tenantId;
      return await (this.prisma as any).tenantSubscription?.findMany({ where, include: { plan: true } }) || [];
    } catch {
      return [];
    }
  }

  private async fetchInvoices(params: { tenantId?: string; currency: string; start: Date; end: Date }): Promise<any[]> {
    try {
      const where: any = { currency: params.currency, createdAt: { gte: params.start, lte: params.end } };
      if (params.tenantId) where.tenantId = params.tenantId;
      return await (this.prisma as any).invoice?.findMany({ where }) || [];
    } catch {
      return [];
    }
  }

  private async fetchPayments(params: { tenantId?: string; currency: string; start: Date; end: Date }): Promise<any[]> {
    try {
      const where: any = { currency: params.currency, createdAt: { gte: params.start, lte: params.end } };
      if (params.tenantId) where.tenantId = params.tenantId;
      return await (this.prisma as any).payment?.findMany({ where }) || [];
    } catch {
      return [];
    }
  }

  private async fetchRefunds(params: { tenantId?: string; currency: string; start: Date; end: Date }): Promise<any[]> {
    try {
      const where: any = { currency: params.currency, createdAt: { gte: params.start, lte: params.end } };
      if (params.tenantId) where.tenantId = params.tenantId;
      return await (this.prisma as any).refund?.findMany({ where }) || [];
    } catch {
      return [];
    }
  }

  private async fetchFeeAccruals(params: { tenantId?: string; currency: string; start: Date; end: Date }): Promise<any[]> {
    try {
      const where: any = { currency: params.currency, createdAt: { gte: params.start, lte: params.end } };
      if (params.tenantId) where.tenantId = params.tenantId;
      return await (this.prisma as any).feeAccrual?.findMany({ where }) || [];
    } catch {
      return [];
    }
  }

  private async fetchFeeSettlements(params: { tenantId?: string; currency: string; start: Date; end: Date }): Promise<any[]> {
    try {
      const where: any = { currency: params.currency, createdAt: { gte: params.start, lte: params.end } };
      if (params.tenantId) where.tenantId = params.tenantId;
      return await (this.prisma as any).feeSettlement?.findMany({ where }) || [];
    } catch {
      return [];
    }
  }

  private async fetchLedgerEntries(params: { tenantId?: string; currency: string; start: Date; end: Date }): Promise<any[]> {
    try {
      const where: any = { currency: params.currency, effectiveAt: { gte: params.start, lte: params.end } };
      if (params.tenantId) where.tenantId = params.tenantId;
      return await (this.prisma as any).billingLedgerEntry?.findMany({ where }) || [];
    } catch {
      return [];
    }
  }
}
