// # Ensures copy-trading notification outbox writes remain durable when realtime delivery fails.
import { CopyTradingNotificationProcessor } from './copy-trading-notification.processor';
import type { PrismaService } from '../../../infrastructure/prisma/prisma.service';

describe('CopyTradingNotificationProcessor', () => {
  it('persists the tenant-scoped outbox row before attempting realtime publish', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const findFirst = jest
      .fn()
      .mockResolvedValue({ id: 'outbox-1', createdAt: new Date('2026-10-25T00:00:00Z') });
    const prisma = {
      withTenantRls: jest.fn(async (_tenant: string, work: (tx: unknown) => unknown) =>
        work({ notification: { createMany, findFirst } }),
      ),
    } as unknown as PrismaService;
    const publish = jest.fn().mockRejectedValue(new Error('redis unavailable'));
    const processor = new CopyTradingNotificationProcessor(
      prisma,
      { publisher: { publish } } as never,
      { info: jest.fn(), warn: jest.fn() } as never,
    );
    await expect(
      processor.emitCopyTradingNotification({
        tenantId: 'tenant-1',
        userId: 'user-1',
        sourceEventId: 'event-1',
        eventType: 'COPY_EXECUTION_FILLED',
      }),
    ).resolves.toMatchObject({ id: 'outbox-1', delivered: true });
    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: 'tenant-1', userId: 'user-1' }),
        skipDuplicates: true,
      }),
    );
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
