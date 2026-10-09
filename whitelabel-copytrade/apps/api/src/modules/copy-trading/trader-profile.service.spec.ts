// # Responsibility: verifies tenant-scoped follower counts, exact fill-volume provenance, bounded sampling, and explicit unavailable AUM/source failures.
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PlanLimitTradersGuard } from '../billing/enforcement/plan-limit-traders.guard';
import { TraderVerificationState } from './copy-trading.types';
import { TraderProfileService } from './trader-profile.service';
import { TraderPerformanceService } from './trader-performance.service';
import { TraderRiskScoreService } from '../risk/trader-risk-score.service';

describe('TraderProfileService public metrics', () => {
  const tenantId = 'tenant-a';
  const traderId = 'trader-a';
  const userId = 'user-a';
  const createdAt = new Date('2026-10-05T09:00:00.000Z');

  function makeService(options?: {
    profile?: Record<string, unknown> | null;
    followerRows?: Array<{ followerId: string }>;
    fillRows?: Array<{
      createdAt: Date;
      quantity: string;
      price: string;
      quoteQuantity: string | null;
      order: { symbolRef: { quoteAsset: string } };
    }>;
    followerReadFails?: boolean;
    fillReadFails?: boolean;
    performance?: Record<string, unknown> | null;
    performanceReadFails?: boolean;
  }) {
    const profileRow = options?.profile === undefined
      ? {
          id: traderId,
          tenantId,
          userId,
          displayName: 'Verified Trader',
          bio: null,
          avatarUrl: null,
          verificationState: TraderVerificationState.VERIFIED,
          verifiedAt: createdAt,
          supportedVenues: ['BINANCE'],
          supportedSymbols: ['BTC-USDT'],
          riskProfile: {},
          isPublic: true,
          isFeatured: false,
          followerCount: 999,
          totalVolume: '999999999',
          totalTrades: 9999,
          createdAt,
          updatedAt: createdAt,
          deletedAt: null,
        }
      : options.profile;
    const findProfile = jest.fn().mockResolvedValue(profileRow);
    const findFollowers = options?.followerReadFails
      ? jest.fn().mockRejectedValue(new Error('database unavailable'))
      : jest.fn().mockResolvedValue(options?.followerRows ?? [{ followerId: 'follower-1' }, { followerId: 'follower-2' }]);
    const findFills = options?.fillReadFails
      ? jest.fn().mockRejectedValue(new Error('database unavailable'))
      : jest.fn().mockResolvedValue(options?.fillRows ?? []);
    const prisma = {
      traderProfile: { findFirst: findProfile },
      copySubscription: { findMany: findFollowers },
      fill: { findMany: findFills },
    } as unknown as PrismaService;
    const guard = {
      reserve: jest.fn(),
      release: jest.fn(),
    } as unknown as PlanLimitTradersGuard;
    const getPerformance = options?.performanceReadFails
      ? jest.fn().mockRejectedValue(new Error('performance store unavailable'))
      : jest.fn().mockResolvedValue(options?.performance ?? null);
    const performanceService = { getPerformance } as unknown as TraderPerformanceService;
    const service = new TraderProfileService(
      prisma,
      guard,
      performanceService,
      new TraderRiskScoreService(),
      { append: jest.fn() } as never,
    );
    return { service, findProfile, findFollowers, findFills, getPerformance };
  }

  it('derives active followers and quote-asset activity from tenant-scoped non-simulated fills with exact decimals', async () => {
    const { service, findProfile, findFollowers, findFills } = makeService({
      fillRows: [
        {
          createdAt: new Date('2026-10-04T12:00:00.000Z'),
          quantity: '1.5',
          price: '2',
          quoteQuantity: '3.000000000001',
          order: { symbolRef: { quoteAsset: 'USDT' } },
        },
        {
          createdAt: new Date('2026-10-05T08:00:00.000Z'),
          quantity: '2',
          price: '0.000000000003',
          quoteQuantity: null,
          order: { symbolRef: { quoteAsset: 'USDT' } },
        },
        {
          createdAt: new Date('2026-10-05T07:00:00.000Z'),
          quantity: '1',
          price: '5',
          quoteQuantity: '5',
          order: { symbolRef: { quoteAsset: 'BTC' } },
        },
      ],
    });

    const result = await service.getSafePublicStatistics(tenantId, traderId);

    expect(findProfile).toHaveBeenCalledWith({ where: { id: traderId, tenantId, deletedAt: null } });
    expect(findFollowers).toHaveBeenCalledWith({
      where: { tenantId, traderId, state: 'ACTIVE' },
      select: { followerId: true },
      distinct: ['followerId'],
    });
    expect(findFills).toHaveBeenCalledWith({
      where: {
        isSimulated: false,
        source: { not: 'SIMULATOR' },
        order: { tenantId, isSimulated: false, account: { tenantId, userId } },
      },
      orderBy: { createdAt: 'desc' },
      take: 501,
      select: {
        createdAt: true,
        quantity: true,
        price: true,
        quoteQuantity: true,
        order: { select: { symbolRef: { select: { quoteAsset: true } } } },
      },
    });
    expect(result).not.toBeNull();
    expect(result?.activeFollowers).toMatchObject({
      status: 'AVAILABLE',
      value: 2,
      source: 'ACTIVE_COPY_SUBSCRIPTIONS',
    });
    expect(result?.activeFollowers.asOf).toEqual(expect.any(String));
    expect(result?.aum).toEqual({
      status: 'UNAVAILABLE',
      value: null,
      currency: null,
      source: null,
      asOf: null,
      reason: 'NO_AUTHORITATIVE_FOLLOWER_PORTFOLIO_VALUATION',
    });
    expect(result?.activity).toMatchObject({
      status: 'AVAILABLE',
      source: 'NON_SIMULATED_CANONICAL_FILL_RECORDS',
      latestRecordedFillAt: '2026-10-05T08:00:00.000Z',
      sampledFillCount: 3,
      sampleLimit: 500,
      hasMore: false,
      calculationMethod: 'MIXED',
      volumeByQuoteAsset: [
        { asset: 'BTC', amount: '5' },
        { asset: 'USDT', amount: '3.000000000007' },
      ],
      reason: null,
    });
    expect(result?.activity.asOf).toEqual(expect.any(String));
  });

  it('keeps AUM and activity unavailable when canonical fill reads fail without falling back to stored zero or stale counters', async () => {
    const { service } = makeService({ fillReadFails: true });

    const result = await service.getSafePublicStatistics(tenantId, traderId);

    expect(result?.activeFollowers).toMatchObject({ status: 'AVAILABLE', value: 2 });
    expect(result?.aum.value).toBeNull();
    expect(result?.activity).toMatchObject({
      status: 'UNAVAILABLE',
      source: null,
      sampledFillCount: null,
      volumeByQuoteAsset: [],
      reason: 'SOURCE_READ_FAILED',
    });
  });

  it('returns unavailable provenance rather than a fabricated active-follower count when subscription reads fail', async () => {
    const { service } = makeService({ followerReadFails: true, fillRows: [] });

    const result = await service.getSafePublicStatistics(tenantId, traderId);

    expect(result?.activeFollowers).toMatchObject({
      status: 'UNAVAILABLE',
      value: null,
      source: null,
      asOf: null,
      reason: 'SOURCE_READ_FAILED',
    });
    expect(result?.activity).toMatchObject({
      status: 'AVAILABLE',
      sampledFillCount: 0,
      hasMore: false,
      volumeByQuoteAsset: [],
      calculationMethod: 'NONE',
    });
  });

  it('integrates only fresh canonical TWR drawdown into the public risk score and labels all other factors unavailable', async () => {
    const { service, getPerformance } = makeService({
      performance: {
        traderId,
        tenantId,
        isActual: true,
        source: 'RECONCILED_CLOSED_PERIOD_RECORDS',
        methodology: 'TIME_WEIGHTED_RETURN',
        flowBoundary: 'START_FLOWS_IN_OPENING_NAV_END_FLOWS_EXCLUDED_FROM_CLOSING_NAV',
        dataCompleteness: 'COMPLETE',
        maxDrawdownPercent: '5',
        asOf: new Date().toISOString(),
        sourceReferences: ['accounting-period:closed-1', 'accounting-period:closed-2'],
      },
    });

    const result = await service.getSafePublicStatistics(tenantId, traderId);

    expect(getPerformance).toHaveBeenCalledWith(tenantId, traderId);
    expect(result?.riskScore).toMatchObject({
      status: 'PARTIAL',
      score: 5,
      band: 'LOW',
      confidence: 'PARTIAL',
      methodology: 'risk-score-v1',
    });
    expect(result?.riskScore.factors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'maxDrawdownPercent',
        value: '5',
        score: 5,
        status: 'MEASURED',
        source: 'RECONCILED_CLOSED_PERIOD_RECORDS',
      }),
      expect.objectContaining({ key: 'leverage', value: null, score: null, status: 'MISSING' }),
      expect.objectContaining({ key: 'concentrationPercent', value: null, score: null, status: 'MISSING' }),
      expect.objectContaining({ key: 'lossStreak', value: null, score: null, status: 'MISSING' }),
    ]));
  });

  it('keeps trader risk score unavailable when the canonical performance read is unavailable or belongs to another tenant', async () => {
    const foreignPerformance = {
      traderId,
      tenantId: 'tenant-b',
      isActual: true,
      source: 'RECONCILED_CLOSED_PERIOD_RECORDS',
      methodology: 'TIME_WEIGHTED_RETURN',
      flowBoundary: 'START_FLOWS_IN_OPENING_NAV_END_FLOWS_EXCLUDED_FROM_CLOSING_NAV',
      dataCompleteness: 'COMPLETE',
      maxDrawdownPercent: '1',
      asOf: new Date().toISOString(),
      sourceReferences: ['foreign-period:1'],
    };
    const foreign = await makeService({ performance: foreignPerformance }).service.getSafePublicStatistics(tenantId, traderId);
    expect(foreign?.riskScore).toMatchObject({ status: 'UNAVAILABLE', score: null, band: 'UNAVAILABLE', confidence: 'UNAVAILABLE' });

    const failed = await makeService({ performanceReadFails: true }).service.getSafePublicStatistics(tenantId, traderId);
    expect(failed?.riskScore).toMatchObject({ status: 'UNAVAILABLE', score: null, band: 'UNAVAILABLE', confidence: 'UNAVAILABLE' });
  });

  it('rejects a supplied profile from a different tenant or trader before querying public metrics', async () => {
    const { service, findFollowers, findFills, getPerformance } = makeService();
    const foreignProfile = {
      traderId: 'trader-b',
      tenantId: 'tenant-b',
      userId: 'user-b',
      displayName: 'Foreign Trader',
      bio: null,
      avatarUrl: null,
      verificationState: TraderVerificationState.VERIFIED,
      verifiedAt: null,
      supportedVenues: [],
      supportedSymbols: [],
      riskProfile: {},
      isPublic: true,
      isFeatured: false,
      followerCount: 0,
      totalVolume: '0',
      totalTrades: 0,
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
    };

    const result = await service.getSafePublicStatistics(tenantId, traderId, foreignProfile);

    expect(result).toBeNull();
    expect(findFollowers).not.toHaveBeenCalled();
    expect(findFills).not.toHaveBeenCalled();
    expect(getPerformance).not.toHaveBeenCalled();
  });

  it('commits trader verification and its typed outbox event in the same tenant transaction', async () => {
    const row = {
      id: traderId,
      tenantId,
      userId,
      displayName: 'Trader',
      bio: null,
      avatarUrl: null,
      verificationState: TraderVerificationState.PENDING,
      verifiedAt: null,
      supportedVenues: [],
      supportedSymbols: [],
      riskProfile: {},
      isPublic: true,
      isFeatured: false,
      followerCount: 0,
      totalVolume: '0',
      totalTrades: 0,
      createdAt,
      updatedAt: createdAt,
    };
    const tx = {
      traderProfile: {
        findFirst: jest.fn()
          .mockResolvedValueOnce({ ...row })
          .mockResolvedValueOnce({ ...row, verificationState: TraderVerificationState.VERIFIED, verifiedAt: createdAt }),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const prisma = {
      withTenantRls: jest.fn(async (_scope: string, work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    } as unknown as PrismaService;
    const append = jest.fn(async () => ({ id: 'outbox-trader-verified' }));
    const service = new TraderProfileService(
      prisma,
      {} as never,
      { getPerformance: jest.fn() } as never,
      new TraderRiskScoreService(),
      { append } as never,
    );

    const verified = await service.verifyTrader(tenantId, traderId, 'verifier-1');

    expect(verified?.verificationState).toBe(TraderVerificationState.VERIFIED);
    expect(prisma.withTenantRls).toHaveBeenCalledTimes(1);
    expect(tx.traderProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: traderId, tenantId, verificationState: TraderVerificationState.PENDING },
        data: expect.objectContaining({ verificationState: TraderVerificationState.VERIFIED }),
      }),
    );
    expect(append).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        tenantId,
        eventType: 'trader.verified',
        payload: expect.objectContaining({ traderId, verificationState: 'VERIFIED' }),
      }),
    );
  });
});
