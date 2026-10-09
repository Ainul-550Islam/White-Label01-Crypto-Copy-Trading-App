// Regression suite for the copy-sizing audit.
//
// Every case below failed against the previous implementation. They exist to
// make sure a follower is never sized from the leader's absolute quantity, that
// missing venue metadata rejects the copy instead of fabricating precision, and
// that a notional cap cannot be bypassed by a market order.
import { CopyOrderMapperService, LeaderEvent } from './copy-order-mapper.service';
import { CopyPolicy, CopySizingMode } from './copy-trading.types';

const basePolicy = (over: Partial<CopyPolicy> = {}): CopyPolicy => ({
  sizingMode: CopySizingMode.PROPORTIONAL,
  proportionalRatio: null,
  fixedQuantity: null,
  fixedNotional: null,
  maxOrderNotional: null,
  maxDailyNotional: null,
  maxConcurrentCopies: null,
  slippageToleranceBps: 50,
  executionDelayMs: 0,
  allowedSymbols: null,
  blockedSymbols: null,
  allowedSides: null,
  leveragePolicy: null,
  reduceOnly: false,
  takeProfitBps: null,
  stopLossBps: null,
  trailingStopBps: null,
  stopCopyConditions: null,
  ...over,
});

const leaderEvent = (over: Partial<LeaderEvent> = {}): LeaderEvent => ({
  eventId: 'evt-1',
  orderId: 'ord-1',
  fillId: 'fill-1',
  symbol: 'BTC-USDT',
  exchangeSymbol: 'BTCUSDT',
  side: 'BUY',
  type: 'MARKET',
  quantity: '1.0',
  price: '60000',
  stopPrice: null,
  venue: 'BINANCE',
  timestamp: '2026-10-07T00:00:00.000Z',
  isSimulated: false,
  ...over,
});

const BTC_META = {
  exchangeSymbol: 'BTCUSDT',
  tickSize: '0.01',
  quantityStep: '0.00001',
  minQuantity: '0.00001',
  minNotional: '5',
};

const makeMapper = (symbol: any = BTC_META, lookupError: Error | null = null) => {
  const symbolService: any = {
    getSymbol: jest.fn(async () => {
      if (lookupError) throw lookupError;
      return symbol;
    }),
  };
  const prisma: any = {};
  return new CopyOrderMapperService(prisma, symbolService as any);
};

const plan = (mapper: CopyOrderMapperService, input: any) =>
  mapper.planLeaderToFollower({
    tenantId: 'tenant-1',
    followerAccountId: 'acct-1',
    ...input,
  });

