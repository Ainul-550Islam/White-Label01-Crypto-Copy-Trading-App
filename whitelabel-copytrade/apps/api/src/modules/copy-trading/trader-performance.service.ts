// # Responsibility: publishes only persisted, reconciled, closed-period TWR evidence through PerformanceCalculationService; every fill-derived metric stays null.
// # Safety: a return is published only when a single active trader-scoped accounting profile defines an unambiguous basis, and every period in the window proves closure, reconciliation, and flow boundary.

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TraderPerformance } from './copy-trading.types';
import {
  LINKED_PERIOD_CALCULATION_VERSION,
  PerformanceCalculationResult,
  PerformanceCalculationService,
  toPerformancePeriodEvidence,
} from './performance-calculation.service';

/**
 * Publishes trader performance.
 *
 * This service has exactly one evidence source: persisted `PortfolioPerformanceRecord` rows that
 * belong to a closed and reconciled accounting period. There is no fill-derived fallback, because a
 * fill-derived number looks like a return while being an accounting artefact: it ignores deposits
 * and withdrawals, so a deposit inflates it and a withdrawal deflates it. Every field that cannot be
 * sourced from reconciled closed periods is published as `null` rather than as a zero.
 *
 * The arithmetic itself lives in `PerformanceCalculationService`; this service resolves the trader,
 * selects the single active accounting profile that establishes the return basis, and maps persisted
 * evidence into the canonical input. It never computes a return of its own.
 */
@Injectable()
export class TraderPerformanceService {
  private readonly logger = new Logger(TraderPerformanceService.name);

  /**
   * Names the fact that `asOf` is the timestamp of the newest persisted period, not a claim that the
   * displayed figure is current. A record can be the newest row in the table and still be weeks old,
   * so the reader is told which of the two things the timestamp is.
   */
  static readonly CURRENTNESS_RULE = 'AS_OF_DISPLAYED_CURRENTNESS_NOT_ASSERTED';

  /** The only source this service reads. Published verbatim so a consumer never has to infer it. */
  static readonly SOURCE = 'RECONCILED_CLOSED_PERIOD_RECORDS';

  /**
   * One more than the engine's maximum window, so an over-long window is *detected* by the engine
   * and fails closed instead of being silently truncated to the newest N periods.
   */
  private static readonly MAX_PERIOD_READ = 501;

  constructor(
    private readonly prisma: PrismaService,
    private readonly calculationService: PerformanceCalculationService,
  ) {}

