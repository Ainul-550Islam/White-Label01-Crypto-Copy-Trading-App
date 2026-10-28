import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import type { AuthenticatedActor } from '@wlct/shared-types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CacheService } from '../../infrastructure/redis/cache.service';
import { KeyProvider } from '../../infrastructure/crypto/key.provider';
import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import { PasswordService } from '../../infrastructure/crypto/password.service';
import { AccountLockoutService } from './services/account-lockout.service';
import { TwoFactorService } from './services/two-factor.service';
import { StepUpAuthService } from './step-up-auth.service';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL, rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;
(adminUrl && rlsUrl && process.env.BATCH02_TEST_REDIS === '1' ? describe : describe.skip)('action-bound step-up with forced RLS', () => {
  const tenantId = randomUUID(), otherTenant = randomUUID(), userId = randomUUID(), sessionId = randomUUID();
  const email = `${userId}@example.test`, password = 'Synthetic#Password928!', recoveryCode = 'TEST-RECOVERY-CODE-392';
  const actor = { tenantId, userId, sessionId } as AuthenticatedActor;
  const context = { ipHash: 'test-ip', requestId: 'test-request' };
  const logger = { info() {}, warn() {}, debug() {}, error() {} } as never;
  const config = { stepUpTtlSeconds: 300, argon2Options: { memoryCost: 19456, timeCost: 2, parallelism: 1 },
    loginFailedWindowSeconds: 900, loginMaxFailedAttempts: 5, accountLockoutSeconds: 300,
    twoFactorDigits: 6, twoFactorPeriod: 30, twoFactorWindow: 1, twoFactorRecoveryCodeCount: 8 };
  const prefix = `stepup-rls-${randomUUID()}:`;
  let admin: PrismaService, db: PrismaService, redis: Redis, service: StepUpAuthService;
  const makeDb = (url: string) => new PrismaService({ databaseUrl: url, isProduction: false, databaseReadEnabled: false } as never, logger);
  beforeAll(async () => {
    admin = makeDb(adminUrl!); db = makeDb(rlsUrl!);
    redis = new Redis({ host: '127.0.0.1', port: 6379, keyPrefix: prefix, maxRetriesPerRequest: null });
    const keys = new KeyProvider({ encryptionKeyId: 'test', encryptionMasterKeyBase64: Buffer.alloc(32, 7).toString('base64'),
      encryptionPreviousKeys: {}, blindIndexKeyBase64: Buffer.alloc(32, 8).toString('base64'), encryptionProvider: 'local' } as never, logger);
    keys.onModuleInit();
    const crypto = new CryptoService(keys, logger), passwords = new PasswordService(config as never, logger);
    await admin.tenant.createMany({ data: [tenantId, otherTenant].map((id) => ({ id, slug: `stepup-${id}`, name: 'Step-up test', status: 'ACTIVE' })) });
    await admin.user.create({ data: { id: userId, tenantId, email, emailIndex: crypto.blindIndex(email), passwordHash: await passwords.hash(password),
      status: 'ACTIVE', twoFactorEnabled: true } });
    await admin.userSession.create({ data: { id: sessionId, tenantId, userId, deviceId: 'stepup-test-device', ipHash: context.ipHash,
      expiresAt: new Date(Date.now() + 600000) } });
    const secret = crypto.encrypt('JBSWY3DPEHPK3PXP', `two_factor_secret:${userId}`);
    await admin.twoFactorAuth.create({ data: { userId, status: 'ACTIVE', method: 'TOTP', secretCiphertext: secret as never, encryptionKeyId: secret.keyId } });
    await admin.twoFactorRecoveryCode.create({ data: { userId, codeHash: await passwords.hash(recoveryCode) } });
    const redisService = { client: redis } as never, cache = new CacheService(redisService, logger);
    const audit = { recordImmediate: async () => undefined } as never;
    const lockout = new AccountLockoutService(cache, db, config as never, { record: async () => undefined } as never, logger);
    const twoFactor = new TwoFactorService(db, crypto, passwords, config as never, audit, logger);
    service = new StepUpAuthService(db, redisService, passwords, twoFactor, lockout, config as never, audit);
  }, 30000);
  afterAll(async () => {
    if (admin) { await admin.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenant] } } }); await db.$disconnect(); await admin.$disconnect(); }
    if (redis) { const found = await redis.keys(`${prefix}*`); if (found.length) await redis.del(...found.map((key) => key.slice(prefix.length))); await redis.quit(); }
  });
  it('issues a real password proof for the deposit action and consumes it at most once', async () => {
    expect(await db.user.count({ where: { id: userId } })).toBe(0);
    expect(await db.userSession.count({ where: { id: sessionId } })).toBe(0);
    const issued = await service.issue(actor, { action: 'CUSTODY_ADDRESS_ISSUE', method: 'PASSWORD', password }, context);
    expect(issued).toMatchObject({ action: 'CUSTODY_ADDRESS_ISSUE', method: 'PASSWORD' });
    expect(issued.proofId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await service.consume(actor, 'PAYOUT_CREATE')).toMatchObject({ consumed: false, reasonCode: 'ACTION_MISMATCH' });
    const results = await Promise.all([service.consume(actor, 'CUSTODY_ADDRESS_ISSUE'), service.consume(actor, 'CUSTODY_ADDRESS_ISSUE')]);
    expect(results.filter((item) => item.consumed)).toHaveLength(1);
    expect(results.filter((item) => item.reasonCode === 'NO_PROOF')).toHaveLength(1);
  });
  it('uses a real recovery code only once and refuses cross-tenant or revoked sessions', async () => {
    await expect(service.issue({ ...actor, tenantId: otherTenant }, { action: 'CUSTODY_ADDRESS_ISSUE', method: 'PASSWORD', password }, context))
      .rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
    const issued = await service.issue(actor, { action: 'CUSTODY_ADDRESS_ISSUE', method: 'RECOVERY_CODE', recoveryCode }, context);
    expect(issued.method).toBe('RECOVERY_CODE');
    await expect(service.issue(actor, { action: 'CUSTODY_ADDRESS_ISSUE', method: 'RECOVERY_CODE', recoveryCode }, context)).rejects.toThrow();
    await admin.userSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    await expect(service.issue(actor, { action: 'CUSTODY_ADDRESS_ISSUE', method: 'PASSWORD', password }, context))
      .rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
  });
});
