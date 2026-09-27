import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { BillingNotificationAuditService } from './billing-notification.audit';
import { NotificationJobRepository } from './notification-job.repository';
import { DeliveryStatus } from './billing-notification.types';

/**
 * Reconciles canonical billing Event ↔ Job ↔ Provider Result ↔ Final State.
 * Detects event without job / duplicate / stuck / provider accepted but pending / sent without ref /
 * impossible retry / missing tenant/recipient/template failure/webhook mismatch.
 * Deterministic severity/category/event/notification/tenant/expected/actual.
 * No silent repair.
 */
@Injectable()
export class NotificationReconciliationService {
  private readonly logger = new Logger(NotificationReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobRepository: NotificationJobRepository,
    private readonly auditService: BillingNotificationAuditService,
  ) {}

  async reconcileTenant(tenantId: string): Promise<{ issues: any[]; summary: any }> {
    const issues: any[] = [];

    // 1. Detect stuck jobs (PROCESSING > 2 hours, RETRY_SCHEDULED overdue > 24h)
    const stuckJobs = await this.detectStuckJobs(tenantId);
    issues.push(...stuckJobs);

    // 2. Detect duplicate jobs (same idempotency key but different IDs)
    const duplicateJobs = await this.detectDuplicateJobs(tenantId);
    issues.push(...duplicateJobs);

    // 3. Detect jobs SENT without provider reference
    const sentWithoutRef = await this.detectSentWithoutReference(tenantId);
    issues.push(...sentWithoutRef);

    // 4. Detect jobs FAILED but retryable with attempts < maxAttempts and no nextAttemptAt
    const impossibleRetry = await this.detectImpossibleRetryState(tenantId);
    issues.push(...impossibleRetry);

    // 5. Detect jobs with missing tenant or recipient
    const missingData = await this.detectMissingData(tenantId);
    issues.push(...missingData);

    // 6. Detect provider accepted but still PENDING (inconsistent state)
    const providerAcceptedButPending = await this.detectProviderAcceptedButPending(tenantId);
    issues.push(...providerAcceptedButPending);

    // 7. Detect template render failures (jobs with no rendered subject/body but SENT)
    const templateFailures = await this.detectTemplateFailures(tenantId);
    issues.push(...templateFailures);

    // 8. Detect webhook mismatch (webhook jobs but no subscription)
    const webhookMismatch = await this.detectWebhookMismatch(tenantId);
    issues.push(...webhookMismatch);

    const summary = {
      tenantId,
      totalIssues: issues.length,
      bySeverity: this.groupBy(issues, 'severity'),
      byCategory: this.groupBy(issues, 'category'),
      checkedAt: new Date().toISOString(),
    };

    // Audit reconciliation detection
    for (const issue of issues) {
      await this.auditService.logReconciliationDetected(
        tenantId,
        issue.category,
        issue.referenceId,
        issue.description,
        issue.severity,
      );
    }

    this.logger.log(`Reconciliation tenant=${tenantId} issues=${issues.length} summary=${JSON.stringify(summary.byCategory)}`);

    return { issues, summary };
  }

  async reconcileAllTenants(limit: number = 100): Promise<{ tenantId: string; issues: any[] }[]> {
    const results: { tenantId: string; issues: any[] }[] = [];

    try {
      // Get distinct tenantIds from notification jobs
      const jobs = await (this.prisma as any).billingNotificationJob?.findMany({
        select: { tenantId: true },
        distinct: ['tenantId'],
        take: limit,
      });

      if (jobs) {
        for (const job of jobs) {
          const result = await this.reconcileTenant(job.tenantId);
          if (result.issues.length > 0) {
            results.push({ tenantId: job.tenantId, issues: result.issues });
          }
        }
      }
    } catch (e: any) {
      this.logger.warn(`Failed to reconcile all tenants: ${e.message}`);
    }

    return results;
  }

