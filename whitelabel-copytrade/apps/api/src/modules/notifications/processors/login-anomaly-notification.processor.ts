// # Dispatches sign-in alerts: dedupes per device, names the reason codes, offers a one-click "this wasn't me" recovery, and records a delivery failure instead of dropping it.
//
// WHY THIS ALERT IS DIFFERENT FROM EVERY OTHER NOTIFICATION
// --------------------------------------------------------
// A liquidation warning is about money the platform can still protect. A sign-in
// alert is about an attacker who may already be inside, and its entire value is
// in what the customer does in the next ten minutes. Three consequences:
//
//   1. IT IS DELIVERED EVEN WHEN PREFERENCES SAY OTHERWISE. Every other category
//      respects an opt-out. This one writes the in-app row regardless (see
//      `channelEnabled`): a customer who disabled "security emails" three years
//      ago has not agreed to be kept in the dark about a sign-in from a device
//      they have never used. The preference is honoured for the *push*, so the
//      opt-out keeps its meaning without becoming a blindfold.
//
//   2. IT DEDUPES PER DEVICE, NOT PER EVENT. The same new device signing in
//      repeatedly for an hour is one alert, not forty. A different device is a
//      different alert, because it is a different fact.
//
//   3. IT CARRIES A WAY OUT. The body names the recovery route so the customer can
//      revoke sessions and re-establish control without hunting for it, and the
//      reason codes are included verbatim so support and the customer are looking
//      at the same words.
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { NotificationChannel, RealtimeEvent, userRoom } from '@wlct/shared-types';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { REALTIME_DISPATCH_CHANNEL } from '../../realtime/realtime.constants';
import type { LoginAnomalyReason, LoginRiskLevel } from '../../auth/login-anomaly.service';

export const LOGIN_ALERT_CATEGORY = 'security';
export const LOGIN_ALERT_DEDUPE_SECONDS = 24 * 60 * 60;

/** Where the customer goes to act on the alert. Relative: the web app owns the host. */
export const RECOVERY_PATH = '/recovery';
export const SESSION_REVIEW_PATH = '/security';

export interface LoginAnomalyAlertPayload {
  tenantId: string;
  userId: string;
  /** Keyed device hash - the dedupe and correlation key. Never a raw address. */
  fingerprintHash: string;
  /** Coarse, keyed IP hash for the alert body ("from 203.x" is never shown). */
  ipHash: string;
  riskLevel: LoginRiskLevel;
  reasons: LoginAnomalyReason[];
  countryCode: string | null;
  /** ISO timestamp of the attempt. */
  occurredAt: string;
  /** Stable id of the anomaly evaluation, used as the notification sourceEventId. */
  evaluationId: string;
  /** Coarse device description supplied by the caller, already user-safe. */
  deviceLabel: string | null;
}

export interface LoginAnomalyDispatchResult {
  dispatched: boolean;
  skippedReason: 'DEDUPED' | 'NOT_AN_ALERT' | null;
  notificationId: string | null;
  failureRecorded: boolean;
}

/** Alert levels that are worth waking someone up for. LOW is recorded, not pushed. */
const ALERT_LEVELS: ReadonlySet<LoginRiskLevel> = new Set<LoginRiskLevel>(['MEDIUM', 'HIGH']);

