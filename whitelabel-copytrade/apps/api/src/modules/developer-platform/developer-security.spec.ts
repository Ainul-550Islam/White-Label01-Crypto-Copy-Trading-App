import 'reflect-metadata';
import { createHash } from 'crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateDeveloperApplicationDto } from './dto/developer-application.dto';
import { CreateCredentialDto, OAuthConsentDto, WebhookSubscriptionActionDto } from './dto/developer-action.dto';
import { DeveloperUsageQuery, ListDeliveriesQuery } from './dto/developer-query.dto';
import { credentialDigest, DEVELOPER_ERROR_CODES } from './developer.types';
import { OAuthService } from './oauth.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhookSubscriptionService } from './webhook-subscription.service';
import { WebhookReplayService } from './webhook-replay.service';
import { DeveloperController } from './developer.controller';

const tenantId = 'tenant-1', clientId = 'dev_client', redirectUri = 'https://app.example.test/callback';
const hmac = 'fixture-hmac-key', code = 'the-correct-authorization-code';
const verifier = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNO';
const challenge = createHash('sha256').update(verifier).digest('base64url');
const application = { id: 'app-1', tenantId, clientId, state: 'ACTIVE', redirectUris: [redirectUri], scopes: ['profile:read'] };
const grant = () => ({ id: 'grant-1', tenantId, userId: 'user-1', applicationId: application.id, state: 'GRANTED', redirectUri, codeHash: credentialDigest(code, hmac), codeExpiresAt: new Date(Date.now() + 60_000), codeRedeemedAt: null, codeChallenge: challenge, codeChallengeMethod: 'S256', consentedScopes: ['profile:read'] });
function harness() {
  const db = {
    developerApplication: { findUnique: jest.fn().mockResolvedValue(application) },
    developerOAuthGrant: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    developerCredential: { findFirst: jest.fn().mockResolvedValue(null) },
    developerAccessToken: { create: jest.fn().mockResolvedValue({}), updateMany: jest.fn() }, $transaction: jest.fn(), $queryRaw: jest.fn().mockResolvedValue([]),
  };
  db.$transaction.mockImplementation((run: (tx: unknown) => unknown) => run(db));
  Object.assign(db, { withTenantRls: (_tenant: string, run: (tx: unknown) => unknown) => run(db) });
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const policy = { resolve: jest.fn().mockReturnValue({ allowedScopes: ['profile:read'], oauth: { pkceRequired: true, authorizationCodeTtlSeconds: 600, accessTokenTtlSeconds: 900 } }) };
  const scope = { resolve: jest.fn().mockReturnValue({ effective: ['profile:read'] }), assertTokenScopesBounded: jest.fn((scopes: string[]) => scopes) };
  const data = { planLimitViewForTenant: jest.fn().mockResolvedValue({}), tenantEntitlementKeys: jest.fn().mockResolvedValue([]) };
  return { db, service: new OAuthService(db as never, audit as never, policy as never, scope as never, data as never, hmac) };
}
const exchange = { tenantId, clientId, code, redirectUri, codeVerifier: verifier, correlationId: 'test' };

test('DTOs validate arrays, actions, optional usage and transformed pagination', async () => {
  expect(await validate(plainToInstance(CreateDeveloperApplicationDto, { name: 'Example', description: '', redirectUris: [redirectUri], requestedScopes: ['profile:read'] }))).toHaveLength(0);
  expect(await validate(plainToInstance(CreateDeveloperApplicationDto, { name: 'Example', description: '', redirectUris: [redirectUri, 'http://evil.test'] }))).not.toHaveLength(0);
  expect(await validate(plainToInstance(CreateCredentialDto, { label: 'Key', scopes: ['profile:read', 2] }))).not.toHaveLength(0);
  for (const action of ['pause', 'resume', 'revoke']) expect(await validate(plainToInstance(WebhookSubscriptionActionDto, { action }))).toHaveLength(0);
  expect(await validate(plainToInstance(WebhookSubscriptionActionDto, { action: 'DELIVERED' }))).not.toHaveLength(0);
  expect(await validate(plainToInstance(OAuthConsentDto, { grantId: '1234567890123456', decision: 'PENDING_CONSENT' }))).not.toHaveLength(0);
  expect(await validate(plainToInstance(DeveloperUsageQuery, {}))).toHaveLength(0);
  const query = plainToInstance(ListDeliveriesQuery, { limit: '10', state: 'FAILED' });
  expect(query.limit).toBe(10);
  expect(await validate(query)).toHaveLength(0);
});

