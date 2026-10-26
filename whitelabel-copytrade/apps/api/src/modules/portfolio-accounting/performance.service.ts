import { failClosedMoneyOperation } from '../../common/money-path-failure';
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import type { PortfolioCashLedgerEntry } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AccountingPolicyService } from './accounting-policy.service';
import { NavService } from './nav.service';
import {
  PortfolioAccountingScope,
  PortfolioReturnMethodology,
  deterministicIdempotencyKey,
  TWR_FLOW_BOUNDARY_RULE,
  add,
  sub,
  mul,
  div,
  cmp,
  isValidDecimal,
  redactSecrets,
} from './portfolio-accounting.types';

/**
 * # Responsibility: calculates source-backed TWR and MWR with exact-decimal flow-boundary handling.
 * Calculates TWR and MWR where sufficient data exists, rejects/marks unavailable when missing observations.
 * Must include periodStart/End starting/ending NAV externalCashFlows fees treatment version completeness.
 */

type ExternalCashFlowType = 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER_IN' | 'TRANSFER_OUT';

type TWRCashFlowRow = Pick<
  PortfolioCashLedgerEntry,
  | 'id'
  | 'tenantId'
  | 'profileId'
  | 'idempotencyKey'
  | 'occurredAt'
  | 'cashFlowType'
  | 'amount'
  | 'currency'
  | 'baseCurrency'
  | 'baseCurrencyAmount'
  | 'conversionRate'
  | 'conversionSource'
  | 'conversionTimestamp'
  | 'conversionStatus'
  | 'sourceType'
  | 'sourceId'
>;

interface TWRExternalCashFlowEvidence {
  date: string;
  amount: string | null;
  type: string;
  currency: string;
  baseCurrency: string;
  sourceReference: string | null;
}

interface TWRPerformanceEvidence {
  methodology: PortfolioReturnMethodology.TIME_WEIGHTED_RETURN;
  flowBoundary: typeof TWR_FLOW_BOUNDARY_RULE;
  periodStart: string;
  periodEnd: string;
  startingNav: string | null;
  endingNav: string | null;
  externalCashFlows: TWRExternalCashFlowEvidence[] | null;
  feesTreatment: string;
  returnPercent: string | null;
  calculationVersion: string;
  policyVersion: string;
  dataCompleteness: 'COMPLETE' | 'UNAVAILABLE';
  sourceReferences: string[];
}

interface TWRCalculationResult {
  returnPercent: string | null;
  evidence: TWRPerformanceEvidence;
  canCalculate: boolean;
  reason?: string;
  failureCode?: string;
}

interface NormalizedExternalCashFlow {
  row: TWRCashFlowRow;
  amount: string;
  signedAmount: string;
  evidence: TWRExternalCashFlowEvidence;
}

function isExternalCashFlowType(value: string): value is ExternalCashFlowType {
  return value === 'DEPOSIT' || value === 'WITHDRAWAL' || value === 'TRANSFER_IN' || value === 'TRANSFER_OUT';
}

function isCompleteNavObservation(
  observation: Awaited<ReturnType<NavService['calculateNav']>>,
): observation is Awaited<ReturnType<NavService['calculateNav']>> & { nav: string } {
  return (
    typeof observation.nav === 'string' &&
    isValidDecimal(observation.nav) &&
    observation.dataCompleteness === 'COMPLETE' &&
    observation.canPublish === true
  );
}

@Injectable()
export class PerformanceService {
  private readonly logger = new Logger(PerformanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: AccountingPolicyService,
    private readonly navService: NavService,
  ) {}

