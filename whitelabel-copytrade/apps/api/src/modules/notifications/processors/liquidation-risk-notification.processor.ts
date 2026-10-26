// # Dispatches liquidation/margin-health alerts: dedupes per position and bucket for 15 minutes, honours the user's notification preferences, and records a delivery failure instead of dropping it.
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { NotificationChannel, RealtimeEvent, userRoom } from '@wlct/shared-types';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { REALTIME_DISPATCH_CHANNEL } from '../../realtime/realtime.constants';
import { LiquidationBucket, liquidationAlertKey } from '../../risk/liquidation-distance';

/**
 * Liquidation alerts are the one notification where being late is the whole
 * failure: a "your position is 2% from liquidation" email that arrives after
 * the liquidation is worse than nothing, because it teaches people to trust a
 * channel that does not work.
 *
 * Three rules follow from that:
 *
 * 1. DEDUPE. The mark price of one position can cross a bucket boundary many
 *    times a minute. Alerts are deduped per (position, bucket) for fifteen
 *    minutes through a Redis `SET NX EX`, so the customer gets one DANGER alert
 *    per quarter hour, and a CRITICAL alert is a different key and is never
 *    suppressed by a preceding DANGER.
 *
 * 2. PREFERENCES. A disabled `liquidation_risk` category means the in-app row
 *    is still written (the customer can always find it) but nothing is pushed.
 *    Preferences are read per channel and default to enabled, because an alert
 *    nobody opted into is still better than silent exposure.
 *
 * 3. A FAILED DELIVERY IS A ROW. If the realtime publish or the notification
 *    insert throws, the failure is recorded on a notification row (`failedAt`,
 *    `failureReason`) and logged. A dropped alert that nobody can see is how a
 *    risk system quietly stops existing.
 */
export const LIQUIDATION_ALERT_CATEGORY = 'liquidation_risk';
export const LIQUIDATION_ALERT_DEDUPE_SECONDS = 15 * 60;

export interface LiquidationRiskAlertPayload {
  tenantId: string;
  userId: string;
  positionId: string;
  accountId: string | null;
  symbol: string;
  side: string;
  quantity: string;
  bucket: LiquidationBucket;
  distancePercent: string | null;
  distanceBps: string | null;
  liquidationPrice: string | null;
  markPrice: string | null;
  /** Stable id of the risk evaluation, used as the notification sourceEventId. */
  evaluationId: string;
}

export interface LiquidationRiskDispatchResult {
  dispatched: boolean;
  skippedReason: 'DEDUPED' | 'PREFERENCE_DISABLED' | 'NOT_AN_ALERT_BUCKET' | null;
  notificationId: string | null;
  failureRecorded: boolean;
}

