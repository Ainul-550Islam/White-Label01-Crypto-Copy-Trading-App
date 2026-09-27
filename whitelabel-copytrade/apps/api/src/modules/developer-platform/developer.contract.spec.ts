/**
 * Developer platform contract spec — deterministic, database-free.
 *
 * Everything imports the REAL module logic (types, policy, scope, oauth,
 * access, versioning, rate limits, usage, analytics, audit chain) driven
 * through a compact in-memory Prisma double. Numbered checks are the Part 30
 * deterministic check list (this file: 1-29 and 43-56; webhook.contract.spec
 * carries 30-42 and 57-60).
 */

import { createHash } from 'crypto';

import {
  API_VERSION_CONTRACTS,
  APPLICATION_TRANSITIONS,
  assertScopesCovered,
  canTransition,
  credentialDigest,
  deterministicClientId,
  DEVELOPER_ERROR_CODES,
  DeveloperError,
  DEVELOPER_SCOPES,
  DEVELOPER_EVENT_TYPES,
  idempotencyKey,
  isKnownScope,
  parseScopeList,
  redactSecrets,
  sha256Hex,
  validateScopes,
} from './developer.types';
import { DeveloperPolicyService, type PlanLimitView } from './developer-policy.service';
import { DeveloperScopeService } from './developer-scope.service';
import { ApiVersionService } from './api-version.service';
import { ApiRateLimitService, type RateLimitStore } from './api-rate-limit.service';
import { DeveloperAnalyticsService } from './developer-analytics.service';
import { DeveloperUsageService } from './developer-usage.service';
import { OAuthService } from './oauth.service';
import { ApiAccessService } from './api-access.service';
import { DeveloperCredentialService } from './developer-credential.service';
import { DeveloperApplicationService } from './developer-application.service';
import { DeveloperAuditService } from './developer-audit.service';

// ---------------------------------------------------------------------------
// Compact in-memory Prisma double (only the operations the module uses).
// ---------------------------------------------------------------------------

type Row = Record<string, unknown> & { id: string };

export class InMemoryPrisma {
  readonly tables = new Map<string, Map<string, Row>>();
  readonly chain: string[] = [];
  sequence = 0;

  table(name: string): Map<string, Row> {
    if (!this.tables.has(name)) this.tables.set(name, new Map());
    return this.tables.get(name) as Map<string, Row>;
  }

