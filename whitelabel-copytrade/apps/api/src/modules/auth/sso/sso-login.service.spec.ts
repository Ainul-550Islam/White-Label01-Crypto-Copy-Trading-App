import { createHash, randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import { loadSamlTestKeys } from '../../security/__fixtures__/saml-test-keys.fixture-spec';
import { SignedXml } from '../../security/__fixtures__/xml-signer.fixture-spec';
import { ErrorCode } from '@wlct/shared-types';

import { AppException } from '../../../common/errors/app.exception';
import type { TenantContext } from '../../../common/types/request.types';
import { createMetricsRegistry } from '../../observability/metrics.registry.provider';
import { SamlProviderService } from '../../security/saml-provider.service';
import { SsoAuditEventCode, SsoReasonCode } from '../../security/sso-flow.types';
import {
  FakeOidcIdp,
  OTHER_TENANT,
  TEST_CLIENT_SECRET,
  TEST_REDIRECT_URI,
  TEST_TENANT,
  TestableOidcProvider,
  fakeCrypto as fakeOidcCrypto,
} from '../../security/__fixtures__/oidc-test-idp.fixture-spec';
import { ssoClientSecretAad } from '../../security/oidc-provider.service';
import {
  createInMemorySsoPrisma,
  fakeCryptoService,
  type InMemorySsoPrisma,
} from './__fixtures__/in-memory-sso-prisma.fixture-spec';
import { SsoAuditService } from './sso-audit.service';
import { SsoIdentityService } from './sso-identity.service';
import { SsoLoginService } from './sso-login.service';
import { SsoTransactionService } from './sso-transaction.service';

/**
 * Part 11 - end-to-end SSO login orchestration.
 *
 * Real: SsoLoginService, SsoTransactionService, SsoIdentityService,
 * SsoAuditService, OidcProviderService (jose), SamlProviderService
 * (node-saml + xml-crypto), the metrics registry.
 * Faked: HTTP to the IdP (in-process IdP with real keys), the database
 * (in-memory models with unique constraints and conditional updates) and the
 * session store behind AuthService.completeSsoLogin (its real implementation
 * is covered by auth.service.sso.spec.ts).
 */

const sha256Hex = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');
const OIDC_CONFIG_A = '33333333-3333-4333-8333-333333333333';
const OIDC_CONFIG_B = '44444444-4444-4444-8444-444444444444';
const SAML_CONFIG_A = '55555555-5555-4555-8555-555555555555';
const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAROL_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DEVICE = 'web-device-0001';
const ACS = 'https://acme.app.test/v1/auth/sso/saml/acs';
const SAML_ISSUER = 'https://idp.acme.test/saml';
const SP_ENTITY = 'https://acme.app.test/saml/sp';
// Freshly generated for every jest run (test/sso-test-keys.global-setup.js); never committed.
const SAML_KEYS = loadSamlTestKeys();
const IDP_KEY = SAML_KEYS.idpKey;
const IDP_CERT = SAML_KEYS.idpCert;

const tenantCtx = (tenantId: string): TenantContext => ({
  tenantId,
  slug: tenantId === TEST_TENANT ? 'acme' : 'other',
  status: 'ACTIVE',
  source: 'subdomain',
  defaultLocale: 'en',
  defaultCurrency: 'USD',
});
const ctx = { ipHash: 'iphash-0001', userAgent: 'jest', requestId: 'req-1', locale: 'en' };

interface FakeSession {
  id: string;
  userId: string;
  tenantId: string;
  deviceId: string;
  revoked: boolean;
}

function fakeAuthService(prisma: InMemorySsoPrisma) {
  const sessions: FakeSession[] = [];
  return {
    sessions,
    completeSsoLogin: jest.fn(
      async (userId: string, tenant: TenantContext, device: { deviceId: string }) => {
        const user = prisma.user.rows.find(
          (u) => u.id === userId && u.tenantId === tenant.tenantId && !u.deletedAt,
        );
        if (!user) throw new AppException({ code: ErrorCode.INVALID_CREDENTIALS });
        if (user.status === 'SUSPENDED' || user.status === 'DEACTIVATED')
          throw new AppException({ code: ErrorCode.ACCOUNT_DISABLED });
        if (user.twoFactorEnabled) {
          return {
            twoFactorRequired: true as const,
            challengeToken: 'challenge-jwt',
            expiresIn: 300,
            methods: [],
          };
        }
        const session = {
          id: randomUUID(),
          userId,
          tenantId: tenant.tenantId,
          deviceId: device.deviceId,
          revoked: false,
        };
        sessions.push(session);
        return {
          tokens: {
            accessToken: `at.${session.id}`,
            refreshToken: `rt.${session.id}`,
            expiresIn: 900,
            refreshExpiresIn: 2_592_000,
          },
          user: { id: userId, email: user.email },
          sessionId: session.id,
        };
      },
    ),
    revokeSsoSession: jest.fn(async (_userId: string, sessionId: string) => {
      const s = sessions.find((x) => x.id === sessionId);
      if (s) s.revoked = true;
    }),
  };
}

interface Harness {
  prisma: InMemorySsoPrisma;
  idp: FakeOidcIdp;
  auth: ReturnType<typeof fakeAuthService>;
  login: SsoLoginService;
  transactions: SsoTransactionService;
  metrics: ReturnType<typeof createMetricsRegistry>;
  securityAudit: { record: jest.Mock };
}

async function harness(): Promise<Harness> {
  const prisma = createInMemorySsoPrisma();
  const crypto = fakeCryptoService();
  const idp = await FakeOidcIdp.create();
  const oidc = new TestableOidcProvider(idp, prisma, fakeOidcCrypto());
  const saml = new SamlProviderService(prisma as never);
  const transactions = new SsoTransactionService(prisma as never, crypto as never);
  const roles = {
    findByKeys: jest.fn(async (_t: string, keys: string[]) =>
      keys.map((k) => ({ id: `role-${k}`, key: k })),
    ),
  };
  const passwords = { hash: jest.fn(async () => '$argon2id$unusable') };
  const policies = { getEffectivePolicy: jest.fn(async () => ({ jitProvisioning: false })) };
  const identities = new SsoIdentityService(
    prisma as never,
    crypto as never,
    passwords as never,
    roles as never,
    policies as never,
  );
  const securityAudit = { record: jest.fn(async () => undefined) };
  const metrics = createMetricsRegistry();
  const audit = new SsoAuditService(prisma as never, securityAudit as never, metrics);
  const auth = fakeAuthService(prisma);
  const login = new SsoLoginService(
    prisma as never,
    auth as never,
    oidc,
    saml,
    transactions,
    identities,
    audit,
  );

  const baseOidc = {
    providerType: 'OIDC',
    state: 'ENABLED',
    isActive: true,
    issuer: idp.issuer,
    audience: null,
    discoveryUrl: null,
    jwksUrl: null,
    ssoUrl: null,
    scopes: ['openid', 'email', 'profile'],
    tokenEndpointAuthMethod: 'client_secret_basic',
    redirectUri: TEST_REDIRECT_URI,
    pkceRequired: true,
    clockSkewSec: 60,
    maxAuthAgeSec: null,
    allowedAlgorithms: [],
    allowedDomains: ['acme.test'],
    jitEnabled: false,
    defaultRole: null,
    enforced: false,
    entityId: null,
    acsUrl: null,
    certificate: null,
    wantResponseSigned: false,
  };
  prisma.ssoConfiguration.rows.push(
    {
      ...baseOidc,
      id: OIDC_CONFIG_A,
      tenantId: TEST_TENANT,
      clientId: 'wlct-client-123',
      clientSecretCiphertext: fakeOidcCryptoEnvelope(TEST_TENANT),
    },
    {
      ...baseOidc,
      id: OIDC_CONFIG_B,
      tenantId: OTHER_TENANT,
      clientId: 'wlct-client-123',
      clientSecretCiphertext: fakeOidcCryptoEnvelope(OTHER_TENANT),
    },
    {
      ...baseOidc,
      id: SAML_CONFIG_A,
      tenantId: TEST_TENANT,
      providerType: 'SAML',
      issuer: SAML_ISSUER,
      clientId: null,
      clientSecretCiphertext: null,
      entityId: SP_ENTITY,
      ssoUrl: 'https://idp.acme.test/sso',
      acsUrl: ACS,
      certificate: IDP_CERT,
      redirectUri: TEST_REDIRECT_URI,
    },
  );
  prisma.user.rows.push(
    {
      id: ALICE,
      tenantId: TEST_TENANT,
      email: 'alice@acme.test',
      emailIndex: crypto.blindIndex('alice@acme.test'),
      status: 'ACTIVE',
      deletedAt: null,
      isPlatformUser: false,
      twoFactorEnabled: false,
      passwordHash: '$argon2id$alice-secret-hash',
    },
    {
      id: BOB,
      tenantId: TEST_TENANT,
      email: 'bob@acme.test',
      emailIndex: crypto.blindIndex('bob@acme.test'),
      status: 'SUSPENDED',
      deletedAt: null,
      isPlatformUser: false,
      twoFactorEnabled: false,
      passwordHash: '$argon2id$bob-secret-hash',
    },
    {
      id: CAROL_B,
      tenantId: OTHER_TENANT,
      email: 'carol@acme.test',
      emailIndex: crypto.blindIndex('carol@acme.test'),
      status: 'ACTIVE',
      deletedAt: null,
      isPlatformUser: false,
      twoFactorEnabled: false,
      passwordHash: '$argon2id$carol-secret-hash',
    },
  );
  prisma.ssoIdentity.rows.push(
    {
      id: randomUUID(),
      tenantId: TEST_TENANT,
      userId: ALICE,
      configurationId: OIDC_CONFIG_A,
      providerType: 'OIDC',
      issuer: idp.issuer,
      subject: 'oidc-subject-alice',
      linkedVia: 'JIT',
      lastLoginAt: null,
    },
    {
      id: randomUUID(),
      tenantId: TEST_TENANT,
      userId: BOB,
      configurationId: OIDC_CONFIG_A,
      providerType: 'OIDC',
      issuer: idp.issuer,
      subject: 'oidc-subject-bob',
      linkedVia: 'JIT',
      lastLoginAt: null,
    },
    {
      id: randomUUID(),
      tenantId: OTHER_TENANT,
      userId: CAROL_B,
      configurationId: OIDC_CONFIG_B,
      providerType: 'OIDC',
      issuer: idp.issuer,
      subject: 'oidc-subject-carol',
      linkedVia: 'JIT',
      lastLoginAt: null,
    },
    {
      id: randomUUID(),
      tenantId: TEST_TENANT,
      userId: ALICE,
      configurationId: SAML_CONFIG_A,
      providerType: 'SAML',
      issuer: SAML_ISSUER,
      subject: 'saml-subject-alice',
      linkedVia: 'JIT',
      lastLoginAt: null,
    },
  );
  return { prisma, idp, auth, login, transactions, metrics, securityAudit };
}

function fakeOidcCryptoEnvelope(tenantId: string) {
  return { fakeSecret: TEST_CLIENT_SECRET, aad: ssoClientSecretAad(tenantId) };
}

async function startOidc(
  h: Harness,
  tenantId = TEST_TENANT,
  deviceId = DEVICE,
  returnTo: string | null = '/dashboard',
) {
  const res = await h.login.start(
    tenantCtx(tenantId),
    { providerType: 'OIDC', deviceId, returnTo },
    ctx,
  );
  const url = new URL(res.authorizationUrl);
  return {
    res,
    state: String(url.searchParams.get('state')),
    nonce: String(url.searchParams.get('nonce')),
    challenge: url.searchParams.get('code_challenge'),
    bindingToken: res.bindingToken,
  };
}

let codeSeq = 0;
async function idpAuthenticates(
  h: Harness,
  started: { nonce: string; challenge: string | null },
  claims: Record<string, unknown> = {},
): Promise<string> {
  const token = await h.idp.sign(h.idp.claims({ nonce: started.nonce, ...claims }));
  const code = `authcode-${++codeSeq}-${randomUUID()}`;
  h.idp.issueCode(code, token, TEST_REDIRECT_URI, started.challenge ?? undefined);
  return code;
}

async function rejectedWith(
  promise: Promise<unknown>,
  code: ErrorCode = ErrorCode.UNAUTHORIZED,
): Promise<AppException> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AppException);
  expect((caught as AppException).code).toBe(code);
  return caught as AppException;
}

