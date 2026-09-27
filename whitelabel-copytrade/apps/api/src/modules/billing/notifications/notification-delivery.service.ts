import { Injectable, Logger } from '@nestjs/common';
import {
  BillingNotificationEventKey,
  NotificationChannel,
  NotificationPriority,
  NotificationCategory,
  DeliveryStatus,
  SafeNotificationPayload,
} from './billing-notification.types';
import { NotificationJobRepository } from './notification-job.repository';
import { NotificationTemplateService } from './notification-template.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { BillingNotificationAuditService, NotificationAuditOperation } from './billing-notification.audit';
import { NotificationProviderFactory } from './notification-provider.factory';
import { InAppNotificationService } from './in-app-notification.service';
import { BillingWebhookNotificationService } from './billing-webhook-notification.service';
import { randomUUID } from 'crypto';

/**
 * Request → Preference → Template → Persistent Job → Provider Dispatch → Result → Status → Audit.
 * Idempotent, retryable, tenant-safe, provider-neutral. No financial mutation.
 */
@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger(NotificationDeliveryService.name);

  constructor(
    private readonly jobRepository: NotificationJobRepository,
    private readonly templateService: NotificationTemplateService,
    private readonly preferenceService: NotificationPreferenceService,
    private readonly auditService: BillingNotificationAuditService,
    private readonly providerFactory: NotificationProviderFactory,
    private readonly inAppService: InAppNotificationService,
    private readonly webhookService: BillingWebhookNotificationService,
  ) {}

  async requestDelivery(params: {
    tenantId: string;
    userId?: string;
    eventKey: BillingNotificationEventKey;
    channel: NotificationChannel;
    templateKey: string;
    priority: NotificationPriority;
    category: NotificationCategory;
    safePayload: SafeNotificationPayload;
    idempotencyKey: string;
    isMandatory: boolean;
    locale?: string;
  }): Promise<any> {
    const locale = params.locale || 'en';

    // Idempotency check
    const existing = await this.jobRepository.findByIdempotencyKey(params.idempotencyKey);
    if (existing) {
      this.logger.log(`Idempotent delivery request return: idempotencyKey=${params.idempotencyKey} status=${existing.deliveryStatus}`);
      return existing;
    }

    // Preference check - mandatory cannot be disabled for EMAIL/IN_APP
    const prefCheck = await this.preferenceService.isChannelEnabled(params.tenantId, params.userId, params.eventKey, params.channel);

    if (!prefCheck.enabled && !params.isMandatory) {
      this.logger.log(`Notification suppressed by preference tenant=${params.tenantId} event=${params.eventKey} channel=${params.channel} reason=${prefCheck.reason}`);

      const suppressedJob = await this.jobRepository.create({
        tenantId: params.tenantId,
        userId: params.userId,
        recipient: {
          tenantId: params.tenantId,
          userId: params.userId,
          type: 'user',
        },
        eventKey: params.eventKey,
        channel: params.channel,
        templateKey: params.templateKey,
        locale,
        priority: params.priority,
        category: params.category,
        deliveryStatus: DeliveryStatus.SUPPRESSED,
        maxAttempts: 0,
        idempotencyKey: params.idempotencyKey,
        safePayload: params.safePayload,
      });

      await this.auditService.logNotificationSuppressed(params.tenantId, suppressedJob.id, params.eventKey, prefCheck.reason || 'User preference disabled');
      return suppressedJob;
    }

    // Template resolution
    const template = this.templateService.resolveTemplate(params.eventKey, locale, params.channel);
    let rendered: { subject: string; title: string; body: string; htmlBody?: string } | null = null;

    if (template) {
      try {
        rendered = this.templateService.renderTemplate(template, params.safePayload as any);
      } catch (e: any) {
        this.logger.warn(`Template render failed for ${params.templateKey}: ${e.message}`);
        await this.auditService.logTemplateRenderFailed(params.tenantId, params.templateKey, e.message);
        // Continue with fallback
        rendered = {
          subject: `${params.eventKey} - Notification`,
          title: params.eventKey,
          body: `Notification for ${params.eventKey}. Details: ${JSON.stringify(params.safePayload).substring(0, 1000)}`,
        };
      }
    } else {
      this.logger.warn(`Template not found for event=${params.eventKey} channel=${params.channel}, using fallback`);
      await this.auditService.logTemplateRenderFailed(params.tenantId, params.templateKey, `Template not found for ${params.eventKey}`);
      rendered = {
        subject: `${params.eventKey} - Notification`,
        title: params.eventKey,
        body: `Notification for ${params.eventKey}. Details: ${JSON.stringify(params.safePayload).substring(0, 1000)}`,
      };
    }

    // Create persistent job
    const job = await this.jobRepository.create({
      tenantId: params.tenantId,
      userId: params.userId,
      recipient: {
        tenantId: params.tenantId,
        userId: params.userId,
        type: params.userId ? 'user' : 'tenant_admin',
      },
      eventKey: params.eventKey,
      channel: params.channel,
      templateKey: params.templateKey,
      locale,
      priority: params.priority,
      category: params.category,
      deliveryStatus: DeliveryStatus.PENDING,
      maxAttempts: this.getMaxAttemptsForChannel(params.channel, params.priority),
      idempotencyKey: params.idempotencyKey,
      safePayload: params.safePayload,
      renderedSubject: rendered?.subject,
      renderedBody: rendered?.body,
    });

    await this.auditService.logNotificationCreated(params.tenantId, job.id, params.eventKey, params.channel, params.idempotencyKey);

    // Attempt immediate delivery for high priority or if worker not running
    // For critical events, deliver synchronously where appropriate
    if (params.priority === NotificationPriority.CRITICAL || params.channel === NotificationChannel.IN_APP) {
      try {
        await this.deliverJob(job.id);
      } catch (e) {
        this.logger.warn(`Immediate delivery failed for job ${job.id}, will be retried by worker: ${(e as Error).message}`);
      }
    }

    return job;
  }

  async deliverJob(jobId: string): Promise<any> {
    const job = await this.jobRepository.findById(jobId);
    if (!job) throw new Error(`Notification job not found: ${jobId}`);

    if (job.deliveryStatus === DeliveryStatus.SENT || job.deliveryStatus === DeliveryStatus.DELIVERED) {
      this.logger.log(`Job ${jobId} already sent, skipping`);
      return job;
    }

    if (job.deliveryStatus === DeliveryStatus.SUPPRESSED || job.deliveryStatus === DeliveryStatus.CANCELLED) {
      this.logger.log(`Job ${jobId} suppressed/cancelled, skipping`);
      return job;
    }

    // Check max attempts
    if (job.attemptCount >= job.maxAttempts) {
      this.logger.warn(`Job ${jobId} max attempts reached ${job.attemptCount}/${job.maxAttempts}`);
      const updated = await this.jobRepository.updateStatus(job.id, {
        deliveryStatus: DeliveryStatus.PERMANENT_FAILURE,
        failureReason: `Max attempts ${job.maxAttempts} reached`,
      });
      await this.auditService.logPermanentFailure(job.tenantId, job.id, job.attemptCount, `Max attempts reached`);
      return updated;
    }

    // Update to processing
    await this.jobRepository.updateStatus(job.id, {
      deliveryStatus: DeliveryStatus.PROCESSING,
      attemptCount: job.attemptCount + 1,
    });

    try {
      let result: any;

      if (job.channel === NotificationChannel.IN_APP) {
        result = await this.deliverInApp(job);
      } else if (job.channel === NotificationChannel.WEBHOOK) {
        result = await this.deliverWebhook(job);
      } else {
        result = await this.deliverViaProvider(job);
      }

      if (result.accepted) {
        const updated = await this.jobRepository.updateStatus(job.id, {
          deliveryStatus: DeliveryStatus.SENT,
          providerReference: result.providerReference,
          sentAt: new Date().toISOString(),
          failureReason: null,
        });
        await this.auditService.logNotificationSent(job.tenantId, job.id, job.eventKey, job.channel, result.providerReference);
        return updated;
      } else {
        // Handle failure
        if (result.retryable && job.attemptCount + 1 < job.maxAttempts) {
          const nextAttempt = this.calculateNextAttempt(job.attemptCount + 1);
          const updated = await this.jobRepository.updateStatus(job.id, {
            deliveryStatus: DeliveryStatus.RETRY_SCHEDULED,
            nextAttemptAt: nextAttempt,
            failureReason: result.failureReason || result.errorCode,
          });
          await this.auditService.logRetryScheduled(job.tenantId, job.id, job.attemptCount + 1, nextAttempt, result.failureReason || 'Temporary failure');
          return updated;
        } else {
          const updated = await this.jobRepository.updateStatus(job.id, {
            deliveryStatus: result.retryable ? DeliveryStatus.FAILED : DeliveryStatus.PERMANENT_FAILURE,
            failureReason: result.failureReason || result.errorCode,
          });
          if (result.retryable) {
            await this.auditService.logNotificationFailed(job.tenantId, job.id, job.eventKey, job.channel, result.failureReason || 'Failed', result.retryable);
          } else {
            await this.auditService.logPermanentFailure(job.tenantId, job.id, job.attemptCount + 1, result.failureReason || 'Permanent failure');
          }
          return updated;
        }
      }
    } catch (e: any) {
      this.logger.error(`Delivery failed for job ${jobId}: ${e.message}`, e.stack);

      const isTemporary = !e.message.includes('not configured') && !e.message.includes('Invalid') && !e.message.includes('Cannot disable');

      if (isTemporary && job.attemptCount + 1 < job.maxAttempts) {
        const nextAttempt = this.calculateNextAttempt(job.attemptCount + 1);
        const updated = await this.jobRepository.updateStatus(job.id, {
          deliveryStatus: DeliveryStatus.RETRY_SCHEDULED,
          nextAttemptAt: nextAttempt,
          failureReason: e.message,
        });
        await this.auditService.logRetryScheduled(job.tenantId, job.id, job.attemptCount + 1, nextAttempt, e.message);
        return updated;
      } else {
        const updated = await this.jobRepository.updateStatus(job.id, {
          deliveryStatus: isTemporary ? DeliveryStatus.FAILED : DeliveryStatus.PERMANENT_FAILURE,
          failureReason: e.message,
        });
        await this.auditService.logNotificationFailed(job.tenantId, job.id, job.eventKey, job.channel, e.message, isTemporary);
        return updated;
      }
    }
  }

  private async deliverInApp(job: any): Promise<{ accepted: boolean; providerReference: string | null; retryable: boolean; failureReason?: string }> {
    try {
      if (!job.userId) {
        // For tenant-level, need to find admin users - for now fail gracefully
        return {
          accepted: false,
          providerReference: null,
          retryable: false,
          failureReason: 'UserId required for in-app notification',
        };
      }

      const record = await this.inAppService.createNotification({
        tenantId: job.tenantId,
        userId: job.userId,
        eventKey: job.eventKey,
        channel: job.channel,
        title: job.renderedSubject || job.templateKey,
        body: job.renderedBody || JSON.stringify(job.safePayload).substring(0, 1000),
        safePayload: job.safePayload,
        idempotencyKey: job.idempotencyKey,
      });

      return {
        accepted: true,
        providerReference: record.id,
        retryable: false,
      };
    } catch (e: any) {
      return {
        accepted: false,
        providerReference: null,
        retryable: true,
        failureReason: e.message,
      };
    }
  }

  private async deliverWebhook(job: any): Promise<{ accepted: boolean; providerReference: string | null; retryable: boolean; failureReason?: string }> {
    try {
      const result = await this.webhookService.deliverWebhook({
        tenantId: job.tenantId,
        eventId: job.idempotencyKey,
        eventType: job.eventKey,
        payload: job.safePayload,
        idempotencyKey: job.idempotencyKey,
      });

      // Webhook delivery is considered accepted if at least one endpoint succeeded, or if no endpoints configured (not failure)
      if (result.delivered > 0 || result.failed === 0) {
        return {
          accepted: true,
          providerReference: `webhook_${result.delivered}_delivered`,
          retryable: false,
        };
      } else {
        return {
          accepted: false,
          providerReference: null,
          retryable: true,
          failureReason: `Webhook delivery failed: ${result.failed} failed`,
        };
      }
    } catch (e: any) {
      return {
        accepted: false,
        providerReference: null,
        retryable: true,
        failureReason: e.message,
      };
    }
  }

  private async deliverViaProvider(job: any): Promise<{ accepted: boolean; providerReference: string | null; retryable: boolean; failureReason?: string; errorCode?: string }> {
    const provider = this.providerFactory.getProvider(job.channel);

    if (!provider.isAvailable()) {
      return {
        accepted: false,
        providerReference: null,
        retryable: false,
        failureReason: `Provider not available for channel ${job.channel}`,
        errorCode: 'PROVIDER_NOT_CONFIGURED',
      };
    }

    const result = await provider.send({
      recipientEmail: job.safePayload.userEmail || job.safePayload.customerEmail || (job.recipient as any).email,
      recipientUserId: job.userId,
      tenantId: job.tenantId,
      subject: job.renderedSubject || `${job.eventKey} - Notification`,
      body: job.renderedBody || JSON.stringify(job.safePayload),
      htmlBody: job.renderedBody ? undefined : undefined,
      channel: job.channel,
      templateKey: job.templateKey,
      safePayload: job.safePayload,
      idempotencyKey: job.idempotencyKey,
      priority: job.priority,
      locale: job.locale,
    });

    return {
      accepted: result.accepted,
      providerReference: result.providerReference,
      retryable: result.retryable,
      failureReason: result.failureReason,
      errorCode: result.errorCode,
    };
  }

  private getMaxAttemptsForChannel(channel: NotificationChannel, priority: NotificationPriority): number {
    if (channel === NotificationChannel.WEBHOOK) return 8;
    if (priority === NotificationPriority.CRITICAL) return 5;
    if (channel === NotificationChannel.EMAIL) return 3;
    if (channel === NotificationChannel.IN_APP) return 2;
    return 3;
  }

  private calculateNextAttempt(attempt: number): string {
    // Exponential backoff: 1min, 2min, 4min, 8min, 16min, etc, max 1 hour
    const baseMs = 60 * 1000;
    const backoffMs = Math.min(baseMs * Math.pow(2, attempt - 1), 60 * 60 * 1000);
    const jitterMs = Math.floor(Math.random() * 0.1 * backoffMs);
    return new Date(Date.now() + backoffMs + jitterMs).toISOString();
  }
}
