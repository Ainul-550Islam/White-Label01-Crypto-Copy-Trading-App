import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Prisma } from '@prisma/client';
import type { SealedPayload } from '@wlct/utils';
import type { Job } from 'bullmq';

import { AppConfigService } from '../../config/app-config.service';
import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { AccountRecoveryMailer } from './account-recovery-mailer.service';
import { RECOVERY_JOB, RECOVERY_QUEUE, RECOVERY_READY_KEY, RECOVERY_TTL_MS, emailAad, tokenAad, type RecoveryDeliveryJob } from './account-recovery-runtime.types';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function validHost(host: string): boolean {
  return host.length <= 253 && host.includes('.') && host.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

@Injectable()
@Processor(RECOVERY_QUEUE, { concurrency: 4 })
export class AccountRecoveryDeliveryProcessor extends WorkerHost implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private pulsing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
    private readonly mailer: AccountRecoveryMailer,
  ) { super(); }

  async onApplicationBootstrap(): Promise<void> {
    // Recovery must not depend on the trading worker's engine readiness. A
    // properly configured API replica may consume this dedicated mail queue;
    // no trade or settlement work is enabled by this processor.
    if (!this.mailer.isConfigured()) { await this.worker.close(); return; }
    await this.pulse();
    this.timer = setInterval(() => { void this.pulse(); }, 15_000);
    this.timer.unref();
  }

  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  private async pulse(): Promise<void> {
    if (this.pulsing) return;
    this.pulsing = true;
    try {
      if (await this.mailer.verify()) await this.redis.client.set(RECOVERY_READY_KEY, 'ready', 'EX', 45);
    } catch { /* Expiry removes readiness if Redis or SMTP is unavailable. */ }
    finally { this.pulsing = false; }
  }

  async process(job: Job<RecoveryDeliveryJob>): Promise<{ processed: true }> {
    if (job.name !== RECOVERY_JOB || !job.id) throw new Error('RECOVERY_JOB_INVALID');
    if (job.data.completed) return { processed: true };
    const { tenantId, tokenId, emailFingerprint, emailCiphertext, requestedAt } = job.data;
    const age = Date.now() - requestedAt;
    if (!emailCiphertext || !Number.isFinite(age) || age < 0 || age >= RECOVERY_TTL_MS) {
      await job.updateData({ ...job.data, emailCiphertext: null, completed: true });
      return { processed: true };
    }
    const email = this.crypto.decrypt(emailCiphertext, emailAad(tenantId, tokenId)).trim().toLowerCase();
    if (this.crypto.blindIndex(`account-recovery-email:${tenantId}:${email}`) !== emailFingerprint) throw new Error('RECOVERY_JOB_INVALID');
    const emailIndex = this.crypto.blindIndex(email);
    const expiresAt = new Date(requestedAt + RECOVERY_TTL_MS);

    const delivery = await this.prisma.withTenantRls(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`recovery:${tenantId}:${tokenId}`}::text, 0))::text AS locked`;
      const existing = await tx.verificationToken.findFirst({ where: { id: tokenId, tenantId, type: 'PASSWORD_RESET' } });
      const prior = record(existing?.payload);
      if (existing && prior.deliveryState === 'SENT') return { kind: 'done' as const };
      const candidateUser = await tx.user.findFirst({
        where: { tenantId, emailIndex, deletedAt: null, emailVerifiedAt: { not: null }, status: { in: ['ACTIVE', 'LOCKED'] } },
        select: { id: true },
      });
      if (!candidateUser) return { kind: 'done' as const };
      // A reset or email change and issuance must agree on the same account
      // state. A job queued before a completed password change cannot create a
      // fresh usable token after that reset has invalidated earlier links.
      await tx.$queryRaw`SELECT id FROM "users" WHERE tenant_id = ${tenantId}::uuid AND id = ${candidateUser.id}::uuid FOR UPDATE`;
      const user = await tx.user.findFirst({
        where: { id: candidateUser.id, tenantId, emailIndex, deletedAt: null, emailVerifiedAt: { not: null }, status: { in: ['ACTIVE', 'LOCKED'] } },
        select: { id: true, email: true, emailIndex: true, passwordChangedAt: true },
      });
      if (!user || user.email.trim().toLowerCase() !== email || user.passwordChangedAt.getTime() >= requestedAt) return { kind: 'done' as const };
      const tenant = await tx.tenant.findFirst({ where: { id: tenantId, status: 'ACTIVE', deletedAt: null }, select: { slug: true } });
      if (!tenant) return { kind: 'done' as const };
      const primary = await tx.tenantDomain.findFirst({
        where: { tenantId, isPrimary: true, status: 'ACTIVE', verifiedAt: { not: null }, certificateExpiry: { gt: new Date() } },
        select: { domain: true },
      });
      const root = this.config.platformRootDomain.toLowerCase();
      const slug = tenant.slug.toLowerCase();
      const candidate = primary?.domain.toLowerCase() ?? `${slug}.${root}`;
      if (!validHost(candidate) || (!primary && (!validHost(root) || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)))) {
        throw new Error('RECOVERY_DOMAIN_UNAVAILABLE');
      }

      let token: string;
      if (existing) {
        if (existing.userId !== user.id || existing.consumedAt || existing.expiresAt <= new Date() || prior.emailIndex !== emailIndex || !prior.tokenCiphertext) return { kind: 'done' as const };
        token = this.crypto.decrypt(prior.tokenCiphertext as SealedPayload, tokenAad(tenantId, tokenId));
        if (existing.tokenHash !== this.crypto.hashToken(`account-recovery:${tenantId}:${token}`)) throw new Error('RECOVERY_TOKEN_INTEGRITY');
      } else {
        token = this.crypto.generateToken(32);
        await tx.verificationToken.create({ data: {
          id: tokenId, tenantId, userId: user.id, type: 'PASSWORD_RESET',
          tokenHash: this.crypto.hashToken(`account-recovery:${tenantId}:${token}`), expiresAt,
          payload: { emailIndex, deliveryState: 'PENDING', tokenCiphertext: this.crypto.encrypt(token, tokenAad(tenantId, tokenId)) } as unknown as Prisma.InputJsonValue,
        } });
      }
      return { kind: 'send' as const, recipient: user.email, link: `https://${candidate}/recovery#token=${encodeURIComponent(token)}`, emailIndex };
    });
    if (delivery.kind === 'send') {
      await this.mailer.send(delivery.recipient, delivery.link);
      await this.prisma.withTenantRls(tenantId, async (tx) => {
        // The link may already have been redeemed; never restore its encrypted
        // token or overwrite a completed reset's idempotency evidence.
        await tx.verificationToken.updateMany({
          where: { id: tokenId, tenantId, consumedAt: null },
          data: { payload: { emailIndex: delivery.emailIndex, deliveryState: 'SENT' } },
        });
      });
    }
    await job.updateData({ ...job.data, emailCiphertext: null, completed: true });
    return { processed: true };
  }
}
