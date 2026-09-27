import { Injectable, Logger } from '@nestjs/common';
import { FeeAccrualRepository } from './fee-accrual.repository';
import { FeeSettlementRepository } from './fee-settlement.repository';
import { PayoutRepository } from './payout.repository';
import { FeeType, FeeAccrualStatus, SettlementState, PayoutState } from './fee.types';
import { PayoutStatus } from './payout.types';
import { parseToMinorUnits, formatFromMinorUnits, getMinorUnitForCurrency } from '../finance/money.types';

/**
 * Tenant/admin analytics for accrued, settled, reversed, paid fees.
 * All analytics derived from canonical fee/ledger data, no duplicate counters.
 */
@Injectable()
export class FeeAnalyticsService {
  private readonly logger = new Logger(FeeAnalyticsService.name);

  constructor(
    private readonly accrualRepository: FeeAccrualRepository,
    private readonly settlementRepository: FeeSettlementRepository,
    private readonly payoutRepository: PayoutRepository,
  ) {}

  async getTenantAnalytics(
    tenantId: string,
    filter?: {
      currency?: string;
      fromDate?: Date;
      toDate?: Date;
      feeType?: FeeType;
      period?: string;
    },
  ): Promise<any> {
    const currency = filter?.currency || 'USD';

    const accruals = await this.accrualRepository.listByTenant(tenantId, {
      currency: filter?.currency,
      feeType: filter?.feeType,
      fromDate: filter?.fromDate,
      toDate: filter?.toDate,
      limit: 1000,
    });

    const settlements = await this.settlementRepository.listByTenant(tenantId, {
      currency: filter?.currency,
      feeType: filter?.feeType as any,
      fromDate: filter?.fromDate,
      toDate: filter?.toDate,
      limit: 1000,
    });

    const payouts = await this.payoutRepository.listByTenant(tenantId, {
      currency: filter?.currency,
      fromDate: filter?.fromDate,
      toDate: filter?.toDate,
      limit: 1000,
    });

    // Calculate totals using minor-unit arithmetic
    let accruedMinor = 0;
    let settledMinor = 0;
    let reversedMinor = 0;
    let platformMinor = 0;
    let performanceMinor = 0;

    const breakdownBySource: Record<string, number> = {};
    const breakdownByCurrency: Record<string, number> = {};
    const breakdownByFeeType: Record<string, number> = {};

    for (const accrual of accruals) {
      try {
        const minor = parseToMinorUnits(accrual.feeAmount, accrual.currency);
        if (accrual.status === FeeAccrualStatus.ACCRUED || accrual.status === FeeAccrualStatus.SETTLED) {
          accruedMinor += minor;
        }
        if (accrual.status === FeeAccrualStatus.SETTLED) {
          settledMinor += minor;
        }
        if (accrual.status === FeeAccrualStatus.REVERSED) {
          reversedMinor += minor;
        }
        if (accrual.feeType === FeeType.PLATFORM_FEE) platformMinor += minor;
        if (accrual.feeType === FeeType.PERFORMANCE_FEE) performanceMinor += minor;

        breakdownBySource[accrual.sourceType] = (breakdownBySource[accrual.sourceType] || 0) + minor;
        breakdownByCurrency[accrual.currency] = (breakdownByCurrency[accrual.currency] || 0) + minor;
        breakdownByFeeType[accrual.feeType] = (breakdownByFeeType[accrual.feeType] || 0) + minor;
      } catch {}
    }

    let paidMinor = 0;
    let pendingMinor = 0;
    let failedCount = 0;

    for (const payout of payouts) {
      try {
        const minor = parseToMinorUnits(payout.amount, payout.currency);
        if (payout.status === PayoutStatus.SUCCEEDED) paidMinor += minor;
        if (payout.status === PayoutStatus.PENDING || payout.status === PayoutStatus.PROCESSING || payout.status === PayoutStatus.CREATED) pendingMinor += minor;
        if (payout.status === PayoutStatus.FAILED) failedCount++;
      } catch {}
    }

    // Format breakdowns
    const formatBreakdown = (map: Record<string, number>) => {
      const formatted: Record<string, string> = {};
      for (const [key, minor] of Object.entries(map)) {
        try {
          formatted[key] = formatFromMinorUnits(minor, currency);
        } catch {
          formatted[key] = minor.toString();
        }
      }
      return formatted;
    };

    return {
      tenantId,
      period: filter?.period || 'ALL',
      currency,
      platformFeeTotal: formatFromMinorUnits(platformMinor, currency),
      performanceFeeTotal: formatFromMinorUnits(performanceMinor, currency),
      totalFees: formatFromMinorUnits(accruedMinor, currency),
      accruedTotal: formatFromMinorUnits(accruedMinor, currency),
      settledTotal: formatFromMinorUnits(settledMinor, currency),
      paidTotal: formatFromMinorUnits(paidMinor, currency),
      pendingTotal: formatFromMinorUnits(pendingMinor, currency),
      reversedTotal: formatFromMinorUnits(reversedMinor, currency),
      failedCount,
      accrualCount: accruals.length,
      settlementCount: settlements.length,
      payoutCount: payouts.length,
      breakdownBySource: formatBreakdown(breakdownBySource),
      breakdownByCurrency: formatBreakdown(breakdownByCurrency),
      breakdownByFeeType: formatBreakdown(breakdownByFeeType),
      fetchedAt: new Date().toISOString(),
    };
  }

