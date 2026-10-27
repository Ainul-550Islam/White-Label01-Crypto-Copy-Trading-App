import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Queue, QueueEvents, Worker } from 'bullmq';
import Redis from 'ioredis';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import { KeyProvider } from '../../infrastructure/crypto/key.provider';
import { PasswordService } from '../../infrastructure/crypto/password.service';
import { AccountRecoveryRuntimeService } from './account-recovery-runtime.service';
import { AccountRecoveryDeliveryProcessor } from './account-recovery-delivery.processor';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RECOVERY_QUEUE, RECOVERY_READY_KEY, type RecoveryDeliveryJob } from './account-recovery-runtime.types';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL;
const rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;
const redisEnabled = process.env.BATCH02_TEST_REDIS === '1';
(adminUrl && rlsUrl && redisEnabled ? describe : describe.skip)('recovery with real queue and forced tenant RLS', () => {
  const tenant = randomUUID(), otherTenant = randomUUID(), user = randomUUID(), otherUser = randomUUID();
  const session = randomUUID(), refresh = randomUUID();
  const email = `owner-${user}@example.test`, unknown = `unknown-${user}@example.test`;
  const tables = ['users', 'verification_tokens', 'tenant_domains', 'user_sessions', 'refresh_tokens'];
  const prior = new Map<string, { relrowsecurity: boolean; relforcerowsecurity: boolean }>();
  const log = { info() {}, warn() {}, debug() {}, error() {} } as never;
  const prisma = (url: string) => new PrismaService({ databaseUrl: url, isProduction: false, databaseReadEnabled: false } as never, log);
  const prefix = `recovery-test-${randomUUID()}`;
  const connection = { host: '127.0.0.1', port: 6379, maxRetriesPerRequest: null };
  let admin: PrismaService, db: PrismaService, redis: Redis, queue: Queue<RecoveryDeliveryJob>, events: QueueEvents, worker: Worker<RecoveryDeliveryJob>;
  let crypto: CryptoService, passwords: PasswordService, runtime: AccountRecoveryRuntimeService, processor: AccountRecoveryDeliveryProcessor;
  let knownJobId: string, unknownJobId: string, token = '';
  const sent: Array<{ recipient: string; link: string }> = [];

  beforeAll(async () => {
    admin = prisma(adminUrl!); db = prisma(rlsUrl!);
    for (const table of tables) {
      const [state] = await admin.$queryRawUnsafe<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='${table}'`);
      prior.set(table, state);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    }
    const keys = new KeyProvider({ encryptionKeyId: 'test-key', encryptionMasterKeyBase64: Buffer.alloc(32, 7).toString('base64'), encryptionPreviousKeys: {},
      blindIndexKeyBase64: Buffer.alloc(32, 8).toString('base64'), encryptionProvider: 'local' } as never, log);
    keys.onModuleInit(); crypto = new CryptoService(keys, log);
    passwords = new PasswordService({ argon2Options: { memoryCost: 19456, timeCost: 2, parallelism: 1 }, passwordMinLength: 12 } as never, log);
    await admin.tenant.createMany({ data: [tenant, otherTenant].map((id) => ({ id, slug: `recovery-${id}`, name: 'Recovery test', status: 'ACTIVE' })) });
    await admin.user.createMany({ data: [
      { id: user, tenantId: tenant, email, emailIndex: crypto.blindIndex(email), passwordHash: await passwords.hash('Original#Piano987'), status: 'LOCKED',
        emailVerifiedAt: new Date(), twoFactorEnabled: true, sessionVersion: 4, failedLoginAttempts: 5, lockedUntil: new Date(Date.now() + 60000) },
      { id: otherUser, tenantId: otherTenant, email, emailIndex: crypto.blindIndex(email), passwordHash: await passwords.hash('Original#Piano987'), status: 'ACTIVE', emailVerifiedAt: new Date(), sessionVersion: 7 },
    ] });
    await admin.tenantDomain.create({ data: { tenantId: tenant, domain: `secure-${user}.example.test`, isPrimary: true, status: 'ACTIVE', verificationToken: 'test',
      verifiedAt: new Date(), certificateExpiry: new Date(Date.now() + 86400000) } });
    await admin.userSession.create({ data: { id: session, tenantId: tenant, userId: user, deviceId: 'device', ipHash: 'hashed-ip', expiresAt: new Date(Date.now() + 86400000) } });
    await admin.refreshToken.create({ data: { id: refresh, tenantId: tenant, userId: user, sessionId: session, familyId: randomUUID(), tokenHash: crypto.hashToken('refresh-test'), expiresAt: new Date(Date.now() + 86400000) } });
    redis = new Redis({ ...connection, keyPrefix: `${prefix}:` });
    queue = new Queue(RECOVERY_QUEUE, { connection, prefix }); events = new QueueEvents(RECOVERY_QUEUE, { connection, prefix });
    await events.waitUntilReady();
    const redisService = { client: redis } as never;
    runtime = new AccountRecoveryRuntimeService(db, crypto, passwords, redisService, queue);
    processor = new AccountRecoveryDeliveryProcessor(db, crypto, redisService, { platformRootDomain: 'example.test' } as never,
      { isConfigured: () => true, verify: async () => true, send: async (recipient: string, link: string) => { sent.push({ recipient, link }); } } as never);
    await redis.set(RECOVERY_READY_KEY, 'ready', 'EX', 60);
  }, 30000);

  afterAll(async () => {
    if (worker) await worker.close();
    if (events) await events.close();
    if (queue) { await queue.obliterate({ force: true }); await queue.close(); }
    if (redis) { await redis.del(RECOVERY_READY_KEY); await redis.quit(); }
    if (admin) {
      await admin.auditLog.deleteMany({ where: { tenantId: { in: [tenant, otherTenant] }, action: 'ACCOUNT_RECOVERY_COMPLETED' } });
      await admin.tenant.deleteMany({ where: { id: { in: [tenant, otherTenant] } } });
      for (const table of tables) {
        const state = prior.get(table);
        if (state && !state.relforcerowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`);
        if (state && !state.relrowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
      }
      await db.$disconnect(); await admin.$disconnect();
    }
  }, 30000);

  it('enqueues equivalent encrypted work for known and unknown addresses and binds retry keys', async () => {
    const known = await runtime.request(tenant, { email, idempotencyKey: 'known-request-123' });
    const missing = await runtime.request(tenant, { email: unknown, idempotencyKey: 'unknown-request-123' });
    expect(known).toEqual(missing);
    expect(await runtime.request(tenant, { email, idempotencyKey: 'known-request-123' })).toEqual(known);
    await expect(runtime.request(tenant, { email: unknown, idempotencyKey: 'known-request-123' })).rejects.toMatchObject({ status: 409 });
    knownJobId = crypto.sha256(`account-recovery-job:${tenant}:known-request-123`);
    unknownJobId = crypto.sha256(`account-recovery-job:${tenant}:unknown-request-123`);
    const jobs = await Promise.all([queue.getJob(knownJobId), queue.getJob(unknownJobId)]);
    expect(jobs.every(Boolean)).toBe(true);
    expect(JSON.stringify(jobs.map((j) => j!.data))).not.toContain(email);
    expect(JSON.stringify(jobs.map((j) => j!.data))).not.toContain(unknown);
    expect(await admin.verificationToken.count({ where: { tenantId: tenant, type: 'PASSWORD_RESET' } })).toBe(0);
  });

  it('uses the actual queue consumer, a verified tenant domain and no plaintext job data', async () => {
    const known = (await queue.getJob(knownJobId))!; const missing = (await queue.getJob(unknownJobId))!;
    const complete = [known.waitUntilFinished(events, 20000), missing.waitUntilFinished(events, 20000)];
    worker = new Worker<RecoveryDeliveryJob>(RECOVERY_QUEUE, (job) => processor.process(job), { connection, prefix, concurrency: 2 });
    await Promise.all(complete);
    expect(sent).toHaveLength(1); expect(sent[0].recipient).toBe(email);
    const link = new URL(sent[0].link);
    expect(link.protocol).toBe('https:'); expect(link.hostname).toBe(`secure-${user}.example.test`);
    expect(link.search).toBe(''); token = new URLSearchParams(link.hash.slice(1)).get('token')!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const storedJob = await queue.getJob(knownJobId);
    expect(storedJob?.data.emailCiphertext).toBeNull(); expect(JSON.stringify(storedJob?.data)).not.toContain(token);
    const storedToken = await admin.verificationToken.findUniqueOrThrow({ where: { id: known.data.tokenId } });
    expect(JSON.stringify(storedToken)).not.toContain(token);
    expect(storedToken.payload).toMatchObject({ deliveryState: 'SENT' });
    expect(await db.verificationToken.count()).toBe(0);
    expect(await db.withTenantRls(otherTenant, (tx) => tx.verificationToken.findMany({ where: { tenantId: tenant } }))).toEqual([]);
  }, 30000);

  it('verifies only the issuing tenant and atomically changes credentials while preserving MFA', async () => {
    expect(await runtime.verify(tenant, token)).toMatchObject({ valid: true });
    expect(await runtime.verify(otherTenant, token)).toMatchObject({ valid: false });
    await expect(runtime.complete(tenant, { token, newPassword: 'weak', idempotencyKey: 'reset-key-123456' })).rejects.toMatchObject({ status: 400 });
    const input = { token, newPassword: 'Seashell#Piano84!', idempotencyKey: 'reset-key-123456' };
    const result = await runtime.complete(tenant, input);
    expect(result).toMatchObject({ status: 'RECOVERED', sessionsRevoked: 1, requiresTwoFactorEnrolment: false });
    expect(await runtime.complete(tenant, input)).toEqual(result);
    expect(await runtime.complete(tenant, { ...input, idempotencyKey: 'another-reset-key' })).toMatchObject({ status: 'REFUSED' });
    expect(await runtime.complete(tenant, { ...input, newPassword: 'Dolphin#Piano83!' })).toMatchObject({ status: 'REFUSED' });
    expect(await runtime.verify(tenant, token)).toMatchObject({ valid: false });
    const [account, untouched, existingSession, existingRefresh] = await Promise.all([
      admin.user.findUniqueOrThrow({ where: { id: user } }), admin.user.findUniqueOrThrow({ where: { id: otherUser } }),
      admin.userSession.findUniqueOrThrow({ where: { id: session } }), admin.refreshToken.findUniqueOrThrow({ where: { id: refresh } }),
    ]);
    expect(account).toMatchObject({ status: 'ACTIVE', sessionVersion: 5, twoFactorEnabled: true, failedLoginAttempts: 0, lockedUntil: null });
    expect(await passwords.verify(account.passwordHash, input.newPassword)).toBe(true);
    expect(untouched.sessionVersion).toBe(7); expect(existingSession.revokedAt).not.toBeNull();
    expect(existingRefresh).toMatchObject({ status: 'REVOKED', revokeReason: 'ACCOUNT_RECOVERY' });
    expect(await admin.auditLog.count({ where: { tenantId: tenant, actorId: user, action: 'ACCOUNT_RECOVERY_COMPLETED' } })).toBe(1);
  }, 30000);

  it('validates real sessions under forced RLS and rejects tokens revoked by recovery', async () => {
    const liveSession = randomUUID();
    await admin.userSession.create({ data: { id: liveSession, tenantId: otherTenant, userId: otherUser, deviceId: 'other-device',
      ipHash: 'hashed-ip', expiresAt: new Date(Date.now() + 60000) } });
    const strategy = new JwtStrategy({ jwtAccessVerificationKey: 'test-key', jwtAlgorithm: 'HS256', jwtIssuer: 'test', jwtAudience: 'test' } as never, db);
    // Passport normally verifies the signature before calling validate.
    const payload = { typ: 'access', tid: otherTenant, sub: otherUser, sid: liveSession, sv: 7, roles: [], perms: [], jti: 'test' };
    await expect(strategy.validate(payload as never)).resolves.toMatchObject({ tenantId: otherTenant, userId: otherUser, sessionId: liveSession });
    await expect(strategy.validate({ ...payload, tid: tenant } as never)).rejects.toBeDefined();
    await expect(strategy.validate({ typ: 'access', tid: tenant, sub: user, sid: session, sv: 4, roles: [], perms: [], jti: 'test' } as never)).rejects.toBeDefined();
    await admin.user.update({ where: { id: otherUser }, data: { sessionVersion: { increment: 1 } } });
    await expect(strategy.validate(payload as never)).rejects.toBeDefined();
  });

  it('serializes two simultaneously redeemed links for the same account', async () => {
    const raceUser = randomUUID(), raceEmail = `race-${raceUser}@example.test`;
    const raceIndex = crypto.blindIndex(raceEmail);
    await admin.user.create({ data: { id: raceUser, tenantId: tenant, email: raceEmail, emailIndex: raceIndex,
      passwordHash: await passwords.hash('Original#Piano987'), emailVerifiedAt: new Date(), status: 'ACTIVE' } });
    const a = crypto.generateToken(32), b = crypto.generateToken(32);
    await admin.verificationToken.createMany({ data: [a, b].map((raw) => ({ tenantId: tenant, userId: raceUser, type: 'PASSWORD_RESET',
      tokenHash: crypto.hashToken(`account-recovery:${tenant}:${raw}`), payload: { emailIndex: raceIndex }, expiresAt: new Date(Date.now() + 60000) })) });
    const outcomes = await Promise.all([
      runtime.complete(tenant, { token: a, newPassword: 'Seashell#Piano84!', idempotencyKey: 'race-reset-a-123' }),
      runtime.complete(tenant, { token: b, newPassword: 'Dolphin#Piano83!', idempotencyKey: 'race-reset-b-123' }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'RECOVERED')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'REFUSED')).toHaveLength(1);
    expect((await admin.user.findUniqueOrThrow({ where: { id: raceUser } })).sessionVersion).toBe(1);
    expect(await admin.verificationToken.count({ where: { tenantId: tenant, userId: raceUser, consumedAt: null } })).toBe(0);
    expect(await admin.auditLog.count({ where: { tenantId: tenant, actorId: raceUser, action: 'ACCOUNT_RECOVERY_COMPLETED' } })).toBe(1);
  }, 30000);

  it('does not verify or change credentials while a tenant is suspended', async () => {
    const raw = crypto.generateToken(32);
    await admin.verificationToken.create({ data: { tenantId: tenant, userId: user, type: 'PASSWORD_RESET',
      tokenHash: crypto.hashToken(`account-recovery:${tenant}:${raw}`), payload: { emailIndex: crypto.blindIndex(email) },
      expiresAt: new Date(Date.now() + 60000) } });
    const before = await admin.user.findUniqueOrThrow({ where: { id: user } });
    await admin.tenant.update({ where: { id: tenant }, data: { status: 'SUSPENDED' } });
    await expect(runtime.verify(tenant, raw)).resolves.toMatchObject({ valid: false });
    await expect(runtime.complete(tenant, { token: raw, newPassword: 'Starlight#River497!', idempotencyKey: 'suspended-reset-123' }))
      .resolves.toMatchObject({ status: 'REFUSED' });
    const after = await admin.user.findUniqueOrThrow({ where: { id: user } });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.sessionVersion).toBe(before.sessionVersion);
    await admin.tenant.update({ where: { id: tenant }, data: { status: 'ACTIVE' } });
    await expect(runtime.verify(tenant, raw)).resolves.toMatchObject({ valid: true });
  });

  it('refuses new requests without a ready delivery consumer', async () => {
    await redis.del(RECOVERY_READY_KEY);
    await expect(runtime.request(tenant, { email, idempotencyKey: 'without-ready-123' })).rejects.toMatchObject({ status: 503 });
  });
});
