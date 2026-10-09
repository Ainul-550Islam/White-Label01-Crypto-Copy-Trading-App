import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { PlanLimitTradersGuard } from '../billing/enforcement/plan-limit-traders.guard';
import { TraderVerificationState, TraderProfile } from './copy-trading.types';
import { Decimal, DecimalError, dec, isDecimalString } from '../../common/decimal-string';
import { TraderPerformanceService } from './trader-performance.service';
import { TraderRiskScoreService, TraderRiskFactorInput } from '../risk/trader-risk-score.service';
import { TWR_FLOW_BOUNDARY_RULE } from '../portfolio-accounting/portfolio-accounting.types';
import {
  TraderActivityMetric,
  TraderActiveFollowersMetric,
  TraderAumMetric,
  TraderRiskScoreView,
  TraderSafePublicStatistics,
} from './copy-trading.types';
import { randomUUID } from 'crypto';
import { isRecordNotFound } from '../../common/errors/prisma-not-found';

/**
 * Trader profile and public marketplace metadata: display profile, supported venues, risk profile, verified state, performance references, followers, and safe public statistics.
 * Performance must come from canonical trading data. Never accept client-provided profit/ROI/drawdown/win rate as authoritative.
 */
@Injectable()
export class TraderProfileService {
  private readonly logger = new Logger(TraderProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    // The maxTraders plan limit. Required, like the follower and
    // copy-subscription guards in FollowerSubscriptionService: a wiring
    // mistake must fail at boot, never silently switch the limit off.
    // EnforcementModule exports it; BillingModule re-exports EnforcementModule.
    private readonly tradersGuard: PlanLimitTradersGuard,
    // The canonical performance read. Injected rather than recomputed so the figures a public
    // profile publishes are the same ones the performance page shows, and so the TIME_WEIGHTED_RETURN
    // provenance that qualifies them travels with them.
    private readonly performanceService: TraderPerformanceService,
    // The explainable risk score. This service was implemented, unit-tested and referenced by no
    // production code at all; the public profile is where its output belongs, because a score whose
    // factors and confidence are published cannot be mistaken for a rating.
    private readonly riskScoreService: TraderRiskScoreService,
    private readonly outbox: OutboxService,
  ) {}

  async createProfile(input: { tenantId: string; userId: string; displayName: string; bio?: string | null; avatarUrl?: string | null; supportedVenues?: string[]; supportedSymbols?: string[]; riskProfile?: Record<string, any>; isPublic?: boolean }): Promise<TraderProfile> {
    // Tenant ownership validation - user must belong to tenant
    const user = await this.prisma.user.findFirst({ where: { id: input.userId, tenantId: input.tenantId } });
    if (!user) throw new Error(`User ${input.userId} not found for tenant ${input.tenantId}`);

    // Prevent duplicate profile
    const existing = await (this.prisma as any).traderProfile?.findFirst({ where: { userId: input.userId, tenantId: input.tenantId } });
    if (existing) throw new Error(`Trader profile already exists for user ${input.userId}`);

    const id = randomUUID();
    const now = new Date();

    const data = {
      id,
      tenantId: input.tenantId,
      userId: input.userId,
      displayName: input.displayName,
      bio: input.bio || null,
      avatarUrl: input.avatarUrl || null,
      verificationState: TraderVerificationState.UNVERIFIED,
      supportedVenues: input.supportedVenues || [],
      supportedSymbols: input.supportedSymbols || [],
      riskProfile: input.riskProfile || {},
      isPublic: input.isPublic || false,
      isFeatured: false,
      followerCount: 0,
      totalVolume: '0',
      totalTrades: 0,
      createdAt: now,
      updatedAt: now,
    };

    // Reserve a maxTraders slot before persisting (throws PlanLimitExceededError
    // when the plan is full) and give it back if the insert fails, the same
    // reserve/release contract the follower and exchange-account paths use.
    const actor = { tenantId: input.tenantId, userId: input.userId, roles: [], ipHash: '', requestId: '', correlationId: '' };
    await this.tradersGuard.reserve(actor);
    let created: any;
    try {
      created = await (this.prisma as any).traderProfile.create({ data });
    } catch (error) {
      await this.tradersGuard.release(actor);
      throw error;
    }
    this.logger.log(`Trader profile created id=${created.id} tenant=${input.tenantId} user=${input.userId}`);

    return this.mapToProfile(created);
  }

