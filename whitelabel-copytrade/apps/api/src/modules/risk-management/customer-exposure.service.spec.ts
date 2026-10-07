// # Responsibility: verifies customer exposure ownership, live/non-simulated scoping, price provenance, and fail-closed totals.

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CustomerExposureService } from './customer-exposure.service';
import { InstitutionalRiskPolicyService } from './risk-policy.service';

const TENANT_ID = 'tenant-authenticated';
const USER_ID = 'user-authenticated';
const ACCOUNT_ID = 'account-owned-live';

function position(overrides: Record<string, unknown> = {}) {
  return {
    symbolId: 'symbol-btc-usdt',
    symbol: 'BTC-USDT',
    venue: 'BINANCE',
    quantity: '1',
    markPrice: '99999',
    averageEntryPrice: '100',
    symbolRef: {
      marketType: 'SPOT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
    },
    ...overrides,
  };
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    symbolId: 'symbol-btc-usdt',
    symbol: 'BTC-USDT',
    venue: 'BINANCE',
    side: 'BUY',
    orderType: 'LIMIT',
    quantity: '3',
    filledQuantity: '0.5',
    price: '110',
    symbolRef: {
      marketType: 'SPOT',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
    },
    ...overrides,
  };
}

function candle(overrides: Record<string, unknown> = {}) {
  return {
    symbolId: 'symbol-btc-usdt',
    venue: 'BINANCE',
    interval: '1m',
    close: '100',
    closeTime: new Date(Date.now() - 1_000),
    ...overrides,
  };
}

function build(options: {
  accounts?: Array<{ id: string }>;
  positions?: Array<Record<string, unknown>>;
  orders?: Array<Record<string, unknown>>;
  traderProfile?: { id: string; userId: string } | null;
  findCandle?: jest.Mock;
  maxAgeMs?: number;
} = {}) {
  const accountFindMany = jest.fn(async (_query: Record<string, unknown>) => options.accounts ?? [{ id: ACCOUNT_ID }]);
  const positionFindMany = jest.fn(async (_query: Record<string, unknown>) => options.positions ?? []);
  const orderFindMany = jest.fn(async (_query: Record<string, unknown>) => options.orders ?? []);
  const traderProfileFindFirst = jest.fn(async (_query: Record<string, unknown>) => options.traderProfile ?? null);
  const marketDataFindFirst = options.findCandle ?? jest.fn(async () => candle());
  const prisma = {
    traderProfile: { findFirst: traderProfileFindFirst },
    tradingAccount: { findMany: accountFindMany },
    position: { findMany: positionFindMany },
    order: { findMany: orderFindMany },
    marketDataRecord: { findFirst: marketDataFindFirst },
  };
  const policyService = {
    resolveEffectivePolicy: jest.fn(async () => ({
      thresholds: { marketDataMaxAgeMs: options.maxAgeMs ?? 30_000 },
    })),
  };
  return {
    service: new CustomerExposureService(
      prisma as unknown as PrismaService,
      policyService as unknown as InstitutionalRiskPolicyService,
    ),
    prisma,
    policyService,
    traderProfileFindFirst,
    accountFindMany,
    positionFindMany,
    orderFindMany,
    marketDataFindFirst,
  };
}

