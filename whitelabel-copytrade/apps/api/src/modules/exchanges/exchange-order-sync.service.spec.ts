// # Responsibility: verifies that a synced fill and the canonical trade it belongs to are written in one transaction, with the order's identity and the execution's copy attribution.

import { ExchangeEnvironment, ExchangeSyncState, ExchangeVenue } from './exchange.types';
import { ExchangeOrderSyncService } from './exchange-order-sync.service';

const TENANT_ID = '11111111-2222-4333-8444-555555555555';
const ACCOUNT_ID = '22222222-3333-4444-8555-666666666666';
const ORDER_ID = '33333333-4444-4555-8666-777777777777';
const TRADER_ID = '44444444-5555-4666-8777-888888888888';
const FOLLOWER_ID = '55555555-6666-4777-8888-999999999999';

function providerFill(overrides: Record<string, unknown> = {}) {
  return {
    providerTradeId: 'venue-trade-1',
    providerOrderId: 'venue-order-1',
    clientOrderId: 'client-order-1',
    symbol: 'BTC-USDT',
    side: 'BUY',
    price: '60000.5',
    quantity: '0.25',
    quoteQuantity: '15000.125',
    fee: '6.00005',
    feeCurrency: 'USDT',
    isMaker: false,
    timestampMicros: '1760000000000000',
    isSimulated: false,
    ...overrides,
  };
}

function build(options: {
  order?: Record<string, unknown> | null;
  execution?: Record<string, unknown> | null;
  existingFill?: Record<string, unknown> | null;
  fill?: Record<string, unknown>;
  executionLookupThrows?: boolean;
} = {}) {
  const order = options.order === undefined
    ? {
        id: ORDER_ID,
        accountId: ACCOUNT_ID,
        symbol: 'BTC-USDT',
        venue: ExchangeVenue.BINANCE,
        strategyId: 'strategy-1',
      }
    : options.order;

  const txFillCreate = jest.fn(async (_args: { data: { id: string } }) => ({}));
  const rootFillCreate = jest.fn(async (_args: unknown) => ({}));
  const transactions: Array<(client: unknown) => Promise<unknown>> = [];

  const tx = { fill: { create: txFillCreate } };
  const prisma = {
    fill: {
      findFirst: jest.fn(async () => options.existingFill ?? null),
      create: rootFillCreate,
    },
    order: { findFirst: jest.fn(async () => order) },
    copyExecution: {
      findFirst: jest.fn(async () => {
        if (options.executionLookupThrows) throw new Error('copy-execution read failed');
        return options.execution === undefined ? { traderId: TRADER_ID, followerId: FOLLOWER_ID } : options.execution;
      }),
    },
    $transaction: jest.fn(async (callback: (client: unknown) => Promise<unknown>) => {
      transactions.push(callback);
      return callback(tx);
    }),
  };

  const providerFactory = {
    getProvider: jest.fn(() => ({
      getTradeHistory: jest.fn(async () => [options.fill ?? providerFill()]),
    })),
  };
  const credentialService = {
    getDecryptedCredentialsForProvider: jest.fn(async () => ({
      apiKey: 'key',
      apiSecret: 'secret',
      passphrase: null,
    })),
  };
  const accountRepo = { updateSyncMetadata: jest.fn(async () => undefined) };
  const auditService = { record: jest.fn(async () => undefined) };
  const tradeLifecycleService = {
    buildOrUpdateTradeFromFill: jest.fn(
      async (_params: Record<string, any>, _options?: { client?: unknown }) => ({ id: 'trade-1' }),
    ),
  };

  const service = new ExchangeOrderSyncService(
    prisma as never,
    providerFactory as never,
    credentialService as never,
    accountRepo as never,
    auditService as never,
    tradeLifecycleService as never,
  );

  return { service, prisma, tx, txFillCreate, rootFillCreate, tradeLifecycleService };
}

