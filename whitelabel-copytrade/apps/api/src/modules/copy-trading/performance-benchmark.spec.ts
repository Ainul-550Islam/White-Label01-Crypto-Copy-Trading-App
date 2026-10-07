// # Responsibility: verifies tenant-scoped benchmark series require closed reconciled periods, contiguous returns, and benchmark-source references.

import { PerformanceCalculationService } from './performance-calculation.service';
import { PerformanceBenchmarkService } from './performance-benchmark.service';

const TENANT_ID = 'tenant-1';
const TRADER_ID = 'trader-1';
const USER_ID = 'user-1';
const PROFILE_ID = 'profile-1';
const START = new Date('2025-01-01T00:00:00.000Z');
const MID = new Date('2025-01-02T00:00:00.000Z');
const NEXT = new Date('2025-01-03T00:00:00.000Z');

const profile = {
  id: PROFILE_ID,
  baseCurrency: 'USD',
  returnMethodology: 'TIME_WEIGHTED_RETURN',
  calculationVersion: 'accounting-close-v3',
};

function record(overrides: Record<string, unknown> = {}) {
  const periodStart = overrides.periodStart instanceof Date ? overrides.periodStart : START;
  const periodEnd = overrides.periodEnd instanceof Date ? overrides.periodEnd : MID;
  const periodId = typeof overrides.periodId === 'string' ? overrides.periodId : 'period-1';
  const rowTenantId = typeof overrides.tenantId === 'string' ? overrides.tenantId : TENANT_ID;
  const rowProfileId = typeof overrides.profileId === 'string' ? overrides.profileId : PROFILE_ID;
  const period = overrides.period && typeof overrides.period === 'object'
    ? overrides.period
    : {
        id: periodId,
        tenantId: rowTenantId,
        profileId: rowProfileId,
        periodStart,
        periodEnd,
        calculationVersion: 'accounting-close-v3',
        state: 'CLOSED',
        closes: [{ validationPassed: true, reconciliationStatus: 'OK', calculationVersion: 'accounting-close-v3' }],
      };
  return {
    id: `record-${periodId}`,
    tenantId: rowTenantId,
    profileId: rowProfileId,
    periodId,
    periodStart,
    periodEnd,
    returnPercent: '10',
    benchmarkReturn: '5',
    baseCurrency: 'USD',
    methodology: 'TIME_WEIGHTED_RETURN',
    calculationVersion: 'accounting-close-v3',
    dataCompleteness: 'COMPLETE',
    evidence: {
      flowBoundary: 'START_FLOWS_IN_OPENING_NAV_END_FLOWS_EXCLUDED_FROM_CLOSING_NAV',
      benchmarkKey: 'BTC-USDT',
      benchmarkSourceReferences: ['MARKET_DATA:BINANCE:1d'],
    },
    sourceReferences: [`closed-period:${periodId}`],
    ...overrides,
    period,
  };
}

function build(rows: unknown[], options: {
  traderExists?: boolean;
  accountingProfiles?: unknown[];
} = {}) {
  const prisma = {
    traderProfile: {
      findFirst: jest.fn(async () => options.traderExists === false ? null : { id: TRADER_ID, userId: USER_ID }),
    },
    portfolioAccountingProfile: {
      findMany: jest.fn(async () => options.accountingProfiles ?? [profile]),
    },
    portfolioPerformanceRecord: {
      findMany: jest.fn(async () => rows),
    },
  };
  return { service: new PerformanceBenchmarkService(prisma as never, new PerformanceCalculationService()), prisma };
}

