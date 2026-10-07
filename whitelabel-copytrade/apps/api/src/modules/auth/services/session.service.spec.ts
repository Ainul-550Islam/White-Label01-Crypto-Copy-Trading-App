// # Responsibility: protects user-scoped session listing, revocation, and refresh-token invalidation behavior.
import { NotFoundException } from '../../../common/errors/app.exception';
import { SessionService } from './session.service';

describe('SessionService user session management', () => {
  function buildService() {
    const prisma = {
      userSession: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      refreshToken: { updateMany: jest.fn() },
      $transaction: jest.fn(async (operations: unknown[]) => Promise.all(operations as Promise<unknown>[])),
    };
    const config = { refreshTokenTtlSeconds: 3600 };
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return {
      service: new SessionService(prisma as any, config as any, logger as any),
      prisma,
    };
  }

  test('lists only active unexpired sessions and identifies the current device', async () => {
    const { service, prisma } = buildService();
    const now = new Date('2026-10-04T00:00:00.000Z');
    prisma.userSession.findMany.mockResolvedValue([{
      id: 'session-a',
      deviceId: 'device-a',
      deviceName: 'Work laptop',
      platform: 'WEB',
      appVersion: '1.0.0',
      ipHash: 'ip-hash',
      geoLabel: 'Approximate region',
      userAgent: 'Browser',
      trusted: true,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date('2026-10-05T00:00:00.000Z'),
      revokedAt: null,
    }]);

    const sessions = await service.listForUser('user-a', 'session-a');

    expect(prisma.userSession.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'user-a', revokedAt: null }),
    }));
    expect(sessions).toEqual([expect.objectContaining({
      id: 'session-a',
      deviceName: 'Work laptop',
      isCurrent: true,
      trusted: true,
    })]);
  });

  test('revokes a session and its active refresh tokens in one transaction scoped to the user', async () => {
    const { service, prisma } = buildService();
    prisma.userSession.findFirst.mockResolvedValue({ id: 'session-a' });
    prisma.userSession.update.mockResolvedValue({ id: 'session-a' });
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

    await service.revoke('user-a', 'session-a', 'User requested revoke');

    expect(prisma.userSession.findFirst).toHaveBeenCalledWith({
      where: { id: 'session-a', userId: 'user-a' },
      select: { id: true },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.userSession.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'session-a' },
      data: expect.objectContaining({ revokeReason: 'User requested revoke' }),
    }));
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { sessionId: 'session-a', status: 'ACTIVE' },
      data: expect.objectContaining({ status: 'REVOKED' }),
    }));
  });

  test('refuses to revoke another user’s session', async () => {
    const { service, prisma } = buildService();
    prisma.userSession.findFirst.mockResolvedValue(null);

    await expect(service.revoke('user-a', 'session-owned-by-user-b', 'User requested revoke'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.userSession.update).not.toHaveBeenCalled();
  });
});
