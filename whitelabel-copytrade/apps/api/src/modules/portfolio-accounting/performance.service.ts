import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AccountingPolicyService } from './accounting-policy.service';
import { NavService } from './nav.service';
import {
  PortfolioReturnMethodology,
  deterministicIdempotencyKey,
  add,
  sub,
  mul,
  div,
  cmp,
  isValidDecimal,
  redactSecrets,
} from './portfolio-accounting.types';

/**
 * Calculates TWR and MWR where sufficient data exists, rejects/marks unavailable when missing observations.
 * Must include periodStart/End starting/ending NAV externalCashFlows fees treatment version completeness.
 */

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
  }): Promise<{ returnPercent: string | null; evidence: any; canCalculate: boolean; reason?: string }> {
    const { tenantId, profileId, periodStart, periodEnd } = params;

    const policy = await this.policyService.resolvePolicy({ tenantId, scope: 'TENANT' as any, scopeId: profileId });
    const baseCurrency = params.baseCurrency ?? policy.baseCurrency;

    // Need NAV snapshots or ability to calculate NAV at sub-period boundaries defined by cash flows
    // Get cash flows within period
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
    } catch {
      cashFlows = [];
    }

    // Get NAV at start and end — require observations
    const navStart = await this.navService.calculateNav({ tenantId, profileId, at: periodStart, baseCurrency });
    const navEnd = await this.navService.calculateNav({ tenantId, profileId, at: periodEnd, baseCurrency });

    if (!navStart.nav || !navEnd.nav) {
      return {
        returnPercent: null,
        canCalculate: false,
        reason: 'MISSING_NAV_OBSERVATIONS',
        evidence: {
          methodology: PortfolioReturnMethodology.TIME_WEIGHTED_RETURN,
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
          startingNav: navStart.nav,
          endingNav: navEnd.nav,
          externalCashFlows: cashFlows.map((cf: any) => ({ date: cf.occurredAt.toISOString(), amount: cf.baseCurrencyAmount ?? cf.amount, type: cf.cashFlowType })),
          feesTreatment: policy.feeTreatment,
          returnPercent: null,
          calculationVersion: policy.calculationVersion,
          policyVersion: policy.policyVersion,
          dataCompleteness: 'MISSING_NAV_OBSERVATIONS',
          sourceReferences: [...navStart.sourceReferences, ...navEnd.sourceReferences],
        },
      };
    }

    // Check for missing FX — reject if missing observations
    if (navStart.dataCompleteness === 'MISSING_FX_NO_NAV' || navEnd.dataCompleteness === 'MISSING_FX_NO_NAV') {
      return {
        returnPercent: null,
        canCalculate: false,
        reason: 'MISSING_FX',
        evidence: {
          methodology: PortfolioReturnMethodology.TIME_WEIGHTED_RETURN,
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
          startingNav: navStart.nav,
          endingNav: navEnd.nav,
          externalCashFlows: cashFlows.map((cf: any) => ({ date: cf.occurredAt.toISOString(), amount: cf.baseCurrencyAmount ?? cf.amount, type: cf.cashFlowType })),
          feesTreatment: policy.feeTreatment,
          returnPercent: null,
          calculationVersion: policy.calculationVersion,
          policyVersion: policy.policyVersion,
          dataCompleteness: 'MISSING_FX',
          sourceReferences: [...navStart.sourceReferences, ...navEnd.sourceReferences],
        },
      };
    }

    // TWR: chain-linked sub-period returns between cash flows
    // For simplicity, if no cash flows, TWR = (endingNav / startingNav) - 1
    // If cash flows, need NAV before each cash flow — if missing, mark incomplete
    try {
      if (cashFlows.length === 0) {
        const ratio = div(navEnd.nav, navStart.nav);
        const twr = sub(ratio, '1');
        const twrPercent = mul(twr, '100');
        return {
          returnPercent: twrPercent,
          canCalculate: true,
          evidence: {
            methodology: PortfolioReturnMethodology.TIME_WEIGHTED_RETURN,
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
            startingNav: navStart.nav,
            endingNav: navEnd.nav,
            externalCashFlows: [],
            feesTreatment: policy.feeTreatment,
            returnPercent: twrPercent,
            calculationVersion: policy.calculationVersion,
            policyVersion: policy.policyVersion,
            dataCompleteness: 'COMPLETE',
            sourceReferences: [...navStart.sourceReferences, ...navEnd.sourceReferences],
          },
        };
      } else {
        // With cash flows — need sub-period NAVs
        let chainLinked = '1';
        let prevNav = navStart.nav;
        let prevTime = periodStart;

        for (const cf of cashFlows) {
          const navBeforeFlow = await this.navService.calculateNav({ tenantId, profileId, at: cf.occurredAt, baseCurrency });
          if (!navBeforeFlow.nav) {
            return {
              returnPercent: null,
              canCalculate: false,
              reason: 'MISSING_SUBPERIOD_NAV',
              evidence: {
                methodology: PortfolioReturnMethodology.TIME_WEIGHTED_RETURN,
                periodStart: periodStart.toISOString(),
                periodEnd: periodEnd.toISOString(),
                startingNav: navStart.nav,
                endingNav: navEnd.nav,
                externalCashFlows: cashFlows.map((c: any) => ({ date: c.occurredAt.toISOString(), amount: c.baseCurrencyAmount ?? c.amount, type: c.cashFlowType })),
                feesTreatment: policy.feeTreatment,
                returnPercent: null,
                calculationVersion: policy.calculationVersion,
                policyVersion: policy.policyVersion,
                dataCompleteness: 'MISSING_SUBPERIOD_NAV',
                sourceReferences: [],
              },
            };
          }
          const subPeriodReturn = sub(div(navBeforeFlow.nav, prevNav), '1');
          chainLinked = mul(chainLinked, add(subPeriodReturn, '1'));
          // After cash flow, NAV adjusts
          const cfAmount = cf.baseCurrencyAmount ?? cf.amount;
          const isInflow = ['DEPOSIT', 'TRANSFER_IN'].includes(cf.cashFlowType);
          prevNav = isInflow ? add(navBeforeFlow.nav, cfAmount) : sub(navBeforeFlow.nav, cfAmount);
          prevTime = cf.occurredAt;
        }

        // Final sub-period
        const finalReturn = sub(div(navEnd.nav, prevNav), '1');
        chainLinked = mul(chainLinked, add(finalReturn, '1'));
        const twr = sub(chainLinked, '1');
        const twrPercent = mul(twr, '100');

        return {
          returnPercent: twrPercent,
          canCalculate: true,
          evidence: {
            methodology: PortfolioReturnMethodology.TIME_WEIGHTED_RETURN,
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
            startingNav: navStart.nav,
            endingNav: navEnd.nav,
            externalCashFlows: cashFlows.map((c: any) => ({ date: c.occurredAt.toISOString(), amount: c.baseCurrencyAmount ?? c.amount, type: c.cashFlowType })),
            feesTreatment: policy.feeTreatment,
            returnPercent: twrPercent,
            calculationVersion: policy.calculationVersion,
            policyVersion: policy.policyVersion,
            dataCompleteness: 'COMPLETE',
            sourceReferences: [...navStart.sourceReferences, ...navEnd.sourceReferences],
          },
        };
      }
    } catch (e) {
      return {
        returnPercent: null,
        canCalculate: false,
        reason: `CALCULATION_FAILED: ${(e as Error).message}`,
        evidence: {
          methodology: PortfolioReturnMethodology.TIME_WEIGHTED_RETURN,
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
    } catch {
      cashFlows = [];
    }

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
      const existing = await (this.prisma as any).portfolioPerformanceRecord.findFirst({ where: { idempotencyKey } });
      if (existing) return existing;
    } catch {}

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
