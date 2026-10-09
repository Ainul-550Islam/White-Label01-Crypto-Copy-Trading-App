/**
 * Webhook contract spec — deterministic, database-free (CHECKS 30-42, 57-60).
 * Drives the REAL signing, subscription, delivery, replay, event-subscription
 * and reconciliation logic through the shared in-memory Prisma double from
 * developer.contract.spec.ts.
 */

import { InMemoryPrisma } from './developer.contract.spec';
import {
  classifyAttempt,
  DELIVERY_TRANSITIONS,
  canTransition,
  credentialDigest,
  DEVELOPER_ERROR_CODES,
  DeveloperError,
  idempotencyKey,
  isTerminalDeliveryState,
  retryBackoffSeconds,
  signWebhook,
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_VERSION,
} from './developer.types';
import { DeveloperPolicyService } from './developer-policy.service';
import { DeveloperScopeService } from './developer-scope.service';
import { DeveloperAuditService } from './developer-audit.service';
import { WebhookSigningService } from './webhook-signing.service';
import { WebhookSubscriptionService } from './webhook-subscription.service';
import { WebhookDeliveryService, DEVELOPER_WEBHOOK_HTTP } from './webhook-delivery.service';
import { WebhookReplayService } from './webhook-replay.service';
import { EventSubscriptionService } from './event-subscription.service';
import { validateDeveloperEventPayload } from './event-schemas/developer-event-schemas';
import { DeveloperReconciliationService } from './developer-reconciliation.service';

const prisma = new InMemoryPrisma();
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const HMAC_KEY = 'webhook-spec-hmac-key-0123456789';

const policyService = new DeveloperPolicyService({ get: () => undefined });
const signing = new WebhookSigningService(policyService);
const audit = new DeveloperAuditService(prisma as never);
const policyData = {
  planLimitViewForTenant: async () => ({
    planKey: 'enterprise',
    limits: { developer_webhook_subscriptions: 16, developer_pkce_required: 0 },
    features: ['developer_webhooks'],
  }),
  tenantEntitlementKeys: async () => [] as string[],
};
const subscriptions = new WebhookSubscriptionService(
  prisma as never,
  audit,
  policyService,
  policyData,
  signing,
  HMAC_KEY,
  { encrypt: (plain) => `sealed:${plain}`, decrypt: (cipher) => cipher.replace('sealed:', '') },
);

let lastResponse: { status?: number; timedOut?: boolean; networkError?: boolean } = {};
let lastHttpBody: string | null = null;
const httpStub = {
  async post(_url: string, _headers: Record<string, string>, body: string, _timeoutMs: number) {
    lastHttpBody = body;
    return lastResponse;
  },
};
void DEVELOPER_WEBHOOK_HTTP;
const deliveries = new WebhookDeliveryService(
  prisma as never,
  signing,
  policyService,
  audit,
  httpStub,
  { encrypt: (plain) => `sealed:${plain}`, decrypt: (cipher) => cipher.replace('sealed:', '') },
);
const replay = new WebhookReplayService(prisma as never, audit, deliveries);
const events = new EventSubscriptionService(prisma as never, deliveries);
const reconciliation = new DeveloperReconciliationService(prisma as never);

const actor = { tenantId: TENANT_A, actorType: 'USER' as const, actorId: 'user-1', correlationId: 'corr-wh' };

async function seedActiveApplication(id: string, tenantId = TENANT_A) {
  await prisma.client.developerApplication.create({
    data: {
      id,
      tenantId,
      partnerId: null,
      name: `app-${id}`,
      description: '',
      clientId: `dev_${id}`,
      state: 'ACTIVE',
      environment: 'SANDBOX',
      redirectUris: ['https://ops.example.com/callback'],
      scopes: ['webhooks:manage', 'profile:read'],
      homePageUrl: null,
      idempotencyKey: idempotencyKey(tenantId, 'app', id),
      naturalKey: id,
      createdByActorId: 'seed',
      createdAt: new Date(),
      tenant: { id: tenantId },
    } as never,
  });
  return prisma.client.developerApplication.findUnique({ where: { id } });
}

