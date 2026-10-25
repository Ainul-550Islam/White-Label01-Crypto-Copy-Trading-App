// # Responsibility: retain every Finding 29 case name while strengthening required copy/source failures and native financial evidence; prove transaction placement and scoped reads without claiming live PostgreSQL rollback/concurrency.
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { type Order, type Fill, type CopyExecution, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ExchangeEnvironment, ExchangeSyncState, ExchangeVenue, ExchangeOrderSide, ExchangeOrderType, ExchangeOrderStatus, type ExchangeFill, type ExchangeOrder } from './exchange.types';
import { ExchangeOrderSyncService } from './exchange-order-sync.service';
import { ExchangeProviderFactory } from './exchange-provider.factory';
import { type ExchangeProvider } from './exchange-provider.interface';
import { ExchangeCredentialService } from './exchange-credential.service';
import { ExchangeAccountRepository, type ExchangeAccountRecord } from './exchange-account.repository';
import { ExchangeAuditService } from './exchange-audit.service';
import { TradeLifecycleService } from '../oms/trade-lifecycle.service';

const TENANT_ID = '11111111-2222-4333-8444-555555555555';
const ACCOUNT_ID = '22222222-3333-4444-8555-666666666666';
const ORDER_ID = '33333333-4444-4555-8666-777777777777';
const TRADER_ID = '44444444-5555-4666-8777-888888888888';
const FOLLOWER_ID = '55555555-6666-4777-8888-999999999999';
const modules: TestingModule[] = [];
afterEach(async () => { for (const module of modules.splice(0)) await module.close(); });