const lastRejection = (h: Harness) =>
  [...h.prisma.ssoAuditEvent.rows]
    .reverse()
    .find((r) => r.eventCode === SsoAuditEventCode.LOGIN_REJECTED);
const eventCodes = (h: Harness) => h.prisma.ssoAuditEvent.rows.map((r) => r.eventCode);
const metricValue = (h: Harness, family: string, label: string) => {
  const line = h.metrics
    .render()
    .split('\n')
    .find((l) => l.startsWith(family) && l.includes(label));
  return line ? Number(line.trim().split(/\s+/).pop()) : 0;
};

describe('SsoLoginService - OIDC authorization-code flow (Part 11)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
  });

  it('[1] start creates a server-side transaction holding only the hash of a fresh random state', async () => {
    const a = await startOidc(h);
    const b = await startOidc(h);
    expect(a.state).not.toBe(b.state);
    expect(a.state.length).toBeGreaterThanOrEqual(43);
    const tx = h.prisma.ssoAuthTransaction.rows.find((r) => r.stateHash === sha256Hex(a.state));
    expect(tx).toBeDefined();
    expect(tx).toMatchObject({
      tenantId: TEST_TENANT,
      configurationId: OIDC_CONFIG_A,
      providerType: 'OIDC',
      status: 'PENDING',
      deviceId: DEVICE,
      redirectUri: TEST_REDIRECT_URI,
      returnTo: '/dashboard',
    });
    expect(tx!.expiresAt.getTime() - Date.now()).toBeGreaterThan(590_000);
    expect(tx!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(600_000);
    expect(JSON.stringify(h.prisma.ssoAuthTransaction.rows)).not.toContain(a.state);
    expect(eventCodes(h)).toContain(SsoAuditEventCode.AUTHORIZATION_STARTED);
  });

  it('[2] start creates a fresh nonce, sent to the IdP and stored only as a hash', async () => {
    const a = await startOidc(h);
    const b = await startOidc(h);
    expect(a.nonce).not.toBe(b.nonce);
    const tx = h.prisma.ssoAuthTransaction.rows.find((r) => r.stateHash === sha256Hex(a.state))!;
    expect(tx.nonceHash).toBe(sha256Hex(a.nonce));
    expect(JSON.stringify(h.prisma.ssoAuthTransaction.rows)).not.toContain(a.nonce);
    expect(JSON.stringify(h.prisma.ssoAuthTransaction.rows)).not.toContain(a.bindingToken);
  });

  it('[3] a PKCE S256 verifier/challenge is generated when configured, and omitted for a confidential client that opts out', async () => {
    const a = await startOidc(h);
    const tx = h.prisma.ssoAuthTransaction.rows.find((r) => r.stateHash === sha256Hex(a.state))!;
    const verifier = h.transactions.decryptVerifier(tx as never)!;
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(a.challenge).toBe(createHash('sha256').update(verifier, 'ascii').digest('base64url'));
    expect(JSON.stringify(tx)).not.toContain(verifier);
    expect(tx.pkceVerifierCiphertext.aad).toBe(`${TEST_TENANT}:sso:${tx.id}:pkce_verifier`);
    h.prisma.ssoConfiguration.rows.find((c) => c.id === OIDC_CONFIG_A)!.pkceRequired = false;
    const b = await startOidc(h);
    expect(b.challenge).toBeNull();
  });

  it('[24][28] a valid callback maps the verified subject to the right user and issues a session through AuthService', async () => {
    const s = await startOidc(h);
    const code = await idpAuthenticates(h, s);
    const out = await h.login.complete(
      tenantCtx(TEST_TENANT),
      { state: s.state, code, bindingToken: s.bindingToken, deviceId: DEVICE, platform: 'web' },
      ctx,
    );
    expect(out.returnTo).toBe('/dashboard');
    expect(out.result).toMatchObject({
      user: { id: ALICE },
      tokens: { accessToken: expect.any(String) },
    });
    expect(h.auth.completeSsoLogin).toHaveBeenCalledWith(
      ALICE,
      expect.objectContaining({ tenantId: TEST_TENANT }),
      expect.objectContaining({ deviceId: DEVICE, platform: 'web' }),
      ctx,
      // Round 7: the session records which SSO configuration issued it (logout-url).
      // Round 8: and the consumed login transaction it came from.
      {
        providerType: 'OIDC',
        configurationId: OIDC_CONFIG_A,
        transactionId: h.prisma.ssoAuthTransaction.rows.find((r) => r.stateHash === sha256Hex(s.state))!.id,
      },
    );
    expect(h.auth.sessions).toHaveLength(1);
    expect(h.idp.tokenRequests[0].body.get('redirect_uri')).toBe(TEST_REDIRECT_URI);
    expect(
      h.prisma.ssoAuthTransaction.rows.find((r) => r.stateHash === sha256Hex(s.state))!.status,
    ).toBe('CONSUMED');
    expect(metricValue(h, 'wlct_sso_logins_total', 'result="succeeded"')).toBe(1);
  });

  it('[4] an unknown state is rejected without contacting the IdP or creating a session', async () => {
    await rejectedWith(
      h.login.complete(
        tenantCtx(TEST_TENANT),
        { state: 'x'.repeat(43), code: 'c', bindingToken: 'b'.repeat(43), deviceId: DEVICE },
        ctx,
      ),
    );
    expect(lastRejection(h)!.reasonCode).toBe(SsoReasonCode.STATE_UNKNOWN);
    expect(h.idp.tokenRequests).toHaveLength(0);
    expect(h.auth.sessions).toHaveLength(0);
    expect(metricValue(h, 'wlct_sso_failures_total', 'stage="state"')).toBe(1);
  });

  it('[5] an expired state is rejected', async () => {
    const s = await startOidc(h);
    const code = await idpAuthenticates(h, s);
    h.prisma.ssoAuthTransaction.rows.find((r) => r.stateHash === sha256Hex(s.state))!.expiresAt =
      new Date(Date.now() - 1000);
    await rejectedWith(
      h.login.complete(
        tenantCtx(TEST_TENANT),
        { state: s.state, code, bindingToken: s.bindingToken, deviceId: DEVICE },
        ctx,
      ),
    );
    expect(lastRejection(h)!.reasonCode).toBe(SsoReasonCode.STATE_EXPIRED);
    expect(h.idp.tokenRequests).toHaveLength(0);
    expect(h.auth.sessions).toHaveLength(0);
  });

  it('[6][7] a consumed state cannot be used again; a replayed callback creates no second session; concurrent callbacks yield one session', async () => {
    const s = await startOidc(h);
    const code = await idpAuthenticates(h, s);
    const input = { state: s.state, code, bindingToken: s.bindingToken, deviceId: DEVICE };
    await h.login.complete(tenantCtx(TEST_TENANT), input, ctx);
    await rejectedWith(h.login.complete(tenantCtx(TEST_TENANT), input, ctx));
    expect(lastRejection(h)!.reasonCode).toBe(SsoReasonCode.STATE_CONSUMED);
    expect(h.auth.sessions).toHaveLength(1);
    expect(h.idp.tokenRequests).toHaveLength(1);

    const s2 = await startOidc(h);
    const code2 = await idpAuthenticates(h, s2);
    const input2 = {
      state: s2.state,
      code: code2,
      bindingToken: s2.bindingToken,
      deviceId: DEVICE,
    };
    const results = await Promise.allSettled([
      h.login.complete(tenantCtx(TEST_TENANT), input2, ctx),
      h.login.complete(tenantCtx(TEST_TENANT), input2, ctx),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(h.auth.sessions).toHaveLength(2);
  });

  it('[8] a state started for one provider is rejected at another provider (OIDC state at the SAML ACS)', async () => {
    process.env.SSO_SAML_ENABLED = 'true';
    try {
      const s = await startOidc(h);
      const outcome = await h.login.consumeSamlResponse(
        tenantCtx(TEST_TENANT),
        { SAMLResponse: 'PHg+', RelayState: s.state },
        ctx,
      );
      expect(outcome.redirectTo).toContain('error=sso_failed');
      expect(outcome.redirectTo).not.toContain('code=');
      expect(lastRejection(h)!.reasonCode).toBe(SsoReasonCode.PROVIDER_MISMATCH);
      expect(h.auth.sessions).toHaveLength(0);
    } finally {
      delete process.env.SSO_SAML_ENABLED;
    }
  });

  it("[9][45] a state of tenant A is rejected on tenant B, without burning or revealing A's transaction", async () => {
    const s = await startOidc(h, TEST_TENANT);
    const code = await idpAuthenticates(h, s);
    await rejectedWith(
      h.login.complete(
        tenantCtx(OTHER_TENANT),
        { state: s.state, code, bindingToken: s.bindingToken, deviceId: DEVICE },
        ctx,
      ),
    );
    const rejection = lastRejection(h)!;
    expect(rejection).toMatchObject({
      tenantId: OTHER_TENANT,
      reasonCode: SsoReasonCode.TENANT_MISMATCH,
      transactionId: null,
    });
    // Tenant B's audit trail never references tenant A's transaction or configuration.
    for (const row of h.prisma.ssoAuditEvent.rows.filter((r) => r.tenantId === OTHER_TENANT)) {
      expect(row.transactionId).toBeNull();
      expect(row.configurationId).toBeNull();
    }
    const tx = h.prisma.ssoAuthTransaction.rows.find((r) => r.stateHash === sha256Hex(s.state))!;
    expect(rejection.correlationId).not.toBe(tx.correlationId);
    expect(tx.status).toBe('PENDING');
    expect(h.idp.tokenRequests).toHaveLength(0);
    expect(h.auth.sessions).toHaveLength(0);
    // The rightful tenant can still finish its login.
    await expect(
      h.login.complete(
        tenantCtx(TEST_TENANT),
        { state: s.state, code, bindingToken: s.bindingToken, deviceId: DEVICE },
        ctx,
      ),
    ).resolves.toBeDefined();
    expect(h.auth.sessions[0]).toMatchObject({ tenantId: TEST_TENANT, userId: ALICE });
  });

  it("a callback for tenant A cannot create a session for a tenant-B user (same IdP, B's subject)", async () => {
    const s = await startOidc(h, TEST_TENANT);
    const code = await idpAuthenticates(h, s, {
      sub: 'oidc-subject-carol',
      email: 'carol@acme.test',
    });
    await rejectedWith(
      h.login.complete(
        tenantCtx(TEST_TENANT),
        { state: s.state, code, bindingToken: s.bindingToken, deviceId: DEVICE },
        ctx,
      ),
    );
    // carol's link lives in tenant B; in tenant A the subject is unlinked and no tenant-A account has her email.
    expect(lastRejection(h)!.reasonCode).toBe(SsoReasonCode.JIT_DISABLED);
    expect(h.auth.sessions.filter((x) => x.userId === CAROL_B)).toHaveLength(0);
  });

  it('[25] a link that points at a user of another tenant is refused', async () => {
    h.prisma.ssoIdentity.rows.push({
      id: randomUUID(),
      tenantId: TEST_TENANT,
      userId: CAROL_B,
      configurationId: OIDC_CONFIG_A,
      providerType: 'OIDC',
      issuer: h.idp.issuer,
      subject: 'oidc-subject-corrupt',
      linkedVia: 'JIT',
    });
    const s = await startOidc(h);
    const code = await idpAuthenticates(h, s, { sub: 'oidc-subject-corrupt' });
    await rejectedWith(
      h.login.complete(
        tenantCtx(TEST_TENANT),
        { state: s.state, code, bindingToken: s.bindingToken, deviceId: DEVICE },
        ctx,
      ),
    );
    expect(lastRejection(h)!.reasonCode).toBe(SsoReasonCode.USER_TENANT_MISMATCH);
    expect(h.auth.sessions).toHaveLength(0);
  });

  it('[27] a suspended user cannot log in', async () => {
    const s = await startOidc(h);
    const code = await idpAuthenticates(h, s, { sub: 'oidc-subject-bob', email: 'bob@acme.test' });
    await rejectedWith(
      h.login.complete(
        tenantCtx(TEST_TENANT),
        { state: s.state, code, bindingToken: s.bindingToken, deviceId: DEVICE },
        ctx,
      ),
    );
    expect(lastRejection(h)!.reasonCode).toBe(SsoReasonCode.ACCOUNT_UNAVAILABLE);
    expect(h.auth.sessions).toHaveLength(0);
  });

  it('[17] a nonce from another login transaction is rejected (and [46] a valid code cannot be substituted into another transaction)', async () => {
    const first = await startOidc(h);
    const second = await startOidc(h);
    // The IdP issued a code for the FIRST login (its nonce, its PKCE challenge)...
    const codeForFirst = await idpAuthenticates(h, first);
    // ...and the attacker replays it into the SECOND transaction.
    await rejectedWith(
      h.login.complete(
        tenantCtx(TEST_TENANT),
        {
          state: second.state,
          code: codeForFirst,
          bindingToken: second.bindingToken,
          deviceId: DEVICE,
        },
        ctx,
      ),
    );
    expect([SsoReasonCode.PKCE_FAILED, SsoReasonCode.NONCE_MISMATCH]).toContain(
      lastRejection(h)!.reasonCode,
    );
    expect(h.auth.sessions).toHaveLength(0);
    // Same substitution against an IdP that does not enforce PKCE: the nonce check alone refuses it.
    const third = await startOidc(h);
    const token = await h.idp.sign(h.idp.claims({ nonce: first.nonce }));
    const looseCode = `loose-${randomUUID()}`;
    h.idp.issueCode(looseCode, token, TEST_REDIRECT_URI);
    await rejectedWith(
      h.login.complete(
        tenantCtx(TEST_TENANT),
        { state: third.state, code: looseCode, bindingToken: third.bindingToken, deviceId: DEVICE },
        ctx,
      ),
    );
    expect(lastRejection(h)!.reasonCode).toBe(SsoReasonCode.NONCE_MISMATCH);
    expect(eventCodes(h)).toContain(SsoAuditEventCode.NONCE_REJECTED);
    expect(h.auth.sessions).toHaveLength(0);
  });

  it('[46] a login transaction cannot be replayed for another user after it was used', async () => {
    const s = await startOidc(h);
    await h.login.complete(
      tenantCtx(TEST_TENANT),
      {
        state: s.state,
        code: await idpAuthenticates(h, s),
        bindingToken: s.bindingToken,
        deviceId: DEVICE,
      },
      ctx,
    );
    const bobCode = await idpAuthenticates(h, s, { sub: 'oidc-subject-bob' });
    await rejectedWith(
      h.login.complete(
        tenantCtx(TEST_TENANT),
        { state: s.state, code: bobCode, bindingToken: s.bindingToken, deviceId: DEVICE },
        ctx,
      ),
    );
    expect(h.auth.sessions.map((x) => x.userId)).toEqual([ALICE]);
  });

  it('[47] session fixation / login CSRF: a victim cannot be logged in through an attacker-started transaction', async () => {
    // The attacker starts a login and lures the victim to the IdP with it.
    const attacker = await startOidc(h, TEST_TENANT, 'attacker-device-01');
    const code = await idpAuthenticates(h, attacker);
    // The victim's client completes it with ITS device and without the attacker's binding secret.
    await rejectedWith(
      h.login.complete(
        tenantCtx(TEST_TENANT),
        {
          state: attacker.state,
          code,
          bindingToken: 'v'.repeat(43),
          deviceId: 'victim-device-001',
        },
        ctx,
      ),
    );
    expect([SsoReasonCode.DEVICE_MISMATCH, SsoReasonCode.BINDING_MISMATCH]).toContain(
      lastRejection(h)!.reasonCode,
    );
    expect(h.auth.sessions).toHaveLength(0);
    // The binding secret alone is not enough either.
    const s2 = await startOidc(h, TEST_TENANT, 'attacker-device-01');
    await rejectedWith(
      h.login.complete(
        tenantCtx(TEST_TENANT),
        {
          state: s2.state,
          code: await idpAuthenticates(h, s2),
          bindingToken: s2.bindingToken,
          deviceId: 'victim-device-001',
        },
        ctx,
      ),
    );
    expect(lastRejection(h)!.reasonCode).toBe(SsoReasonCode.DEVICE_MISMATCH);
    // A refused transaction is burned: even the attacker cannot finish it afterwards.
    await rejectedWith(
      h.login.complete(
        tenantCtx(TEST_TENANT),
        {
          state: s2.state,
          code: 'x',
          bindingToken: s2.bindingToken,
          deviceId: 'attacker-device-01',
        },
        ctx,
      ),
    );
    expect(h.auth.sessions).toHaveLength(0);
    // Every issued session id is server-generated (nothing client-supplied is reused).
    const ok = await startOidc(h);
    const done = await h.login.complete(
      tenantCtx(TEST_TENANT),
      {
        state: ok.state,
        code: await idpAuthenticates(h, ok),
        bindingToken: ok.bindingToken,
        deviceId: DEVICE,
      },
      ctx,
    );
    expect((done.result as { sessionId: string }).sessionId).toBe(h.auth.sessions[0].id);
  });

  it('changing the redirect target after start is rejected before any code redemption', async () => {
    const s = await startOidc(h);
    const code = await idpAuthenticates(h, s);
    h.prisma.ssoConfiguration.rows.find((c) => c.id === OIDC_CONFIG_A)!.redirectUri =
      'https://evil.example/callback';
    await rejectedWith(
      h.login.complete(
        tenantCtx(TEST_TENANT),
        { state: s.state, code, bindingToken: s.bindingToken, deviceId: DEVICE },
        ctx,
      ),
    );
    expect(lastRejection(h)!.reasonCode).toBe(SsoReasonCode.CONFIG_INVALID);
    expect(h.idp.tokenRequests).toHaveLength(0);
    expect(h.auth.sessions).toHaveLength(0);
  });

  it('changing or disabling the provider after start is rejected', async () => {
    const s = await startOidc(h);
    const code = await idpAuthenticates(h, s);
    const cfg = h.prisma.ssoConfiguration.rows.find((c) => c.id === OIDC_CONFIG_A)!;
    cfg.providerType = 'SAML';
    await rejectedWith(
      h.login.complete(
        tenantCtx(TEST_TENANT),
        { state: s.state, code, bindingToken: s.bindingToken, deviceId: DEVICE },
        ctx,
      ),
    );
    expect(lastRejection(h)!.reasonCode).toBe(SsoReasonCode.PROVIDER_MISMATCH);
    cfg.providerType = 'OIDC';
    const s2 = await startOidc(h);
    cfg.state = 'DISABLED';
    cfg.isActive = false;
    await rejectedWith(
      h.login.complete(
        tenantCtx(TEST_TENANT),
        {
          state: s2.state,
          code: await idpAuthenticates(h, s2),
          bindingToken: s2.bindingToken,
          deviceId: DEVICE,
        },
        ctx,
      ),
    );
    expect(lastRejection(h)!.reasonCode).toBe(SsoReasonCode.PROVIDER_DISABLED);
    await rejectedWith(
      h.login.start(tenantCtx(TEST_TENANT), { providerType: 'OIDC', deviceId: DEVICE }, ctx),
    );
    expect(h.auth.sessions).toHaveLength(0);
  });

  it('[48] an IdP error callback never creates a session and burns the transaction', async () => {
    const s = await startOidc(h);
    await rejectedWith(
      h.login.complete(
        tenantCtx(TEST_TENANT),
        { state: s.state, error: 'access_denied', bindingToken: s.bindingToken, deviceId: DEVICE },
        ctx,
      ),
    );
    expect(lastRejection(h)!.reasonCode).toBe(SsoReasonCode.IDP_ERROR);
    const code = await idpAuthenticates(h, s);
    await rejectedWith(
      h.login.complete(
        tenantCtx(TEST_TENANT),
        { state: s.state, code, bindingToken: s.bindingToken, deviceId: DEVICE },
        ctx,
      ),
    );
    expect(h.auth.sessions).toHaveLength(0);
    expect(h.idp.tokenRequests).toHaveLength(0);
  });

  it('[49] provider outages never become authentication success', async () => {
    const s = await startOidc(h);
    const code = await idpAuthenticates(h, s);
    h.idp.down = true;
    await rejectedWith(
      h.login.complete(
        tenantCtx(TEST_TENANT),
        { state: s.state, code, bindingToken: s.bindingToken, deviceId: DEVICE },
        ctx,
      ),
    );
    expect(lastRejection(h)!.reasonCode).toBe(SsoReasonCode.PROVIDER_UNAVAILABLE);
    expect(h.auth.sessions).toHaveLength(0);
    const fresh = await harness();
    fresh.idp.down = true;
    await rejectedWith(
      fresh.login.start(tenantCtx(TEST_TENANT), { providerType: 'OIDC', deviceId: DEVICE }, ctx),
    );
    expect(fresh.prisma.ssoAuthTransaction.rows).toHaveLength(0);
  });

  it('[26] duplicate identity mapping is refused (account already linked to another subject; concurrent JIT)', async () => {
    // alice@acme.test already has the subject oidc-subject-alice; a new subject asserting her email must not take over.
    const s = await startOidc(h);
    const code = await idpAuthenticates(h, s, {
      sub: 'oidc-subject-impostor',
      email: 'alice@acme.test',
    });
    await rejectedWith(
      h.login.complete(
        tenantCtx(TEST_TENANT),
        { state: s.state, code, bindingToken: s.bindingToken, deviceId: DEVICE },
        ctx,
      ),
    );
    expect(lastRejection(h)!.reasonCode).toBe(SsoReasonCode.IDENTITY_CONFLICT);
    expect(h.auth.sessions).toHaveLength(0);
  });

  it('returnTo must be app-relative', async () => {
    for (const bad of [
      'https://evil.example/',
      '//evil.example',
      '/\\evil',
      '/javascript:alert(1)',
    ]) {
      await rejectedWith(
        h.login.start(
          tenantCtx(TEST_TENANT),
          { providerType: 'OIDC', deviceId: DEVICE, returnTo: bad },
          ctx,
        ),
      );
    }
    expect(h.prisma.ssoAuthTransaction.rows).toHaveLength(0);
  });

  it('[50] pending-transaction cap and expiry are deterministic', async () => {
    for (let i = 0; i < 10; i += 1) await startOidc(h);
    await rejectedWith(
      h.login.start(tenantCtx(TEST_TENANT), { providerType: 'OIDC', deviceId: DEVICE }, ctx),
      ErrorCode.RATE_LIMIT_EXCEEDED,
    );
    expect(lastRejection(h)!.reasonCode).toBe(SsoReasonCode.TOO_MANY_PENDING);
    // Another client (different ip hash) is not affected.
    await expect(
      h.login.start(
        tenantCtx(TEST_TENANT),
        { providerType: 'OIDC', deviceId: DEVICE },
        { ...ctx, ipHash: 'iphash-0002' },
      ),
    ).resolves.toBeDefined();
    // Expired transactions stop counting.
    for (const row of h.prisma.ssoAuthTransaction.rows) row.expiresAt = new Date(Date.now() - 1);
    await expect(startOidc(h)).resolves.toBeDefined();
    // Expiry is exact: a transaction is unusable at expiresAt.
    const tx = h.prisma.ssoAuthTransaction.rows[h.prisma.ssoAuthTransaction.rows.length - 1];
    const at = new Date(tx.expiresAt.getTime());
    expect(() =>
      h.transactions.assertUsable(tx as never, {
        tenantId: TEST_TENANT,
        status: 'PENDING',
        now: new Date(at.getTime() - 1),
      }),
    ).not.toThrow();
    expect(() =>
      h.transactions.assertUsable(tx as never, {
        tenantId: TEST_TENANT,
        status: 'PENDING',
        now: at,
      }),
    ).toThrow();
  });

  it('[44] audit events are persisted with tenant, provider, correlation id, code, outcome and timestamp', async () => {
    const s = await startOidc(h);
    await h.login.complete(
      tenantCtx(TEST_TENANT),
      {
        state: s.state,
        code: await idpAuthenticates(h, s),
        bindingToken: s.bindingToken,
        deviceId: DEVICE,
      },
      ctx,
    );
    const tx = h.prisma.ssoAuthTransaction.rows.find((r) => r.stateHash === sha256Hex(s.state))!;
    const rows = h.prisma.ssoAuditEvent.rows.filter((r) => r.correlationId === tx.correlationId);
    expect(rows.map((r) => r.eventCode)).toEqual([
      SsoAuditEventCode.AUTHORIZATION_STARTED,
      SsoAuditEventCode.CALLBACK_RECEIVED,
      SsoAuditEventCode.SESSION_CREATED,
      SsoAuditEventCode.LOGIN_SUCCEEDED,
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({
        tenantId: TEST_TENANT,
        providerType: 'OIDC',
        configurationId: OIDC_CONFIG_A,
        transactionId: tx.id,
      });
      expect(['SUCCESS', 'INFO']).toContain(row.outcome);
      expect(row.createdAt).toBeInstanceOf(Date);
    }
    expect(rows.find((r) => r.eventCode === SsoAuditEventCode.LOGIN_SUCCEEDED)!.userId).toBe(ALICE);
    expect(h.securityAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'SSO_LOGIN_SUCCESS', userId: ALICE }),
    );
  });

  it('[29] if the success audit cannot be written, the new session is revoked and the login fails', async () => {
    const s = await startOidc(h);
    const code = await idpAuthenticates(h, s);
    const originalCreate = h.prisma.ssoAuditEvent.create.getMockImplementation()!;
    h.prisma.ssoAuditEvent.create.mockImplementation(
      async (args: { data: Record<string, any> }) => {
        if (args.data.eventCode === SsoAuditEventCode.SESSION_CREATED)
          throw new Error('audit store down');
        return originalCreate(args);
      },
    );
    await rejectedWith(
      h.login.complete(
        tenantCtx(TEST_TENANT),
        { state: s.state, code, bindingToken: s.bindingToken, deviceId: DEVICE },
        ctx,
      ),
    );
    expect(h.auth.revokeSsoSession).toHaveBeenCalledTimes(1);
    expect(h.auth.sessions).toHaveLength(1);
    expect(h.auth.sessions[0].revoked).toBe(true);
  });

  it('[30][31] responses, audit rows and logs never contain password hashes, IdP tokens, codes, state, nonce, verifier or secrets', async () => {
    const logged: string[] = [];
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((m) =>
      jest.spyOn(Logger.prototype, m).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      }),
    );
    const consoleSpies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      }),
    );
    try {
      const s = await startOidc(h);
      const idToken = await h.idp.sign(h.idp.claims({ nonce: s.nonce }));
      const code = `authcode-secret-${randomUUID()}`;
      h.idp.issueCode(code, idToken, TEST_REDIRECT_URI, s.challenge ?? undefined);
      const tx = h.prisma.ssoAuthTransaction.rows.find((r) => r.stateHash === sha256Hex(s.state))!;
      const verifier = h.transactions.decryptVerifier(tx as never)!;
      const out = await h.login.complete(
        tenantCtx(TEST_TENANT),
        { state: s.state, code, bindingToken: s.bindingToken, deviceId: DEVICE },
        ctx,
      );
      // A failing attempt too (its error paths must not leak either).
      const s2 = await startOidc(h);
      const badToken = await h.idp.sign(h.idp.claims({ nonce: 'wrong-nonce' }));
      const badCode = `authcode-bad-${randomUUID()}`;
      h.idp.issueCode(badCode, badToken, TEST_REDIRECT_URI, s2.challenge ?? undefined);
      await rejectedWith(
        h.login.complete(
          tenantCtx(TEST_TENANT),
          { state: s2.state, code: badCode, bindingToken: s2.bindingToken, deviceId: DEVICE },
          ctx,
        ),
      );

      const secrets = [
        idToken,
        badToken,
        code,
        badCode,
        s.state,
        s.nonce,
        s.bindingToken,
        s2.state,
        verifier,
        TEST_CLIENT_SECRET,
        'at-never-used',
        '$argon2id$alice-secret-hash',
      ];
      const response = JSON.stringify(out);
      const audit = JSON.stringify(h.prisma.ssoAuditEvent.rows);
      const securityAudit = JSON.stringify(h.securityAudit.record.mock.calls);
      const logs = logged.join('\n');
      for (const secret of secrets) {
        expect(response).not.toContain(secret);
        expect(audit).not.toContain(secret);
        expect(securityAudit).not.toContain(secret);
        expect(logs).not.toContain(secret);
      }
      expect(response).not.toMatch(/passwordHash|password_hash|id_token|idToken|client_secret/i);
      expect(logs.length).toBeGreaterThan(0);
    } finally {
      spies.forEach((s) => s.mockRestore());
      consoleSpies.forEach((s) => s.mockRestore());
    }
  });

  it('a 2FA-enabled account gets the normal two-factor challenge (no session) and the MFA audit event', async () => {
    h.prisma.user.rows.find((u) => u.id === ALICE)!.twoFactorEnabled = true;
    const s = await startOidc(h);
    const out = await h.login.complete(
      tenantCtx(TEST_TENANT),
      {
        state: s.state,
        code: await idpAuthenticates(h, s),
        bindingToken: s.bindingToken,
        deviceId: DEVICE,
      },
      ctx,
    );
    expect(out.result).toMatchObject({ twoFactorRequired: true });
    expect(h.auth.sessions).toHaveLength(0);
    expect(eventCodes(h)).toContain(SsoAuditEventCode.MFA_CHALLENGE_ISSUED);
  });
});

