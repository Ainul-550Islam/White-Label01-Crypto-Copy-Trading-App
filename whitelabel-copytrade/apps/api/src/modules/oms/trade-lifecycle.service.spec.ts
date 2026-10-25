// # Responsibility: retain every historical trade-lifecycle case name and prove native callback placement, exact arithmetic, tenant binding and failure propagation without claiming live PostgreSQL rollback/concurrency.
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma, OmsTradeState, type OmsTrade } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TradeLifecycleService } from './trade-lifecycle.service';

const FILL = {
  tenantId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', accountId: '3f2504e0-4f89-41d3-9a0c-0305e82c3302', symbol: 'BTC-USDT',
  orderIntentId: '3f2504e0-4f89-41d3-9a0c-0305e82c3303', fillId: '3f2504e0-4f89-41d3-9a0c-0305e82c3304',
  fillQuantity: '0.25', fillPrice: '68000.125', fillSide: 'BUY', isSimulated: true,
};
function record(overrides: Partial<OmsTrade> = {}): OmsTrade {
  return { id: 'trade-1', tenantId: FILL.tenantId, accountId: FILL.accountId, symbol: FILL.symbol, venue: null, strategyId: null,
    traderId: null, followerId: null, state: OmsTradeState.OPEN, side: 'LONG', openQuantity: '10', closedQuantity: '0', remainingQuantity: '10',
    averageEntryPrice: '100', averageExitPrice: null, totalFee: '0', orderIds: [], fillIds: [], positionRef: null, openedAt: new Date('2026-10-01T00:00:00Z'),
    closedAt: null, correlationId: null, isSimulated: true, metadata: {}, createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-01T00:00:00Z'),
    orderIntentId: null, ...overrides };
}
const modules: TestingModule[] = [];
afterEach(async () => { for (const module of modules.splice(0)) await module.close(); });
async function build(existing: OmsTrade | null = null, applied: OmsTrade | null = null) {
  const persisted = record({ id: 'persisted', remainingQuantity: FILL.fillQuantity });
  const delegate = {
    findFirst: jest.fn<(args: Prisma.OmsTradeFindFirstArgs) => Promise<OmsTrade | null>>().mockResolvedValueOnce(applied).mockResolvedValue(existing),
    create: jest.fn<(args: Prisma.OmsTradeCreateArgs) => Promise<OmsTrade>>().mockResolvedValue(persisted),
    update: jest.fn<(args: Prisma.OmsTradeUpdateArgs) => Promise<OmsTrade>>().mockResolvedValue(persisted),
  };
  const tx = { omsTrade: delegate };
  const prisma = { omsTrade: delegate, $transaction: jest.fn<(callback: (client: typeof tx) => Promise<OmsTrade>, options?: { isolationLevel: Prisma.TransactionIsolationLevel }) => Promise<OmsTrade>>()
    .mockImplementation(async (callback) => callback(tx)) };
  const module = await Test.createTestingModule({ providers: [TradeLifecycleService, { provide: PrismaService, useValue: prisma }] }).compile();
  modules.push(module); return { service: module.get<TradeLifecycleService>(TradeLifecycleService), prisma, delegate, persisted };
}

