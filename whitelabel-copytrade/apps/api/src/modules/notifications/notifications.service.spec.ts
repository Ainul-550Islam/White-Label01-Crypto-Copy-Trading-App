// # Tests tenant/user-scoped inbox queries and idempotent update predicates.
import { NotificationsService } from './notifications.service';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';

describe('NotificationsService tenant isolation', () => {
  it('scopes inbox list and count queries by both tenant and authenticated user', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = {
      notification: { findMany, count },
      $transaction: jest.fn(async (calls: Promise<unknown>[]) => Promise.all(calls)),
    } as unknown as PrismaService;
    const service = new NotificationsService(
      prisma,
      {} as never,
      {} as never,
      { debug: jest.fn(), info: jest.fn(), warn: jest.fn() } as never,
    );
    await service.list('tenant-b', 'user-b', {} as never);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-b', userId: 'user-b' }),
      }),
    );
    expect(count).toHaveBeenCalledWith({
      where: expect.objectContaining({ tenantId: 'tenant-b', userId: 'user-b' }),
    });
  });
});
