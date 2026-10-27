// # Session-bound encrypted push registration and at-least-once provider delivery.
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedActor } from '@wlct/shared-types';
import type { SealedPayload } from '@wlct/utils';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CryptoService } from '../../../infrastructure/crypto/crypto.service';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PushNotificationService } from '../../billing/notifications/push-notification.service';
import { NotificationChannel } from '../../billing/notifications/billing-notification.types';
import { ApnsPushService } from './apns-push.service';

export const PUSH_JOB_NAME = 'mobile-push-delivery';
export interface PushJob { tenantId: string; userId: string; locale: string; category?: string; critical?: boolean; }
interface Device { id: string; sessionId: string; platform: 'FCM' | 'APNS'; tokenSealed: SealedPayload; }
const generic: Record<string, [string, string]> = {
  en: ['New account activity', 'Open the app to review your notification.'],
  bn: ['অ্যাকাউন্টে নতুন কার্যকলাপ', 'বিজ্ঞপ্তি দেখতে অ্যাপ খুলুন।'],
  ar: ['نشاط جديد في الحساب', 'افتح التطبيق لمراجعة الإشعار.'],
  es: ['Nueva actividad en la cuenta', 'Abre la aplicación para revisar la notificación.'],
  tr: ['Yeni hesap etkinliği', 'Bildirimi incelemek için uygulamayı açın.'],
};
@Injectable()
export class PushDeviceService {
  constructor(private readonly prisma: PrismaService, private readonly crypto: CryptoService,
    private readonly fcm: PushNotificationService, private readonly apns: ApnsPushService) {}

  async register(actor: AuthenticatedActor, platform: 'FCM' | 'APNS', token: string, key: string): Promise<{ registered: true }> {
    if (typeof token !== 'string' || token.length < 20 || token.length > 4096 || /[\x00-\x20\x7f]/.test(token) || (platform === 'APNS' && !/^[a-fA-F0-9]{64,200}$/.test(token))) throw new BadRequestException('Invalid device registration');
    const aad = `${actor.tenantId}:${actor.userId}:${actor.sessionId}:mobile-push`;
    const sealed = JSON.stringify(this.crypto.encrypt(token, aad)), tokenHash = this.crypto.hashToken(token);
    await this.prisma.withTenantRls(actor.tenantId, async (tx) => {
      const session = await tx.userSession.findFirst({ where: { id: actor.sessionId, tenantId: actor.tenantId, userId: actor.userId, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } });
      if (!session) throw new NotFoundException('Active session not found');
      const resource = createHash('sha256').update(`${actor.sessionId}:${platform}:${tokenHash}`).digest('hex');
      if (!await this.claim(tx, actor.tenantId, key, 'push.register', resource)) {
        const current = await tx.$queryRaw<Array<{ tokenHash: string; platform: string }>>`SELECT token_hash AS "tokenHash", platform FROM mobile_push_devices WHERE tenant_id=${actor.tenantId}::uuid AND user_id=${actor.userId}::uuid AND session_id=${actor.sessionId}::uuid AND revoked_at IS NULL`;
        if (current[0]?.tokenHash !== tokenHash || current[0]?.platform !== platform) throw new ConflictException('Registration has changed');
        return;
      }
      await tx.$executeRaw`INSERT INTO mobile_push_devices (tenant_id, user_id, session_id, platform, token_hash, token_sealed, revoked_at, updated_at)
        VALUES (${actor.tenantId}::uuid, ${actor.userId}::uuid, ${actor.sessionId}::uuid, ${platform}, ${tokenHash}, ${sealed}::jsonb, NULL, CURRENT_TIMESTAMP)
        ON CONFLICT (tenant_id, user_id, session_id) DO UPDATE SET platform=EXCLUDED.platform, token_hash=EXCLUDED.token_hash, token_sealed=EXCLUDED.token_sealed, revoked_at=NULL, updated_at=CURRENT_TIMESTAMP`;
    });
    return { registered: true };
  }