test.each(['PENDING', 'SUSPENDED', 'REACTIVATION_REVIEW'])('does not authorize an %s OAuth application', async (state) => {
  const { db, service } = harness();
  db.developerApplication.findUnique.mockResolvedValue({ ...application, state });
  await expect(service.createAuthorizationRequest({ tenantId, userId: 'user-1', clientId, redirectUri,
    state: 'state-123456789012', correlationId: 'test', codeChallenge: challenge, codeChallengeMethod: 'S256' }))
    .rejects.toMatchObject({ code: DEVELOPER_ERROR_CODES.APPLICATION_SUSPENDED });
  expect(db.developerOAuthGrant.create).not.toHaveBeenCalled();
});

test('stores S256 as the PKCE method', async () => {
  const { db, service } = harness(); db.developerOAuthGrant.create.mockResolvedValue({ id: 'grant-1' });
  await service.createAuthorizationRequest({ tenantId, userId: 'user-1', clientId, redirectUri, state: 'state-123456789012', correlationId: 'test', codeChallenge: challenge, codeChallengeMethod: 'S256' });
  expect(db.developerOAuthGrant.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ codeChallenge: challenge, codeChallengeMethod: 'S256' }) }));
});

test('rejects a wrong code even when a different grant exists', async () => {
  const { db, service } = harness(); db.developerOAuthGrant.findFirst.mockResolvedValue(grant());
  await expect(service.exchangeToken({ ...exchange, code: 'wrong-code' })).rejects.toMatchObject({ code: DEVELOPER_ERROR_CODES.CODE_INVALID });
  expect(db.developerOAuthGrant.findFirst).toHaveBeenCalledWith({ where: { tenantId, applicationId: application.id, codeHash: credentialDigest('wrong-code', hmac) } });
  expect(db.developerAccessToken.create).not.toHaveBeenCalled();
});

test('requires the PKCE verifier and an atomic claim before minting', async () => {
  const { db, service } = harness(); db.developerOAuthGrant.findFirst.mockResolvedValue(grant());
  await expect(service.exchangeToken({ ...exchange, codeVerifier: 'wrong' })).rejects.toMatchObject({ code: DEVELOPER_ERROR_CODES.PKCE_VERIFIER_MISMATCH });
  expect(db.developerAccessToken.create).not.toHaveBeenCalled();
  expect((await service.exchangeToken(exchange)).tokenType).toBe('Bearer');
  expect(db.developerOAuthGrant.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId, codeHash: credentialDigest(code, hmac), codeRedeemedAt: null }) }));
  expect(db.developerAccessToken.create).toHaveBeenCalledTimes(1);
});

test('does not mint if another exchange claimed the code', async () => {
  const { db, service } = harness(); db.developerOAuthGrant.findFirst.mockResolvedValue(grant()); db.developerOAuthGrant.updateMany.mockResolvedValue({ count: 0 });
  await expect(service.exchangeToken(exchange)).rejects.toMatchObject({ code: DEVELOPER_ERROR_CODES.CODE_REPLAYED });
  expect(db.developerAccessToken.create).not.toHaveBeenCalled();
});

test('a replay without the correct PKCE verifier cannot revoke issued tokens', async () => {
  const { db, service } = harness();
  db.developerOAuthGrant.findFirst.mockResolvedValue({ ...grant(), codeRedeemedAt: new Date() });
  await expect(service.exchangeToken({ ...exchange, codeVerifier: 'wrong' })).rejects.toMatchObject({ code: DEVELOPER_ERROR_CODES.PKCE_VERIFIER_MISMATCH });
  expect(db.developerAccessToken.updateMany).not.toHaveBeenCalled();
});

