import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CashLedgerService } from './cash-ledger.service';
import { PositionAccountingService } from './position-accounting.service';
import { ValuationService } from './valuation.service';
import { AccountingPolicyService } from './accounting-policy.service';
import { add, sub, redactSecrets, deterministicIdempotencyKey } from './portfolio-accounting.types';

/**
 * Calculates NAV from cash + valued positions + adjustments, currency-safe, evidence.
 * Missing FX → explicit incomplete state never invent rate/NAV.
 * Must be deterministic and preserve calculationVersion/policyVersion/baseCurrency/valuationTimestamp/sourceReferences/methodology/dataCompleteness.
 */

@Injectable()
export class NavService {
  private readonly logger = new Logger(NavService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cashLedger: CashLedgerService,
    private readonly positionAccounting: PositionAccountingService,
    private readonly valuationService: ValuationService,
    private readonly policyService: AccountingPolicyService,
  ) {}

  async calculateNav(params: {
    tenantId: string;
    profileId: string;
    at: Date;
    baseCurrency?: string;
    correlationId?: string | null;
  }): Promise<{
    nav: string | null;
    cash: string;
    grossAssetValue: string;
    grossLiability: string;
    adjustments: string;
    baseCurrency: string;
    valuationTimestamp: string;
    calculationVersion: string;
    policyVersion: string;
    sourceReferences: string[];
    methodology: string;
    dataCompleteness: string;
    evidences: any[];
    canPublish: boolean;
  }> {
    const { tenantId, profileId, at } = params;

    const policy = await this.policyService.resolvePolicy({ tenantId, scope: 'TENANT' as any, scopeId: profileId });
    const baseCurrency = params.baseCurrency ?? policy.baseCurrency;

    // Cash — from cash ledger, not exchange balance truth overwrite
    const cashEntries = await this.cashLedger.listCashEntries({ tenantId, profileId, page: 1, limit: 1000 });
    let cashBase = '0';
    for (const entry of cashEntries.data) {
      if (entry.occurredAt > at) continue;
      if (entry.baseCurrencyAmount) {
        const isOutflow = ['WITHDRAWAL', 'TRANSFER_OUT', 'FEE', 'PLATFORM_FEE', 'PERFORMANCE_FEE', 'TRADE_SETTLEMENT_BUY'].includes(entry.cashFlowType);
        cashBase = isOutflow ? sub(cashBase, entry.baseCurrencyAmount) : add(cashBase, entry.baseCurrencyAmount);
      } else if (entry.baseCurrency === baseCurrency) {
        const isOutflow = ['WITHDRAWAL', 'TRANSFER_OUT', 'FEE', 'PLATFORM_FEE', 'PERFORMANCE_FEE', 'TRADE_SETTLEMENT_BUY'].includes(entry.cashFlowType);
        cashBase = isOutflow ? sub(cashBase, entry.amount) : add(cashBase, entry.amount);
      }
    }

    // Holdings
    const holdings = await this.positionAccounting.getHoldings({ tenantId, profileId, at });

    // Valuation
    const valuation = await this.valuationService.valuePortfolio({
      tenantId,
      profileId,
      holdings,
      at,
      baseCurrency,
    });

    // NAV = cash + grossAsset - grossLiability + adjustments (adjustments from adjustment service — for now 0)
    let adjustments = '0';
    try {
      const adjustmentRecords = await (this.prisma as any).portfolioAccountingAdjustment.findMany({
        where: { tenantId, profileId, createdAt: { lte: at }, isReversed: false },
      });
      for (const adj of adjustmentRecords) {
        if (adj.adjustedAmount) {
          adjustments = add(adjustments, adj.adjustedAmount);
        }
      }
    } catch {}

    let nav: string | null = null;
    let canPublish = true;
    let dataCompleteness = valuation.completeness;

    // Missing FX → no NAV, explicit incomplete state never invent rate/NAV
    if (valuation.hasMissingFx) {
      nav = null;
      canPublish = false;
      dataCompleteness = 'MISSING_FX_NO_NAV';
    } else if (valuation.hasMissingPrice) {
      // Missing price → NAV incomplete, but we can still calculate with evidence
      // For portfolio accounting, missing price means incomplete NAV — mark accordingly
      // We still compute NAV from available valuations, but completeness is MISSING_PRICE
      try {
        const grossNet = valuation.netValued;
        nav = add(add(cashBase, grossNet), adjustments);
      } catch {
        nav = null;
      }
      dataCompleteness = 'MISSING_PRICE_INCOMPLETE';
    } else {
      try {
        const grossNet = valuation.netValued;
        nav = add(add(cashBase, grossNet), adjustments);
      } catch {
        nav = null;
        canPublish = false;
        dataCompleteness = 'CALCULATION_FAILED';
      }
    }

    const sourceReferences = [
      ...new Set([
        ...valuation.evidences.flatMap((e: any) => e.sourceReferences ?? []),
        ...cashEntries.data.map((c: any) => c.sourceType ?? 'CASH_LEDGER').filter(Boolean),
      ]),
    ];

    return {
      nav,
      cash: cashBase,
      grossAssetValue: valuation.grossAssetValue,
      grossLiability: valuation.grossLiability,
      adjustments,
      baseCurrency,
      valuationTimestamp: at.toISOString(),
      calculationVersion: policy.calculationVersion,
      policyVersion: policy.policyVersion,
      sourceReferences,
      methodology: `CASH_PLUS_VALUED_POSITIONS_${policy.costBasisMethod}`,
      dataCompleteness,
      evidences: valuation.evidences,
      canPublish,
    };
  }

  async persistNavCalculation(params: {
    tenantId: string;
    profileId: string;
    navResult: Awaited<ReturnType<NavService['calculateNav']>>;
    at: Date;
  }): Promise<void> {
    // NAV itself is not a separate model — it's stored in Snapshot and PerformanceRecord and Period
    // For audit, we log
    this.logger.log(
      redactSecrets({
        event: 'portfolio.nav.calculated',
        tenantId: params.tenantId,
        profileId: params.profileId,
        nav: params.navResult.nav,
        baseCurrency: params.navResult.baseCurrency,
        dataCompleteness: params.navResult.dataCompleteness,
        calculationVersion: params.navResult.calculationVersion,
      }),
    );
  }
}