function providerFill(overrides: Partial<ExchangeFill> = {}): ExchangeFill {
  return { providerTradeId: 'venue-trade-1', providerOrderId: 'venue-order-1', clientOrderId: 'client-order-1', symbol: 'BTC-USDT',
    side: ExchangeOrderSide.BUY, price: '60000.5', quantity: '0.25', quoteQuantity: '15000.125', fee: '6.00005', feeCurrency: 'USDT',
    isMaker: false, timestampMicros: '1760000000000000', isSimulated: false, ...overrides };
}
function providerOrder(): ExchangeOrder {
  return { clientOrderId: 'client-order-1', providerOrderId: 'venue-order-1', symbol: 'BTC-USDT', exchangeSymbol: 'BTCUSDT',
    side: ExchangeOrderSide.BUY, type: ExchangeOrderType.LIMIT, status: ExchangeOrderStatus.NEW, providerRawStatus: 'NEW',
    quantity: '0.25', price: '60000.5', stopPrice: null, filledQuantity: '0', averagePrice: null, fee: null, feeCurrency: null,
    createdAtMicros: null, updatedAtMicros: null, isSimulated: false };
}
function uniquenessFailure(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('unit uniqueness conflict without scoped proof', { code: 'P2002', clientVersion: 'unit' });
}
type OrderContext = Pick<Order, 'id' | 'accountId' | 'symbol' | 'venue' | 'strategyId'>;
function orderRecord(overrides: Partial<OrderContext> = {}): OrderContext {
  return { id: ORDER_ID, accountId: ACCOUNT_ID, symbol: 'BTC-USDT', venue: 'BINANCE', strategyId: 'strategy-1', ...overrides };
}
async function build(options: { order?: OrderContext | null; execution?: Pick<CopyExecution, 'traderId' | 'followerId'> | null;
  existingFill?: Pick<Fill, 'id'> | null; fill?: ExchangeFill; orders?: ExchangeOrder[]; executionLookupThrows?: boolean } = {}) {
  const order = options.order === undefined ? orderRecord() : options.order;
  const txFillCreate = jest.fn<(args: Prisma.FillCreateArgs) => Promise<void>>().mockResolvedValue(undefined);
  const rootFillCreate = jest.fn<(args: Prisma.FillCreateArgs) => Promise<void>>().mockResolvedValue(undefined);
  const tx = { fill: { create: txFillCreate } };
  const prisma = {
    fill: { findFirst: jest.fn<(args: Prisma.FillFindFirstArgs) => Promise<Pick<Fill, 'id'> | null>>().mockResolvedValue(options.existingFill ?? null), create: rootFillCreate },
    order: { findFirst: jest.fn<(args: Prisma.OrderFindFirstArgs) => Promise<OrderContext | null>>().mockResolvedValue(order),
      create: jest.fn<(args: Prisma.OrderCreateArgs) => Promise<void>>().mockResolvedValue(undefined) },
    tradingSymbol: { findFirst: jest.fn<(args: Prisma.TradingSymbolFindFirstArgs) => Promise<{ id: string } | null>>().mockResolvedValue({ id: 'unit-native-symbol' }) },
    copyExecution: { findFirst: jest.fn<(args: Prisma.CopyExecutionFindFirstArgs) => Promise<Pick<CopyExecution, 'traderId' | 'followerId'> | null>>().mockImplementation(async () => {
      if (options.executionLookupThrows) throw new Error('copy-execution read failed');
      return options.execution === undefined ? { traderId: TRADER_ID, followerId: FOLLOWER_ID } : options.execution;
    }) },
    $transaction: jest.fn<(callback: (client: typeof tx) => Promise<unknown>) => Promise<unknown>>().mockImplementation(async (callback) => callback(tx)),
  };
  const provider = { getTradeHistory: jest.fn<ExchangeProvider['getTradeHistory']>().mockResolvedValue([options.fill ?? providerFill()]),
    getOpenOrders: jest.fn<ExchangeProvider['getOpenOrders']>().mockResolvedValue(options.orders ?? []),
    getOrderHistory: jest.fn<ExchangeProvider['getOrderHistory']>().mockResolvedValue([]) };
  const providerFactory = { getProvider: jest.fn<() => Pick<ExchangeProvider, 'getTradeHistory' | 'getOpenOrders' | 'getOrderHistory'>>().mockReturnValue(provider) };
  const credentialService = { getDecryptedCredentialsForProvider: jest.fn<ExchangeCredentialService['getDecryptedCredentialsForProvider']>()
    .mockResolvedValue({ apiKey: 'unit-key', apiSecret: 'unit-credential' }) };
  const accountRepo = { findById: jest.fn<(id: string, tenantId: string) => Promise<Pick<ExchangeAccountRecord, 'tenantId' | 'venue' | 'environment' | 'isSandbox'> | null>>()
    .mockResolvedValue({ tenantId: TENANT_ID, venue: ExchangeVenue.BINANCE, environment: ExchangeEnvironment.LIVE, isSandbox: false }) };
  const auditService = { record: jest.fn<ExchangeAuditService['record']>().mockResolvedValue(undefined) };
  const tradeLifecycleService = { buildOrUpdateTradeFromFill: jest.fn<(params: Parameters<TradeLifecycleService['buildOrUpdateTradeFromFill']>[0],
    options?: Parameters<TradeLifecycleService['buildOrUpdateTradeFromFill']>[1]) => Promise<void>>().mockResolvedValue(undefined) };
  const module = await Test.createTestingModule({ providers: [ExchangeOrderSyncService, { provide: PrismaService, useValue: prisma },
    { provide: ExchangeProviderFactory, useValue: providerFactory }, { provide: ExchangeCredentialService, useValue: credentialService },
    { provide: ExchangeAccountRepository, useValue: accountRepo }, { provide: ExchangeAuditService, useValue: auditService },
    { provide: TradeLifecycleService, useValue: tradeLifecycleService },
  ] }).compile();
  modules.push(module);
  const service = module.get<ExchangeOrderSyncService>(ExchangeOrderSyncService);
  return { service, prisma, tx, txFillCreate, rootFillCreate, tradeLifecycleService, accountRepo };
}
function syncInput() { return { tenantId: TENANT_ID, accountId: ACCOUNT_ID, venue: ExchangeVenue.BINANCE, environment: ExchangeEnvironment.LIVE, symbol: 'BTC-USDT' }; }

