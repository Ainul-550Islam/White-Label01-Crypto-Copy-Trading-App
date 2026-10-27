import { randomUUID } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { FundingRequestService } from './funding-request.service';
import { AccountRestrictionService } from './account-restriction.service';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL, rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;
(adminUrl && rlsUrl ? describe : describe.skip)('funding mutation idempotency under PostgreSQL RLS', () => {
  const tenant = randomUUID(), accountId = randomUUID();
  const tables = ['funding_requests', 'outbox_events', 'institutional_accounts', 'account_restrictions', 'client_lifecycle_audits'];
  const prior = new Map<string, { relrowsecurity: boolean; relforcerowsecurity: boolean }>();
  const client = (url: string) => new PrismaService({ databaseUrl: url, isProduction: false, databaseReadEnabled: false } as never, { warn() {}, debug() {}, error() {}, info() {} } as never);
  let admin: PrismaService, db: PrismaService, service: FundingRequestService;
  const audit = { log: jest.fn(async () => undefined) };
  beforeAll(async () => {
    admin = client(adminUrl!); db = client(rlsUrl!);
    for (const table of tables) {
      const [state] = await admin.$queryRawUnsafe<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='${table}'`);
      prior.set(table, state);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    }
    await admin.tenant.create({ data: { id: tenant, slug: `funding-${tenant}`, name: 'Funding idempotency test' } });
    await admin.institutionalAccount.create({ data: { id: accountId, tenantId: tenant, state: 'ACTIVE', isFundingEnabled: true, idempotencyKey: `account-${accountId}` } });
    const policy = { resolvePolicy: async () => ({ fundingControls: { allowedCurrencies: ['USD'], requireExternalReference: false } }) };
    const restriction = new AccountRestrictionService(db, audit as never);
    service = new FundingRequestService(db, policy as never, audit as never, restriction, new OutboxService());
  });
  afterAll(async () => {
    if (!admin) return;
    await admin.outboxEvent.deleteMany({ where: { tenantId: tenant } });
    await admin.tenant.deleteMany({ where: { id: tenant } });
    for (const table of tables) {
      const state = prior.get(table);
      if (state && !state.relforcerowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`);
      if (state && !state.relrowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
    }
    await db.$disconnect(); await admin.$disconnect();
  });
  it('returns one row and event for concurrent retries and rejects changed intent', async () => {
    const input = { tenantId: tenant, accountId, requestedAmount: '123.00000001', currency: 'USD', idempotencyKey: 'funding-retry-key' };
    const results = await Promise.all(Array.from({ length: 3 }, () => service.createFundingRequest(input)));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await admin.fundingRequest.count({ where: { tenantId: tenant, idempotencyKey: input.idempotencyKey } })).toBe(1);
    expect(await admin.outboxEvent.count({ where: { tenantId: tenant, eventType: 'funding.requested' } })).toBe(1);
    expect(await admin.clientLifecycleAudit.count({ where: { tenantId: tenant, action: 'FUNDING_REQUESTED', entityId: results[0].id } })).toBe(1);
    await expect(service.createFundingRequest({ ...input, requestedAmount: '124' })).rejects.toThrow('Request key already used');
  });
  it('enforces the scoped restriction and current account state before creating a request', async () => {
    const restriction = await admin.accountRestriction.create({ data: { tenantId: tenant, accountId, restrictionType: 'NO_DEPOSIT',
      status: 'ACTIVE', reason: 'Compliance review', source: 'test', idempotencyKey: 'deposit-block' } });
    const input = { tenantId: tenant, accountId, requestedAmount: '1', currency: 'USD', idempotencyKey: 'blocked-request' };
    await expect(service.createFundingRequest(input)).rejects.toThrow('NO_DEPOSIT restriction');
    expect(await admin.fundingRequest.count({ where: { tenantId: tenant, idempotencyKey: input.idempotencyKey } })).toBe(0);
    await admin.accountRestriction.update({ where: { id: restriction.id }, data: { status: 'REVOKED' } });
    await admin.institutionalAccount.update({ where: { id: accountId }, data: { isFundingEnabled: false } });
    await expect(service.createFundingRequest(input)).rejects.toThrow('not eligible for deposits');
    await admin.institutionalAccount.update({ where: { id: accountId }, data: { isFundingEnabled: true } });
  });

  it('serializes a shared external reference even with different request keys', async () => {
    const input = { tenantId: tenant, accountId, requestedAmount: '3', currency: 'USD', externalReference: 'same-reference' };
    const attempts = await Promise.allSettled([
      service.createFundingRequest({ ...input, idempotencyKey: 'reference-key-one' }),
      service.createFundingRequest({ ...input, idempotencyKey: 'reference-key-two' }),
    ]);
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await admin.fundingRequest.count({ where: { tenantId: tenant, externalReference: 'same-reference' } })).toBe(1);
    expect(await admin.outboxEvent.count({ where: { tenantId: tenant, eventType: 'funding.requested' } })).toBe(2);
  });
});
