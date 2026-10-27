/** Run only against a disposable database with the developer migrations applied. */
import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DeveloperCredentialService } from './developer-credential.service';
import { WebhookSubscriptionService } from './webhook-subscription.service';
import { WebhookReplayService } from './webhook-replay.service';
import { DeveloperAuditService } from './developer-audit.service';

const databaseUrl = process.env.BATCH02_TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)('developer security on PostgreSQL', () => {
  const tenantId = randomUUID(), applicationId = randomUUID();
  const actor = { tenantId, actorId: 'test-user', actorType: 'USER' as const, correlationId: 'batch02-test' };
  let db: PrismaService;
  let audit: DeveloperAuditService;
  const policy = { resolve: () => ({ maxCredentialsPerApplication: 20, maxWebhookSubscriptions: 20, maxWebhookEndpointsPerApplication: 20, allowedScopes: ['profile:read', 'webhooks:manage'] }) };
  const data = { planLimitViewForTenant: async () => ({}), tenantEntitlementKeys: async () => [] };
  const scopes = { resolve: () => ({ effective: ['profile:read', 'webhooks:manage'] }) };
  let credentials: DeveloperCredentialService;
  let webhooks: WebhookSubscriptionService;
  let counter = 0;
  let hookId: string;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('BATCH02_TEST_DATABASE_URL is required');
    db = new PrismaService({ databaseUrl, isProduction: false, databaseReadEnabled: false } as never, { warn() {}, debug() {}, error() {} } as never);
    audit = new DeveloperAuditService(db);
    credentials = new DeveloperCredentialService(db, audit as never, policy as never, scopes as never, data as never, 'test-hmac');
    webhooks = new WebhookSubscriptionService(db, audit as never, policy as never, data as never, { newSecret: () => `whsec_test_${++counter}` } as never, 'test-hmac', { encrypt: (s: string) => `encrypted:${s}` } as never);
    await db.$executeRaw`INSERT INTO tenants (id, slug, name, updated_at) VALUES (${tenantId}::uuid, ${`batch02-${tenantId}`}, 'security test', now())`;
    await db.$executeRaw`INSERT INTO developer_applications (id, tenant_id, name, description, client_id, state, environment, redirect_uris, scopes, natural_key, idempotency_key, created_by_actor_id, updated_at)
      VALUES (${applicationId}::uuid, ${tenantId}::uuid, 'app', '', ${`dev_${randomUUID()}`}, 'ACTIVE', 'SANDBOX', ARRAY['https://example.test'], ARRAY['profile:read','webhooks:manage'], ${tenantId}, ${tenantId}, 'test-user', now())`;
  });
  afterAll(async () => {
    if (!db) return;
    await db.$executeRaw`DELETE FROM developer_audit WHERE tenant_id = ${tenantId}::uuid`;
    await db.$executeRaw`DELETE FROM tenants WHERE id = ${tenantId}::uuid`;
    await db.$disconnect();
  });

  it('atomically deduplicates secret issuance and permits only one concurrent rotation', async () => {
    const results = await Promise.allSettled([
      credentials.createApiKey(actor, applicationId, { label: 'Key One' }, 'duplicate-create-key'),
      credentials.createApiKey(actor, applicationId, { label: 'Key One' }, 'duplicate-create-key'),
    ]);
    const success = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof credentials.createApiKey>>> => r.status === 'fulfilled');
    expect(success).toHaveLength(1);
    expect(await db.developerCredential.count({ where: { tenantId } })).toBe(1);
    const rotations = await Promise.allSettled([
      credentials.rotate(actor, applicationId, success[0].value.keyId, undefined, 'rotate-key-one'),
      credentials.rotate(actor, applicationId, success[0].value.keyId, undefined, 'rotate-key-two'),
    ]);
    expect(rotations.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.developerCredential.count({ where: { tenantId, revokedAt: null } })).toBe(1);
    const intents = await db.$queryRaw<Array<{ key_hash: string }>>`SELECT key_hash FROM developer_mutation_intents WHERE tenant_id=${tenantId}::uuid`;
    expect(intents.every((row) => /^[0-9a-f]{64}$/.test(row.key_hash))).toBe(true);
    expect(JSON.stringify(intents)).not.toContain(success[0].value.secret);
  });

  it('deduplicates webhook creation and concurrent secret rotations', async () => {
    const input = { applicationId, endpointUrl: 'https://hook.example.test/events', eventTypes: ['order.filled'] };
    const results = await Promise.allSettled([
      webhooks.create(actor, input, 'webhook-create-key'), webhooks.create(actor, input, 'webhook-create-key'),
    ]);
    const success = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof webhooks.create>>> => r.status === 'fulfilled');
    expect(success).toHaveLength(1);
    hookId = success[0].value.subscription.id;
    const rotations = await Promise.allSettled([
      webhooks.rotateSecret(actor, hookId, 'webhook-rotate-one'), webhooks.rotateSecret(actor, hookId, 'webhook-rotate-two'),
    ]);
    const rotated = rotations.filter((r): r is PromiseFulfilledResult<{ secret: string }> => r.status === 'fulfilled');
    expect(rotated).toHaveLength(1);
    expect(await webhooks.secretMatches(hookId, tenantId, rotated[0].value.secret)).toBe(true);
    expect(await webhooks.secretMatches(hookId, tenantId, success[0].value.secret)).toBe(false);
  });

  it('deduplicates eight simultaneous replays and keeps the original event id', async () => {
    await db.developerWebhookDelivery.create({ data: {
      tenantId, subscriptionId: hookId, applicationId, eventId: 'evt-security-test', eventType: 'order.filled', eventVersion: 'v1',
      source: 'test', occurredAt: new Date(), payload: { orderId: 'order-1', status: 'FILLED' }, state: 'FAILED',
      correlationId: 'batch02-test', environment: 'SANDBOX', idempotencyKey: `initial:${tenantId}`,
    } });
    const replay = new WebhookReplayService(db, audit as never, {} as never);
    const results = await Promise.all(Array.from({ length: 8 }, () => replay.replay(actor, hookId, 'evt-security-test', 'same-replay-key')));
    expect(new Set(results.map((r) => r.deliveryId)).size).toBe(1);
    expect(results.every((r) => r.eventId === 'evt-security-test')).toBe(true);
    expect(await db.developerWebhookDelivery.count({ where: { tenantId, replayOfDeliveryId: { not: null } } })).toBe(1);
  });
  it('rolls back an issuance and its intent when auditing fails', async () => {
    const failingAudit = { record: async () => { throw new Error('audit unavailable'); } };
    const isolated = new DeveloperCredentialService(db, failingAudit as never, policy as never, scopes as never, data as never, 'test-hmac');
    const before = await db.developerCredential.count({ where: { tenantId } });
    await expect(isolated.createApiKey(actor, applicationId, { label: 'Must Roll Back' }, 'audit-failure-intent')).rejects.toThrow('audit unavailable');
    expect(await db.developerCredential.count({ where: { tenantId } })).toBe(before);
    expect(await db.$queryRaw`SELECT 1 FROM developer_mutation_intents WHERE tenant_id=${tenantId}::uuid AND operation='credential.create' AND resource=${applicationId}`).toHaveLength(1);
  });

  it('rolls back webhook changes and replay rows when auditing fails, allowing the same intent to retry', async () => {
    const failingAudit = { record: async () => { throw new Error('audit unavailable'); } };
    const failingWebhooks = new WebhookSubscriptionService(db, failingAudit as never, policy as never, data as never, { newSecret: () => 'whsec_test' } as never, 'test-hmac', { encrypt: (value: string) => value } as never);
    const before = await db.developerWebhookSubscription.findUniqueOrThrow({ where: { id: hookId } });
    await expect(failingWebhooks.update(actor, hookId, { description: 'audited change' }, 'audit-update-failure')).rejects.toThrow('audit unavailable');
    expect((await db.developerWebhookSubscription.findUniqueOrThrow({ where: { id: hookId } })).description).toBe(before.description);
    const updated = await webhooks.update(actor, hookId, { description: 'audited change' }, 'audit-update-failure');
    expect(updated.description).toBe('audited change');

    const beforeReplays = await db.developerWebhookDelivery.count({ where: { tenantId, replayOfDeliveryId: { not: null } } });
    const failedReplay = new WebhookReplayService(db, failingAudit as never, {} as never);
    await expect(failedReplay.replay(actor, hookId, 'evt-security-test', 'audit-replay-failure')).rejects.toThrow('audit unavailable');
    expect(await db.developerWebhookDelivery.count({ where: { tenantId, replayOfDeliveryId: { not: null } } })).toBe(beforeReplays);
    const retry = new WebhookReplayService(db, audit, {} as never);
    await expect(retry.replay(actor, hookId, 'evt-security-test', 'audit-replay-failure')).resolves.toEqual(expect.objectContaining({ eventId: 'evt-security-test' }));
    expect(await db.developerWebhookDelivery.count({ where: { tenantId, replayOfDeliveryId: { not: null } } })).toBe(beforeReplays + 1);
  });

  it('serializes concurrent real audit writes and verifies canonical JSON after a database round trip', async () => {
    await Promise.all(Array.from({ length: 8 }, (_, index) => audit.record({
      ...actor, applicationId, action: 'test.concurrent', detail: { z: index, a: { y: 'two', x: 'one' } },
    })));
    const rows = await db.developerAudit.findMany({ where: { tenantId }, orderBy: { sequence: 'asc' } });
    expect(rows.length).toBeGreaterThanOrEqual(13);
    expect(rows.every((row) => row.hashVersion === 2)).toBe(true);
    expect(rows.map((row) => row.sequence)).toEqual(rows.map((_, index) => index + 1));
    expect(await audit.verifyChain(tenantId)).toEqual({ ok: true });
  });

});
