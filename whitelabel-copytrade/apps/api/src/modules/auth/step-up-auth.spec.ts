// # Proves step-up proofs are action-bound, single-use, session-bound and fail closed when the proof store is down.
import { ErrorCode } from '@wlct/shared-types';

import { STEP_UP_CONSUME_LUA, StepUpAuthService } from './step-up-auth.service';

const ACTOR = { userId: 'user-a', tenantId: 'tenant-a', sessionId: 'session-a' } as never;
const CONTEXT = { ipHash: 'ip-hash', requestId: 'request-a', userAgent: 'jest' };

interface Harness {
  service: StepUpAuthService;
  redis: {
    client: { set: jest.Mock<Promise<unknown>, unknown[]>; get: jest.Mock<Promise<unknown>, unknown[]>; eval: jest.Mock<Promise<unknown>, unknown[]> };
  };
  audit: { recordImmediate: jest.Mock<Promise<void>, unknown[]> };
  lockout: { assertNotLocked: jest.Mock; registerFailure: jest.Mock; clear: jest.Mock };
  passwords: { verify: jest.Mock };
  twoFactor: { verify: jest.Mock };
  config: { stepUpTtlSeconds: number };
}

function harness(overrides: { user?: unknown; session?: unknown } = {}): Harness {
  const redis = {
    client: {
      set: jest.fn<Promise<unknown>, unknown[]>().mockResolvedValue('OK'),
      get: jest.fn<Promise<unknown>, unknown[]>().mockResolvedValue(null),
      eval: jest.fn<Promise<unknown>, unknown[]>().mockResolvedValue('NO_PROOF'),
    },
  };
  const audit = { recordImmediate: jest.fn<Promise<void>, unknown[]>().mockResolvedValue(undefined) };
  const lockout = {
    assertNotLocked: jest.fn().mockResolvedValue(undefined),
    registerFailure: jest.fn().mockResolvedValue(1),
    clear: jest.fn().mockResolvedValue(undefined),
  };
  const passwords = { verify: jest.fn().mockResolvedValue(true) };
  const twoFactor = { verify: jest.fn().mockResolvedValue({ verified: true }) };
  const config = { stepUpTtlSeconds: 300 };
  const prisma = {
    user: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          overrides.user ?? { id: 'user-a', email: 'trader@example.com', passwordHash: 'hash', status: 'ACTIVE' },
        ),
    },
    userSession: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          'session' in overrides ? overrides.session : { id: 'session-a', deviceId: 'device-a' },
        ),
    },
  };

  const service = new StepUpAuthService(
    prisma as never,
    redis as never,
    passwords as never,
    twoFactor as never,
    lockout as never,
    config as never,
    audit as never,
  );

  return { service, redis, audit, lockout, passwords, twoFactor, config };
}

