import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { randomUUID } from 'crypto';

/**
 * Structured audit events for notification creation, delivery, retry, suppression, failure, completion.
 * Sanitized metadata, no secrets.
 */

export enum NotificationAuditOperation {
  NOTIFICATION_CREATED = 'NOTIFICATION_CREATED',
  NOTIFICATION_SUPPRESSED = 'NOTIFICATION_SUPPRESSED',
  NOTIFICATION_SENT = 'NOTIFICATION_SENT',
  NOTIFICATION_FAILED = 'NOTIFICATION_FAILED',
  NOTIFICATION_RETRY_SCHEDULED = 'NOTIFICATION_RETRY_SCHEDULED',
  NOTIFICATION_PERMANENT_FAILURE = 'NOTIFICATION_PERMANENT_FAILURE',
  WEBHOOK_NOTIFICATION_SENT = 'WEBHOOK_NOTIFICATION_SENT',
  WEBHOOK_NOTIFICATION_FAILED = 'WEBHOOK_NOTIFICATION_FAILED',
  PREFERENCE_UPDATED = 'PREFERENCE_UPDATED',
  TEMPLATE_RENDER_FAILED = 'TEMPLATE_RENDER_FAILED',
  PROVIDER_CONFIGURATION_FAILED = 'PROVIDER_CONFIGURATION_FAILED',
  RECONCILIATION_DETECTED = 'RECONCILIATION_DETECTED',
  RECONCILIATION_RESOLVED = 'RECONCILIATION_RESOLVED',
}