// ---------------------------------------------------------------------------
// SAML end to end
// ---------------------------------------------------------------------------

function signedSamlResponse(
  requestId: string,
  overrides: { nameId?: string; assertionId?: string } = {},
): string {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const assertion =
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${overrides.assertionId ?? '_a' + randomUUID().replace(/-/g, '')}" Version="2.0" IssueInstant="${iso(now)}">` +
    `<saml:Issuer>${SAML_ISSUER}</saml:Issuer>` +
    `<saml:Subject><saml:NameID>${overrides.nameId ?? 'saml-subject-alice'}</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${requestId}" NotOnOrAfter="${iso(now + 300_000)}" Recipient="${ACS}"/></saml:SubjectConfirmation></saml:Subject>` +
    `<saml:Conditions NotBefore="${iso(now - 30_000)}" NotOnOrAfter="${iso(now + 300_000)}"><saml:AudienceRestriction><saml:Audience>${SP_ENTITY}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${iso(now)}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>` +
    `<saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>alice@acme.test</saml:AttributeValue></saml:Attribute></saml:AttributeStatement>` +
    `</saml:Assertion>`;
  const sig = new SignedXml({ privateKey: IDP_KEY, publicCert: IDP_CERT });
  sig.addReference({
    xpath: "//*[local-name(.)='Assertion']",
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
  });
  sig.canonicalizationAlgorithm = 'http://www.w3.org/2001/10/xml-exc-c14n#';
  sig.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
  sig.computeSignature(assertion, {
    location: {
      reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']",
      action: 'after',
    },
  });
  const response =
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${randomUUID().replace(/-/g, '')}" Version="2.0" IssueInstant="${iso(now)}" Destination="${ACS}" InResponseTo="${requestId}">` +
    `<saml:Issuer>${SAML_ISSUER}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
    sig.getSignedXml() +
    `</samlp:Response>`;
  return Buffer.from(response).toString('base64');
}

describe('SsoLoginService - SAML Web-SSO with one-time hand-off (Part 11)', () => {
  let h: Harness;
  beforeEach(async () => {
    process.env.SSO_SAML_ENABLED = 'true';
    h = await harness();
  });
  afterEach(() => {
    delete process.env.SSO_SAML_ENABLED;
  });

  async function startSaml(deviceId = DEVICE) {
    const res = await h.login.start(
      tenantCtx(TEST_TENANT),
      { providerType: 'SAML', deviceId, returnTo: '/portfolio' },
      ctx,
    );
    const relayState = String(new URL(res.authorizationUrl).searchParams.get('RelayState'));
    const tx = h.prisma.ssoAuthTransaction.rows.find((r) => r.stateHash === sha256Hex(relayState))!;
    return { res, relayState, tx };
  }

  describe('round 8: start without a providerType (the web login page\'s single SSO button)', () => {
    const configA = (id: string) => h.prisma.ssoConfiguration.rows.find((c) => c.id === id)!;
    const startDefault = () => h.login.start(tenantCtx(TEST_TENANT), { deviceId: DEVICE, returnTo: '/portfolio' }, ctx);

    it('with OIDC and SAML both enabled and neither enforced, OIDC is started', async () => {
      const res = await startDefault();
      expect(res.providerType).toBe('OIDC');
      expect(h.prisma.ssoAuthTransaction.rows[0]).toMatchObject({ providerType: 'OIDC', configurationId: OIDC_CONFIG_A });
    });

    it('the enforced provider wins when both are enabled', async () => {
      configA(SAML_CONFIG_A).state = 'ENFORCED';
      const res = await startDefault();
      expect(res.providerType).toBe('SAML');
      expect(new URL(res.authorizationUrl).searchParams.get('SAMLRequest')).toBeTruthy();
      expect(h.prisma.ssoAuthTransaction.rows[0]).toMatchObject({ providerType: 'SAML', configurationId: SAML_CONFIG_A });
    });

    it("a SAML-only tenant gets SAML", async () => {
      configA(OIDC_CONFIG_A).state = 'DISABLED';
      await expect(startDefault()).resolves.toMatchObject({ providerType: 'SAML' });
      configA(OIDC_CONFIG_A).state = 'ENABLED';
      configA(OIDC_CONFIG_A).isActive = false;
      await expect(startDefault()).resolves.toMatchObject({ providerType: 'SAML' });
    });

    it('with no enabled configuration the start is refused (generic refusal, nothing created)', async () => {
      configA(OIDC_CONFIG_A).state = 'DISABLED';
      configA(SAML_CONFIG_A).isActive = false;
      await rejectedWith(startDefault());
      expect(lastRejection(h)!.reasonCode).toBe(SsoReasonCode.PROVIDER_NOT_CONFIGURED);
      expect(h.prisma.ssoAuthTransaction.rows).toHaveLength(0);
    });

    it("another tenant's configuration is never picked", async () => {
      configA(OIDC_CONFIG_A).state = 'DISABLED';
      configA(SAML_CONFIG_A).state = 'DISABLED';
      await rejectedWith(startDefault());
      expect(lastRejection(h)!.reasonCode).toBe(SsoReasonCode.PROVIDER_NOT_CONFIGURED);
    });
  });

  it('[32] SAML start fails closed when SAML is not enabled for the deployment', async () => {
    delete process.env.SSO_SAML_ENABLED;
    await rejectedWith(
      h.login.start(tenantCtx(TEST_TENANT), { providerType: 'SAML', deviceId: DEVICE }, ctx),
    );
    expect(lastRejection(h)!.reasonCode).toBe(SsoReasonCode.SAML_DISABLED);
    expect(h.prisma.ssoAuthTransaction.rows).toHaveLength(0);
  });

  it('round 7: IdP-initiated SSO is refused - a validly signed unsolicited response (no RelayState, or a RelayState that is no transaction) issues nothing', async () => {
    const unsolicitedRequestId = '_' + 'ab'.repeat(20);
    const noRelay = await h.login.consumeSamlResponse(
      tenantCtx(TEST_TENANT),
      { SAMLResponse: signedSamlResponse(unsolicitedRequestId) },
      ctx,
    );
    expect(String(noRelay.redirectTo ?? '')).not.toContain('code=');
    expect(lastRejection(h)!.reasonCode).toBe(SsoReasonCode.STATE_MISSING);

    const forgedRelay = await h.login.consumeSamlResponse(
      tenantCtx(TEST_TENANT),
      { SAMLResponse: signedSamlResponse(unsolicitedRequestId), RelayState: 'not-a-transaction-state' },
      ctx,
    );
    expect(String(forgedRelay.redirectTo ?? '')).not.toContain('code=');
    expect(lastRejection(h)!.reasonCode).toBe(SsoReasonCode.STATE_UNKNOWN);

    expect(eventCodes(h)).not.toContain(SsoAuditEventCode.SAML_ASSERTION_VERIFIED);
    expect(h.auth.sessions).toHaveLength(0);
  });

  it('SAML: changing the redirect target after start is refused at the ACS - no hand-off code, failure goes only to the pinned target', async () => {
    const s = await startSaml();
    h.prisma.ssoConfiguration.rows.find((c) => c.id === SAML_CONFIG_A)!.redirectUri =
      'https://evil.example/callback';
    const acs = await h.login.consumeSamlResponse(
      tenantCtx(TEST_TENANT),
      { SAMLResponse: signedSamlResponse(s.tx.samlRequestId), RelayState: s.relayState },
      ctx,
    );
    const redirect = new URL(String(acs.redirectTo));
    expect(redirect.origin + redirect.pathname).toBe(TEST_REDIRECT_URI);
    expect(redirect.searchParams.get('error')).toBe('sso_failed');
    expect(redirect.searchParams.get('code')).toBeNull();
    expect(lastRejection(h)!.reasonCode).toBe(SsoReasonCode.CONFIG_INVALID);
    expect(eventCodes(h)).not.toContain(SsoAuditEventCode.SAML_ASSERTION_VERIFIED);
    expect(h.auth.sessions).toHaveLength(0);
  });

  it('verifies at the ACS, hands off a one-time code, and issues the session only to the starting client', async () => {
    const s = await startSaml();
    expect(s.tx.samlRequestId).toMatch(/^_[0-9a-f]{40}$/);
    const acs = await h.login.consumeSamlResponse(
      tenantCtx(TEST_TENANT),
      { SAMLResponse: signedSamlResponse(s.tx.samlRequestId), RelayState: s.relayState },
      ctx,
    );
    const redirect = new URL(String(acs.redirectTo));
    expect(redirect.origin + redirect.pathname).toBe(TEST_REDIRECT_URI);
    expect(redirect.searchParams.get('state')).toBe(s.relayState);
    const handoff = String(redirect.searchParams.get('code'));
    expect(h.auth.sessions).toHaveLength(0); // nothing issued at the ACS
    expect(eventCodes(h)).toContain(SsoAuditEventCode.SAML_ASSERTION_VERIFIED);

    // Wrong binding: refused and the hand-off is burned.
    const stolen = await startSaml();
    const acs2 = await h.login.consumeSamlResponse(
      tenantCtx(TEST_TENANT),
      { SAMLResponse: signedSamlResponse(stolen.tx.samlRequestId), RelayState: stolen.relayState },
      ctx,
    );
    const stolenCode = String(new URL(String(acs2.redirectTo)).searchParams.get('code'));
    await rejectedWith(
      h.login.complete(
        tenantCtx(TEST_TENANT),
        {
          state: stolen.relayState,
          code: stolenCode,
          bindingToken: 'z'.repeat(43),
          deviceId: DEVICE,
        },
        ctx,
      ),
    );
    expect(lastRejection(h)!.reasonCode).toBe(SsoReasonCode.BINDING_MISMATCH);

    // Wrong hand-off code: refused.
    const third = await startSaml();
    await h.login.consumeSamlResponse(
      tenantCtx(TEST_TENANT),
      { SAMLResponse: signedSamlResponse(third.tx.samlRequestId), RelayState: third.relayState },
      ctx,
    );
    await rejectedWith(
      h.login.complete(
        tenantCtx(TEST_TENANT),
        {
          state: third.relayState,
          code: 'not-the-handoff',
          bindingToken: third.res.bindingToken,
          deviceId: DEVICE,
        },
        ctx,
      ),
    );
    expect(lastRejection(h)!.reasonCode).toBe(SsoReasonCode.HANDOFF_INVALID);

    // The genuine client completes.
    const out = await h.login.complete(
      tenantCtx(TEST_TENANT),
      { state: s.relayState, code: handoff, bindingToken: s.res.bindingToken, deviceId: DEVICE },
      ctx,
    );
    expect(out).toMatchObject({ returnTo: '/portfolio', result: { user: { id: ALICE } } });
    expect(h.auth.sessions).toHaveLength(1);
    // Round 8 (Single Logout): the session is issued with the origin read from the consumed
    // transaction, which holds the signed assertion's NameID / SessionIndex - sealed, plus hashes.
    expect(h.auth.completeSsoLogin).toHaveBeenLastCalledWith(ALICE, expect.anything(), expect.anything(), ctx, {
      providerType: 'SAML',
      configurationId: SAML_CONFIG_A,
      transactionId: s.tx.id,
    });
    const consumed = h.prisma.ssoAuthTransaction.rows.find((r) => r.id === s.tx.id)!;
    expect(consumed.status).toBe('CONSUMED');
    expect(consumed.samlLogoutContext).toMatchObject({
      subjectHash: h.transactions.samlSubjectHash(SAML_CONFIG_A, 'saml-subject-alice'),
      sessionIndexHash: null,
    });
    expect(JSON.stringify(consumed.samlLogoutContext)).not.toContain('saml-subject-alice');
    expect(h.transactions.openSamlLogout(TEST_TENANT, SAML_CONFIG_A, consumed.samlLogoutContext.context)).toMatchObject({
      nameID: 'saml-subject-alice',
      nameIDFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
      sessionIndex: null,
    });
    // The hand-off is single use.
    await rejectedWith(
      h.login.complete(
        tenantCtx(TEST_TENANT),
        { state: s.relayState, code: handoff, bindingToken: s.res.bindingToken, deviceId: DEVICE },
        ctx,
      ),
    );
    expect(h.auth.sessions).toHaveLength(1);
  });

  it('[40] a replayed SAMLResponse is refused at the ACS (transaction already verified, assertion ID already seen)', async () => {
    const s = await startSaml();
    const response = signedSamlResponse(s.tx.samlRequestId, { assertionId: '_replayed-assertion' });
    const first = await h.login.consumeSamlResponse(
      tenantCtx(TEST_TENANT),
      { SAMLResponse: response, RelayState: s.relayState },
      ctx,
    );
    expect(first.redirectTo).toContain('code=');
    const second = await h.login.consumeSamlResponse(
      tenantCtx(TEST_TENANT),
      { SAMLResponse: response, RelayState: s.relayState },
      ctx,
    );
    expect(second.redirectTo).toContain('error=sso_failed');
    // The old response presented for a new transaction fails InResponseTo...
    const s2 = await startSaml();
    const third = await h.login.consumeSamlResponse(
      tenantCtx(TEST_TENANT),
      { SAMLResponse: response, RelayState: s2.relayState },
      ctx,
    );
    expect(third.redirectTo).toContain('error=sso_failed');
    expect(lastRejection(h)!.reasonCode).toBe(SsoReasonCode.SAML_IN_RESPONSE_TO_MISMATCH);
    // ...and a re-signed response reusing the assertion ID for a new request is caught by the replay store.
    const s3 = await startSaml();
    const fourth = await h.login.consumeSamlResponse(
      tenantCtx(TEST_TENANT),
      {
        SAMLResponse: signedSamlResponse(s3.tx.samlRequestId, {
          assertionId: '_replayed-assertion',
        }),
        RelayState: s3.relayState,
      },
      ctx,
    );
    expect(fourth.redirectTo).toContain('error=sso_failed');
    expect(lastRejection(h)!.reasonCode).toBe(SsoReasonCode.SAML_REPLAY);
    expect(h.auth.sessions).toHaveLength(0);
  });

  it('the hand-off expires after 120 seconds', async () => {
    const s = await startSaml();
    const acs = await h.login.consumeSamlResponse(
      tenantCtx(TEST_TENANT),
      { SAMLResponse: signedSamlResponse(s.tx.samlRequestId), RelayState: s.relayState },
      ctx,
    );
    const handoff = String(new URL(String(acs.redirectTo)).searchParams.get('code'));
    s.tx.verifiedAt = new Date(Date.now() - 121_000);
    h.prisma.ssoAuthTransaction.rows.find((r) => r.id === s.tx.id)!.verifiedAt = s.tx.verifiedAt;
    await rejectedWith(
      h.login.complete(
        tenantCtx(TEST_TENANT),
        { state: s.relayState, code: handoff, bindingToken: s.res.bindingToken, deviceId: DEVICE },
        ctx,
      ),
    );
    expect(lastRejection(h)!.reasonCode).toBe(SsoReasonCode.STATE_EXPIRED);
    expect(h.auth.sessions).toHaveLength(0);
  });

  it('an unknown RelayState (IdP-initiated SSO) gets no redirect and no session', async () => {
    const outcome = await h.login.consumeSamlResponse(
      tenantCtx(TEST_TENANT),
      { SAMLResponse: 'PHg+', RelayState: 'unknown-relay-state' },
      ctx,
    );
    expect(outcome.redirectTo).toBeNull();
    const missing = await h.login.consumeSamlResponse(
      tenantCtx(TEST_TENANT),
      { SAMLResponse: 'PHg+' },
      ctx,
    );
    expect(missing.redirectTo).toBeNull();
    expect(lastRejection(h)!.reasonCode).toBe(SsoReasonCode.STATE_MISSING);
  });
});
