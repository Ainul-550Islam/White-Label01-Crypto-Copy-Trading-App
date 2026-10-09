// # Responsibility: verifies idempotent OMS trade derivation and fail-closed persistence when position-limit accounting requires a durable trade row.

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TradeLifecycleService } from './trade-lifecycle.service';

const FILL = {
  tenantId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  accountId: '3f2504e0-4f89-41d3-9a0c-0305e82c3302',
  symbol: 'BTC-USDT',
  orderIntentId: '3f2504e0-4f89-41d3-9a0c-0305e82c3303',
  fillId: '3f2504e0-4f89-41d3-9a0c-0305e82c3304',
  fillQuantity: '0.25',
  fillPrice: '68000.125',
  fillSide: 'BUY',
  isSimulated: true,
};

describe('TradeLifecycleService position-limit accounting contract', () => {
  it('does not apply a replayed fill twice when its fill ID is already stored on a trade', async () => {
    const existingTrade = {
      id: 'trade-1',
      state: 'OPEN',
      fillIds: [FILL.fillId],
      remainingQuantity: '0.25',
    };
    const prisma = {
      omsTrade: {
        findFirst: jest.fn(async () => existingTrade),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    const service = new TradeLifecycleService(prisma as unknown as PrismaService);

    const result = await service.buildOrUpdateTradeFromFill({ ...FILL });

    expect(result).toBe(existingTrade);
    expect(prisma.omsTrade.findFirst).toHaveBeenCalledWith({
      where: { tenantId: FILL.tenantId, accountId: FILL.accountId, fillIds: { has: FILL.fillId } },
    });
    expect(prisma.omsTrade.create).not.toHaveBeenCalled();
    expect(prisma.omsTrade.update).not.toHaveBeenCalled();
  });

  it('surfaces a trade-row write failure instead of returning a synthetic open trade to the position limiter', async () => {
    const writeFailure = Object.assign(new Error('durable trade write unavailable'), { code: 'P1001' });
    const prisma = {
      omsTrade: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => {
          throw writeFailure;
        }),
        update: jest.fn(),
      },
    };
    const service = new TradeLifecycleService(prisma as unknown as PrismaService);

    await expect(service.buildOrUpdateTradeFromFill({ ...FILL })).rejects.toBe(writeFailure);
    expect(prisma.omsTrade.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: FILL.tenantId,
        accountId: FILL.accountId,
        symbol: FILL.symbol,
        state: 'OPEN',
        side: 'LONG',
        remainingQuantity: FILL.fillQuantity,
        fillIds: [FILL.fillId],
      }),
    });
  });

  it('persists a new trade before returning a position-slot lifecycle record', async () => {
    const persisted = { id: 'trade-2', state: 'OPEN', remainingQuantity: FILL.fillQuantity };
    const prisma = {
      omsTrade: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => persisted),
        update: jest.fn(),
      },
    };
    const service = new TradeLifecycleService(prisma as unknown as PrismaService);

    const result = await service.buildOrUpdateTradeFromFill({ ...FILL });

    expect(result).toBe(persisted);
    expect(prisma.omsTrade.create).toHaveBeenCalledTimes(1);
  });
});
