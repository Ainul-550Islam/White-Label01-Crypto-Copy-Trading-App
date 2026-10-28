import { PortfolioExposureService } from './portfolio-exposure.service';
import { RiskState } from './risk-management.types';

const now = new Date('2026-10-28T10:00:00.000Z');
const dec = (value: string) => ({ toString: () => value });
const spot = (quoteAsset = 'USDT', marketType = 'SPOT') => ({ baseAsset: 'BTC', quoteAsset, marketType });
const position = (overrides: Record<string, unknown> = {}) => ({
  accountId: 'acct', symbolId: 'btc', symbol: 'BTC-USDT', venue: 'PAPER',
  quantity: dec('2'), markPrice: dec('999'), averageEntryPrice: dec('800'),
  symbolRef: spot(), updatedAt: now, ...overrides,
});
const order = (overrides: Record<string, unknown> = {}) => ({
  accountId: 'acct', symbolId: 'btc', symbol: 'BTC-USDT', venue: 'PAPER',
  quantity: dec('2'), price: dec('10'), side: 'BUY', orderType: 'LIMIT',
  status: 'CANCEL_REQUESTED', reconciliationState: 'IN_SYNC', strategyId: null,
  symbolRef: spot(), updatedAt: now, ...overrides,
});

function build(data: {
  positions?: ReturnType<typeof position>[];
  orders?: ReturnType<typeof order>[];
  intents?: Array<{ clientOrderId: string; symbol: string }>;
  candles?: Array<Record<string, unknown>>;
  candidateMarkets?: Array<Record<string, unknown>>;
  thresholds?: Record<string, unknown>;
} = {}) {
  const tx = {
    omsOrderIntent: { findMany: jest.fn().mockResolvedValue(data.intents ?? []) },
    position: { findMany: jest.fn().mockResolvedValue(data.positions ?? []) },
    order: { findMany: jest.fn().mockResolvedValue(data.orders ?? []) },
    accountBalanceSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
    marketDataRecord: { findMany: jest.fn().mockResolvedValue(data.candles ?? []) },
    tradingAccount: { findFirst: jest.fn().mockResolvedValue({ exchangeId: 'exchange', marketType: 'SPOT' }) },
    tradingSymbol: { findMany: jest.fn().mockResolvedValue(data.candidateMarkets ?? [spot()]) },
  };
  const prisma = { withTenantRls: jest.fn(async (_tenant: string, run: (client: typeof tx) => Promise<unknown>) => run(tx)) };
  const thresholds = { marketDataMaxAgeMs: 120_000, notionalCurrency: 'USDT', maxGrossExposure: '1000',
    maxStrategyExposure: null, maxTraderExposure: null, maxFollowerExposure: null, ...data.thresholds };
  const policy = { resolveEffectivePolicy: jest.fn().mockResolvedValue({ effectiveVersion: 'v1', thresholds, sourcePolicies: [{ thresholds }] }) };
  return { tx, prisma, service: new PortfolioExposureService(prisma as never, policy as never) };
}

beforeEach(() => { jest.useFakeTimers().setSystemTime(now); });
afterEach(() => { jest.useRealTimers(); });

