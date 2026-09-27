import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { BillingNotificationJob, DeliveryStatus, NotificationChannel, BillingNotificationEventKey, NotificationPriority, NotificationCategory } from './billing-notification.types';
import { randomUUID } from 'crypto';

/**
 * Persistent notification job storage, idempotency, retry state, attempts, next-attempt,
 * delivery status, tenant isolation. Prevents duplicate jobs from same canonical event.
 */
@Injectable()
export class NotificationJobRepository {
  private readonly logger = new Logger(NotificationJobRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(job: {
    tenantId: string;
    userId?: string;
    recipient: any;
    eventKey: BillingNotificationEventKey;
    channel: NotificationChannel;
    templateKey: string;
    locale: string;
    priority: NotificationPriority;
    category: NotificationCategory;
    deliveryStatus: DeliveryStatus;
    maxAttempts: number;
    idempotencyKey: string;
    safePayload: any;
    renderedSubject?: string;
    renderedBody?: string;
  }): Promise<BillingNotificationJob> {
    // Idempotency check
    const existingByKey = await this.findByIdempotencyKey(job.idempotencyKey);
    if (existingByKey) {
      this.logger.log(`Idempotent notification job return by key: ${job.idempotencyKey}`);
      return existingByKey;
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    const notificationJob: BillingNotificationJob = {
      id,
      tenantId: job.tenantId,
      userId: job.userId,
      recipient: job.recipient,
      eventKey: job.eventKey,
      channel: job.channel,
      templateKey: job.templateKey,
      locale: job.locale,
      priority: job.priority,
      category: job.category,
      deliveryStatus: job.deliveryStatus,
      attemptCount: 0,
      maxAttempts: job.maxAttempts,
      nextAttemptAt: null,
      providerReference: null,
      idempotencyKey: job.idempotencyKey,
      safePayload: job.safePayload,
      renderedSubject: job.renderedSubject,
      renderedBody: job.renderedBody,
      failureReason: null,
      createdAt: now,
      updatedAt: now,
      sentAt: null,
      deliveredAt: null,
    };

    try {
      const created = await (this.prisma as any).billingNotificationJob?.create({
        data: {
          id: notificationJob.id,
          tenantId: notificationJob.tenantId,
          userId: notificationJob.userId || null,
          recipient: notificationJob.recipient as any,
          eventKey: notificationJob.eventKey,
          channel: notificationJob.channel,
          templateKey: notificationJob.templateKey,
          locale: notificationJob.locale,
          priority: notificationJob.priority,
          category: notificationJob.category,
          deliveryStatus: notificationJob.deliveryStatus,
          attemptCount: notificationJob.attemptCount,
          maxAttempts: notificationJob.maxAttempts,
          nextAttemptAt: null,
          providerReference: null,
          idempotencyKey: notificationJob.idempotencyKey,
          safePayload: notificationJob.safePayload as any,
          renderedSubject: notificationJob.renderedSubject || null,
          renderedBody: notificationJob.renderedBody || null,
          failureReason: null,
          createdAt: new Date(notificationJob.createdAt),
          updatedAt: new Date(notificationJob.updatedAt),
          sentAt: null,
          deliveredAt: null,
        },
      });

      if (created) {
        return this.mapToDomain(created);
      }
    } catch (error: any) {
      if (error.code === 'P2002') {
        this.logger.warn(`Duplicate notification job idempotency: ${job.idempotencyKey}`);
        const existing = await this.findByIdempotencyKey(job.idempotencyKey);
        if (existing) return existing;
      }
      if (error.code === 'P2021' || error.message?.includes('does not exist')) {
        this.logger.warn(`billingNotificationJob table not found, fallback: ${error.message}`);
        try {
          await (this.prisma as any).auditLog?.create({
            data: {
              id: randomUUID(),
              tenantId: job.tenantId,
              action: 'NOTIFICATION_CREATED',
              resource: 'BillingNotificationJob',
              resourceId: id,
              metadata: { ...notificationJob, fallback: true },
              createdAt: new Date(),
            },
          });
        } catch {}
        return notificationJob;
      }
      this.logger.error(`Failed to create notification job: ${error.message}`, error.stack);
      throw error;
    }

    return notificationJob;
  }

  async findById(id: string, tenantId?: string): Promise<BillingNotificationJob | null> {
    try {
      const result = await (this.prisma as any).billingNotificationJob?.findFirst({
        where: { id, ...(tenantId ? { tenantId } : {}) },
      });
      if (!result) return null;
      return this.mapToDomain(result);
    } catch {
      return null;
    }
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<BillingNotificationJob | null> {
    try {
      const result = await (this.prisma as any).billingNotificationJob?.findFirst({
        where: { idempotencyKey },
      });
      if (!result) return null;
      return this.mapToDomain(result);
    } catch {
      return null;
    }
  }

  async findPendingJobs(limit: number = 50): Promise<BillingNotificationJob[]> {
    try {
      const results = await (this.prisma as any).billingNotificationJob?.findMany({
        where: {
          deliveryStatus: { in: [DeliveryStatus.CREATED, DeliveryStatus.PENDING, DeliveryStatus.QUEUED] },
        },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        take: limit,
      });
      if (!results) return [];
      return results.map((r: any) => this.mapToDomain(r));
    } catch {
      return [];
    }
  }

  async findRetryableJobs(limit: number = 50): Promise<BillingNotificationJob[]> {
    try {
      const now = new Date();
      const results = await (this.prisma as any).billingNotificationJob?.findMany({
        where: {
          deliveryStatus: DeliveryStatus.RETRY_SCHEDULED,
          nextAttemptAt: { lte: now },
          attemptCount: { lt: 10 },
        },
        orderBy: { nextAttemptAt: 'asc' },
        take: limit,
      });
      if (!results) return [];
      return results.map((r: any) => this.mapToDomain(r));
    } catch {
      return [];
    }
  }

  async findFailedJobs(limit: number = 50): Promise<BillingNotificationJob[]> {
    try {
      const results = await (this.prisma as any).billingNotificationJob?.findMany({
        where: {
          deliveryStatus: { in: [DeliveryStatus.FAILED, DeliveryStatus.PERMANENT_FAILURE] },
        },
        orderBy: { updatedAt: 'desc' },
        take: limit,
      });
      if (!results) return [];
      return results.map((r: any) => this.mapToDomain(r));
    } catch {
      return [];
    }
  }

  async listByTenant(
    tenantId: string,
    filter?: {
      eventKey?: BillingNotificationEventKey;
      channel?: NotificationChannel;
      status?: DeliveryStatus;
      userId?: string;
      fromDate?: Date;
      toDate?: Date;
      limit?: number;
      offset?: number;
    },
  ): Promise<BillingNotificationJob[]> {
    try {
      const where: any = { tenantId };
      if (filter?.eventKey) where.eventKey = filter.eventKey;
      if (filter?.channel) where.channel = filter.channel;
      if (filter?.status) where.deliveryStatus = filter.status;
      if (filter?.userId) where.userId = filter.userId;
      if (filter?.fromDate || filter?.toDate) {
        where.createdAt = {};
        if (filter.fromDate) where.createdAt.gte = filter.fromDate;
        if (filter.toDate) where.createdAt.lte = filter.toDate;
      }

      const results = await (this.prisma as any).billingNotificationJob?.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filter?.limit || 100,
        skip: filter?.offset || 0,
      });

      if (!results) return [];
      return results.map((r: any) => this.mapToDomain(r));
    } catch {
      return [];
    }
  }

  async updateStatus(
    id: string,
    updates: {
      deliveryStatus?: DeliveryStatus;
      attemptCount?: number;
      nextAttemptAt?: string | null;
      providerReference?: string | null;
      failureReason?: string | null;
      renderedSubject?: string;
      renderedBody?: string;
      sentAt?: string | null;
      deliveredAt?: string | null;
    },
  ): Promise<BillingNotificationJob | null> {
    try {
      const data: any = { updatedAt: new Date() };
      if (updates.deliveryStatus) data.deliveryStatus = updates.deliveryStatus;
      if (updates.attemptCount !== undefined) data.attemptCount = updates.attemptCount;
      if (updates.nextAttemptAt !== undefined) data.nextAttemptAt = updates.nextAttemptAt ? new Date(updates.nextAttemptAt) : null;
      if (updates.providerReference !== undefined) data.providerReference = updates.providerReference;
      if (updates.failureReason !== undefined) data.failureReason = updates.failureReason;
      if (updates.renderedSubject) data.renderedSubject = updates.renderedSubject;
      if (updates.renderedBody) data.renderedBody = updates.renderedBody;
      if (updates.sentAt !== undefined) data.sentAt = updates.sentAt ? new Date(updates.sentAt) : null;
      if (updates.deliveredAt !== undefined) data.deliveredAt = updates.deliveredAt ? new Date(updates.deliveredAt) : null;

      const updated = await (this.prisma as any).billingNotificationJob?.update({
        where: { id },
        data,
      });

      if (!updated) return null;
      return this.mapToDomain(updated);
    } catch (error: any) {
      if (error.code === 'P2021' || error.message?.includes('does not exist')) return null;
      throw error;
    }
  }

  private mapToDomain(raw: any): BillingNotificationJob {
    return {
      id: raw.id,
      tenantId: raw.tenantId,
      userId: raw.userId || undefined,
      recipient: raw.recipient,
      eventKey: raw.eventKey as BillingNotificationEventKey,
      channel: raw.channel as NotificationChannel,
      templateKey: raw.templateKey,
      locale: raw.locale,
      priority: raw.priority as any,
      category: raw.category as any,
      deliveryStatus: raw.deliveryStatus as DeliveryStatus,
      attemptCount: raw.attemptCount,
      maxAttempts: raw.maxAttempts,
      nextAttemptAt: raw.nextAttemptAt ? new Date(raw.nextAttemptAt).toISOString() : null,
      providerReference: raw.providerReference || null,
      idempotencyKey: raw.idempotencyKey,
      safePayload: raw.safePayload,
      renderedSubject: raw.renderedSubject || undefined,
      renderedBody: raw.renderedBody || undefined,
      failureReason: raw.failureReason || null,
      createdAt: raw.createdAt ? new Date(raw.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: raw.updatedAt ? new Date(raw.updatedAt).toISOString() : new Date().toISOString(),
      sentAt: raw.sentAt ? new Date(raw.sentAt).toISOString() : null,
      deliveredAt: raw.deliveredAt ? new Date(raw.deliveredAt).toISOString() : null,
    };
  }
}
