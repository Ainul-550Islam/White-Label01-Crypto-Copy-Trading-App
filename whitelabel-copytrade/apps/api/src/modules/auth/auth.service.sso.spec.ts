import { ErrorCode } from '@wlct/shared-types';

import { AppException } from '../../common/errors/app.exception';
import type { TenantContext } from '../../common/types/request.types';
import { AuthService } from './auth.service';
import { SessionService } from './services/session.service';
import { JwtStrategy } from './strategies/jwt.strategy';

/**
 * Part 11 [28]-[30]: SSO completion goes through the EXISTING session
 * machinery (SessionService + TokenService + JwtStrategy), not a parallel
 * one. The session is server-side and revocable; revocation kills both the
 * refresh tokens and every live access token of the session.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tenant: TenantContext = {
  tenantId: TENANT,
  slug: 'acme',
  status: 'ACTIVE',
  source: 'subdomain',
  defaultLocale: 'en',
  defaultCurrency: 'USD',
} as TenantContext;
const device = {
  deviceId: 'web-device-0001',
  deviceName: 'Chrome',
  platform: 'web',
  appVersion: null,
};
const context = { ipHash: 'iphash', userAgent: 'jest', requestId: 'req-1', locale: 'en' };

interface Store {
  users: Array<Record<string, any>>;
  sessions: Array<Record<string, any>>;
  refreshTokens: Array<Record<string, any>>;
  loginAttempts: Array<Record<string, any>>;
  /** Round 8: SSO login transactions (the session origin is read from them). */
  transactions: Array<Record<string, any>>;
}