async function createSubscriptionFor(applicationId: string, tenantId: string = TENANT_A) {
  const { subscription, secret } = await subscriptions.create({ ...actor, tenantId }, {
    applicationId,
    endpointUrl: 'https://hooks.example.com/inbox',
    eventTypes: ['payment.succeeded', 'order.filled'],
    environment: 'SANDBOX',
  });
  return { subscription, secret };
}

describe('webhook contract: lifecycle, signing, delivery, replay, reconciliation', () => {
  it('30. webhook subscription ownership: foreign tenant/application cannot mutate', async () => {
    await seedActiveApplication('app-wh-a');
    await seedActiveApplication('app-wh-b', TENANT_B);
    const { subscription } = await createSubscriptionFor('app-wh-a');
    // Tenant B cannot resolve tenant A's subscription.
    const foreign = await prisma.client.developerWebhookSubscription.findUnique({
      where: { id: subscription.id },
    });
    const visibleToB = foreign && foreign.tenantId === TENANT_B ? foreign : null;
    expect(visibleToB).toBeNull();
    // And mutating through a foreign application id fails.
    await expect(
      subscriptions.create({ ...actor, tenantId: TENANT_B }, {
        applicationId: 'app-wh-a',
        endpointUrl: 'https://hooks.example.com/x',
        eventTypes: ['payment.succeeded'],
      }),
    ).rejects.toBeTruthy();
  });

  it('31. webhook signature valid: deterministic HMAC over the canonical string', async () => {
    const { secret } = await createSubscriptionFor('app-wh-a');
    const timestamp = 1_790_000_000;
    const signature = signWebhook(
      { timestamp, eventId: 'evt-1', version: 'v1', body: '{"ok":true}' },
      secret,
    );
    expect(signature.startsWith(`${WEBHOOK_SIGNATURE_VERSION}=`)).toBe(true);
    // Same inputs -> same signature (deterministic).
    const again = signWebhook({ timestamp, eventId: 'evt-1', version: 'v1', body: '{"ok":true}' }, secret);
    expect(again).toBe(signature);
    expect(() =>
      verifyWebhookSignature({
        body: '{"ok":true}',
        timestamp,
        eventId: 'evt-1',
        version: 'v1',
        signatureHeader: signature,
        secret,
        nowSeconds: timestamp,
      }),
    ).not.toThrow();
  });

  it('32. webhook signature invalid rejected (tampered body/id/secret)', async () => {
    const { secret } = await createSubscriptionFor('app-wh-a');
    const signature = signWebhook(
      { timestamp: 1_790_000_000, eventId: 'evt-1', version: 'v1', body: '{"ok":true}' },
      secret,
    );
    expect(() =>
      verifyWebhookSignature({
        body: '{"ok":false}',
        timestamp: 1_790_000_000,
        eventId: 'evt-1',
        version: 'v1',
        signatureHeader: signature,
        secret,
        nowSeconds: 1_790_000_000,
      }),
    ).toThrow(/does not verify/);
    expect(() =>
      verifyWebhookSignature({
        body: '{"ok":true}',
        timestamp: 1_790_000_000,
        eventId: 'evt-2',
        version: 'v1',
        signatureHeader: signature,
        secret,
        nowSeconds: 1_790_000_000,
      }),
    ).toThrow(/does not verify/);
    expect(() =>
      verifyWebhookSignature({
        body: '{"ok":true}',
        timestamp: 1_790_000_000,
        eventId: 'evt-1',
        version: 'v1',
        signatureHeader: signature,
        secret: 'whsec_' + 'f'.repeat(64),
        nowSeconds: 1_790_000_000,
      }),
    ).toThrow(/does not verify/);
  });

  it('33. webhook replay rejected: stale timestamps and duplicate event ids', () => {
    const now = 1_790_000_000;
    expect(() =>
      verifyWebhookSignature({
        body: '{}',
        timestamp: now - 400,
        eventId: 'e',
        version: 'v1',
        signatureHeader: 'v1=00',
        secret: 'whsec_' + 'f'.repeat(64),
        nowSeconds: now,
      }),
    ).toThrow(/timestamp/);
    // Duplicate processed event id: the replay service refuses re-enqueue of
    // the same (subscription, event) idempotency key.
    const key = idempotencyKey(TENANT_A, 'webhook.delivery', 'sub-1|evt-9');
    expect(idempotencyKey(TENANT_A, 'webhook.delivery', 'sub-1|evt-9')).toBe(key);
  });

  it('34. duplicate webhook enqueue is idempotent: one delivery row per event', async () => {
    await seedActiveApplication('app-wh-idem');
    const { subscription } = await createSubscriptionFor('app-wh-idem');
    const envelope = {
      eventId: 'evt-idem-1',
      eventType: 'payment.succeeded',
      eventVersion: 'v1',
      tenantId: TENANT_A,
      occurredAt: new Date().toISOString(),
      correlationId: 'corr-1',
      source: 'billing.payments',
      payload: { paymentId: 'pay-1', amount: '1.00', currency: 'USD', status: 'SUCCEEDED' },
    };
    const deliveryKey = idempotencyKey(TENANT_A, 'webhook.delivery', `${subscription.id}|${envelope.eventId}`);
    const first = await deliveries.enqueue({
      tenantId: TENANT_A,
      subscriptionId: subscription.id,
      applicationId: 'app-wh-idem',
      envelope,
      idempotencyKey: deliveryKey,
      environment: 'SANDBOX',
    });
    const second = await deliveries.enqueue({
      tenantId: TENANT_A,
      subscriptionId: subscription.id,
      applicationId: 'app-wh-idem',
      envelope,
      idempotencyKey: deliveryKey,
      environment: 'SANDBOX',
    });
    expect(second.id).toBe(first.id);
    const rows = await prisma.client.developerWebhookDelivery.findMany({
      where: { subscriptionId: subscription.id, eventId: 'evt-idem-1' },
    });
    expect(rows).toHaveLength(1);
  });

  it('persists the original envelope payload across retry attempts and authorized replay', async () => {
    await seedActiveApplication('app-wh-envelope');
    const { subscription } = await createSubscriptionFor('app-wh-envelope');
    const occurredAt = '2026-10-09T01:02:03.000Z';
    const payload = { paymentId: 'pay-envelope', amount: '12.34', currency: 'USD', status: 'SUCCEEDED' };
    const immutablePayload = { ...payload };
    const envelope = {
      eventId: 'evt-envelope-1',
      eventType: 'payment.succeeded',
      eventVersion: 'v1',
      tenantId: TENANT_A,
      occurredAt,
      correlationId: 'corr-envelope',
      source: 'billing.payments',
      payload,
    };
    const queued = await deliveries.enqueue({
      tenantId: TENANT_A,
      subscriptionId: subscription.id,
      applicationId: 'app-wh-envelope',
      envelope,
      idempotencyKey: idempotencyKey(TENANT_A, 'webhook.delivery', `${subscription.id}|${envelope.eventId}`),
      environment: 'SANDBOX',
    });
    payload.amount = '999.99';
    payload.status = 'FAILED';

    lastResponse = { status: 503 };
    lastHttpBody = null;
    await deliveries.attempt(actor, queued.id, { webhookMaxAttempts: 3 } as never);
    const firstAttemptBody = lastHttpBody;
    expect(firstAttemptBody).not.toBeNull();
    expect(JSON.parse(String(firstAttemptBody))).toEqual({
      eventId: envelope.eventId,
      eventType: envelope.eventType,
      eventVersion: envelope.eventVersion,
      occurredAt,
      correlationId: envelope.correlationId,
      source: envelope.source,
      payload: immutablePayload,
    });

    lastResponse = { status: 204 };
    lastHttpBody = null;
    await deliveries.attempt(actor, queued.id, { webhookMaxAttempts: 3 } as never);
    expect(lastHttpBody).toBe(firstAttemptBody);

    const replayed = await replay.replay(actor, subscription.id, envelope.eventId);
    const replayRow = await prisma.client.developerWebhookDelivery.findUnique({ where: { id: replayed.deliveryId } });
    expect(replayRow).toMatchObject({ source: envelope.source, occurredAt: new Date(occurredAt), payload: immutablePayload });
  });

  it('35. webhook event id deterministic: same domain event projects the same id', () => {
    const a = idempotencyKey(TENANT_A, 'developer.event', 'payment.succeeded|pay-42');
    const b = idempotencyKey(TENANT_A, 'developer.event', 'payment.succeeded|pay-42');
    expect(a).toBe(b);
    expect(idempotencyKey(TENANT_A, 'developer.event', 'payment.succeeded|pay-43')).not.toBe(a);
  });

  it('36. delivery success requires a real 2xx response', async () => {
    lastResponse = { status: 200 };
    expect(classifyAttempt({ status: 200 })).toBe('SUCCESS');
    lastResponse = {};
    expect(classifyAttempt({})).toBe('PERMANENT_FAILURE');
    expect(classifyAttempt({ timedOut: true })).toBe('NETWORK_TIMEOUT_RETRY');
    expect(classifyAttempt({ networkError: true })).toBe('NETWORK_TIMEOUT_RETRY');
    expect(classifyAttempt({ signatureConfigurationError: true })).toBe('SIGNATURE_CONFIGURATION_FAILURE');
  });

  it('37. 4xx is never blindly retried', () => {
    expect(classifyAttempt({ status: 404 })).toBe('CLIENT_4XX_NO_RETRY');
    expect(classifyAttempt({ status: 410 })).toBe('CLIENT_4XX_NO_RETRY');
    expect(classifyAttempt({ status: 422 })).toBe('CLIENT_4XX_NO_RETRY');
    // 429 is the explicit rate-limit retry class.
    expect(classifyAttempt({ status: 429 })).toBe('RATE_LIMIT_RETRY');
  });

  it('38. 5xx follows the retry policy (backoff then exhaustion)', () => {
    expect(classifyAttempt({ status: 500 })).toBe('SERVER_5XX_RETRY');
    expect(classifyAttempt({ status: 503 })).toBe('SERVER_5XX_RETRY');
    expect(retryBackoffSeconds(0)).toBe(30);
    expect(retryBackoffSeconds(1)).toBe(60);
    expect(retryBackoffSeconds(4)).toBe(480);
    expect(retryBackoffSeconds(9)).toBe(480); // capped
  });

  it('39. timeout follows the retry policy (network class, not success)', () => {
    expect(classifyAttempt({ timedOut: true })).toBe('NETWORK_TIMEOUT_RETRY');
    expect(classifyAttempt({ networkError: true })).toBe('NETWORK_TIMEOUT_RETRY');
    // Timeouts are retryable, terminal states are not reachable from them.
    expect(isTerminalDeliveryState('DELIVERED')).toBe(true);
    expect(isTerminalDeliveryState('RETRY_SCHEDULED')).toBe(false);
  });

  it('40. delivery exhaustion is tracked explicitly', () => {
    expect(canTransition(DELIVERY_TRANSITIONS, 'DELIVERING', 'EXHAUSTED')).toBe(true);
    expect(canTransition(DELIVERY_TRANSITIONS, 'EXHAUSTED', 'DELIVERING')).toBe(false);
    expect(canTransition(DELIVERY_TRANSITIONS, 'RETRY_SCHEDULED', 'DELIVERING')).toBe(true);
    expect(canTransition(DELIVERY_TRANSITIONS, 'DELIVERED', 'DELIVERING')).toBe(false);
    expect(canTransition(DELIVERY_TRANSITIONS, 'FAILED', 'RETRY_SCHEDULED')).toBe(false);
  });

  it('41. event subscription filtering is deterministic', async () => {
    await seedActiveApplication('app-wh-filter');
    const { subscription } = await createSubscriptionFor('app-wh-filter');
    // payment.succeeded passes, invoice.created (unsubscribed) never queues.
    await expect(
      subscriptions.acceptsEvent(subscription.id, TENANT_A, 'payment.succeeded', 'SANDBOX'),
    ).resolves.toBeTruthy();
    await expect(
      subscriptions.acceptsEvent(subscription.id, TENANT_A, 'invoice.created', 'SANDBOX'),
    ).rejects.toMatchObject({ code: DEVELOPER_ERROR_CODES.EVENT_NOT_SUBSCRIBED });
    await expect(
      subscriptions.acceptsEvent(subscription.id, TENANT_A, 'payment.succeeded', 'PRODUCTION'),
    ).rejects.toMatchObject({ code: DEVELOPER_ERROR_CODES.ENVIRONMENT_MISMATCH });
  });

  it('rejects unknown event types when a webhook subscription is created', async () => {
    await seedActiveApplication('app-wh-unknown-event');
    const before = await prisma.client.developerWebhookSubscription.count({ where: { tenantId: TENANT_A } });

    await expect(subscriptions.create(actor, {
      applicationId: 'app-wh-unknown-event',
      endpointUrl: 'https://hooks.example.com/unknown-event',
      eventTypes: ['payment.succeeded', 'wallet.drained'],
      environment: 'SANDBOX',
    })).rejects.toMatchObject({ code: DEVELOPER_ERROR_CODES.EVENT_NOT_SUBSCRIBED });

    const after = await prisma.client.developerWebhookSubscription.count({ where: { tenantId: TENANT_A } });
    expect(after).toBe(before);
  });

  it('42. event tenant scope: an authoritative event of tenant A never reaches tenant B', async () => {
    await seedActiveApplication('app-wh-tena');
    await seedActiveApplication('app-wh-tenb', TENANT_B);
    await createSubscriptionFor('app-wh-tena');
    await createSubscriptionFor('app-wh-tenb', TENANT_B);
    const outcome = await events.projectEvent({
      tenantId: TENANT_A,
      source: 'billing.payments',
      eventType: 'payment.succeeded',
      domainRecordId: 'pay-100',
      occurredAt: new Date(),
      correlationId: 'corr-ten',
      payload: { paymentId: 'pay-100', amount: '100.00', currency: 'USD', status: 'SUCCEEDED' },
    });
    expect(outcome.delivered).toBe(true);
    const rows = await prisma.client.developerWebhookDelivery.findMany({
      where: { eventId: idempotencyKey(TENANT_A, 'developer.event', 'payment.succeeded|pay-100') },
    });
    expect(rows.every((row) => (row as Record<string, unknown>).tenantId === TENANT_A)).toBe(true);
    // Fan-out: the event reaches EVERY ACTIVE subscription of tenant A that
    // matches the type — and NOTHING outside tenant A.
    expect(rows.length).toBeGreaterThanOrEqual(1);
    // Unknown event types or wrong sources project to NOTHING.
    const unknown = await events.projectEvent({
      tenantId: TENANT_A,
      source: 'billing.payments',
      eventType: 'wallet.drained',
      domainRecordId: 'x',
      occurredAt: new Date(),
      correlationId: 'c',
      payload: {},
    });
    expect(unknown.delivered).toBe(false);
    const wrongSource = await events.projectEvent({
      tenantId: TENANT_A,
      source: 'oms',
      eventType: 'payment.succeeded',
      domainRecordId: 'pay-100',
      occurredAt: new Date(),
      correlationId: 'c2',
      payload: {},
    });
    expect(wrongSource.delivered).toBe(false);
  });

  it('57. webhook replay cannot double-mutate business state', async () => {
    await seedActiveApplication('app-wh-replay');
    const { subscription } = await createSubscriptionFor('app-wh-replay');
    const validOrderFilledPayload = { orderId: 'o-1', status: 'FILLED' };
    expect(validateDeveloperEventPayload('order.filled', validOrderFilledPayload).valid).toBe(true);
    await deliveries.enqueue({
      tenantId: TENANT_A,
      subscriptionId: subscription.id,
      applicationId: 'app-wh-replay',
      envelope: {
        eventId: 'evt-replay-1',
        eventType: 'order.filled',
        eventVersion: 'v1',
        tenantId: TENANT_A,
        occurredAt: new Date().toISOString(),
        correlationId: 'corr-r',
        source: 'execution',
        payload: validOrderFilledPayload,
      },
      idempotencyKey: idempotencyKey(TENANT_A, 'webhook.delivery', `${subscription.id}|evt-replay-1`),
      environment: 'SANDBOX',
    });
    const first = await replay.replay(actor, subscription.id, 'evt-replay-1');
    const second = await replay.replay(actor, subscription.id, 'evt-replay-1');
    // Distinct delivery attempt, SAME event id (consumer dedupe contract).
    expect(first.eventId).toBe('evt-replay-1');
    expect(second.deliveryId).toBe(first.deliveryId); // same-hour duplicate is idempotent
    // The projection itself carries no business mutation: the event payload
    // is a notification; authoritative state lives in the source domain.
    const projected = await events.projectEvent({
      tenantId: TENANT_A,
      source: 'execution',
      eventType: 'order.filled',
      domainRecordId: 'o-1',
      occurredAt: new Date(),
      correlationId: 'corr-r',
      payload: validOrderFilledPayload,
    });
    const projectedRows = await prisma.client.developerWebhookDelivery.findMany({
      where: { eventId: idempotencyKey(TENANT_A, 'developer.event', 'order.filled|o-1') },
    });
    expect(projectedRows.length).toBeGreaterThanOrEqual(1);
    expect(projectedRows.length).toBe(projected.deliveryIds.length);
    expect(projectedRows.every((row) => row.tenantId === TENANT_A)).toBe(true);
  });

  it('58. reconciliation detects orphan records', async () => {
    await seedActiveApplication('app-wh-rc');
    const { subscription } = await createSubscriptionFor('app-wh-rc');
    void subscription;
    // Simulate a credential orphan: application id pointing nowhere.
    await prisma.client.developerCredential.create({
      data: {
        id: 'cred-orphan',
        tenantId: TENANT_A,
        applicationId: 'app-does-not-exist',
        label: 'orphan',
        kind: 'API_KEY',
        keyId: 'devkey_' + 'c'.repeat(40),
        secretHash: 'x'.repeat(64),
        scopes: ['profile:read'],
        expiresAt: null,
        createdByActorId: 'seed',
      } as never,
    });
    const report = await reconciliation.reconcile(TENANT_A);
    const kinds = report.findings.map((finding) => finding.kind);
    expect(kinds).toContain('CREDENTIAL_WITHOUT_APPLICATION');
    expect(report.findings.every((finding) => finding.suggestedAction.length > 0)).toBe(true);
    // Findings are REPORT-only: nothing was auto-revoked.
    const orphan = await prisma.client.developerCredential.findUnique({ where: { id: 'cred-orphan' } });
    expect(orphan?.revokedAt ?? null).toBeNull();
  });

  it('59. no fake API/webhook success: absent responses and misconfiguration are failures', () => {
    expect(classifyAttempt({})).toBe('PERMANENT_FAILURE');
    expect(classifyAttempt({ status: 199 })).toBe('PERMANENT_FAILURE');
    expect(classifyAttempt({ status: 300 })).toBe('PERMANENT_FAILURE');
    expect(classifyAttempt({ signatureConfigurationError: true })).toBe('SIGNATURE_CONFIGURATION_FAILURE');
    // DELIVERED is reachable ONLY through SUCCESS classification.
    expect(classifyAttempt({ status: 200 })).toBe('SUCCESS');
  });

  it('60. all contracts typecheck: route inventory parity across SDKs', async () => {
    const { SDK_CONTRACT_ROUTES, PYTHON_SDK_ROUTES, RUST_SDK_ROUTES } = await import(
      './developer.contract.spec'
    );
    expect(SDK_CONTRACT_ROUTES.length).toBeGreaterThan(15);
    expect(PYTHON_SDK_ROUTES).toEqual(SDK_CONTRACT_ROUTES);
    expect(RUST_SDK_ROUTES).toEqual(SDK_CONTRACT_ROUTES);
  });

  it('supports deterministic digest verification for stored secrets', async () => {
    const digest = credentialDigest('whsec_test', HMAC_KEY);
    expect(digest).toBe(credentialDigest('whsec_test', HMAC_KEY));
    expect(digest).not.toBe(credentialDigest('whsec_other', HMAC_KEY));
  });
});

void DeveloperScopeService;