describe('PerformanceBenchmarkService', () => {
  it('compounds only identified, source-referenced, closed periods with exact decimals and an explicit as-of boundary', async () => {
    const { service, prisma } = build([
      record(),
      record({
        id: 'record-period-2',
        periodId: 'period-2',
        periodStart: MID,
        periodEnd: NEXT,
        returnPercent: '-5',
        benchmarkReturn: '10',
        evidence: {
          flowBoundary: 'START_FLOWS_IN_OPENING_NAV_END_FLOWS_EXCLUDED_FROM_CLOSING_NAV',
          benchmarkKey: 'BTC-USDT',
          benchmarkSourceReferences: ['MARKET_DATA:BYBIT:1d'],
        },
        sourceReferences: ['closed-period:period-2'],
      }),
    ]);

    const result = await service.getTraderBenchmarkSeries(TENANT_ID, TRADER_ID);
    expect(prisma.traderProfile.findFirst).toHaveBeenCalledWith({
      where: { id: TRADER_ID, tenantId: TENANT_ID, deletedAt: null },
      select: { id: true, userId: true },
    });
    expect(prisma.portfolioAccountingProfile.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, scope: 'TRADER', scopeId: { in: [TRADER_ID, USER_ID] }, isActive: true },
      select: { id: true, baseCurrency: true, returnMethodology: true, calculationVersion: true },
    });
    expect(prisma.portfolioPerformanceRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: TENANT_ID,
        profileId: PROFILE_ID,
        methodology: 'TIME_WEIGHTED_RETURN',
        benchmarkReturn: { not: null },
        period: { is: { tenantId: TENANT_ID, profileId: PROFILE_ID, state: 'CLOSED', closes: { some: { tenantId: TENANT_ID, validationPassed: true, reconciliationStatus: 'OK' } } } },
      }),
      take: 501,
    }));
    expect(result).toMatchObject({
      status: 'AVAILABLE',
      benchmarkKey: 'BTC-USDT',
      baseCurrency: 'USD',
      methodology: 'TIME_WEIGHTED_RETURN',
      flowBoundary: 'START_FLOWS_IN_OPENING_NAV_END_FLOWS_EXCLUDED_FROM_CLOSING_NAV',
      calculationVersion: 'accounting-close-v3',
      dataCompleteness: 'COMPLETE',
      asOf: NEXT.toISOString(),
      currentnessRule: 'AS_OF_DISPLAYED_CURRENTNESS_NOT_ASSERTED',
    });
    expect(result.observations[0]).toMatchObject({ traderCumulativeReturnPercent: '10', benchmarkCumulativeReturnPercent: '5' });
    expect(result.observations[1]).toMatchObject({ traderCumulativeReturnPercent: '4.5', benchmarkCumulativeReturnPercent: '15.5' });
    expect(result.sourceReferences).toEqual([
      'closed-period:period-1', 'MARKET_DATA:BINANCE:1d', 'closed-period:period-2', 'MARKET_DATA:BYBIT:1d',
    ]);
  });

  it('does not claim availability without an identified benchmark and source evidence or an unambiguous profile', async () => {
    const unidentified = build([record({ evidence: {} })]);
    await expect(unidentified.service.getTraderBenchmarkSeries(TENANT_ID, TRADER_ID)).resolves.toMatchObject({
      status: 'UNAVAILABLE',
      dataCompleteness: 'UNAVAILABLE',
      observations: [],
    });

    const missingReferences = build([
      record(),
      record({ periodId: 'period-2', periodStart: MID, periodEnd: NEXT, evidence: { benchmarkKey: 'BTC-USDT' } }),
    ]);
    await expect(missingReferences.service.getTraderBenchmarkSeries(TENANT_ID, TRADER_ID)).resolves.toMatchObject({
      status: 'UNAVAILABLE',
      reason: expect.stringMatching(/source references/i),
    });

    const missingProfile = build([], { accountingProfiles: [] });
    await expect(missingProfile.service.getTraderBenchmarkSeries(TENANT_ID, TRADER_ID)).resolves.toMatchObject({ status: 'UNAVAILABLE' });
    const ambiguousProfile = build([], { accountingProfiles: [profile, { ...profile, id: 'profile-2' }] });
    await expect(ambiguousProfile.service.getTraderBenchmarkSeries(TENANT_ID, TRADER_ID)).resolves.toMatchObject({ status: 'UNAVAILABLE', reason: expect.stringMatching(/ambiguous/i) });
    const hiddenTrader = build([], { traderExists: false });
    await expect(hiddenTrader.service.getTraderBenchmarkSeries(TENANT_ID, TRADER_ID)).resolves.toMatchObject({ status: 'UNAVAILABLE' });
  });

  it('fails closed when period flow-boundary evidence or the active profile version does not match', async () => {
    const missingBoundary = build([
      record({ evidence: { benchmarkKey: 'BTC-USDT', benchmarkSourceReferences: ['MARKET_DATA:BINANCE:1d'] } }),
      record({
        periodId: 'period-2',
        periodStart: MID,
        periodEnd: NEXT,
        evidence: { benchmarkKey: 'BTC-USDT', benchmarkSourceReferences: ['MARKET_DATA:BINANCE:1d'] },
      }),
    ]);
    await expect(missingBoundary.service.getTraderBenchmarkSeries(TENANT_ID, TRADER_ID)).resolves.toMatchObject({
      status: 'UNAVAILABLE',
      dataCompleteness: 'UNAVAILABLE',
      observations: [],
    });

    const mismatchedProfile = build([record(), record({ periodId: 'period-2', periodStart: MID, periodEnd: NEXT })], {
      accountingProfiles: [{ ...profile, calculationVersion: 'accounting-close-v4' }],
    });
    await expect(mismatchedProfile.service.getTraderBenchmarkSeries(TENANT_ID, TRADER_ID)).resolves.toMatchObject({
      status: 'UNAVAILABLE',
      reason: expect.stringMatching(/currency, version, return, or source-reference validation/i),
    });
  });

  it('requires an explicit key when multiple complete benchmark series are present', async () => {
    const rows = [
      record(),
      record({ periodId: 'period-btc-2', periodStart: MID, periodEnd: NEXT }),
      record({ periodId: 'period-eth-1', evidence: { flowBoundary: 'START_FLOWS_IN_OPENING_NAV_END_FLOWS_EXCLUDED_FROM_CLOSING_NAV', benchmarkKey: 'ETH-USDT', benchmarkSourceReferences: ['INDEX:ETH:1d'] } }),
      record({ periodId: 'period-eth-2', periodStart: MID, periodEnd: NEXT, evidence: { flowBoundary: 'START_FLOWS_IN_OPENING_NAV_END_FLOWS_EXCLUDED_FROM_CLOSING_NAV', benchmarkKey: 'ETH-USDT', benchmarkSourceReferences: ['INDEX:ETH:1d'] } }),
    ];
    const { service } = build(rows);
    await expect(service.getTraderBenchmarkSeries(TENANT_ID, TRADER_ID)).resolves.toMatchObject({
      status: 'UNAVAILABLE',
      reason: expect.stringMatching(/select a benchmark key/i),
    });
    await expect(service.getTraderBenchmarkSeries(TENANT_ID, TRADER_ID, 'ETH-USDT')).resolves.toMatchObject({
      status: 'AVAILABLE',
      benchmarkKey: 'ETH-USDT',
      dataCompleteness: 'COMPLETE',
      observations: expect.arrayContaining([expect.objectContaining({ periodStart: START.toISOString() })]),
    });
  });

  it('fails closed on a partial period, a gap, an overlap, or invalid period linkage', async () => {
    const partial = build([
      record(),
      record({ periodId: 'period-2', periodStart: MID, periodEnd: NEXT, dataCompleteness: 'PARTIAL' }),
    ]);
    await expect(partial.service.getTraderBenchmarkSeries(TENANT_ID, TRADER_ID)).resolves.toMatchObject({
      status: 'UNAVAILABLE',
      dataCompleteness: 'UNAVAILABLE',
      observations: [],
    });

    const gap = build([
      record(),
      record({ periodId: 'period-2', periodStart: new Date('2025-01-02T01:00:00.000Z'), periodEnd: NEXT }),
    ]);
    await expect(gap.service.getTraderBenchmarkSeries(TENANT_ID, TRADER_ID)).resolves.toMatchObject({
      status: 'UNAVAILABLE',
      reason: expect.stringMatching(/gap or overlap/i),
    });

    const wrongRelation = build([
      record({
        period: {
          id: 'period-1',
          tenantId: TENANT_ID,
          profileId: 'foreign-profile',
          periodStart: START,
          periodEnd: MID,
          state: 'CLOSED',
          closes: [{ validationPassed: true, reconciliationStatus: 'OK' }],
        },
      }),
      record({ periodId: 'period-2', periodStart: MID, periodEnd: NEXT }),
    ]);
    await expect(wrongRelation.service.getTraderBenchmarkSeries(TENANT_ID, TRADER_ID)).resolves.toMatchObject({
      status: 'UNAVAILABLE',
      reason: expect.stringMatching(/does not match/i),
    });
  });
});