describe('CustomerExposureService.calculateMyExposure', () => {
  it('scopes all portfolio reads to the authenticated owner’s live, non-sandbox accounts and excludes simulated records', async () => {
    const harness = build({
      positions: [position(), position({ quantity: '-0.5' })],
      orders: [order()],
    });

    const result = await harness.service.calculateMyExposure({ tenantId: TENANT_ID, userId: USER_ID });

    expect(harness.accountFindMany).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT_ID,
        userId: USER_ID,
        deletedAt: null,
        isSandbox: false,
      },
      select: { id: true },
    });
    expect(harness.positionFindMany).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT_ID,
        accountId: { in: [ACCOUNT_ID] },
        containsSimulatedFills: false,
      },
      select: {
        symbolId: true,
        symbol: true,
        venue: true,
        quantity: true,
        symbolRef: { select: { marketType: true, baseAsset: true, quoteAsset: true } },
      },
    });
    expect(harness.orderFindMany).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT_ID,
        accountId: { in: [ACCOUNT_ID] },
        isSimulated: false,
        status: { in: ['PENDING', 'SUBMITTED', 'ACKNOWLEDGED', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED'] },
      },
      select: {
        symbolId: true,
        symbol: true,
        venue: true,
        side: true,
        orderType: true,
        quantity: true,
        filledQuantity: true,
        price: true,
        symbolRef: { select: { marketType: true, baseAsset: true, quoteAsset: true } },
      },
    });
    expect(harness.marketDataFindFirst).toHaveBeenCalledWith({
      where: {
        symbolId: 'symbol-btc-usdt',
        venue: 'BINANCE',
        interval: '1m',
        closeTime: { lte: expect.any(Date) },
      },
      orderBy: { closeTime: 'desc' },
      select: { symbolId: true, venue: true, interval: true, close: true, closeTime: true },
    });
    const positionQuery = harness.positionFindMany.mock.calls[0]?.[0];
    expect(positionQuery).toBeDefined();
    expect(positionQuery?.select).not.toHaveProperty('markPrice');
    expect(positionQuery?.select).not.toHaveProperty('averageEntryPrice');
    expect(result.dataScope).toBe('SIGNED_IN_USER_NON_SANDBOX_NON_SIMULATED_ACCOUNTS');
    expect(result.simulatedRecordsIncluded).toBe(false);
  });

  it('calculates exact per-quote totals from a fresh, instrument-linked one-minute close and remaining limit orders', async () => {
    const harness = build({
      positions: [position(), position({ quantity: '-0.5' })],
      orders: [order()],
    });

    const result = await harness.service.calculateMyExposure({ tenantId: TENANT_ID, userId: USER_ID });

    expect(result.state).toBe('CURRENT');
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({
      symbol: 'BTC-USDT',
      venue: 'BINANCE',
      longQuantity: '1',
      shortQuantity: '0.5',
      netQuantity: '0.5',
      longPositionNotional: '100',
      shortPositionNotional: '50',
      grossPositionNotional: '150',
      netPositionNotional: '50',
      openOrderCommitment: '275',
      totalNotional: '425',
      openOrderCount: 1,
      openOrderCommitmentBasis: 'ORDER_PRICE',
      price: '100',
      priceSource: 'MARKET_DATA_1M_CANDLE_CLOSE',
      positionState: 'CURRENT',
      openOrderState: 'CURRENT',
      state: 'CURRENT',
    });
    expect(result.totalsByQuoteAsset).toEqual([{
      quoteAsset: 'USDT',
      longPositionNotional: '100',
      shortPositionNotional: '50',
      grossPositionNotional: '150',
      openOrderCommitment: '275',
      totalNotional: '425',
      state: 'CURRENT',
    }]);
    expect(result.cashBalancesIncluded).toBe(false);
    expect(result.currencyTreatment).toBe('SEPARATE_QUOTE_ASSETS_NO_FX_CONVERSION');
  });

  it('does not substitute markPrice or averageEntryPrice when the price candle is missing', async () => {
    const harness = build({
      positions: [position()],
      findCandle: jest.fn(async () => null),
    });

    const result = await harness.service.calculateMyExposure({ tenantId: TENANT_ID, userId: USER_ID });

    expect(result.state).toBe('UNKNOWN');
    expect(result.unknownSymbols).toEqual(['BINANCE:BTC-USDT']);
    expect(result.lines[0]).toMatchObject({
      price: null,
      priceTimestamp: null,
      grossPositionNotional: null,
      totalNotional: null,
      positionState: 'UNKNOWN',
      state: 'UNKNOWN',
    });
    expect(result.totalsByQuoteAsset[0]).toMatchObject({
      grossPositionNotional: null,
      totalNotional: null,
      state: 'UNKNOWN',
    });
  });

  it('rejects a candle whose instrument identity does not match the tenant symbol reference', async () => {
    const harness = build({
      positions: [position()],
      findCandle: jest.fn(async () => candle({ symbolId: 'different-tenant-symbol' })),
    });

    const result = await harness.service.calculateMyExposure({ tenantId: TENANT_ID, userId: USER_ID });

    expect(result.state).toBe('UNKNOWN');
    expect(result.lines[0]).toMatchObject({
      price: null,
      grossPositionNotional: null,
      positionState: 'UNKNOWN',
    });
    expect(result.totalsByQuoteAsset[0].totalNotional).toBeNull();
  });

  it('marks stale candles and withholds position and currency totals instead of presenting stale values as current', async () => {
    const harness = build({
      positions: [position()],
      findCandle: jest.fn(async () => candle({ closeTime: new Date(Date.now() - 60_000) })),
    });

    const result = await harness.service.calculateMyExposure({ tenantId: TENANT_ID, userId: USER_ID });

    expect(result.state).toBe('STALE');
    expect(result.staleSymbols).toEqual(['BINANCE:BTC-USDT']);
    expect(result.lines[0]).toMatchObject({
      price: null,
      priceSource: null,
      grossPositionNotional: null,
      totalNotional: null,
      positionState: 'STALE',
      state: 'STALE',
    });
    expect(result.totalsByQuoteAsset[0]).toMatchObject({
      grossPositionNotional: null,
      totalNotional: null,
      state: 'STALE',
    });
  });

  it('prices a market-order commitment only from a fresh candle and labels the reference basis', async () => {
    const harness = build({
      orders: [order({ orderType: 'MARKET', quantity: '2', filledQuantity: '0.5', price: null })],
    });

    const result = await harness.service.calculateMyExposure({ tenantId: TENANT_ID, userId: USER_ID });

    expect(result.state).toBe('CURRENT');
    expect(result.lines[0]).toMatchObject({
      positionState: 'NO_POSITION',
      openOrderCommitment: '150',
      openOrderCommitmentBasis: 'MARKET_DATA_1M_CANDLE_CLOSE',
      price: '100',
      priceSource: 'MARKET_DATA_1M_CANDLE_CLOSE',
      openOrderState: 'CURRENT',
      totalNotional: '150',
    });
  });

  it('keeps quote currencies separate rather than adding incomparable notionals', async () => {
    const harness = build({
      positions: [
        position(),
        position({
          symbolId: 'symbol-eth-btc',
          symbol: 'ETH-BTC',
          quantity: '2',
          symbolRef: { marketType: 'SPOT', baseAsset: 'ETH', quoteAsset: 'BTC' },
        }),
      ],
      findCandle: jest.fn(async (query: { where: { symbolId: string } }) => query.where.symbolId === 'symbol-eth-btc'
        ? candle({ symbolId: 'symbol-eth-btc', symbol: 'ETH-BTC', close: '0.1' })
        : candle()),
    });

    const result = await harness.service.calculateMyExposure({ tenantId: TENANT_ID, userId: USER_ID });

    expect(result.state).toBe('CURRENT');
    expect(result.totalsByQuoteAsset).toEqual([
      expect.objectContaining({ quoteAsset: 'BTC', grossPositionNotional: '0.2', totalNotional: '0.2' }),
      expect.objectContaining({ quoteAsset: 'USDT', grossPositionNotional: '100', totalNotional: '100' }),
    ]);
  });

  it('withholds derivative notionals when no contract multiplier is available', async () => {
    const harness = build({
      positions: [position({
        symbolId: 'symbol-btc-perp',
        symbol: 'BTC-USDT-PERP',
        symbolRef: { marketType: 'FUTURES_COIN', baseAsset: 'BTC', quoteAsset: 'USDT' },
      })],
      orders: [order({
        symbolId: 'symbol-btc-perp',
        symbol: 'BTC-USDT-PERP',
        symbolRef: { marketType: 'FUTURES_COIN', baseAsset: 'BTC', quoteAsset: 'USDT' },
      })],
      findCandle: jest.fn(async () => candle({ symbolId: 'symbol-btc-perp' })),
    });

    const result = await harness.service.calculateMyExposure({ tenantId: TENANT_ID, userId: USER_ID });

    expect(result.state).toBe('UNKNOWN');
    expect(result.lines[0]).toMatchObject({
      marketType: 'FUTURES_COIN',
      grossPositionNotional: null,
      openOrderCommitment: null,
      totalNotional: null,
      state: 'UNKNOWN',
    });
    expect(result.totalsByQuoteAsset[0].totalNotional).toBeNull();
  });

  it('returns an explicit empty state when the user has no qualifying non-sandbox accounts', async () => {
    const harness = build({ accounts: [] });

    const result = await harness.service.calculateMyExposure({ tenantId: TENANT_ID, userId: USER_ID });

    expect(result).toMatchObject({
      tenantId: TENANT_ID,
      state: 'EMPTY',
      eligibleAccountCount: 0,
      lines: [],
      totalsByQuoteAsset: [],
    });
    expect(harness.positionFindMany).not.toHaveBeenCalled();
    expect(harness.orderFindMany).not.toHaveBeenCalled();
    expect(harness.marketDataFindFirst).not.toHaveBeenCalled();
    expect(harness.policyService.resolveEffectivePolicy).not.toHaveBeenCalled();
  });

  it('fails closed when the market-data source errors', async () => {
    const harness = build({
      positions: [position()],
      findCandle: jest.fn(async () => {
        throw new Error('market feed database unavailable');
      }),
    });

    const result = await harness.service.calculateMyExposure({ tenantId: TENANT_ID, userId: USER_ID });

    expect(result.state).toBe('UNKNOWN');
    expect(result.lines[0].grossPositionNotional).toBeNull();
    expect(result.totalsByQuoteAsset[0].totalNotional).toBeNull();
  });
});

