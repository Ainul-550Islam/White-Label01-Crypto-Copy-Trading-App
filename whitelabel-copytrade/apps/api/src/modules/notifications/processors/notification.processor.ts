import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Job } from 'bullmq';
import { JOB_NAMES, QUEUE_NAMES } from '@wlct/config';
import {
  NotificationChannel,
  RealtimeEvent,
  userRoom,
  type EmailJob,
  type TransactionalNotificationJob,
} from '@wlct/shared-types';

import { AppConfigService } from '../../../config/app-config.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { I18nService } from '../../../infrastructure/i18n/i18n.service';
import { QueueService } from '../../queue/queue.service';
import { resolveTemplate } from '../notification.templates';
import { REALTIME_DISPATCH_CHANNEL } from '../../realtime/realtime.constants';

/**
 * Renders and delivers transactional notifications.
 *
 * Delivery is split by channel:
 *   IN_APP  -> a row in `notifications` plus a Redis pub/sub fan-out that the
 *              realtime gateway relays to the user's sockets on any API node.
 *   EMAIL   -> a job on the email queue consumed by the notification-service
 *              worker, which owns the provider integration.
 *   PUSH/SMS-> queued the same way; the transports land with their providers in
 *              a later part, and unroutable channels are recorded as failed
 *              rather than silently dropped.
 */
