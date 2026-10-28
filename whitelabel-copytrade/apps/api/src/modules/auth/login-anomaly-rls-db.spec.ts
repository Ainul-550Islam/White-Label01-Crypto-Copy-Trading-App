import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PrismaLoginAnomalyRepository } from './login-anomaly.repository';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL;
const rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;

(adminUrl && rlsUrl ? describe : describe.skip)('login anomaly persistence under forced tenant RLS', () => {
  const tenant = randomUUID();
  const otherTenant = randomUUID();
  const user = randomUUID();
  const otherUser = randomUUID();
  const fingerprint = 'a'.repeat(64);
  const now = new Date();
  let admin: PrismaService;
  let db: PrismaService;
  let repository: PrismaLoginAnomalyRepository;
  const client = (url: string) => new PrismaService({ databaseUrl: url, isProduction: false, databaseReadEnabled: false } as never,
    { warn() {}, debug() {}, error() {}, info() {} } as never);

  beforeAll(async () => {
    admin = client(adminUrl!);
    db = client(rlsUrl!);
    repository = new PrismaLoginAnomalyRepository(db);
    await admin.tenant.createMany({ data: [tenant, otherTenant].map((id) => ({ id, slug: `device-rls-${id}`, name: 'Test' })) });
    for (const [id, tenantId] of [[user, tenant], [otherUser, otherTenant]]) {
      await admin.user.create({ data: { id, tenantId, email: `${id}@example.test`, emailIndex: id.replace(/-/g, ''),
        passwordHash: 'synthetic', status: 'ACTIVE' } });
    }
    await admin.loginAttempt.createMany({ data: [
      { tenantId: tenant, userId: user, emailIndex: user.replace(/-/g, ''), successful: false, ipHash: 'a'.repeat(64), createdAt: now },
      { tenantId: otherTenant, userId: otherUser, emailIndex: otherUser.replace(/-/g, ''), successful: false, ipHash: 'b'.repeat(64), createdAt: now },
    ] });
  });
  afterAll(async () => {
    if (admin) await admin.tenant.deleteMany({ where: { id: { in: [tenant, otherTenant] } } });
    await db?.$disconnect();
    await admin?.$disconnect();
  });

  it('reads and writes only the selected tenant, including real failed-login counts', async () => {
    expect(await db.loginDevice.count()).toBe(0);
    expect(await db.loginAttempt.count()).toBe(0);
    await repository.upsertDevice({ tenantId: tenant, userId: user, fingerprintHash: fingerprint,
      countryCode: 'BD', lastLatitude: 25.75, lastLongitude: 89.25, lastSeenAt: now, trusted: false });
    const devices = await repository.listDevices({ tenantId: tenant, userId: user });
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ fingerprintHash: fingerprint, countryCode: 'BD', lastLatitude: 25.75, trusted: false });
    expect(await repository.listDevices({ tenantId: otherTenant, userId: user })).toEqual([]);
    expect(await repository.countRecentFailures({ tenantId: tenant, userId: user, since: new Date(now.getTime() - 1000) })).toBe(1);
    expect(await repository.countRecentFailures({ tenantId: otherTenant, userId: user, since: new Date(now.getTime() - 1000) })).toBe(0);
  });

  it('keeps known location when the next observation contains no location', async () => {
    await repository.upsertDevice({ tenantId: tenant, userId: user, fingerprintHash: fingerprint,
      countryCode: null, lastLatitude: null, lastLongitude: null, lastSeenAt: new Date(now.getTime() + 1000), trusted: true });
    expect((await repository.listDevices({ tenantId: tenant, userId: user }))[0])
      .toMatchObject({ countryCode: 'BD', lastLatitude: 25.75, lastLongitude: 89.25, trusted: true });
  });

  it('rejects a user from another tenant both in the repository and at the database boundary', async () => {
    await expect(repository.upsertDevice({ tenantId: tenant, userId: otherUser, fingerprintHash: 'b'.repeat(64),
      countryCode: null, lastLatitude: null, lastLongitude: null, lastSeenAt: now, trusted: false })).rejects.toThrow('User not found');
    await expect(admin.$executeRaw`INSERT INTO login_devices (tenant_id, user_id, fingerprint_hash, last_seen_at)
      VALUES (${tenant}::uuid, ${otherUser}::uuid, ${'c'.repeat(64)}, ${now})`).rejects.toThrow();
    await expect(admin.user.update({ where: { id: user }, data: { tenantId: otherTenant } })).rejects.toThrow();
  });

  it('protects old recovery-token rows and rejects a mismatched owner', async () => {
    await admin.$executeRaw`INSERT INTO account_recovery_tokens (tenant_id, user_id, token_hash, expires_at)
      VALUES (${tenant}::uuid, ${user}::uuid, ${'d'.repeat(64)}, ${new Date(now.getTime() + 60_000)})`;
    const withoutTenant = await db.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM account_recovery_tokens`;
    expect(withoutTenant[0]?.count).toBe(0);
    const selected = await db.withTenantRls(tenant, (tx) => tx.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM account_recovery_tokens`);
    const other = await db.withTenantRls(otherTenant, (tx) => tx.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM account_recovery_tokens`);
    expect(selected[0]?.count).toBe(1);
    expect(other[0]?.count).toBe(0);
    await expect(admin.$executeRaw`INSERT INTO account_recovery_tokens (tenant_id, user_id, token_hash, expires_at)
      VALUES (${tenant}::uuid, ${otherUser}::uuid, ${'e'.repeat(64)}, ${new Date(now.getTime() + 60_000)})`).rejects.toThrow();
  });
});