  async getPlatformAnalytics(filter?: { currency?: string; fromDate?: Date; toDate?: Date; tenantId?: string }): Promise<any> {
    // For platform admin - aggregate across tenants
    // In real implementation, would query all tenants or use materialized view
    // For now, if tenantId provided, delegate to tenant analytics
    if (filter?.tenantId) {
      return this.getTenantAnalytics(filter.tenantId, filter);
    }

    // Otherwise return empty aggregated structure with note
    const currency = filter?.currency || 'USD';
    return {
      tenantId: null,
      period: 'ALL',
      currency,
      platformFeeTotal: formatFromMinorUnits(0, currency),
      performanceFeeTotal: formatFromMinorUnits(0, currency),
      totalFees: formatFromMinorUnits(0, currency),
      accruedTotal: formatFromMinorUnits(0, currency),
      settledTotal: formatFromMinorUnits(0, currency),
      paidTotal: formatFromMinorUnits(0, currency),
      pendingTotal: formatFromMinorUnits(0, currency),
      reversedTotal: formatFromMinorUnits(0, currency),
      failedCount: 0,
      breakdownBySource: {},
      breakdownByCurrency: {},
      breakdownByFeeType: {},
      note: 'Platform-wide analytics requires tenant iteration - provide tenantId for specific tenant analytics',
      fetchedAt: new Date().toISOString(),
    };
  }

  async getFeeSummary(
    tenantId: string,
    filter?: { currency?: string; feeType?: FeeType; fromDate?: Date; toDate?: Date; sourceType?: string },
  ): Promise<any> {
    const accruals = await this.accrualRepository.listByTenant(tenantId, {
      currency: filter?.currency,
      feeType: filter?.feeType,
      sourceType: filter?.sourceType as any,
      fromDate: filter?.fromDate,
      toDate: filter?.toDate,
      limit: 1000,
    });

    let grossMinor = 0;
    let feeMinor = 0;
    let netMinor = 0;
    let accruedCount = 0;
    let settledCount = 0;
    let paidCount = 0;
    let pendingCount = 0;
    let accruedTotalMinor = 0;
    let settledTotalMinor = 0;
    let paidTotalMinor = 0;
    let pendingTotalMinor = 0;

    const currency = filter?.currency || accruals[0]?.currency || 'USD';

    for (const accrual of accruals) {
      try {
        const gross = parseToMinorUnits(accrual.grossAmount, accrual.currency);
        const fee = parseToMinorUnits(accrual.feeAmount, accrual.currency);
        const net = parseToMinorUnits(accrual.netAmount, accrual.currency);

        grossMinor += gross;
        feeMinor += fee;
        netMinor += net;

        if (accrual.status === FeeAccrualStatus.ACCRUED) {
          accruedCount++;
          accruedTotalMinor += fee;
        }
        if (accrual.status === FeeAccrualStatus.SETTLED) {
          settledCount++;
          settledTotalMinor += fee;
        }
        if (accrual.payoutState === PayoutState.SUCCEEDED) {
          paidCount++;
          paidTotalMinor += fee;
        }
        if (accrual.payoutState === PayoutState.PENDING || accrual.payoutState === PayoutState.PROCESSING || !accrual.payoutState) {
          if (accrual.settlementState === SettlementState.FINALIZED || accrual.settlementState === SettlementState.PAID) {
            pendingCount++;
            pendingTotalMinor += fee;
          }
        }
      } catch {}
    }

    // Calculate effective rate
    let effectiveRateBps: number | null = null;
    if (grossMinor > 0) {
      effectiveRateBps = Math.round((feeMinor / grossMinor) * 10000);
    }

    return {
      tenantId,
      periodStart: filter?.fromDate ? filter.fromDate.toISOString() : null,
      periodEnd: filter?.toDate ? filter.toDate.toISOString() : null,
      currency,
      feeType: filter?.feeType || 'ALL',
      grossAmount: formatFromMinorUnits(grossMinor, currency),
      feeAmount: formatFromMinorUnits(feeMinor, currency),
      netAmount: formatFromMinorUnits(netMinor, currency),
      accruedCount,
      settledCount,
      paidCount,
      pendingCount,
      accruedTotal: formatFromMinorUnits(accruedTotalMinor, currency),
      settledTotal: formatFromMinorUnits(settledTotalMinor, currency),
      paidTotal: formatFromMinorUnits(paidTotalMinor, currency),
      pendingTotal: formatFromMinorUnits(pendingTotalMinor, currency),
      effectiveRateBps,
      feeRate: effectiveRateBps !== null ? `${(effectiveRateBps / 100).toFixed(2)}%` : null,
      rateBasis: 'BPS',
      fetchedAt: new Date().toISOString(),
    };
  }
}
