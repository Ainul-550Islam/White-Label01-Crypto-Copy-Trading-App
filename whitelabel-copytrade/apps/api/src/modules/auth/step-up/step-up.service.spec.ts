// # Regresses proof TTL, password/TOTP verification, session/device/action binding, lockout, and fail-closed Redis behavior.
import { StepUpService } from './step-up.service';
import type { AuthenticatedActor } from '@wlct/shared-types';

const actor = (sessionId = 'session-a', tenantId = 'tenant-a'): AuthenticatedActor => ({
  userId: 'user-a',
  tenantId,
  sessionId,
  roles: [],
  permissions: [],
  isPlatformUser: false,
  tokenId: 'token-a',
});
const validUser = {
  id: 'user-a',
  email: 'a@example.test',
  passwordHash: 'hashed',
  status: 'ACTIVE',
};
const validSession = { id: 'session-a', deviceId: 'device-a', userAgent: 'browser/1' };
const context = { ipHash: 'ip-hash', requestId: 'request-a', userAgent: 'browser/1' };

function makeService(overrides: Record<string, unknown> = {}) {
  const set = jest.fn().mockResolvedValue('OK');
  const get = jest.fn();
  const userFindFirst = jest.fn().mockResolvedValue(validUser);
  const sessionFindFirst = jest.fn().mockResolvedValue(validSession);
  const verifyPassword = jest.fn().mockResolvedValue(true);
  const verifyTotp = jest
    .fn()
    .mockResolvedValue({ verified: true, usedRecoveryCode: false, remainingRecoveryCodes: 0 });
  const lockout = { assertNotLocked: jest.fn(), registerFailure: jest.fn(), clear: jest.fn() };
  const audit = { recordImmediate: jest.fn().mockResolvedValue(undefined) };
  const service = new StepUpService(
    { user: { findFirst: userFindFirst }, userSession: { findFirst: sessionFindFirst } } as never,
    { client: { set, get } } as never,
    { verify: verifyPassword } as never,
    { verify: verifyTotp } as never,
    lockout as never,
    { stepUpTtlSeconds: 300 } as never,
    audit as never,
  );
  Object.assign(service, overrides);
  return {
    service,
    set,
    get,
    userFindFirst,
    sessionFindFirst,
    verifyPassword,
    verifyTotp,
    lockout,
    audit,
  };
}

describe('StepUpService', () => {
  it('stores a successful password proof with bounded TTL and session/device/action evidence', async () => {
    const mocks = makeService();
    const result = await mocks.service.verify(
      actor(),
      { method: 'PASSWORD', password: 'correct', action: 'API_KEY_CREATE' },
      context,
    );
    expect(result).toMatchObject({ fresh: true, action: 'API_KEY_CREATE' });
    expect(mocks.set).toHaveBeenCalledWith(
      'stepup:tenant-a:user-a:session-a',
      expect.any(String),
      'EX',
      300,
    );
    const stored = JSON.parse(mocks.set.mock.calls[0][1] as string) as Record<string, unknown>;
    expect(stored).toMatchObject({
      action: 'API_KEY_CREATE',
      tenantId: 'tenant-a',
      userId: 'user-a',
      sessionId: 'session-a',
      deviceId: 'device-a',
    });
    expect(stored.deviceFingerprint).toEqual(expect.any(String));
    expect(mocks.audit.recordImmediate).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STEP_UP_VERIFIED' }),
    );
    expect(mocks.lockout.clear).toHaveBeenCalledWith('tenant-a', 'a@example.test', 'user-a');
  });

  it('refuses invalid TOTP and registers lockout failure without storing a proof', async () => {
    const mocks = makeService();
    mocks.verifyTotp.mockResolvedValue({
      verified: false,
      usedRecoveryCode: false,
      remainingRecoveryCodes: 0,
    });
    await expect(
      mocks.service.verify(
        actor(),
        { method: 'TOTP', code: '123456', action: 'TWO_FACTOR_DISABLE' },
        context,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.lockout.registerFailure).toHaveBeenCalledWith(
      'tenant-a',
      'a@example.test',
      'user-a',
      expect.objectContaining({ ipHash: 'ip-hash' }),
    );
  });

  it('keeps a proof from another session from authorizing this session', async () => {
    const mocks = makeService();
    const now = new Date();
    mocks.get.mockResolvedValue(
      JSON.stringify({
        action: 'PAYOUT_CREATE',
        tenantId: 'tenant-a',
        userId: 'user-a',
        sessionId: 'session-a',
        deviceId: 'device-a',
        deviceFingerprint: 'wrong-session',
        verifiedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      }),
    );
    mocks.sessionFindFirst.mockResolvedValue({
      id: 'session-b',
      deviceId: 'device-b',
      userAgent: 'other-browser',
    });
    await expect(mocks.service.isFresh(actor('session-b'), 'PAYOUT_CREATE')).resolves.toBe(false);
  });

  it('refuses expired grants and fails closed when Redis is unavailable', async () => {
    const mocks = makeService();
    mocks.get.mockResolvedValue(
      JSON.stringify({
        action: 'PAYOUT_CREATE',
        tenantId: 'tenant-a',
        userId: 'user-a',
        sessionId: 'session-a',
        deviceId: 'device-a',
        deviceFingerprint: 'irrelevant',
        verifiedAt: '2020-01-01T00:00:00.000Z',
        expiresAt: '2020-01-01T00:05:00.000Z',
      }),
    );
    await expect(mocks.service.isFresh(actor(), 'PAYOUT_CREATE')).resolves.toBe(false);
    mocks.get.mockRejectedValue(new Error('redis unavailable'));
    await expect(mocks.service.isFresh(actor(), 'PAYOUT_CREATE')).resolves.toBe(false);
  });

  it('checks lockout before verifying credentials', async () => {
    const mocks = makeService();
    mocks.lockout.assertNotLocked.mockRejectedValue(new Error('locked'));
    await expect(
      mocks.service.verify(
        actor(),
        { method: 'PASSWORD', password: 'secret', action: 'API_KEY_CREATE' },
        context,
      ),
    ).rejects.toThrow('locked');
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
