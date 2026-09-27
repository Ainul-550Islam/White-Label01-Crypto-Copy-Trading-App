import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TraderPerformanceService } from './trader-performance.service';
import { TraderRanking, TraderVerificationState } from './copy-trading.types';

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
  ) {}

  async getRanking(tenantId: string, filters?: { verificationState?: TraderVerificationState; isFeatured?: boolean; search?: string; page?: number; limit?: number; sortBy?: string }): Promise<{ data: TraderRanking[]; total: number }> {
    const page = filters?.page || 1;
    const limit = Math.min(filters?.limit || 20, 100);
    const skip = (page - 1) * limit;

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
    const performances = await this.performanceService.getBatchPerformance(tenantId, traderIds);

    const rankings: TraderRanking[] = traders.map((trader: any) => {
      const perf = performances[trader.id] || null;

      // Calculate measurable scores - each must be explainable
      const metrics = this.calculateMetrics(trader, perf);
      const score = this.calculateScore(metrics, this.defaultWeights);

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
        rank: 0, // Will be assigned after sorting
        metrics,
        weighting: this.defaultWeights,
      };
    });

    // Sort by score descending if requested, else by follower count
    if (filters?.sortBy === 'score') {
      rankings.sort((a, b) => b.score - a.score);
    } else if (filters?.sortBy === 'performance') {
      rankings.sort((a, b) => {
        const aPnl = parseFloat(a.performance?.realizedPnl || '0');
        const bPnl = parseFloat(b.performance?.realizedPnl || '0');
        return bPnl - aPnl;
      });
    } else {
      rankings.sort((a, b) => b.followerCount - a.followerCount);
    }

    // Assign rank
    rankings.forEach((r, idx) => (r.rank = skip + idx + 1));

    return { data: rankings, total };
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