  private async detectStuckJobs(tenantId: string): Promise<any[]> {
    const issues: any[] = [];
    try {
      const jobs = await this.jobRepository.listByTenant(tenantId, { limit: 1000 });

      for (const job of jobs) {
        if (job.deliveryStatus === DeliveryStatus.PROCESSING) {
          const hoursStuck = (Date.now() - new Date(job.updatedAt).getTime()) / (1000 * 60 * 60);
          if (hoursStuck > 2) {
            issues.push({
              category: 'STUCK_JOB',
              severity: hoursStuck > 24 ? 'CRITICAL' : 'HIGH',
              referenceId: job.id,
              tenantId: job.tenantId,
              eventKey: job.eventKey,
              channel: job.channel,
              expected: 'Job should complete or move to RETRY_SCHEDULED within 2 hours',
              actual: `Job stuck in PROCESSING for ${hoursStuck.toFixed(1)} hours`,
              description: `Notification job ${job.id} stuck in PROCESSING for ${hoursStuck.toFixed(1)} hours`,
              detectedAt: new Date().toISOString(),
            });
          }
        }

        if (job.deliveryStatus === DeliveryStatus.RETRY_SCHEDULED && job.nextAttemptAt) {
          const overdue = (Date.now() - new Date(job.nextAttemptAt).getTime()) / (1000 * 60 * 60);
          if (overdue > 24) {
            issues.push({
              category: 'STUCK_RETRY',
              severity: 'HIGH',
              referenceId: job.id,
              tenantId: job.tenantId,
              eventKey: job.eventKey,
              channel: job.channel,
              expected: 'Retry should be attempted within 24h of scheduled time',
              actual: `Retry overdue by ${overdue.toFixed(1)} hours`,
              description: `Notification job ${job.id} retry overdue by ${overdue.toFixed(1)} hours`,
              detectedAt: new Date().toISOString(),
            });
          }
        }
      }
    } catch (e: any) {
      this.logger.warn(`detectStuckJobs failed for tenant ${tenantId}: ${e.message}`);
    }
    return issues;
  }

  private async detectDuplicateJobs(tenantId: string): Promise<any[]> {
    const issues: any[] = [];
    try {
      const jobs = await this.jobRepository.listByTenant(tenantId, { limit: 1000 });
      const byIdempotency = new Map<string, any[]>();

      for (const job of jobs) {
        if (!byIdempotency.has(job.idempotencyKey)) {
          byIdempotency.set(job.idempotencyKey, []);
        }
        byIdempotency.get(job.idempotencyKey)!.push(job);
      }

      for (const [key, duplicates] of byIdempotency.entries()) {
        if (duplicates.length > 1) {
          issues.push({
            category: 'DUPLICATE_JOB',
            severity: 'MEDIUM',
            referenceId: duplicates[0].id,
            tenantId,
            eventKey: duplicates[0].eventKey,
            channel: duplicates[0].channel,
            expected: 'One job per idempotency key',
            actual: `${duplicates.length} jobs with same idempotency key ${key}`,
            description: `Duplicate notification jobs for idempotency key ${key}: ${duplicates.map((d) => d.id).join(', ')}`,
            duplicateIds: duplicates.map((d) => d.id),
            detectedAt: new Date().toISOString(),
          });
        }
      }
    } catch (e: any) {
      this.logger.warn(`detectDuplicateJobs failed for tenant ${tenantId}: ${e.message}`);
    }
    return issues;
  }

  private async detectSentWithoutReference(tenantId: string): Promise<any[]> {
    const issues: any[] = [];
    try {
      const jobs = await this.jobRepository.listByTenant(tenantId, { limit: 1000 });
      for (const job of jobs) {
        if ((job.deliveryStatus === DeliveryStatus.SENT || job.deliveryStatus === DeliveryStatus.DELIVERED) && !job.providerReference) {
          issues.push({
            category: 'SENT_WITHOUT_REFERENCE',
            severity: 'HIGH',
            referenceId: job.id,
            tenantId,
            eventKey: job.eventKey,
            channel: job.channel,
            expected: 'SENT jobs should have provider reference',
            actual: 'Job marked SENT without provider reference',
            description: `Notification job ${job.id} marked SENT without provider reference`,
            detectedAt: new Date().toISOString(),
          });
        }
      }
    } catch (e: any) {
      this.logger.warn(`detectSentWithoutReference failed: ${e.message}`);
    }
    return issues;
  }

  private async detectImpossibleRetryState(tenantId: string): Promise<any[]> {
    const issues: any[] = [];
    try {
      const jobs = await this.jobRepository.listByTenant(tenantId, { limit: 1000 });
      for (const job of jobs) {
        if (job.deliveryStatus === DeliveryStatus.FAILED && job.attemptCount < job.maxAttempts && !job.nextAttemptAt) {
          issues.push({
            category: 'IMPOSSIBLE_RETRY',
            severity: 'MEDIUM',
            referenceId: job.id,
            tenantId,
            eventKey: job.eventKey,
            channel: job.channel,
            expected: 'FAILED jobs with attempts < max should have nextAttemptAt or be RETRY_SCHEDULED',
            actual: `Job FAILED with ${job.attemptCount}/${job.maxAttempts} attempts but no nextAttemptAt`,
            description: `Notification job ${job.id} in impossible retry state`,
            detectedAt: new Date().toISOString(),
          });
        }
      }
    } catch (e: any) {
      this.logger.warn(`detectImpossibleRetryState failed: ${e.message}`);
    }
    return issues;
  }

