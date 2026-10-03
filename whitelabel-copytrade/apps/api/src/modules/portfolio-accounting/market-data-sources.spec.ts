/**
 * Portfolio accounting reads the platform's real data sources.
 *
 * Prices and benchmarks come from MarketDataRecord candles, OMS fills from
 * OmsFill, and an operator's accounts from ACTIVE OPERATOR_TO_ACCOUNT
 * relationships. The services used to read delegates that do not exist
 * (`priceSnapshot`, `fillConfirmation`, a managed-account lookup) behind `?.`,
 * so every valuation was MISSING_PRICE, every benchmark empty, missing fills
 * were never detected and operators saw no profiles.
 */
import { AccountingReconciliationService } from './accounting-reconciliation.service';
import { BenchmarkService } from './benchmark.service';
import { InvestorVisibilityRole, InvestorVisibilityService } from './investor-visibility.service';
import { PortfolioValuationState } from './portfolio-accounting.types';
import { ValuationService } from './valuation.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const POLICY = {
  resolvePolicy: jest.fn(async () => ({
    baseCurrency: 'USD',
    calculationVersion: 'c1',
    policyVersion: 'p1',
  })),
};

const candle = (closeTime: string, close: string, venue = 'binance', interval = '1m') => ({
  closeTime: new Date(closeTime),
  close: { toString: () => close },
  venue,
  interval,
});

describe('ValuationService.getVerifiedMarketPrice', () => {
  function build(findFirst: jest.Mock) {
    return new ValuationService({ marketDataRecord: { findFirst } } as any, POLICY as any);
  }
  const at = new Date('2026-09-20T12:00:00Z');

  it('prices from the latest candle closed by the valuation instant (no look-ahead)', async () => {
    const findFirst = jest.fn(async () => candle('2026-09-20T11:59:00Z', '64123.5'));
    const result = await build(findFirst).getVerifiedMarketPrice({
      tenantId: TENANT,
      symbol: 'BTCUSDT',
      asset: 'BTC',
      at,
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { symbol: 'BTCUSDT', closeTime: { lte: at } },
      orderBy: { closeTime: 'desc' },
      select: { close: true, closeTime: true, venue: true, interval: true },
    });
    expect(result).toEqual({
      price: '64123.5',
      source: 'MARKET_DATA:binance:1m',
      timestamp: new Date('2026-09-20T11:59:00Z'),
      state: PortfolioValuationState.VALID,
    });
  });

  it('measures staleness against the valuation instant, not the wall clock', async () => {
    const fresh = await build(
      jest.fn(async () => candle('2026-09-20T11:56:00Z', '1')),
    ).getVerifiedMarketPrice({ tenantId: TENANT, symbol: 'X', asset: 'X', at });
    const stale = await build(
      jest.fn(async () => candle('2026-09-20T11:50:00Z', '1')),
    ).getVerifiedMarketPrice({ tenantId: TENANT, symbol: 'X', asset: 'X', at });
    expect(fresh.state).toBe(PortfolioValuationState.VALID);
    expect(stale.state).toBe(PortfolioValuationState.STALE);
  });

  it('reports MISSING_PRICE instead of inventing one', async () => {
    const result = await build(jest.fn(async () => null)).getVerifiedMarketPrice({
      tenantId: TENANT,
      symbol: 'X',
      asset: 'X',
      at,
    });
    expect(result).toEqual({
      price: null,
      source: null,
      timestamp: null,
      state: PortfolioValuationState.MISSING_PRICE,
    });
  });

  it('reports UNAVAILABLE when the price source errors', async () => {
    const findFirst = jest.fn(async () => {
      throw new Error('db down');
    });
    const result = await build(findFirst).getVerifiedMarketPrice({
      tenantId: TENANT,
      symbol: 'X',
      asset: 'X',
      at,
    });
    expect(result.state).toBe(PortfolioValuationState.UNAVAILABLE);
  });
});

describe('BenchmarkService.pickSeries', () => {
  it('returns [] for no rows', () => {
    expect(BenchmarkService.pickSeries([])).toEqual([]);
  });

  it('keeps the most preferred interval rather than interleaving series', () => {
    const rows = [
      candle('2026-09-01T00:00:00Z', '1', 'binance', '1m'),
      candle('2026-09-01T00:00:00Z', '2', 'binance', '1d'),
      candle('2026-09-02T00:00:00Z', '3', 'binance', '1d'),
    ];
    const series = BenchmarkService.pickSeries(rows);
    expect(series.map((r) => r.interval)).toEqual(['1d', '1d']);
  });

  it('within one interval keeps the venue with the most observations', () => {
    const rows = [
      candle('2026-09-01T00:00:00Z', '1', 'okx', '1h'),
      candle('2026-09-01T00:00:00Z', '1', 'binance', '1h'),
      candle('2026-09-01T01:00:00Z', '2', 'binance', '1h'),
    ];
    expect(BenchmarkService.pickSeries(rows).every((r) => r.venue === 'binance')).toBe(true);
  });

  it('ranks unknown intervals last', () => {
    const rows = [
      candle('2026-09-01T00:00:00Z', '1', 'binance', '3d'),
      candle('2026-09-01T00:00:00Z', '1', 'binance', '1m'),
    ];
    expect(BenchmarkService.pickSeries(rows)[0].interval).toBe('1m');
  });

  it('keeps input order within the chosen series', () => {
    const rows = [
      candle('2026-09-01T00:00:00Z', '1', 'b', '1d'),
      candle('2026-09-02T00:00:00Z', '2', 'b', '1d'),
      candle('2026-09-03T00:00:00Z', '3', 'b', '1d'),
    ];
    expect(BenchmarkService.pickSeries(rows).map((r) => r.close.toString())).toEqual([
      '1',
      '2',
      '3',
    ]);
  });
});

