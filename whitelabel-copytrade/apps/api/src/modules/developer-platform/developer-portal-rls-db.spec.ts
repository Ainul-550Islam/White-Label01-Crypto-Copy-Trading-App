/** Opt in only on a disposable PostgreSQL database with migrations/policies installed. */
import 'reflect-metadata';
import { createHash, randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import supertest from 'supertest';
import { ResponseTransformInterceptor } from '../../common/interceptors/response-transform.interceptor';
import { DeveloperIntegrationController } from './developer-integration.controller';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DeveloperApplicationService } from './developer-application.service';
import { ApiAccessService } from './api-access.service';
import { ApiRateLimitService } from './api-rate-limit.service';
import { ApiVersionService } from './api-version.service';
import { DeveloperVersionPinService } from './developer-version-pin.service';
import { DeveloperAnalyticsService } from './developer-analytics.service';
import { DeveloperUsageService } from './developer-usage.service';
import { DeveloperAuditService } from './developer-audit.service';
import { DeveloperCredentialService } from './developer-credential.service';
import { createDeveloperPolicyData } from './developer-policy-data';
import { DeveloperPolicyService } from './developer-policy.service';
import { DeveloperReconciliationService } from './developer-reconciliation.service';
import { DeveloperScopeService } from './developer-scope.service';
import { OAuthService } from './oauth.service';
import { WebhookReplayService } from './webhook-replay.service';
import { WebhookSigningService } from './webhook-signing.service';
import { WebhookSubscriptionService } from './webhook-subscription.service';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL, rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;
(adminUrl && rlsUrl ? describe : describe.skip)('developer portal with forced PostgreSQL tenant RLS', () => {
  const tenantA = randomUUID(), tenantB = randomUUID(), planCode = `portal_${randomUUID()}`;
  const actor = { tenantId: tenantA, actorType: 'USER' as const, actorId: 'operator', correlationId: 'portal-db-test' };
  const policy = new DeveloperPolicyService({ get: () => undefined });
  let admin: PrismaService, db: PrismaService, apps: DeveloperApplicationService;
  let credentials: DeveloperCredentialService, webhooks: WebhookSubscriptionService, replay: WebhookReplayService;
  const prior = new Map<string, { relrowsecurity: boolean; relforcerowsecurity: boolean }>();
  const tables = ['tenant_subscriptions', 'tenant_feature_flags', 'developer_applications', 'developer_credentials', 'developer_oauth_grants', 'developer_access_tokens', 'usage_events', 'users'];
  const cipher = { encrypt: (s: string) => `sealed:${s}`, decrypt: (s: string) => s.replace(/^sealed:/, '') };
  function client(databaseUrl: string) {
    return new PrismaService({ databaseUrl, isProduction: false, databaseReadEnabled: false } as never, { warn() {}, debug() {}, error() {}, info() {} } as never);
  }
  beforeAll(async () => {
    if (!adminUrl || !rlsUrl) throw new Error('both PostgreSQL URLs are required');
    admin = client(adminUrl); db = client(rlsUrl);
    const role = await db.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user`;
    expect(role[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    for (const table of tables) {
      const [flags] = await admin.$queryRawUnsafe<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = '${table}'`);
      prior.set(table, flags);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    }
    await admin.tenant.createMany({ data: [tenantA, tenantB].map((id) => ({ id, slug: `portal-${id}`, name: 'Portal RLS test' })) });
    const plan = await admin.subscriptionPlan.create({ data: {
      code: planCode, name: 'Developer test', price: '0',
      features: ['developer_webhooks', 'developer_portfolio_read'],
      limits: { developer_applications: 3, developer_credentials_per_app: 4, developer_redirect_uris: 5, developer_webhook_subscriptions: 4, developer_webhook_endpoints_per_app: 4, developer_pkce_required: 1, developer_feature_webhooks: true, developer_feature_portfolio_read: true, malformed: '9', negative: -1 },
    } });
    await admin.tenantSubscription.createMany({ data: [tenantA, tenantB].map((tenantId) => ({ tenantId, planId: plan.id, status: 'ACTIVE', currentPeriodEnd: new Date('2099-01-01') })) });
    const data = createDeveloperPolicyData(db), audit = new DeveloperAuditService(db);
    apps = new DeveloperApplicationService(db, policy, data, audit);
    credentials = new DeveloperCredentialService(db, audit, policy, new DeveloperScopeService(), data, 'test-only-hmac');
    webhooks = new WebhookSubscriptionService(db, audit, policy, data, new WebhookSigningService(policy), 'test-only-hmac', cipher);
    replay = new WebhookReplayService(db, audit, {} as never);
  });
  afterAll(async () => {
    if (admin) {
      await admin.$executeRaw`DELETE FROM developer_audit WHERE tenant_id IN (${tenantA}::uuid, ${tenantB}::uuid)`;
      await admin.usageEvent.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
      await admin.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
      await admin.subscriptionPlan.deleteMany({ where: { code: planCode } });
      for (const table of tables) {
        const flags = prior.get(table);
        if (flags && !flags.relforcerowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`);
        if (flags && !flags.relrowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
      }
      await admin.$disconnect();
    }
    await db?.$disconnect();
  });
  it('creates, lists, rotates, replays and isolates real portal records', async () => {
    const data = createDeveloperPolicyData(db);
    const limits = (await data.planLimitViewForTenant(tenantA)).limits;
    expect(limits.developer_applications).toBe(3);
    expect(limits).not.toHaveProperty('malformed');
    expect(limits).not.toHaveProperty('negative');
    const appInput = { ...actor, name: 'App', description: '', redirectUris: ['https://app.example.test/callback'], requestedScopes: ['profile:read', 'webhooks:manage'] };
    const app = await apps.create(appInput, 'portal-app-create-1');
    await expect(apps.create(appInput, 'portal-app-create-1')).rejects.toMatchObject({ status: 409 });
    await expect(apps.create({ ...appInput, description: 'different' }, 'portal-app-create-other')).rejects.toMatchObject({ code: 'DEVELOPER_INVALID_TRANSITION' });
    await apps.activate(actor, app.id, 'portal-app-activate-1');
    const updates = await Promise.allSettled([
      apps.update(actor, app.id, { description: 'updated' }, 'portal-app-update-1'),
      apps.update(actor, app.id, { description: 'updated' }, 'portal-app-update-1'),
    ]);
    expect(updates.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(updates.filter((item) => item.status === 'rejected')).toHaveLength(1);
    const safeUpdate = updates.find((item) => item.status === 'fulfilled');
    expect(JSON.stringify(safeUpdate)).not.toContain('idempotencyKey');
    await apps.addRedirectUri(actor, app.id, 'https://other.example.test/callback', 'portal-app-redirect-1');
    await expect(apps.addRedirectUri(actor, app.id, 'https://other.example.test/callback', 'portal-app-redirect-1')).rejects.toMatchObject({ status: 409 });
    await credentials.updateApplicationScopes(actor, app.id, { scopes: ['profile:read', 'webhooks:manage'] }, 'portal-app-scopes-1');
    await expect(credentials.updateApplicationScopes(actor, app.id, { scopes: ['profile:read', 'webhooks:manage'] }, 'portal-app-scopes-1')).rejects.toMatchObject({ status: 409 });
    expect((await apps.listForTenant(tenantA, {})).rows).toHaveLength(1);
    expect((await apps.listForTenant(tenantB, {})).rows).toHaveLength(0);
    await expect(apps.getOwned(tenantB, app.id)).rejects.toThrow('not found');
    const issued = await credentials.createApiKey(actor, app.id, { label: 'Test key' }, 'portal-key-create-1');
    expect(issued.secret).toMatch(/^devsec_/);
    const oauth = new OAuthService(db, new DeveloperAuditService(db), policy, new DeveloperScopeService(), data, 'test-only-hmac');
    let rateCount = 1;
    const access = new ApiAccessService(db, oauth, credentials, policy, new DeveloperScopeService(), new ApiVersionService(),
      new ApiRateLimitService({ incrementWithin: async () => rateCount, ttlSeconds: async () => 30 }), data, 'test-only-hmac');
    const accessContext = {
      authorization: `Developer ${issued.keyId}.${issued.secret}`, apiVersion: 'v1', requiredScope: 'profile:read',
      endpointClass: 'profile.read', nowIso: '2026-10-27', nowSeconds: 1793059200, resolvedTenantId: tenantA,
      expectedEnvironment: 'SANDBOX' as const, clientTenantHint: tenantB,
    };
    expect((await access.authorize(accessContext)).tenantId).toBe(tenantA);
    const pins = new DeveloperVersionPinService(db, new DeveloperAuditService(db), new ApiVersionService(), policy, data);
    expect(await pins.get(tenantA, app.id)).toEqual({ applicationId: app.id, version: 'v1' });
    await expect(pins.get(tenantB, app.id)).rejects.toThrow('not found');
    await expect(access.authorize({ ...accessContext, apiVersion: 'v2' })).rejects.toMatchObject({ code: 'DEVELOPER_VERSION_UNSUPPORTED' });
    await pins.set(actor, app.id, 'v2', 'portal-pin-v2-intent');
    await expect(pins.set(actor, app.id, 'v2', 'portal-pin-v2-intent')).rejects.toMatchObject({ status: 409 });
    await expect(access.authorize(accessContext)).rejects.toMatchObject({ code: 'DEVELOPER_VERSION_UNSUPPORTED' });
    expect((await access.authorize({ ...accessContext, apiVersion: 'v2' })).apiVersion).toBe('v2');
    await pins.set(actor, app.id, 'v1', 'portal-pin-v1-intent');
    expect(await admin.developerAudit.count({ where: { tenantId: tenantA, action: 'application.version_pinned' } })).toBe(2);
    await expect(access.authorize({ ...accessContext, resolvedTenantId: tenantB })).rejects.toThrow('credential not recognized');
    await expect(access.authorize({ ...accessContext, expectedEnvironment: 'PRODUCTION' })).rejects.toMatchObject({ code: 'DEVELOPER_ENVIRONMENT_MISMATCH' });
    await expect(access.authorize({ ...accessContext, nowIso: '2030-01-01' })).rejects.toMatchObject({ code: 'DEVELOPER_VERSION_SUNSET' });
    await admin.developerApplication.update({ where: { id: app.id }, data: { state: 'PENDING' } });
    await expect(access.authorize(accessContext)).rejects.toMatchObject({ code: 'DEVELOPER_APPLICATION_SUSPENDED' });
    await admin.developerApplication.update({ where: { id: app.id }, data: { state: 'ACTIVE' } });

    expect((await credentials.listForTenant(tenantA, {})).rows).toHaveLength(1);
    expect((await credentials.listForTenant(tenantB, {})).rows).toHaveLength(0);
    const rotated = await credentials.rotate(actor, app.id, issued.keyId, undefined, 'portal-key-rotate-1');
    expect(rotated.secret).not.toBe(issued.secret);
    const created = await webhooks.create(actor, { applicationId: app.id, endpointUrl: 'https://hook.example.test/inbox', eventTypes: ['order.filled'] }, 'portal-webhook-create-1');
    expect((await webhooks.list(tenantA, {})).rows).toHaveLength(1);
    expect((await webhooks.list(tenantB, {})).rows).toHaveLength(0);
    // Reconciliation must see the selected tenant under FORCE RLS, but no
    // other tenant's findings. An unavailable global RLS bypass is never used.
    await admin.developerApplication.update({ where: { id: app.id }, data: { scopes: ['profile:read'] } });
    const reconciliation = new DeveloperReconciliationService(db);
    const reportA = await reconciliation.reconcile(tenantA);
    const reportB = await reconciliation.reconcile(tenantB);
    await expect(reconciliation.reconcile(randomUUID())).rejects.toThrow('tenant not found');
    expect(reportA.tenantId).toBe(tenantA);
    expect(reportA.truncated).toBe(false);
    expect(reportA.findings.some((finding) => finding.kind === 'WEBHOOK_SCOPE_MISMATCH' && finding.subjectId === created.subscription.id)).toBe(true);
    expect(reportB.findings.some((finding) => finding.subjectId === created.subscription.id)).toBe(false);
    await admin.developerApplication.update({ where: { id: app.id }, data: { scopes: ['profile:read', 'webhooks:manage'] } });
    await expect(webhooks.pause({ ...actor, tenantId: tenantB }, created.subscription.id, undefined, 'foreign-intent')).rejects.toThrow('not found');
    await webhooks.pause(actor, created.subscription.id, undefined, 'portal-hook-pause');
    await webhooks.resume(actor, created.subscription.id, undefined, 'portal-hook-resume');
    const secondApp = await apps.create({ ...actor, name: 'Second app', description: '', redirectUris: ['https://second.example.test/callback'], requestedScopes: ['profile:read'] }, 'portal-app-create-2');
    await apps.activate(actor, secondApp.id, 'portal-app-activate-2');
    await apps.suspend(actor, secondApp.id, 'review', 'portal-app-suspend-2');
    expect(await apps.requestReactivation(actor, secondApp.id, 'resume', 'portal-app-reactivate-2')).toBe('ACTIVE');
    await apps.suspend(actor, secondApp.id, 'review required', 'portal-app-suspend-3');
    const plan = await admin.subscriptionPlan.findFirstOrThrow({ where: { code: planCode } });
    await admin.subscriptionPlan.update({ where: { id: plan.id }, data: { limits: { ...(plan.limits as object), developer_reactivation_review: 1 } } });
    expect(await apps.requestReactivation(actor, secondApp.id, 'resume', 'portal-app-reactivate-3')).toBe('REACTIVATION_REVIEW');
    await expect(apps.activate(actor, secondApp.id, 'portal-app-activate-review')).rejects.toMatchObject({ code: 'DEVELOPER_INVALID_TRANSITION' });
    await apps.approveReactivation(actor, secondApp.id, 'portal-app-approve-2');
    await apps.revoke(actor, secondApp.id, 'retired', 'portal-app-revoke-2');
    expect((await reconciliation.reconcile(tenantA)).tenantId).toBe(tenantA);
    await expect(apps.update(actor, secondApp.id, { name: 'No' }, 'portal-app-update-revoked')).rejects.toMatchObject({ code: 'DEVELOPER_APPLICATION_REVOKED' });
    const applicationPage = await apps.listForTenant(tenantA, { limit: 1 });
    expect(applicationPage.nextCursor).toBeTruthy();
    const nextApplicationPage = await apps.listForTenant(tenantA, { limit: 1, cursor: applicationPage.nextCursor! });
    expect(nextApplicationPage.rows[0].id).not.toBe(applicationPage.rows[0].id);
    expect(nextApplicationPage.nextCursor).toBeNull();
    await expect(apps.listForTenant(tenantB, { cursor: applicationPage.nextCursor! })).rejects.toThrow('invalid application cursor');

    const keyPage = await credentials.listForTenant(tenantA, { limit: 1 });
    expect(keyPage.nextCursor).toBeTruthy();
    const nextKeyPage = await credentials.listForTenant(tenantA, { limit: 1, cursor: keyPage.nextCursor! });
    expect(nextKeyPage.rows[0].id).not.toBe(keyPage.rows[0].id);
    expect(nextKeyPage.nextCursor).toBeNull();
    await expect(credentials.listForTenant(tenantB, { cursor: keyPage.nextCursor! })).rejects.toThrow('invalid credential cursor');
    expect((await credentials.listForTenant(tenantA, { status: 'ACTIVE' })).rows.map((row) => row.keyId)).toEqual([rotated.keyId]);
    expect((await credentials.listForTenant(tenantA, { status: 'REVOKED' })).rows.map((row) => row.keyId)).toEqual([issued.keyId]);
    await admin.developerCredential.update({ where: { keyId: rotated.keyId }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    expect((await credentials.listForTenant(tenantA, { status: 'EXPIRED' })).rows.map((row) => row.keyId)).toEqual([rotated.keyId]);
    expect((await credentials.listForTenant(tenantA, { status: 'ACTIVE' })).rows).toHaveLength(0);

    await webhooks.create(actor, { applicationId: app.id, endpointUrl: 'https://hook2.example.test/inbox', eventTypes: ['order.filled'] }, 'portal-webhook-create-2');
    const webhookPage = await webhooks.list(tenantA, { limit: 1 });
    expect(webhookPage.nextCursor).toBeTruthy();
    const nextWebhookPage = await webhooks.list(tenantA, { limit: 1, cursor: webhookPage.nextCursor! });
    expect(nextWebhookPage.rows[0].id).not.toBe(webhookPage.rows[0].id);
    expect(nextWebhookPage.nextCursor).toBeNull();
    await expect(webhooks.list(tenantB, { cursor: webhookPage.nextCursor! })).rejects.toThrow('invalid webhook cursor');
    // Global quota is four, but this application's explicit quota is three.
    // Different concurrent keys still share the locked per-application cap.
    const quotaPlan = await admin.subscriptionPlan.findFirstOrThrow({ where: { code: planCode } });
    await admin.subscriptionPlan.update({ where: { id: quotaPlan.id }, data: { limits: { ...(quotaPlan.limits as object), developer_webhook_endpoints_per_app: 3 } } });
    const attempts = await Promise.allSettled([
      webhooks.create(actor, { applicationId: app.id, endpointUrl: 'https://quota1.example.test/inbox', eventTypes: ['order.filled'] }, 'portal-hook-quota-a'),
      webhooks.create(actor, { applicationId: app.id, endpointUrl: 'https://quota2.example.test/inbox', eventTypes: ['order.filled'] }, 'portal-hook-quota-b'),
    ]);
    expect(attempts.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((item) => item.status === 'rejected')).toHaveLength(1);
    expect(await admin.developerWebhookSubscription.count({ where: { tenantId: tenantA, applicationId: app.id, revokedAt: null } })).toBe(3);
    await admin.subscriptionPlan.update({ where: { id: quotaPlan.id }, data: { limits: quotaPlan.limits as never } });
    const oauthActor = { ...actor, actorId: randomUUID() };
    await admin.user.create({ data: {
      id: oauthActor.actorId, tenantId: tenantA, email: `oauth-${oauthActor.actorId}@example.test`,
      emailIndex: oauthActor.actorId.replace(/-/g, ''), passwordHash: 'not-used-in-this-test', status: 'ACTIVE',
      profile: { create: { displayName: 'OAuth subject', locale: 'en' } },
    } });
    const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const authorizationInput = {
      tenantId: tenantA, userId: oauthActor.actorId, correlationId: 'portal-oauth', clientId: app.clientId,
      redirectUri: 'https://app.example.test/callback', state: 'state-0123456789abcdef',
      requestedScopes: ['profile:read'], codeChallenge: challenge, codeChallengeMethod: 'S256' as const,
    };
    const [request, retry] = await Promise.all([oauth.createAuthorizationRequest(authorizationInput), oauth.createAuthorizationRequest(authorizationInput)]);
    expect(retry.grantId).toBe(request.grantId);
    await expect(oauth.createAuthorizationRequest({ ...authorizationInput, nonce: 'different' })).rejects.toMatchObject({ code: 'DEVELOPER_INVALID_TRANSITION' });
    await expect(oauth.recordConsent({ ...oauthActor, tenantId: tenantB }, request.grantId, 'GRANTED')).rejects.toThrow('not found');
    await oauth.recordConsent(oauthActor, request.grantId, 'GRANTED');
    const issuedCode = await oauth.issueAuthorizationCode(oauthActor, request.grantId);
    expect(issuedCode).toMatchObject({ redirectTo: 'https://app.example.test/callback', state: 'state-0123456789abcdef' });
    const { code } = issuedCode;
    const exchange = { tenantId: tenantA, clientId: app.clientId, code, redirectUri: 'https://app.example.test/callback', codeVerifier: verifier, correlationId: 'portal-oauth' };
    const issuedTokens = await Promise.allSettled([oauth.exchangeToken(exchange), oauth.exchangeToken(exchange)]);
    const token = issuedTokens.find((item): item is PromiseFulfilledResult<Awaited<ReturnType<typeof oauth.exchangeToken>>> => item.status === 'fulfilled');
    expect(issuedTokens.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(token?.value.accessToken).toMatch(/^dvc_/);
    // Any second redemption invalidates the first token, including when both
    // requests observed the unused code before the atomic claim.
    expect((await admin.developerAccessToken.findFirstOrThrow({ where: { tenantId: tenantA, grantId: request.grantId } })).revokedAt).not.toBeNull();
    const secondRequest = await oauth.createAuthorizationRequest({
      tenantId: tenantA, userId: oauthActor.actorId, correlationId: 'portal-oauth-two', clientId: app.clientId,
      redirectUri: 'https://app.example.test/callback', state: 'state-0123456789abcdeg',
      requestedScopes: ['profile:read'], codeChallenge: challenge, codeChallengeMethod: 'S256',
    });
    await oauth.recordConsent(oauthActor, secondRequest.grantId, 'GRANTED');
    const secondCode = await oauth.issueAuthorizationCode(oauthActor, secondRequest.grantId);
    const secondToken = await oauth.exchangeToken({ ...exchange, code: secondCode.code });
    expect((await oauth.resolveAccessToken(tenantA, secondToken.accessToken))?.tenantId).toBe(tenantA);
    expect(await oauth.resolveAccessToken(tenantB, secondToken.accessToken)).toBeNull();
    const oauthDecision = await access.authorize({ ...accessContext, authorization: `Bearer ${secondToken.accessToken}` });
    expect(oauthDecision.identityType).toBe('OAUTH_TOKEN');
    expect(oauthDecision.userId).toBe(oauthActor.actorId);
    await expect(access.authorize({ ...accessContext, resolvedTenantId: tenantB, authorization: `Bearer ${secondToken.accessToken}` })).rejects.toThrow('token not recognized');
    await admin.user.update({ where: { id: oauthActor.actorId }, data: { status: 'SUSPENDED' } });
    expect(await oauth.resolveAccessToken(tenantA, secondToken.accessToken)).toBeNull();
    await admin.user.update({ where: { id: oauthActor.actorId }, data: { status: 'ACTIVE' } });

    // Real Nest HTTP boundary using real access/pin/OAuth services and forced
    // PostgreSQL RLS; only the host-to-tenant resolver is test transport setup.
    await admin.developerCredential.update({ where: { keyId: rotated.keyId }, data: { expiresAt: null } });
    const httpModule = await Test.createTestingModule({
      controllers: [DeveloperIntegrationController],
      providers: [{ provide: ApiAccessService, useValue: access }, { provide: PrismaService, useValue: db },
        { provide: DeveloperUsageService, useValue: new DeveloperUsageService(db) }],
    }).compile();
    const http = httpModule.createNestApplication();
    http.use((req: { headers: Record<string, string>; tenantContext?: unknown }, _res: unknown, next: () => void) => {
      req.tenantContext = { tenantId: req.headers.host === 'tenant-b.test' ? tenantB : tenantA };
      next();
    });
    http.useGlobalInterceptors(new ResponseTransformInterceptor(new Reflector(), { defaultApiVersion: 'v1' } as never));
    await http.init();
    try {
      const url = '/developer-platform/integration/sandbox';
      const keyAuth = `Developer ${rotated.keyId}.${rotated.secret}`;
      const client = await supertest(http.getHttpServer()).get(`${url}/client?version=v1`).set('Authorization', keyAuth).expect(200);
      expect(client.body.data.clientId).toBe(app.clientId);
      expect(client.headers['x-api-version']).toBe('v1');
      expect(client.headers['cache-control']).toBe('no-store');
      await supertest(http.getHttpServer()).get(`${url}/profile?version=v1`).set('Authorization', keyAuth).expect(401);
      const profile = await supertest(http.getHttpServer()).get(`${url}/profile`).set('X-Api-Version', 'v1')
        .set('Authorization', `Bearer ${secondToken.accessToken}`).expect(200);
      expect(profile.body.data).toMatchObject({ id: oauthActor.actorId, displayName: 'OAuth subject' });
      expect(JSON.stringify(profile.body)).not.toContain(secondToken.accessToken);
      await supertest(http.getHttpServer()).get(`${url}/client?version=v2`).set('Authorization', keyAuth).expect(400);
      await supertest(http.getHttpServer()).get(`/developer-platform/integration/production/client?version=v1`).set('Authorization', keyAuth).expect(403);
      await supertest(http.getHttpServer()).get(`${url}/client?version=v1`).set('Host', 'tenant-b.test').set('Authorization', keyAuth).expect(404);
      await supertest(http.getHttpServer()).get(`${url}/client?version=v2`).set('X-Api-Version', 'v1').set('Authorization', keyAuth).expect(400);
      await admin.developerApplication.update({ where: { id: app.id }, data: { scopes: ['webhooks:manage'] } });
      await supertest(http.getHttpServer()).get(`${url}/client?version=v1`).set('Authorization', keyAuth).expect(403);
      await admin.developerApplication.update({ where: { id: app.id }, data: { scopes: ['profile:read', 'webhooks:manage'] } });
      await pins.set(actor, app.id, 'v2', 'portal-gateway-v2-intent');
      await supertest(http.getHttpServer()).get(`${url}/client?version=v1`).set('Authorization', keyAuth).expect(400);
      await supertest(http.getHttpServer()).get(`${url}/client?version=v2`).set('Authorization', keyAuth).expect(200);
      await pins.set(actor, app.id, 'v1', 'portal-gateway-v1-intent');
      rateCount = 1_000_000;
      const limited = await supertest(http.getHttpServer()).get(`${url}/client?version=v1`).set('Authorization', keyAuth).expect(429);
      expect(limited.headers['retry-after']).toBe('30');
      expect(JSON.stringify(limited.body)).not.toContain(rotated.secret);
      rateCount = 1;
      await oauth.revokeToken({ ...oauthActor, tenantId: tenantB }, secondToken.accessToken);
      expect((await admin.developerAccessToken.findFirstOrThrow({ where: { tenantId: tenantA, grantId: secondRequest.grantId } })).revokedAt).toBeNull();
      const owned = await oauth.listUserGrants(tenantA, oauthActor.actorId, 1);
      expect(owned.rows[0]).toMatchObject({ clientName: 'App', scopes: ['profile:read'] });
      expect(owned.nextCursor).toBeTruthy();
      const nextGrant = await oauth.listUserGrants(tenantA, oauthActor.actorId, 1, owned.nextCursor!);
      expect(nextGrant.rows[0]?.id).not.toBe(owned.rows[0]?.id);
      await expect(oauth.listUserGrants(tenantB, oauthActor.actorId, 1, owned.nextCursor!)).rejects.toThrow('not found');
      await expect(oauth.revokeUserGrant({ ...oauthActor, actorId: randomUUID() }, secondRequest.grantId, 'not-owned-grant-key')).rejects.toThrow('not found');
      await expect(oauth.revokeUserGrant({ ...oauthActor, tenantId: tenantB }, secondRequest.grantId, 'not-tenant-grant-key')).rejects.toThrow('not found');
      await oauth.revokeUserGrant(oauthActor, secondRequest.grantId, 'revoke-own-grant-key');
      expect((await admin.developerOAuthGrant.findUniqueOrThrow({ where: { id: secondRequest.grantId } })).state).toBe('REVOKED');
      expect((await admin.developerAccessToken.findFirstOrThrow({ where: { tenantId: tenantA, grantId: secondRequest.grantId } })).revokedAt).not.toBeNull();
      await supertest(http.getHttpServer()).get(`${url}/profile?version=v1`).set('Authorization', `Bearer ${secondToken.accessToken}`).expect(404);
    } finally { await http.close(); }
    const observed = await new DeveloperUsageService(db).applicationRollup(tenantA, app.id, { granularity: 'hour' });
    expect(observed).toMatchObject({ totalRequests: 5, totalRateLimited: 1, truncated: false });
    expect(observed.byEndpoint).toEqual(expect.arrayContaining([
      expect.objectContaining({ endpoint: 'integration.profile', requests: 2, errors4xx: 1 }),
      expect.objectContaining({ endpoint: 'integration.client', requests: 3, errors4xx: 0 }),
    ]));
    await admin.developerCredential.update({ where: { keyId: rotated.keyId }, data: { expiresAt: new Date(Date.now() - 60_000) } });

    expect((await admin.developerAccessToken.findFirstOrThrow({ where: { tenantId: tenantA, grantId: secondRequest.grantId } })).revokedAt).not.toBeNull();
    const hookId = created.subscription.id;
    await admin.developerWebhookDelivery.create({ data: {
      tenantId: tenantA, subscriptionId: hookId, applicationId: app.id, eventId: 'evt-portal', eventType: 'order.filled', eventVersion: 'v1', source: 'execution', occurredAt: new Date(), payload: { orderId: 'order-one', status: 'FILLED' }, state: 'FAILED', correlationId: 'portal', environment: 'SANDBOX', idempotencyKey: `original:${tenantA}`,
    } });
    await admin.usageEvent.create({ data: {
      tenantId: tenantA, meterKey: 'developer_api_requests', eventType: 'API_REQUEST', sourceId: app.id,
      sourceType: 'developer_application', quantity: 2, periodId: 'portal', idempotencyKey: `usage:${tenantA}`,
      safeMetadata: { applicationId: app.id, endpoint: 'profile.read', apiVersion: 'v1', outcome: 'ok' },
    } });
    const usage = new DeveloperUsageService(db);
    expect((await usage.applicationRollup(tenantA, app.id, { granularity: 'day' })).totalRequests).toBe(7);
    await expect(usage.applicationRollup(tenantB, app.id, { granularity: 'day' })).rejects.toThrow('not found');
    const analytics = await new DeveloperAnalyticsService(db, usage).applicationAnalytics({
      tenantId: tenantA, applicationId: app.id, from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000), latencyObservations: [],
    });
    expect(analytics).toMatchObject({ requests: 7, webhookFailures: 1, activeApplications: 1, activeApiKeys: 0 });
    const first = await replay.replay(actor, hookId, 'evt-portal', 'portal-replay-intent');
    expect(await replay.replay(actor, hookId, 'evt-portal', 'portal-replay-intent')).toEqual(first);
    await expect(replay.replay({ ...actor, tenantId: tenantB }, hookId, 'evt-portal', 'foreign-replay')).rejects.toThrow('not found');
    expect(await db.developerApplication.count()).toBe(0); // no tenant context on this connection
  });
});
