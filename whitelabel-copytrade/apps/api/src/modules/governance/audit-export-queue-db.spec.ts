/** Opt in only against disposable migrated PostgreSQL and Redis instances. */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { QUEUE_NAMES } from '@wlct/config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { GovernanceAuditExportProcessor } from '../audit/governance-audit-export.processor';
import { AuditExportIntentStore } from './audit-export-intent.store';
import { GovernanceAuditExportService, type AuditExportQueued, type AuditExportJobPayload } from './governance-audit-export.service';
import { GovernanceAuditService } from './governance-audit.service';
import { GovernancePolicyService } from './governance-policy.service';
import { GovernanceActionType } from './governance.types';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL, rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;
const redis = process.env.BATCH02_TEST_REDIS;
(adminUrl && rlsUrl && redis ? describe : describe.skip)('durable queued audit exports with PostgreSQL, RLS and Redis', () => {
  jest.setTimeout(60_000);
  const tenant = randomUUID(), otherTenant = randomUUID(), operator = randomUUID();
  const logger = { info() {}, warn() {}, debug() {}, error() {} };
  const client = (url: string) => new PrismaService({ databaseUrl: url, isProduction: false, databaseReadEnabled: false } as never, logger as never);
  const connection = { host: '127.0.0.1', port: Number(redis), maxRetriesPerRequest: null };
  const prefix = `audit-test-${randomUUID()}`;
  let admin: PrismaService, db: PrismaService, intents: AuditExportIntentStore, audit: GovernanceAuditService, service: GovernanceAuditExportService;
  let queue: Queue, events: QueueEvents, worker: Worker;
  let failNextEnqueue = false;
  let prior: { relrowsecurity: boolean; relforcerowsecurity: boolean };
  const input = { tenantId: tenant, operatorId: operator, periodStart: '2020-01-01T00:00:00Z', periodEnd: '2099-01-01T00:00:00Z', correlationId: 'queue-export-1' };
  const queued = (value: unknown): AuditExportQueued => {
    if (!value || typeof value !== 'object' || (value as AuditExportQueued).status !== 'QUEUED') throw new Error('Expected a queued export');
    return value as AuditExportQueued;
  };
  beforeAll(async () => {
    admin = client(adminUrl!); db = client(rlsUrl!);
    [prior] = await admin.$queryRaw`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='governance_audits'`;
    await admin.$executeRaw`ALTER TABLE governance_audits ENABLE ROW LEVEL SECURITY`;
    await admin.$executeRaw`ALTER TABLE governance_audits FORCE ROW LEVEL SECURITY`;
    await admin.tenant.createMany({ data: [tenant, otherTenant].map((id) => ({ id, slug: `audit-queue-${id}`, name: 'Queue test' })) });
    await admin.governanceAudit.createMany({ data: Array.from({ length: 2001 }, (_, index) => ({ id: randomUUID(), tenantId: tenant,
      actionType: GovernanceActionType.PRIVACY_REQUEST_CREATE, state: 'CREATED', result: 'SUCCESS', correlationId: `fixture-${index}`,
      createdBy: operator, createdAt: new Date(), safeEvidence: { status: 'ok' } })) });
    const policy = new GovernancePolicyService(new ConfigService()); audit = new GovernanceAuditService(policy, db);
    intents = new AuditExportIntentStore(db);
    queue = new Queue(QUEUE_NAMES.AUDIT, { connection, prefix });
    events = new QueueEvents(QUEUE_NAMES.AUDIT, { connection, prefix }); await events.waitUntilReady();
    const queues = {
      getQueue: () => queue,
      enqueueOrThrow: async (_name: string, name: string, payload: AuditExportJobPayload, options: object) => {
        // The Redis boundary must never see an uncommitted or missing intent.
        expect(await intents.findQueued(payload.tenantId, payload.jobId!)).toMatchObject({ response: { id: payload.jobId }, jobPayload: { jobId: payload.jobId } });
        if (failNextEnqueue) { failNextEnqueue = false; throw new Error('transient Redis failure'); }
        const job = await queue.add(name, payload, options); return job.id!;
      },
    };
    service = new GovernanceAuditExportService(audit, policy, queues as never, intents);
    const processor = new GovernanceAuditExportProcessor(service, { queueRunInlineWorkers: true } as never);
    worker = new Worker(QUEUE_NAMES.AUDIT, (job) => processor.process(job), { connection, prefix, concurrency: 2 });
    await worker.waitUntilReady();
  });
  afterAll(async () => {
    await worker?.close(); await events?.close();
    if (queue) { await queue.obliterate({ force: true }); await queue.close(); }
    if (admin) {
      await admin.$executeRaw`DELETE FROM governance_audits WHERE tenant_id IN (${tenant}::uuid,${otherTenant}::uuid)`;
      await admin.tenant.deleteMany({ where: { id: { in: [tenant, otherTenant] } } });
      if (prior && !prior.relforcerowsecurity) await admin.$executeRaw`ALTER TABLE governance_audits NO FORCE ROW LEVEL SECURITY`;
      if (prior && !prior.relrowsecurity) await admin.$executeRaw`ALTER TABLE governance_audits DISABLE ROW LEVEL SECURITY`;
      await admin.$disconnect();
    }
    await db?.$disconnect();
  });
  it('commits before enqueue, deduplicates concurrent requests and retains completed results after Redis eviction', async () => {
    const [a, b] = await Promise.all([service.exportAuditTrail(input, 'queued-audit-key-01'), service.exportAuditTrail(input, 'queued-audit-key-01')]);
    const first = queued(a), second = queued(b);
    expect(second.id).toBe(first.id);
    const job = await queue.getJob(first.id); expect(job).toBeDefined();
    const result = await job!.waitUntilFinished(events, 45_000);
    expect(result).toMatchObject({ tenantId: tenant, recordCount: 2001 });
    await expect(service.getJob(otherTenant, first.id)).rejects.toThrow('not found');
    expect(await admin.governanceAudit.count({ where: { tenantId: tenant, actionType: GovernanceActionType.AUDIT_EXPORT } })).toBe(1);
    await job!.remove();
    await expect(service.getJob(tenant, first.id)).resolves.toMatchObject({ state: 'completed', result: { tenantId: tenant, recordCount: 2001 } });
    expect(queued(await service.exportAuditTrail(input, 'queued-audit-key-01')).id).toBe(first.id);
    expect(await queue.getJob(first.id)).toBeUndefined();
  });
  it('relays an intent after enqueue failure and retries a rolled-back worker transaction', async () => {
    const request = { ...input, correlationId: 'queue-export-recovery' };
    failNextEnqueue = true;
    await expect(service.exportAuditTrail(request, 'queued-audit-key-02')).rejects.toThrow('queue is unavailable');
    const pending = await intents.pending(tenant, 20); expect(pending).toHaveLength(1);
    const original = audit.recordEvent.bind(audit);
    let fail = true;
    const spy = jest.spyOn(audit, 'recordEvent').mockImplementation(async (...args) => {
      if (fail && args[0].actionType === GovernanceActionType.AUDIT_EXPORT) { fail = false; throw new Error('temporary audit write failure'); }
      return original(...args);
    });
    try {
      await service.relayPendingExports();
      const job = await queue.getJob(pending[0].response.id); expect(job).toBeDefined();
      const result = await job!.waitUntilFinished(events, 45_000);
      expect(result).toMatchObject({ tenantId: tenant, recordCount: 2002 });
      expect((await queue.getJob(job!.id!))!.attemptsMade).toBeGreaterThanOrEqual(1);
      expect(await admin.governanceAudit.count({ where: { tenantId: tenant, actionType: GovernanceActionType.AUDIT_EXPORT } })).toBe(2);
    } finally { spy.mockRestore(); }
  });
  it('uses a new job identity when an expired request key is reused', async () => {
    const request = { ...input, correlationId: 'queue-export-expiry' }, key = 'queued-audit-key-03';
    const first = queued(await service.exportAuditTrail(request, key));
    const originalJob = await queue.getJob(first.id); expect(originalJob).toBeDefined();
    await originalJob!.waitUntilFinished(events, 45_000);
    const oldPayload = originalJob!.data as AuditExportJobPayload;
    await admin.$executeRaw`UPDATE governance_audit_export_intents SET expires_at=CURRENT_TIMESTAMP-interval '1 second' WHERE tenant_id=${tenant}::uuid AND response->>'id'=${first.id}`;
    const next = queued(await service.exportAuditTrail(request, key));
    expect(next.id).not.toBe(first.id);
    await expect(service.processQueuedExport(oldPayload)).rejects.toThrow('not found');
    await (await queue.getJob(next.id))!.waitUntilFinished(events, 45_000);
  });
});
