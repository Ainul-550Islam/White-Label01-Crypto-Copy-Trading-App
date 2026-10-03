import { ErrorCode } from '@wlct/shared-types';

import { AppException } from '../../common/errors/app.exception';
import type { TenantContext } from '../../common/types/request.types';
import { AuthService } from './auth.service';

/**
 * Round 7 D1: an ENFORCED SSO configuration closes password login.
 *
 * Before this change `AuthService.login` never looked at the tenant's SSO
 * configuration, so `state: ENFORCED` was a label: every account could keep
 * signing in with a password. These tests pin the policy:
 *  - an active, enforced, ENFORCED configuration refuses password login with
 *    SSO_REQUIRED (403) and issues no session or 2FA challenge;
 *  - allowedDomains limit enforcement to accounts in those domains;
 *  - platform staff are the break-glass path and are exempt;
 *  - the refusal is only given after the password was verified (a wrong
 *    password still gets INVALID_CREDENTIALS and counts towards lockout);
 *  - a failing policy lookup fails the login instead of allowing it.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tenant: TenantContext = {
  tenantId: TENANT,
  slug: 'acme',
  status: 'ACTIVE',
  source: 'subdomain',
  defaultLocale: 'en',
  defaultCurrency: 'USD',
} as TenantContext;
const context = { ipHash: 'iphash', userAgent: 'jest', requestId: 'req-1', locale: 'en' };
const CORRECT_PASSWORD = 'Correct#Horse-Battery-2026';

interface SsoRow {
  tenantId: string;
  providerType: string;
  state: string;
  enforced: boolean;
  isActive: boolean;
  allowedDomains: string[];
}

function build(options: {
  email?: string;
  isPlatformUser?: boolean;
  twoFactorEnabled?: boolean;
  sso?: SsoRow[];
  ssoLookupFails?: boolean;
} = {}) {
  const email = options.email ?? 'alice@acme.test';
  const userRow = {
    id: USER,
    tenantId: TENANT,
    email,
    emailIndex: `bi:${email}`,
    passwordHash: '$argon2id$stored',
    status: 'ACTIVE',
    twoFactorEnabled: options.twoFactorEnabled ?? false,
    isPlatformUser: options.isPlatformUser ?? false,
    sessionVersion: 1,
    deletedAt: null,
  };
  const loginAttempts: Array<Record<string, unknown>> = [];
  const ssoFindMany = jest.fn(async ({ where }: any) => {
    if (options.ssoLookupFails) throw new Error('database unavailable');
    return (options.sso ?? []).filter(
      (row) =>
        row.tenantId === where.tenantId &&
        row.isActive === where.isActive &&
        row.enforced === where.enforced &&
        row.state === where.state,
    );
  });
  const prisma: any = {
    user: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.tenantId === userRow.tenantId && where.emailIndex === userRow.emailIndex ? userRow : null,
      ),
      findUniqueOrThrow: jest.fn(async () => userRow),
      update: jest.fn(async () => userRow),
    },
    ssoConfiguration: { findMany: ssoFindMany },
    loginAttempt: { create: jest.fn(async ({ data }: any) => loginAttempts.push(data)) },
  };
  const config: any = {};
  const crypto: any = { blindIndex: (value: string) => `bi:${value}` };
  const passwords: any = {
    verify: jest.fn(async (_hash: string, candidate: string) => candidate === CORRECT_PASSWORD),
    verifyDummy: jest.fn(async () => undefined),
    needsRehash: jest.fn(() => false),
    hash: jest.fn(),
  };
  const tokens: any = {
    issueTokenPair: jest.fn(async () => ({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresIn: 900,
      refreshExpiresIn: 2_592_000,
    })),
    issueTwoFactorChallenge: jest.fn(async () => ({ token: 'challenge', expiresIn: 300 })),
  };
  const sessions: any = { createOrReuse: jest.fn(async () => ({ id: 'session-1', isNewDevice: false })) };
  const lockout: any = {
    assertNotLocked: jest.fn(async () => undefined),
    registerFailure: jest.fn(async () => undefined),
    clear: jest.fn(async () => undefined),
  };
  const users: any = { findByIdForSession: jest.fn(async (id: string) => ({ id, email, tenantId: TENANT })) };
  const permissions: any = {
    getEffectiveAccess: jest.fn(async () => ({ roleKeys: ['FOLLOWER'], permissionKeys: ['strategy:read'] })),
  };
  const audit: any = { record: jest.fn(async () => undefined) };
  const riskDetector: any = {
    assess: jest.fn(async () => ({ requiresNotification: false, isNewDevice: false, riskScore: 0 })),
    recordFailure: jest.fn(async () => undefined),
  };
  const notifications: any = { enqueueTransactional: jest.fn() };
  const logger: any = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const unused: any = {};
  const auth = new AuthService(
    prisma,
    config,
    crypto,
    passwords,
    tokens,
    sessions,
    unused,
    lockout,
    users,
    permissions,
    unused,
    audit,
    riskDetector,
    notifications,
    logger,
  );
  const login = (password: string = CORRECT_PASSWORD) =>
    auth.login(tenant, { email, password, deviceId: 'web-device-0001' } as any, context);
  return { auth, login, prisma, sessions, tokens, lockout, audit, loginAttempts, ssoFindMany };
}

const enforced = (overrides: Partial<SsoRow> = {}): SsoRow => ({
  tenantId: TENANT,
  providerType: 'OIDC',
  state: 'ENFORCED',
  enforced: true,
  isActive: true,
  allowedDomains: [],
  ...overrides,
});

async function refusal(promise: Promise<unknown>): Promise<AppException> {
  const error = await promise.then(
    () => {
      throw new Error('login unexpectedly succeeded');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppException);
  return error as AppException;
}

describe('AuthService password login under ENFORCED SSO (round 7)', () => {
  it('refuses password login with SSO_REQUIRED and issues no session or challenge', async () => {
    const h = build({ sso: [enforced()] });
    const error = await refusal(h.login());
    expect(error.code).toBe(ErrorCode.SSO_REQUIRED);
    expect(error.getStatus()).toBe(403);
    expect(h.sessions.createOrReuse).not.toHaveBeenCalled();
    expect(h.tokens.issueTokenPair).not.toHaveBeenCalled();
    expect(h.tokens.issueTwoFactorChallenge).not.toHaveBeenCalled();
    expect(h.loginAttempts).toEqual([expect.objectContaining({ successful: false, reason: 'sso_required' })]);
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'DENIED', metadata: { reason: 'sso_required', providers: ['OIDC'] } }),
    );
  });

  it('also refuses a 2FA-enabled account before any challenge is issued', async () => {
    const h = build({ twoFactorEnabled: true, sso: [enforced({ providerType: 'SAML' })] });
    expect((await refusal(h.login())).code).toBe(ErrorCode.SSO_REQUIRED);
    expect(h.tokens.issueTwoFactorChallenge).not.toHaveBeenCalled();
  });

  it('a wrong password still answers INVALID_CREDENTIALS and counts towards lockout (no policy leak)', async () => {
    const h = build({ sso: [enforced()] });
    const error = await refusal(h.login('wrong-password'));
    expect(error.code).toBe(ErrorCode.INVALID_CREDENTIALS);
    expect(h.lockout.registerFailure).toHaveBeenCalledTimes(1);
    expect(h.ssoFindMany).not.toHaveBeenCalled();
  });

  it('allowedDomains limit enforcement to accounts in those domains', async () => {
    const staff = build({ email: 'ops@acme.test', sso: [enforced({ allowedDomains: ['acme.test'] })] });
    expect((await refusal(staff.login())).code).toBe(ErrorCode.SSO_REQUIRED);

    const retail = build({ email: 'retail@gmail.test', sso: [enforced({ allowedDomains: ['acme.test'] })] });
    await expect(retail.login()).resolves.toEqual(expect.objectContaining({ sessionId: 'session-1', tokens: expect.objectContaining({ accessToken: 'access' }) }));
  });

  it('domain matching is case-insensitive', async () => {
    const h = build({ email: 'ops@acme.test', sso: [enforced({ allowedDomains: ['ACME.TEST'] })] });
    expect((await refusal(h.login())).code).toBe(ErrorCode.SSO_REQUIRED);
  });

  it('ENABLED (not enforced), disabled or inactive configurations leave password login alone', async () => {
    for (const row of [
      enforced({ state: 'ENABLED', enforced: false }),
      enforced({ enforced: false }),
      enforced({ state: 'DISABLED', isActive: false }),
      enforced({ isActive: false }),
      enforced({ tenantId: '99999999-9999-4999-8999-999999999999' }),
    ]) {
      const h = build({ sso: [row] });
      await expect(h.login()).resolves.toEqual(expect.objectContaining({ sessionId: 'session-1', tokens: expect.objectContaining({ accessToken: 'access' }) }));
    }
  });

  it('platform staff are the break-glass path and are exempt', async () => {
    const h = build({ isPlatformUser: true, sso: [enforced()] });
    await expect(h.login()).resolves.toEqual(expect.objectContaining({ sessionId: 'session-1', tokens: expect.objectContaining({ accessToken: 'access' }) }));
    expect(h.ssoFindMany).not.toHaveBeenCalled();
  });

  it('a failing policy lookup fails the login instead of allowing the password', async () => {
    const h = build({ ssoLookupFails: true });
    await expect(h.login()).rejects.toThrow('database unavailable');
    expect(h.sessions.createOrReuse).not.toHaveBeenCalled();
    expect(h.tokens.issueTokenPair).not.toHaveBeenCalled();
  });
});
