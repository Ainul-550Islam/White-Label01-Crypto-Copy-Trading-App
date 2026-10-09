import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TraderPerformanceService } from './trader-performance.service';
import {
  MAX_VERIFIED_PERFORMANCE_PERIODS,
  PerformanceCalculationService,
  toPerformancePeriodEvidence,
} from './performance-calculation.service';
import {
  TraderRanking,
  TraderRankingMethodology,
  TraderRankingPage,
  TraderRankingPeriodStatus,
  TRADER_RANKING_WINDOW_DAYS,
  TraderRankingTimeframe,
  TraderVerificationState,
} from './copy-trading.types';

/**
 * Record limit for one ranking request: the engine's per-window maximum, times the number of
 * profiles being ranked, plus one per profile so an over-long window is detected by the engine
 * instead of being silently truncated to its newest periods.
 */
const RANKING_RECORD_LIMIT_PER_PROFILE = MAX_VERIFIED_PERFORMANCE_PERIODS + 1;

/** The window columns a ranking row carries. `unavailableReason` is present only when UNAVAILABLE. */
interface UnrankedWindowOutcome {
  periodStatus: TraderRankingPeriodStatus;
  periodReturnPercent: string | null;
  flowBoundary: string | null;
  sourceCalculationVersion: string | null;
  observationCount: number | null;
  unavailableReason?: string;
}

/**
 * Ranking/search/filtering using only measurable, configured metrics and traceable performance data. Must not use opaque scores without explainability.
 */
@Injectable()
export class TraderRankingService {
  private readonly logger = new Logger(TraderRankingService.name);

  // Configurable weights - must be traceable
  private readonly defaultWeights = {
    riskAdjustedReturn: 0.25,
    drawdownScore: 0.20,
    consistencyScore: 0.15,
    historyLengthScore: 0.15,
    followerScore: 0.10,
    activityScore: 0.10,
    verifiedScore: 0.05,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly performanceService: TraderPerformanceService,
    private readonly calculationService: PerformanceCalculationService,
  ) {}