function build(store: Store) {
  const matches = (row: Record<string, any>, where: Record<string, any>) =>
    Object.entries(where).every(([k, v]) =>
      v === null ? row[k] === null || row[k] === undefined : row[k] === v,
    );
  const prisma: any = {
    user: {
      findFirst: jest.fn(
        async ({ where }: any) => store.users.find((u) => matches(u, where)) ?? null,
      ),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => {
        const u = store.users.find((x) => x.id === where.id);
        if (!u) throw new Error('not found');
        return u;
      }),
      update: jest.fn(async ({ where, data }: any) =>
        Object.assign(
          store.users.find((x) => x.id === where.id)!,
          data,
        ),
      ),
    },
    userSession: {
      findFirst: jest.fn(
        async ({ where }: any) => store.sessions.find((s) => matches(s, where)) ?? null,
      ),
      update: jest.fn(async ({ where, data }: any) =>
        Object.assign(
          store.sessions.find((s) => s.id === where.id)!,
          data,
        ),
      ),
    },
    refreshToken: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        const rows = store.refreshTokens.filter((t) => matches(t, where));
        rows.forEach((t) => Object.assign(t, data));
        return { count: rows.length };
      }),
    },
    loginAttempt: { create: jest.fn(async ({ data }: any) => store.loginAttempts.push(data)) },
    ssoAuthTransaction: {
      findFirst: jest.fn(
        async ({ where }: any) => store.transactions.find((t) => matches(t, where)) ?? null,
      ),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const config: any = {
    jwtAccessVerificationKey: 'test-access-key',
    jwtAlgorithm: 'HS256',
    jwtIssuer: 'wlct',
    jwtAudience: 'wlct-api',
  };
  const logger: any = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const realSessions = new SessionService(prisma, config, logger);
  const sessions = {
    createOrReuse: jest.fn(async (input: any) => {
      const s = {
        id: `session-${store.sessions.length + 1}`,
        userId: input.userId,
        tenantId: input.tenantId,
        deviceId: input.deviceId,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86_400_000),
      };
      store.sessions.push(s);
      return { id: s.id, isNewDevice: false };
    }),
    revoke: jest.fn((userId: string, sessionId: string, reason: string) =>
      realSessions.revoke(userId, sessionId, reason),
    ),
  };
  const tokens = {
    issueTokenPair: jest.fn(async (input: any) => {
      store.refreshTokens.push({
        sessionId: input.sessionId,
        userId: input.userId,
        status: 'ACTIVE',
        tokenHash: 'sha512-of-refresh',
      });
      return {
        accessToken: `access.${input.sessionId}`,
        refreshToken: `refresh.${input.sessionId}`,
        expiresIn: 900,
        refreshExpiresIn: 2_592_000,
      };
    }),
    issueTwoFactorChallenge: jest.fn(async () => ({ token: 'challenge-token', expiresIn: 300 })),
    verifyTwoFactorChallenge: jest.fn(async () => ({
      sub: USER,
      tid: TENANT,
      did: device.deviceId,
      jti: 'challenge-jti',
    })),
    consumeTwoFactorChallenge: jest.fn(async () => undefined),
    revokeSessionTokens: jest.fn(async (sessionId: string, reason: string) => {
      const rows = store.refreshTokens.filter(
        (t) => t.sessionId === sessionId && t.status === 'ACTIVE',
      );
      rows.forEach((t) => Object.assign(t, { status: 'REVOKED', revokeReason: reason }));
      return rows.length;
    }),
  };
  const crypto: any = { blindIndex: (v: string) => `bi:${v}` };
  const permissions: any = {
    getEffectiveAccess: jest.fn(async () => ({
      roleKeys: ['FOLLOWER'],
      permissionKeys: ['strategy:read'],
    })),
  };
  const users: any = {
    findByIdForSession: jest.fn(async (id: string) => ({
      id,
      email: 'alice@acme.test',
      tenantId: TENANT,
    })),
  };
  const audit: any = { record: jest.fn(async () => undefined) };
  const riskDetector: any = {
    assess: jest.fn(async () => ({
      requiresNotification: false,
      isNewDevice: false,
      riskScore: 0,
    })),
  };
  const notifications: any = { enqueueTransactional: jest.fn() };
  const twoFactor = {
    verify: jest.fn(async () => ({ usedRecoveryCode: false, remainingRecoveryCodes: 8 })),
  };
  const unused: any = {};
  const auth = new AuthService(
    prisma,
    config,
    crypto,
    unused,
    tokens as any,
    sessions as any,
    twoFactor as any,
    unused,
    users,
    permissions,
    unused,
    audit,
    riskDetector,
    notifications,
    logger,
  );
  const jwt = new JwtStrategy(config, prisma);
  return { auth, prisma, sessions, tokens, audit, jwt, twoFactor };
}

function freshStore(overrides: Record<string, unknown> = {}): Store {
  return {
    users: [
      {
        id: USER,
        tenantId: TENANT,
        email: 'alice@acme.test',
        status: 'ACTIVE',
        twoFactorEnabled: false,
        deletedAt: null,
        isPlatformUser: false,
        sessionVersion: 3,
        passwordHash: '$argon2id$secret',
        ...overrides,
      },
    ],
    sessions: [],
    refreshTokens: [],
    loginAttempts: [],
    transactions: [],
  };
}

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppException);
    return (error as AppException).code;
  }
  throw new Error('expected a refusal');
}