  async getPerformance(tenantId: string, traderId: string): Promise<TraderPerformance | null> {
    const trader = await this.prisma.traderProfile.findFirst({
      where: { id: traderId, tenantId, deletedAt: null },
      select: { id: true, userId: true },
    });
    // Cross-tenant and unknown traders are indistinguishable to the caller: both are "no such trader".
    if (!trader) return null;
    const userId = trader.userId;

    try {
      const profiles = await this.prisma.portfolioAccountingProfile.findMany({
        where: { tenantId, scope: 'TRADER', scopeId: { in: [traderId, userId] }, isActive: true },
        select: { id: true, baseCurrency: true, returnMethodology: true, calculationVersion: true },
      });

      // Profiles can be scoped to the trader profile id or to the owning user id. Two active profiles
      // are not merged and not picked between: they are two different return bases, and choosing one
      // would silently decide which basis the published number means.
      if (profiles.length === 0) {
        return this.unavailable(
          traderId,
          tenantId,
          0,
          'No active trader-scoped accounting profile establishes a verified return basis for this trader.',
        );
      }
      if (profiles.length > 1) {
        return this.unavailable(
          traderId,
          tenantId,
          0,
          'Multiple active trader-scoped accounting profiles establish conflicting return bases; they are never merged.',
        );
      }

      const profile = profiles[0];
      if (profile.returnMethodology !== 'TIME_WEIGHTED_RETURN') {
        return this.unavailable(
          traderId,
          tenantId,
          0,
          'The active trader accounting profile does not use time-weighted return, so a deposit-independent return cannot be published.',
        );
      }

      const rows = await this.prisma.portfolioPerformanceRecord.findMany({
        where: {
          tenantId,
          profileId: profile.id,
          periodId: { not: null },
          methodology: 'TIME_WEIGHTED_RETURN',
          dataCompleteness: 'COMPLETE',
          period: {
            is: {
              tenantId,
              profileId: profile.id,
              state: 'CLOSED',
              closes: { some: { tenantId, validationPassed: true, reconciliationStatus: 'OK' } },
            },
          },
        },
        orderBy: [{ periodStart: 'asc' }, { periodEnd: 'asc' }, { id: 'asc' }],
        take: TraderPerformanceService.MAX_PERIOD_READ,
        select: {
          periodId: true,
          periodStart: true,
          periodEnd: true,
          returnPercent: true,
          baseCurrency: true,
          methodology: true,
          calculationVersion: true,
          dataCompleteness: true,
          sourceReferences: true,
          evidence: true,
          period: {
            select: {
              tenantId: true,
              profileId: true,
              state: true,
              calculationVersion: true,
              closes: {
                select: { validationPassed: true, reconciliationStatus: true, calculationVersion: true },
              },
            },
          },
        },
      });

      // The display timestamp is read separately from the calculation window, so a window that was
      // capped or filtered can never be presented as if it reached the newest record.
      const latest = await this.prisma.portfolioPerformanceRecord.findFirst({
        where: { tenantId, profileId: profile.id },
        orderBy: [{ periodEnd: 'desc' }, { id: 'asc' }],
        select: { periodEnd: true },
      });
      const asOf = latest?.periodEnd ? new Date(latest.periodEnd).toISOString() : null;

      const result = this.calculationService.calculatePeriods(
        rows.map((row) => toPerformancePeriodEvidence(row, tenantId, profile.id)),
        {
          expectedBaseCurrency: profile.baseCurrency,
          expectedCalculationVersion: profile.calculationVersion,
        },
      );

      return this.present(traderId, tenantId, result, asOf);
    } catch (error) {
      // A read failure is not an empty portfolio. It stays UNAVAILABLE with every figure null.
      this.logger.warn(
        `Failed to read reconciled accounting-period evidence tenant=${tenantId} trader=${traderId} error=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.unavailable(
        traderId,
        tenantId,
        0,
        'Persisted reconciled accounting-period evidence could not be read.',
      );
    }
  }

  async getBatchPerformance(tenantId: string, traderIds: string[]): Promise<Record<string, TraderPerformance>> {
    const result: Record<string, TraderPerformance> = {};
    for (const traderId of traderIds) {
      const performance = await this.getPerformance(tenantId, traderId);
      if (performance) result[traderId] = performance;
    }
    return result;
  }

  /**
   * Projects an engine result onto the published shape.
   *
   * A figure is copied only when the engine proved the window COMPLETE. `flowBoundary` follows the
   * same rule rather than being echoed from the engine's constant: on an unavailable result no
   * boundary was ever established for a published window, and printing the rule name would imply a
   * verification that did not happen.
   */
  private present(
    traderId: string,
    tenantId: string,
    result: PerformanceCalculationResult,
    asOf: string | null,
  ): TraderPerformance {
    const complete = result.dataCompleteness === 'COMPLETE';
    const historyLengthDays =
      complete && result.periodStart && result.periodEnd
        ? Math.max(0, Math.floor((Date.parse(result.periodEnd) - Date.parse(result.periodStart)) / 86_400_000))
        : 0;

    return {
      traderId,
      tenantId,
      // Fill-derived figures. No fills were consulted for this number, so none of them are published.
      realizedPnl: null,
      unrealizedPnl: null,
      totalReturn: null,
      maxDrawdown: null,
      winCount: null,
      lossCount: null,
      tradeCount: null,
      winRate: null,
      lossRate: null,
      totalVolume: null,
      averageTrade: null,
      averageWin: null,
      averageLoss: null,
      profitFactor: null,
      sharpeRatio: null,
      lastTradeAt: null,
      historyLengthDays,
      // Reconciled closed-period figures.
      totalReturnPercent: result.returnPercent,
      maxDrawdownPercent: result.maxDrawdownPercent,
      isActual: complete,
      source: TraderPerformanceService.SOURCE,
      methodology: result.methodology,
      flowBoundary: complete ? result.flowBoundary : null,
      dataCompleteness: result.dataCompleteness,
      calculationVersion: result.calculationVersion ?? LINKED_PERIOD_CALCULATION_VERSION,
      sourceCalculationVersion: result.sourceCalculationVersion,
      baseCurrency: result.baseCurrency,
      sourceReferences: result.sourceReferences,
      observationCount: result.observationCount,
      currentnessRule: TraderPerformanceService.CURRENTNESS_RULE,
      asOf,
      unavailableReason: result.unavailableReason,
    };
  }

  /**
   * The published shape for a window that was not proven. Every figure is null, never zero: a zero
   * return and an unproven return are different facts, and only one of them is true here.
   */
  private unavailable(
    traderId: string,
    tenantId: string,
    observationCount: number,
    unavailableReason: string,
  ): TraderPerformance {
    return {
      traderId,
      tenantId,
      realizedPnl: null,
      unrealizedPnl: null,
      totalReturn: null,
      totalReturnPercent: null,
      maxDrawdown: null,
      maxDrawdownPercent: null,
      winCount: null,
      lossCount: null,
      tradeCount: null,
      winRate: null,
      lossRate: null,
      totalVolume: null,
      averageTrade: null,
      averageWin: null,
      averageLoss: null,
      profitFactor: null,
      sharpeRatio: null,
      historyLengthDays: 0,
      lastTradeAt: null,
      isActual: false,
      source: TraderPerformanceService.SOURCE,
      methodology: 'TIME_WEIGHTED_RETURN',
      flowBoundary: null,
      dataCompleteness: 'UNAVAILABLE',
      calculationVersion: LINKED_PERIOD_CALCULATION_VERSION,
      sourceCalculationVersion: null,
      baseCurrency: null,
      sourceReferences: [],
      observationCount,
      currentnessRule: TraderPerformanceService.CURRENTNESS_RULE,
      asOf: null,
      unavailableReason,
    };
  }
}