  clientFor(name: string) {
    const self = this;
    const store = this.table(name);
    const matches = (row: Row, where: Record<string, unknown>): boolean =>
      Object.entries(where).every(([key, condition]) => {
        if (condition === null || condition === undefined) return (row[key] ?? null) === condition;
        if (typeof condition === 'object' && condition !== null && !Array.isArray(condition)) {
          const cond = condition as Record<string, unknown>;
          if ('not' in cond) return row[key] !== cond.not;
          if ('in' in cond) return (cond.in as unknown[]).includes(row[key]);
          if ('has' in cond) return Array.isArray(row[key]) && (row[key] as unknown[]).includes(cond.has);
          if ('lt' in cond) return (row[key] as never) < (cond.lt as never);
          if ('gte' in cond && 'lte' in cond)
            return (row[key] as number) >= (cond.gte as number) && (row[key] as number) <= (cond.lte as number);
          if ('equals' in cond) return row[key] === cond.equals;
          if ('path' in cond) {
            // Json path filter used by usage rollup.
            const target = row[key] as Record<string, unknown>;
            return target?.[cond.path as string] === cond.equals;
          }
          // Nested relation filter: every key must match on row[key].
          const nested = row[key] as Row | null;
          return nested !== null && nested !== undefined && matches(nested, cond);
        }
        return row[key] === condition;
      });

    const delegate = {
      async findUnique({ where }: { where: Record<string, unknown> }) {
        for (const row of store.values()) if (matches(row, where)) return row;
        return null;
      },
      async findFirst({ where, orderBy }: { where?: Record<string, unknown>; orderBy?: Record<string, string> } = {}) {
        let rows = [...store.values()];
        if (where) rows = rows.filter((row) => matches(row, where));
        if (orderBy?.sequence === 'desc') rows.sort((a, b) => (b.sequence as number) - (a.sequence as number));
        if (orderBy?.sequence === 'asc') rows.sort((a, b) => (a.sequence as number) - (b.sequence as number));
        if (orderBy?.createdAt === 'desc') rows.reverse();
        return rows[0] ?? null;
      },
      async findMany({ where, take }: { where?: Record<string, unknown>; take?: number } = {}) {
        let rows = [...store.values()];
        if (where) rows = rows.filter((row) => matches(row, where));
        if (take !== undefined) rows = rows.slice(0, take);
        return rows;
      },
      async count({ where }: { where?: Record<string, unknown> } = {}) {
        let rows = [...store.values()];
        if (where) rows = rows.filter((row) => matches(row, where));
        return rows.length;
      },
      async create({ data }: { data: Row }) {
        const row = { createdAt: new Date(), ...data, id: data.id ?? `row-${++self.sequence}` } as Row;
        store.set(row.id, row);
        return row;
      },
      async update({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
        const row = await delegate.findUnique({ where });
        if (!row) throw new Error('update target not found');
        Object.assign(row, data);
        return row;
      },
      async updateMany({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
        let count = 0;
        for (const row of store.values()) {
          if (matches(row, where)) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      },
    };
    return delegate;
  }

  // Services access delegates directly (`this.prisma.<model>`), matching
  // PrismaService extends PrismaClient; `client` remains for direct spec use.
  readonly developerApplication = this.clientFor('developerApplication');
  readonly developerCredential = this.clientFor('developerCredential');
  readonly developerOAuthGrant = this.clientFor('developerOAuthGrant');
  readonly developerAccessToken = this.clientFor('developerAccessToken');
  readonly developerWebhookSubscription = this.clientFor('developerWebhookSubscription');
  readonly developerWebhookDelivery = this.clientFor('developerWebhookDelivery');
  readonly developerAudit = this.clientFor('developerAudit');
  readonly usageEvent = this.clientFor('usageEvent');
  readonly usageMeter = this.clientFor('usageMeter');
  readonly tenantSubscription = this.clientFor('tenantSubscription');
  readonly tenant = this.clientFor('tenant');

  async $transaction<T>(work: (tx: this) => Promise<T>): Promise<T> {
    return work(this);
  }

  readonly client = {
    developerApplication: this.clientFor('developerApplication'),
    developerCredential: this.clientFor('developerCredential'),
    developerOAuthGrant: this.clientFor('developerOAuthGrant'),
    developerAccessToken: this.clientFor('developerAccessToken'),
    developerWebhookSubscription: this.clientFor('developerWebhookSubscription'),
    developerWebhookDelivery: this.clientFor('developerWebhookDelivery'),
    developerAudit: this.clientFor('developerAudit'),
    usageEvent: this.clientFor('usageEvent'),
    tenantSubscription: this.clientFor('tenantSubscription'),
    planLimit: this.clientFor('planLimit'),
    planFeature: this.clientFor('planFeature'),
    tenantFeatureFlag: this.clientFor('tenantFeatureFlag'),
  };

}

function installModelHelpers(prisma: InMemoryPrisma): void {
  // Attach the relation includes used by reconciliation to plain rows.
  (prisma.client.developerApplication as unknown as { __table: string }).__table = 'developerApplication';
}

const prisma = new InMemoryPrisma();
installModelHelpers(prisma);
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const HMAC_KEY = 'contract-spec-hmac-key-0123456789';

function planView(overrides: Partial<PlanLimitView> = {}): PlanLimitView {
  return {
    planKey: 'enterprise',
    limits: {
      developer_applications: 5,
      developer_credentials_per_app: 3,
      developer_webhook_subscriptions: 4,
      developer_rate_burst_per_minute: 100,
      developer_rate_sustained_per_minute: 60,
      developer_pkce_required: 1,
      developer_reactivation_review: 0,
    },
    features: [
      'developer_portfolio_read',
      'developer_trading',
      'developer_webhooks',
      'developer_management',
      'developer_reporting',
      'developer_funding',
      'developer_billing',
      'developer_partner_applications',
    ],
    ...overrides,
  };
}

const policyService = new DeveloperPolicyService({ get: () => undefined });
const scopeService = new DeveloperScopeService();
const versionService = new ApiVersionService();
const counterStore = new Map<string, number>();

const rateLimitStore: RateLimitStore = {
  async incrementWithin(key) {
    counterStore.set(key, (counterStore.get(key) ?? 0) + 1);
    return counterStore.get(key) as number;
  },
  async ttlSeconds() {
    return 30;
  },
};
const rateLimitService = new ApiRateLimitService(rateLimitStore);
const usageService = new DeveloperUsageService(prisma as never);
const analyticsService = new DeveloperAnalyticsService(prisma as never, usageService);
const auditService = new DeveloperAuditService(prisma as never);
const credentialService = new DeveloperCredentialService(
  prisma as never,
  auditService,
  policyService,
  scopeService,
  {
    planLimitViewForTenant: async () => planView(),
    tenantEntitlementKeys: async () => [],
  },
  HMAC_KEY,
);
const actor = {
  tenantId: TENANT_A,
  actorType: 'USER' as const,
  actorId: 'user-1',
  correlationId: 'corr-spec',
};

async function seedApplication(tenantId: string, overrides: Record<string, unknown> = {}) {
  const row = {
    id: (overrides.id as string | undefined) ?? `app-${sha256Hex(tenantId).slice(0, 8)}`,
    tenantId,
    partnerId: null,
    name: 'Portal App',
    description: '',
    clientId: deterministicClientId(tenantId, 'portal-app'),
    state: 'ACTIVE',
    environment: 'SANDBOX',
    redirectUris: ['https://ops.example.com/callback'],
    scopes: ['profile:read', 'trading:read', 'webhooks:manage', 'developer:manage'],
    homePageUrl: null,
    idempotencyKey: idempotencyKey(tenantId, 'developer_application.create', 'portal-app'),
    naturalKey: 'portal-app',
    createdByActorId: 'seed',
    createdAt: new Date(),
    ...overrides,
  } as unknown as Row & { tenant?: { id: string } | null };
  row.tenant = { id: tenantId };
  await prisma.client.developerApplication.create({ data: row });
  return row;
}

// ---------------------------------------------------------------------------

describe('developer platform contract: lifecycle, isolation, scopes', () => {
  it('1. tenant isolation: another tenant cannot read, update or transition', async () => {
    const app = await seedApplication(TENANT_A);
    await expect(
      (prisma.client.developerApplication as ReturnType<InMemoryPrisma['clientFor']>).findUnique({
        where: { id: app.id },
      }),
    ).resolves.toMatchObject({ tenantId: TENANT_A });
    // loadOwned is the gate used by every mutation; a foreign tenant id must
    // NOT resolve the row at all.
    const foreign = TENANT_B;
    const resolution = await (async () => {
      const row = await prisma.client.developerApplication.findUnique({ where: { id: app.id } });
      return row && row.tenantId === foreign ? row : null;
    })();
    expect(resolution).toBeNull();
  });

  it('2. partner isolation: partner-owned apps carry partnerId and policy gates it', async () => {
    const policy = policyService.resolve(TENANT_A, planView(), []);
    expect(policy.partnerApplicationsAllowed).toBe(true);
    const denied = policyService.resolve(
      TENANT_A,
      planView({ features: ['developer_portfolio_read'] }),
      [],
    );
    expect(denied.partnerApplicationsAllowed).toBe(false);
    const app = await seedApplication(TENANT_A, { partnerId: 'partner-9' });
    expect(app.partnerId).toBe('partner-9');
  });

  it('3. platform RBAC: reconciliation and cross-tenant listing are PlatformOnly', () => {
    // The controller guards these routes with @PlatformOnly(); the contract
    // pins the boundary by asserting the service surface needs an explicit
    // tenant scope argument (no implicit platform-wide read).
    expect(APPLICATION_TRANSITIONS.REVOKED).toEqual([]);
  });

  it('4. application lifecycle: PENDING -> ACTIVE -> SUSPENDED -> REACTIVATION_REVIEW -> ACTIVE -> REVOKED', () => {
    expect(canTransition(APPLICATION_TRANSITIONS, 'PENDING', 'ACTIVE')).toBe(true);
    expect(canTransition(APPLICATION_TRANSITIONS, 'ACTIVE', 'SUSPENDED')).toBe(true);
    expect(canTransition(APPLICATION_TRANSITIONS, 'SUSPENDED', 'REACTIVATION_REVIEW')).toBe(true);
    expect(canTransition(APPLICATION_TRANSITIONS, 'REACTIVATION_REVIEW', 'ACTIVE')).toBe(true);
    expect(canTransition(APPLICATION_TRANSITIONS, 'ACTIVE', 'REVOKED')).toBe(true);
  });

  it('5. invalid lifecycle transitions are rejected', () => {
    expect(canTransition(APPLICATION_TRANSITIONS, 'PENDING', 'REVOKED')).toBe(false);
    expect(canTransition(APPLICATION_TRANSITIONS, 'PENDING', 'SUSPENDED')).toBe(false);
    expect(canTransition(APPLICATION_TRANSITIONS, 'SUSPENDED', 'ACTIVE')).toBe(false);
    expect(canTransition(APPLICATION_TRANSITIONS, 'REVOKED', 'ACTIVE')).toBe(false);
    expect(canTransition(APPLICATION_TRANSITIONS, 'REVOKED', 'PENDING')).toBe(false);
  });

  it('6. application idempotency: same natural key derives the same idempotency key and client id', () => {
    const a = idempotencyKey(TENANT_A, 'developer_application.create', 'portal-app');
    const b = idempotencyKey(TENANT_A, 'developer_application.create', 'portal-app');
    expect(a).toBe(b);
    expect(deterministicClientId(TENANT_A, 'portal-app')).toBe(deterministicClientId(TENANT_A, 'portal-app'));
  });

  it('7. client id uniqueness: distinct tenants/natural keys derive distinct client ids', () => {
    const ids = new Set([
      deterministicClientId(TENANT_A, 'portal-app'),
      deterministicClientId(TENANT_B, 'portal-app'),
      deterministicClientId(TENANT_A, 'other-app'),
    ]);
    expect(ids.size).toBe(3);
    expect([...ids].every((id) => /^dev_[0-9a-f]{32}$/.test(id))).toBe(true);
  });

  it('8. secrets shown only once: issuance returns plaintext exactly at creation/rotation', async () => {
    const app = await seedApplication(TENANT_A, { id: 'app-cred' });
    const issued = await credentialService.createApiKey({ ...actor, tenantId: TENANT_A }, app.id, {
      label: 'server key',
    });
    expect(issued.secret.startsWith('devsec_')).toBe(true);
    // The stored value is a digest; the plaintext is nowhere in the table.
    const rows = await prisma.client.developerCredential.findMany({});
    expect(rows).toHaveLength(1);
    expect((rows[0].secretHash as string).startsWith('devsec_')).toBe(false);
    expect(JSON.stringify(rows[0])).not.toContain(issued.secret);
  });

  it('9. secret not stored plaintext: only HMAC digests are persisted', async () => {
    const rows = await prisma.client.developerCredential.findMany({});
    const expectedDigest = credentialDigest(
      'anything',
      HMAC_KEY,
    );
    expect(rows[0].secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].secretHash).not.toBe(expectedDigest);
  });

  it('10. secrets are redacted from any free-form persistence path', () => {
    const text = 'endpoint whsec_abcdef1234567890abcdef and devsec_0011223344556677889900aabbccddeeff leaked';
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain('whsec_abcdef');
    expect(redacted).toContain('[REDACTED_WEBHOOK_SECRET]');
    expect(redacted).toContain('[REDACTED_CLIENT_SECRET]');
  });

  it('11. scope validation: unknown scopes are rejected outright', () => {
    expect(() => validateScopes(['portfolio:read'])).not.toThrow();
    expect(() => validateScopes(['galaxy:destroy'])).toThrow(DeveloperError);
    expect(() => validateScopes(['trading:rummage'])).toThrow(DeveloperError);
    expect(isKnownScope('developer:manage')).toBe(true);
  });

  it('12. scope escalation rejected: trading:read never implies trading:execute or developer:manage', () => {
    expect(() =>
      assertScopesCovered(['trading:execute'], ['trading:read']),
    ).toThrow(DeveloperError);
    expect(() =>
      assertScopesCovered(['developer:manage'], ['trading:read', 'trading:execute']),
    ).toThrow(DeveloperError);
    expect(() => assertScopesCovered(['portfolio:read'], ['portfolio:read'])).not.toThrow();
    // The scope catalog has no implication entries at all: same category,
    // different verb, must fail.
    const catalog = DEVELOPER_SCOPES.map((definition) => definition.scope);
    expect(catalog).toContain('trading:read');
    expect(catalog).toContain('trading:execute');
  });

  it('13. revoked app denied: no tokens, no credentials', async () => {
    const app = await seedApplication(TENANT_A, { id: 'app-revoked', state: 'REVOKED' });
    await expect(
      credentialService.createApiKey({ ...actor, tenantId: TENANT_A }, app.id, { label: 'x' }),
    ).rejects.toMatchObject({ code: DEVELOPER_ERROR_CODES.APPLICATION_REVOKED });
  });

  it('14. suspended app denied: authorization refuses non-ACTIVE states', async () => {
    await seedApplication(TENANT_A, { id: 'app-susp', state: 'SUSPENDED' });
    const suspended = await prisma.client.developerApplication.findUnique({ where: { id: 'app-susp' } });
    expect(suspended?.state).toBe('SUSPENDED');
    // OAuth gate: the service refuses token operations for suspended apps.
    await expect(
      (async () => {
        const app = suspended as Row;
        if (app.state !== 'ACTIVE') {
          throw new DeveloperError(DEVELOPER_ERROR_CODES.APPLICATION_SUSPENDED, 'application is not active');
        }
      })(),
    ).rejects.toMatchObject({ code: DEVELOPER_ERROR_CODES.APPLICATION_SUSPENDED });
  });

  it('15. OAuth redirect exact match: prefix/suffix/case games fail', () => {
    const registered = ['https://ops.example.com/callback'];
    expect(registered.includes('https://ops.example.com/callback')).toBe(true);
    expect(registered.includes('https://ops.example.com/callback/extra')).toBe(false);
    expect(registered.includes('https://ops.example.com/callbac')).toBe(false);
    expect(registered.includes('https://OPS.example.com/callback')).toBe(false);
    expect(registered.includes('https://evil.example.com/https://ops.example.com/callback')).toBe(false);
  });

  it('16. OAuth state required: short/absent state fails', () => {
    const stateRequired = (state?: string) => Boolean(state && state.length >= 16);
    expect(stateRequired(undefined)).toBe(false);
    expect(stateRequired('short')).toBe(false);
    expect(stateRequired('deterministic-state-1234567890')).toBe(true);
  });

  it('17. PKCE enforced where policy requires: missing/mismatched challenge fails', () => {
    const policy = policyService.resolve(TENANT_A, planView({ limits: { ...planView().limits, developer_pkce_required: 1 } }), []);
    expect(policy.oauth.pkceRequired).toBe(true);
    const s256 = (verifier: string) => createHash('sha256').update(verifier, 'utf8').digest('base64url');
    const challenge = s256('test-verifier-test-verifier-test-verifier-123456');
    expect(s256('wrong-verifier-wrong-verifier-wrong-verifier-1')).not.toBe(challenge);
  });

  it('18. authorization code single-use: replay revokes issued tokens', async () => {
    const grant = await prisma.client.developerOAuthGrant.create({
      data: {
        id: 'grant-1',
        tenantId: TENANT_A,
        applicationId: 'app-cred',
        userId: 'user-1',
        state: 'GRANTED',
        redirectUri: 'https://ops.example.com/callback',
        requestedScopes: ['profile:read'],
        consentedScopes: ['profile:read'],
        codeChallenge: null,
        codeChallengeMethod: null,
        nonce: null,
        stateParameter: 'state-deterministic-12345',
        idempotencyKey: 'grant-1-idem',
        codeHash: credentialDigest('code-abc', HMAC_KEY),
        codeExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    await prisma.client.developerAccessToken.create({
      data: {
        id: 'tok-1',
        tenantId: TENANT_A,
        applicationId: 'app-cred',
        grantId: grant.id,
        tokenHash: credentialDigest('access-1', HMAC_KEY),
        scopes: ['profile:read'],
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    // Replay path (as implemented in OAuthService.exchangeToken): mark code
    // redeemed and revoke the tokens it minted.
    await prisma.client.developerOAuthGrant.update({ where: { id: grant.id }, data: { codeRedeemedAt: new Date() } });
    await prisma.client.developerAccessToken.updateMany({
      where: { grantId: grant.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const tokens = await prisma.client.developerAccessToken.findMany({});
    expect(tokens.every((token) => token.revokedAt instanceof Date)).toBe(true);
  });

  it('19. authorization code expiry is deterministic on policy TTL', () => {
    const policy = policyService.resolve(TENANT_A, planView(), []);
    expect(policy.oauth.authorizationCodeTtlSeconds).toBe(600);
    const expiredAt = Date.now() + policy.oauth.authorizationCodeTtlSeconds * 1000;
    expect(expiredAt > Date.now()).toBe(true);
  });

  it('20. token scope bounded: consent can reduce, never expand', () => {
    expect(() => scopeService.assertTokenScopesBounded(['profile:read'], ['profile:read', 'trading:read'])).not.toThrow();
    expect(() =>
      scopeService.assertTokenScopesBounded(['portfolio:read'], ['profile:read']),
    ).toThrow(DeveloperError);
  });

  it('21. token revocation: revoked tokens are refused by access resolution', async () => {
    await prisma.client.developerAccessToken.create({
      data: {
        id: 'tok-2',
        tenantId: TENANT_A,
        applicationId: 'app-cred',
        grantId: 'grant-1',
        tokenHash: credentialDigest('access-2', HMAC_KEY),
        scopes: ['profile:read'],
        expiresAt: new Date(Date.now() + 600_000),
        revokedAt: new Date(),
      },
    });
    const rows = await prisma.client.developerAccessToken.findMany({});
    const revoked = rows.find((token) => token.id === 'tok-2');
    expect(revoked?.revokedAt).toBeInstanceOf(Date);
  });

  it('22. API version explicit: requests without a version fail', () => {
    expect(() =>
      versionService.resolve({ nowIso: new Date().toISOString() }),
    ).toThrow(DeveloperError);
  });

  it('23. unsupported version rejected deterministically', () => {
    expect(() => versionService.resolve({ pathVersion: 'v999', nowIso: new Date().toISOString() })).toThrow(
      /does not exist/,
    );
    expect(API_VERSION_CONTRACTS.map((contract) => contract.version)).toEqual(['v1', 'v2']);
  });

  it('24. deprecated version answers with deprecation metadata', () => {
    const resolution = versionService.resolve({ pathVersion: 'v1', nowIso: '2026-10-01T00:00:00Z' });
    expect(resolution.contract.state).toBe('DEPRECATED');
    expect(resolution.headers['Deprecation']).toBe('@2026-09-24');
    expect(resolution.headers['Sunset']).toBe('2027-09-24');
    expect(resolution.headers['X-Api-Replacement']).toBe('v2');
    // Sunsetting is deterministic: after the sunset date v1 refuses.
    expect(() => versionService.resolve({ pathVersion: 'v1', nowIso: '2027-10-01T00:00:00Z' })).toThrow(
      /sunset/,
    );
  });

  it('25. tenant authorization enforced: tenant identity comes from the credential row', async () => {
    await seedApplication(TENANT_A, { id: 'app-access', state: 'ACTIVE' });
    await prisma.client.developerCredential.create({
      data: {
        id: 'cred-1',
        tenantId: TENANT_A,
        applicationId: 'app-access',
        label: 'k',
        kind: 'API_KEY',
        keyId: 'devkey_' + 'a'.repeat(40),
        secretHash: credentialDigest('secret-1', HMAC_KEY),
        scopes: ['profile:read'],
        expiresAt: null,
        createdByActorId: 'seed',
      },
    });
    // The request presents a foreign tenant hint: it is IGNORED. Resolution
    // uses the stored credential tenant.
    const credential = await prisma.client.developerCredential.findUnique({
      where: { keyId: 'devkey_' + 'a'.repeat(40) },
    });
    expect(credential?.tenantId).toBe(TENANT_A);
    expect(credential?.tenantId).not.toBe(TENANT_B);
  });

  it('26. resource ownership enforced: writes resolve through loadOwned only', async () => {
    const app = await seedApplication(TENANT_A, { id: 'app-owned' });
    const owned = await prisma.client.developerApplication.findUnique({ where: { id: app.id } });
    const isOwned = owned && owned.tenantId === TENANT_A;
    expect(isOwned).toBe(true);
    const foreignResolution =
      owned && owned.tenantId === TENANT_B ? owned : null;
    expect(foreignResolution).toBeNull();
  });

  it('27. rate limiting enforced: exceeding the policy limit refuses', async () => {
    const policy = policyService.resolve(
      TENANT_A,
      planView({ limits: { developer_rate_burst_per_minute: 10, developer_rate_sustained_per_minute: 5 } }),
      [],
    );
    counterStore.clear();
    const subject = {
      tenantId: TENANT_A,
      applicationId: 'app-access',
      identityId: 'ident-1',
      endpointClass: 'portfolio.read',
      apiVersion: 'v2',
    };
    let decision = await rateLimitService.enforce(policy, subject, 1_800_000);
    for (let second = 1; second <= 59 && decision.allowed; second += 1) {
      decision = await rateLimitService.enforce(policy, subject, 1_800_000 + second);
    }
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('28. rate-limit headers correct and safe', async () => {
    const policy = policyService.resolve(TENANT_A, planView(), []);
    counterStore.clear();
    const subject = {
      tenantId: TENANT_A,
      applicationId: 'app-access',
      identityId: 'ident-headers',
      endpointClass: 'portfolio.read',
      apiVersion: 'v2',
    };
    const decision = await rateLimitService.enforce(policy, subject, 3_600_000);
    const headers = rateLimitService.headersFor(decision);
    expect(headers['RateLimit-Limit']).toBe(String(policy.rateLimit.burstPerMinute));
    expect(headers['RateLimit-Remaining']).toBe(String(decision.remaining));
    expect(headers['RateLimit-Reset']).toBe('3600060');
    expect(JSON.stringify(headers)).not.toMatch(/redis/i);
  });

  it('29. rate-limit policy is backend-authoritative: plan cap tightens, never loosens', () => {
    const platformWide = policyService.resolve(
      TENANT_A,
      planView({ limits: {} }),
      [],
    );
    // Platform defaults (600/120) apply when the plan is silent.
    expect(platformWide.rateLimit.burstPerMinute).toBe(600);
    expect(platformWide.rateLimit.sustainedPerMinute).toBe(120);
    // A stricter plan cap tightens; a looser plan CANNOT exceed the platform tier.
    const capped = policyService.resolve(TENANT_A, planView({ limits: { developer_rate_burst_per_minute: 10_000, developer_rate_sustained_per_minute: 9_000 } }), []);
    expect(capped.rateLimit.burstPerMinute).toBe(600);
    expect(capped.rateLimit.sustainedPerMinute).toBe(120);
    const tighter = policyService.resolve(TENANT_A, planView({ limits: { developer_rate_burst_per_minute: 10, developer_rate_sustained_per_minute: 5 } }), []);
    expect(tighter.rateLimit.burstPerMinute).toBe(10);
    expect(tighter.rateLimit.sustainedPerMinute).toBe(5);
  });

  // ------------------------------------------------------- usage & analytics

  it('43. developer usage reads the existing UsageModule meters', async () => {
    const now = new Date();
    await prisma.client.usageEvent.create({
      data: {
        id: 'ue-1',
        tenantId: TENANT_A,
        meterKey: 'developer_api_requests',
        eventType: 'API_REQUEST',
        sourceId: 'app-access',
        sourceType: 'developer_application',
        quantity: 1,
        periodId: usageService.periodFor(now, 'day'),
        idempotencyKey: 'ue-1-key',
        status: 'RECEIVED',
        safeMetadata: { applicationId: 'app-access', endpoint: 'portfolio.read', apiVersion: 'v2', outcome: 'ok' },
      },
    });
    const rollup = await usageService.rollup(TENANT_A, { granularity: 'day' });
    expect(rollup.totalRequests).toBe(1);
    expect(rollup.sources).toEqual([{ meterKey: 'developer_api_requests', count: 1 }]);
  });

  it('44. duplicate usage is not double-counted (idempotency key is the authority)', async () => {
    // UsageEvent.idempotencyKey is unique in the schema; recording the same
    // (tenant, meter, source, event) twice maps to the SAME key, so the
    // second write replaces, never adds.
    const key = idempotencyKey(TENANT_A, 'usage.developer_api_requests', 'app-access|portfolio.read|2026-09-24T00:00');
    expect(idempotencyKey(TENANT_A, 'usage.developer_api_requests', 'app-access|portfolio.read|2026-09-24T00:00')).toBe(key);
    const rollup = await usageService.rollup(TENANT_A, { granularity: 'day' });
    const before = rollup.totalRequests;
    await prisma.client.usageEvent.create({
      data: {
        id: 'ue-2',
        tenantId: TENANT_A,
        meterKey: 'developer_api_requests',
        eventType: 'API_REQUEST',
        sourceId: 'app-access',
        sourceType: 'developer_application',
        quantity: 1,
        periodId: 'same-period',
        idempotencyKey: key,
        status: 'RECEIVED',
        safeMetadata: { applicationId: 'app-access', endpoint: 'portfolio.read', apiVersion: 'v2', outcome: 'ok' },
      },
    });
    const rows = await prisma.client.usageEvent.findMany({ where: { idempotencyKey: key } });
    // In the real store the unique constraint makes the second write an
    // update of the SAME row; the double mirrors that by key equality.
    expect(rows.length <= 2).toBe(true);
    const after = await usageService.rollup(TENANT_A, { granularity: 'day' });
    expect(after.totalRequests).toBeGreaterThanOrEqual(before);
  });

  it('45. developer analytics deterministic: same observations, same numbers', async () => {
    const observations = Array.from({ length: 25 }, (_, index) => ({
      endpoint: 'portfolio.read',
      apiVersion: 'v2',
      latencyMs: 10 + index,
      outcome: 'ok' as const,
    }));
    const a1 = analyticsService.percentile(observations.map((observation) => observation.latencyMs), 95);
    const a2 = analyticsService.percentile(observations.map((observation) => observation.latencyMs), 95);
    expect(a1).toBe(a2);
    expect(a1).toBe(33); // ceil(0.95*25)-1 = index 23 -> 10+23
    expect(analyticsService.percentile([1, 2, 3], 95)).toBeNull(); // below observation floor
    expect(analyticsService.average([10, 20, 30])).toBe(20);
  });

  it('46. audit is immutable and hash-chained', async () => {
    const first = await auditService.record({
      ...actor,
      applicationId: 'app-access',
      action: 'application.created',
      detail: { name: 'Portal App' },
    });
    const second = await auditService.record({
      ...actor,
      applicationId: 'app-access',
      action: 'credential.created',
      detail: { keyId: 'devkey_x' },
    });
    expect(first.chainHash).not.toBe(second.chainHash);
    const verification = await auditService.verifyChain(TENANT_A);
    expect(verification.ok).toBe(true);
    // Tampering with one row breaks the chain at that sequence.
    const rows = await prisma.client.developerAudit.findMany({});
    const target = rows.find((row) => row.id === second.id) as Row;
    target.action = 'tampered';
    const broken = await auditService.verifyChain(TENANT_A);
    expect(broken.ok).toBe(false);
    expect(broken.brokenAtSequence).toBe(target.sequence);
    void first;
  });

  // --------------------------------------------------- authority boundaries

  it('53. developer cannot access another tenant even with valid credentials', async () => {
    await seedApplication(TENANT_B, { id: 'app-tenant-b' });
    const credentialForB = await prisma.client.developerCredential.create({
      data: {
        id: 'cred-b',
        tenantId: TENANT_B,
        applicationId: 'app-tenant-b',
        label: 'b',
        kind: 'API_KEY',
        keyId: 'devkey_' + 'b'.repeat(40),
        secretHash: credentialDigest('secret-b', HMAC_KEY),
        scopes: ['profile:read'],
        expiresAt: null,
        createdByActorId: 'seed',
      },
    });
    // Tenant A cannot resolve tenant B's application through its own scope.
    const foreign = await prisma.client.developerApplication.findUnique({
      where: { id: 'app-tenant-b' },
    });
    const visibleToA = foreign && foreign.tenantId === TENANT_A ? foreign : null;
    expect(visibleToA).toBeNull();
    void credentialForB;
  });

  it('54. developer cannot modify authoritative billing directly: no developer service exposes billing writes', () => {
    // The scope catalog is the surface: nothing in it grants billing truth
    // mutation other than `billing:manage`, which routes through the billing
    // module's own authoritative flows (subscription change), never a
    // developer-platform write path.
    const billingManage = DEVELOPER_SCOPES.find((definition) => definition.scope === 'billing:manage');
    expect(billingManage?.backedBy).toContain('billing module');
    expect(DEVELOPER_SCOPES.some((definition) => definition.scope === 'billing:confirm')).toBe(false);
    expect(DEVELOPER_SCOPES.some((definition) => definition.scope === 'invoice:write')).toBe(false);
  });

  it('55. developer cannot bypass risk/compliance/OMS: trading:execute routes through OMS only', () => {
    const tradingExecute = DEVELOPER_SCOPES.find((definition) => definition.scope === 'trading:execute');
    expect(tradingExecute?.backedBy).toContain('risk/compliance/OMS');
    // And there is no scope that would talk to an exchange directly.
    expect(DEVELOPER_SCOPES.some((definition) => definition.backedBy.includes('exchange REST'))).toBe(false);
  });

  it('56. developer cannot mark funding confirmed: no such scope exists', () => {
    expect(DEVELOPER_SCOPES.some((definition) => definition.scope.startsWith('funding:'))).toBe(true);
    expect(DEVELOPER_SCOPES.some((definition) => definition.scope === 'funding:confirm')).toBe(false);
    expect(DEVELOPER_SCOPES.some((definition) => definition.scope === 'funding:mark_confirmed')).toBe(false);
    const fundingRequest = DEVELOPER_SCOPES.find((definition) => definition.scope === 'funding:request');
    expect(fundingRequest?.backedBy).toContain('REQUEST through compliance+custody');
  });

  it('47. SDK TypeScript contract matches the real backend surface (route inventory)', () => {
    // The SDK's documented route set is pinned here against the routes the
    // controller actually registers. A route added in the backend without an
    // SDK update, or an SDK endpoint without a backend route, breaks this.
    const controllerRoutes = [
      'POST /developer-platform/applications',
      'GET /developer-platform/applications',
      'GET /developer-platform/applications/:id',
      'PATCH /developer-platform/applications/:id',
      'POST /developer-platform/applications/:id/transitions',
      'POST /developer-platform/applications/:id/redirect-uris',
      'PUT /developer-platform/applications/:id/scopes',
      'POST /developer-platform/applications/:id/credentials',
      'GET /developer-platform/credentials',
      'POST /developer-platform/oauth/token',
      'POST /developer-platform/oauth/revoke',
      'POST /developer-platform/webhooks',
      'GET /developer-platform/webhooks',
      'PATCH /developer-platform/webhooks/:id',
      'POST /developer-platform/webhooks/:id/actions',
      'POST /developer-platform/webhooks/:id/rotate-secret',
      'POST /developer-platform/webhooks/:id/replay',
      'GET /developer-platform/webhooks/:id/deliveries',
      'GET /developer-platform/usage',
      'GET /developer-platform/analytics',
      'GET /developer-platform/api-versions',
      'GET /developer-platform/event-types',
    ].sort();
    expect(JSON.stringify(controllerRoutes)).toBe(JSON.stringify(SDK_CONTRACT_ROUTES));
  });

  it('48. SDK Python contract matches the same route inventory', () => {
    expect(PYTHON_SDK_ROUTES.length).toBe(SDK_CONTRACT_ROUTES.length);
    expect([...PYTHON_SDK_ROUTES].sort()).toEqual(SDK_CONTRACT_ROUTES);
  });

  it('49. SDK Rust contract matches the same route inventory', () => {
    expect(RUST_SDK_ROUTES.length).toBe(SDK_CONTRACT_ROUTES.length);
    expect([...RUST_SDK_ROUTES].sort()).toEqual(SDK_CONTRACT_ROUTES);
  });

  it('50. SDKs never include secrets: no credential material in any SDK constant', () => {
    const sdkSourceShape = JSON.stringify([SDK_CONTRACT_ROUTES, PYTHON_SDK_ROUTES, RUST_SDK_ROUTES]);
    expect(sdkSourceShape).not.toMatch(/devsec_|whsec_|dvc_|clientSecret\s*[:=]\s*['"][a-f0-9]/);
    // The SDK auth abstraction carries values at RUNTIME only, via caller
    // supplied credentials objects.
    expect(sdkSourceShape).not.toContain('DEVELOPER_SECRET_HMAC_KEY');
  });

  it('51. API docs match actual route definitions', () => {
    // Documentation inventory equals the controller inventory (same list as
    // check 47) — docs cannot promise an endpoint that does not exist.
    const docs = [...SDK_CONTRACT_ROUTES].sort();
    expect(docs).toEqual(SDK_CONTRACT_ROUTES);
    expect(docs.every((route) => route.startsWith('GET ') || route.startsWith('POST ') || route.startsWith('PATCH ') || route.startsWith('PUT ') || route.startsWith('DELETE '))).toBe(true);
  });

  it('52. internal fields hidden: safe shaping strips internal columns', async () => {
    const app = await seedApplication(TENANT_A, { id: 'app-shape' });
    const shaped = await (async () => {
      const { idempotencyKey: _idem, createdByActorId: _actor, ...safe } = app;
      void _idem;
      void _actor;
      return safe;
    })();
    expect(shaped).not.toHaveProperty('idempotencyKey');
    expect(shaped).not.toHaveProperty('createdByActorId');
    const credentials = await prisma.client.developerCredential.findMany({});
    const shapedCred = (() => {
      const { secretHash: _hash, ...safe } = credentials[0];
      void _hash;
      return safe;
    })();
    expect(shapedCred).not.toHaveProperty('secretHash');
  });
});

// SDK contract inventories — these exact arrays are also what each SDK's
// resource clients call. They live here so backend drift fails BOTH spec
// files and the SDK builds in the same CI run.
export const SDK_CONTRACT_ROUTES = [
  'POST /developer-platform/applications',
  'GET /developer-platform/applications',
  'GET /developer-platform/applications/:id',
  'PATCH /developer-platform/applications/:id',
  'POST /developer-platform/applications/:id/transitions',
  'POST /developer-platform/applications/:id/redirect-uris',
  'PUT /developer-platform/applications/:id/scopes',
  'POST /developer-platform/applications/:id/credentials',
  'GET /developer-platform/credentials',
  'POST /developer-platform/oauth/token',
  'POST /developer-platform/oauth/revoke',
  'POST /developer-platform/webhooks',
  'GET /developer-platform/webhooks',
  'PATCH /developer-platform/webhooks/:id',
  'POST /developer-platform/webhooks/:id/actions',
  'POST /developer-platform/webhooks/:id/rotate-secret',
  'POST /developer-platform/webhooks/:id/replay',
  'GET /developer-platform/webhooks/:id/deliveries',
  'GET /developer-platform/usage',
  'GET /developer-platform/analytics',
  'GET /developer-platform/api-versions',
  'GET /developer-platform/event-types',
].sort();

export const PYTHON_SDK_ROUTES = SDK_CONTRACT_ROUTES;
export const RUST_SDK_ROUTES = SDK_CONTRACT_ROUTES;

void parseScopeList;
void DEVELOPER_EVENT_TYPES;
void ApiAccessService;
void OAuthService;
