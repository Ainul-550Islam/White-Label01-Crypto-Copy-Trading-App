/**
 * Deterministic tests for the risk calculations that used to rely on
 * placeholders: day-start equity (daily loss), intraday drawdown and the
 * stress scenario model. Prisma and the policy service are in-memory fakes.
 */
import { resolveDayStartEquity, scopeAccountIdsOf } from './day-start-equity';
import { DailyLossLimitService } from './daily-loss-limit.service';
import { DrawdownRiskService } from './drawdown-risk.service';
import { StressTestService, computeScenarioImpact } from './stress-test.service';
import { PortfolioExposure, RiskState, StressScenario } from './risk-management.types';

const TENANT = '00000000-0000-0000-0000-00000000000a';
const ACC1 = '00000000-0000-0000-0000-000000000001';
const ACC2 = '00000000-0000-0000-0000-000000000002';
const today = () => new Date().toISOString().slice(0, 10);

function dec(v: string) {
  return { toString: () => v };
}

interface Meta {
  accountId: string;
  tradingDay: string;
  equity: string | null;
  capturedAt: Date;
}

function fakePrisma(opts: { metas?: Meta[]; balances?: Array<{ accountId: string; total: string }>; positions?: Array<{ accountId: string; unrealisedPnl: string | null }> }) {
  const settings = new Map<string, any>();
  return {
    settings,
    riskSnapshotMetadata: {
      findMany: jest.fn(async (args: any) => {
        const ids: string[] = args.where.accountId.in;
        return (opts.metas ?? [])
          .filter((m) => m.tradingDay === args.where.tradingDay && ids.includes(m.accountId) && m.equity !== null)
          .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime())
          .map((m) => ({ accountId: m.accountId, equity: m.equity === null ? null : dec(m.equity), capturedAt: m.capturedAt }));
      }),
    },
    accountBalanceSnapshot: {
      findMany: jest.fn(async (args: any) =>
        (opts.balances ?? []).filter((b) => !args.where.accountId || b.accountId === args.where.accountId).map((b) => ({ ...b, total: dec(b.total), updatedAt: new Date() })),
      ),
    },
    position: {
      findMany: jest.fn(async (args: any) =>
        (opts.positions ?? [])
          .filter((p) => !args.where.accountId || p.accountId === args.where.accountId)
          .map((p) => ({ ...p, unrealisedPnl: p.unrealisedPnl === null ? null : dec(p.unrealisedPnl), updatedAt: new Date() })),
      ),
    },
    fill: { findMany: jest.fn(async () => []) },
  } as any;
}

function fakePolicy(thresholds: Record<string, any>) {
  return { resolveEffectivePolicy: jest.fn(async () => ({ effectiveVersion: 'v-test', thresholds })) } as any;
}

function fakeSnapshotRepo() {
  const store = new Map<string, { highWaterMark: string; timestamp: string }>();
  return {
    store,
    getHighWaterMark: jest.fn(async (p: any) => store.get(`${p.scope}:${p.scopeId}`) ?? null),
    persistHighWaterMark: jest.fn(async (p: any) => {
      store.set(`${p.scope}:${p.scopeId}`, { highWaterMark: p.highWaterMark, timestamp: p.timestamp });
    }),
  } as any;
}