describe('CopyOrderMapperService — follower sizing', () => {
  it('sizes PERCENTAGE_BALANCE from the FOLLOWER balance, not the leader quantity', async () => {
    const mapper = makeMapper();

    const result = await plan(mapper, {
      leaderEvent: leaderEvent({ quantity: '100', price: '60000' }),
      allocationAmount: '10', // 10% of the follower's own balance
      allocationMode: CopySizingMode.PERCENTAGE_BALANCE,
      copyPolicy: basePolicy(),
      followerBalance: '1000',
      leaderTotalBalance: '5000000',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 10% of 1,000 USDT at 60,000 is 0.0016666 -> floored to the 0.00001 step.
    expect(result.intent.quantity).toBe('0.00166');
    // The old code produced "10" here: a 600,000 USDT order on a 1,000 USDT balance.
    expect(Number(result.intent.quantity)).toBeLessThan(0.01);
    expect(Number(result.intent.notional)).toBeLessThanOrEqual(1000);
  });

  it('refuses PERCENTAGE_BALANCE without a follower balance', async () => {
    const mapper = makeMapper();
    const result = await plan(mapper, {
      leaderEvent: leaderEvent(),
      allocationAmount: '10',
      allocationMode: CopySizingMode.PERCENTAGE_BALANCE,
      copyPolicy: basePolicy(),
      followerBalance: null,
    });

    expect(result).toMatchObject({ ok: false, rejection: { code: 'MISSING_FOLLOWER_BALANCE' } });
  });

  it('refuses a percentage outside (0, 100]', async () => {
    const mapper = makeMapper();
    const result = await plan(mapper, {
      leaderEvent: leaderEvent(),
      allocationAmount: '150',
      allocationMode: CopySizingMode.PERCENTAGE_BALANCE,
      copyPolicy: basePolicy(),
      followerBalance: '1000',
    });

    expect(result).toMatchObject({ ok: false, rejection: { code: 'INVALID_PERCENTAGE' } });
  });

  it('refuses PROPORTIONAL sizing with no ratio and no comparable balances', async () => {
    const mapper = makeMapper();
    const result = await plan(mapper, {
      leaderEvent: leaderEvent({ quantity: '50', price: null }),
      allocationAmount: '1000',
      allocationMode: CopySizingMode.PROPORTIONAL,
      copyPolicy: basePolicy(),
      followerBalance: null,
      leaderTotalBalance: null,
    });

    // The old code returned `leaderQty` (50 BTC) on this path.
    expect(result).toMatchObject({ ok: false, rejection: { code: 'MISSING_PROPORTIONAL_BASIS' } });
  });

  it('scales PROPORTIONAL by the follower/leader portfolio ratio', async () => {
    const mapper = makeMapper();
    const result = await plan(mapper, {
      leaderEvent: leaderEvent({ quantity: '2', price: '60000' }),
      allocationAmount: '1000', // follower's allocation
      allocationMode: CopySizingMode.PROPORTIONAL,
      copyPolicy: basePolicy(),
      followerBalance: '1000',
      leaderTotalBalance: '200000', // leader runs a 200x larger book
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 2 BTC * (1000 / 200000) = 0.01 BTC, worth 600 USDT — inside the balance.
    expect(result.intent.quantity).toBe('0.01');
    expect(Number(result.intent.notional)).toBeLessThanOrEqual(1000);
  });
});

describe('CopyOrderMapperService — venue metadata is mandatory', () => {
  it('rejects the copy when the symbol registry throws', async () => {
    const mapper = makeMapper(null, new Error('symbol registry unavailable'));

    const result = await plan(mapper, {
      leaderEvent: leaderEvent({ quantity: '0.5', price: '60000' }),
      allocationAmount: '0.5',
      allocationMode: CopySizingMode.FIXED,
      copyPolicy: basePolicy({ fixedQuantity: '0.5' }),
      followerBalance: '1000',
    });

    expect(result).toMatchObject({ ok: false, rejection: { code: 'SYMBOL_METADATA_UNAVAILABLE' } });
  });

  it('rejects the copy when the symbol is not registered', async () => {
    const mapper = makeMapper(null);
    const result = await plan(mapper, {
      leaderEvent: leaderEvent(),
      allocationAmount: '1',
      allocationMode: CopySizingMode.FIXED,
      copyPolicy: basePolicy({ fixedQuantity: '1' }),
      followerBalance: '1000',
    });

    expect(result).toMatchObject({ ok: false, rejection: { code: 'SYMBOL_NOT_REGISTERED' } });
  });

  it('rejects unusable venue precision instead of assuming a step', async () => {
    const mapper = makeMapper({ ...BTC_META, quantityStep: '0' });
    const result = await plan(mapper, {
      leaderEvent: leaderEvent(),
      allocationAmount: '1',
      allocationMode: CopySizingMode.FIXED,
      copyPolicy: basePolicy({ fixedQuantity: '1' }),
      followerBalance: '1000000',
    });

    expect(result).toMatchObject({ ok: false, rejection: { code: 'INVALID_EXCHANGE_PRECISION' } });
  });
});

describe('CopyOrderMapperService — quantity and notional guards', () => {
  it('never emits a zero-quantity order', async () => {
    const mapper = makeMapper();
    const result = await plan(mapper, {
      leaderEvent: leaderEvent({ quantity: '1', price: null }),
      allocationAmount: '0',
      allocationMode: CopySizingMode.FIXED,
      copyPolicy: basePolicy({ fixedQuantity: '0' }),
      followerBalance: '1000',
    });

    expect(result.ok).toBe(false);
  });

  it('rejects a size that rounds below one step', async () => {
    const mapper = makeMapper();
    const result = await plan(mapper, {
      leaderEvent: leaderEvent(),
      allocationAmount: '1',
      allocationMode: CopySizingMode.FIXED,
      copyPolicy: basePolicy({ fixedQuantity: '0.000001' }), // step is 0.00001
      followerBalance: '1000',
    });

    expect(result).toMatchObject({ ok: false, rejection: { code: 'SIZE_BELOW_STEP' } });
  });

  it('enforces maxOrderNotional on MARKET orders that carry no price', async () => {
    const mapper = makeMapper();
    const result = await plan(mapper, {
      leaderEvent: leaderEvent({ quantity: '50', price: null }), // MARKET
      allocationAmount: '1',
      allocationMode: CopySizingMode.PROPORTIONAL,
      copyPolicy: basePolicy({ proportionalRatio: '1', maxOrderNotional: '100' }),
      followerBalance: '1000',
      referencePrice: '60000', // mark price lets the cap be evaluated
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 100 USDT / 60,000 = 0.001666.. -> 0.00166 at the 0.00001 step.
    expect(result.intent.quantity).toBe('0.00166');
    expect(Number(result.intent.notional)).toBeLessThanOrEqual(100);
  });

  it('refuses the notional cap when no price exists to evaluate it', async () => {
    const mapper = makeMapper();
    const result = await plan(mapper, {
      leaderEvent: leaderEvent({ quantity: '50', price: null }),
      allocationAmount: '1',
      allocationMode: CopySizingMode.PROPORTIONAL,
      copyPolicy: basePolicy({ proportionalRatio: '1', maxOrderNotional: '100' }),
      followerBalance: '1000',
      referencePrice: null,
    });

    expect(result).toMatchObject({ ok: false, rejection: { code: 'MISSING_REFERENCE_PRICE' } });
  });

  it('refuses an order worth more than the follower balance', async () => {
    const mapper = makeMapper();
    const result = await plan(mapper, {
      leaderEvent: leaderEvent({ quantity: '1', price: '60000' }),
      allocationAmount: '1',
      allocationMode: CopySizingMode.PROPORTIONAL,
      copyPolicy: basePolicy({ proportionalRatio: '1' }), // 1 BTC = 60,000 USDT
      followerBalance: '1000',
    });

    expect(result).toMatchObject({ ok: false, rejection: { code: 'EXCEEDS_FOLLOWER_BALANCE' } });
  });
});

describe('CopyOrderMapperService — precision and price output', () => {
  it('keeps full precision for a fine venue step (no 12-dp truncation)', async () => {
    const mapper = makeMapper({ ...BTC_META, quantityStep: '0.000000000000000001', minQuantity: '0.000000000000000001', minNotional: '0' });
    const result = await plan(mapper, {
      leaderEvent: leaderEvent({ price: '60000' }),
      allocationAmount: '0.0000123456789',
      allocationMode: CopySizingMode.FIXED,
      copyPolicy: basePolicy({ fixedQuantity: '0.0000123456789' }),
      followerBalance: '1000',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intent.quantity).toBe('0.0000123456789');
  });

  it('never emits exponent notation, even for a sub-satoshi ratio', async () => {
    const mapper = makeMapper({ ...BTC_META, quantityStep: '0.000000000000000001', minQuantity: '0', minNotional: '0' });
    const result = await plan(mapper, {
      leaderEvent: leaderEvent({ quantity: '1000000', price: '1' }),
      allocationAmount: '100', // 100% of balance
      allocationMode: CopySizingMode.PERCENTAGE_BALANCE,
      copyPolicy: basePolicy(),
      followerBalance: '0.0000001', // 1e-7 budget at price 1 -> 0.0000001
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intent.quantity).not.toMatch(/e/i);
    expect(result.intent.quantity).toBe('0.0000001');
  });

  it('produces tick-aligned slippage bounds around the fill price', async () => {
    const mapper = makeMapper();
    const result = await plan(mapper, {
      leaderEvent: leaderEvent({ side: 'BUY', price: '60000' }),
      allocationAmount: '0.0001',
      allocationMode: CopySizingMode.FIXED,
      copyPolicy: basePolicy({ fixedQuantity: '0.0001', slippageToleranceBps: 50 }),
      followerBalance: '1000',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 50 bps of 60,000 = 300 -> ceiling 60,300, floor at the fill price.
    expect(result.intent.slippageUpper).toBe('60300');
    expect(result.intent.slippageLower).toBe('60000');
  });

  it('computes take-profit and stop-loss targets from the tick-aligned price', async () => {
    const mapper = makeMapper();
    const result = await plan(mapper, {
      leaderEvent: leaderEvent({ side: 'BUY', price: '60000' }),
      allocationAmount: '0.0001',
      allocationMode: CopySizingMode.FIXED,
      copyPolicy: basePolicy({ fixedQuantity: '0.0001', takeProfitBps: 200, stopLossBps: 100 }),
      followerBalance: '1000',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intent.takeProfitPrice).toBe('61200'); // +2%
    expect(result.intent.stopLossPrice).toBe('59400'); // -1%
  });
});

describe('CopyOrderMapperService — policy gates still apply', () => {
  it('rejects blocked symbols, non-allowed symbols and disallowed sides', async () => {
    const mapper = makeMapper();
    const common = {
      leaderEvent: leaderEvent(),
      allocationAmount: '1',
      allocationMode: CopySizingMode.FIXED as CopySizingMode,
      followerBalance: '1000',
    };

    await expect(
      plan(mapper, { ...common, copyPolicy: basePolicy({ fixedQuantity: '1', blockedSymbols: ['BTC-USDT'] }) }),
    ).resolves.toMatchObject({ ok: false, rejection: { code: 'SYMBOL_BLOCKED' } });

    await expect(
      plan(mapper, { ...common, copyPolicy: basePolicy({ fixedQuantity: '1', allowedSymbols: ['ETH-USDT'] }) }),
    ).resolves.toMatchObject({ ok: false, rejection: { code: 'SYMBOL_NOT_ALLOWED' } });

    await expect(
      plan(mapper, { ...common, copyPolicy: basePolicy({ fixedQuantity: '1', allowedSides: ['SELL'] }) }),
    ).resolves.toMatchObject({ ok: false, rejection: { code: 'SIDE_NOT_ALLOWED' } });
  });

  it('clamps the execution delay into [0, 60000]', async () => {
    const mapper = makeMapper();
    const result = await plan(mapper, {
      leaderEvent: leaderEvent(),
      allocationAmount: '0.0001',
      allocationMode: CopySizingMode.FIXED,
      copyPolicy: basePolicy({ fixedQuantity: '0.0001', executionDelayMs: 10_000_000 }),
      followerBalance: '1000',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intent.executionDelayMs).toBe(60_000);
  });

  it('honours an explicit reduce-only override', async () => {
    const mapper = makeMapper();
    const result = await plan(mapper, {
      leaderEvent: leaderEvent(),
      allocationAmount: '0.0001',
      allocationMode: CopySizingMode.FIXED,
      copyPolicy: basePolicy({ fixedQuantity: '0.0001' }),
      followerBalance: '1000',
      isReduceOnly: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intent.isReduceOnly).toBe(true);
  });
});