@Injectable()
@Processor(QUEUE_NAMES.NOTIFICATION, { concurrency: 10 })
export class NotificationProcessor extends WorkerHost implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly i18n: I18nService,
    private readonly queues: QueueService,
    private readonly config: AppConfigService,
    @InjectPinoLogger(NotificationProcessor.name) private readonly logger: PinoLogger,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.queueRunInlineWorkers) {
      return;
    }

    await this.worker.close();
    this.logger.info(
      { event: 'queue.inline_worker_disabled', queue: QUEUE_NAMES.NOTIFICATION },
      'Inline notification worker disabled; jobs are consumed by the worker container',
    );
  }

  async process(job: Job<TransactionalNotificationJob>): Promise<{ delivered: number }> {
    if (job.name !== JOB_NAMES.DISPATCH_NOTIFICATION) {
      this.logger.warn(
        { event: 'notification.unknown_job', jobName: job.name },
        'Received an unknown notification job',
      );
      return { delivered: 0 };
    }

    const payload = job.data;
    const template = resolveTemplate(payload.type);

    const user = await this.prisma.user.findFirst({
      where: { id: payload.userId, tenantId: payload.tenantId, deletedAt: null },
      select: {
        id: true,
        email: true,
        status: true,
        profile: { select: { locale: true, displayName: true, firstName: true } },
      },
    });

    if (!user) {
      // The recipient was deleted between enqueue and delivery. Not an error.
      this.logger.warn(
        { event: 'notification.recipient_missing', tenantId: payload.tenantId },
        'Notification recipient no longer exists',
      );
      return { delivered: 0 };
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: payload.tenantId },
      select: {
        name: true,
        defaultLocale: true,
        branding: {
          select: { appName: true, logoUrl: true, primaryColor: true, supportEmail: true },
        },
      },
    });

    const locale = payload.locale || user.profile?.locale || tenant?.defaultLocale || 'en';
    const appName = tenant?.branding?.appName ?? tenant?.name ?? this.config.appName;

    const params: Record<string, string | number> = {
      appName,
      name: user.profile?.displayName ?? user.profile?.firstName ?? '',
      ...this.stringifyParams(payload.data),
    };

    const title = this.i18n.translate(template.titleKey, locale, params);
    const body = this.i18n.translate(template.bodyKey, locale, params);

    const requestedChannels = payload.channels?.length ? payload.channels : template.channels;
    const channels = await this.filterByPreferences(
      user.id,
      template.category,
      requestedChannels,
      template.critical,
    );

    let delivered = 0;

    for (const channel of channels) {
      switch (channel) {
        case NotificationChannel.IN_APP: {
          const record = await this.prisma.notification.create({
            data: {
              tenantId: payload.tenantId,
              userId: user.id,
              channel: NotificationChannel.IN_APP,
              type: template.type,
              title,
              body,
              data: payload.data as object,
              deliveredAt: new Date(),
            },
          });

          await this.publishRealtime(payload.tenantId, user.id, {
            id: record.id,
            type: template.type,
            title,
            body,
            createdAt: record.createdAt.toISOString(),
          });

          delivered += 1;
          break;
        }

        case NotificationChannel.EMAIL: {
          const emailJob: EmailJob = {
            tenantId: payload.tenantId,
            userId: user.id,
            to: user.email,
            locale,
            subject: title,
            body,
            templateType: template.type,
            branding: {
              appName,
              logoUrl: tenant?.branding?.logoUrl ?? null,
              primaryColor: tenant?.branding?.primaryColor ?? '#1B2A4A',
              supportEmail: tenant?.branding?.supportEmail ?? null,
            },
            data: payload.data,
          };

          await this.queues.enqueueOrThrow(QUEUE_NAMES.EMAIL, JOB_NAMES.SEND_EMAIL, emailJob);
          delivered += 1;
          break;
        }

        default: {
          // Transport not wired yet: record the attempt so nothing disappears.
          await this.prisma.notification.create({
            data: {
              tenantId: payload.tenantId,
              userId: user.id,
              channel,
              type: template.type,
              title,
              body,
              data: payload.data as object,
              failedAt: new Date(),
              failureReason: `No transport configured for channel ${channel}`,
            },
          });
          break;
        }
      }
    }

    this.logger.info(
      {
        event: 'notification.dispatched',
        tenantId: payload.tenantId,
        type: template.type,
        channels: channels.length,
        delivered,
      },
      'Transactional notification dispatched',
    );

    return { delivered };
  }

  /**
   * Applies user preferences. Critical templates keep IN_APP and EMAIL even if
   * the user opted out - a person must always learn that their credentials or
   * devices changed.
   */
  private async filterByPreferences(
    userId: string,
    category: string,
    channels: NotificationChannel[],
    critical: boolean,
  ): Promise<NotificationChannel[]> {
    const preferences = await this.prisma.notificationPreference.findMany({
      where: { userId, category, channel: { in: channels } },
      select: { channel: true, enabled: true },
    });

    const disabled = new Set(
      preferences.filter((preference) => !preference.enabled).map((preference) => preference.channel),
    );

    return channels.filter((channel) => {
      if (!disabled.has(channel)) {
        return true;
      }
      return (
        critical &&
        (channel === NotificationChannel.IN_APP || channel === NotificationChannel.EMAIL)
      );
    });
  }

  /**
   * Publishes to Redis rather than calling the gateway directly: the socket may
   * live on a different API instance from the worker that rendered the message.
   */
  private async publishRealtime(
    tenantId: string,
    userId: string,
    notification: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.redis.publisher.publish(
        REALTIME_DISPATCH_CHANNEL,
        JSON.stringify({
          room: userRoom(tenantId, userId),
          event: RealtimeEvent.NOTIFICATION_CREATED,
          tenantId,
          emittedAt: new Date().toISOString(),
          payload: notification,
        }),
      );
    } catch (error) {
      this.logger.warn(
        {
          event: 'notification.realtime_publish_failed',
          err: error instanceof Error ? { message: error.message, name: error.name } : undefined,
        },
        'Could not publish realtime notification',
      );
    }
  }

  private stringifyParams(data: Record<string, unknown>): Record<string, string | number> {
    const params: Record<string, string | number> = {};

    for (const [key, value] of Object.entries(data ?? {})) {
      if (typeof value === 'string' || typeof value === 'number') {
        params[key] = value;
      } else if (value !== null && value !== undefined) {
        params[key] = JSON.stringify(value);
      }
    }

    return params;
  }
}
