/** Opt in against a disposable migrated PostgreSQL database. */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { GovernancePolicyService } from './governance-policy.service';
import { GovernanceAuditService } from './governance-audit.service';
import { GovernanceAuditExportService } from './governance-audit-export.service';
import { AuditExportIntentStore } from './audit-export-intent.store';
import { GovernanceActionType } from './governance.types';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL, rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;
(adminUrl && rlsUrl ? describe : describe.skip)('audit export idempotency with forced tenant RLS', () => {
  const tenant = randomUUID(), otherTenant = randomUUID(), operator = randomUUID();
  const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
  let admin: PrismaService, db: PrismaService, audit: GovernanceAuditService, service: GovernanceAuditExportService;
  let prior: { relrowsecurity: boolean; relforcerowsecurity: boolean };
  const input = { tenantId: tenant, operatorId: operator, periodStart: '2020-01-01T00:00:00Z', periodEnd: '2099-01-01T00:00:00Z', correlationId: 'audit-db-export' };
  const client = (databaseUrl: string) => new PrismaService({ databaseUrl, isProduction: false, databaseReadEnabled: false } as never, logger as never);
  beforeAll(async () => {
    admin = client(adminUrl!); db = client(rlsUrl!);
    [prior] = await admin.$queryRaw`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='governance_audits'`;
    await admin.$executeRaw`ALTER TABLE governance_audits ENABLE ROW LEVEL SECURITY`;
    await admin.$executeRaw`ALTER TABLE governance_audits FORCE ROW LEVEL SECURITY`;
    await admin.tenant.createMany({ data: [tenant, otherTenant].map((id) => ({ id, slug: `audit-${id}`, name: 'Audit test' })) });
    const policy = new GovernancePolicyService(new ConfigService()); audit = new GovernanceAuditService(policy, db);
    const intents = new AuditExportIntentStore(db);
    service = new GovernanceAuditExportService(audit, policy, {} as never, intents);
    for (const t of [tenant, otherTenant]) await audit.recordEvent({ tenantId: t, actionType: GovernanceActionType.PRIVACY_REQUEST_CREATE, state: 'CREATED', result: 'SUCCESS', correlationId: `event-${t}`, createdBy: operator, safeEvidence: { password: 'not-for-export', status: 'ok' } });
  });
  afterAll(async () => {
    if (admin) {
      await admin.$executeRaw`DELETE FROM governance_audits WHERE tenant_id IN (${tenant}::uuid,${otherTenant}::uuid)`;
      await admin.tenant.deleteMany({ where: { id: { in: [tenant, otherTenant] } } });
      if (prior && !prior.relforcerowsecurity) await admin.$executeRaw`ALTER TABLE governance_audits NO FORCE ROW LEVEL SECURITY`;
      if (prior && !prior.relrowsecurity) await admin.$executeRaw`ALTER TABLE governance_audits DISABLE ROW LEVEL SECURITY`;
      await admin.$disconnect();
    }
    await db?.$disconnect();
  });
  it('atomically replays concurrent identical intents without another audit event', async () => {
    const [first, second] = await Promise.all([service.exportAuditTrail(input, 'audit-export-key-0001'), service.exportAuditTrail(input, 'audit-export-key-0001')]);
    expect('fileContents' in first && 'fileContents' in second).toBe(true);
    expect(second.id).toBe(first.id);
    if (!('fileContents' in first)) throw new Error('Expected synchronous export');
    expect(first.recordCount).toBe(1);
    expect(first.fileContents).not.toContain('not-for-export');
    expect(first.fileContents).not.toContain(otherTenant);
    await expect(service.exportAuditTrail({ ...input, periodEnd: '2098-01-01T00:00:00Z' }, 'audit-export-key-0001')).rejects.toMatchObject({ status: 409 });
    expect(await admin.governanceAudit.count({ where: { tenantId: tenant, actionType: GovernanceActionType.AUDIT_EXPORT } })).toBe(1);
    const hidden = await db.withTenantRls(otherTenant, (tx) => tx.$queryRaw<Array<{ key_hash: string }>>`SELECT key_hash FROM governance_audit_export_intents WHERE tenant_id=${tenant}::uuid`);
    expect(hidden).toHaveLength(0);
  });
  it('rolls back both audit and intent if recording the export fails', async () => {
    const original = audit.recordEvent.bind(audit);
    const spy = jest.spyOn(audit, 'recordEvent').mockImplementation(async (...args) => {
      await original(...args);
      throw new Error('test audit rollback');
    });
    await expect(service.exportAuditTrail(input, 'audit-export-key-rollback')).rejects.toThrow('test audit rollback');
    spy.mockRestore();
    expect(await admin.governanceAudit.count({ where: { tenantId: tenant, actionType: GovernanceActionType.AUDIT_EXPORT } })).toBe(1);
    const rows = await admin.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM governance_audit_export_intents WHERE tenant_id=${tenant}::uuid`;
    expect(rows[0]?.count).toBe(1n);
    await expect(service.exportAuditTrail(input, 'audit-export-key-rollback')).resolves.toHaveProperty('id');
  });
});
