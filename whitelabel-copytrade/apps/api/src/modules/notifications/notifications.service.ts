import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  NotificationChannel,
  type NotificationDto,
  type NotificationPreferenceDto,
  type PaginatedResult,
  type TransactionalNotificationJob,
} from '@wlct/shared-types';
import { JOB_NAMES, QUEUE_NAMES } from '@wlct/config';
import { buildPaginationMeta, normalisePagination } from '@wlct/utils';

import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { NotFoundException } from '../../common/errors/app.exception';
import { resolveTemplate } from './notification.templates';
import type { ListNotificationsDto } from './dto/list-notifications.dto';
import type { UpdateNotificationPreferencesDto } from './dto/notification-preference.dto';

const SORTABLE_FIELDS = ['createdAt'] as const;

/**
 * Notification fan-out.
 *
 * Producers only ever call `enqueueTransactional`, which validates the type and
 * hands the work to BullMQ. Rendering, preference resolution, persistence and
 * delivery all happen in the worker so a slow SMTP endpoint can never extend
 * the latency of an authentication request.
 *
 * Payload `data` is intentionally small and non-sensitive: it holds identifiers
 * and display values only. Tokens, passwords and API secrets must never be put
 * on a queue.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly config: AppConfigService,
    @InjectPinoLogger(NotificationsService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Queues a transactional notification. Never throws: a notification failure
   * must not roll back the business operation that triggered it.
   */
  async enqueueTransactional(job: TransactionalNotificationJob): Promise<void> {
    if (!this.config.notificationsEnabled) {
      this.logger.debug(
        { event: 'notification.skipped', type: job.type, tenantId: job.tenantId },
        'Notifications are disabled by configuration',
      );
      return;
    }

    const template = resolveTemplate(job.type);

    await this.queues.enqueue(
      QUEUE_NAMES.NOTIFICATION,
      JOB_NAMES.DISPATCH_NOTIFICATION,
      {
        tenantId: job.tenantId,
        userId: job.userId,
        type: template.type,
        locale: job.locale,
        data: this.sanitiseData(job.data),
        channels: job.channels ?? template.channels,
        requestId: job.requestId ?? null,
      },
      // Security notifications must survive transient Redis/SMTP failures.
      template.critical ? { attempts: 8, priority: 1 } : undefined,
    );
  }

  async list(
    tenantId: string,
    userId: string,
    query: ListNotificationsDto,
  ): Promise<PaginatedResult<NotificationDto>> {
    const pagination = normalisePagination(query, SORTABLE_FIELDS);

    const where = {
      tenantId,
      userId,
      ...(query.unreadOnly ? { readAt: null } : {}),
      ...(query.channel ? { channel: query.channel } : {}),
    };

    const [items, totalItems] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: pagination.sortOrder },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return {
      items: items.map((item) => this.toDto(item)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, totalItems),
    };
  }

  async countUnread(tenantId: string, userId: string): Promise<{ unread: number }> {
    const unread = await this.prisma.notification.count({
      where: { tenantId, userId, readAt: null },
    });
    return { unread };
  }

  async markRead(
    tenantId: string,
    userId: string,
    notificationId: string,
  ): Promise<NotificationDto> {
    // Scoped by tenant *and* user: a notification can only ever be read by the
    // person it was addressed to.
    const existing = await this.prisma.notification.findFirst({
      where: { id: notificationId, tenantId, userId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Notification', notificationId);
    }

    const updated = await this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });

    return this.toDto(updated);
  }

  async markAllRead(tenantId: string, userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { tenantId, userId, readAt: null },
      data: { readAt: new Date() },
    });

    return { updated: result.count };
  }

  async listPreferences(userId: string): Promise<NotificationPreferenceDto[]> {
    const preferences = await this.prisma.notificationPreference.findMany({
      where: { userId },
      orderBy: [{ category: 'asc' }, { channel: 'asc' }],
    });

    return preferences.map((preference) => ({
      id: preference.id,
      userId: preference.userId,
      category: preference.category,
      channel: preference.channel as NotificationChannel,
      enabled: preference.enabled,
      updatedAt: preference.updatedAt.toISOString(),
    }));
  }

  async updatePreferences(
    userId: string,
    dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferenceDto[]> {
    for (const preference of dto.preferences) {
      await this.prisma.notificationPreference.upsert({
        where: {
          userId_category_channel: {
            userId,
            category: preference.category,
            channel: preference.channel,
          },
        },
        create: {
          userId,
          category: preference.category,
          channel: preference.channel,
          enabled: preference.enabled,
        },
        update: { enabled: preference.enabled },
      });
    }

    return this.listPreferences(userId);
  }

  /**
   * Strips anything that looks like a credential before a payload reaches a
   * queue, an e-mail body or a log line. Defence in depth: producers are also
   * expected not to pass secrets in the first place.
   */
  private sanitiseData(data: Record<string, unknown>): Record<string, unknown> {
    const forbidden = /(password|secret|token|apikey|api_key|privatekey|private_key|credential)/i;
    const safe: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(data ?? {})) {
      if (forbidden.test(key)) {
        continue;
      }
      if (typeof value === 'string' && value.length > 512) {
        safe[key] = `${value.slice(0, 512)}...`;
        continue;
      }
      safe[key] = value;
    }

    return safe;
  }

  private toDto(notification: {
    id: string;
    tenantId: string;
    userId: string;
    channel: string;
    type: string;
    title: string;
    body: string;
    data: unknown;
    readAt: Date | null;
    deliveredAt: Date | null;
    createdAt: Date;
  }): NotificationDto {
    return {
      id: notification.id,
      tenantId: notification.tenantId,
      userId: notification.userId,
      channel: notification.channel as NotificationChannel,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      data: (notification.data as Record<string, unknown>) ?? {},
      readAt: notification.readAt ? notification.readAt.toISOString() : null,
      deliveredAt: notification.deliveredAt ? notification.deliveredAt.toISOString() : null,
      createdAt: notification.createdAt.toISOString(),
    };
  }
}