describe('AuthService SSO completion (Part 11)', () => {
  it('[28] issues a session through the existing session + token services, bound to the request tenant and device', async () => {
    const store = freshStore();
    const { auth, sessions, tokens, audit, prisma } = build(store);
    const result = await auth.completeSsoLogin(USER, tenant, device, context);
    expect(sessions.createOrReuse).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        tenantId: TENANT,
        deviceId: device.deviceId,
        ipHash: 'iphash',
        trusted: false,
      }),
    );
    expect(tokens.issueTokenPair).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        tenantId: TENANT,
        sessionId: 'session-1',
        sessionVersion: 3,
      }),
    );
    expect(result).toMatchObject({
      sessionId: 'session-1',
      tokens: { accessToken: 'access.session-1' },
      user: { id: USER },
    });
    expect(store.loginAttempts).toEqual([
      expect.objectContaining({
        tenantId: TENANT,
        userId: USER,
        successful: true,
        reason: 'sso',
        deviceId: device.deviceId,
      }),
    ]);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        actorId: USER,
        resourceType: 'UserSession',
        resourceId: 'session-1',
      }),
    );
    // The user lookup is tenant-scoped and never reads the password hash.
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: USER, tenantId: TENANT, deletedAt: null },
      select: { id: true, email: true, status: true, twoFactorEnabled: true },
    });
  });

  it('round 7: the session records the SSO method and issuing configuration (for RP-initiated logout)', async () => {
    const oidcStore = freshStore();
    const oidc = build(oidcStore);
    await oidc.auth.completeSsoLogin(USER, tenant, device, context, {
      providerType: 'OIDC',
      configurationId: '22222222-2222-4222-8222-222222222222',
    });
    expect(oidc.sessions.createOrReuse).toHaveBeenCalledWith(
      expect.objectContaining({ authMethod: 'SSO_OIDC', ssoConfigurationId: '22222222-2222-4222-8222-222222222222' }),
    );

    const samlStore = freshStore();
    const saml = build(samlStore);
    await saml.auth.completeSsoLogin(USER, tenant, device, context, {
      providerType: 'SAML',
      configurationId: '22222222-2222-4222-8222-222222222222',
    });
    expect(saml.sessions.createOrReuse).toHaveBeenCalledWith(expect.objectContaining({ authMethod: 'SSO_SAML' }));

    // Without the provider binding the session is not marked as SSO.
    const plainStore = freshStore();
    const plain = build(plainStore);
    await plain.auth.completeSsoLogin(USER, tenant, device, context);
    expect(plain.sessions.createOrReuse).toHaveBeenCalledWith(
      expect.objectContaining({ authMethod: 'PASSWORD', ssoConfigurationId: null }),
    );
  });

  it('[30] the login result carries no password hash or provider material', async () => {
    const store = freshStore();
    const { auth } = build(store);
    const json = JSON.stringify(await auth.completeSsoLogin(USER, tenant, device, context));
    expect(json).not.toMatch(/passwordHash|argon2|id_token|client_secret/i);
  });

  it('refuses users of another tenant, deleted users and unusable accounts without creating a session', async () => {
    for (const [overrides, expected] of [
      [{ tenantId: OTHER }, ErrorCode.INVALID_CREDENTIALS],
      [{ deletedAt: new Date() }, ErrorCode.INVALID_CREDENTIALS],
      [{ status: 'SUSPENDED' }, ErrorCode.ACCOUNT_DISABLED],
      [{ status: 'DEACTIVATED' }, ErrorCode.ACCOUNT_DISABLED],
      [{ status: 'LOCKED' }, ErrorCode.ACCOUNT_LOCKED],
    ] as const) {
      const store = freshStore(overrides as Record<string, unknown>);
      const { auth, sessions, tokens } = build(store);
      expect(await errorCode(auth.completeSsoLogin(USER, tenant, device, context))).toBe(expected);
      expect(sessions.createOrReuse).not.toHaveBeenCalled();
      expect(tokens.issueTokenPair).not.toHaveBeenCalled();
    }
  });

  it('a 2FA-enabled account gets the standard two-factor challenge instead of a session', async () => {
    const store = freshStore({ twoFactorEnabled: true });
    const { auth, sessions, tokens } = build(store);
    const result = await auth.completeSsoLogin(USER, tenant, device, context);
    expect(result).toMatchObject({ twoFactorRequired: true, challengeToken: 'challenge-token' });
    expect(tokens.issueTwoFactorChallenge).toHaveBeenCalledWith(USER, TENANT, device.deviceId);
    expect(sessions.createOrReuse).not.toHaveBeenCalled();
    expect(store.loginAttempts).toEqual([
      expect.objectContaining({ successful: false, reason: 'sso_two_factor_required' }),
    ]);
  });

  it('[29] an SSO session is revocable: revocation closes the session, revokes its refresh tokens and rejects its access tokens', async () => {
    const store = freshStore();
    const { auth, jwt } = build(store);
    const result = (await auth.completeSsoLogin(USER, tenant, device, context)) as {
      sessionId: string;
    };
    const payload: any = {
      typ: 'access',
      sub: USER,
      tid: TENANT,
      sid: result.sessionId,
      sv: 3,
      roles: ['FOLLOWER'],
      perms: [],
      jti: 'jti-1',
    };
    await expect(jwt.validate(payload)).resolves.toMatchObject({
      userId: USER,
      tenantId: TENANT,
      sessionId: result.sessionId,
    });

    await auth.revokeSsoSession(USER, result.sessionId);
    expect(store.sessions[0].revokedAt).toBeInstanceOf(Date);
    expect(store.sessions[0].revokeReason).toBe('sso_audit_failed');
    expect(store.refreshTokens.every((t) => t.status === 'REVOKED')).toBe(true);
    expect(await errorCode(jwt.validate(payload))).toBe(ErrorCode.TOKEN_REVOKED);
  });

  it('revocation is scoped to the session owner', async () => {
    const store = freshStore();
    const { auth } = build(store);
    const result = (await auth.completeSsoLogin(USER, tenant, device, context)) as {
      sessionId: string;
    };
    await expect(auth.revokeSsoSession('someone-else', result.sessionId)).rejects.toBeDefined();
    expect(store.sessions[0].revokedAt).toBeNull();
  });
});

