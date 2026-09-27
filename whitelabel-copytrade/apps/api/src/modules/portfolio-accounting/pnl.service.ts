import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CostBasisService } from './cost-basis.service';
import { ValuationService } from './valuation.service';
import { AccountingPolicyService } from './accounting-policy.service';
import { AccountingEventRepository } from './accounting-event.repository';
import {
  PortfolioPnLType,
  add,
  sub,
  mul,
  cmp,
  isValidDecimal,
  redactSecrets,
  deterministicIdempotencyKey,
} from './portfolio-accounting.types';

/**
 * Calculates realized, unrealized, gross, fee-adjusted, net PnL using fills,
 * cost basis, valuation, and fee records, not as a second execution PnL truth.
 * Distinguishes REALIZED/UNREALIZED/GROSS/FEE_ADJUSTED/NET with cost-basis/valuation refs,
 * missing/stale price not zero.
 */

@Injectable()
export class PnLService {
  private readonly logger = new Logger(PnLService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly costBasisService: CostBasisService,
    private readonly valuationService: ValuationService,
    private readonly policyService: AccountingPolicyService,
    private readonly eventRepo: AccountingEventRepository,
  ) {}

  async calculateRealizedPnl(params: {
    tenantId: string;
    profileId: string;
    from?: Date;
    to?: Date;
    symbol?: string;
  }): Promise<{ realizedPnl: string; evidence: any }> {
    const { tenantId, profileId, from, to, symbol } = params;

    const policy = await this.policyService.resolvePolicy({ tenantId, scope: 'TENANT' as any, scopeId: profileId });

    const result = await this.costBasisService.getRealizedPnl({ tenantId, profileId, symbol, from, to });

    return {
      realizedPnl: result.realizedPnl,
      evidence: {
        type: PortfolioPnLType.REALIZED,
        amount: result.realizedPnl,
        baseCurrency: policy.baseCurrency,
        calculationVersion: policy.calculationVersion,
        policyVersion: policy.policyVersion,
        methodology: `${policy.costBasisMethod}_FIFO_REALIZED`,
        dataCompleteness: 'COMPLETE',
        disposals: result.disposals,
      },
    };
  }

  async calculateUnrealizedPnl(params: {
    tenantId: string;
    profileId: string;
    at: Date;
    baseCurrency?: string;
  }): Promise<{ unrealizedPnl: string | null; evidence: any; hasMissingPrice: boolean; hasStalePrice: boolean }> {
    const { tenantId, profileId, at } = params;

    const policy = await this.policyService.resolvePolicy({ tenantId, scope: 'TENANT' as any, scopeId: profileId });
    const baseCurrency = params.baseCurrency ?? policy.baseCurrency;

    // Get open lots
    let openLots: any[] = [];
    try {
      openLots = await (this.prisma as any).portfolioPositionLot.findMany({
        where: { tenantId, profileId, isClosed: false, isReversed: false, openedAt: { lte: at } },
        orderBy: { openedAt: 'asc' },
      });
    } catch {
      openLots = [];
    }

    let unrealizedPnl = '0';
    let hasMissingPrice = false;
    let hasStalePrice = false;
    const valuationRefs: string[] = [];
    const costBasisRefs: string[] = [];

    for (const lot of openLots) {
      const valuation = await this.valuationService.valuePosition({
        tenantId,
        profileId,
        symbol: lot.symbol,
        asset: lot.asset,
        quantity: lot.remainingQuantity,
        at,
        baseCurrency,
      });

      if (valuation.evidence.valuationState === 'MISSING_PRICE' || valuation.evidence.valuationState === 'MISSING_FX' || valuation.valuedAmount === null || valuation.baseCurrencyAmount === null) {
        hasMissingPrice = true;
        continue; // missing/stale price not zero — skip, mark incomplete
      }
      if (valuation.evidence.valuationState === 'STALE') hasStalePrice = true;

      const currentValue = valuation.baseCurrencyAmount ?? '0';
      const costBasis = lot.totalCostBasis ? this.proportionalCostBasis(lot.totalCostBasis, lot.quantity, lot.remainingQuantity) : '0';

      try {
        const lotUnrealized = sub(currentValue, costBasis);
        unrealizedPnl = add(unrealizedPnl, lotUnrealized);
        valuationRefs.push(`${lot.symbol}:${valuation.evidence.marketPriceSource ?? 'UNKNOWN'}`);
        costBasisRefs.push(lot.id);
      } catch {}
    }

    if (hasMissingPrice) {
      return {
        unrealizedPnl: null,
        evidence: {
          type: PortfolioPnLType.UNREALIZED,
          amount: null,
          baseCurrency,
          calculationVersion: policy.calculationVersion,
          policyVersion: policy.policyVersion,
          methodology: 'MARKET_MINUS_COST_BASIS',
          dataCompleteness: 'MISSING_PRICE_INCOMPLETE',
          hasMissingPrice,
          hasStalePrice,
          valuationRefs,
          costBasisRefs,
        },
        hasMissingPrice,
        hasStalePrice,
      };
    }

    return {
      unrealizedPnl,
      evidence: {
        type: PortfolioPnLType.UNREALIZED,
        amount: unrealizedPnl,
        baseCurrency,
        calculationVersion: policy.calculationVersion,
        policyVersion: policy.policyVersion,
        methodology: 'MARKET_MINUS_COST_BASIS',
        dataCompleteness: hasStalePrice ? 'STALE_PRICE' : 'COMPLETE',
        hasMissingPrice,
        hasStalePrice,
        valuationRefs,
        costBasisRefs,
      },
      hasMissingPrice,
      hasStalePrice,
    };
  }