test('issues at most one code per grant', async () => {
  const { db, service } = harness(); db.developerOAuthGrant.findUnique.mockResolvedValue(grant()); db.developerOAuthGrant.updateMany.mockResolvedValue({ count: 0 });
  await expect(service.issueAuthorizationCode({ tenantId, actorId: 'user-1', actorType: 'USER', correlationId: 'test' }, 'grant-1')).rejects.toMatchObject({ code: DEVELOPER_ERROR_CODES.INVALID_TRANSITION });
});


test('two simultaneous redemptions can create only one token', async () => {
  const { db, service } = harness(); db.developerOAuthGrant.findFirst.mockImplementation(async () => ({ ...grant() }));
  let claimed = false;
  db.developerOAuthGrant.updateMany.mockImplementation(async () => {
    if (claimed) return { count: 0 };
    claimed = true; return { count: 1 };
  });
  const result = await Promise.allSettled([service.exchangeToken(exchange), service.exchangeToken(exchange)]);
  expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
  expect(result.filter((item) => item.status === 'rejected')).toHaveLength(1);
  expect(db.developerAccessToken.create).toHaveBeenCalledTimes(1);
});

test('delivery pages use a scoped cursor and fail-closed payload redaction', async () => {
  const id1 = '11111111-1111-4111-8111-111111111111';
  const id2 = '22222222-2222-4222-8222-222222222222';
  const base = { eventId: 'event', eventType: 'order.filled', eventVersion: 'v1', attempt: 1, state: 'DELIVERED', outcomeClass: 'SUCCESS', responseStatus: 200, nextRetryAt: null, correlationId: 'c', createdAt: new Date() };
  const db = { developerWebhookSubscription: { findUnique: jest.fn().mockResolvedValue({ id: 'sub', tenantId }) }, developerWebhookDelivery: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([
    { ...base, id: id1, payload: { orderId: 'devsec_should_never_be_visible', status: 'FILLED' } },
    { ...base, id: id2, payload: { orderId: 'order-2', status: 'FILLED', secret: 'leak' } },
  ]) } };
  Object.assign(db, { withTenantRls: (_tenant: string, run: (tx: unknown) => unknown) => run(db) });
  const service = new WebhookDeliveryService(db as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  expect(Reflect.getMetadata('design:paramtypes', DeveloperController.prototype, 'listDeliveries')[2]).toBe(ListDeliveriesQuery);
  const first = await service.list(tenantId, { subscriptionId: 'sub', state: 'DELIVERED', limit: 1 });
  expect(first.nextCursor).toBe(id1);
  expect(first.rows[0].payload).toEqual({ orderId: '[REDACTED]', status: 'FILLED' });
  expect(JSON.stringify(first)).not.toContain('devsec_');
  expect(db.developerWebhookDelivery.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId, subscriptionId: 'sub', state: 'DELIVERED' }, take: 2 }));
  await expect(service.list(tenantId, { subscriptionId: 'sub', state: 'DELIVERED', cursor: id2 })).rejects.toThrow('invalid delivery cursor');
  expect(db.developerWebhookDelivery.findFirst).toHaveBeenCalledWith({ where: { tenantId, subscriptionId: 'sub', state: 'DELIVERED', id: id2 }, select: { id: true } });
  db.developerWebhookDelivery.findFirst.mockResolvedValue({ id: id1 });
  const next = await service.list(tenantId, { subscriptionId: 'sub', cursor: id1 });
  expect(db.developerWebhookDelivery.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: { id: id1 }, skip: 1 }));
  expect(next.rows[1].payload).toBeNull();
  db.developerWebhookSubscription.findUnique.mockResolvedValue({ id: 'sub', tenantId: 'other' });
  await expect(service.list(tenantId, { subscriptionId: 'sub' })).rejects.toThrow('not found');
});