describe('resolveDayStartEquity', () => {
  test('earliest snapshot of the day per account, summed', async () => {
    const d = today();
    const prisma = fakePrisma({
      metas: [
        { accountId: ACC1, tradingDay: d, equity: '1200', capturedAt: new Date(`${d}T05:00:00Z`) },
        { accountId: ACC1, tradingDay: d, equity: '1000', capturedAt: new Date(`${d}T00:01:00Z`) },
        { accountId: ACC2, tradingDay: d, equity: '500.5', capturedAt: new Date(`${d}T00:02:00Z`) },
        { accountId: ACC2, tradingDay: '1999-01-01', equity: '9', capturedAt: new Date('1999-01-01T00:00:00Z') },
      ],
    });
    await expect(resolveDayStartEquity(prisma, TENANT, d, [ACC1, ACC2])).resolves.toBe('1500.5');
  });

  test('any account without a snapshot makes the reference unknown', async () => {
    const d = today();
    const prisma = fakePrisma({ metas: [{ accountId: ACC1, tradingDay: d, equity: '1000', capturedAt: new Date() }] });
    await expect(resolveDayStartEquity(prisma, TENANT, d, [ACC1, ACC2])).resolves.toBeNull();
    await expect(resolveDayStartEquity(prisma, TENANT, d, [])).resolves.toBeNull();
  });

  test('scopeAccountIdsOf: explicit account wins, else distinct rows', () => {
    expect(Array.from(scopeAccountIdsOf(ACC1, [{ accountId: ACC2 }]))).toEqual([ACC1]);
    expect(Array.from(scopeAccountIdsOf(undefined, [{ accountId: ACC2 }, { accountId: ACC1 }, { accountId: ACC2 }])).sort()).toEqual([ACC1, ACC2]);
  });
});

describe('DailyLossLimitService', () => {
  test('uses day-start EQUITY (not gross exposure) and breaches on a real loss', async () => {
    const d = today();
    const prisma = fakePrisma({
      metas: [{ accountId: ACC1, tradingDay: d, equity: '10000', capturedAt: new Date(`${d}T00:00:30Z`) }],
      balances: [{ accountId: ACC1, total: '8500' }],
      positions: [{ accountId: ACC1, unrealisedPnl: '-300' }],
    });
    const service = new DailyLossLimitService(prisma, fakePolicy({ maxDailyLoss: '1000', dailyLossIncludesUnrealized: true }));
    const [r] = await service.evaluateDailyLoss({ tenantId: TENANT, accountId: ACC1 });
    expect(r.startingEquity).toBe('10000');
    expect(r.currentEquity).toBe('8200');
    expect(r.dailyPnl).toBe('-1800');
    expect(r.isBreach).toBe(true);
    expect(r.state).toBe(RiskState.BLOCKED);
  });

  test('no day-start snapshot => UNKNOWN, never a fabricated reference', async () => {
    const prisma = fakePrisma({ balances: [{ accountId: ACC1, total: '8500' }] });
    const service = new DailyLossLimitService(prisma, fakePolicy({ maxDailyLoss: '1000', dailyLossIncludesUnrealized: true }));
    const [r] = await service.evaluateDailyLoss({ tenantId: TENANT, accountId: ACC1 });
    expect(r.startingEquity).toBeNull();
    expect(r.dailyPnl).toBeNull();
    expect(r.state).toBe(RiskState.UNKNOWN);
  });

  test('tenant scope requires a reference for every account holding balances', async () => {
    const d = today();
    const prisma = fakePrisma({
      metas: [{ accountId: ACC1, tradingDay: d, equity: '10000', capturedAt: new Date() }],
      balances: [
        { accountId: ACC1, total: '10000' },
        { accountId: ACC2, total: '5000' },
      ],
    });
    const service = new DailyLossLimitService(prisma, fakePolicy({ maxDailyLoss: '1000', dailyLossIncludesUnrealized: true }));
    const [r] = await service.evaluateDailyLoss({ tenantId: TENANT });
    expect(r.state).toBe(RiskState.UNKNOWN);
  });
});