  async calculateGrossPnl(params: {
    tenantId: string;
    profileId: string;
    from?: Date;
    to?: Date;
    at: Date;
    baseCurrency?: string;
  }): Promise<{ grossPnl: string | null; realized: string; unrealized: string | null; evidence: any }> {
    const realized = await this.calculateRealizedPnl({ tenantId: params.tenantId, profileId: params.profileId, from: params.from, to: params.to });
    const unrealized = await this.calculateUnrealizedPnl({ tenantId: params.tenantId, profileId: params.profileId, at: params.at, baseCurrency: params.baseCurrency });

    let grossPnl: string | null = null;
    if (realized.realizedPnl !== null && unrealized.unrealizedPnl !== null) {
      grossPnl = add(realized.realizedPnl, unrealized.unrealizedPnl);
    } else if (realized.realizedPnl !== null && unrealized.hasMissingPrice) {
      // Gross incomplete if unrealized missing — explicit, not zero
      grossPnl = null;
    } else {
      grossPnl = realized.realizedPnl;
    }

    const policy = await this.policyService.resolvePolicy({ tenantId: params.tenantId, scope: 'TENANT' as any, scopeId: params.profileId });

    return {
      grossPnl,
      realized: realized.realizedPnl,
      unrealized: unrealized.unrealizedPnl,
      evidence: {
        type: PortfolioPnLType.GROSS,
        amount: grossPnl,
        realized: realized.realizedPnl,
        unrealized: unrealized.unrealizedPnl,
        baseCurrency: params.baseCurrency ?? policy.baseCurrency,
        calculationVersion: policy.calculationVersion,
        policyVersion: policy.policyVersion,
        methodology: 'REALIZED_PLUS_UNREALIZED',
        dataCompleteness: grossPnl === null ? 'MISSING_PRICE_INCOMPLETE' : unrealized.evidence.dataCompleteness,
        costBasisRefs: unrealized.evidence.costBasisRefs,
        valuationRefs: unrealized.evidence.valuationRefs,
      },
    };
  }

  async calculateNetPnl(params: {
    tenantId: string;
    profileId: string;
    from?: Date;
    to?: Date;
    at: Date;
    baseCurrency?: string;
  }): Promise<{ netPnl: string | null; grossPnl: string | null; fees: string; evidence: any }> {
    const gross = await this.calculateGrossPnl(params);
    const policy = await this.policyService.resolvePolicy({ tenantId: params.tenantId, scope: 'TENANT' as any, scopeId: params.profileId });
    const baseCurrency = params.baseCurrency ?? policy.baseCurrency;

    // Fees from cash ledger — authoritative Fees module, not duplicated
    let fees = '0';
    try {
      const feeEntries = await (this.prisma as any).portfolioCashLedgerEntry.findMany({
        where: {
          tenantId: params.tenantId,
          profileId: params.profileId,
          cashFlowType: { in: ['FEE', 'PLATFORM_FEE', 'PERFORMANCE_FEE'] },
          occurredAt: { gte: params.from ?? new Date(0), lte: params.to ?? params.at },
        },
      });
      for (const entry of feeEntries) {
        const amt = entry.baseCurrencyAmount ?? entry.amount;
        if (amt && isValidDecimal(amt)) fees = add(fees, amt);
      }
    } catch {}

    let netPnl: string | null = null;
    if (gross.grossPnl !== null) {
      netPnl = sub(gross.grossPnl, fees);
    }

    const feeAdjusted = gross.grossPnl !== null ? sub(gross.grossPnl, fees) : null;

    return {
      netPnl,
      grossPnl: gross.grossPnl,
      fees,
      evidence: {
        gross: gross.evidence,
        feeAdjusted: {
          type: PortfolioPnLType.FEE_ADJUSTED,
          amount: feeAdjusted,
          fees,
          baseCurrency,
          calculationVersion: policy.calculationVersion,
          policyVersion: policy.policyVersion,
          methodology: 'GROSS_MINUS_FEES',
          dataCompleteness: gross.evidence.dataCompleteness,
        },
        net: {
          type: PortfolioPnLType.NET,
          amount: netPnl,
          gross: gross.grossPnl,
          fees,
          baseCurrency,
          calculationVersion: policy.calculationVersion,
          policyVersion: policy.policyVersion,
          methodology: 'GROSS_MINUS_FEES',
          dataCompleteness: gross.evidence.dataCompleteness,
        },
      },
    };
  }

  private proportionalCostBasis(totalCostBasis: string, totalQuantity: string, remainingQuantity: string): string {
    try {
      const { div, mul } = require('./portfolio-accounting.types');
      if (totalQuantity === remainingQuantity) return totalCostBasis;
      const ratio = div(remainingQuantity, totalQuantity);
      return mul(totalCostBasis, ratio);
    } catch {
      return totalCostBasis;
    }
  }
}