describe('AuthService SSO session origin (round 8: SAML Single Logout, SSO + 2FA)', () => {
  const CONFIG = '22222222-2222-4222-8222-222222222222';
  const TX = '77777777-7777-4777-8777-777777777777';
  const sealed = { ciphertext: 'c2VhbGVk', aad: `${TENANT}:sso:SAML:${CONFIG}:saml_logout_context`, keyId: 'test' };
  const samlTx = (overrides: Record<string, unknown> = {}) => ({
    id: TX,
    tenantId: TENANT,
    status: 'CONSUMED',
    providerType: 'SAML',
    configurationId: CONFIG,
    samlLogoutContext: { context: sealed, subjectHash: 'subject-hash', sessionIndexHash: 'session-index-hash' },
    ...overrides,
  });
  const samlBinding = { providerType: 'SAML' as const, configurationId: CONFIG, transactionId: TX };
  const twoFactorDto = { challengeToken: 'challenge-token', deviceId: device.deviceId, code: '123456', trustDevice: false } as any;

  it('a SAML session takes its logout data (sealed context + lookup hashes) from the consumed login transaction', async () => {
    const store = freshStore();
    store.transactions.push(samlTx());
    const { auth, sessions, prisma } = build(store);
    await auth.completeSsoLogin(USER, tenant, device, context, samlBinding);
    expect(prisma.ssoAuthTransaction.findFirst).toHaveBeenCalledWith({
      where: { id: TX, tenantId: TENANT, status: 'CONSUMED' },
      select: { providerType: true, configurationId: true, samlLogoutContext: true },
    });
    expect(sessions.createOrReuse).toHaveBeenCalledWith(
      expect.objectContaining({
        authMethod: 'SSO_SAML',
        ssoConfigurationId: CONFIG,
        samlLogout: { context: sealed, subjectHash: 'subject-hash', sessionIndexHash: 'session-index-hash' },
      }),
    );
  });

  it('an OIDC transaction yields an SSO_OIDC session without SAML logout data', async () => {
    const store = freshStore();
    store.transactions.push(samlTx({ providerType: 'OIDC', samlLogoutContext: null }));
    const { auth, sessions } = build(store);
    await auth.completeSsoLogin(USER, tenant, device, context, { ...samlBinding, providerType: 'OIDC' });
    expect(sessions.createOrReuse).toHaveBeenCalledWith(
      expect.objectContaining({ authMethod: 'SSO_OIDC', ssoConfigurationId: CONFIG, samlLogout: null }),
    );
  });

  it('refuses (no session, no challenge) when the transaction is unknown, foreign, not consumed or disagrees with the binding', async () => {
    const cases: Array<[Record<string, unknown> | null, typeof samlBinding | Record<string, unknown>]> = [
      [null, samlBinding],
      [{ tenantId: OTHER }, samlBinding],
      [{ status: 'VERIFIED' }, samlBinding],
      [{ status: 'LOGOUT_PENDING' }, samlBinding],
      [{}, { ...samlBinding, configurationId: '33333333-3333-4333-8333-333333333333' }],
      [{}, { ...samlBinding, providerType: 'OIDC' }],
    ];
    for (const twoFactorEnabled of [false, true]) {
      for (const [txOverrides, binding] of cases) {
        const store = freshStore({ twoFactorEnabled });
        if (txOverrides) store.transactions.push(samlTx(txOverrides));
        const { auth, sessions, tokens } = build(store);
        expect(await errorCode(auth.completeSsoLogin(USER, tenant, device, context, binding as never))).toBe(ErrorCode.TOKEN_INVALID);
        expect(sessions.createOrReuse).not.toHaveBeenCalled();
        expect(tokens.issueTwoFactorChallenge).not.toHaveBeenCalled();
      }
    }
  });

  it('with 2FA, the challenge carries the login transaction and the verified session is labelled SSO_SAML', async () => {
    const store = freshStore({ twoFactorEnabled: true });
    store.transactions.push(samlTx());
    const { auth, sessions, tokens, twoFactor } = build(store);
    const challenge = await auth.completeSsoLogin(USER, tenant, device, context, samlBinding);
    expect(challenge).toMatchObject({ twoFactorRequired: true });
    expect(tokens.issueTwoFactorChallenge).toHaveBeenCalledWith(USER, TENANT, device.deviceId, { sso: TX });
    expect(sessions.createOrReuse).not.toHaveBeenCalled();

    tokens.verifyTwoFactorChallenge.mockResolvedValueOnce({ sub: USER, tid: TENANT, did: device.deviceId, jti: 'challenge-jti', sso: TX } as never);
    await auth.verifyTwoFactor(tenant, twoFactorDto, context);
    expect(twoFactor.verify).toHaveBeenCalledTimes(1);
    expect(tokens.consumeTwoFactorChallenge).toHaveBeenCalledWith('challenge-jti');
    expect(sessions.createOrReuse).toHaveBeenCalledWith(
      expect.objectContaining({
        authMethod: 'SSO_SAML',
        ssoConfigurationId: CONFIG,
        samlLogout: { context: sealed, subjectHash: 'subject-hash', sessionIndexHash: 'session-index-hash' },
      }),
    );
  });

  it('a password-login challenge (no SSO reference) still yields a PASSWORD session', async () => {
    const store = freshStore({ twoFactorEnabled: true });
    const { auth, sessions } = build(store);
    await auth.verifyTwoFactor(tenant, twoFactorDto, context);
    expect(sessions.createOrReuse).toHaveBeenCalledWith(
      expect.objectContaining({ authMethod: 'PASSWORD', ssoConfigurationId: null }),
    );
  });

  it('an unresolvable SSO reference in the challenge refuses the session before the second factor is checked', async () => {
    const store = freshStore({ twoFactorEnabled: true });
    store.transactions.push(samlTx({ tenantId: OTHER }));
    const { auth, sessions, tokens, twoFactor } = build(store);
    tokens.verifyTwoFactorChallenge.mockResolvedValueOnce({ sub: USER, tid: TENANT, did: device.deviceId, jti: 'challenge-jti', sso: TX } as never);
    expect(await errorCode(auth.verifyTwoFactor(tenant, twoFactorDto, context))).toBe(ErrorCode.TOKEN_INVALID);
    expect(twoFactor.verify).not.toHaveBeenCalled();
    expect(tokens.consumeTwoFactorChallenge).not.toHaveBeenCalled();
    expect(sessions.createOrReuse).not.toHaveBeenCalled();
  });
});
