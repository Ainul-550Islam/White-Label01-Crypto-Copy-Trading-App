// # Responsibility: protects tenant- and user-scoped session listing, revocation, and refresh-token invalidation.
import { NotFoundException } from '../../../common/errors/app.exception';
import { SessionService } from './session.service';

describe('SessionService user session management', () => {
  const tenant = 'tenant-a';
  function buildService() {
    const prisma: any = {
      userSession: { findMany: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
      refreshToken: { updateMany: jest.fn() },
      $queryRaw: jest.fn(async () => [{ id: 'user-a' }]),
    };
    prisma.withTenantRls = jest.fn(async (_tenant: string, work: (tx: typeof prisma) => Promise<unknown>) => work(prisma));
    const config = { refreshTokenTtlSeconds: 3600 };
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { service: new SessionService(prisma, config as any, logger as any), prisma };
  }

  test('lists only active unexpired sessions in the tenant and identifies the current device', async () => {
    const { service, prisma } = buildService();
    const now = new Date('2026-10-04T00:00:00.000Z');
    prisma.userSession.findMany.mockResolvedValue([{
      id: 'session-a', deviceId: 'device-a', deviceName: 'Work laptop', platform: 'WEB', appVersion: '1.0.0',
      ipHash: 'ip-hash', geoLabel: 'Approximate region', userAgent: 'Browser', trusted: true,
      createdAt: now, lastSeenAt: now, expiresAt: new Date('2026-10-05T00:00:00.000Z'), revokedAt: null,
    }]);
    const sessions = await service.listForUser(tenant, 'user-a', 'session-a');
    expect(prisma.withTenantRls).toHaveBeenCalledWith(tenant, expect.any(Function));
    expect(prisma.userSession.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: tenant, userId: 'user-a', revokedAt: null }),
    }));
    expect(sessions).toEqual([expect.objectContaining({ id: 'session-a', deviceName: 'Work laptop', isCurrent: true, trusted: true })]);
  });

  test('locks the user and atomically revokes an owned session and its refresh tokens', async () => {
    const { service, prisma } = buildService();
    prisma.userSession.findFirst.mockResolvedValue({ id: 'session-a' });
    prisma.userSession.updateMany.mockResolvedValue({ count: 1 });
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    await service.revoke(tenant, 'user-a', 'session-a', 'User requested revoke');
    expect(prisma.withTenantRls).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.userSession.findFirst).toHaveBeenCalledWith({ where: { id: 'session-a', tenantId: tenant, userId: 'user-a' }, select: { id: true } });
    expect(prisma.userSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'session-a', tenantId: tenant, userId: 'user-a', revokedAt: null },
      data: expect.objectContaining({ revokeReason: 'User requested revoke' }),
    }));
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: tenant, userId: 'user-a', sessionId: 'session-a', status: 'ACTIVE' },
      data: expect.objectContaining({ status: 'REVOKED' }),
    }));
  });

  test('refuses to revoke another user’s session', async () => {
    const { service, prisma } = buildService();
    prisma.userSession.findFirst.mockResolvedValue(null);
    await expect(service.revoke(tenant, 'user-a', 'session-owned-by-user-b', 'User requested revoke')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.userSession.updateMany).not.toHaveBeenCalled();
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  test('a revoked actor cannot revoke another session after its guard ran', async () => {
    const { service, prisma } = buildService();
    prisma.userSession.findFirst.mockResolvedValue(null);
    await expect(service.revoke(tenant, 'user-a', 'new-session', 'user_revoked', 'stale-session'))
      .rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
    await expect(service.revokeAll(tenant, 'user-a', 'stale-session', 'user_revoked_others'))
      .rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
    expect(prisma.userSession.updateMany).not.toHaveBeenCalled();
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  test('revoke-others retains the current session and also repairs orphaned active tokens', async () => {
    const { service, prisma } = buildService();
    prisma.userSession.findFirst.mockResolvedValue({ id: 'session-current' });
    prisma.userSession.updateMany.mockResolvedValue({ count: 2 });
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });
    await expect(service.revokeAll(tenant, 'user-a', 'session-current', 'security')).resolves.toBe(2);
    expect(prisma.userSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: tenant, userId: 'user-a', revokedAt: null, id: { not: 'session-current' } },
    }));
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: tenant, userId: 'user-a', status: 'ACTIVE', sessionId: { not: 'session-current' } },
    }));
  });
});