@Injectable()
export class LiquidationRiskNotificationProcessor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @InjectPinoLogger(LiquidationRiskNotificationProcessor.name)
    private readonly logger: PinoLogger,
  ) {}

  async dispatch(payload: LiquidationRiskAlertPayload): Promise<LiquidationRiskDispatchResult> {
    if (payload.bucket !== LiquidationBucket.WATCH
      && payload.bucket !== LiquidationBucket.DANGER
      && payload.bucket !== LiquidationBucket.CRITICAL
      // UNKNOWN alerts too: "we cannot read your liquidation price" is a
      // margin-health warning, and it is the one the platform owes the customer
      // most clearly, because they cannot see it anywhere else.
      && payload.bucket !== LiquidationBucket.UNKNOWN) {
      return { dispatched: false, skippedReason: 'NOT_AN_ALERT_BUCKET', notificationId: null, failureRecorded: false };
    }

    const dedupeKey = liquidationAlertKey(payload.positionId, payload.bucket);
    const claimed = await this.claimOnce(payload.tenantId, dedupeKey);
    if (!claimed) {
      return { dispatched: false, skippedReason: 'DEDUPED', notificationId: null, failureRecorded: false };
    }

    const enabled = await this.channelEnabled(payload.userId, LIQUIDATION_ALERT_CATEGORY, NotificationChannel.IN_APP);
    if (!enabled) {
      return { dispatched: false, skippedReason: 'PREFERENCE_DISABLED', notificationId: null, failureRecorded: false };
    }

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
            type: `LIQUIDATION_RISK_${payload.bucket}`,
            title,
            body,
            data: {
              positionId: payload.positionId,
              accountId: payload.accountId,
              symbol: payload.symbol,
              side: payload.side,
              quantity: payload.quantity,
              bucket: payload.bucket,
              distancePercent: payload.distancePercent,
              distanceBps: payload.distanceBps,
              liquidationPrice: payload.liquidationPrice,
              markPrice: payload.markPrice,
            },
            deliveredAt: new Date(),
          },
          skipDuplicates: true,
        });
        return tx.notification.findFirst({
          where: { tenantId: payload.tenantId, userId: payload.userId, sourceEventId: payload.evaluationId },
          select: { id: true },
        });
      });
      notificationId = record?.id ?? null;
      if (!notificationId) throw new Error('liquidation alert insert produced no row');
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
            type: `LIQUIDATION_RISK_${payload.bucket}`,
            title,
            body,
            bucket: payload.bucket,
            distancePercent: payload.distancePercent,
            positionId: payload.positionId,
          },
        }),
      );
    } catch (error) {
      // The row exists and is readable, but the live push did not happen. That
      // is a delivery failure and it is recorded as one.
      await this.recordFailure(payload, title, body, error, notificationId);
      return { dispatched: false, skippedReason: null, notificationId, failureRecorded: true };
    }

    this.logger.info(
      {
        event: 'liquidation.notification.dispatched',
        tenantId: payload.tenantId,
        positionId: payload.positionId,
        bucket: payload.bucket,
      },
      'Liquidation risk alert dispatched',
    );
    return { dispatched: true, skippedReason: null, notificationId, failureRecorded: false };
  }

  /** True when this caller won the dedupe claim. Redis down -> refuse (no alert storm). */
  private async claimOnce(tenantId: string, key: string): Promise<boolean> {
    try {
      const result = await this.redis.client.set(key, tenantId, 'EX', LIQUIDATION_ALERT_DEDUPE_SECONDS, 'NX');
      return result === 'OK';
    } catch (error) {
      this.logger.warn(
        { event: 'liquidation.notification.dedupe_unavailable', err: error instanceof Error ? { message: error.message } : undefined },
        'Dedupe store unavailable; suppressing the alert rather than risking an alert storm',
      );
      return false;
    }
  }

  /** Preferences default to ENABLED: absence of a row is not an opt-out. */
  private async channelEnabled(userId: string, category: string, channel: NotificationChannel): Promise<boolean> {
    try {
      const preference = await this.prisma.notificationPreference.findFirst({ where: { userId, category, channel } });
      return preference ? preference.enabled : true;
    } catch (error) {
      this.logger.warn(
        { event: 'liquidation.notification.preference_unavailable', err: error instanceof Error ? { message: error.message } : undefined },
        'Preference lookup failed; delivering the liquidation alert anyway',
      );
      return true;
    }
  }

  private async recordFailure(
    payload: LiquidationRiskAlertPayload,
    title: string,
    body: string,
    error: unknown,
    existingNotificationId: string | null = null,
  ): Promise<void> {
    const failureReason = `Liquidation alert delivery failed: ${error instanceof Error ? error.message : 'unknown error'}`.slice(0, 500);
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
              type: `LIQUIDATION_RISK_${payload.bucket}`,
              title,
              body,
              data: { positionId: payload.positionId, bucket: payload.bucket, undelivered: true },
              failedAt: new Date(),
              failureReason,
            },
          });
        });
      }
      this.logger.error(
        { event: 'liquidation.notification.delivery_failed', tenantId: payload.tenantId, positionId: payload.positionId, failureReason },
        'Liquidation alert delivery failed and was recorded',
      );
    } catch (persistError) {
      // Last resort: the failure itself could not be stored. It is still logged
      // with the tenant and position so it is not invisible.
      this.logger.error(
        {
          event: 'liquidation.notification.failure_unrecorded',
          tenantId: payload.tenantId,
          positionId: payload.positionId,
          failureReason,
          persistError: persistError instanceof Error ? persistError.message : 'unknown error',
        },
        'Liquidation alert failed AND its failure could not be recorded',
      );
    }
  }

  private title(payload: LiquidationRiskAlertPayload): string {
    switch (payload.bucket) {
      case LiquidationBucket.CRITICAL:
        return `Liquidation risk CRITICAL (${payload.symbol})`.slice(0, 160);
      case LiquidationBucket.DANGER:
        return `Liquidation risk high (${payload.symbol})`.slice(0, 160);
      case LiquidationBucket.UNKNOWN:
        return `Liquidation distance unavailable (${payload.symbol})`.slice(0, 160);
      default:
        return `Liquidation risk watch (${payload.symbol})`.slice(0, 160);
    }
  }

  private body(payload: LiquidationRiskAlertPayload): string {
    const distance = payload.distancePercent === null
      ? 'The venue has not reported a liquidation price for this position, so its distance to liquidation is unknown.'
      : `The mark price is ${payload.distancePercent}% away from the liquidation price.`;
    return `${payload.side} ${payload.quantity} ${payload.symbol}: ${distance}`.slice(0, 1000);
  }
}