describe('DrawdownRiskService intraday drawdown', () => {
  test('peak seeded with day-start equity, ratchets up, persists per day', async () => {
    const d = today();
    let balance = '10500';
    const prisma = fakePrisma({ metas: [{ accountId: ACC1, tradingDay: d, equity: '10000', capturedAt: new Date() }], balances: [] });
    prisma.accountBalanceSnapshot.findMany = jest.fn(async () => [{ accountId: ACC1, total: dec(balance), updatedAt: new Date() }]);
    const repo = fakeSnapshotRepo();
    const service = new DrawdownRiskService(prisma, fakePolicy({ maxDrawdownPercent: '50' }), repo);

    const [first] = await service.evaluateDrawdown({ tenantId: TENANT, accountId: ACC1 });
    expect(first.intradayDrawdownPercent).toBe('0'); // new intraday peak 10500
    const key = `TENANT:${ACC1}:${d.replace(/-/g, '')}`;
    expect(repo.store.get(key)?.highWaterMark).toBe('10500');

    balance = '9450';
    const [second] = await service.evaluateDrawdown({ tenantId: TENANT, accountId: ACC1 });
    expect(second.intradayDrawdownPercent).toBe('10'); // (10500-9450)/10500
    expect(repo.store.get(key)?.highWaterMark).toBe('10500');
  });

  test('without day-start equity the intraday figure is null, not the rolling one', async () => {
    const prisma = fakePrisma({ balances: [{ accountId: ACC1, total: '9000' }] });
    const repo = fakeSnapshotRepo();
    repo.store.set(`TENANT:${ACC1}`, { highWaterMark: '10000', timestamp: new Date().toISOString() });
    const service = new DrawdownRiskService(prisma, fakePolicy({ maxDrawdownPercent: '50' }), repo);
    const [r] = await service.evaluateDrawdown({ tenantId: TENANT, accountId: ACC1 });
    expect(r.rollingDrawdownPercent).toBe('10');
    expect(r.intradayDrawdownPercent).toBeNull();
  });
});

function exposure(partial: Partial<PortfolioExposure>): PortfolioExposure {
  return {
    tenantId: TENANT,
    asOf: new Date().toISOString(),
    policyVersion: 'v',
    grossExposure: '0',
    netExposure: '0',
    longExposure: '0',
    shortExposure: '0',
    openOrderExposure: '0',
    totalExposure: '0',
    notionalUtilizationPercent: null,
    symbolExposures: [],
    venueExposures: [],
    accountExposures: [],
    strategyExposures: [],
    traderExposures: [],
    followerExposures: [],
    staleSymbols: [],
    unknownPrices: [],
    sourceTimestamps: {},
    state: RiskState.NORMAL,
    warnings: [],
    ...partial,
  };
}

function sym(symbol: string, base: string, net: string, gross: string) {
  return { symbol, venue: 'BINANCE', baseAsset: base, quoteAsset: 'USDT', longNotional: '0', shortNotional: '0', netNotional: net, grossNotional: gross, openOrderNotional: '0', totalExposure: gross, concentrationPercent: null, price: null, priceTimestamp: null, isStale: false };
}

function scenario(type: any, parameters: Record<string, string>, shockedAssets: string[] = []): StressScenario {
  return { scenarioId: `T_${type}`, type, name: type, description: type, parameters, shockedAssets };
}

