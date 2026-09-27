import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { BillingNotificationEventKey, NotificationChannel } from './billing-notification.types';
import { randomUUID } from 'crypto';

/**
 * Creates tenant/user-scoped in-app notification records using existing
 * notification/persistence infrastructure where available.
 * Does NOT create second generic notification DB if one already exists.
 */
@Injectable()
export class InAppNotificationService {
  private readonly logger = new Logger(InAppNotificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createNotification(params: {
    tenantId: string;
    userId: string;
    eventKey: BillingNotificationEventKey;
    channel: NotificationChannel;
    title: string;
    body: string;
    safePayload: any;
    idempotencyKey: string;
  }): Promise<any> {
    // Idempotency check
    try {
      const existing = await (this.prisma as any).notification?.findFirst({
        where: {
          tenantId: params.tenantId,
          userId: params.userId,
          type: params.eventKey,
          // Check idempotency via data field if possible
        },
      });

      // Check by idempotency key in billingNotificationJob if exists
      const existingBilling = await (this.prisma as any).billingNotificationJob?.findFirst({
        where: { idempotencyKey: params.idempotencyKey },
      });
      if (existingBilling && existingBilling.deliveryStatus === 'SENT') {
        this.logger.log(`Idempotent in-app notification return by idempotencyKey: ${params.idempotencyKey}`);
        return existing;
      }
    } catch {}

    try {
      const record = await this.prisma.notification.create({
        data: {
          id: randomUUID(),
          tenantId: params.tenantId,
          userId: params.userId,
          channel: NotificationChannel.IN_APP as any,
          type: params.eventKey,
          title: params.title,
          body: params.body,
          data: params.safePayload as any,
          deliveredAt: new Date(),
          createdAt: new Date(),
        },
      });

      this.logger.log(`In-app notification created tenant=${params.tenantId} user=${params.userId} event=${params.eventKey} id=${record.id}`);

      // Publish realtime event via Redis if available (reuse existing pattern)
      try {
        const { RedisService } = await import('../../../infrastructure/redis/redis.service').catch(() => ({ RedisService: null })) as any;
        // Real implementation would publish via RedisService
        // For now, log
        this.logger.log(`Realtime notification would be published for user ${params.userId} in tenant ${params.tenantId}`);
      } catch {}

      return record;
    } catch (error: any) {
      if (error.code === 'P2021' || error.message?.includes('does not exist')) {
        this.logger.warn(`notification table not found, fallback: ${error.message}`);
        // Fallback to audit log
        try {
          await (this.prisma as any).auditLog?.create({
            data: {
              id: randomUUID(),
              tenantId: params.tenantId,
              action: 'IN_APP_NOTIFICATION_CREATED',
              resource: 'Notification',
              resourceId: randomUUID(),
              metadata: {
                userId: params.userId,
                eventKey: params.eventKey,
                title: params.title,
                body: params.body,
                safePayload: params.safePayload,
                idempotencyKey: params.idempotencyKey,
                fallback: true,
              },
              createdAt: new Date(),
            },
          });
        } catch {}
        return { id: randomUUID(), tenantId: params.tenantId, userId: params.userId, type: params.eventKey, title: params.title, fallback: true };
      }
      throw error;
    }
  }

  async markRead(tenantId: string, userId: string, notificationId: string): Promise<any> {
    try {
      const existing = await this.prisma.notification.findFirst({
        where: { id: notificationId, tenantId, userId },
        select: { id: true },
      });

      if (!existing) {
        throw new Error(`Notification not found: ${notificationId}`);
      }

      const updated = await this.prisma.notification.update({
        where: { id: notificationId },
        data: { readAt: new Date() },
      });

      return updated;
    } catch (error: any) {
      if (error.message.includes('not found')) throw error;
      this.logger.warn(`Failed to mark notification read: ${error.message}`);
      throw error;
    }
  }

  async markAllRead(tenantId: string, userId: string): Promise<{ updated: number }> {
    try {
      const result = await this.prisma.notification.updateMany({
        where: { tenantId, userId, readAt: null },
        data: { readAt: new Date() },
      });
      return { updated: result.count };
    } catch {
      return { updated: 0 };
    }
  }

  async getUnreadCount(tenantId: string, userId: string): Promise<number> {
    try {
      const count = await this.prisma.notification.count({
        where: { tenantId, userId, readAt: null },
      });
      return count;
    } catch {
      return 0;
    }
  }

  async listNotifications(
    tenantId: string,
    userId: string,
    filter?: { unreadOnly?: boolean; eventKey?: string; channel?: string; fromDate?: Date; toDate?: Date; limit?: number; offset?: number },
  ): Promise<any[]> {
    try {
      const where: any = { tenantId, userId };
      if (filter?.unreadOnly) where.readAt = null;
      if (filter?.eventKey) where.type = filter.eventKey;
      if (filter?.channel) where.channel = filter.channel;
      if (filter?.fromDate || filter?.toDate) {
        where.createdAt = {};
        if (filter.fromDate) where.createdAt.gte = filter.fromDate;
        if (filter.toDate) where.createdAt.lte = filter.toDate;
      }

      const results = await this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filter?.limit || 50,
        skip: filter?.offset || 0,
      });

      return results;
    } catch {
      return [];
    }
  }

  async archiveNotification(tenantId: string, userId: string, notificationId: string): Promise<any> {
    try {
      const existing = await this.prisma.notification.findFirst({
        where: { id: notificationId, tenantId, userId },
      });
      if (!existing) throw new Error(`Notification not found: ${notificationId}`);

      // Archive by setting readAt and optionally deletedAt if model supports
      const updated = await this.prisma.notification.update({
        where: { id: notificationId },
        data: { readAt: new Date() },
      });

      return updated;
    } catch (error: any) {
      this.logger.warn(`Failed to archive notification: ${error.message}`);
      throw error;
    }
  }
}