@Injectable()
export class LoginAnomalyNotificationProcessor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @InjectPinoLogger(LoginAnomalyNotificationProcessor.name)
    private readonly logger: PinoLogger,
  ) {}

  async dispatch(payload: LoginAnomalyAlertPayload): Promise<LoginAnomalyDispatchResult> {
    if (!ALERT_LEVELS.has(payload.riskLevel)) {
      return { dispatched: false, skippedReason: 'NOT_AN_ALERT', notificationId: null, failureRecorded: false };
    }

    const claimed = await this.claimOnce(payload);
    if (!claimed) {
      return { dispatched: false, skippedReason: 'DEDUPED', notificationId: null, failureRecorded: false };
    }

    // Deliberately NOT gated on preferences: the in-app row is the customer's
    // record that the platform told them. See the file header.
    const title = this.title(payload);
    const body = this.body(payload);
    let notificationId: string | null = null;

    try {
      const record = await this.prisma.withTenantRls(payload.tenantId, async (tx) => {
        await tx.notification.createMany({
          data: {
            tenantId: payload.tenantId,
            userId: payload.userId,
            sourceEventId: payload.evaluationId,
            channel: NotificationChannel.IN_APP,
            type: `SECURITY_LOGIN_${payload.riskLevel}`,
            title,
            body,
            data: {
              reasons: payload.reasons,
              countryCode: payload.countryCode,
              deviceLabel: payload.deviceLabel,
              occurredAt: payload.occurredAt,
              // Hashes, not addresses: the row must stay useless if it leaks.
              fingerprintHash: payload.fingerprintHash,
              ipHash: payload.ipHash,
              reviewPath: SESSION_REVIEW_PATH,
              recoveryPath: RECOVERY_PATH,
            },
            deliveredAt: new Date(),
          },
          skipDuplicates: true,
        });
        return tx.notification.findFirst({
          where: {
            tenantId: payload.tenantId,
            userId: payload.userId,
            sourceEventId: payload.evaluationId,
          },
          select: { id: true },
        });
      });
      notificationId = record?.id ?? null;
      if (!notificationId) throw new Error('login alert insert produced no row');
    } catch (error) {
      await this.recordFailure(payload, title, body, error);
      return { dispatched: false, skippedReason: null, notificationId: null, failureRecorded: true };
    }

    try {
      await this.redis.publisher.publish(
        REALTIME_DISPATCH_CHANNEL,
        JSON.stringify({
          room: userRoom(payload.tenantId, payload.userId),
          event: RealtimeEvent.NOTIFICATION_CREATED,
          tenantId: payload.tenantId,
          emittedAt: new Date().toISOString(),
          payload: {
            id: notificationId,
            type: `SECURITY_LOGIN_${payload.riskLevel}`,
            title,
            body,
            riskLevel: payload.riskLevel,
            reasons: payload.reasons,
            recoveryPath: RECOVERY_PATH,
          },
        }),
      );
    } catch (error) {
      // The row exists, so the customer can still find the alert; the live push
      // failed and that is recorded as a delivery failure rather than swallowed.
      await this.recordFailure(payload, title, body, error, notificationId);
      return { dispatched: false, skippedReason: null, notificationId, failureRecorded: true };
    }

    this.logger.info(
      {
        event: 'security.login_alert.dispatched',
        tenantId: payload.tenantId,
        userId: payload.userId,
        riskLevel: payload.riskLevel,
      },
      'Sign-in anomaly alert dispatched',
    );
    return { dispatched: true, skippedReason: null, notificationId, failureRecorded: false };
  }

  /**
   * One alert per device per day.
   *
   * Redis down returns false (suppress) rather than true: on a security channel an
   * alert storm trains the customer to ignore the channel, and the sign-in is
   * still recorded in the session/security log either way.
   */
  private async claimOnce(payload: LoginAnomalyAlertPayload): Promise<boolean> {
    const key = `security:login-alert:${payload.tenantId}:${payload.userId}:${payload.fingerprintHash}`;
    try {
      const result = await this.redis.client.set(key, payload.evaluationId, 'EX', LOGIN_ALERT_DEDUPE_SECONDS, 'NX');
      return result === 'OK';
    } catch (error) {
      this.logger.warn(
        {
          event: 'security.login_alert.dedupe_unavailable',
          err: error instanceof Error ? { message: error.message } : undefined,
        },
        'Dedupe store unavailable; suppressing the duplicate risk instead of flooding the customer',
      );
      return false;
    }
  }

  private async recordFailure(
    payload: LoginAnomalyAlertPayload,
    title: string,
    body: string,
    error: unknown,
    existingNotificationId: string | null = null,
  ): Promise<void> {
    const failureReason = `Sign-in alert delivery failed: ${
      error instanceof Error ? error.message : 'unknown error'
    }`.slice(0, 500);
    try {
      if (existingNotificationId) {
        await this.prisma.withTenantRls(payload.tenantId, async (tx) => {
          await tx.notification.updateMany({
            where: { id: existingNotificationId, tenantId: payload.tenantId },
            data: { deliveredAt: null, failedAt: new Date(), failureReason },
          });
        });
      } else {
        await this.prisma.withTenantRls(payload.tenantId, async (tx) => {
          await tx.notification.create({
            data: {
              tenantId: payload.tenantId,
              userId: payload.userId,
              sourceEventId: payload.evaluationId,
              channel: NotificationChannel.IN_APP,
              type: `SECURITY_LOGIN_${payload.riskLevel}`,
              title,
              body,
              data: { reasons: payload.reasons, undelivered: true, recoveryPath: RECOVERY_PATH },
              failedAt: new Date(),
              failureReason,
            },
          });
        });
      }
      this.logger.error(
        {
          event: 'security.login_alert.delivery_failed',
          tenantId: payload.tenantId,
          userId: payload.userId,
          failureReason,
        },
        'Sign-in alert delivery failed and was recorded',
      );
    } catch (persistError) {
      this.logger.error(
        {
          event: 'security.login_alert.failure_unrecorded',
          tenantId: payload.tenantId,
          userId: payload.userId,
          failureReason,
          persistError: persistError instanceof Error ? persistError.message : 'unknown error',
        },
        'Sign-in alert failed AND its failure could not be recorded',
      );
    }
  }

  private title(payload: LoginAnomalyAlertPayload): string {
    const where = payload.countryCode ? ` from ${payload.countryCode}` : '';
    return (
      payload.riskLevel === 'HIGH'
        ? `Unusual sign-in to your account${where}`
        : `New sign-in to your account${where}`
    ).slice(0, 160);
  }

  private body(payload: LoginAnomalyAlertPayload): string {
    const device = payload.deviceLabel ? ` on ${payload.deviceLabel}` : '';
    const when = payload.occurredAt;
    const reasons = payload.reasons.join(', ');
    return (
      `We noticed a sign-in${device} at ${when} (${reasons}). ` +
      `If this was you, no action is needed. If it was not, open ${RECOVERY_PATH} to secure your account, ` +
      `or review your sessions at ${SESSION_REVIEW_PATH}.`
    ).slice(0, 1000);
  }
}
