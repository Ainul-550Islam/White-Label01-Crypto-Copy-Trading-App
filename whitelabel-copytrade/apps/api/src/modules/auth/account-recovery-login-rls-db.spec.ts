import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import Redis from 'ioredis';
import { authenticator } from 'otplib';
import { CACHE_KEY } from '@wlct/config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CacheService } from '../../infrastructure/redis/cache.service';
import { KeyProvider } from '../../infrastructure/crypto/key.provider';
import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import { PasswordService } from '../../infrastructure/crypto/password.service';
import { PermissionsService } from '../rbac/permissions.service';
import { UsersRepository } from '../users/users.repository';
import { UsersService } from '../users/users.service';
import { SecurityThreatDetectionService } from '../security/security-threat-detection.service';
import { TenantResolutionMiddleware } from '../../common/middleware/tenant-resolution.middleware';
import { TenantResolverService } from '../tenants/tenant-resolver.service';
import { AuthController } from './auth.controller';
import { SessionsController } from './sessions.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuditService } from '../audit/audit.service';
import { AccountRecoveryController } from './account-recovery.controller';
import { AuthService } from './auth.service';
import { SessionService } from './services/session.service';
import { TokenService } from './services/token.service';
import { TwoFactorService } from './services/two-factor.service';
import { AccountLockoutService } from './services/account-lockout.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AccountRecoveryRuntimeService } from './account-recovery-runtime.service';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL, rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;
(adminUrl && rlsUrl && process.env.BATCH02_TEST_REDIS === '1' ? describe : describe.skip)('password recovery through real login under forced RLS', () => {
  const tenantId = randomUUID(), otherTenant = randomUUID(), userId = randomUUID(), oldSessionId = randomUUID();
  const email = `recovery-login-${userId}@example.test`, oldPassword = 'Original#Piano987', newPassword = 'Seashell#Piano84!';
  const mfaCode = 'SYNTHETIC-RECOVERY-CODE', raceCode = 'SYNTHETIC-RACE-CODE', httpMfaCode = 'AB12-CD34-EF56', totpSecret = 'JBSWY3DPEHPK3PXP';
  const context = { ipHash: 'test-ip-hash', userAgent: 'integration-test', requestId: 'test-request', locale: 'en' };
  const tenant = { tenantId, slug: 'recovery-login', status: 'ACTIVE', source: 'subdomain', defaultLocale: 'en', defaultCurrency: 'USD' } as never;
  const logger = { info() {}, warn() {}, debug() {}, error() {} } as never;
  const config = { jwtAccessSigningKey: 'synthetic-access-key', jwtAccessVerificationKey: 'synthetic-access-key',
    jwtRefreshSigningKey: 'synthetic-refresh-key', jwtRefreshVerificationKey: 'synthetic-refresh-key', jwtAlgorithm: 'HS256',
    jwtIssuer: 'integration-test', jwtAudience: 'integration-api', accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 3600,
    twoFactorChallengeTtlSeconds: 300, twoFactorMaxChallengeAttempts: 4, twoFactorDigits: 6, twoFactorPeriod: 30, twoFactorWindow: 1,
    maxActiveSessionsPerUser: 5, loginFailedWindowSeconds: 900, loginMaxFailedAttempts: 5, accountLockoutSeconds: 300,
    argon2Options: { memoryCost: 19456, timeCost: 2, parallelism: 1 }, passwordMinLength: 12 };
  const makeDb = (url: string) => new PrismaService({ databaseUrl: url, isProduction: false, databaseReadEnabled: false } as never, logger);
  const redisPrefix = `recovery-login-test-${randomUUID()}:`;
  let admin: PrismaService, db: PrismaService, redis: Redis, crypto: CryptoService, passwords: PasswordService;
  let auth: AuthService, tokenService: TokenService, jwtStrategy: JwtStrategy, runtime: AccountRecoveryRuntimeService, permissions: PermissionsService, twoFactor: TwoFactorService, sessions: SessionService, users: UsersService;
  let permissionId: string;

  beforeAll(async () => {
    admin = makeDb(adminUrl!); db = makeDb(rlsUrl!); redis = new Redis({ host: '127.0.0.1', port: 6379, keyPrefix: redisPrefix, maxRetriesPerRequest: null });
    const flags = await admin.$queryRaw<Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>>`
      SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE oid IN ('public.users'::regclass, 'public.user_sessions'::regclass, 'public.refresh_tokens'::regclass, 'public.verification_tokens'::regclass)
    `;
    expect(flags).toHaveLength(4);
    expect(flags.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    const keyProvider = new KeyProvider({ encryptionKeyId: 'test-key', encryptionMasterKeyBase64: Buffer.alloc(32, 7).toString('base64'), encryptionPreviousKeys: {},
      blindIndexKeyBase64: Buffer.alloc(32, 8).toString('base64'), encryptionProvider: 'local' } as never, logger);
    keyProvider.onModuleInit(); crypto = new CryptoService(keyProvider, logger); passwords = new PasswordService(config as never, logger);
    await admin.tenant.createMany({ data: [tenantId, otherTenant].map(id => ({ id, slug: `recovery-login-${id}`, name: 'Recovery login test', status: 'ACTIVE' })) });
    await admin.user.create({ data: { id: userId, tenantId, email, emailIndex: crypto.blindIndex(email), passwordHash: await passwords.hash(oldPassword),
      emailVerifiedAt: new Date(), status: 'ACTIVE', twoFactorEnabled: true, sessionVersion: 2 } });
    expect(await db.user.count({ where: { id: userId } })).toBe(0);
    const role = await admin.role.create({ data: { tenantId, key: 'FOLLOWER_TEST', name: 'Follower test' } });
    const permission = await admin.permission.create({ data: { key: `test:${userId}`, resource: 'test', action: 'read' } }); permissionId = permission.id;
    await admin.rolePermission.create({ data: { roleId: role.id, permissionId } });
    await admin.userRole.create({ data: { tenantId, userId, roleId: role.id } });
    await admin.userSession.create({ data: { id: oldSessionId, tenantId, userId, deviceId: 'old-device', ipHash: context.ipHash, expiresAt: new Date(Date.now() + 60000) } });
    const secret = crypto.encrypt(totpSecret, `two_factor_secret:${userId}`);
    await admin.twoFactorAuth.create({ data: { userId, status: 'ACTIVE', method: 'TOTP', secretCiphertext: secret as never, encryptionKeyId: secret.keyId } });
    const codeHashes = await Promise.all([mfaCode, raceCode, httpMfaCode].map((code) => passwords.hash(code)));
    await admin.twoFactorRecoveryCode.createMany({ data: codeHashes.map((codeHash) => ({ userId, codeHash })) });
    const redisService = { client: redis } as never, cache = new CacheService(redisService, logger);
    const audit = { record: async () => undefined, recordImmediate: async () => undefined } as never, securityEvents = { record: async () => undefined } as never;
    permissions = new PermissionsService(db, cache);
    users = new UsersService(db, new UsersRepository(db), crypto, passwords, permissions, {} as never, audit, {} as never);
    sessions = new SessionService(db, config as never, logger);
    tokenService = new TokenService(new JwtService(), config as never, db, crypto, cache, audit, securityEvents, logger);
    twoFactor = new TwoFactorService(db, crypto, passwords, config as never, audit, logger);
    const lockout = new AccountLockoutService(cache, db, config as never, securityEvents, logger);
    const threat = new SecurityThreatDetectionService(db, {} as never, securityEvents, cache);
    auth = new AuthService(db, config as never, crypto, passwords, tokenService, sessions, twoFactor, lockout, users, permissions, {} as never,
      audit, threat, { enqueueTransactional: async () => undefined } as never, logger);
    jwtStrategy = new JwtStrategy(config as never, db);
    runtime = new AccountRecoveryRuntimeService(db, crypto, passwords, redisService, {} as never);
  }, 30000);

  afterAll(async () => {
    if (admin) {
      await admin.auditLog.deleteMany({ where: { tenantId: { in: [tenantId, otherTenant] }, action: { in: ['ACCOUNT_RECOVERY_COMPLETED', 'PASSWORD_CHANGED'] } } });
      await admin.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenant] } } });
      if (permissionId) await admin.permission.deleteMany({ where: { id: permissionId } });
      await db.$disconnect(); await admin.$disconnect();
    }
    if (redis) { const keys = await redis.keys(`${redisPrefix}*`); if (keys.length) await redis.del(...keys.map(key => key.slice(redisPrefix.length))); await redis.quit(); }
  }, 30000);

  it('atomically spends a two-factor challenge only once across simultaneous callers', async () => {
    const jti = randomUUID();
    const outcomes = await Promise.allSettled([tokenService.consumeTwoFactorChallenge(jti), tokenService.consumeTwoFactorChallenge(jti)]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
    expect(rejected?.reason).toMatchObject({ code: 'TOKEN_INVALID' });
  });

  it('atomically consumes recovery codes and TOTP counters across concurrent verifications', async () => {
    const recovery = await Promise.allSettled([twoFactor.verify(userId, { recoveryCode: raceCode }), twoFactor.verify(userId, { recoveryCode: raceCode })]);
    expect(recovery.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(recovery.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    const code = authenticator.generate(totpSecret);
    const totp = await Promise.allSettled([twoFactor.verify(userId, { code }), twoFactor.verify(userId, { code })]);
    expect(totp.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(totp.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
  }, 30000);

  it('resets credentials, invalidates an in-flight MFA challenge and signs in with the new password and existing MFA', async () => {
    const loginInput = { email, password: oldPassword, deviceId: 'web-device' } as never;
    const oldChallenge = await auth.login(tenant, loginInput, context);
    expect(oldChallenge).toMatchObject({ twoFactorRequired: true });
    const oldPair = await tokenService.issueTokenPair({ userId, tenantId, sessionId: oldSessionId,
      roles: ['FOLLOWER_TEST'], permissions: [`test:${userId}`], isPlatformUser: false, sessionVersion: 2 });
    const oldRotated = await auth.refresh(oldPair.refreshToken, 'old-device', context);
    const rawToken = crypto.generateToken(32);
    await admin.verificationToken.create({ data: { tenantId, userId, type: 'PASSWORD_RESET', tokenHash: crypto.hashToken(`account-recovery:${tenantId}:${rawToken}`),
      payload: { emailIndex: crypto.blindIndex(email) }, expiresAt: new Date(Date.now() + 60000) } });
    await redis.set(CACHE_KEY.accountLock(tenantId, email), JSON.stringify(Date.now() + 300000), 'EX', 300);
    const reset = await runtime.complete(tenantId, { token: rawToken, newPassword, idempotencyKey: 'recovery-login-reset-123' });
    expect(reset).toMatchObject({ status: 'RECOVERED', sessionsRevoked: 1, requiresTwoFactorEnrolment: false });
    expect(await redis.get(CACHE_KEY.accountLock(tenantId, email))).toBeNull();
    await expect(auth.verifyTwoFactor(tenant, { challengeToken: (oldChallenge as { challengeToken: string }).challengeToken, deviceId: 'web-device', recoveryCode: mfaCode } as never, context))
      .rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
    await expect(auth.login(tenant, loginInput, context)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    const challenge = await auth.login(tenant, { email, password: newPassword, deviceId: 'web-device' } as never, context);
    expect(challenge).toMatchObject({ twoFactorRequired: true });
    const signedIn = await auth.verifyTwoFactor(tenant, { challengeToken: (challenge as { challengeToken: string }).challengeToken, deviceId: 'web-device', recoveryCode: mfaCode } as never, context);
    expect(signedIn.user).toMatchObject({ id: userId, tenantId, twoFactorEnabled: true, permissions: [`test:${userId}`] });
    expect(signedIn.tokens.accessToken).toBeTruthy();
    const access = await tokenService.verifyAccessToken(signedIn.tokens.accessToken);
    await expect(jwtStrategy.validate(access)).resolves.toMatchObject({ userId, tenantId, sessionId: signedIn.sessionId, permissions: [`test:${userId}`] });
    expect(await permissions.getEffectiveAccessForTenant(userId, otherTenant)).toEqual({ roleKeys: [], permissionKeys: [] });
    await expect(auth.verifyTwoFactor(tenant, { challengeToken: (challenge as { challengeToken: string }).challengeToken, deviceId: 'web-device', recoveryCode: mfaCode } as never, context)).rejects.toBeDefined();
    const oldSession = await admin.userSession.findUniqueOrThrow({ where: { id: oldSessionId } }); expect(oldSession.revokedAt).not.toBeNull();
    // Historical rotated and active tokens from the reset session cannot be
    // used to sign the freshly authenticated user out again.
    await expect(auth.refresh(oldPair.refreshToken, 'old-device', context)).rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
    await expect(auth.refresh(oldRotated.tokens.refreshToken, 'old-device', context)).rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
    await expect(jwtStrategy.validate(access)).resolves.toMatchObject({ userId });
    await expect(auth.refresh(signedIn.tokens.refreshToken, 'wrong-device', context)).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
    const renewed = await auth.refresh(signedIn.tokens.refreshToken, 'web-device', context);
    const renewedAccess = await tokenService.verifyAccessToken(renewed.tokens.accessToken);
    await expect(jwtStrategy.validate(renewedAccess)).resolves.toMatchObject({ userId, sessionId: signedIn.sessionId });
    // Reuse of a rotated token in an active session is an actual replay and
    // atomically revokes the session and its current refresh token.
    await expect(auth.refresh(signedIn.tokens.refreshToken, 'web-device', context)).rejects.toMatchObject({ code: 'REFRESH_TOKEN_REUSE_DETECTED' });
    await expect(jwtStrategy.validate(renewedAccess)).rejects.toMatchObject({ code: 'TOKEN_REVOKED' });

    const sessionA = randomUUID(), sessionB = randomUUID();
    await admin.userSession.createMany({ data: [sessionA, sessionB].map((id, i) => ({ id, tenantId, userId, deviceId: `device-${i}`,
      ipHash: context.ipHash, expiresAt: new Date(Date.now() + 60000) })) });
    const makePair = (sessionId: string) => tokenService.issueTokenPair({ userId, tenantId, sessionId,
      roles: ['FOLLOWER_TEST'], permissions: [`test:${userId}`], isPlatformUser: false, sessionVersion: 3 });
    const [pairA, pairB] = await Promise.all([makePair(sessionA), makePair(sessionB)]);
    const accessA = await tokenService.verifyAccessToken(pairA.accessToken), accessB = await tokenService.verifyAccessToken(pairB.accessToken);
    expect(await auth.logout(userId, tenantId, sessionA, accessA.jti, accessA.exp, false, context)).toEqual({ loggedOut: true, sessionsRevoked: 1 });
    await expect(jwtStrategy.validate(accessA)).rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
    await expect(jwtStrategy.validate(accessB)).resolves.toMatchObject({ userId });
    expect(await auth.logout(userId, tenantId, sessionB, accessB.jti, accessB.exp, true, context)).toEqual({ loggedOut: true, sessionsRevoked: 1 });
    await expect(jwtStrategy.validate(accessB)).rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
    await expect(auth.refresh(pairB.refreshToken, 'device-1', context)).rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
    expect((await admin.user.findUniqueOrThrow({ where: { id: userId } })).sessionVersion).toBe(4);
  }, 30000);

  async function freshSession(deviceId: string) {
    const sessionVersion = (await admin.user.findUniqueOrThrow({ where: { id: userId } })).sessionVersion;
    const session = await sessions.createOrReuse({ tenantId, userId, deviceId, ipHash: context.ipHash, expectedSessionVersion: sessionVersion });
    const tokens = await tokenService.issueTokenPair({ userId, tenantId, sessionId: session.id, roles: ['FOLLOWER_TEST'],
      permissions: [`test:${userId}`], isPlatformUser: false, sessionVersion });
    const access = await tokenService.verifyAccessToken(tokens.accessToken);
    return { session, tokens, access, sessionVersion };
  }

  it('cannot reuse or alter a current session using a stale credential generation', async () => {
    const current = await freshSession('version-race-device');
    const before = await admin.userSession.findUniqueOrThrow({ where: { id: current.session.id } });
    await expect(sessions.createOrReuse({ tenantId, userId, deviceId: 'version-race-device', ipHash: 'different-ip',
      expectedSessionVersion: current.sessionVersion - 1 })).rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
    const after = await admin.userSession.findUniqueOrThrow({ where: { id: current.session.id } });
    expect(after.ipHash).toBe(before.ipHash);
    expect(after.revokedAt).toBeNull();
    await expect(jwtStrategy.validate(current.access)).resolves.toMatchObject({ userId });
    await admin.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } });
    await expect(sessions.createOrReuse({ tenantId, userId, deviceId: 'version-race-device', ipHash: 'suspended-ip',
      expectedSessionVersion: current.sessionVersion })).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED' });
    expect((await admin.userSession.findUniqueOrThrow({ where: { id: current.session.id } })).ipHash).toBe(before.ipHash);
    await admin.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } });
    await admin.userSession.update({ where: { id: current.session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const replacement = await sessions.createOrReuse({ tenantId, userId, deviceId: 'version-race-device', ipHash: context.ipHash,
      expectedSessionVersion: current.sessionVersion });
    expect(replacement).toMatchObject({ isNewDevice: true });
    expect(replacement.id).not.toBe(current.session.id);
    await expect(auth.refresh(current.tokens.refreshToken, 'version-race-device', context)).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
  }, 30000);

  it('concurrent refresh attempts cannot leave a live session after token reuse', async () => {
    const device = 'simultaneous-refresh-device';
    const current = await freshSession(device);
    const results = await Promise.allSettled([auth.refresh(current.tokens.refreshToken, device, context), auth.refresh(current.tokens.refreshToken, device, context)]);
    expect(results.filter((result) => result.status === 'fulfilled').length).toBeLessThanOrEqual(1);
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(failures.some((failure) => failure.reason?.code === 'REFRESH_TOKEN_REUSE_DETECTED')).toBe(true);
    expect((await admin.userSession.findUniqueOrThrow({ where: { id: current.session.id } })).revokedAt).not.toBeNull();
    expect(await admin.refreshToken.count({ where: { sessionId: current.session.id, status: 'ACTIVE' } })).toBe(0);
    for (const result of results) if (result.status === 'fulfilled') {
      await expect(jwtStrategy.validate(await tokenService.verifyAccessToken(result.value.tokens.accessToken))).rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
    }
  }, 30000);

  it('a simultaneous logout and refresh leave no usable tokens for that session', async () => {
    const device = 'logout-race-device';
    const current = await freshSession(device);
    const [logout, refresh] = await Promise.allSettled([
      auth.logout(userId, tenantId, current.session.id, current.access.jti, current.access.exp, false, context),
      auth.refresh(current.tokens.refreshToken, device, context),
    ]);
    expect(logout.status).toBe('fulfilled');
    expect((await admin.userSession.findUniqueOrThrow({ where: { id: current.session.id } })).revokedAt).not.toBeNull();
    expect(await admin.refreshToken.count({ where: { sessionId: current.session.id, status: 'ACTIVE' } })).toBe(0);
    await expect(jwtStrategy.validate(current.access)).rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
    if (refresh.status === 'fulfilled') await expect(jwtStrategy.validate(await tokenService.verifyAccessToken(refresh.value.tokens.accessToken)))
      .rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
  }, 30000);

  it('a simultaneous password recovery and refresh leave no usable old-session token', async () => {
    const device = 'recovery-refresh-race-device';
    const current = await freshSession(device);
    const rawToken = crypto.generateToken(32);
    await admin.verificationToken.create({ data: { tenantId, userId, type: 'PASSWORD_RESET', tokenHash: crypto.hashToken(`account-recovery:${tenantId}:${rawToken}`),
      payload: { emailIndex: crypto.blindIndex(email) }, expiresAt: new Date(Date.now() + 60000) } });
    const [reset, refresh] = await Promise.allSettled([
      runtime.complete(tenantId, { token: rawToken, newPassword: 'Telescope#Leaves597!', idempotencyKey: 'recovery-refresh-race-123' }),
      auth.refresh(current.tokens.refreshToken, device, context),
    ]);
    expect(reset.status).toBe('fulfilled');
    if (reset.status === 'fulfilled') expect(reset.value.status).toBe('RECOVERED');
    expect((await admin.user.findUniqueOrThrow({ where: { id: userId } })).sessionVersion).toBe(current.sessionVersion + 1);
    expect((await admin.userSession.findUniqueOrThrow({ where: { id: current.session.id } })).revokedAt).not.toBeNull();
    expect(await admin.refreshToken.count({ where: { sessionId: current.session.id, status: 'ACTIVE' } })).toBe(0);
    await expect(jwtStrategy.validate(current.access)).rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
    if (refresh.status === 'fulfilled') await expect(jwtStrategy.validate(await tokenService.verifyAccessToken(refresh.value.tokens.accessToken)))
      .rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
  }, 30000);

  it('lists and revokes only the owner’s sessions with forced RLS', async () => {
    const current = await freshSession('session-current-device'), other = await freshSession('session-other-device');
    const list = await sessions.listForUser(tenantId, userId, current.session.id);
    expect(list).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: current.session.id, isCurrent: true }),
      expect.objectContaining({ id: other.session.id, isCurrent: false }),
    ]));
    expect(await sessions.listForUser(otherTenant, userId, current.session.id)).toEqual([]);
    await expect(sessions.revoke(otherTenant, userId, other.session.id, 'foreign')).rejects.toBeDefined();
    await expect(jwtStrategy.validate(other.access)).resolves.toMatchObject({ userId });
    await sessions.revoke(tenantId, userId, other.session.id, 'user_revoked', current.session.id);
    await expect(jwtStrategy.validate(other.access)).rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
    await expect(auth.refresh(other.tokens.refreshToken, 'session-other-device', context)).rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
    const another = await freshSession('session-third-device');
    expect(await sessions.revokeAll(tenantId, userId, current.session.id, 'user_revoked_others')).toBeGreaterThanOrEqual(1);
    await expect(jwtStrategy.validate(another.access)).rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
    await expect(jwtStrategy.validate(current.access)).resolves.toMatchObject({ userId });
    await admin.userSession.update({ where: { id: current.session.id }, data: { revokedAt: new Date() } });
    const newSession = await freshSession('session-after-recovery');
    await expect(sessions.revoke(tenantId, userId, newSession.session.id, 'stale-request', current.session.id))
      .rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
    await expect(sessions.revokeAll(tenantId, userId, current.session.id, 'stale-request')).rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
    await expect(jwtStrategy.validate(newSession.access)).resolves.toMatchObject({ userId });
  }, 30000);

  it('serializes IdP session revocation with refresh under forced RLS', async () => {
    const target = await freshSession('saml-target-device'), kept = await freshSession('saml-kept-device');
    const configurationId = randomUUID(), subjectHash = 'saml-subject-test';
    await admin.userSession.update({ where: { id: target.session.id }, data: { authMethod: 'SSO_SAML', ssoConfigurationId: configurationId,
      ssoSubjectHash: subjectHash, ssoSessionIndexHash: 'index-target' } });
    await admin.userSession.update({ where: { id: kept.session.id }, data: { authMethod: 'SSO_SAML', ssoConfigurationId: configurationId,
      ssoSubjectHash: subjectHash, ssoSessionIndexHash: 'index-kept' } });
    const [revocation, refresh] = await Promise.allSettled([
      sessions.revokeSamlSubjectSessions({ tenantId, configurationId, subjectHash, sessionIndexHashes: ['index-target'], reason: 'idp_logout' }),
      auth.refresh(target.tokens.refreshToken, 'saml-target-device', context),
    ]);
    expect(revocation).toMatchObject({ status: 'fulfilled', value: 1 });
    expect((await admin.userSession.findUniqueOrThrow({ where: { id: target.session.id } })).revokedAt).not.toBeNull();
    expect(await admin.refreshToken.count({ where: { tenantId, sessionId: target.session.id, status: 'ACTIVE' } })).toBe(0);
    await expect(jwtStrategy.validate(target.access)).rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
    if (refresh.status === 'fulfilled') await expect(jwtStrategy.validate(await tokenService.verifyAccessToken(refresh.value.tokens.accessToken)))
      .rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
    await expect(jwtStrategy.validate(kept.access)).resolves.toMatchObject({ userId });
  }, 30000);

  it('rolls back password and session changes if the audit write fails', async () => {
    const currentPassword = 'Bicycle#Cloud583!', nextPassword = 'Compass#River829!';
    const previousHash = await passwords.hash(currentPassword);
    await admin.user.update({ where: { id: userId }, data: { passwordHash: previousHash } });
    const current = await freshSession('password-rollback-current'), other = await freshSession('password-rollback-other');
    const before = await admin.user.findUniqueOrThrow({ where: { id: userId } });
    const suffix = userId.replace(/-/g, ''), fn = `test_password_audit_${suffix}`, trigger = `test_password_audit_${suffix}`;
    await admin.$executeRawUnsafe(`CREATE FUNCTION public.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.actor_id = '${userId}'::uuid AND NEW.action = 'PASSWORD_CHANGED' THEN RAISE EXCEPTION 'test audit failure'; END IF;
      RETURN NEW; END $$`);
    try {
      await admin.$executeRawUnsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.${fn}()`);
      await expect(auth.changePassword(userId, tenantId, current.session.id,
        { currentPassword, newPassword: nextPassword, revokeOtherSessions: true }, context)).rejects.toBeDefined();
      const after = await admin.user.findUniqueOrThrow({ where: { id: userId } });
      expect(after.passwordHash).toBe(before.passwordHash);
      expect(after.sessionVersion).toBe(before.sessionVersion);
      await expect(jwtStrategy.validate(current.access)).resolves.toMatchObject({ userId });
      await expect(jwtStrategy.validate(other.access)).resolves.toMatchObject({ userId });
      expect(await admin.refreshToken.count({ where: { sessionId: other.session.id, status: 'ACTIVE' } })).toBe(1);
    } finally {
      await admin.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON public.audit_logs`);
      await admin.$executeRawUnsafe(`DROP FUNCTION IF EXISTS public.${fn}()`);
    }
  }, 30000);

  it('changes the password atomically and cannot overwrite a concurrent recovery', async () => {
    const currentPassword = 'Garden#Violin673!', updatedPassword = 'Harbor#Lantern951!';
    await admin.user.update({ where: { id: userId }, data: { passwordHash: await passwords.hash(currentPassword) } });
    const current = await freshSession('password-current-device'), other = await freshSession('password-other-device');
    await expect(auth.changePassword(userId, tenantId, current.session.id,
      { currentPassword: 'incorrect', newPassword: updatedPassword, revokeOtherSessions: true }, context))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    const result = await auth.changePassword(userId, tenantId, current.session.id,
      { currentPassword, newPassword: updatedPassword, revokeOtherSessions: true }, context);
    expect(result).toMatchObject({ changed: true });
    expect(result.sessionsRevoked).toBeGreaterThanOrEqual(1);
    expect(await passwords.verify((await admin.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash, updatedPassword)).toBe(true);
    await expect(jwtStrategy.validate(other.access)).rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
    await expect(auth.refresh(other.tokens.refreshToken, 'password-other-device', context)).rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
    const renewed = await auth.refresh(current.tokens.refreshToken, 'password-current-device', context);
    await expect(jwtStrategy.validate(await tokenService.verifyAccessToken(renewed.tokens.accessToken))).resolves.toMatchObject({ userId });
    expect(await admin.auditLog.count({ where: { tenantId, actorId: userId, action: 'PASSWORD_CHANGED' } })).toBeGreaterThanOrEqual(1);

    const raw = crypto.generateToken(32), resetPassword = 'Telescope#Forest897!', concurrentPassword = 'Sunrise#Canyon634!';
    await admin.verificationToken.create({ data: { tenantId, userId, type: 'PASSWORD_RESET',
      tokenHash: crypto.hashToken(`account-recovery:${tenantId}:${raw}`), payload: { emailIndex: crypto.blindIndex(email) },
      expiresAt: new Date(Date.now() + 60000) } });
    let release!: () => void, reached!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const hashing = new Promise<void>((resolve) => { reached = resolve; });
    const originalHash = passwords.hash.bind(passwords);
    const spy = jest.spyOn(passwords, 'hash').mockImplementation(async (value) => {
      if (value === concurrentPassword) { reached(); await gate; }
      return originalHash(value);
    });
    const competing = auth.changePassword(userId, tenantId, current.session.id,
      { currentPassword: updatedPassword, newPassword: concurrentPassword, revokeOtherSessions: true }, context);
    try {
      await hashing;
      await expect(runtime.complete(tenantId, { token: raw, newPassword: resetPassword, idempotencyKey: 'recovery-password-race' }))
        .resolves.toMatchObject({ status: 'RECOVERED' });
      release();
      await expect(competing).rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
      const finalHash = (await admin.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash;
      expect(await passwords.verify(finalHash, resetPassword)).toBe(true);
      expect(await passwords.verify(finalHash, concurrentPassword)).toBe(false);
    } finally { release(); spy.mockRestore(); }
  }, 30000);

  it('rejects password changes from a revoked or expired current session', async () => {
    const currentPassword = 'Marble#Harbor941!', attempted = 'Planet#Cedar552!';
    const hash = await passwords.hash(currentPassword);
    await admin.user.update({ where: { id: userId }, data: { passwordHash: hash } });
    const revoked = await freshSession('password-revoked-device'), expired = await freshSession('password-expired-device');
    await admin.userSession.update({ where: { id: revoked.session.id }, data: { revokedAt: new Date() } });
    await admin.userSession.update({ where: { id: expired.session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    for (const id of [revoked.session.id, expired.session.id]) {
      await expect(auth.changePassword(userId, tenantId, id,
        { currentPassword, newPassword: attempted, revokeOtherSessions: true }, context)).rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
    }
    expect((await admin.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash).toBe(hash);
  }, 30000);

  it('performs recovery and MFA sign-in through real Nest HTTP routes and verified custom-domain resolution', async () => {
    const domain = `owner-${userId}.customer.test`, otherDomain = `other-${otherTenant}.customer.test`;
    await admin.tenantDomain.createMany({ data: [
      { tenantId, domain, status: 'ACTIVE', isPrimary: true, verificationToken: 'synthetic', verifiedAt: new Date(), certificateExpiry: new Date(Date.now() + 60000) },
      { tenantId: otherTenant, domain: otherDomain, status: 'ACTIVE', isPrimary: true, verificationToken: 'synthetic', verifiedAt: new Date(), certificateExpiry: new Date(Date.now() + 60000) },
    ] });
    const raw = crypto.generateToken(32), changedPassword = 'Lantern#Mountain745!';
    await admin.verificationToken.create({ data: { tenantId, userId, type: 'PASSWORD_RESET',
      tokenHash: crypto.hashToken(`account-recovery:${tenantId}:${raw}`), payload: { emailIndex: crypto.blindIndex(email) },
      expiresAt: new Date(Date.now() + 60000) } });
    const module = await Test.createTestingModule({
      controllers: [AccountRecoveryController, AuthController, SessionsController],
      providers: [
        { provide: AccountRecoveryRuntimeService, useValue: runtime },
        { provide: AuthService, useValue: auth },
        { provide: UsersService, useValue: users },
        { provide: SessionService, useValue: sessions },
        { provide: AuditService, useValue: { record: async () => undefined } },
      ],
    }).compile();
    const app = module.createNestApplication();
    const tenantMiddleware = new TenantResolutionMiddleware(new TenantResolverService(db, {} as never),
      { platformRootDomain: 'platform.test', defaultTenantSlug: 'no-such-tenant' } as never);
    app.use((req: any, _res: unknown, next: () => void) => {
      Object.assign(req, { requestId: 'http-test', correlationId: 'http-test', ipHash: context.ipHash, locale: 'en' });
      next();
    });
    app.use((req: any, res: any, next: () => void) => { void tenantMiddleware.use(req, res, next); });
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1', prefix: 'v' });
    app.useGlobalGuards(new JwtAuthGuard(new Reflector(), tokenService));
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    try {
      const http = request(app.getHttpServer());
      const wrongTenant = await http.post('/api/v1/auth/recovery/verify').set('Host', otherDomain).send({ token: raw }).expect(200);
      expect(wrongTenant.body.valid).toBe(false);
      const verified = await http.post('/api/v1/auth/recovery/verify').set('Host', domain).send({ token: raw }).expect(200);
      expect(verified.body.valid).toBe(true);
      const input = { token: raw, newPassword: changedPassword };
      const reset = await http.post('/api/v1/auth/recovery/complete').set('Host', domain).set('Idempotency-Key', 'http-reset-key-123').send(input).expect(200);
      expect(reset.body.status).toBe('RECOVERED');
      const replay = await http.post('/api/v1/auth/recovery/complete').set('Host', domain).set('Idempotency-Key', 'http-reset-key-123').send(input).expect(200);
      expect(replay.body).toEqual(reset.body);
      const login = await http.post('/api/v1/auth/login').set('Host', domain)
        .send({ email, password: changedPassword, deviceId: 'http-browser-device' }).expect(200);
      expect(login.body.twoFactorRequired).toBe(true);
      const verifiedMfa = await http.post('/api/v1/auth/two-factor/verify').set('Host', domain)
        .send({ challengeToken: login.body.challengeToken, recoveryCode: httpMfaCode, deviceId: 'http-browser-device' }).expect(200);
      const access = await tokenService.verifyAccessToken(verifiedMfa.body.tokens.accessToken);
      await expect(jwtStrategy.validate(access)).resolves.toMatchObject({ tenantId, userId });
      const refresh = await http.post('/api/v1/auth/refresh').set('Host', domain)
        .send({ refreshToken: verifiedMfa.body.tokens.refreshToken, deviceId: 'http-browser-device' }).expect(200);
      await expect(jwtStrategy.validate(await tokenService.verifyAccessToken(refresh.body.tokens.accessToken))).resolves.toMatchObject({ tenantId, userId });
      const bearer = `Bearer ${refresh.body.tokens.accessToken}`;
      const extra = await freshSession('http-other-device');
      const listed = await http.get('/api/v1/auth/sessions').set('Host', domain).set('Authorization', bearer).expect(200);
      expect(listed.body).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: verifiedMfa.body.sessionId, isCurrent: true }),
        expect.objectContaining({ id: extra.session.id, isCurrent: false }),
      ]));
      await http.delete(`/api/v1/auth/sessions/${extra.session.id}`).set('Host', domain).set('Authorization', bearer)
        .send({ reason: 'user_revoked' }).expect(200);
      await expect(jwtStrategy.validate(extra.access)).rejects.toMatchObject({ code: 'TOKEN_REVOKED' });
      const finalPassword = 'Sailboat#Forest598!';
      await http.post('/api/v1/auth/change-password').set('Host', domain).set('Authorization', bearer)
        .send({ currentPassword: changedPassword, newPassword: finalPassword, revokeOtherSessions: true }).expect(200);
      await http.get('/api/v1/auth/sessions').set('Host', domain).set('Authorization', bearer).expect(401);
      const postChange = await http.post('/api/v1/auth/refresh').set('Host', domain)
        .send({ refreshToken: refresh.body.tokens.refreshToken, deviceId: 'http-browser-device' }).expect(200);
      await expect(jwtStrategy.validate(await tokenService.verifyAccessToken(postChange.body.tokens.accessToken))).resolves.toMatchObject({ tenantId, userId });
    } finally { await app.close(); }
  }, 30000);
});
