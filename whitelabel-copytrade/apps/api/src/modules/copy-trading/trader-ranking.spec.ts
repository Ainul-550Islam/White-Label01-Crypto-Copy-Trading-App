// # Responsibility: verifies exact 7D/30D/90D window ranking, tenant-scoped source selection, and unranked missing/gapped history.

import { describe, expect, it, jest } from '@jest/globals';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PerformanceCalculationService } from './performance-calculation.service';
import { TraderPerformanceService } from './trader-performance.service';
import { TraderRankingService } from './trader-ranking.service';

const TENANT_ID = '11111111-2222-4333-8444-555555555555';
const TRADER_A = '22222222-3333-4444-8555-666666666666';
const TRADER_B = '33333333-4444-4555-8666-777777777777';
const AS_OF = new Date('2026-10-01T00:00:00.000Z');
const WINDOW_START = new Date(AS_OF.getTime() - 7 * 24 * 60 * 60 * 1000);

function traderRecord(id: string, name: string, userId: string) {
  return {
    id,
    tenantId: TENANT_ID,
    userId,
    displayName: name,
    verificationState: 'VERIFIED',
    isPublic: true,
    isFeatured: false,
    followerCount: 0,
  };
}

function periodRecord(params: {
  id: string;
  profileId: string;
  periodStart: Date;
  periodEnd: Date;
  returnPercent: string;
  flowBoundary?: string | null;
}) {
  return {
    id: params.id,
    profileId: params.profileId,
    periodId: `period-${params.id}`,
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    returnPercent: params.returnPercent,
    baseCurrency: 'USD',
    methodology: 'TIME_WEIGHTED_RETURN',
    calculationVersion: 'accounting-close-v3',
    dataCompleteness: 'COMPLETE',
    sourceReferences: [`portfolio-period:${params.id}`],
    evidence: { flowBoundary: params.flowBoundary === undefined ? 'START_FLOWS_IN_OPENING_NAV_END_FLOWS_EXCLUDED_FROM_CLOSING_NAV' : params.flowBoundary },
    period: {
      id: `period-${params.id}`,
      tenantId: TENANT_ID,
      profileId: params.profileId,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      calculationVersion: 'accounting-close-v3',
      state: 'CLOSED',
      closes: [{ validationPassed: true, reconciliationStatus: 'OK', calculationVersion: 'accounting-close-v3' }],
    },
  };
}

