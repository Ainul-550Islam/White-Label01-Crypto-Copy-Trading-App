// # Tests WebSocket handshake authentication, tenant binding, and session revocation checks.
import { WsAuthGuard } from './ws-auth.guard';

describe('WsAuthGuard', () => {
  const payload = {
    sub: 'user-1',
    tid: 'tenant-a',
    sid: 'session-1',
    sv: 2,
    roles: [],
    perms: [],
    jti: 'token-1',
  };
  const socket = (auth: unknown = { token: 'access-token' }) =>
    ({ handshake: { auth, headers: {} }, id: 'socket-1' }) as never;

  it('rejects missing credentials before token verification', async () => {
    const tokens = { verifyAccessToken: jest.fn() };
    const guard = new WsAuthGuard(tokens as never, {} as never, { debug: jest.fn() } as never);
    await expect(guard.authenticate(socket({}))).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(tokens.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('rejects an expired access token before touching tenant or session records', async () => {
    const tokens = { verifyAccessToken: jest.fn().mockRejectedValue({ code: 'TOKEN_EXPIRED' }) };
    const findFirst = jest.fn();
    const guard = new WsAuthGuard(
      tokens as never,
      { user: { findFirst }, userSession: { findFirst } } as never,
      { debug: jest.fn() } as never,
    );
    await expect(guard.authenticate(socket())).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('queries the authenticated tenant and rejects a user outside that tenant', async () => {
    const tokens = { verifyAccessToken: jest.fn().mockResolvedValue(payload) };
    const findFirst = jest.fn().mockResolvedValue(null);
    const guard = new WsAuthGuard(
      tokens as never,
      { user: { findFirst }, userSession: { findFirst: jest.fn() } } as never,
      { debug: jest.fn() } as never,
    );
    await expect(guard.authenticate(socket())).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED' });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1', tenantId: 'tenant-a', deletedAt: null } }),
    );
  });

  it('rejects a revoked or version-mismatched session', async () => {
    const tokens = { verifyAccessToken: jest.fn().mockResolvedValue(payload) };
    const guard = new WsAuthGuard(
      tokens as never,
      {
        user: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'user-1',
            tenantId: 'tenant-a',
            status: 'ACTIVE',
            isPlatformUser: false,
            sessionVersion: 3,
            tenant: { status: 'ACTIVE' },
          }),
        },
        userSession: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 'session-1', expiresAt: new Date(Date.now() + 60_000) }),
        },
      } as never,
      { debug: jest.fn() } as never,
    );
    await expect(guard.authenticate(socket())).rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
  });
});