describe('TradeLifecycleService position-limit accounting contract', () => {
  it('does not apply a replayed fill twice when its fill ID is already stored on a trade', async () => {
    const existingTrade = record({ fillIds: [FILL.fillId], remainingQuantity: '0.25' }); const { service, delegate } = await build(null, existingTrade);
    expect(await service.buildOrUpdateTradeFromFill({ ...FILL })).toBe(existingTrade);
    expect(delegate.findFirst).toHaveBeenCalledWith({ where: { tenantId: FILL.tenantId, accountId: FILL.accountId, fillIds: { has: FILL.fillId } } });
    expect(delegate.create).not.toHaveBeenCalled(); expect(delegate.update).not.toHaveBeenCalled();
  });
  it('surfaces a trade-row write failure instead of returning a synthetic open trade to the position limiter', async () => {
    const writeFailure = Object.assign(new Error('durable trade write unavailable'), { code: 'P1001' }); const { service, delegate } = await build(); delegate.create.mockRejectedValueOnce(writeFailure);
    await expect(service.buildOrUpdateTradeFromFill({ ...FILL })).rejects.toBe(writeFailure);
    expect(delegate.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: FILL.tenantId, accountId: FILL.accountId, symbol: FILL.symbol,
      state: 'OPEN', side: 'LONG', remainingQuantity: FILL.fillQuantity, fillIds: [FILL.fillId] }) });
  });
  it('persists a new trade before returning a position-slot lifecycle record', async () => {
    const { service, delegate, persisted, prisma } = await build(); expect(await service.buildOrUpdateTradeFromFill({ ...FILL })).toBe(persisted);
    expect(delegate.create).toHaveBeenCalledTimes(1); expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  });
  it('does not reopen previously closed quantity when increasing a partially reduced trade', async () => {
    const { service, delegate } = await build(record({ state: OmsTradeState.PARTIAL, openQuantity: '10', closedQuantity: '6', remainingQuantity: '4' }));
    await service.buildOrUpdateTradeFromFill({ ...FILL, fillQuantity: '2', fillPrice: '160' });
    expect(delegate.update).toHaveBeenCalledWith({ where: { id: 'trade-1', tenantId: FILL.tenantId, accountId: FILL.accountId, state: OmsTradeState.PARTIAL, remainingQuantity: '4' },
      data: expect.objectContaining({ openQuantity: '12', remainingQuantity: '6', averageEntryPrice: '120', fillIds: { push: FILL.fillId } }) });
  });
  it('keeps tiny weighted entry notional until the final division', async () => {
    const { service, delegate } = await build(record({ openQuantity: '0.000000000001', remainingQuantity: '0.000000000001', averageEntryPrice: '0.000000000001' }));
    await service.buildOrUpdateTradeFromFill({ ...FILL, fillQuantity: '0.000000000001', fillPrice: '0.000000000001' });
    expect(delegate.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ averageEntryPrice: '0.000000000001' }) }));
  });
  it('retains prior closed quantity when the remaining trade fully closes', async () => {
    const { service, delegate } = await build(record({ state: OmsTradeState.PARTIAL, openQuantity: '10', closedQuantity: '6', remainingQuantity: '4' }));
    await service.buildOrUpdateTradeFromFill({ ...FILL, fillSide: 'SELL', fillQuantity: '4' });
    expect(delegate.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ closedQuantity: '10', remainingQuantity: '0', state: OmsTradeState.CLOSED }) }));
  });
  it('does not select another venue, strategy or simulation mode as the open trade', async () => {
    const { service, delegate } = await build(); await service.buildOrUpdateTradeFromFill({ ...FILL, venue: 'BINANCE' });
    expect(delegate.findFirst).toHaveBeenCalledWith({ where: { tenantId: FILL.tenantId, accountId: FILL.accountId, symbol: FILL.symbol, venue: 'BINANCE', isSimulated: true,
      strategyId: null, state: { in: [OmsTradeState.OPEN, OmsTradeState.PARTIAL] } }, orderBy: { createdAt: 'desc' } });
  });
  it.each([{ fillSide: 'UNKNOWN' }, { fillQuantity: '0' }, { fillQuantity: '-1' }, { fillPrice: 'NaN' }, { fillPrice: '0' }, { fillQuantity: '0.0000000000001' }, { fillPrice: '1.0000000000001' }])
    ('denies invalid or lossily scaled fill evidence %j', async (override) => {
      const { service, delegate } = await build(); await expect(service.buildOrUpdateTradeFromFill({ ...FILL, ...override })).rejects.toThrow();
      expect(delegate.findFirst).not.toHaveBeenCalled(); expect(delegate.create).not.toHaveBeenCalled(); expect(delegate.update).not.toHaveBeenCalled();
    });
  it('propagates an unavailable idempotency read without opening a second trade', async () => {
    const { service, delegate } = await build(); delegate.findFirst.mockRejectedValueOnce(new Error('unreadable'));
    await expect(service.buildOrUpdateTradeFromFill({ ...FILL })).rejects.toThrow(); expect(delegate.create).not.toHaveBeenCalled();
  });
  it('propagates a failed opposite-side remainder write from inside the transaction callback', async () => {
    const { service, delegate, prisma } = await build(record()); delegate.create.mockRejectedValueOnce(new Error('flip write unavailable'));
    await expect(service.buildOrUpdateTradeFromFill({ ...FILL, fillSide: 'SELL', fillQuantity: '12' })).rejects.toThrow();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1); expect(delegate.update).toHaveBeenCalled(); expect(delegate.create).toHaveBeenCalled();
  });
});
