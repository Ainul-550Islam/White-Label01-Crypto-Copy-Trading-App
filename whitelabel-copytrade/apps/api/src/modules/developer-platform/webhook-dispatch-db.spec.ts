/** Opt-in integration tests for a disposable database with forced tenant RLS. */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DeveloperAuditService } from './developer-audit.service';
import { DeveloperPolicyService, type DeveloperPolicyDataPort } from './developer-policy.service';
import { createDeveloperPolicyData } from './developer-policy-data';
import { WebhookSigningService } from './webhook-signing.service';
import { WebhookDeliveryService, type WebhookHttpClient } from './webhook-delivery.service';
import { WebhookDeliveryProcessor } from './webhook-delivery.processor';
import { EventSubscriptionService } from './event-subscription.service';
import { verifyWebhookSignature } from './developer.types';

// Jest's CommonJS runtime cannot load the scheduler's ESM package; calls
// below exercise the real processor directly instead of the timing decorator.
jest.mock('@nestjs/schedule', () => ({ Interval: () => () => undefined }));

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL;
const rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;
(adminUrl && rlsUrl ? describe : describe.skip)('webhook dispatch on PostgreSQL with non-bypass RLS', () => {
  const tenantA = randomUUID(), tenantB = randomUUID(), appA = randomUUID(), appB = randomUUID();
  const subA = randomUUID(), subB = randomUUID();
  const secret = 'whsec_' + 'c'.repeat(64);
  let admin: PrismaService, db: PrismaService, audit: DeveloperAuditService;
  let service: WebhookDeliveryService, events: EventSubscriptionService, processor: WebhookDeliveryProcessor;
  const policy = new DeveloperPolicyService({ get: () => undefined });
  const signing = new WebhookSigningService(policy);
  const planId = randomUUID(), planCode = `dispatch-${planId}`;
  const planLimits = { developer_webhook_subscriptions: 10, developer_webhook_endpoints_per_app: 10, developer_feature_webhooks: true };
  const prior = new Map<string, { relrowsecurity: boolean; relforcerowsecurity: boolean }>();
  const forcedTables = ['tenant_subscriptions', 'tenant_feature_flags', 'developer_applications', 'developer_audit', 'developer_webhook_subscriptions', 'developer_webhook_deliveries'];
  let policyData: DeveloperPolicyDataPort;
  const cipher = { encrypt: (s: string) => `sealed:${s}`, decrypt: (s: string) => s.replace(/^sealed:/, '') };
  let post: jest.MockedFunction<WebhookHttpClient['post']>;

  function client(databaseUrl: string) {
    return new PrismaService({ databaseUrl, isProduction: false, databaseReadEnabled: false } as never, { warn() {}, debug() {}, error() {} } as never);
  }
  async function seed(tenantId: string, applicationId: string, subscriptionId: string) {
    await admin.$executeRaw`INSERT INTO tenants (id, slug, name, updated_at) VALUES (${tenantId}::uuid, ${`dispatch-${tenantId}`}, 'dispatch test', now())`;
    await admin.$executeRaw`INSERT INTO developer_applications (id, tenant_id, name, description, client_id, state, environment, redirect_uris, scopes, natural_key, idempotency_key, created_by_actor_id, updated_at)
      VALUES (${applicationId}::uuid, ${tenantId}::uuid, 'app', '', ${`dev_${randomUUID()}`}, 'ACTIVE', 'SANDBOX', ARRAY['https://example.test'], ARRAY['webhooks:manage'], ${tenantId}, ${tenantId}, 'tester', now())`;
    await admin.developerWebhookSubscription.create({ data: {
      id: subscriptionId, tenantId, applicationId, endpointUrl: 'https://hook.example.test/inbox', eventTypes: ['order.filled'], eventVersion: 'v1', environment: 'SANDBOX', state: 'ACTIVE',
      secretHash: 'not-used-in-dispatch', secretEncrypted: cipher.encrypt(secret), idempotencyKey: `sub:${tenantId}`, createdByActorId: 'tester',
    } });
  }
  async function project(tenantId: string, id = randomUUID()) {
    return events.projectEvent({ tenantId, source: 'execution', eventType: 'order.filled', domainRecordId: id, occurredAt: new Date(), correlationId: 'dispatch-test', payload: { orderId: id, status: 'FILLED' } });
  }
  function makeProcessor(delivery = service, auditService = audit) {
    return new WebhookDeliveryProcessor(db, delivery, policy, policyData, auditService);
  }
  beforeAll(async () => {
    if (!adminUrl || !rlsUrl) throw new Error('both PostgreSQL URLs are required');
    admin = client(adminUrl); db = client(rlsUrl);
    const role = await db.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user`;
    expect(role[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    for (const table of forcedTables) {
      const [flags] = await admin.$queryRawUnsafe<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='${table}'`);
      prior.set(table, flags);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    }
    const tables = await admin.$queryRaw<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('developer_audit', 'developer_webhook_subscriptions', 'developer_webhook_deliveries')`;
    expect(tables).toHaveLength(3);
    expect(tables.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    await seed(tenantA, appA, subA); await seed(tenantB, appB, subB);
    await admin.subscriptionPlan.create({ data: { id: planId, code: planCode, name: 'Dispatch plan', price: '0', limits: planLimits } });
    await admin.tenantSubscription.createMany({ data: [tenantA, tenantB].map((tenantId) => ({ tenantId, planId, status: 'ACTIVE', currentPeriodEnd: new Date('2099-01-01') })) });
    policyData = createDeveloperPolicyData(db);
    audit = new DeveloperAuditService(db);
  });
  beforeEach(async () => {
    await admin.developerWebhookDelivery.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await admin.developerWebhookSubscription.updateMany({ where: { id: { in: [subA, subB] } }, data: { state: 'ACTIVE', revokedAt: null, eventTypes: ['order.filled'], eventVersion: 'v1' } });
    await admin.developerApplication.updateMany({ where: { id: { in: [appA, appB] } }, data: { state: 'ACTIVE', scopes: ['webhooks:manage'] } });
    await admin.subscriptionPlan.update({ where: { id: planId }, data: { limits: planLimits } });
    post = jest.fn().mockResolvedValue({ status: 204 });
    service = new WebhookDeliveryService(db, signing, policy, audit, { post }, cipher);
    events = new EventSubscriptionService(db, service);
    processor = makeProcessor();
  });
  afterAll(async () => {
    if (admin) {
      await admin.$executeRaw`DELETE FROM developer_audit WHERE tenant_id IN (${tenantA}::uuid, ${tenantB}::uuid)`;
      await admin.$executeRaw`DELETE FROM tenants WHERE id IN (${tenantA}::uuid, ${tenantB}::uuid)`;
      await admin.subscriptionPlan.deleteMany({ where: { id: planId } });
      for (const table of forcedTables) {
        const flags = prior.get(table);
        if (flags && !flags.relforcerowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`);
        if (flags && !flags.relrowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
      }
      await admin.$disconnect();
    }
    await db?.$disconnect();
  });

  it('projects within the tenant, sends a signed envelope, and reads only that tenant audit chain', async () => {
    const result = await project(tenantA);
    expect(result.deliveryIds).toHaveLength(1);
    expect(await db.developerWebhookDelivery.count()).toBe(0); // no tenant context
    expect(await db.withTenantRls(tenantB, (tx) => tx.developerWebhookDelivery.count())).toBe(0);
    expect(await processor.processTenantOnce(tenantA)).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
    const [url, headers, body] = post.mock.calls[0];
    expect(url).toBe('https://hook.example.test/inbox');
    const envelope = JSON.parse(body);
    expect(envelope).not.toHaveProperty('tenantId');
    expect(envelope.eventType).toBe('order.filled');
    verifyWebhookSignature({ body, timestamp: Number(headers['X-Webhook-Timestamp']), eventId: envelope.eventId, version: 'v1', signatureHeader: headers['X-Webhook-Signature'], secret, nowSeconds: Number(headers['X-Webhook-Timestamp']) });
    const row = await admin.developerWebhookDelivery.findUniqueOrThrow({ where: { id: result.deliveryIds[0] } });
    expect(row).toMatchObject({ state: 'DELIVERED', attempt: 1, responseStatus: 204 });
    expect((await audit.list(tenantA, {})).rows.map((entry) => entry.action)).toContain('webhook.delivery_attempted');
    expect((await audit.list(tenantB, {})).rows).toHaveLength(0);
    expect(await audit.verifyChain(tenantA)).toEqual({ ok: true });
  });

  it('uses database row locks to prevent two replicas sending the same delivery concurrently', async () => {
    const projected = await project(tenantA);
    let release!: () => void, started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    post.mockImplementation(async () => { started(); await gate; return { status: 200 }; });
    const first = processor.processTenantOnce(tenantA);
    await startedPromise;
    expect(await makeProcessor().processTenantOnce(tenantA)).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
    expect((await admin.developerWebhookDelivery.findUniqueOrThrow({ where: { id: projected.deliveryIds[0] } })).state).toBe('DELIVERED');
  });

  it('honors retry time and pause, then delivers after resumption', async () => {
    const projected = await project(tenantA);
    post.mockResolvedValueOnce({ status: 503 }).mockResolvedValue({ status: 204 });
    expect(await processor.processTenantOnce(tenantA)).toBe(true);
    const first = await admin.developerWebhookDelivery.findUniqueOrThrow({ where: { id: projected.deliveryIds[0] } });
    expect(first.state).toBe('RETRY_SCHEDULED');
    expect(first.nextRetryAt!.getTime()).toBeGreaterThan(Date.now());
    expect(await processor.processTenantOnce(tenantA)).toBe(false);
    await admin.developerWebhookDelivery.update({ where: { id: first.id }, data: { nextRetryAt: new Date(Date.now() - 1_000) } });
    await admin.developerWebhookSubscription.update({ where: { id: subA }, data: { state: 'PAUSED' } });
    expect(await processor.processTenantOnce(tenantA)).toBe(false);
    expect(post).toHaveBeenCalledTimes(1);
    await admin.developerWebhookSubscription.update({ where: { id: subA }, data: { state: 'ACTIVE' } });
    expect(await processor.processTenantOnce(tenantA)).toBe(true);
    expect((await admin.developerWebhookDelivery.findUniqueOrThrow({ where: { id: first.id } })).state).toBe('DELIVERED');
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('cancels revoked endpoints without sending and fails closed for invalid stored payloads', async () => {
    const first = await project(tenantA);
    await admin.developerWebhookSubscription.update({ where: { id: subA }, data: { state: 'REVOKED', revokedAt: new Date() } });
    expect(await processor.processTenantOnce(tenantA)).toBe(true);
    expect((await admin.developerWebhookDelivery.findUniqueOrThrow({ where: { id: first.deliveryIds[0] } })).state).toBe('CANCELLED');
    expect(post).not.toHaveBeenCalled();
    await admin.developerWebhookSubscription.update({ where: { id: subA }, data: { state: 'ACTIVE', revokedAt: null } });
    const invalid = await project(tenantA);
    await admin.developerWebhookDelivery.update({ where: { id: invalid.deliveryIds[0] }, data: { payload: { secret: 'should-never-leave' } } });
    expect(await processor.processTenantOnce(tenantA)).toBe(true);
    expect((await admin.developerWebhookDelivery.findUniqueOrThrow({ where: { id: invalid.deliveryIds[0] } })).state).toBe('FAILED');
    expect(post).not.toHaveBeenCalled();
  });

  it('holds queued deliveries after plan downgrade, application suspension, or scope removal', async () => {
    const projected = await project(tenantA);
    await admin.subscriptionPlan.update({ where: { id: planId }, data: { limits: { ...planLimits, developer_feature_webhooks: false } } });
    expect(await processor.processTenantOnce(tenantA)).toBe(false);
    expect(post).not.toHaveBeenCalled();
    await admin.subscriptionPlan.update({ where: { id: planId }, data: { limits: planLimits } });
    await admin.developerApplication.update({ where: { id: appA }, data: { state: 'SUSPENDED' } });
    expect(await processor.processTenantOnce(tenantA)).toBe(false);
    await admin.developerApplication.update({ where: { id: appA }, data: { state: 'ACTIVE', scopes: [] } });
    expect(await processor.processTenantOnce(tenantA)).toBe(false);
    expect(post).not.toHaveBeenCalled();
    expect((await admin.developerWebhookDelivery.findUniqueOrThrow({ where: { id: projected.deliveryIds[0] } })).state).toBe('QUEUED');
    await admin.developerApplication.update({ where: { id: appA }, data: { scopes: ['webhooks:manage'] } });
    await admin.developerWebhookSubscription.update({ where: { id: subA }, data: { eventTypes: ['payment.succeeded'] } });
    expect(await processor.processTenantOnce(tenantA)).toBe(false);
    expect(post).not.toHaveBeenCalled();
    await admin.developerWebhookSubscription.update({ where: { id: subA }, data: { eventTypes: ['order.filled'] } });
    expect(await processor.processTenantOnce(tenantA)).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('holds the current plan lock while an outbound send is in flight', async () => {
    await project(tenantA);
    let release!: () => void, started!: () => void, writerReady!: () => void, writerPid = 0;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const writerStarted = new Promise<void>((resolve) => { writerReady = resolve; });
    post.mockImplementation(async () => { started(); await gate; return { status: 200 }; });
    const send = processor.processTenantOnce(tenantA);
    await startedPromise;
    const change = admin.$transaction(async (tx) => {
      [{ pid: writerPid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      writerReady();
      await tx.subscriptionPlan.update({ where: { id: planId }, data: { limits: { ...planLimits, developer_feature_webhooks: false } } });
    });
    await writerStarted;
    try {
      let blocked = false;
      for (let i = 0; i < 100 && !blocked; i++) {
        const [state] = await admin.$queryRaw<Array<{ wait_event_type: string | null }>>`SELECT wait_event_type FROM pg_stat_activity WHERE pid=${writerPid}`;
        blocked = state?.wait_event_type === 'Lock';
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
    } finally { release(); await send; await change; }
    const next = await project(tenantA);
    expect(await processor.processTenantOnce(tenantA)).toBe(false);
    expect(post).toHaveBeenCalledTimes(1);
    expect((await admin.developerWebhookDelivery.findUniqueOrThrow({ where: { id: next.deliveryIds[0] } })).state).toBe('QUEUED');
  });

  it('blocks a newly inserted, newer subscription until an in-flight send completes', async () => {
    const alternatePlan = randomUUID(), alternateSub = randomUUID();
    await admin.subscriptionPlan.create({ data: { id: alternatePlan, code: `dnew-${alternatePlan}`, name: 'No webhook grant', price: '0', limits: {} } });
    try {
      await project(tenantA);
      let release!: () => void, started!: () => void, writerReady!: () => void, writerPid = 0;
      const startedPromise = new Promise<void>((resolve) => { started = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const writerStarted = new Promise<void>((resolve) => { writerReady = resolve; });
      post.mockImplementation(async () => { started(); await gate; return { status: 200 }; });
      const send = processor.processTenantOnce(tenantA);
      await startedPromise;
      const change = admin.$transaction(async (tx) => {
        [{ pid: writerPid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        writerReady();
        await tx.tenantSubscription.create({ data: { id: alternateSub, tenantId: tenantA, planId: alternatePlan, status: 'ACTIVE', currentPeriodStart: new Date('2098-01-01'), currentPeriodEnd: new Date('2099-01-01') } });
      });
      await writerStarted;
      try {
        let blocked = false;
        for (let i = 0; i < 100 && !blocked; i++) {
          const [state] = await admin.$queryRaw<Array<{ blocked: number[] }>>`SELECT pg_blocking_pids(${writerPid}::integer) AS blocked`;
          blocked = state.blocked.length > 0;
          if (!blocked) await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(blocked).toBe(true);
      } finally { release(); await send; await change; }
      const next = await project(tenantA);
      expect(await processor.processTenantOnce(tenantA)).toBe(false);
      expect(post).toHaveBeenCalledTimes(1);
      expect((await admin.developerWebhookDelivery.findUniqueOrThrow({ where: { id: next.deliveryIds[0] } })).state).toBe('QUEUED');
    } finally {
      await admin.tenantSubscription.deleteMany({ where: { id: alternateSub } });
      await admin.subscriptionPlan.deleteMany({ where: { id: alternatePlan } });
    }
  });

  it('waits for a competing subscription activation and reads its committed plan before sending', async () => {
    const alternatePlan = randomUUID(), alternateSub = randomUUID();
    await admin.subscriptionPlan.create({ data: { id: alternatePlan, code: `dupdate-${alternatePlan}`, name: 'No webhook grant', price: '0', limits: {} } });
    try {
      await admin.tenantSubscription.create({ data: { id: alternateSub, tenantId: tenantA, planId: alternatePlan, status: 'CANCELED', currentPeriodStart: new Date('2098-01-01'), currentPeriodEnd: new Date('2099-01-01') } });
      const projected = await project(tenantA);
      let release!: () => void, writerReady!: () => void, writerPid = 0;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const writerStarted = new Promise<void>((resolve) => { writerReady = resolve; });
      const change = admin.$transaction(async (tx) => {
        [{ pid: writerPid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        await tx.tenantSubscription.update({ where: { id: alternateSub }, data: { status: 'ACTIVE' } });
        writerReady();
        await gate;
      });
      await writerStarted;
      const send = processor.processTenantOnce(tenantA);
      try {
        let blocked = false;
        for (let i = 0; i < 100 && !blocked; i++) {
          const rows = await admin.$queryRaw<Array<{ waiting: boolean }>>`
            SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${writerPid} = ANY(pg_blocking_pids(pid))) AS waiting`;
          blocked = rows[0].waiting;
          if (!blocked) await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(blocked).toBe(true);
      } finally { release(); await change; }
      expect(await send).toBe(false);
      expect(post).not.toHaveBeenCalled();
      expect((await admin.developerWebhookDelivery.findUniqueOrThrow({ where: { id: projected.deliveryIds[0] } })).state).toBe('QUEUED');
    } finally {
      await admin.tenantSubscription.deleteMany({ where: { id: alternateSub } });
      await admin.subscriptionPlan.deleteMany({ where: { id: alternatePlan } });
    }
  });

  it('serializes scope removal with an in-flight send and holds later deliveries', async () => {
    await project(tenantA);
    let release!: () => void, started!: () => void, writerReady!: () => void, writerPid = 0;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const writerStarted = new Promise<void>((resolve) => { writerReady = resolve; });
    post.mockImplementation(async () => { started(); await gate; return { status: 200 }; });
    const send = processor.processTenantOnce(tenantA);
    await startedPromise;
    const change = admin.$transaction(async (tx) => {
      [{ pid: writerPid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      writerReady();
      await tx.developerApplication.update({ where: { id: appA }, data: { scopes: [] } });
    });
    await writerStarted;
    try {
      let blocked = false;
      for (let i = 0; i < 100 && !blocked; i++) {
        const [state] = await admin.$queryRaw<Array<{ wait_event_type: string | null }>>`SELECT wait_event_type FROM pg_stat_activity WHERE pid=${writerPid}`;
        blocked = state?.wait_event_type === 'Lock';
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
    } finally { release(); await send; await change; }
    const next = await project(tenantA);
    expect(await processor.processTenantOnce(tenantA)).toBe(false);
    expect(post).toHaveBeenCalledTimes(1);
    expect((await admin.developerWebhookDelivery.findUniqueOrThrow({ where: { id: next.deliveryIds[0] } })).state).toBe('QUEUED');
  });

  it('recovers a stale legacy delivery under lock and delivers the next attempt', async () => {
    const projected = await project(tenantA);
    const id = projected.deliveryIds[0];
    await admin.developerWebhookDelivery.update({ where: { id }, data: {
      state: 'DELIVERING', attempt: 1, updatedAt: new Date(Date.now() - 180_000),
    } });
    expect(await processor.processTenantOnce(tenantA)).toBe(true);
    expect(await admin.developerWebhookDelivery.findUniqueOrThrow({ where: { id } })).toMatchObject({ state: 'DELIVERED', attempt: 2 });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('marks an already-exhausted delivery without sending again', async () => {
    const projected = await project(tenantA);
    const id = projected.deliveryIds[0];
    await admin.developerWebhookDelivery.update({ where: { id }, data: { state: 'QUEUED', attempt: 5 } });
    expect(await processor.processTenantOnce(tenantA)).toBe(true);
    expect(await admin.developerWebhookDelivery.findUniqueOrThrow({ where: { id } })).toMatchObject({ state: 'EXHAUSTED', attempt: 5 });
    expect(post).not.toHaveBeenCalled();
    expect((await audit.list(tenantA, {})).rows.map((row) => row.action)).toContain('webhook.delivery_exhausted');
  });

  it('rolls back the state when audit fails and can retry the same stable event id', async () => {
    const projected = await project(tenantA);
    const failingAudit = { record: async () => { throw new Error('audit unavailable'); } } as unknown as DeveloperAuditService;
    const failedService = new WebhookDeliveryService(db, signing, policy, failingAudit, { post }, cipher);
    await expect(makeProcessor(failedService, failingAudit).processTenantOnce(tenantA)).rejects.toThrow('audit unavailable');
    expect((await admin.developerWebhookDelivery.findUniqueOrThrow({ where: { id: projected.deliveryIds[0] } })).state).toBe('QUEUED');
    expect(await processor.processTenantOnce(tenantA)).toBe(true);
    expect(post).toHaveBeenCalledTimes(2);
    expect(JSON.parse(post.mock.calls[0][2]).eventId).toBe(JSON.parse(post.mock.calls[1][2]).eventId);
  });
});