  async getProfile(tenantId: string, traderId: string): Promise<TraderProfile | null> {
    const profile = await (this.prisma as any).traderProfile?.findFirst({ where: { id: traderId, tenantId, deletedAt: null } });
    return profile ? this.mapToProfile(profile) : null;
  }

  async getProfileByUserId(tenantId: string, userId: string): Promise<TraderProfile | null> {
    const profile = await (this.prisma as any).traderProfile?.findFirst({ where: { userId, tenantId, deletedAt: null } });
    return profile ? this.mapToProfile(profile) : null;
  }

  async listPublicProfiles(tenantId: string, filters?: { isFeatured?: boolean; verificationState?: TraderVerificationState; search?: string; page?: number; limit?: number }): Promise<{ data: TraderProfile[]; total: number }> {
    const page = filters?.page || 1;
    const limit = Math.min(filters?.limit || 20, 100);
    const skip = (page - 1) * limit;

    const where: any = {
      tenantId,
      isPublic: true,
      deletedAt: null,
      ...(filters?.isFeatured !== undefined ? { isFeatured: filters.isFeatured } : {}),
      ...(filters?.verificationState ? { verificationState: filters.verificationState } : {}),
      ...(filters?.search ? { displayName: { contains: filters.search, mode: 'insensitive' } } : {}),
    };

    const [rows, total] = await Promise.all([
      (this.prisma as any).traderProfile?.findMany({ where, orderBy: { followerCount: 'desc' }, skip, take: limit }) || [],
      (this.prisma as any).traderProfile?.count({ where }) || 0,
    ]);

    return { data: rows.map((r: any) => this.mapToProfile(r)), total };
  }