describe('ExchangeOrderSyncService fill persistence (Finding 29)', () => {
  it('writes the fill and applies it to the canonical trade in one transaction', async () => {
    const { service, prisma, tx, txFillCreate, tradeLifecycleService } = await build();
    const result = await service.syncFills(syncInput());
    expect(result.state).toBe(ExchangeSyncState.COMPLETED); expect(result.created).toBe(1); expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(txFillCreate).toHaveBeenCalledTimes(1); expect(tradeLifecycleService.buildOrUpdateTradeFromFill).toHaveBeenCalledTimes(1);
    const first = tradeLifecycleService.buildOrUpdateTradeFromFill.mock.calls[0];
    expect(first?.[1]?.client).toBe(tx); expect(txFillCreate.mock.calls[0]?.[0].data.id).toBe(first?.[0].fillId);
    expect(txFillCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ price: '60000.5', quantity: '0.25', fee: '6.00005', source: 'RECONCILIATION' }) });
  });
  it('builds the trade from the order identity and the execution copy attribution, not from the fill symbol', async () => {
    const { service, tradeLifecycleService } = await build({ order: orderRecord(), fill: providerFill({ symbol: 'BTCUSDT' }) });
    await service.syncFills(syncInput());
    expect(tradeLifecycleService.buildOrUpdateTradeFromFill.mock.calls[0]?.[0]).toMatchObject({ tenantId: TENANT_ID, accountId: ACCOUNT_ID, symbol: 'BTC-USDT',
      venue: 'BINANCE', strategyId: 'strategy-1', orderIntentId: ORDER_ID, traderId: TRADER_ID, followerId: FOLLOWER_ID,
      fillQuantity: '0.25', fillPrice: '60000.5', fillSide: ExchangeOrderSide.BUY, isSimulated: false });
  });
  it('leaves the attribution null rather than inventing it when the execution record is unreadable', async () => {
    // Historical case name retained. An unread required source now blocks the write, which is stronger than manufacturing an unattributed completed trade.
    const { service, prisma, tradeLifecycleService } = await build({ executionLookupThrows: true });
    expect(await service.syncFills(syncInput())).toMatchObject({ state: ExchangeSyncState.FAILED, created: 0, skipped: 1 });
    expect(prisma.$transaction).not.toHaveBeenCalled(); expect(tradeLifecycleService.buildOrUpdateTradeFromFill).not.toHaveBeenCalled();
  });
  it('writes nothing at all when the order cannot be resolved', async () => {
    const { service, prisma, txFillCreate, tradeLifecycleService } = await build({ order: null });
    expect(await service.syncFills(syncInput())).toMatchObject({ state: ExchangeSyncState.FAILED, created: 0, skipped: 1 });
    expect(prisma.$transaction).not.toHaveBeenCalled(); expect(txFillCreate).not.toHaveBeenCalled(); expect(tradeLifecycleService.buildOrUpdateTradeFromFill).not.toHaveBeenCalled();
  });
  it('records a fill with a non-decimal price but builds no trade from it', async () => {
    // Historical case name retained. The native schema cannot retain a non-decimal price, so neither a fake zero fill nor a trade is now recorded.
    const { service, prisma, txFillCreate, tradeLifecycleService } = await build({ fill: providerFill({ price: 'not-a-number' }) });
    expect(await service.syncFills(syncInput())).toMatchObject({ state: ExchangeSyncState.FAILED, created: 0 });
    expect(prisma.$transaction).not.toHaveBeenCalled(); expect(txFillCreate).not.toHaveBeenCalled(); expect(tradeLifecycleService.buildOrUpdateTradeFromFill).not.toHaveBeenCalled();
  });
  it('does not re-apply a fill that is already persisted', async () => {
    const { service, prisma, tradeLifecycleService } = await build({ existingFill: { id: 'existing' } });
    expect(await service.syncFills(syncInput())).toMatchObject({ state: ExchangeSyncState.COMPLETED, created: 0, skipped: 1 });
    expect(prisma.fill.findFirst).toHaveBeenCalledWith({ where: { orderId: ORDER_ID, venueTradeId: 'venue-trade-1', order: { tenantId: TENANT_ID, accountId: ACCOUNT_ID } } });
    expect(prisma.$transaction).not.toHaveBeenCalled(); expect(tradeLifecycleService.buildOrUpdateTradeFromFill).not.toHaveBeenCalled();
  });
  it('preserves a genuinely absent copy-execution record as unattributed without inventing a follower', async () => {
    const { service, tradeLifecycleService } = await build({ execution: null });
    expect(await service.syncFills(syncInput())).toMatchObject({ state: ExchangeSyncState.COMPLETED, created: 1 });
    expect(tradeLifecycleService.buildOrUpdateTradeFromFill.mock.calls[0]?.[0]).toMatchObject({ traderId: null, followerId: null });
  });
  it.each([{ fee: null }, { feeCurrency: null }, { isMaker: null }])('does not invent missing fill fee/currency/maker evidence %j', async (overrides) => {
    const { service, prisma } = await build({ fill: providerFill(overrides) });
    expect(await service.syncFills(syncInput())).toMatchObject({ state: ExchangeSyncState.FAILED, created: 0 }); expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('does not persist a value that would be rounded by native Decimal(28,12)', async () => {
    const { service, prisma } = await build({ fill: providerFill({ quantity: '0.0000000000001' }) });
    expect(await service.syncFills(syncInput())).toMatchObject({ state: ExchangeSyncState.FAILED, created: 0 }); expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('does not route a fill into a different account even if a bad repository row is returned', async () => {
    const { service, prisma } = await build({ order: orderRecord({ accountId: 'another-account' }) });
    expect(await service.syncFills(syncInput())).toMatchObject({ state: ExchangeSyncState.FAILED, created: 0 }); expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('does not ingest simulated provider evidence as a LIVE fill', async () => {
    const { service, prisma } = await build({ fill: providerFill({ isSimulated: true }) });
    expect(await service.syncFills(syncInput())).toMatchObject({ state: ExchangeSyncState.FAILED, created: 0 }); expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('does not complete synchronization after a required native fill write fails', async () => {
    const { service, txFillCreate, tradeLifecycleService } = await build(); txFillCreate.mockRejectedValueOnce(new Error('fill store unavailable'));
    expect(await service.syncFills(syncInput())).toMatchObject({ state: ExchangeSyncState.FAILED, created: 0 }); expect(tradeLifecycleService.buildOrUpdateTradeFromFill).not.toHaveBeenCalled();
  });
  it('does not report successful completion when the canonical trade builder fails inside the transaction', async () => {
    const { service, tradeLifecycleService, prisma } = await build(); tradeLifecycleService.buildOrUpdateTradeFromFill.mockRejectedValueOnce(new Error('trade store unavailable'));
    expect(await service.syncFills(syncInput())).toMatchObject({ state: ExchangeSyncState.FAILED, created: 0 }); expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
  it('does not treat a native fill uniqueness conflict without matching scoped proof as completed idempotency', async () => {
    const { service, txFillCreate, tradeLifecycleService } = await build(); txFillCreate.mockRejectedValueOnce(uniquenessFailure());
    expect(await service.syncFills(syncInput())).toMatchObject({ state: ExchangeSyncState.FAILED, created: 0, skipped: 1 });
    expect(tradeLifecycleService.buildOrUpdateTradeFromFill).not.toHaveBeenCalled();
  });
  it('does not hide a canonical trade uniqueness failure as a successful fill duplicate', async () => {
    const { service, tradeLifecycleService } = await build(); tradeLifecycleService.buildOrUpdateTradeFromFill.mockRejectedValueOnce(uniquenessFailure());
    expect(await service.syncFills(syncInput())).toMatchObject({ state: ExchangeSyncState.FAILED, created: 0, skipped: 1 });
  });
  it('does not treat another native order uniqueness conflict as completed account-scoped idempotency', async () => {
    const { service, prisma } = await build({ order: null, orders: [providerOrder()] }); prisma.order.create.mockRejectedValueOnce(uniquenessFailure());
    expect(await service.syncOrders(syncInput())).toMatchObject({ state: ExchangeSyncState.FAILED, created: 0, updated: 0, skipped: 1 });
    expect(prisma.order.findFirst).toHaveBeenCalledWith({ where: { tenantId: TENANT_ID, accountId: ACCOUNT_ID, clientOrderId: 'client-order-1' } });
  });
  it('does not let an existing receipt bypass an invalid order/account binding', async () => {
    const { service, prisma } = await build({ order: orderRecord({ accountId: 'another-account' }), existingFill: { id: 'existing' } });
    expect(await service.syncFills(syncInput())).toMatchObject({ state: ExchangeSyncState.FAILED, created: 0 });
    expect(prisma.fill.findFirst).not.toHaveBeenCalled(); expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('does not let an existing receipt bypass LIVE-versus-simulated evidence validation', async () => {
    const { service, prisma } = await build({ existingFill: { id: 'existing' }, fill: providerFill({ isSimulated: true }) });
    expect(await service.syncFills(syncInput())).toMatchObject({ state: ExchangeSyncState.FAILED, created: 0 });
    expect(prisma.fill.findFirst).not.toHaveBeenCalled(); expect(prisma.$transaction).not.toHaveBeenCalled();
  });

});