function buildHarness(params: { traders?: ReturnType<typeof traderRecord>[]; profiles?: Array<{ id: string; scopeId: string; baseCurrency: string; returnMethodology: string; calculationVersion: string }>; records?: ReturnType<typeof periodRecord>[]; asOf?: Date | null }) {
  const traders = params.traders ?? [
    traderRecord(TRADER_A, 'Trader A', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    traderRecord(TRADER_B, 'Trader B', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  ];
  const profiles = params.profiles ?? [
    { id: 'profile-a', scopeId: TRADER_A, baseCurrency: 'USD', returnMethodology: 'TIME_WEIGHTED_RETURN', calculationVersion: 'accounting-close-v3' },
    { id: 'profile-b', scopeId: TRADER_B, baseCurrency: 'USD', returnMethodology: 'TIME_WEIGHTED_RETURN', calculationVersion: 'accounting-close-v3' },
  ];
  const records = params.records ?? [];
  const prismaMock = {
    traderProfile: {
      findMany: jest.fn<() => Promise<unknown>>().mockResolvedValue(traders),
      count: jest.fn<() => Promise<unknown>>().mockResolvedValue(traders.length),
    },
    portfolioAccountingProfile: {
      findMany: jest.fn<() => Promise<unknown>>().mockResolvedValue(profiles),
    },
    portfolioPerformanceRecord: {
      findFirst: jest.fn<() => Promise<unknown>>().mockResolvedValue(params.asOf === null ? null : { periodEnd: params.asOf ?? AS_OF }),
      findMany: jest.fn<() => Promise<unknown>>().mockResolvedValue(records),
    },
  };
  const performanceMock = {
    getBatchPerformance: jest.fn<() => Promise<Record<string, never>>>().mockResolvedValue({}),
  };
  const service = new TraderRankingService(
    prismaMock as unknown as PrismaService,
    performanceMock as unknown as TraderPerformanceService,
    new PerformanceCalculationService(),
  );
  return { service, prismaMock, performanceMock };
}

describe('TraderRankingService exact timeframe ranking', () => {
  it('compounds verified closed-period TWR exactly and explains the 7D window', async () => {
    const split = new Date('2026-09-27T00:00:00.000Z');
    const resultRecords = [
      periodRecord({ id: 'a1', profileId: 'profile-a', periodStart: WINDOW_START, periodEnd: split, returnPercent: '10' }),
      periodRecord({ id: 'a2', profileId: 'profile-a', periodStart: split, periodEnd: AS_OF, returnPercent: '-10' }),
      periodRecord({ id: 'b1', profileId: 'profile-b', periodStart: WINDOW_START, periodEnd: split, returnPercent: '0.25' }),
      periodRecord({ id: 'b2', profileId: 'profile-b', periodStart: split, periodEnd: AS_OF, returnPercent: '0.25' }),
    ];
    const { service, prismaMock } = buildHarness({ records: resultRecords });

    const result = await service.getRanking(TENANT_ID, { timeframe: '7D', page: 1, limit: 10 });

    expect(result.data.map((row) => row.traderId)).toEqual([TRADER_B, TRADER_A]);
    expect(result.data[0]).toMatchObject({
      rank: 1,
      periodStatus: 'AVAILABLE',
      periodReturnPercent: '0.500625',
      timeframe: '7D',
      flowBoundary: 'START_FLOWS_IN_OPENING_NAV_END_FLOWS_EXCLUDED_FROM_CLOSING_NAV',
      sourceCalculationVersion: 'accounting-close-v3',
      observationCount: 2,
    });
    expect(result.data[1]).toMatchObject({ rank: 2, periodStatus: 'AVAILABLE', periodReturnPercent: '-1', timeframe: '7D' });
    expect(result.methodology).toMatchObject({
      status: 'AVAILABLE',
      key: 'RECONCILED_CLOSED_PERIOD_TWR',
      windowStart: WINDOW_START.toISOString(),
      asOf: AS_OF.toISOString(),
      boundaryRule: 'EXACT_CONTIGUOUS_PERIODS_ONLY',
      currentnessRule: 'AS_OF_DISPLAYED_CURRENTNESS_NOT_ASSERTED',
      minimumPeriodCount: 2,
      rankedCount: 2,
      unrankedCount: 0,
    });
    expect(prismaMock.portfolioPerformanceRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: TENANT_ID,
        methodology: 'TIME_WEIGHTED_RETURN',
        dataCompleteness: 'COMPLETE',
        period: { is: { tenantId: TENANT_ID, profileId: { in: ['profile-a', 'profile-b'] }, state: 'CLOSED', closes: { some: { tenantId: TENANT_ID, validationPassed: true, reconciliationStatus: 'OK' } } } },
      }),
    }));
  });

  it('fails closed when flow-boundary provenance or the active profile calculation version is missing', async () => {
    const split = new Date('2026-09-27T00:00:00.000Z');
    const missingBoundary = [
      periodRecord({ id: 'a1', profileId: 'profile-a', periodStart: WINDOW_START, periodEnd: split, returnPercent: '1', flowBoundary: null }),
      periodRecord({ id: 'a2', profileId: 'profile-a', periodStart: split, periodEnd: AS_OF, returnPercent: '1' }),
    ];
    const boundaryHarness = buildHarness({ records: missingBoundary });
    const boundaryResult = await boundaryHarness.service.getRanking(TENANT_ID, { timeframe: '7D' });
    const boundaryTrader = boundaryResult.data.find((row) => row.traderId === TRADER_A);
    expect(boundaryTrader).toMatchObject({ rank: null, periodStatus: 'UNAVAILABLE', flowBoundary: null });
    expect(boundaryTrader?.unavailableReason).toMatch(/flow-boundary evidence/i);

    const mismatchedProfiles = [
      { id: 'profile-a', scopeId: TRADER_A, baseCurrency: 'USD', returnMethodology: 'TIME_WEIGHTED_RETURN', calculationVersion: 'accounting-close-v4' },
      { id: 'profile-b', scopeId: TRADER_B, baseCurrency: 'USD', returnMethodology: 'TIME_WEIGHTED_RETURN', calculationVersion: 'accounting-close-v3' },
    ];
    const versionHarness = buildHarness({ profiles: mismatchedProfiles, records: missingBoundary.map((row) => ({
      ...row,
      evidence: { flowBoundary: 'START_FLOWS_IN_OPENING_NAV_END_FLOWS_EXCLUDED_FROM_CLOSING_NAV' },
    })) });
    const versionResult = await versionHarness.service.getRanking(TENANT_ID, { timeframe: '7D' });
    const versionTrader = versionResult.data.find((row) => row.traderId === TRADER_A);
    expect(versionTrader).toMatchObject({ rank: null, periodStatus: 'UNAVAILABLE', sourceCalculationVersion: null });
    expect(versionTrader?.unavailableReason).toMatch(/active accounting profile calculation version/i);
  });

  it('leaves missing or gapped histories unranked instead of filling the window', async () => {
    const missingStart = new Date(WINDOW_START.getTime() + 60 * 60 * 1000);
    const split = new Date('2026-09-27T00:00:00.000Z');
    const records = [
      periodRecord({ id: 'a1', profileId: 'profile-a', periodStart: missingStart, periodEnd: split, returnPercent: '5' }),
      periodRecord({ id: 'a2', profileId: 'profile-a', periodStart: split, periodEnd: AS_OF, returnPercent: '5' }),
      periodRecord({ id: 'b1', profileId: 'profile-b', periodStart: WINDOW_START, periodEnd: split, returnPercent: '1' }),
      periodRecord({ id: 'b2', profileId: 'profile-b', periodStart: new Date('2026-09-27T01:00:00.000Z'), periodEnd: AS_OF, returnPercent: '1' }),
    ];
    const { service } = buildHarness({ records });

    const result = await service.getRanking(TENANT_ID, { timeframe: '7D' });

    expect(result.methodology.status).toBe('UNAVAILABLE');
    expect(result.data.every((row) => row.rank === null && row.periodReturnPercent === null)).toBe(true);
    expect(result.data[0]?.unavailableReason).toMatch(/exact requested window boundary/);
    expect(result.data[1]?.unavailableReason).toMatch(/gap or overlap/);
  });

  it('does not rank a trader from a single closed accounting period', async () => {
    const records = [
      periodRecord({ id: 'single', profileId: 'profile-a', periodStart: WINDOW_START, periodEnd: AS_OF, returnPercent: '99' }),
    ];
    const { service } = buildHarness({ records });

    const result = await service.getRanking(TENANT_ID, { timeframe: '7D' });

    const traderA = result.data.find((row) => row.traderId === TRADER_A);
    expect(traderA).toMatchObject({ rank: null, periodStatus: 'UNAVAILABLE', periodReturnPercent: null });
    expect(traderA?.unavailableReason).toMatch(/at least 2/i);
    expect(result.methodology.rankedCount).toBe(0);
    expect(result.methodology.unrankedCount).toBe(2);
  });

  it('does not rank when the active profile methodology is not time-weighted return', async () => {
    const traders = [traderRecord(TRADER_A, 'Trader A', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')];
    const profiles = [{ id: 'profile-a', scopeId: TRADER_A, baseCurrency: 'USD', returnMethodology: 'MONEY_WEIGHTED_RETURN', calculationVersion: 'accounting-close-v3' }];
    const { service } = buildHarness({ traders, profiles, records: [] });

    const result = await service.getRanking(TENANT_ID, { timeframe: '30D' });

    expect(result.data[0]).toMatchObject({ rank: null, periodStatus: 'UNAVAILABLE' });
    expect(result.data[0]?.unavailableReason).toMatch(/does not use time-weighted return/i);
  });

  it('does not rank on another tenant or ambiguous trader accounting profiles', async () => {
    const traders = [traderRecord(TRADER_A, 'Trader A', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')];
    const profiles = [
      { id: 'profile-a', scopeId: TRADER_A, baseCurrency: 'USD', returnMethodology: 'TIME_WEIGHTED_RETURN', calculationVersion: 'accounting-close-v3' },
      { id: 'profile-a-user', scopeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', baseCurrency: 'USD', returnMethodology: 'TIME_WEIGHTED_RETURN', calculationVersion: 'accounting-close-v3' }
    ];
    const { service, prismaMock } = buildHarness({ traders, profiles, records: [], asOf: null });

    const result = await service.getRanking(TENANT_ID, { timeframe: '30D' });

    expect(result.data[0]).toMatchObject({ rank: null, periodStatus: 'UNAVAILABLE' });
    expect(result.data[0]?.unavailableReason).toMatch(/Multiple active trader-scoped accounting profiles/);
    expect(prismaMock.portfolioAccountingProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: TENANT_ID, scope: 'TRADER', isActive: true }),
    }));
    expect(result.methodology.timeframe).toBe('30D');
  });
});
