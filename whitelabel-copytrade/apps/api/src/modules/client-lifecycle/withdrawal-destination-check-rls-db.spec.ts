import { randomUUID } from 'crypto';
import type { AuthenticatedActor } from '@wlct/shared-types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PrismaWithdrawalDestinationRepository, WithdrawalDestinationPolicyService } from '../custody/withdrawal-destination-policy.service';
import { WithdrawalDestinationCheckController } from './withdrawal-destination-check.controller';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL;
const rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;
(adminUrl && rlsUrl ? describe : describe.skip)('customer destination check with forced PostgreSQL RLS', () => {
  const tenant = randomUUID(), otherTenant = randomUUID(), user = randomUUID(), otherUser = randomUUID();
  const address = '0x1111111111111111111111111111111111111111';
  const client = (url: string) => new PrismaService({ databaseUrl: url, isProduction: false, databaseReadEnabled: false } as never, { warn() {}, debug() {}, error() {}, info() {} } as never);
  let admin: PrismaService, db: PrismaService, repo: PrismaWithdrawalDestinationRepository, controller: WithdrawalDestinationCheckController;
  beforeAll(async () => {
    admin = client(adminUrl!); db = client(rlsUrl!);
    await admin.tenant.createMany({ data: [tenant, otherTenant].map((id) => ({ id, slug: `check-${id}`, name: 'Destination check test' })) });
    await admin.user.createMany({ data: [{ id: user, tenantId: tenant }, { id: otherUser, tenantId: tenant }].map((entry) => ({ ...entry, email: `${entry.id}@example.test`, emailIndex: entry.id.replace(/-/g, ''), passwordHash: 'not-a-real-secret', status: 'ACTIVE' })) });
    repo = new PrismaWithdrawalDestinationRepository(db);
    controller = new WithdrawalDestinationCheckController(new WithdrawalDestinationPolicyService(repo));
  });
  afterAll(async () => {
    if (!admin) return;
    await admin.withdrawalDestination.deleteMany({ where: { tenantId: { in: [tenant, otherTenant] } } });
    await admin.clientLifecycleAudit.deleteMany({ where: { tenantId: { in: [tenant, otherTenant] } } });
    await admin.tenant.deleteMany({ where: { id: { in: [tenant, otherTenant] } } });
    await db.$disconnect(); await admin.$disconnect();
  });
  it('only reports the signed-in owner’s active destination and creates no withdrawal', async () => {
    const row = await repo.create({ tenantId: tenant, userId: user, network: 'ETHEREUM', address, label: 'Vault', activatesAt: new Date(Date.now() - 1000) });
    await repo.setStatus({ tenantId: tenant, userId: user, id: row.id, status: 'ACTIVE', revokedAt: null, dueAt: new Date() });
    const dto = { network: 'ETHEREUM' as const, address };
    const actor = (id: string) => ({ userId: id } as AuthenticatedActor);
    await expect(controller.check(tenant, actor(user), dto)).resolves.toMatchObject({ decision: 'ALLOW', code: 'ALLOW', destinationId: row.id });
    await expect(controller.check(tenant, actor(otherUser), dto)).resolves.toMatchObject({ decision: 'DENY', code: 'DESTINATION_NOT_ALLOWLISTED' });
    await expect(controller.check(otherTenant, actor(user), dto)).resolves.toMatchObject({ decision: 'DENY', code: 'DESTINATION_NOT_ALLOWLISTED' });
    expect(await admin.withdrawalRequest.count({ where: { tenantId: { in: [tenant, otherTenant] } } })).toBe(0);
    await admin.withdrawalDestination.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    await expect(controller.check(tenant, actor(user), dto)).resolves.toMatchObject({ decision: 'DENY', code: 'DESTINATION_REVOKED' });
    await admin.withdrawalDestination.update({ where: { id: row.id }, data: { revokedAt: null, activatesAt: new Date('2999-01-01T00:00:00Z') } });
    await expect(controller.check(tenant, actor(user), dto)).resolves.toMatchObject({ decision: 'DENY', code: 'DESTINATION_PENDING_ACTIVATION' });
    await admin.withdrawalDestination.update({ where: { id: row.id }, data: { activatesAt: new Date(Date.now() - 1000) } });
    await repo.setStatus({ tenantId: tenant, userId: user, id: row.id, status: 'REVOKED', revokedAt: new Date() });
    await expect(controller.check(tenant, actor(user), dto)).resolves.toMatchObject({ decision: 'DENY', code: 'DESTINATION_REVOKED' });
  });
});
