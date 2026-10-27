import { randomUUID } from 'crypto';
import { Permission } from '@wlct/shared-types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { AccountAdministrationService } from './account-administration.service';
import { AccountRestrictionService } from './account-restriction.service';
import { ClientLifecycleController } from './client-lifecycle.controller';
import { ClientPolicyService } from './client-policy.service';
import { ClientProfileRepository } from './client-profile.repository';
import { ClientVisibilityService } from './client-visibility.service';
import { FundingRequestService } from './funding-request.service';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL;
const rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;
(adminUrl && rlsUrl ? describe : describe.skip)('customer funding controller with forced PostgreSQL RLS', () => {
  const tenant = randomUUID(), otherTenant = randomUUID();
  const alice = randomUUID(), bob = randomUUID(), aliceProfile = randomUUID(), bobProfile = randomUUID();
  const aliceAccount = randomUUID(), bobAccount = randomUUID(), foreignAccount = randomUUID();
  const tables = ['institutional_accounts', 'account_ownerships', 'account_relationships', 'client_profiles',
    'account_restrictions', 'funding_requests', 'outbox_events', 'client_lifecycle_audits', 'withdrawal_requests'];
  const prior = new Map<string, { relrowsecurity: boolean; relforcerowsecurity: boolean }>();
  const client = (url: string) => new PrismaService({ databaseUrl: url, isProduction: false, databaseReadEnabled: false } as never,
    { warn() {}, debug() {}, error() {}, info() {} } as never);
  let admin: PrismaService, db: PrismaService, controller: ClientLifecycleController;
  const request = (userId: string, tenantId = tenant, key = 'funding-request-key') => ({
    user: { userId, tenantId, permissions: [Permission.PORTFOLIO_READ], roles: ['FOLLOWER'] }, headers: { 'idempotency-key': key },
  });
  const dto = { accountId: aliceAccount, requestedAmount: '123.00000001', currency: 'USD', externalReference: 'bank-ref-123' };
  beforeAll(async () => {
    admin = client(adminUrl!); db = client(rlsUrl!);
    for (const table of tables) {
      const [state] = await admin.$queryRawUnsafe<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='${table}'`);
      prior.set(table, state);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    }
    await admin.tenant.createMany({ data: [tenant, otherTenant].map((id) => ({ id, slug: `funding-controller-${id}`, name: 'Funding RLS test' })) });
    await admin.user.createMany({ data: [alice, bob].map((id) => ({ id, tenantId: tenant, email: `${id}@example.test`,
      emailIndex: id.replace(/-/g, ''), passwordHash: 'not-a-real-secret', status: 'ACTIVE' })) });
    await admin.clientProfile.createMany({ data: [{ id: aliceProfile, user: alice }, { id: bobProfile, user: bob }].map(({ id, user }) => ({
      id, tenantId: tenant, externalIdentityRef: user, idempotencyKey: `profile-${id}`,
    })) });
    await admin.institutionalAccount.createMany({ data: [
      { id: aliceAccount, tenantId: tenant, clientProfileId: aliceProfile },
      { id: bobAccount, tenantId: tenant, clientProfileId: bobProfile },
      { id: foreignAccount, tenantId: otherTenant, clientProfileId: null },
    ].map((row) => ({ ...row, state: 'ACTIVE' as const, isFundingEnabled: true, idempotencyKey: `account-${row.id}` })) });
    const policy = new ClientPolicyService(db, {} as never);
    const profileRepo = new ClientProfileRepository(db);
    const audit = { log: jest.fn(async () => undefined) };
    const restrictions = new AccountRestrictionService(db, audit as never);
    const accountAdmin = new AccountAdministrationService(db, profileRepo, policy, audit as never);
    const funding = new FundingRequestService(db, policy, audit as never, restrictions, new OutboxService());
    controller = Object.assign(Object.create(ClientLifecycleController.prototype) as ClientLifecycleController, {
      prisma: db, profileRepo, accountAdminService: accountAdmin, visibilityService: new ClientVisibilityService(db),
      fundingRequestService: funding, notificationService: { notifyFundingRequested: async () => undefined },
    });
  });
  afterAll(async () => {
    if (!admin) return;
    const ids = [tenant, otherTenant];
    await admin.outboxEvent.deleteMany({ where: { tenantId: { in: ids } } });
    await admin.tenant.deleteMany({ where: { id: { in: ids } } });
    for (const table of tables) {
      const state = prior.get(table);
      if (state && !state.relforcerowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`);
      if (state && !state.relrowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
    }
    await db.$disconnect(); await admin.$disconnect();
  });
  it('lists the caller’s account and rejects another user or tenant', async () => {
    const accounts = await controller.listAccounts(request(alice), {});
    expect(accounts.data.map((row: { id: string }) => row.id)).toEqual([aliceAccount]);
    await expect(controller.createFunding(request(bob), dto)).rejects.toThrow('Account not found');
    await expect(controller.createFunding(request(alice), { ...dto, accountId: foreignAccount })).rejects.toThrow('Account not found');
    expect(await admin.fundingRequest.count({ where: { tenantId: tenant } })).toBe(0);
  });
  it('does not treat an RLS-hidden active NO_DEPOSIT restriction as permission to create', async () => {
    const restriction = await admin.accountRestriction.create({ data: { tenantId: tenant, accountId: aliceAccount,
      restrictionType: 'NO_DEPOSIT', status: 'ACTIVE', reason: 'Manual review', source: 'test', idempotencyKey: 'no-deposit-test' } });
    await expect(controller.createFunding(request(alice), dto)).rejects.toThrow('NO_DEPOSIT restriction');
    expect(await admin.fundingRequest.count({ where: { tenantId: tenant } })).toBe(0);
    await admin.accountRestriction.update({ where: { id: restriction.id }, data: { status: 'REVOKED' } });
  });
  it('creates and replays one authorized request with its audit and outbox, and lists only the owner’s row', async () => {
    const first = await controller.createFunding(request(alice), dto);
    const retry = await controller.createFunding(request(alice), dto);
    expect(retry.id).toBe(first.id);
    expect(await admin.fundingRequest.count({ where: { tenantId: tenant } })).toBe(1);
    expect(await admin.clientLifecycleAudit.count({ where: { tenantId: tenant, entityId: first.id, action: 'FUNDING_REQUESTED' } })).toBe(1);
    expect(await admin.outboxEvent.count({ where: { tenantId: tenant, aggregateId: first.id, eventType: 'funding.requested' } })).toBe(1);
    const own = await controller.listFunding(request(alice), {});
    const other = await controller.listFunding(request(bob), {});
    expect(own.data.map((row: { id: string }) => row.id)).toEqual([first.id]);
    expect(other.data).toEqual([]);
    await expect(controller.createFunding(request(alice), { ...dto, requestedAmount: '124' })).rejects.toThrow('Duplicate external funding reference');
  });
});