test('webhook create, update, pause and list never expose stored secret material', async () => {
  const persisted = { id: 'sub', tenantId, applicationId: 'app-1', endpointUrl: 'https://hook.test', eventTypes: ['order.filled'], eventVersion: 'v1', environment: 'SANDBOX', state: 'ACTIVE', revokedAt: null, secretHash: 'hash-secret', secretEncrypted: 'cipher-secret', idempotencyKey: 'internal-key', createdByActorId: 'user' };
  const db = { developerApplication: { findUnique: jest.fn().mockResolvedValue({ ...application, scopes: ['webhooks:manage'], environment: 'SANDBOX' }) }, developerWebhookSubscription: { count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue(persisted), findUnique: jest.fn().mockResolvedValue(persisted), findUniqueOrThrow: jest.fn().mockResolvedValue(persisted), updateMany: jest.fn().mockResolvedValue({ count: 1 }), findMany: jest.fn().mockResolvedValue([persisted]) }, $transaction: jest.fn() };
  db.$transaction.mockImplementation((run: (tx: unknown) => unknown) => run(db));
  Object.assign(db, { withTenantRls: (_tenant: string, run: (tx: unknown) => unknown) => run(db) });
  const actor = { tenantId, actorId: 'user', actorType: 'USER' as const, correlationId: 'test' };
  const service = new WebhookSubscriptionService(db as never, { record: jest.fn() } as never, { resolve: () => ({ maxWebhookSubscriptions: 10, maxWebhookEndpointsPerApplication: 10, allowedScopes: ['webhooks:manage'] }) } as never, { planLimitViewForTenant: jest.fn(), tenantEntitlementKeys: jest.fn() } as never, { newSecret: () => 'one-time-secret' } as never, hmac, { encrypt: () => 'cipher-secret' } as never);
  const created = await service.create(actor, { applicationId: 'app-1', endpointUrl: 'https://hook.test', eventTypes: ['order.filled'] });
  expect(created.secret).toBe('one-time-secret');
  for (const result of [created.subscription, await service.update(actor, 'sub', {}), await service.pause(actor, 'sub'), ...(await service.list(tenantId, {})).rows]) {
    expect(JSON.stringify(result)).not.toMatch(/hash-secret|cipher-secret|internal-key/);
    expect(result).not.toHaveProperty('secretHash');
    expect(result).not.toHaveProperty('secretEncrypted');
  }
});


test('replay request keys are tenant-scoped, retryable and bound to one event', async () => {
  const original = { id: 'original', tenantId, subscriptionId: 'sub', applicationId: 'app-1', eventId: 'evt-one', eventType: 'order.filled', eventVersion: 'v1', source: 'execution', occurredAt: new Date(), payload: { orderId: 'order', status: 'FILLED' }, correlationId: 'c' };
  let saved: Record<string, unknown> | null = null;
  const db = { developerWebhookSubscription: { findUnique: jest.fn().mockResolvedValue({ id: 'sub', tenantId, applicationId: 'app-1', state: 'ACTIVE', environment: 'SANDBOX' }) }, developerWebhookDelivery: {
    findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => where.idempotencyKey ? saved : { ...original, eventId: where.eventId }),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { saved = { ...data, id: 'replay' }; return saved; }),
  } };
  Object.assign(db, { withTenantRls: (_tenant: string, run: (tx: unknown) => unknown) => run(db), $queryRaw: jest.fn() });
  const service = new WebhookReplayService(db as never, { record: jest.fn() } as never, {} as never);
  const actor = { tenantId, actorId: 'user', actorType: 'USER' as const, correlationId: 'test' };
  const first = await service.replay(actor, 'sub', 'evt-one', 'intent-12345');
  expect(first).toEqual({ deliveryId: 'replay', eventId: 'evt-one' });
  expect((saved as unknown as Record<string, unknown>).idempotencyKey).toMatch(/^replay2:/);
  expect(await service.replay(actor, 'sub', 'evt-one', 'intent-12345')).toEqual(first);
  expect(db.developerWebhookDelivery.create).toHaveBeenCalledTimes(1);
  await expect(service.replay(actor, 'sub', 'evt-two', 'intent-12345')).rejects.toThrow('different replay');
});

test('replay controller requires an idempotency header', async () => {
  const services = Array.from({ length: 13 }, () => ({}));
  const controller = new DeveloperController(...(services as ConstructorParameters<typeof DeveloperController>));
  await expect(controller.replayWebhook(tenantId, { headers: {} } as never, 'sub', { eventId: 'event-12345' })).rejects.toThrow('idempotency key');
});