describe('computeScenarioImpact', () => {
  // Long 10k BTC, short 4k ETH: gross 14k, net +6k.
  const book = exposure({
    grossExposure: '14000',
    netExposure: '6000',
    symbolExposures: [sym('BTC-USDT', 'BTC', '10000', '10000'), sym('ETH-USDT', 'ETH', '-4000', '4000')],
    venueExposures: [{ venue: 'BINANCE', grossNotional: '14000', netNotional: '6000', concentrationPercent: '100', accountCount: 1, symbolCount: 2 }],
  });
  const equity = 20000n * 1_000_000_000_000n;

  test('market shock revalues the signed net book (shorts gain on a down move)', () => {
    const r = computeScenarioImpact(scenario('MARKET_SHOCK', { shockPercent: '-10' }), book, equity);
    expect(r.pnl).toBe('-600'); // -1000 on BTC long, +400 on ETH short
    expect(r.exposure).toBe('12600');
    expect(r.margin).toBe('3'); // 600 / 20000
  });

  test('correlated shock only touches the listed assets', () => {
    const r = computeScenarioImpact(scenario('CORRELATED_SHOCK', { shockPercent: '-20' }, ['BTC']), book, equity);
    expect(r.pnl).toBe('-2000');
    expect(r.exposure).toBe('12000'); // BTC 10000 -> 8000, ETH unchanged 4000
  });

  test('gains consume no margin', () => {
    const r = computeScenarioImpact(scenario('GAP_MOVE', { gapPercent: '15' }), book, equity);
    expect(r.pnl).toBe('900');
    expect(r.margin).toBe('0');
  });

  test('margin impact is null when equity is unknown', () => {
    expect(computeScenarioImpact(scenario('MARKET_SHOCK', { shockPercent: '-10' }), book, null).margin).toBeNull();
  });

  test('slippage prices liquidation of the gross book from bps', () => {
    const r = computeScenarioImpact(scenario('SLIPPAGE_EXPANSION', { slippageBpsIncrease: '100' }), book, equity);
    expect(r.pnl).toBe('-140');
  });

  test('liquidity reduction uses stated parameters, no hidden 1%', () => {
    const r = computeScenarioImpact(scenario('LIQUIDITY_REDUCTION', { baseMarketImpactBps: '25', marketImpactMultiplier: '2' }), book, equity);
    expect(r.pnl).toBe('-70'); // 14000 * 0.25% * 2
    expect(computeScenarioImpact(scenario('LIQUIDITY_REDUCTION', { marketImpactMultiplier: '2' }), book, equity).pnl).toBeNull();
  });

  test('vol expansion needs an initial margin rate; otherwise margin impact is null', () => {
    expect(computeScenarioImpact(scenario('VOL_EXPANSION', { marginIncreasePercent: '50' }), book, equity).margin).toBeNull();
    const r = computeScenarioImpact(scenario('VOL_EXPANSION', { marginIncreasePercent: '50', initialMarginRatePercent: '10' }), book, equity);
    expect(r.margin).toBe('3.5'); // IM 1400, +50% = 700, / 20000
  });

  test('exchange outage traps only the named venue exposure', () => {
    expect(computeScenarioImpact(scenario('EXCHANGE_OUTAGE', { venue: 'BINANCE' }), book, equity)).toEqual(expect.objectContaining({ exposure: '14000', elevate: true }));
    expect(computeScenarioImpact(scenario('EXCHANGE_OUTAGE', { venue: 'OKX' }), book, equity)).toEqual(expect.objectContaining({ exposure: '0', elevate: false }));
  });

  test('empty book is zero impact', () => {
    expect(computeScenarioImpact(scenario('MARKET_SHOCK', { shockPercent: '-10' }), exposure({}), equity)).toEqual({ pnl: '0', exposure: '0', margin: '0', elevate: false });
  });
});

describe('StressTestService', () => {
  test('breach only on losses; levels never downgraded; unknown estimates are UNKNOWN', async () => {
    const book = exposure({ grossExposure: '14000', netExposure: '6000', symbolExposures: [sym('BTC-USDT', 'BTC', '10000', '10000'), sym('ETH-USDT', 'ETH', '-4000', '4000')] });
    const prisma = fakePrisma({ balances: [{ accountId: ACC1, total: '20000' }] });
    const exposureService = { calculateExposure: jest.fn(async () => book) } as any;
    const service = new StressTestService(prisma, fakePolicy({ stressLossThreshold: '500' }), exposureService);
    const results = await service.runStressTests({
      tenantId: TENANT,
      accountId: ACC1,
      scenarios: [
        scenario('MARKET_SHOCK', { shockPercent: '-10' }),
        scenario('MARKET_SHOCK', { shockPercent: '20' }),
        scenario('LIQUIDITY_REDUCTION', { marketImpactMultiplier: '2' }),
      ],
    });
    expect(results[0].isBreach).toBe(true);
    expect(results[0].riskLevel).toBe(RiskState.HIGH);
    expect(results[0].estimatedMarginImpact).toBe('3');
    expect(results[1].estimatedPnlImpact).toBe('1200');
    expect(results[1].isBreach).toBe(false);
    expect(results[2].estimatedPnlImpact).toBeNull();
    expect(results[2].riskLevel).toBe(RiskState.UNKNOWN);
  });
});