  async calculateTWR(params: {
    tenantId: string;
    profileId: string;
    periodStart: Date;
    periodEnd: Date;
    baseCurrency?: string;
  }): Promise<TWRCalculationResult> {
    const { tenantId, profileId, periodStart, periodEnd } = params;
    if (
      !Number.isFinite(periodStart.getTime()) ||
      !Number.isFinite(periodEnd.getTime()) ||
      periodStart.getTime() >= periodEnd.getTime()
    ) {
      throw new BadRequestException('TWR periodStart and periodEnd must be valid dates in ascending order');
    }

    const policy = await this.policyService.resolvePolicy({
      tenantId,
      scope: PortfolioAccountingScope.TENANT,
      scopeId: profileId,
    });
    const baseCurrency = (params.baseCurrency ?? policy.baseCurrency).trim().toUpperCase();
    if (!baseCurrency) throw new BadRequestException('TWR baseCurrency is required');

    const periodStartIso = periodStart.toISOString();
    const periodEndIso = periodEnd.toISOString();
    const unavailable = (
      reason: string,
      externalCashFlows: TWRExternalCashFlowEvidence[] | null = [],
      startingNav: string | null = null,
      endingNav: string | null = null,
      sourceReferences: string[] = [],
    ): TWRCalculationResult => ({
      returnPercent: null,
      canCalculate: false,
      reason,
      evidence: {
        methodology: PortfolioReturnMethodology.TIME_WEIGHTED_RETURN,
        flowBoundary: TWR_FLOW_BOUNDARY_RULE,
        periodStart: periodStartIso,
        periodEnd: periodEndIso,
        startingNav,
        endingNav,
        externalCashFlows,
        feesTreatment: policy.feeTreatment,
        returnPercent: null,
        calculationVersion: policy.calculationVersion,
        policyVersion: policy.policyVersion,
        dataCompleteness: 'UNAVAILABLE',
        sourceReferences,
      },
    });
    const evidenceForRows = (rows: readonly TWRCashFlowRow[]): TWRExternalCashFlowEvidence[] =>
      rows.map((row) => ({
        date: Number.isFinite(row.occurredAt.getTime()) ? row.occurredAt.toISOString() : 'INVALID_DATE',
        amount: row.baseCurrencyAmount,
        type: String(row.cashFlowType),
        currency: row.currency,
        baseCurrency: row.baseCurrency,
        sourceReference:
          row.sourceType?.trim() && row.sourceId?.trim()
            ? `${row.sourceType}:${row.sourceId}`
            : null,
      }));

    let cashFlows: TWRCashFlowRow[];
    try {
      cashFlows = await this.prisma.portfolioCashLedgerEntry.findMany({
        where: {
          tenantId,
          profileId,
          cashFlowType: {
            in: ['DEPOSIT', 'WITHDRAWAL', 'TRANSFER_IN', 'TRANSFER_OUT'],
          },
          occurredAt: { gte: periodStart, lte: periodEnd },
        },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        take: 101,
        select: {
          id: true,
          tenantId: true,
          profileId: true,
          idempotencyKey: true,
          occurredAt: true,
          cashFlowType: true,
          amount: true,
          currency: true,
          baseCurrency: true,
          baseCurrencyAmount: true,
          conversionRate: true,
          conversionSource: true,
          conversionTimestamp: true,
          conversionStatus: true,
          sourceType: true,
          sourceId: true,
        },
      });
    } catch (error) {
      this.logger.warn(
        `TWR cash-flow source unavailable tenant=${tenantId} profile=${profileId}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      const result = unavailable('CASH_FLOW_SOURCE_UNAVAILABLE', null);
      result.failureCode = 'CASH_FLOW_LOOKUP_FAILED';
      return result;
    }

    if (cashFlows.length > 100) {
      return unavailable('TOO_MANY_CASH_FLOWS', null);
    }

    const duplicateKeys = new Set<string>();
    const normalizedFlows: NormalizedExternalCashFlow[] = [];
    const rawEvidence = evidenceForRows(cashFlows);
    for (const flow of cashFlows) {
      const flowDate = flow.occurredAt.getTime();
      if (
        flow.tenantId !== tenantId ||
        flow.profileId !== profileId ||
        !flow.id.trim() ||
        !flow.idempotencyKey.trim() ||
        duplicateKeys.has(flow.idempotencyKey) ||
        !Number.isFinite(flowDate) ||
        flowDate < periodStart.getTime() ||
        flowDate > periodEnd.getTime() ||
        !isExternalCashFlowType(flow.cashFlowType) ||
        !isValidDecimal(flow.amount) ||
        cmp(flow.amount, '0') < 0 ||
        !flow.currency.trim() ||
        !flow.baseCurrency.trim() ||
        flow.baseCurrency.trim().toUpperCase() !== baseCurrency
      ) {
        return unavailable('INVALID_EXTERNAL_CASH_FLOW_EVIDENCE', rawEvidence);
      }
      duplicateKeys.add(flow.idempotencyKey);

      if (flow.conversionStatus === 'MISSING_FX' || flow.baseCurrencyAmount === null) {
        return unavailable('MISSING_FX', rawEvidence);
      }
      if (!isValidDecimal(flow.baseCurrencyAmount) || cmp(flow.baseCurrencyAmount, '0') < 0) {
        return unavailable('INVALID_EXTERNAL_CASH_FLOW_EVIDENCE', rawEvidence);
      }

      const currency = flow.currency.trim().toUpperCase();
      if (currency === baseCurrency) {
        if (
          flow.conversionStatus !== 'SAME_CURRENCY' ||
          cmp(flow.baseCurrencyAmount, flow.amount) !== 0
        ) {
          return unavailable('INVALID_EXTERNAL_CASH_FLOW_EVIDENCE', rawEvidence);
        }
      } else if (
        flow.conversionStatus !== 'CONVERTED' ||
        flow.conversionRate === null ||
        !isValidDecimal(flow.conversionRate) ||
        cmp(flow.conversionRate, '0') <= 0 ||
        !flow.conversionSource?.trim() ||
        flow.conversionTimestamp === null ||
        !Number.isFinite(flow.conversionTimestamp.getTime())
      ) {
        return unavailable('MISSING_FX', rawEvidence);
      }

      if (!flow.sourceType?.trim() || !flow.sourceId?.trim()) {
        return unavailable('INVALID_EXTERNAL_CASH_FLOW_EVIDENCE', rawEvidence);
      }

      const isInflow = flow.cashFlowType === 'DEPOSIT' || flow.cashFlowType === 'TRANSFER_IN';
      normalizedFlows.push({
        row: flow,
        amount: flow.baseCurrencyAmount,
        signedAmount: isInflow ? flow.baseCurrencyAmount : sub('0', flow.baseCurrencyAmount),
        evidence: {
          date: flow.occurredAt.toISOString(),
          amount: flow.baseCurrencyAmount,
          type: flow.cashFlowType,
          currency: flow.currency,
          baseCurrency: flow.baseCurrency,
          sourceReference: `${flow.sourceType}:${flow.sourceId}`,
        },
      });
    }

    const externalCashFlows = normalizedFlows.map((flow) => flow.evidence);
    let navStart: Awaited<ReturnType<NavService['calculateNav']>>;
    let navEnd: Awaited<ReturnType<NavService['calculateNav']>>;
    try {
      [navStart, navEnd] = await Promise.all([
        this.navService.calculateNav({ tenantId, profileId, at: periodStart, baseCurrency }),
        this.navService.calculateNav({ tenantId, profileId, at: periodEnd, baseCurrency }),
      ]);
    } catch (error) {
      this.logger.warn(
        `TWR NAV source unavailable tenant=${tenantId} profile=${profileId}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return unavailable('NAV_SOURCE_UNAVAILABLE', externalCashFlows);
    }

    const boundaryReferences = [...new Set([...navStart.sourceReferences, ...navEnd.sourceReferences])];
    if (!isCompleteNavObservation(navStart) || !isCompleteNavObservation(navEnd)) {
      const missingFx =
        navStart.dataCompleteness === 'MISSING_FX_NO_NAV' ||
        navEnd.dataCompleteness === 'MISSING_FX_NO_NAV';
      return unavailable(
        missingFx ? 'MISSING_FX' : 'MISSING_NAV_OBSERVATIONS',
        externalCashFlows,
        navStart.nav,
        navEnd.nav,
        boundaryReferences,
      );
    }

    if (cmp(navStart.nav, '0') <= 0 || cmp(navEnd.nav, '0') < 0) {
      return unavailable(
        'NON_POSITIVE_NAV_BOUNDARY',
        externalCashFlows,
        navStart.nav,
        navEnd.nav,
        boundaryReferences,
      );
    }

    const sourceReferences = new Set<string>([
      ...boundaryReferences,
      ...normalizedFlows.map((flow) => flow.evidence.sourceReference).filter((value): value is string => value !== null),
    ]);
    const startTime = periodStart.getTime();
    const endTime = periodEnd.getTime();
    const groupedFlows = new Map<number, { occurredAt: Date; signedAmount: string }>();
    for (const flow of normalizedFlows) {
      const occurredAt = flow.row.occurredAt;
      const timestamp = occurredAt.getTime();
      if (timestamp <= startTime || timestamp >= endTime) continue;
      const current = groupedFlows.get(timestamp);
      groupedFlows.set(timestamp, {
        occurredAt,
        signedAmount: add(current?.signedAmount ?? '0', flow.signedAmount),
      });
    }

    const orderedFlowGroups = [...groupedFlows.values()].sort(
      (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
    );
    let chainFactor = '1';
    let previousPostFlowNav = navStart.nav;
    try {
      for (const group of orderedFlowGroups) {
        const navAtFlow = await this.navService.calculateNav({
          tenantId,
          profileId,
          at: group.occurredAt,
          baseCurrency,
        });
        if (!isCompleteNavObservation(navAtFlow) || cmp(navAtFlow.nav, '0') < 0) {
          return unavailable(
            'MISSING_SUBPERIOD_NAV',
            externalCashFlows,
            navStart.nav,
            navEnd.nav,
            [...new Set([...sourceReferences, ...navAtFlow.sourceReferences])],
          );
        }
        if (cmp(previousPostFlowNav, '0') <= 0) {
          return unavailable(
            'NON_POSITIVE_SUBPERIOD_NAV',
            externalCashFlows,
            navStart.nav,
            navEnd.nav,
            [...sourceReferences],
          );
        }

        // The NAV observation at an interior timestamp includes all flows at that timestamp.
        // Remove their net contribution to recover the pre-flow close, then chain to the next
        // post-flow NAV. This makes equal-time deposits and withdrawals one boundary event.
        const preFlowNav = sub(navAtFlow.nav, group.signedAmount);
        if (!isValidDecimal(preFlowNav) || cmp(preFlowNav, '0') < 0) {
          return unavailable(
            'INVALID_SUBPERIOD_NAV',
            externalCashFlows,
            navStart.nav,
            navEnd.nav,
            [...new Set([...sourceReferences, ...navAtFlow.sourceReferences])],
          );
        }
        chainFactor = mul(chainFactor, div(preFlowNav, previousPostFlowNav));
        previousPostFlowNav = navAtFlow.nav;
        for (const reference of navAtFlow.sourceReferences) sourceReferences.add(reference);
      }

      // Start flows are already included in the opening NAV. End flows are removed from the
      // closing NAV so a period-end withdrawal cannot inflate the return (and a deposit cannot
      // depress it).
      const netEndFlow = normalizedFlows
        .filter((flow) => flow.row.occurredAt.getTime() === endTime)
        .reduce((total, flow) => add(total, flow.signedAmount), '0');
      const closingNav = sub(navEnd.nav, netEndFlow);
      if (!isValidDecimal(closingNav) || cmp(closingNav, '0') < 0 || cmp(previousPostFlowNav, '0') <= 0) {
        return unavailable(
          'INVALID_CLOSING_NAV',
          externalCashFlows,
          navStart.nav,
          closingNav,
          [...new Set([...sourceReferences, ...navEnd.sourceReferences])],
        );
      }

      chainFactor = mul(chainFactor, div(closingNav, previousPostFlowNav));
      const returnPercent = mul(sub(chainFactor, '1'), '100');
      return {
        returnPercent,
        canCalculate: true,
        evidence: {
          methodology: PortfolioReturnMethodology.TIME_WEIGHTED_RETURN,
          flowBoundary: TWR_FLOW_BOUNDARY_RULE,
          periodStart: periodStartIso,
          periodEnd: periodEndIso,
          startingNav: navStart.nav,
          endingNav: closingNav,
          externalCashFlows,
          feesTreatment: policy.feeTreatment,
          returnPercent,
          calculationVersion: policy.calculationVersion,
          policyVersion: policy.policyVersion,
          dataCompleteness: 'COMPLETE',
          sourceReferences: [...sourceReferences],
        },
      };
    } catch (error) {
      this.logger.warn(
        `TWR exact-decimal calculation failed tenant=${tenantId} profile=${profileId}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return unavailable(
        'CALCULATION_FAILED',
        externalCashFlows,
        navStart.nav,
        navEnd.nav,
        [...new Set([...sourceReferences, ...navEnd.sourceReferences])],
      );
    }
  }

  async calculateMWR(params: {
    tenantId: string;
    profileId: string;
    periodStart: Date;
    periodEnd: Date;
    baseCurrency?: string;
  }): Promise<{ returnPercent: string | null; evidence: any; canCalculate: boolean; reason?: string }> {
    const { tenantId, profileId, periodStart, periodEnd } = params;

    const policy = await this.policyService.resolvePolicy({ tenantId, scope: 'TENANT' as any, scopeId: profileId });
    const baseCurrency = params.baseCurrency ?? policy.baseCurrency;

    const navStart = await this.navService.calculateNav({ tenantId, profileId, at: periodStart, baseCurrency });
    const navEnd = await this.navService.calculateNav({ tenantId, profileId, at: periodEnd, baseCurrency });

    if (!navStart.nav || !navEnd.nav) {
      return {
        returnPercent: null,
        canCalculate: false,
        reason: 'MISSING_NAV_OBSERVATIONS',
        evidence: {
          methodology: PortfolioReturnMethodology.MONEY_WEIGHTED_RETURN,
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
          startingNav: navStart.nav,
          endingNav: navEnd.nav,
          externalCashFlows: [],
          feesTreatment: policy.feeTreatment,
          returnPercent: null,
          calculationVersion: policy.calculationVersion,
          policyVersion: policy.policyVersion,
          dataCompleteness: 'MISSING_NAV_OBSERVATIONS',
          sourceReferences: [],
        },
      };
    }

    // MWR (IRR) requires cash flows and NAV observations — simplified: use Newton-Raphson or mark unavailable if insufficient data
    let cashFlows: any[] = [];
    try {
      cashFlows = await (this.prisma as any).portfolioCashLedgerEntry.findMany({
        where: {
          tenantId,
          profileId,
          cashFlowType: { in: ['DEPOSIT', 'WITHDRAWAL', 'TRANSFER_IN', 'TRANSFER_OUT'] },
          occurredAt: { gte: periodStart, lte: periodEnd },
        },
        orderBy: { occurredAt: 'asc' },
      });
    } catch (caughtErrorB1) { failClosedMoneyOperation(caughtErrorB1, { code: 'PORTFOLIO_ACCOUNTING_PERFORMANCE_OPERATION_1_FAILED', tenantId: tenantId, entityId: profileId }); }

    // If no cash flows, MWR = TWR
    if (cashFlows.length === 0) {
      try {
        const ratio = div(navEnd.nav, navStart.nav);
        const mwr = mul(sub(ratio, '1'), '100');
        return {
          returnPercent: mwr,
          canCalculate: true,
          evidence: {
            methodology: PortfolioReturnMethodology.MONEY_WEIGHTED_RETURN,
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
            startingNav: navStart.nav,
            endingNav: navEnd.nav,
            externalCashFlows: [],
            feesTreatment: policy.feeTreatment,
            returnPercent: mwr,
            calculationVersion: policy.calculationVersion,
            policyVersion: policy.policyVersion,
            dataCompleteness: 'COMPLETE',
            sourceReferences: [...navStart.sourceReferences, ...navEnd.sourceReferences],
          },
        };
      } catch {
        return {
          returnPercent: null,
          canCalculate: false,
          reason: 'CALCULATION_FAILED',
          evidence: {
            methodology: PortfolioReturnMethodology.MONEY_WEIGHTED_RETURN,
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
            startingNav: navStart.nav,
            endingNav: navEnd.nav,
            externalCashFlows: [],
            feesTreatment: policy.feeTreatment,
            returnPercent: null,
            calculationVersion: policy.calculationVersion,
            policyVersion: policy.policyVersion,
            dataCompleteness: 'CALCULATION_FAILED',
            sourceReferences: [],
          },
        };
      }
    }

    // For MWR with cash flows, we need IRR calculation — simplified: mark as requires more observations if insufficient
    // Full IRR implementation would use iterative solver — for now, if we have observations, compute approximate
    // Using simple formula: MWR = (endingNav - startingNav - netCashFlows) / (startingNav + weightedCashFlows)
    try {
      let netCashFlows = '0';
      let weightedCashFlows = '0';
      const totalDays = (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24) || 1;

      for (const cf of cashFlows) {
        const amt = cf.baseCurrencyAmount ?? cf.amount;
        const isInflow = ['DEPOSIT', 'TRANSFER_IN'].includes(cf.cashFlowType);
        netCashFlows = isInflow ? add(netCashFlows, amt) : sub(netCashFlows, amt);
        const daysRemaining = (periodEnd.getTime() - cf.occurredAt.getTime()) / (1000 * 60 * 60 * 24);
        const weight = (daysRemaining / totalDays).toString();
        const weighted = mul(amt, weight);
        weightedCashFlows = isInflow ? add(weightedCashFlows, weighted) : sub(weightedCashFlows, weighted);
      }

      const gain = sub(sub(navEnd.nav, navStart.nav), netCashFlows);
      const denominator = add(navStart.nav, weightedCashFlows);
      if (cmp(denominator, '0') === 0) {
        return {
          returnPercent: null,
          canCalculate: false,
          reason: 'ZERO_DENOMINATOR',
          evidence: {
            methodology: PortfolioReturnMethodology.MONEY_WEIGHTED_RETURN,
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
            startingNav: navStart.nav,
            endingNav: navEnd.nav,
            externalCashFlows: cashFlows.map((c: any) => ({ date: c.occurredAt.toISOString(), amount: c.baseCurrencyAmount ?? c.amount, type: c.cashFlowType })),
            feesTreatment: policy.feeTreatment,
            returnPercent: null,
            calculationVersion: policy.calculationVersion,
            policyVersion: policy.policyVersion,
            dataCompleteness: 'ZERO_DENOMINATOR',
            sourceReferences: [...navStart.sourceReferences, ...navEnd.sourceReferences],
          },
        };
      }

      const mwr = mul(div(gain, denominator), '100');
      return {
        returnPercent: mwr,
        canCalculate: true,
        evidence: {
          methodology: PortfolioReturnMethodology.MONEY_WEIGHTED_RETURN,
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
          startingNav: navStart.nav,
          endingNav: navEnd.nav,
          externalCashFlows: cashFlows.map((c: any) => ({ date: c.occurredAt.toISOString(), amount: c.baseCurrencyAmount ?? c.amount, type: c.cashFlowType })),
          feesTreatment: policy.feeTreatment,
          returnPercent: mwr,
          calculationVersion: policy.calculationVersion,
          policyVersion: policy.policyVersion,
          dataCompleteness: 'COMPLETE',
          sourceReferences: [...navStart.sourceReferences, ...navEnd.sourceReferences],
        },
      };
    } catch (e) {
      return {
        returnPercent: null,
        canCalculate: false,
        reason: `CALCULATION_FAILED: ${(e as Error).message}`,
        evidence: {
          methodology: PortfolioReturnMethodology.MONEY_WEIGHTED_RETURN,
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
          startingNav: navStart.nav,
          endingNav: navEnd.nav,
          externalCashFlows: cashFlows.map((c: any) => ({ date: c.occurredAt.toISOString(), amount: c.baseCurrencyAmount ?? c.amount, type: c.cashFlowType })),
          feesTreatment: policy.feeTreatment,
          returnPercent: null,
          calculationVersion: policy.calculationVersion,
          policyVersion: policy.policyVersion,
          dataCompleteness: 'CALCULATION_FAILED',
          sourceReferences: [],
        },
      };
    }
  }

  async persistPerformanceRecord(params: {
    tenantId: string;
    profileId: string;
    periodId?: string | null;
    methodology: PortfolioReturnMethodology;
    periodStart: Date;
    periodEnd: Date;
    startingNav: string | null;
    endingNav: string | null;
    externalCashFlows: any[];
    feesTreatment: string;
    returnPercent: string | null;
    calculationVersion: string;
    policyVersion: string;
    baseCurrency: string;
    dataCompleteness: string;
    sourceReferences: string[];
    evidence: any;
  }): Promise<any> {
    const idempotencyKey = deterministicIdempotencyKey({
      type: `performance:${params.methodology}:${params.periodStart.toISOString()}:${params.periodEnd.toISOString()}`,
      tenantId: params.tenantId,
      profileId: params.profileId,
      sourceId: params.periodId ?? `${params.periodStart.toISOString()}_${params.periodEnd.toISOString()}`,
    });

    try {
      const existing = await (this.prisma as any).portfolioPerformanceRecord.findFirst({ where: { tenantId: params.tenantId, idempotencyKey } });
      if (existing) return existing;
    } catch (caughtErrorB1) { failClosedMoneyOperation(caughtErrorB1, { code: 'PORTFOLIO_ACCOUNTING_PERFORMANCE_OPERATION_2_FAILED', tenantId: params.tenantId, entityId: idempotencyKey }); }

    try {
      return await (this.prisma as any).portfolioPerformanceRecord.create({
        data: {
          tenantId: params.tenantId,
          profileId: params.profileId,
          periodId: params.periodId ?? null,
          methodology: params.methodology as any,
          periodStart: params.periodStart,
          periodEnd: params.periodEnd,
          startingNav: params.startingNav,
          endingNav: params.endingNav,
          externalCashFlows: params.externalCashFlows as any,
          feesTreatment: params.feesTreatment,
          returnPercent: params.returnPercent,
          calculationVersion: params.calculationVersion,
          policyVersion: params.policyVersion,
          baseCurrency: params.baseCurrency,
          valuationTimestamp: new Date(),
          dataCompleteness: params.dataCompleteness,
          sourceReferences: params.sourceReferences,
          evidence: redactSecrets(params.evidence) as any,
          idempotencyKey,
        },
      });
    } catch (e) {
      this.logger.warn(`Failed to persist performance record: ${(e as Error).message}`);
      return null;
    }
  }
}