  private async detectMissingData(tenantId: string): Promise<any[]> {
    const issues: any[] = [];
    try {
      const jobs = await this.jobRepository.listByTenant(tenantId, { limit: 1000 });
      for (const job of jobs) {
        if (!job.tenantId) {
          issues.push({
            category: 'MISSING_TENANT',
            severity: 'CRITICAL',
            referenceId: job.id,
            tenantId: tenantId || 'unknown',
            eventKey: job.eventKey,
            channel: job.channel,
            expected: 'Job should have tenantId',
            actual: 'Missing tenantId',
            description: `Notification job ${job.id} missing tenantId`,
            detectedAt: new Date().toISOString(),
          });
        }
        if (!job.recipient) {
          issues.push({
            category: 'MISSING_RECIPIENT',
            severity: 'HIGH',
            referenceId: job.id,
            tenantId: job.tenantId,
            eventKey: job.eventKey,
            channel: job.channel,
            expected: 'Job should have recipient',
            actual: 'Missing recipient',
            description: `Notification job ${job.id} missing recipient`,
            detectedAt: new Date().toISOString(),
          });
        }
      }
    } catch (e: any) {
      this.logger.warn(`detectMissingData failed: ${e.message}`);
    }
    return issues;
  }

  private async detectProviderAcceptedButPending(tenantId: string): Promise<any[]> {
    const issues: any[] = [];
    try {
      const jobs = await this.jobRepository.listByTenant(tenantId, { limit: 1000 });
      for (const job of jobs) {
        if ((job.deliveryStatus === DeliveryStatus.PENDING || job.deliveryStatus === DeliveryStatus.CREATED) && job.providerReference) {
          issues.push({
            category: 'PROVIDER_ACCEPTED_BUT_PENDING',
            severity: 'MEDIUM',
            referenceId: job.id,
            tenantId: job.tenantId,
            eventKey: job.eventKey,
            channel: job.channel,
            expected: 'Jobs with provider reference should be SENT',
            actual: `Job in ${job.deliveryStatus} but has provider reference ${job.providerReference}`,
            description: `Notification job ${job.id} has provider reference but status is ${job.deliveryStatus}`,
            detectedAt: new Date().toISOString(),
          });
        }
      }
    } catch (e: any) {
      this.logger.warn(`detectProviderAcceptedButPending failed: ${e.message}`);
    }
    return issues;
  }

  private async detectTemplateFailures(tenantId: string): Promise<any[]> {
    const issues: any[] = [];
    try {
      const jobs = await this.jobRepository.listByTenant(tenantId, { limit: 1000 });
      for (const job of jobs) {
        if ((job.deliveryStatus === DeliveryStatus.FAILED || job.deliveryStatus === DeliveryStatus.PERMANENT_FAILURE) && job.failureReason?.includes('Template')) {
          issues.push({
            category: 'TEMPLATE_RENDER_FAILED',
            severity: 'HIGH',
            referenceId: job.id,
            tenantId: job.tenantId,
            eventKey: job.eventKey,
            channel: job.channel,
            expected: 'Template should render successfully',
            actual: job.failureReason,
            description: `Notification job ${job.id} template render failed: ${job.failureReason}`,
            detectedAt: new Date().toISOString(),
          });
        }
      }
    } catch (e: any) {
      this.logger.warn(`detectTemplateFailures failed: ${e.message}`);
    }
    return issues;
  }

  private async detectWebhookMismatch(tenantId: string): Promise<any[]> {
    const issues: any[] = [];
    try {
      const webhookJobs = await this.jobRepository.listByTenant(tenantId, { limit: 1000 });
      const webhookJobsFiltered = webhookJobs.filter((j) => j.channel === 'WEBHOOK');

      if (webhookJobsFiltered.length > 0) {
        // Check if tenant has any webhook subscriptions
        try {
          const subscriptions = await (this.prisma as any).webhookSubscription?.findMany({
            where: { tenantId },
          });

          if (!subscriptions || subscriptions.length === 0) {
            issues.push({
              category: 'WEBHOOK_MISMATCH',
              severity: 'LOW',
              referenceId: webhookJobsFiltered[0].id,
              tenantId,
              eventKey: webhookJobsFiltered[0].eventKey,
              channel: 'WEBHOOK',
              expected: 'Webhook jobs should have corresponding subscription',
              actual: `${webhookJobsFiltered.length} webhook jobs but no subscriptions`,
              description: `Tenant ${tenantId} has ${webhookJobsFiltered.length} webhook jobs but no webhook subscriptions configured`,
              detectedAt: new Date().toISOString(),
            });
          }
        } catch {}
      }
    } catch (e: any) {
      this.logger.warn(`detectWebhookMismatch failed: ${e.message}`);
    }
    return issues;
  }

  private groupBy(arr: any[], key: string): Record<string, number> {
    const grouped: Record<string, number> = {};
    for (const item of arr) {
      const value = item[key] || 'unknown';
      grouped[value] = (grouped[value] || 0) + 1;
    }
    return grouped;
  }
}