function syncInput() {
  return {
    tenantId: TENANT_ID,
    accountId: ACCOUNT_ID,
    venue: ExchangeVenue.BINANCE,
    environment: ExchangeEnvironment.LIVE,
    symbol: 'BTC-USDT',
  };
}

describe('ExchangeOrderSyncService fill persistence (Finding 29)', () => {
  it('writes the fill and applies it to the canonical trade in one transaction', async () => {
    const { service, prisma, tx, txFillCreate, tradeLifecycleService } = build();

    const result = await service.syncFills(syncInput());

    expect(result.state).toBe(ExchangeSyncState.COMPLETED);
    expect(result.created).toBe(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    // The insert happens on the transaction client, so a failure below rolls the fill back with it.
    expect(txFillCreate).toHaveBeenCalledTimes(1);
    expect(tradeLifecycleService.buildOrUpdateTradeFromFill).toHaveBeenCalledTimes(1);

    // The trade is applied on the same client: that shared client is what makes the two writes one
    // unit of work. Applying it on the root client would commit independently of the fill insert.
    const [params, options] = tradeLifecycleService.buildOrUpdateTradeFromFill.mock.calls[0];
    expect(options?.client).toBe(tx);
    expect(txFillCreate.mock.calls[0]?.[0].data.id).toBe(params.fillId);
  });

  it('builds the trade from the order identity and the execution copy attribution, not from the fill symbol', async () => {
    const { service, tradeLifecycleService } = build({
      order: {
        id: ORDER_ID,
        accountId: ACCOUNT_ID,
        symbol: 'BTC-USDT',
        venue: ExchangeVenue.BINANCE,
        strategyId: 'strategy-1',
      },
      fill: providerFill({ symbol: 'BTCUSDT' }),
    });

    await service.syncFills(syncInput());

    const [params] = tradeLifecycleService.buildOrUpdateTradeFromFill.mock.calls[0];
    expect(params).toMatchObject({
      tenantId: TENANT_ID,
      accountId: ACCOUNT_ID,
      symbol: 'BTC-USDT',
      venue: ExchangeVenue.BINANCE,
      strategyId: 'strategy-1',
      orderIntentId: ORDER_ID,
      traderId: TRADER_ID,
      followerId: FOLLOWER_ID,
      fillQuantity: '0.25',
      fillPrice: '60000.5',
      fillSide: 'BUY',
      isSimulated: false,
    });
  });

  it('leaves the attribution null rather than inventing it when the execution record is unreadable', async () => {
    const { service, tradeLifecycleService } = build({ executionLookupThrows: true });

    const result = await service.syncFills(syncInput());

    expect(result.created).toBe(1);
    const [params] = tradeLifecycleService.buildOrUpdateTradeFromFill.mock.calls[0];
    expect(params.traderId).toBeNull();
    expect(params.followerId).toBeNull();
  });

  it('writes nothing at all when the order cannot be resolved', async () => {
    const { service, prisma, txFillCreate, tradeLifecycleService } = build({ order: null });

    const result = await service.syncFills(syncInput());

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(txFillCreate).not.toHaveBeenCalled();
    expect(tradeLifecycleService.buildOrUpdateTradeFromFill).not.toHaveBeenCalled();
  });

  it('records a fill with a non-decimal price but builds no trade from it', async () => {
    const { service, prisma, txFillCreate, tradeLifecycleService } = build({
      fill: providerFill({ price: 'not-a-number' }),
    });

    const result = await service.syncFills(syncInput());

    expect(result.created).toBe(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(txFillCreate).toHaveBeenCalledTimes(1);
    expect(tradeLifecycleService.buildOrUpdateTradeFromFill).not.toHaveBeenCalled();
  });

  it('does not re-apply a fill that is already persisted', async () => {
    const { service, prisma, tradeLifecycleService } = build({ existingFill: { id: 'existing' } });

    const result = await service.syncFills(syncInput());

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tradeLifecycleService.buildOrUpdateTradeFromFill).not.toHaveBeenCalled();
  });
});