  /**
   * Ranks traders over an exact window of reconciled closed accounting periods.
   *
   * The window return is the only figure the rank is computed from, and it is compounded by the
   * canonical engine from persisted evidence - never from a fill-derived PnL and never from a stored
   * counter. A trader whose history does not tile the requested window is returned unranked with the
   * reason, rather than being ranked over whatever slice of the window happens to exist: a 7-day
   * ranking computed from 3 days of returns is not a 7-day ranking.
   *
   * Every trader is resolved against their own accounting profile before any period is read, so a
   * trader with no profile, two profiles, or a non-time-weighted profile is excluded for a stated
   * reason instead of quietly falling back to a weaker basis.
   */
  async getRanking(
    tenantId: string,
    filters?: {
      verificationState?: TraderVerificationState;
      isFeatured?: boolean;
      search?: string;
      page?: number;
      limit?: number;
      sortBy?: string;
      timeframe?: TraderRankingTimeframe;
    },
  ): Promise<TraderRankingPage> {
    const page = filters?.page || 1;
    const limit = Math.min(filters?.limit || 20, 100);
    const skip = (page - 1) * limit;
    const timeframe: TraderRankingTimeframe = filters?.timeframe ?? '30D';
    const windowDays = TRADER_RANKING_WINDOW_DAYS[timeframe];
    const currentnessRule = TraderPerformanceService.CURRENTNESS_RULE;

    const where: any = {
      tenantId,
      isPublic: true,
      deletedAt: null,
      ...(filters?.verificationState ? { verificationState: filters.verificationState } : {}),
      ...(filters?.isFeatured !== undefined ? { isFeatured: filters.isFeatured } : {}),
      ...(filters?.search ? { displayName: { contains: filters.search, mode: 'insensitive' } } : {}),
    };

    const traders = await (this.prisma as any).traderProfile?.findMany({ where, orderBy: { followerCount: 'desc' }, skip, take: limit }) || [];
    const total = await (this.prisma as any).traderProfile?.count({ where }) || 0;

    const traderIds = traders.map((t: any) => t.id);

    // A trader's accounting profile is scoped either to the trader profile id or to the owning user
    // id, so both are resolved in one read and each trader is then matched against their own two.
    const scopeIds: string[] = [];
    for (const trader of traders) {
      for (const scopeId of [trader.id, trader.userId]) {
        if (typeof scopeId === 'string' && !scopeIds.includes(scopeId)) scopeIds.push(scopeId);
      }
    }

    const profiles = scopeIds.length === 0
      ? []
      : await this.prisma.portfolioAccountingProfile.findMany({
          where: { tenantId, scope: 'TRADER', isActive: true, scopeId: { in: scopeIds } },
          select: { id: true, scopeId: true, baseCurrency: true, returnMethodology: true, calculationVersion: true },
        });

    const profileIds: string[] = [];
    const outcomeByTrader = new Map<string, UnrankedWindowOutcome>();
    const profileByTrader = new Map<string, (typeof profiles)[number]>();

    for (const trader of traders) {
      const scopes = [trader.id, trader.userId].filter((scopeId: unknown): scopeId is string => typeof scopeId === 'string');
      const matches = profiles.filter((profile) => scopes.includes(profile.scopeId));

      if (matches.length === 0) {
        outcomeByTrader.set(trader.id, this.unranked('No active trader-scoped accounting profile establishes a verified return basis for this trader.'));
        continue;
      }
      if (matches.length > 1) {
        outcomeByTrader.set(trader.id, this.unranked('Multiple active trader-scoped accounting profiles establish conflicting return bases; they are never merged.'));
        continue;
      }

      const profile = matches[0];
      if (profile.returnMethodology !== 'TIME_WEIGHTED_RETURN') {
        outcomeByTrader.set(trader.id, this.unranked('The active trader accounting profile does not use time-weighted return, so a deposit-independent return cannot be ranked.'));
        continue;
      }

      profileByTrader.set(trader.id, profile);
      if (!profileIds.includes(profile.id)) profileIds.push(profile.id);
    }

    // The as-of instant is the newest persisted period end, read after profile resolution so a trader
    // excluded for profile reasons is excluded for that reason rather than for a missing window.
    const latest = profileIds.length === 0
      ? null
      : await this.prisma.portfolioPerformanceRecord.findFirst({
          where: { tenantId, profileId: { in: profileIds } },
          orderBy: [{ periodEnd: 'desc' }, { id: 'asc' }],
          select: { periodEnd: true },
        });
    const asOf = latest?.periodEnd ? new Date(latest.periodEnd) : null;
    const windowStart = asOf === null ? null : new Date(asOf.getTime() - windowDays * 24 * 60 * 60 * 1000);

    const records = asOf === null || profileIds.length === 0
      ? []
      : await this.prisma.portfolioPerformanceRecord.findMany({
          where: {
            tenantId,
            periodId: { not: null },
            methodology: 'TIME_WEIGHTED_RETURN',
            dataCompleteness: 'COMPLETE',
            period: {
              is: {
                tenantId,
                profileId: { in: profileIds },
                state: 'CLOSED',
                closes: { some: { tenantId, validationPassed: true, reconciliationStatus: 'OK' } },
              },
            },
          },
          orderBy: [{ periodStart: 'asc' }, { periodEnd: 'asc' }, { id: 'asc' }],
          take: RANKING_RECORD_LIMIT_PER_PROFILE * Math.max(1, profileIds.length),
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
            profileId: true,
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

    for (const trader of traders) {
      const profile = profileByTrader.get(trader.id);
      if (!profile) continue;
      if (asOf === null || windowStart === null) {
        outcomeByTrader.set(trader.id, this.unranked('No persisted accounting period establishes an as-of instant for this window.'));
        continue;
      }

      const rows = records.filter((record) => record.profileId === profile.id);
      const result = this.calculationService.calculatePeriods(
        rows.map((row) => toPerformancePeriodEvidence(row, tenantId, profile.id)),
        {
          expectedStart: windowStart,
          expectedEnd: asOf,
          expectedBaseCurrency: profile.baseCurrency,
          expectedCalculationVersion: profile.calculationVersion,
        },
      );

      if (result.dataCompleteness !== 'COMPLETE') {
        outcomeByTrader.set(trader.id, this.unranked(result.unavailableReason ?? 'The requested window is not fully covered by reconciled closed periods.'));
        continue;
      }

      outcomeByTrader.set(trader.id, {
        periodStatus: 'AVAILABLE',
        periodReturnPercent: result.returnPercent,
        // The engine names the rule even on a rejected window; here the window passed, so it is a fact.
        flowBoundary: result.flowBoundary,
        sourceCalculationVersion: result.sourceCalculationVersion,
        observationCount: result.observationCount,
      });
    }

    const performances = await this.performanceService.getBatchPerformance(tenantId, traderIds);

    const rankings: TraderRanking[] = traders.map((trader: any) => {
      const perf = performances[trader.id] || null;
      const metrics = this.calculateMetrics(trader, perf);
      const score = this.calculateScore(metrics, this.defaultWeights);
      const outcome = outcomeByTrader.get(trader.id) ?? this.unranked('The window outcome could not be determined.');

      return {
        traderId: trader.id,
        tenantId: trader.tenantId,
        displayName: trader.displayName,
        verificationState: trader.verificationState,
        isPublic: trader.isPublic,
        isFeatured: trader.isFeatured,
        followerCount: trader.followerCount || 0,
        performance: perf,
        score,
        rank: null,
        metrics,
        weighting: this.defaultWeights,
        timeframe,
        ...outcome,
      };
    });

    // Ranked traders first, ordered by the window return descending. Unranked traders keep the order
    // the filters returned them in: they are excluded from the ordering, not placed at the bottom of
    // a comparison their history does not qualify them to enter.
    const ranked = rankings
      .filter((row) => row.periodStatus === 'AVAILABLE' && row.periodReturnPercent !== null)
      .sort((left, right) => compareDecimalStrings(right.periodReturnPercent!, left.periodReturnPercent!)
        || left.traderId.localeCompare(right.traderId));
    ranked.forEach((row, index) => {
      row.rank = index + 1;
    });

    if (filters?.sortBy === 'score') {
      rankings.sort((a, b) => b.score - a.score);
    } else if (filters?.sortBy === 'followers') {
      rankings.sort((a, b) => b.followerCount - a.followerCount);
    } else {
      const rankedIds = new Set(ranked.map((row) => row.traderId));
      rankings.sort((left, right) => {
        const leftRanked = rankedIds.has(left.traderId);
        const rightRanked = rankedIds.has(right.traderId);
        if (leftRanked !== rightRanked) return leftRanked ? -1 : 1;
        if (leftRanked && rightRanked) return (left.rank ?? 0) - (right.rank ?? 0);
        return 0;
      });
    }

    const rankedCount = rankings.filter((row) => row.rank !== null).length;

    // The disclosure a reader needs is the union of the reasons the unranked rows carry. Distinct
    // because a hundred rows citing one cause is one explanation, and counted because a reader
    // looking at an unranked row should be told whether its cause is shared or particular to it.
    const unrankedReasons = Array.from(
      new Set(
        rankings
          .filter((row) => row.rank === null)
          .map((row) => row.unavailableReason)
          .filter((reason): reason is string => typeof reason === 'string' && reason.length > 0),
      ),
    );

    const methodology: TraderRankingMethodology = {
      status: rankedCount === 0 ? 'UNAVAILABLE' : 'AVAILABLE',
      key: 'RECONCILED_CLOSED_PERIOD_TWR',
      description: 'Compounded time-weighted return over exact contiguous closed, reconciled accounting periods. A trader with fewer than two qualifying periods is listed without a return rather than ranked over part of the window.',
      timeframe,
      windowStart: windowStart === null ? null : windowStart.toISOString(),
      asOf: asOf === null ? null : asOf.toISOString(),
      boundaryRule: 'EXACT_CONTIGUOUS_PERIODS_ONLY',
      orderingRule: 'RETURN_DESCENDING_UNAVAILABLE_LAST',
      currentnessRule,
      minimumPeriodCount: 2,
      rankedCount,
      unrankedCount: rankings.length - rankedCount,
      reason:
        unrankedReasons.length === 0
          ? null
          : unrankedReasons.length === 1
            ? unrankedReasons[0]
            : `${unrankedReasons.length} distinct reasons leave traders unranked over ${timeframe}; each affected row carries its own unavailableReason.`,
    };

    return { data: rankings, total, timeframe, methodology };
  }

  /** The published window outcome for a trader whose window was not proven. No figure is invented. */
  private unranked(unavailableReason: string): UnrankedWindowOutcome {
    return {
      periodStatus: 'UNAVAILABLE',
      periodReturnPercent: null,
      flowBoundary: null,
      sourceCalculationVersion: null,
      observationCount: null,
      unavailableReason,
    };
  }

  private calculateMetrics(trader: any, perf: any): TraderRanking['metrics'] {
    // Risk-adjusted return - measurable: realizedPnl / (maxDrawdown || 1)
    let riskAdjustedReturn: number | null = null;
    if (perf && perf.realizedPnl) {
      const pnl = parseFloat(perf.realizedPnl);
      const dd = perf.maxDrawdown ? parseFloat(perf.maxDrawdown) : 1;
      if (!isNaN(pnl) && dd > 0) {
        riskAdjustedReturn = pnl / dd;
      } else if (!isNaN(pnl)) {
        riskAdjustedReturn = pnl;
      }
    }

    // Drawdown score - lower drawdown = higher score, measurable
    let drawdownScore: number | null = null;
    if (perf && perf.maxDrawdown) {
      const dd = parseFloat(perf.maxDrawdown);
      if (!isNaN(dd)) {
        // Inverse: 0 drawdown = 100, 100% drawdown = 0
        drawdownScore = Math.max(0, 100 - dd);
      }
    } else if (perf && perf.tradeCount > 0) {
      drawdownScore = 80; // No drawdown recorded but trades exist
    }

    // Consistency score - win rate * trade count factor, measurable
    let consistencyScore: number | null = null;
    if (perf && perf.winRate) {
      const wr = parseFloat(perf.winRate);
      const countFactor = Math.min(1, (perf.tradeCount || 0) / 100); // Normalize by 100 trades
      if (!isNaN(wr)) consistencyScore = wr * 100 * (0.5 + 0.5 * countFactor);
    }

    // History length score - measurable days
    let historyLengthScore: number | null = null;
    if (perf && perf.historyLengthDays !== undefined) {
      historyLengthScore = Math.min(100, perf.historyLengthDays); // Cap at 100 days = 100 score
    }

    // Follower score - measurable follower count normalized
    let followerScore: number | null = null;
    if (trader.followerCount !== undefined) {
      followerScore = Math.min(100, trader.followerCount); // Cap at 100 followers = 100 score
    }

    // Activity score - recent trade activity measurable
    let activityScore: number | null = null;
    if (perf && perf.lastTradeAt) {
      const lastTrade = new Date(perf.lastTradeAt).getTime();
      const now = Date.now();
      const daysSince = (now - lastTrade) / (1000 * 60 * 60 * 24);
      activityScore = Math.max(0, 100 - daysSince * 2); // Decay 2 points per day
    }

    // Verified score - measurable verification state
    let verifiedScore: number | null = null;
    switch (trader.verificationState) {
      case 'VERIFIED':
        verifiedScore = 100;
        break;
      case 'PENDING':
        verifiedScore = 50;
        break;
      case 'UNVERIFIED':
        verifiedScore = 20;
        break;
      case 'REJECTED':
      case 'SUSPENDED':
        verifiedScore = 0;
        break;
      default:
        verifiedScore = 0;
    }

    return {
      riskAdjustedReturn,
      drawdownScore,
      consistencyScore,
      historyLengthScore,
      followerScore,
      activityScore,
      verifiedScore,
    };
  }

  private calculateScore(metrics: TraderRanking['metrics'], weights: Record<string, number>): number {
    let total = 0;
    let weightSum = 0;

    const entries: [keyof TraderRanking['metrics'], number][] = [
      ['riskAdjustedReturn', weights.riskAdjustedReturn],
      ['drawdownScore', weights.drawdownScore],
      ['consistencyScore', weights.consistencyScore],
      ['historyLengthScore', weights.historyLengthScore],
      ['followerScore', weights.followerScore],
      ['activityScore', weights.activityScore],
      ['verifiedScore', weights.verifiedScore],
    ];

    for (const [key, weight] of entries) {
      const value = metrics[key];
      if (value !== null && value !== undefined && !isNaN(value)) {
        total += value * weight;
        weightSum += weight;
      }
    }

    return weightSum > 0 ? total / weightSum : 0;
  }

  async getFeaturedTraders(tenantId: string, limit = 10): Promise<TraderRanking[]> {
    const { data } = await this.getRanking(tenantId, { isFeatured: true, limit, sortBy: 'score' });
    return data;
  }

  async searchTraders(tenantId: string, query: string, filters?: { verificationState?: TraderVerificationState; page?: number; limit?: number }): Promise<{ data: TraderRanking[]; total: number }> {
    return this.getRanking(tenantId, { ...filters, search: query, sortBy: 'score' });
  }
}

/**
 * Compares two exact decimal strings by value. `Number()` is not used: a return percentage is a
 * published figure, and comparing it through a float could order two values that differ in the
 * digits the float cannot hold.
 */
function compareDecimalStrings(left: string, right: string): number {
  const leftParts = /^(-?)(\d+)(?:\.(\d+))?$/.exec(left);
  const rightParts = /^(-?)(\d+)(?:\.(\d+))?$/.exec(right);
  if (!leftParts || !rightParts) return 0;

  const leftNegative = leftParts[1] === '-';
  const rightNegative = rightParts[1] === '-';
  if (leftNegative !== rightNegative) return leftNegative ? -1 : 1;

  const leftInt = leftParts[2].replace(/^0+(?=\d)/, '');
  const rightInt = rightParts[2].replace(/^0+(?=\d)/, '');
  if (leftInt.length !== rightInt.length) return leftNegative ? rightInt.length - leftInt.length : leftInt.length - rightInt.length;

  if (leftInt !== rightInt) {
    const comparison = leftInt < rightInt ? -1 : 1;
    return leftNegative ? -comparison : comparison;
  }

  const leftFraction = (leftParts[3] ?? '').replace(/0+$/, '');
  const rightFraction = (rightParts[3] ?? '').replace(/0+$/, '');
  const width = Math.max(leftFraction.length, rightFraction.length);
  const leftPadded = leftFraction.padEnd(width, '0');
  const rightPadded = rightFraction.padEnd(width, '0');
  if (leftPadded === rightPadded) return 0;
  const comparison = leftPadded < rightPadded ? -1 : 1;
  return leftNegative ? -comparison : comparison;
}