  async listByTenant(tenantId: string, filters?: { userId?: string; verificationState?: TraderVerificationState; page?: number; limit?: number }): Promise<{ data: TraderProfile[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;
    const where: any = { tenantId, deletedAt: null, ...(filters?.userId ? { userId: filters.userId } : {}), ...(filters?.verificationState ? { verificationState: filters.verificationState } : {}) };
    const [rows, total] = await Promise.all([
      (this.prisma as any).traderProfile?.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }) || [],
      (this.prisma as any).traderProfile?.count({ where }) || 0,
    ]);
    return { data: rows.map((r: any) => this.mapToProfile(r)), total };
  }

  async updateProfile(tenantId: string, traderId: string, updates: { displayName?: string; bio?: string | null; avatarUrl?: string | null; supportedVenues?: string[]; supportedSymbols?: string[]; riskProfile?: Record<string, any>; isPublic?: boolean }): Promise<TraderProfile | null> {
    try {
      const updated = await (this.prisma as any).traderProfile.update({
        where: { id: traderId },
        data: { ...updates, updatedAt: new Date() },
      });
      if (updated.tenantId !== tenantId) return null;
      return this.mapToProfile(updated);
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  async verifyTrader(tenantId: string, traderId: string, verifierId: string): Promise<TraderProfile | null> {
    const verifiedAt = new Date();
    const updated = await this.prisma.withTenantRls(tenantId, async (tx) => {
      const current = await tx.traderProfile.findFirst({
        where: { id: traderId, tenantId },
      });
      if (!current) return null;
      if (current.verificationState === TraderVerificationState.VERIFIED) return current;

      const transition = await tx.traderProfile.updateMany({
        where: { id: traderId, tenantId, verificationState: current.verificationState },
        data: {
          verificationState: TraderVerificationState.VERIFIED,
          verifiedAt,
          verifiedById: verifierId,
          updatedAt: verifiedAt,
        },
      });
      if (transition.count !== 1) return null;

      const verified = await tx.traderProfile.findFirst({ where: { id: traderId, tenantId } });
      if (!verified) throw new Error('verified trader row disappeared inside its transaction');
      await this.outbox.append(tx, {
        tenantId,
        aggregateType: 'trader.profile',
        aggregateId: traderId,
        eventType: 'trader.verified',
        idempotencyKey: `trader-profile:${traderId}:verified:${verifiedAt.getTime()}`,
        payload: {
          traderId,
          verifiedAt: verifiedAt.toISOString(),
          verificationState: TraderVerificationState.VERIFIED,
        },
      });
      return verified;
    });

    if (!updated) return null;
    this.logger.log(`Trader verified id=${traderId} tenant=${tenantId} by=${verifierId}`);
    return this.mapToProfile(updated);
  }

  async incrementFollowerCount(tenantId: string, traderId: string): Promise<void> {
    try {
      await (this.prisma as any).traderProfile.update({ where: { id: traderId }, data: { followerCount: { increment: 1 }, updatedAt: new Date() } });
    } catch {}
  }

  async decrementFollowerCount(tenantId: string, traderId: string): Promise<void> {
    try {
      await (this.prisma as any).traderProfile.update({ where: { id: traderId }, data: { followerCount: { decrement: 1 }, updatedAt: new Date() } });
    } catch {}
  }

  /**
   * The published statistics for a trader profile.
   *
   * Every figure is either measured from canonical records or reported as `UNAVAILABLE` with a
   * reason. Nothing here falls back to a stored counter when a read fails, and nothing is estimated:
   * a public profile is read by people deciding where to put money, so "we could not measure this"
   * and "this is zero" must never be the same answer.
   *
   * `suppliedProfile` lets a caller pass a profile it has already read. It is validated against the
   * tenant and trader being asked about, so a supplied record cannot redirect the query at another
   * tenant's trader.
   */
  async getSafePublicStatistics(
    tenantId: string,
    traderId: string,
    suppliedProfile?: TraderProfile | null,
  ): Promise<TraderSafePublicStatistics | null> {
    let profile: TraderProfile | null;
    if (suppliedProfile) {
      if (suppliedProfile.traderId !== traderId || suppliedProfile.tenantId !== tenantId) return null;
      profile = suppliedProfile;
    } else {
      profile = await this.getProfile(tenantId, traderId);
    }
    if (!profile) return null;

    const userId = profile.userId;
    const activeFollowers = await this.readActiveFollowers(tenantId, traderId);
    const activity = await this.readActivity(tenantId, userId);
    const riskScore = await this.readRiskScore(tenantId, traderId);

    return {
      traderId,
      activeFollowers,
      // Not measured, not estimated, not zero. There is no canonical valuation of follower
      // portfolios in this platform, so publishing an AUM would mean inventing one.
      aum: {
        status: 'UNAVAILABLE',
        value: null,
        currency: null,
        source: null,
        asOf: null,
        reason: 'NO_AUTHORITATIVE_FOLLOWER_PORTFOLIO_VALUATION',
      },
      activity,
      riskScore,
    };
  }

  /** Distinct active copy subscriptions, read from the canonical subscription table. */
  private async readActiveFollowers(tenantId: string, traderId: string): Promise<TraderActiveFollowersMetric> {
    try {
      const rows = await this.prisma.copySubscription.findMany({
        where: { tenantId, traderId, state: 'ACTIVE' },
        select: { followerId: true },
        distinct: ['followerId'],
      });
      return {
        status: 'AVAILABLE',
        value: rows.length,
        source: 'ACTIVE_COPY_SUBSCRIPTIONS',
        asOf: new Date().toISOString(),
        reason: null,
      };
    } catch (error) {
      // A failed read is not a follower count of zero. The stored `followerCount` column is
      // deliberately not used as a fallback: it is a denormalised counter, and a reader cannot tell
      // how fresh it is.
      this.logger.warn(
        `Active follower read failed for tenant ${tenantId} trader ${traderId} reason=${this.safeReason(error)}`,
      );
      return { status: 'UNAVAILABLE', value: null, source: null, asOf: null, reason: 'SOURCE_READ_FAILED' };
    }
  }

  /**
   * Recorded activity over the most recent fills, as exact decimal volume per quote asset.
   *
   * Only non-simulated fills from the trader's own tenant-scoped accounts count, so a paper or
   * rehearsed fill never inflates a published figure. One row beyond the sample limit is requested
   * so `hasMore` reports whether the sample is complete, rather than being assumed.
   */
  private async readActivity(tenantId: string, userId: string): Promise<TraderActivityMetric> {
    const sampleLimit = 500;
    try {
      const rows = await this.prisma.fill.findMany({
        where: {
          isSimulated: false,
          source: { not: 'SIMULATOR' },
          order: { tenantId, isSimulated: false, account: { tenantId, userId } },
        },
        orderBy: { createdAt: 'desc' },
        take: sampleLimit + 1,
        select: {
          createdAt: true,
          quantity: true,
          price: true,
          quoteQuantity: true,
          order: { select: { symbolRef: { select: { quoteAsset: true } } } },
        },
      });

      const hasMore = rows.length > sampleLimit;
      const sampled = hasMore ? rows.slice(0, sampleLimit) : rows;
      const volumes = new Map<string, ReturnType<typeof dec>>();
      let fromQuoteQuantity = 0;
      let fromPriceTimesQuantity = 0;

      for (const row of sampled) {
        const asset = (row as { order?: { symbolRef?: { quoteAsset?: string | null } | null } | null }).order
          ?.symbolRef?.quoteAsset;
        if (!asset) continue;

        const quoteQuantity = (row as { quoteQuantity?: unknown }).quoteQuantity;
        let amount: ReturnType<typeof dec>;
        if (quoteQuantity !== null && quoteQuantity !== undefined && String(quoteQuantity).trim() !== '') {
          // The venue's own quote quantity is preferred: it is what the venue actually charged,
          // whereas quantity x price recomputes it and can differ on a partial or a fee-adjusted fill.
          amount = Decimal.parse(String(quoteQuantity));
          fromQuoteQuantity += 1;
        } else {
          amount = Decimal.parse(String((row as { quantity: unknown }).quantity)).mul(
            String((row as { price: unknown }).price),
          );
          fromPriceTimesQuantity += 1;
        }
        volumes.set(asset, (volumes.get(asset) ?? dec('0')).add(amount));
      }

      const calculationMethod: TraderActivityMetric['calculationMethod'] =
        sampled.length === 0
          ? 'NONE'
          : fromQuoteQuantity > 0 && fromPriceTimesQuantity > 0
            ? 'MIXED'
            : fromQuoteQuantity > 0
              ? 'QUOTE_QUANTITY'
              : 'PRICE_TIMES_QUANTITY';

      return {
        status: 'AVAILABLE',
        source: 'NON_SIMULATED_CANONICAL_FILL_RECORDS',
        // The latest fill is derived from the sample rather than read off the first row. The query
        // asks for newest-first, but "the newest fill" is a property of the data, not of the sort
        // the database was asked to apply - and a caller that reorders or batches the rows would
        // otherwise be able to change a published figure.
        latestRecordedFillAt: this.latestTimestamp(sampled),
        sampledFillCount: sampled.length,
        sampleLimit,
        hasMore,
        calculationMethod,
        volumeByQuoteAsset: [...volumes.entries()]
          .map(([asset, amount]) => ({ asset, amount: amount.normalize().toString() }))
          .sort((left, right) => (left.asset < right.asset ? -1 : left.asset > right.asset ? 1 : 0)),
        asOf: new Date().toISOString(),
        reason: null,
      };
    } catch (error) {
      this.logger.warn(
        `Fill activity read failed for tenant ${tenantId} user ${userId} reason=${this.safeReason(error)}`,
      );
      return {
        status: 'UNAVAILABLE',
        source: null,
        latestRecordedFillAt: null,
        sampledFillCount: null,
        sampleLimit,
        hasMore: false,
        calculationMethod: 'NONE',
        volumeByQuoteAsset: [],
        asOf: new Date().toISOString(),
        reason: 'SOURCE_READ_FAILED',
      };
    }
  }

  /**
   * The explainable risk score.
   *
   * Only one factor is ever measured, and only from a return that is demonstrably a reconciled,
   * linked, time-weighted one: actual (not estimated), owned by this tenant, closed and complete,
   * carrying the recorded flow-boundary rule, and observed recently. Everything else is reported
   * MISSING by the scorer, which is why a score built from one factor publishes `PARTIAL` confidence
   * rather than a band implying a full picture.
   */
  private async readRiskScore(tenantId: string, traderId: string): Promise<TraderRiskScoreView> {
    let performance: Awaited<ReturnType<TraderPerformanceService['getPerformance']>> | null = null;
    try {
      performance = await this.performanceService.getPerformance(tenantId, traderId);
    } catch (error) {
      this.logger.warn(
        `Performance read failed for tenant ${tenantId} trader ${traderId} reason=${this.safeReason(error)}`,
      );
      performance = null;
    }

    const observedAt = this.observedAtOfRiskFactors(performance, tenantId);
    const factors: TraderRiskFactorInput[] = [
      {
        key: 'maxDrawdownPercent',
        value: observedAt ? (performance?.maxDrawdownPercent ?? null) : null,
        observedAt,
        source: observedAt ? (performance?.source ?? null) : null,
      },
      // No canonical source is published for these yet. They are declared MISSING rather than
      // omitted, so the published score shows which factors did and did not contribute.
      { key: 'leverage', value: null, observedAt: null, source: null },
      { key: 'concentrationPercent', value: null, observedAt: null, source: null },
      { key: 'lossStreak', value: null, observedAt: null, source: null },
    ];

    const result = this.riskScoreService.calculate(factors);
    return {
      status: result.band === 'UNAVAILABLE' ? 'UNAVAILABLE' : result.confidence === 'COMPLETE' ? 'AVAILABLE' : 'PARTIAL',
      score: result.score,
      band: result.band,
      confidence: result.confidence,
      methodology: result.methodology,
      asOf: result.asOf,
      factors: result.factors,
    };
  }

  /**
   * The observation time to attribute the drawdown factor to, or null when the record cannot be
   * trusted as return evidence. Null leaves the factor MISSING, which is the fail-closed direction:
   * an unproven drawdown must not lower or raise a published score.
   */
  private observedAtOfRiskFactors(
    performance: Awaited<ReturnType<TraderPerformanceService['getPerformance']>> | null,
    tenantId: string,
  ): string | null {
    if (!performance) return null;
    if (performance.tenantId !== tenantId) return null;
    if (!performance.isActual) return null;
    if (performance.methodology !== 'TIME_WEIGHTED_RETURN') return null;
    if (performance.flowBoundary !== TWR_FLOW_BOUNDARY_RULE) return null;
    if (performance.dataCompleteness !== 'COMPLETE') return null;
    if (!performance.maxDrawdownPercent || !isDecimalString(performance.maxDrawdownPercent)) return null;
    const asOf = performance.asOf;
    if (typeof asOf !== 'string' || asOf.length === 0) return null;
    return asOf;
  }

  private toIso(value: unknown): string {
    return value instanceof Date ? value.toISOString() : String(value);
  }

  /** The newest `createdAt` in the sample as an ISO string, or null when there is none usable. */
  private latestTimestamp(rows: readonly unknown[]): string | null {
    let latest: number | null = null;
    for (const row of rows) {
      const raw = (row as { createdAt?: unknown } | null)?.createdAt;
      const time = raw instanceof Date ? raw.getTime() : Date.parse(String(raw));
      if (!Number.isFinite(time)) continue;
      if (latest === null || time > latest) latest = time;
    }
    return latest === null ? null : new Date(latest).toISOString();
  }

  private safeReason(error: unknown): string {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code?: unknown }).code;
      if (typeof code === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(code)) return code;
    }
    return error instanceof Error && error.name ? error.name : 'UNKNOWN';
  }

  private mapToProfile(row: any): TraderProfile {
    return {
      traderId: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      displayName: row.displayName,
      bio: row.bio || null,
      avatarUrl: row.avatarUrl || null,
      verificationState: row.verificationState,
      verifiedAt: row.verifiedAt ? new Date(row.verifiedAt).toISOString() : null,
      supportedVenues: row.supportedVenues || [],
      supportedSymbols: row.supportedSymbols || [],
      riskProfile: row.riskProfile || {},
      isPublic: row.isPublic,
      isFeatured: row.isFeatured,
      followerCount: row.followerCount || 0,
      totalVolume: row.totalVolume?.toString() || '0',
      totalTrades: row.totalTrades || 0,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }
}