  async unregister(actor: AuthenticatedActor, key: string): Promise<{ unregistered: true }> {
    await this.prisma.withTenantRls(actor.tenantId, async (tx) => {
      if (!await this.claim(tx, actor.tenantId, key, 'push.unregister', actor.sessionId)) {
        const current = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM mobile_push_devices WHERE tenant_id=${actor.tenantId}::uuid AND user_id=${actor.userId}::uuid AND session_id=${actor.sessionId}::uuid AND revoked_at IS NULL`;
        if (current.length) throw new ConflictException('Registration has changed');
        return;
      }
      await tx.$executeRaw`UPDATE mobile_push_devices SET revoked_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE tenant_id=${actor.tenantId}::uuid AND user_id=${actor.userId}::uuid AND session_id=${actor.sessionId}::uuid AND revoked_at IS NULL`;
    });
    return { unregistered: true };
  }

  async deliver(jobId: string, job: PushJob): Promise<{ accepted: number; failed: number }> {
    if (!jobId || jobId.length > 128 || !job.tenantId || !job.userId) throw new BadRequestException('Invalid push job');
    const devices = await this.prisma.withTenantRls(job.tenantId, (tx) => tx.$queryRaw<Device[]>`
      SELECT d.id, d.session_id AS "sessionId", d.platform, d.token_sealed AS "tokenSealed"
      FROM mobile_push_devices d JOIN user_sessions s ON s.id=d.session_id AND s.tenant_id=d.tenant_id AND s.user_id=d.user_id
      JOIN users u ON u.id=d.user_id AND u.tenant_id=d.tenant_id
      WHERE d.tenant_id=${job.tenantId}::uuid AND d.user_id=${job.userId}::uuid AND d.revoked_at IS NULL
        AND s.revoked_at IS NULL AND s.expires_at>CURRENT_TIMESTAMP AND u.deleted_at IS NULL AND u.status='ACTIVE'
        AND NOT EXISTS (SELECT 1 FROM mobile_push_attempts a WHERE a.tenant_id=d.tenant_id AND a.job_id=${jobId} AND a.device_id=d.id AND a.state IN ('ACCEPTED','FAILED')) LIMIT 101`);
    if (devices.length > 100) throw new Error('PUSH_DEVICE_LIMIT_EXCEEDED');
    const [title, body] = generic[job.locale?.split('-')[0]] ?? generic.en!;
    let accepted = 0, failed = 0, retry = false;
    for (const device of devices) {
      let token: string;
      try { token = this.crypto.decrypt(device.tokenSealed, `${job.tenantId}:${job.userId}:${device.sessionId}:mobile-push`); }
      catch { failed += 1; await this.record(job.tenantId, jobId, device.id, 'FAILED', 'DEVICE_DECRYPT_FAILED', false); continue; }
      const result = device.platform === 'APNS' ? await this.apns.send(token, title, body) : await this.fcm.send({
        tenantId: job.tenantId, recipientUserId: job.userId, subject: title, body, channel: NotificationChannel.PUSH,
        templateKey: 'mobile.generic', safePayload: { deviceToken: token }, idempotencyKey: jobId,
      }).then((item) => ({ accepted: item.accepted && Boolean(item.providerReference), retryable: item.retryable || (item.accepted && !item.providerReference), code: item.errorCode ?? (item.accepted && item.providerReference ? 'ACCEPTED' : 'FCM_INVALID_RESPONSE'), invalidToken: item.errorCode === 'INVALID_DEVICE_TOKEN' }));
      if (result.accepted) { accepted += 1; await this.record(job.tenantId, jobId, device.id, 'ACCEPTED', null, false); }
      else if (result.retryable) { failed += 1; retry = true; }
      else { failed += 1; await this.record(job.tenantId, jobId, device.id, 'FAILED', result.code, result.invalidToken === true); }
    }
    // Provider acknowledgement is not proof that the phone displayed a notification.
    if (retry) throw new Error('PUSH_TEMPORARY_FAILURE');
    return { accepted, failed };
  }

  private async claim(tx: Prisma.TransactionClient, tenantId: string, key: string, operation: string, resource: string): Promise<boolean> {
    const hash = createHash('sha256').update(key).digest('hex');
    const inserted = await tx.$executeRaw`INSERT INTO developer_mutation_intents (tenant_id,key_hash,operation,resource) VALUES (${tenantId}::uuid,${hash},${operation},${resource}) ON CONFLICT (tenant_id,key_hash) DO NOTHING`;
    if (inserted === 1) return true;
    const rows = await tx.$queryRaw<Array<{ operation: string; resource: string }>>`SELECT operation,resource FROM developer_mutation_intents WHERE tenant_id=${tenantId}::uuid AND key_hash=${hash}`;
    if (rows[0]?.operation !== operation || rows[0]?.resource !== resource) throw new ConflictException('Request key was already used');
    return false;
  }

  private async record(tenantId: string, jobId: string, deviceId: string, state: 'ACCEPTED' | 'FAILED', code: string | null, revoke: boolean): Promise<void> {
    await this.prisma.withTenantRls(tenantId, async (tx) => {
      await tx.$executeRaw`INSERT INTO mobile_push_attempts (tenant_id,job_id,device_id,state,error_code) VALUES (${tenantId}::uuid,${jobId},${deviceId}::uuid,${state},${code}) ON CONFLICT (tenant_id,job_id,device_id) DO UPDATE SET state=EXCLUDED.state,error_code=EXCLUDED.error_code,updated_at=CURRENT_TIMESTAMP`;
      if (revoke) await tx.$executeRaw`UPDATE mobile_push_devices SET revoked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=${tenantId}::uuid AND id=${deviceId}::uuid`;
    });
  }
}
