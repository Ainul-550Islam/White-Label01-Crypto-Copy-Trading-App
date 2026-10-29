/** Opt in on a disposable migrated PostgreSQL database; FCM is replaced only at its provider boundary. */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CryptoService } from '../../../infrastructure/crypto/crypto.service';
import { PushDeviceService } from './push-device.service';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL, rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;
(adminUrl && rlsUrl ? describe : describe.skip)('mobile push registration with forced tenant RLS', () => {
  const tenant = randomUUID(), otherTenant = randomUUID(), user = randomUUID(), otherUser = randomUUID();
  const session = randomUUID(), otherSession = randomUUID(), token = `fcm_${'AbC'.repeat(40)}`;
  const actor = { tenantId: tenant, userId: user, sessionId: session } as never;
  const otherActor = { tenantId: otherTenant, userId: otherUser, sessionId: otherSession } as never;
  let admin: PrismaService, db: PrismaService, service: PushDeviceService;
  const log = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
  const fcm = {
    send: jest.fn(
      async (_call: {
        tenantId: string;
        recipientUserId: string;
        safePayload: { deviceToken: string };
        correlationId?: string;
      }) => ({ accepted: true, retryable: false, providerReference: 'projects/test/messages/123' }),
    ),
  };
  const prior = new Map<string, { relrowsecurity: boolean; relforcerowsecurity: boolean }>();
  const tables = ['user_sessions', 'users'];
  const client = (databaseUrl: string) => new PrismaService({ databaseUrl, isProduction: false, databaseReadEnabled: false } as never, log as never);
  beforeAll(async () => {
    admin = client(adminUrl!); db = client(rlsUrl!);
    const [role] = await db.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user`;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
    for (const table of tables) {
      const [flags] = await admin.$queryRawUnsafe<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='${table}'`);
      prior.set(table, flags);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    }
    await admin.tenant.createMany({ data: [tenant, otherTenant].map((id) => ({ id, slug: `push-${id}`, name: 'Push test' })) });
    await admin.user.createMany({ data: [{ id: user, tenantId: tenant }, { id: otherUser, tenantId: otherTenant }].map((v) => ({ ...v, email: `${v.id}@example.test`, emailIndex: v.id.replace(/-/g, ''), passwordHash: 'test-only', status: 'ACTIVE' })) });
    await admin.userSession.createMany({ data: [{ id: session, tenantId: tenant, userId: user }, { id: otherSession, tenantId: otherTenant, userId: otherUser }].map((v) => ({ ...v, deviceId: `test-${v.id}`, ipHash: 'test', expiresAt: new Date('2099-01-01') })) });
    const key = Buffer.alloc(32, 7), keys = { activeKey: key, activeKeyId: 'test', blindIndexKey: Buffer.alloc(32, 9), resolve: () => key };
    const crypto = new CryptoService(keys as never, log as never);
    service = new PushDeviceService(db, crypto, fcm as never, {} as never);
  });
  afterAll(async () => {
    if (admin) {
      await admin.tenant.deleteMany({ where: { id: { in: [tenant, otherTenant] } } });
      for (const table of tables) { const flags = prior.get(table); if (flags && !flags.relforcerowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`); if (flags && !flags.relrowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`); }
      await admin.$disconnect();
    }
    await db?.$disconnect();
  });
  it('seals tokens, safely replays an intent, isolates tenants and records provider acknowledgement', async () => {
    expect(await service.register(actor, 'FCM', token, 'push-intent-0001')).toEqual({ registered: true });
    expect(await service.register(actor, 'FCM', token, 'push-intent-0001')).toEqual({ registered: true });
    await expect(service.register(actor, 'FCM', `${token}different`, 'push-intent-0001')).rejects.toMatchObject({ status: 409 });
    await service.register(otherActor, 'FCM', `fcm_${'xyz'.repeat(40)}`, 'push-intent-0001');
    const rows = await admin.$queryRaw<Array<{ token_sealed: unknown }>>`SELECT token_sealed FROM mobile_push_devices WHERE tenant_id=${tenant}::uuid`;
    expect(JSON.stringify(rows)).not.toContain(token);
    const visible = await db.withTenantRls(otherTenant, (tx) => tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM mobile_push_devices WHERE tenant_id=${tenant}::uuid`);
    expect(visible).toHaveLength(0);
    expect(await service.deliver('push-job-one', { tenantId: tenant, userId: user, locale: 'bn' })).toEqual({ accepted: 1, failed: 0 });
    expect(fcm.send).toHaveBeenCalledTimes(1);
    expect(fcm.send.mock.calls[0][0]).toMatchObject({ tenantId: tenant, recipientUserId: user, safePayload: { deviceToken: token } });
    expect(await service.deliver('push-job-one', { tenantId: tenant, userId: user, locale: 'bn' })).toEqual({ accepted: 0, failed: 0 });
    expect(fcm.send).toHaveBeenCalledTimes(1);
    await admin.userSession.update({ where: { id: session }, data: { revokedAt: new Date() } });
    expect(await service.deliver('push-job-two', { tenantId: tenant, userId: user, locale: 'en' })).toEqual({ accepted: 0, failed: 0 });
    expect(fcm.send).toHaveBeenCalledTimes(1);
  });
});