describe('CustomerExposureService.calculateTraderExposure', () => {
  const TRADER_ID = 'trader-profile-owner-only';

  it('proves the tenant-owned profile first, then reads only that owner’s live non-sandbox non-simulated accounts', async () => {
    const harness = build({
      traderProfile: { id: TRADER_ID, userId: USER_ID },
      positions: [position()],
    });

    const result = await harness.service.calculateTraderExposure({
      tenantId: TENANT_ID,
      traderId: TRADER_ID,
      userId: USER_ID,
    });

    expect(harness.traderProfileFindFirst).toHaveBeenCalledWith({
      where: { id: TRADER_ID, tenantId: TENANT_ID, userId: USER_ID, deletedAt: null },
      select: { id: true },
    });
    expect(harness.accountFindMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, userId: USER_ID, deletedAt: null, isSandbox: false },
      select: { id: true },
    });
    expect(harness.positionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: TENANT_ID, accountId: { in: [ACCOUNT_ID] }, containsSimulatedFills: false },
    }));
    expect(result).toMatchObject({
      tenantId: TENANT_ID,
      traderId: TRADER_ID,
      dataScope: 'TRADER_PROFILE_OWNER_NON_SANDBOX_NON_SIMULATED_ACCOUNTS',
      simulatedRecordsIncluded: false,
      state: 'CURRENT',
      lines: [{ symbol: 'BTC-USDT', grossPositionNotional: '100' }],
    });
  });

  it('returns no exposure and performs no account reads when the principal does not own a tenant profile', async () => {
    const harness = build({ traderProfile: null });

    const result = await harness.service.calculateTraderExposure({
      tenantId: TENANT_ID,
      traderId: TRADER_ID,
      userId: 'different-user',
    });

    expect(result).toBeNull();
    expect(harness.traderProfileFindFirst).toHaveBeenCalledWith({
      where: { id: TRADER_ID, tenantId: TENANT_ID, userId: 'different-user', deletedAt: null },
      select: { id: true },
    });
    expect(harness.accountFindMany).not.toHaveBeenCalled();
    expect(harness.positionFindMany).not.toHaveBeenCalled();
    expect(harness.orderFindMany).not.toHaveBeenCalled();
  });
});