@Injectable()
export class BillingNotificationAuditService {
  private readonly logger = new Logger(BillingNotificationAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async log(input: {
    tenantId: string;
    operation: NotificationAuditOperation;
    referenceId: string;
    referenceType: string;
    status: string;
    metadata?: Record<string, unknown>;
    actorId?: string;
  }): Promise<void> {
    const sanitized = this.sanitizeMetadata(input.metadata);

    try {
      await (this.prisma as any).billingNotificationAuditLog?.create({
        data: {
          id: randomUUID(),
          tenantId: input.tenantId,
          operation: input.operation,
          referenceId: input.referenceId,
          referenceType: input.referenceType,
          status: input.status,
          metadata: sanitized,
          actorId: input.actorId || null,
          timestamp: new Date(),
          createdAt: new Date(),
        },
      });
    } catch (error: any) {
      if (error.code === 'P2021' || error.message?.includes('does not exist')) {
        this.logger.log(`[NOTIF_AUDIT] ${input.operation} tenant=${input.tenantId} ref=${input.referenceId} status=${input.status}`);
        try {
          await (this.prisma as any).auditLog?.create({
            data: {
              id: randomUUID(),
              tenantId: input.tenantId,
              action: input.operation,
              resource: input.referenceType,
              resourceId: input.referenceId,
              metadata: sanitized,
              createdAt: new Date(),
            },
          });
        } catch {}
        return;
      }
      this.logger.warn(`Failed to create notification audit log: ${error.message}`);
    }
  }

  async logNotificationCreated(tenantId: string, notificationId: string, eventKey: string, channel: string, idempotencyKey: string): Promise<void> {
    await this.log({
      tenantId,
      operation: NotificationAuditOperation.NOTIFICATION_CREATED,
      referenceId: notificationId,
      referenceType: 'BillingNotification',
      status: 'CREATED',
      metadata: { eventKey, channel, idempotencyKey },
    });
  }

  async logNotificationSuppressed(tenantId: string, notificationId: string, eventKey: string, reason: string): Promise<void> {
    await this.log({
      tenantId,
      operation: NotificationAuditOperation.NOTIFICATION_SUPPRESSED,
      referenceId: notificationId,
      referenceType: 'BillingNotification',
      status: 'SUPPRESSED',
      metadata: { eventKey, reason },
    });
  }

  async logNotificationSent(tenantId: string, notificationId: string, eventKey: string, channel: string, providerReference: string | null): Promise<void> {
    await this.log({
      tenantId,
      operation: NotificationAuditOperation.NOTIFICATION_SENT,
      referenceId: notificationId,
      referenceType: 'BillingNotification',
      status: 'SENT',
      metadata: { eventKey, channel, providerReference },
    });
  }

  async logNotificationFailed(tenantId: string, notificationId: string, eventKey: string, channel: string, reason: string, retryable: boolean): Promise<void> {
    await this.log({
      tenantId,
      operation: NotificationAuditOperation.NOTIFICATION_FAILED,
      referenceId: notificationId,
      referenceType: 'BillingNotification',
      status: 'FAILED',
      metadata: { eventKey, channel, reason, retryable },
    });
  }

  async logRetryScheduled(tenantId: string, notificationId: string, attempt: number, nextAttemptAt: string, reason: string): Promise<void> {
    await this.log({
      tenantId,
      operation: NotificationAuditOperation.NOTIFICATION_RETRY_SCHEDULED,
      referenceId: notificationId,
      referenceType: 'BillingNotification',
      status: 'RETRY_SCHEDULED',
      metadata: { attempt, nextAttemptAt, reason },
    });
  }

  async logPermanentFailure(tenantId: string, notificationId: string, attempt: number, reason: string): Promise<void> {
    await this.log({
      tenantId,
      operation: NotificationAuditOperation.NOTIFICATION_PERMANENT_FAILURE,
      referenceId: notificationId,
      referenceType: 'BillingNotification',
      status: 'PERMANENT_FAILURE',
      metadata: { attempt, reason },
    });
  }

  async logWebhookSent(tenantId: string, subscriptionId: string, eventType: string, providerReference: string | null): Promise<void> {
    await this.log({
      tenantId,
      operation: NotificationAuditOperation.WEBHOOK_NOTIFICATION_SENT,
      referenceId: subscriptionId,
      referenceType: 'WebhookSubscription',
      status: 'SENT',
      metadata: { eventType, providerReference },
    });
  }

  async logWebhookFailed(tenantId: string, subscriptionId: string, eventType: string, reason: string, httpStatus?: number): Promise<void> {
    await this.log({
      tenantId,
      operation: NotificationAuditOperation.WEBHOOK_NOTIFICATION_FAILED,
      referenceId: subscriptionId,
      referenceType: 'WebhookSubscription',
      status: 'FAILED',
      metadata: { eventType, reason, httpStatus },
    });
  }

  async logPreferenceUpdated(tenantId: string, userId: string, preferences: any): Promise<void> {
    await this.log({
      tenantId,
      operation: NotificationAuditOperation.PREFERENCE_UPDATED,
      referenceId: userId,
      referenceType: 'NotificationPreference',
      status: 'UPDATED',
      metadata: { preferences },
    });
  }

  async logTemplateRenderFailed(tenantId: string, templateKey: string, reason: string): Promise<void> {
    await this.log({
      tenantId,
      operation: NotificationAuditOperation.TEMPLATE_RENDER_FAILED,
      referenceId: templateKey,
      referenceType: 'NotificationTemplate',
      status: 'FAILED',
      metadata: { reason },
    });
  }

  async logProviderConfigFailed(provider: string, reason: string): Promise<void> {
    await this.log({
      tenantId: 'system',
      operation: NotificationAuditOperation.PROVIDER_CONFIGURATION_FAILED,
      referenceId: provider,
      referenceType: 'NotificationProvider',
      status: 'FAILED',
      metadata: { reason },
    });
  }

  async logReconciliationDetected(tenantId: string, category: string, referenceId: string, description: string, severity: string): Promise<void> {
    await this.log({
      tenantId,
      operation: NotificationAuditOperation.RECONCILIATION_DETECTED,
      referenceId,
      referenceType: 'NotificationReconciliation',
      status: severity,
      metadata: { category, description },
    });
  }

  private sanitizeMetadata(metadata?: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!metadata) return null;
    const forbidden = ['secret', 'apiKey', 'privateKey', 'accessToken', 'password', 'exchangeSecret', 'providerSecret', 'bankAccount', 'walletKey', 'private_key', 'credentials', 'stripeSecret', 'webhookSecret', 'token', 'card', 'cvv'];
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(metadata)) {
      const lowerKey = key.toLowerCase();
      if (forbidden.some((f) => lowerKey.includes(f.toLowerCase()))) {
        safe[key] = '[REDACTED]';
      } else {
        safe[key] = value;
      }
    }
    return safe;
  }
}
