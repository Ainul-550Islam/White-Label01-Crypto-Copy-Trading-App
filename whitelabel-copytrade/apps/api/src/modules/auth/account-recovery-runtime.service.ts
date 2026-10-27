import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { CACHE_KEY } from '@wlct/config';
import type { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';

import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import { PasswordService } from '../../infrastructure/crypto/password.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import {
  RECOVERY_JOB, RECOVERY_QUEUE, RECOVERY_READY_KEY, RECOVERY_TTL_MS,
  emailAad, type RecoveryDeliveryJob,
} from './account-recovery-runtime.types';

const REQUEST_MESSAGE = 'If an eligible account matches, recovery instructions may be sent.';
const INVALID_MESSAGE = 'This recovery link is invalid, expired or already used.';
const COMPLETE_MESSAGE = 'Your password was changed and your existing sessions were signed out.';
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,128}$/;

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function mutationKey(key: string | undefined): string {
  if (!key || !KEY_PATTERN.test(key)) throw new BadRequestException('A valid Idempotency-Key is required.');
  return key;
}

/**
 * Public recovery uses a tenant resolved from the host, not a global email lookup.
 * Queuing precedes any account lookup so an HTTP response cannot reveal whether
 * an address exists. Password, token consumption and session revocation commit in
 * one database transaction; the existing second factor is deliberately retained.
 */