describe('StepUpAuthService', () => {
  describe('issue', () => {
    it('binds the proof to tenant, user, session and the requested action', async () => {
      const h = harness();

      const issued = await h.service.issue(ACTOR, { method: 'TOTP', action: 'EXCHANGE_KEY_ROTATE', code: '123456' }, CONTEXT);

      expect(h.redis.client.set).toHaveBeenCalledWith(
        'stepup:proof:tenant-a:user-a:session-a',
        expect.any(String),
        'EX',
        300,
      );
      const stored = JSON.parse(String(h.redis.client.set.mock.calls[0][1]));
      expect(stored).toMatchObject({
        action: 'EXCHANGE_KEY_ROTATE',
        tenantId: 'tenant-a',
        userId: 'user-a',
        sessionId: 'session-a',
        method: 'TOTP',
      });
      expect(issued).toMatchObject({ action: 'EXCHANGE_KEY_ROTATE', method: 'TOTP', ttlSeconds: 300 });
      expect(issued.proofId).toBe(stored.proofId);
      expect(h.audit.recordImmediate).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'STEP_UP_PROOF_ISSUED', outcome: 'SUCCESS' }),
      );
    });

    it('rejects a wrong password with INVALID_CREDENTIALS, counts the failure and writes no proof', async () => {
      const h = harness();
      h.passwords.verify.mockResolvedValue(false);

      await expect(
        h.service.issue(ACTOR, { method: 'PASSWORD', action: 'PAYOUT_CREATE', password: 'nope' }, CONTEXT),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });

      expect(h.redis.client.set).not.toHaveBeenCalled();
      expect(h.lockout.registerFailure).toHaveBeenCalled();
      expect(h.audit.recordImmediate).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'STEP_UP_ISSUE_DENIED', outcome: 'FAILURE' }),
      );
    });

    it('rejects a wrong TOTP without leaving a proof behind', async () => {
      const h = harness();
      h.twoFactor.verify.mockResolvedValue({ verified: false });

      await expect(
        h.service.issue(ACTOR, { method: 'TOTP', action: 'API_KEY_CREATE', code: '000000' }, CONTEXT),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });

      expect(h.redis.client.set).not.toHaveBeenCalled();
    });

    it('refuses to issue for a revoked session', async () => {
      const h = harness({ session: null });

      await expect(
        h.service.issue(ACTOR, { method: 'TOTP', action: 'CUSTODY_SWEEP', code: '123456' }, CONTEXT),
      ).rejects.toMatchObject({ code: ErrorCode.TOKEN_REVOKED });

      expect(h.redis.client.set).not.toHaveBeenCalled();
    });

    it('fails closed with SERVICE_UNAVAILABLE when the proof store cannot be written', async () => {
      const h = harness();
      h.redis.client.set.mockRejectedValue(new Error('redis down'));

      await expect(
        h.service.issue(ACTOR, { method: 'TOTP', action: 'PAYOUT_APPROVE', code: '123456' }, CONTEXT),
      ).rejects.toMatchObject({ code: ErrorCode.SERVICE_UNAVAILABLE });

      expect(h.audit.recordImmediate).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'STEP_UP_PROOF_ISSUED' }),
      );
    });

    it('consults the lockout counters before verifying anything', async () => {
      const h = harness();
      h.lockout.assertNotLocked.mockRejectedValue(new Error('locked'));

      await expect(
        h.service.issue(ACTOR, { method: 'TOTP', action: 'PAYOUT_CREATE', code: '123456' }, CONTEXT),
      ).rejects.toThrow('locked');

      expect(h.twoFactor.verify).not.toHaveBeenCalled();
    });
  });

  describe('consume', () => {
    it('returns the proof and marks it consumed exactly once per eval call', async () => {
      const h = harness();
      const proof = {
        proofId: 'proof-1',
        action: 'PAYOUT_CREATE',
        method: 'TOTP',
        tenantId: 'tenant-a',
        userId: 'user-a',
        sessionId: 'session-a',
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
      h.redis.client.eval.mockResolvedValueOnce(JSON.stringify(proof)).mockResolvedValueOnce('NO_PROOF');

      const first = await h.service.consume(ACTOR, 'PAYOUT_CREATE');
      const second = await h.service.consume(ACTOR, 'PAYOUT_CREATE');

      expect(first).toMatchObject({ consumed: true, reasonCode: 'CONSUMED', action: 'PAYOUT_CREATE' });
      expect(second).toEqual({ consumed: false, action: null, reasonCode: 'NO_PROOF', proof: null });
    });

    it('passes the action and the caller identity to the atomic script', async () => {
      const h = harness();

      await h.service.consume(ACTOR, 'EXCHANGE_KEY_REVOKE');

      const [script, keyCount, key, action, tenantId, userId, sessionId, nowMs] = h.redis.client.eval.mock.calls[0];
      expect(script).toBe(STEP_UP_CONSUME_LUA);
      expect(keyCount).toBe(1);
      expect(key).toBe('stepup:proof:tenant-a:user-a:session-a');
      expect([action, tenantId, userId, sessionId]).toEqual(['EXCHANGE_KEY_REVOKE', 'tenant-a', 'user-a', 'session-a']);
      expect(Number(nowMs)).toBeGreaterThan(0);
    });

    it('reports an action mismatch without treating it as a consumed proof', async () => {
      const h = harness();
      h.redis.client.eval.mockResolvedValue('ACTION_MISMATCH');

      await expect(h.service.consume(ACTOR, 'PAYOUT_CREATE')).resolves.toEqual({
        consumed: false,
        action: null,
        reasonCode: 'ACTION_MISMATCH',
        proof: null,
      });
    });

    it('refuses when the store is unavailable rather than failing open', async () => {
      const h = harness();
      h.redis.client.eval.mockRejectedValue(new Error('redis down'));

      await expect(h.service.consume(ACTOR, 'PAYOUT_CREATE')).resolves.toMatchObject({
        consumed: false,
        reasonCode: 'STORE_UNAVAILABLE',
      });
    });

    it('treats unparseable store content as malformed, never as a proof', async () => {
      const h = harness();
      h.redis.client.eval.mockResolvedValue('{not json');

      await expect(h.service.consume(ACTOR, 'PAYOUT_CREATE')).resolves.toMatchObject({
        consumed: false,
        reasonCode: 'MALFORMED',
      });
    });
  });

  describe('status', () => {
    it('reports freshness only for the action the proof was issued for', async () => {
      const h = harness();
      const expiresAt = new Date(Date.now() + 120_000).toISOString();
      h.redis.client.get.mockResolvedValue(
        JSON.stringify({ action: 'PAYOUT_CREATE', expiresAt, expiresAtMs: Date.parse(expiresAt) }),
      );

      await expect(h.service.status(ACTOR, 'PAYOUT_CREATE')).resolves.toEqual({
        fresh: true,
        action: 'PAYOUT_CREATE',
        expiresAt,
      });
      await expect(h.service.status(ACTOR, 'PAYOUT_APPROVE')).resolves.toEqual({
        fresh: false,
        action: 'PAYOUT_APPROVE',
        expiresAt: null,
      });
    });

    it('treats an expired proof as not fresh and a missing action as not applicable', async () => {
      const h = harness();
      h.redis.client.get.mockResolvedValue(
        JSON.stringify({ action: 'PAYOUT_CREATE', expiresAt: new Date(Date.now() - 1).toISOString(), expiresAtMs: Date.now() - 1 }),
      );

      await expect(h.service.status(ACTOR, 'PAYOUT_CREATE')).resolves.toMatchObject({ fresh: false });
      await expect(h.service.status(ACTOR, null)).resolves.toEqual({ fresh: false, action: null, expiresAt: null });
    });

    it('reports not fresh when the store throws', async () => {
      const h = harness();
      h.redis.client.get.mockRejectedValue(new Error('redis down'));

      await expect(h.service.status(ACTOR, 'PAYOUT_CREATE')).resolves.toMatchObject({ fresh: false });
    });
  });

  describe('consumeForRoute', () => {
    it('refuses and audits password-only proofs for payout creation but accepts recovery factors', async () => {
      const h = harness();
      const proof = { proofId: 'proof-payout', action: 'PAYOUT_CREATE', tenantId: 'tenant-a', userId: 'user-a', sessionId: 'session-a', issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() };
      h.redis.client.eval.mockResolvedValueOnce(JSON.stringify({ ...proof, method: 'PASSWORD' })).mockResolvedValueOnce(JSON.stringify({ ...proof, method: 'RECOVERY_CODE' }));
      await expect(h.service.consumeForRoute(ACTOR, 'PAYOUT_CREATE', CONTEXT)).resolves.toBe(false);
      expect(h.audit.recordImmediate).toHaveBeenCalledWith(expect.objectContaining({ action: 'STEP_UP_ROUTE_DENIED', metadata: expect.objectContaining({ reason: 'MFA_REQUIRED' }) }));
      await expect(h.service.consumeForRoute(ACTOR, 'PAYOUT_CREATE', CONTEXT)).resolves.toBe(true);
    });
    it('audits an allow with the consumed proof id', async () => {
      const h = harness();
      h.redis.client.eval.mockResolvedValue(
        JSON.stringify({
          proofId: 'proof-7',
          action: 'CUSTODY_SWEEP',
          method: 'TOTP',
          tenantId: 'tenant-a',
          userId: 'user-a',
          sessionId: 'session-a',
          issuedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }),
      );

      await expect(h.service.consumeForRoute(ACTOR, 'CUSTODY_SWEEP', { ...CONTEXT, path: '/v1/custody/sweep', method: 'POST' })).resolves.toBe(true);

      expect(h.audit.recordImmediate).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'STEP_UP_ROUTE_ALLOWED',
          outcome: 'SUCCESS',
          tenantId: 'tenant-a',
          metadata: expect.objectContaining({ action: 'CUSTODY_SWEEP', proofId: 'proof-7', reason: 'CONSUMED' }),
        }),
      );
    });

    it('audits a refusal with the store reason and returns false', async () => {
      const h = harness();
      h.redis.client.eval.mockResolvedValue('ACTION_MISMATCH');

      await expect(h.service.consumeForRoute(ACTOR, 'PAYOUT_APPROVE', CONTEXT)).resolves.toBe(false);

      expect(h.audit.recordImmediate).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'STEP_UP_ROUTE_DENIED',
          outcome: 'FAILURE',
          metadata: expect.objectContaining({ reason: 'ACTION_MISMATCH', proofId: null }),
        }),
      );
    });

    it('audits an unauthenticated attempt against no tenant and refuses', async () => {
      const h = harness();

      await expect(h.service.consumeForRoute(null, 'PAYOUT_CREATE', CONTEXT)).resolves.toBe(false);

      expect(h.redis.client.eval).not.toHaveBeenCalled();
      expect(h.audit.recordImmediate).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'STEP_UP_ROUTE_DENIED',
          outcome: 'FAILURE',
          tenantId: null,
          metadata: expect.objectContaining({ reason: 'NO_ACTOR' }),
        }),
      );
    });
  });
});