describe('BenchmarkService.calculateBenchmarkReturn', () => {
  it('computes the return from one market-data series', async () => {
    const findMany = jest.fn(async () => [
      candle('2026-09-01T00:00:00Z', '100', 'binance', '1d'),
      candle('2026-09-01T00:01:00Z', '999', 'binance', '1m'),
      candle('2026-09-30T00:00:00Z', '110', 'binance', '1d'),
    ]);
    const service = new BenchmarkService({ marketDataRecord: { findMany } } as any, POLICY as any);
    const result = await service.calculateBenchmarkReturn({
      tenantId: TENANT,
      profileId: 'pf',
      benchmarkId: 'BTCUSDT',
      periodStart: new Date('2026-09-01T00:00:00Z'),
      periodEnd: new Date('2026-09-30T00:00:00Z'),
    });
    expect(result.canCalculate).toBe(true);
    expect(Number(result.returnPercent)).toBeCloseTo(10, 8);
    expect(result.evidence.sourceReferences).toEqual(['MARKET_DATA:binance:1d']);
  });

  it('cannot calculate without at least two observations', async () => {
    const service = new BenchmarkService(
      { marketDataRecord: { findMany: jest.fn(async () => []) } } as any,
      POLICY as any,
    );
    const result = await service.calculateBenchmarkReturn({
      tenantId: TENANT,
      profileId: 'pf',
      benchmarkId: 'BTCUSDT',
      periodStart: new Date('2026-09-01T00:00:00Z'),
      periodEnd: new Date('2026-09-30T00:00:00Z'),
    });
    expect(result).toMatchObject({ canCalculate: false, returnPercent: null });
  });
});

describe('AccountingReconciliationService missing OMS fills', () => {
  it('flags an OMS fill that has no accounting event', async () => {
    const empty = {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null),
      count: jest.fn(async () => 0),
    };
    const prisma = {
      portfolioAccountingEvent: {
        ...empty,
        findMany: jest.fn(async () => [{ sourceType: 'OMS_FILL', sourceId: 'pf-1' }]),
      },
      omsFill: {
        findMany: jest.fn(async () => [
          { id: 'f1', providerFillId: 'pf-1' },
          { id: 'f2', providerFillId: null },
        ]),
      },
      portfolioCashLedgerEntry: empty,
      portfolioValuation: empty,
      portfolioAccountingPeriod: empty,
    };
    const service = new AccountingReconciliationService(prisma as any, POLICY as any);
    const { discrepancies } = await service.reconcilePeriod({
      tenantId: TENANT,
      profileId: 'prof',
      periodStart: new Date('2026-09-01T00:00:00Z'),
      periodEnd: new Date('2026-09-30T00:00:00Z'),
    });
    const missing = discrepancies.filter((d) => d.type === 'MISSING_EVENT');
    expect(missing).toHaveLength(1);
    expect(missing[0].details).toEqual({ sourceType: 'OMS_FILL', sourceId: 'f2' });
    expect(prisma.omsFill.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT,
        createdAt: { gte: new Date('2026-09-01T00:00:00Z'), lte: new Date('2026-09-30T00:00:00Z') },
      },
      select: { id: true, providerFillId: true },
    });
  });
});

describe('InvestorVisibilityService managed-account operator', () => {
  it('sees the profiles of the accounts it actively operates', async () => {
    const relationships = jest.fn(async () => [{ targetId: 'acc-1' }, { targetId: 'acc-2' }]);
    const profiles = jest.fn(async () => [
      { id: 'p1', scope: 'MANAGED_ACCOUNT', scopeId: 'acc-1' },
    ]);
    const service = new InvestorVisibilityService({
      accountRelationship: { findMany: relationships },
      portfolioAccountingProfile: { findMany: profiles },
    } as any);
    const visible = await service.resolveVisibleProfiles({
      tenantId: TENANT,
      userId: 'op-1',
      role: InvestorVisibilityRole.MANAGED_ACCOUNT_OPERATOR,
    });
    expect(visible).toEqual([{ profileId: 'p1', scope: 'MANAGED_ACCOUNT', scopeId: 'acc-1' }]);
    expect(relationships).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT,
        sourceId: 'op-1',
        relationshipType: 'OPERATOR_TO_ACCOUNT',
        status: 'ACTIVE',
        endedAt: null,
      },
      select: { targetId: true },
    });
    expect(profiles).toHaveBeenCalledWith({
      where: { tenantId: TENANT, scope: 'MANAGED_ACCOUNT', scopeId: { in: ['acc-1', 'acc-2'] } },
    });
  });

  it('sees nothing without an active relationship', async () => {
    const profiles = jest.fn();
    const service = new InvestorVisibilityService({
      accountRelationship: { findMany: jest.fn(async () => []) },
      portfolioAccountingProfile: { findMany: profiles },
    } as any);
    await expect(
      service.resolveVisibleProfiles({
        tenantId: TENANT,
        userId: 'op-1',
        role: InvestorVisibilityRole.MANAGED_ACCOUNT_OPERATOR,
      }),
    ).resolves.toEqual([]);
    expect(profiles).not.toHaveBeenCalled();
  });
});