@Injectable()
export class AccountRecoveryRuntimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly passwords: PasswordService,
    private readonly redis: RedisService,
    @InjectQueue(RECOVERY_QUEUE) private readonly queue: Queue<RecoveryDeliveryJob>,
  ) {}

  private hashToken(tenantId: string, token: string): string {
    return this.crypto.hashToken(`account-recovery:${tenantId}:${token}`);
  }

  async request(tenantId: string, input: { email: string; idempotencyKey?: string }): Promise<{ accepted: true; message: string }> {
    const key = mutationKey(input.idempotencyKey);
    const email = input.email.trim().toLowerCase();
    const jobId = this.crypto.sha256(`account-recovery-job:${tenantId}:${key}`);
    const fingerprint = this.crypto.blindIndex(`account-recovery-email:${tenantId}:${email}`);
    const reply = { accepted: true as const, message: REQUEST_MESSAGE };

    try {
      const existing = await this.queue.getJob(jobId);
      if (existing) {
        if (existing.data.emailFingerprint !== fingerprint) throw new ConflictException('Idempotency-Key was used for a different request.');
        return reply;
      }
      if (!(await this.redis.client.get(RECOVERY_READY_KEY))) {
        throw new ServiceUnavailableException('Account recovery delivery is temporarily unavailable.');
      }
      // Limit every address in exactly the same way, whether registered or not.
      // The counter key is a keyed digest, never a raw email address.
      const count = await this.redis.client.eval(
        'local n=redis.call("INCR",KEYS[1]); if n==1 then redis.call("EXPIRE",KEYS[1],ARGV[1]); end; return n',
        1, `account-recovery:address:${tenantId}:${fingerprint}`, 3600,
      );
      if (typeof count !== 'number' || !Number.isFinite(count)) throw new Error('RECOVERY_RATE_LIMIT_UNAVAILABLE');
      if (count > 5) return reply;
      const tokenId = randomUUID();
      const data: RecoveryDeliveryJob = {
        tenantId, tokenId, emailFingerprint: fingerprint,
        emailCiphertext: this.crypto.encrypt(email, emailAad(tenantId, tokenId)),
        requestedAt: Date.now(),
      };
      await this.queue.add(RECOVERY_JOB, data, {
        jobId, attempts: 8, backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 3600, count: 10000 },
        removeOnFail: { age: 86400, count: 10000 },
      });
      // BullMQ deduplicates concurrent additions by job id; verify the winning
      // payload so a key cannot silently be rebound to another email.
      const winner = await this.queue.getJob(jobId);
      if (!winner || winner.data.emailFingerprint !== fingerprint) {
        throw new ConflictException('Idempotency-Key was used for a different request.');
      }
      return reply;
    } catch (error) {
      if (error instanceof ConflictException || error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Account recovery delivery is temporarily unavailable.');
    }
  }

  async verify(tenantId: string, token: string): Promise<{ valid: boolean; reason: string | null; message: string }> {
    if (!TOKEN_PATTERN.test(token)) return { valid: false, reason: 'INVALID_TOKEN', message: INVALID_MESSAGE };
    const hash = this.hashToken(tenantId, token);
    const valid = await this.prisma.withTenantRls(tenantId, async (tx) => {
      const [row, tenant] = await Promise.all([
        tx.verificationToken.findFirst({
          where: { tenantId, type: 'PASSWORD_RESET', tokenHash: hash, consumedAt: null, expiresAt: { gt: new Date() } },
          include: { user: { select: { tenantId: true, emailIndex: true, emailVerifiedAt: true, deletedAt: true, status: true } } },
        }),
        tx.tenant.findFirst({ where: { id: tenantId, status: 'ACTIVE', deletedAt: null }, select: { id: true } }),
      ]);
      const payload = objectValue(row?.payload);
      return !!tenant && !!row && row.user.tenantId === tenantId && row.user.deletedAt === null &&
        row.user.emailVerifiedAt !== null && ['ACTIVE', 'LOCKED'].includes(row.user.status) &&
        payload.emailIndex === row.user.emailIndex;
    });
    return valid
      ? { valid: true, reason: null, message: 'Recovery link confirmed.' }
      : { valid: false, reason: 'INVALID_TOKEN', message: INVALID_MESSAGE };
  }

  async complete(tenantId: string, input: { token: string; newPassword: string; idempotencyKey?: string; ipHash?: string | null; requestId?: string | null }): Promise<{
    status: 'RECOVERED' | 'REFUSED'; reason: string | null; message: string; sessionsRevoked: number; requiresTwoFactorEnrolment: boolean;
  }> {
    const key = mutationKey(input.idempotencyKey);
    const refused = { status: 'REFUSED' as const, reason: 'INVALID_TOKEN', message: INVALID_MESSAGE, sessionsRevoked: 0, requiresTwoFactorEnrolment: false };
    if (!TOKEN_PATTERN.test(input.token)) return refused;
    const tokenHash = this.hashToken(tenantId, input.token);
    const keyHash = this.crypto.blindIndex(`account-recovery-complete-key:${tenantId}:${key}`);
    const intentHash = this.crypto.blindIndex(JSON.stringify(['account-recovery-complete-v1', tenantId, input.token, input.newPassword]));
    const first = await this.prisma.withTenantRls(tenantId, async (tx) => {
      const tenant = await tx.tenant.findFirst({ where: { id: tenantId, status: 'ACTIVE', deletedAt: null }, select: { id: true } });
      if (!tenant) return null;
      return tx.verificationToken.findFirst({
        where: { tenantId, type: 'PASSWORD_RESET', tokenHash },
        include: { user: { select: { id: true, tenantId: true, email: true, emailIndex: true, emailVerifiedAt: true, deletedAt: true, status: true } } },
      });
    });
    if (!first) return refused;
    const initialPayload = objectValue(first.payload);
    if (first.consumedAt) {
      if (initialPayload.completeKeyHash === keyHash && initialPayload.completeIntentHash === intentHash &&
          typeof initialPayload.sessionsRevoked === 'number') {
        return { status: 'RECOVERED', reason: null, message: COMPLETE_MESSAGE, sessionsRevoked: initialPayload.sessionsRevoked, requiresTwoFactorEnrolment: false };
      }
      return refused;
    }
    if (first.expiresAt.getTime() <= Date.now() || first.user.tenantId !== tenantId || first.user.deletedAt !== null ||
        first.user.emailVerifiedAt === null || !['ACTIVE', 'LOCKED'].includes(first.user.status) || initialPayload.emailIndex !== first.user.emailIndex) return refused;
    try { this.passwords.assertPolicy(input.newPassword, { email: first.user.email }); }
    catch { throw new BadRequestException('Password does not meet security requirements.'); }
    const passwordHash = await this.passwords.hash(input.newPassword);

    const outcome = await this.prisma.withTenantRls(tenantId, async (tx) => {
      // Public endpoints do not run the authenticated tenant guard. Hold a
      // shared tenant lock so suspension cannot race this credential change.
      const tenant = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "tenants" WHERE id = ${tenantId}::uuid AND status = 'ACTIVE' AND deleted_at IS NULL FOR SHARE
      `;
      if (tenant.length !== 1) return refused;
      // Serialize resets, email changes and token issuance on the account row.
      // Without this lock two valid links could both win or an old email could
      // redeem a token concurrently with an address change.
      await tx.$queryRaw`SELECT id FROM "users" WHERE tenant_id = ${tenantId}::uuid AND id = ${first.user.id}::uuid FOR UPDATE`;
      const row = await tx.verificationToken.findFirst({
        where: { id: first.id, tenantId, type: 'PASSWORD_RESET', tokenHash },
        include: { user: { select: { id: true, tenantId: true, email: true, emailIndex: true, emailVerifiedAt: true, deletedAt: true, status: true } } },
      });
      if (!row) return refused;
      const payload = objectValue(row.payload);
      if (row.consumedAt) {
        if (payload.completeKeyHash === keyHash && payload.completeIntentHash === intentHash && typeof payload.sessionsRevoked === 'number') {
          return { status: 'RECOVERED' as const, reason: null, message: COMPLETE_MESSAGE, sessionsRevoked: payload.sessionsRevoked, requiresTwoFactorEnrolment: false };
        }
        return refused;
      }
      const now = new Date();
      if (row.expiresAt <= now || row.user.tenantId !== tenantId || row.user.deletedAt !== null || row.user.emailVerifiedAt === null ||
          !['ACTIVE', 'LOCKED'].includes(row.user.status) || payload.emailIndex !== row.user.emailIndex ||
          row.user.emailIndex !== first.user.emailIndex || row.user.email !== first.user.email) return refused;
      const consumed = await tx.verificationToken.updateMany({ where: { id: row.id, tenantId, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
      if (consumed.count !== 1) return refused;
      const revoked = await tx.userSession.updateMany({ where: { tenantId, userId: row.userId, revokedAt: null }, data: { revokedAt: now, revokeReason: 'ACCOUNT_RECOVERY' } });
      await tx.refreshToken.updateMany({ where: { tenantId, userId: row.userId, status: 'ACTIVE' }, data: { status: 'REVOKED', revokedAt: now, revokeReason: 'ACCOUNT_RECOVERY' } });
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash, passwordChangedAt: now, sessionVersion: { increment: 1 },
        failedLoginAttempts: 0, lockedUntil: null, ...(row.user.status === 'LOCKED' ? { status: 'ACTIVE' as const } : {}) } });
      await tx.verificationToken.updateMany({ where: { tenantId, userId: row.userId, type: 'PASSWORD_RESET', consumedAt: null }, data: { consumedAt: now, payload: {} } });
      await tx.verificationToken.update({ where: { id: row.id }, data: { payload: {
        completeKeyHash: keyHash, completeIntentHash: intentHash, sessionsRevoked: revoked.count,
      } as Prisma.InputJsonValue } });
      await tx.auditLog.create({ data: {
        tenantId, actorType: 'USER', actorId: row.userId, action: 'ACCOUNT_RECOVERY_COMPLETED', outcome: 'SUCCESS',
        resourceType: 'User', resourceId: row.userId, description: 'Password reset; sessions and refresh tokens revoked.',
        ipHash: input.ipHash ?? null, requestId: input.requestId ?? null,
      } });
      return { status: 'RECOVERED' as const, reason: null, message: COMPLETE_MESSAGE, sessionsRevoked: revoked.count, requiresTwoFactorEnrolment: false };
    });
    if (outcome.status === 'RECOVERED') {
      // The database is the security boundary. A transient Redis failure can
      // leave the old lockout until its TTL, but cannot undo the committed reset.
      await this.redis.client.del(CACHE_KEY.loginFailures(tenantId, first.user.email), CACHE_KEY.accountLock(tenantId, first.user.email)).catch(() => undefined);
    }
    return outcome;
  }
}
