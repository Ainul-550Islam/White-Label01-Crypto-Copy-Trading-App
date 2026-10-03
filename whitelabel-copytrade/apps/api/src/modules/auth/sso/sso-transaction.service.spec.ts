import { createHash } from 'crypto';

import {
  SSO_MAX_PENDING_PER_CLIENT,
  SSO_TRANSACTION_TTL_SECONDS,
  SsoAuthError,
  SsoReasonCode,
} from '../../security/sso-flow.types';
import {
  createInMemorySsoPrisma,
  fakeCryptoService,
  type InMemorySsoPrisma,
} from './__fixtures__/in-memory-sso-prisma.fixture-spec';
import { SsoTransactionService } from './sso-transaction.service';

/**
 * Part 11 [1]-[9], [45]-[47], [50]: the server-side login transaction.
 * Random state / nonce / PKCE verifier / binding secret, persisted only as
 * hashes (the verifier sealed with tenant+transaction AAD), checked against
 * tenant, provider, device and binding, and consumed exactly once.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const CONFIG = '33333333-3333-4333-8333-333333333333';
const sha256Hex = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');
const T0 = new Date('2026-10-01T00:00:00.000Z');

function reasonOf(fn: () => unknown): SsoReasonCode | null {
  try {
    fn();
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(SsoAuthError);
    return (error as SsoAuthError).reason;
  }
}

async function asyncReason(promise: Promise<unknown>): Promise<SsoReasonCode | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(SsoAuthError);
    return (error as SsoAuthError).reason;
  }
}

describe('SsoTransactionService (Part 11)', () => {
  let prisma: InMemorySsoPrisma;
  let service: SsoTransactionService;

  const create = (overrides: Record<string, unknown> = {}) =>
    service.create({
      tenantId: TENANT,
      configurationId: CONFIG,
      providerType: 'OIDC',
      deviceId: 'device-1',
      redirectUri: 'https://acme.app.test/api/auth/sso/callback',
      returnTo: null,
      ipHash: 'ip-1',
      correlationId: 'corr-1',
      withNonce: true,
      withPkce: true,
      now: T0,
      ...overrides,
    } as never);
  const row = (id: string) => prisma.ssoAuthTransaction.rows.find((r) => r.id === id)!;

  beforeEach(() => {
    prisma = createInMemorySsoPrisma();
    service = new SsoTransactionService(prisma as never, fakeCryptoService() as never);
  });

  it('[1][2][3] generates high-entropy state, nonce, verifier and binding secret and stores none of them in clear', async () => {
    const created = await create();
    for (const secret of [
      created.state,
      created.nonce!,
      created.codeVerifier!,
      created.bindingToken,
    ]) {
      expect(secret).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    }
    expect(created.codeVerifier!.length).toBeGreaterThanOrEqual(43);
    expect(created.codeVerifier!.length).toBeLessThanOrEqual(128);
    expect(created.codeChallenge).toBe(
      createHash('sha256').update(created.codeVerifier!, 'ascii').digest('base64url'),
    );
    const stored = row(created.transaction.id);
    expect(stored.stateHash).toBe(sha256Hex(created.state));
    expect(stored.nonceHash).toBe(sha256Hex(created.nonce!));
    expect(stored.bindingHash).not.toBe(created.bindingToken);
    const dump = JSON.stringify(stored);
    for (const secret of [
      created.state,
      created.nonce!,
      created.codeVerifier!,
      created.bindingToken,
    ])
      expect(dump).not.toContain(secret);
    expect(service.decryptVerifier(stored as never)).toBe(created.codeVerifier);
    expect(stored.expiresAt.getTime()).toBe(T0.getTime() + SSO_TRANSACTION_TTL_SECONDS * 1000);
    expect(SSO_TRANSACTION_TTL_SECONDS).toBeLessThanOrEqual(600);
  });

  it('[3] the sealed PKCE verifier cannot be opened under another transaction or tenant', async () => {
    const created = await create();
    const stored = row(created.transaction.id);
    expect(() =>
      service.decryptVerifier({ ...stored, id: 'another-transaction' } as never),
    ).toThrow(SsoAuthError);
    expect(() => service.decryptVerifier({ ...stored, tenantId: OTHER } as never)).toThrow(
      SsoAuthError,
    );
    const noPkce = await create({ withPkce: false, withNonce: false, correlationId: 'corr-2' });
    expect(noPkce.codeVerifier).toBeNull();
    expect(noPkce.nonce).toBeNull();
    expect(service.decryptVerifier(row(noPkce.transaction.id) as never)).toBeNull();
  });

  it('[4] findByState resolves only the exact state', async () => {
    const created = await create();
    await expect(service.findByState(created.state)).resolves.toMatchObject({
      id: created.transaction.id,
    });
    await expect(service.findByState(`${created.state}x`)).resolves.toBeNull();
    await expect(service.findByState(created.state.slice(0, -1))).resolves.toBeNull();
  });

  it('[5][9][45][47] assertUsable checks tenant, provider, consumption, expiry (exact boundary), status, device and binding', async () => {
    const created = await create();
    const tx = row(created.transaction.id);
    const ok = {
      tenantId: TENANT,
      providerType: 'OIDC' as const,
      status: 'PENDING' as const,
      deviceId: 'device-1',
      bindingToken: created.bindingToken,
      now: T0,
    };
    expect(reasonOf(() => service.assertUsable(tx as never, ok))).toBeNull();
    expect(reasonOf(() => service.assertUsable(tx as never, { ...ok, tenantId: OTHER }))).toBe(
      SsoReasonCode.TENANT_MISMATCH,
    );
    expect(reasonOf(() => service.assertUsable(tx as never, { ...ok, providerType: 'SAML' }))).toBe(
      SsoReasonCode.PROVIDER_MISMATCH,
    );
    expect(reasonOf(() => service.assertUsable(tx as never, { ...ok, status: 'VERIFIED' }))).toBe(
      SsoReasonCode.STATE_CONSUMED,
    );
    expect(reasonOf(() => service.assertUsable(tx as never, { ...ok, deviceId: 'device-2' }))).toBe(
      SsoReasonCode.DEVICE_MISMATCH,
    );
    expect(
      reasonOf(() => service.assertUsable(tx as never, { ...ok, bindingToken: 'wrong' })),
    ).toBe(SsoReasonCode.BINDING_MISMATCH);
    expect(reasonOf(() => service.assertUsable(tx as never, { ...ok, bindingToken: '' }))).toBe(
      SsoReasonCode.BINDING_MISMATCH,
    );
    expect(reasonOf(() => service.assertUsable(tx as never, { ...ok, bindingToken: null }))).toBe(
      SsoReasonCode.BINDING_MISMATCH,
    );
    const lastValid = new Date(tx.expiresAt.getTime() - 1);
    expect(reasonOf(() => service.assertUsable(tx as never, { ...ok, now: lastValid }))).toBeNull();
    expect(reasonOf(() => service.assertUsable(tx as never, { ...ok, now: tx.expiresAt }))).toBe(
      SsoReasonCode.STATE_EXPIRED,
    );
    expect(reasonOf(() => service.assertUsable({ ...tx, status: 'REJECTED' } as never, ok))).toBe(
      SsoReasonCode.STATE_CONSUMED,
    );
    expect(reasonOf(() => service.assertUsable({ ...tx, consumedAt: T0 } as never, ok))).toBe(
      SsoReasonCode.STATE_CONSUMED,
    );
  });

  it('[6][7][46] claimPending is one-time: exactly one of several concurrent claims wins, and never after expiry', async () => {
    const created = await create();
    const results = await Promise.allSettled([
      service.claimPending(created.transaction.id, T0),
      service.claimPending(created.transaction.id, T0),
      service.claimPending(created.transaction.id, T0),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x): x is PromiseRejectedResult => x.status === 'rejected')) {
      expect((r.reason as SsoAuthError).reason).toBe(SsoReasonCode.STATE_CONSUMED);
    }
    expect(row(created.transaction.id)).toMatchObject({ status: 'CONSUMED', consumedAt: T0 });

    const expired = await create({ correlationId: 'corr-3' });
    expect(
      await asyncReason(
        service.claimPending(
          expired.transaction.id,
          new Date(row(expired.transaction.id).expiresAt.getTime()),
        ),
      ),
    ).toBe(SsoReasonCode.STATE_CONSUMED);
    expect(row(expired.transaction.id).status).toBe('PENDING');
  });

  it('SAML hand-off: markVerified once, then claimVerified once with the exact code within its lifetime', async () => {
    const created = await create({
      providerType: 'SAML',
      withNonce: false,
      withPkce: false,
      samlRequestId: '_req1',
    });
    const id = created.transaction.id;
    const handoff = await service.markVerified(id, 'user-1', T0);
    expect(await asyncReason(service.markVerified(id, 'user-2', T0))).toBe(
      SsoReasonCode.STATE_CONSUMED,
    );
    const verified = row(id);
    expect(verified).toMatchObject({
      status: 'VERIFIED',
      verifiedUserId: 'user-1',
      handoffHash: sha256Hex(handoff),
    });
    expect(JSON.stringify(verified)).not.toContain(handoff);

    expect(await asyncReason(service.claimVerified(verified as never, 'wrong', T0))).toBe(
      SsoReasonCode.HANDOFF_INVALID,
    );
    expect(await asyncReason(service.claimVerified(verified as never, '', T0))).toBe(
      SsoReasonCode.HANDOFF_INVALID,
    );
    expect(
      await asyncReason(
        service.claimVerified(verified as never, handoff, new Date(T0.getTime() + 121_000)),
      ),
    ).toBe(SsoReasonCode.STATE_EXPIRED);
    await expect(
      service.claimVerified(verified as never, handoff, new Date(T0.getTime() + 5_000)),
    ).resolves.toBe('user-1');
    expect(
      await asyncReason(
        service.claimVerified(verified as never, handoff, new Date(T0.getTime() + 6_000)),
      ),
    ).toBe(SsoReasonCode.STATE_CONSUMED);
  });

  it('reject burns a transaction so it can never be claimed, and never throws', async () => {
    const created = await create();
    await service.reject(created.transaction.id, SsoReasonCode.NONCE_MISMATCH, T0);
    expect(row(created.transaction.id)).toMatchObject({
      status: 'REJECTED',
      failureReason: SsoReasonCode.NONCE_MISMATCH,
      consumedAt: T0,
    });
    expect(await asyncReason(service.claimPending(created.transaction.id, T0))).toBe(
      SsoReasonCode.STATE_CONSUMED,
    );
    prisma.ssoAuthTransaction.updateMany.mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.reject(created.transaction.id, SsoReasonCode.NONCE_MISMATCH, T0),
    ).resolves.toBeUndefined();
  });

  it('[50] the per-client pending cap counts only live, unconsumed transactions of this tenant and client', async () => {
    for (let i = 0; i < SSO_MAX_PENDING_PER_CLIENT; i += 1)
      await create({ correlationId: `c${i}` });
    expect(await asyncReason(create({ correlationId: 'over' }))).toBe(
      SsoReasonCode.TOO_MANY_PENDING,
    );
    await expect(create({ correlationId: 'other-ip', ipHash: 'ip-2' })).resolves.toBeDefined();
    await expect(create({ correlationId: 'other-tenant', tenantId: OTHER })).resolves.toBeDefined();
    // Consuming one frees a slot.
    const first = prisma.ssoAuthTransaction.rows.find(
      (r) => r.tenantId === TENANT && r.ipHash === 'ip-1',
    )!;
    await service.claimPending(first.id, T0);
    await expect(create({ correlationId: 'after-consume' })).resolves.toBeDefined();
    expect(await asyncReason(create({ correlationId: 'full-again' }))).toBe(
      SsoReasonCode.TOO_MANY_PENDING,
    );
    // Time passing frees all slots.
    await expect(
      create({
        correlationId: 'later',
        now: new Date(T0.getTime() + SSO_TRANSACTION_TTL_SECONDS * 1000),
      }),
    ).resolves.toBeDefined();
  });

  it('pruneExpired removes only rows more than a day past expiry (transactions and SAML replay records)', async () => {
    const old = await create({ correlationId: 'old' });
    const recent = await create({ correlationId: 'recent' });
    row(old.transaction.id).expiresAt = new Date(T0.getTime() - 25 * 3600 * 1000);
    row(recent.transaction.id).expiresAt = new Date(T0.getTime() - 23 * 3600 * 1000);
    prisma.ssoAssertionReplay.rows.push(
      {
        id: 'r-old',
        tenantId: TENANT,
        issuer: 'i',
        assertionId: 'a1',
        expiresAt: new Date(T0.getTime() - 25 * 3600 * 1000),
      },
      {
        id: 'r-new',
        tenantId: TENANT,
        issuer: 'i',
        assertionId: 'a2',
        expiresAt: new Date(T0.getTime() + 3600 * 1000),
      },
    );
    await service.pruneExpired(T0);
    expect(prisma.ssoAuthTransaction.rows.map((r) => r.id)).toEqual([recent.transaction.id]);
    expect(prisma.ssoAssertionReplay.rows.map((r) => r.id)).toEqual(['r-new']);
  });
});