describe('portfolio exposure evidence', () => {
  it('uses tenant RLS and includes cancel-requested and unresolved orders', async () => {
    const h = build({ orders: [order()] });
    const result = await h.service.calculateExposure({ tenantId: 'tenant', accountId: 'acct', candidateSymbol: 'BTC-USDT' });
    expect(h.prisma.withTenantRls).toHaveBeenCalledWith('tenant', expect.any(Function));
    expect(h.tx.order.findMany.mock.calls[0][0].where.OR).toEqual(expect.arrayContaining([
      { status: { in: expect.arrayContaining(['CANCEL_REQUESTED']) } },
      { reconciliationState: { not: 'IN_SYNC' } },
    ]));
    expect(result.openOrderExposure).toBe('20');
    expect(result.totalExposure).toBe('20');
    expect(result.accountExposures[0].totalExposure).toBe('20');
    expect(result.state).toBe(RiskState.NORMAL);
  });

  it('does not omit an unresolved intent that has no canonical order yet', async () => {
    const h = build({ intents: [{ clientOrderId: 'pending', symbol: 'ETH-USDT' }] });
    const result = await h.service.calculateExposure({ tenantId: 'tenant', accountId: 'acct' });
    expect(result.state).toBe(RiskState.UNKNOWN);
    expect(result.unknownPrices).toContain('ETH-USDT');
    expect(h.tx.omsOrderIntent.findMany.mock.calls[0][0].where.state.in).toEqual(expect.arrayContaining(['FAILED', 'RECONCILIATION_REQUIRED']));
  });

  it('excludes the specific existing intent being independently re-evaluated for routing', async () => {
    const h = build();
    await h.service.calculateExposure({ tenantId: 'tenant', accountId: 'acct', excludePendingIntentId: 'intent-1' });
    expect(h.tx.omsOrderIntent.findMany.mock.calls[0][0].where.id).toEqual({ not: 'intent-1' });
  });

  it('does not use position entry price or an un-timestamped mark as market evidence', async () => {
    const result = await build({ positions: [position()] }).service.calculateExposure({ tenantId: 'tenant', accountId: 'acct' });
    expect(result.state).toBe(RiskState.UNKNOWN);
    expect(result.unknownPrices).toContain('BTC-USDT');
    expect(result.symbolExposures[0].price).toBeNull();
    expect(result.notionalUtilizationPercent).toBeNull();
  });

  it('uses a fresh closed-trade candle consistently for portfolio and account views', async () => {
    const h = build({ positions: [position()], candles: [{ symbolId: 'btc', close: dec('10.5'), closeTime: now }] });
    const result = await h.service.calculateExposure({ tenantId: 'tenant', accountId: 'acct', candidateSymbol: 'BTC-USDT' });
    expect(result.state).toBe(RiskState.NORMAL);
    expect(result.grossExposure).toBe('21');
    expect(result.accountExposures[0].grossNotional).toBe('21');
    expect(result.symbolExposures[0].price).toBe('10.5');
    expect(result.symbolExposures[0].priceTimestamp).toBe(now.toISOString());
    expect(h.tx.marketDataRecord.findMany.mock.calls[0][0].where).toMatchObject({ interval: '1m', tradeCount: { gt: 0 } });
  });

  it.each([
    { side: 'SELL' }, { orderType: 'MARKET', price: null }, { reconciliationState: 'UNKNOWN' },
    { price: dec('0') }, { symbolRef: spot('USDT', 'FUTURES_USDT') },
  ])('marks an unbounded or unreconciled order as unknown: %p', async (change) => {
    const result = await build({ orders: [order(change)] }).service.calculateExposure({ tenantId: 'tenant', accountId: 'acct' });
    expect(result.state).toBe(RiskState.UNKNOWN);
    expect(result.unknownPrices).toContain('BTC-USDT');
  });

  it('does not add exposure denominated in different quote assets', async () => {
    const other = order({ symbol: 'ETH-BTC', symbolId: 'eth', symbolRef: spot('BTC') });
    const result = await build({ orders: [other] }).service.calculateExposure({ tenantId: 'tenant', accountId: 'acct', candidateSymbol: 'BTC-USDT' });
    expect(result.state).toBe(RiskState.UNKNOWN);
    expect(result.unknownPrices).toEqual(expect.arrayContaining(['ETH-BTC', 'BTC-USDT']));
  });

  it.each([null, 'USD'])('does not compare a %s policy currency against USDT exposure', async (currency) => {
    const result = await build({ orders: [order()], thresholds: { notionalCurrency: currency, maxGrossExposure: '1' } })
      .service.calculateExposure({ tenantId: 'tenant', accountId: 'acct', candidateSymbol: 'BTC-USDT' });
    expect(result.valuationCurrency).toBe('USDT');
    expect(result.state).toBe(RiskState.UNKNOWN);
    expect(result.unknownPrices).toContain('POLICY_CURRENCY');
    expect(result.notionalUtilizationPercent).toBeNull();
  });

  it('refuses a derivative or ambiguous candidate without contract multiplier evidence', async () => {
    const h = build({ candidateMarkets: [spot('USDT', 'FUTURES_USDT')] });
    const result = await h.service.calculateExposure({ tenantId: 'tenant', accountId: 'acct', candidateSymbol: 'BTC-USDT' });
    expect(result.state).toBe(RiskState.UNKNOWN);
    expect(result.unknownPrices).toContain('BTC-USDT');
  });

  it('rounds position notional upward instead of dropping fractional exposure', async () => {
    const h = build({ positions: [position({ quantity: dec('0.000000000001') })],
      candles: [{ symbolId: 'btc', close: dec('0.000000000001'), closeTime: now }] });
    const result = await h.service.calculateExposure({ tenantId: 'tenant', accountId: 'acct' });
    expect(result.grossExposure).toBe('0.000000000001');
  });

  it('uses committed open orders when deriving a gross limit breach', async () => {
    const result = await build({ orders: [order()], thresholds: { maxGrossExposure: '19' } }).service.calculateExposure({ tenantId: 'tenant', accountId: 'acct' });
    expect(result.state).toBe(RiskState.BLOCKED);
  });

  it('does not claim strategy-scoped position attribution from account-only positions', async () => {
    const h = build({ positions: [position()], candles: [{ symbolId: 'btc', close: dec('10'), closeTime: now }] });
    const result = await h.service.calculateExposure({ tenantId: 'tenant', accountId: 'acct', strategyId: 'strategy' });
    expect(result.state).toBe(RiskState.UNKNOWN);
  });
});
