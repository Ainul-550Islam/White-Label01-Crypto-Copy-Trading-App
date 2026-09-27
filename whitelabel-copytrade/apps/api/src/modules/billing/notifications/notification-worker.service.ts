import { Injectable, Logger } from '@nestjs/common';
import { NotificationJobRepository } from './notification-job.repository';
import { NotificationDeliveryService } from './notification-delivery.service';
import { DeliveryStatus } from './billing-notification.types';
import { BillingNotificationAuditService } from './billing-notification.audit';

/**
 * Bounded batch processing, exponential backoff, maxAttempts from config,
 * temporary vs permanent failure handling, timeout, idempotency, stuck-job detection.
 * Never marks SENT before provider acceptance.
 */
@Injectable()
export class NotificationWorkerService {
  private readonly logger = new Logger(NotificationWorkerService.name);
  private isProcessing = false;

  constructor(
    private readonly jobRepository: NotificationJobRepository,
    private readonly deliveryService: NotificationDeliveryService,
    private readonly auditService: BillingNotificationAuditService,
  ) {}

  async processPendingJobs(batchSize: number = 20): Promise<{ processed: number; succeeded: number; failed: number; retried: number }> {
    if (this.isProcessing) {
      this.logger.warn('Worker already processing, skipping');
      return { processed: 0, succeeded: 0, failed: 0, retried: 0 };
    }

    this.isProcessing = true;

    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    let retried = 0;

    try {
      const pendingJobs = await this.jobRepository.findPendingJobs(batchSize);
      this.logger.log(`Processing ${pendingJobs.length} pending notification jobs`);

      for (const job of pendingJobs) {
        try {
          processed++;
          const result = await this.processJobWithTimeout(job.id, 30000);

          if (result.deliveryStatus === DeliveryStatus.SENT || result.deliveryStatus === DeliveryStatus.DELIVERED) {
            succeeded++;
          } else if (result.deliveryStatus === DeliveryStatus.RETRY_SCHEDULED) {
            retried++;
          } else if (result.deliveryStatus === DeliveryStatus.FAILED || result.deliveryStatus === DeliveryStatus.PERMANENT_FAILURE) {
            failed++;
          }
        } catch (e: any) {
          failed++;
          this.logger.warn(`Failed to process pending job ${job.id}: ${e.message}`);
        }
      }

      // Process retryable jobs
      const retryableJobs = await this.jobRepository.findRetryableJobs(batchSize);
      this.logger.log(`Processing ${retryableJobs.length} retryable notification jobs`);

      for (const job of retryableJobs) {
        try {
          // Stuck job detection: if attemptCount exceeds maxAttempts, mark permanent failure
          if (job.attemptCount >= job.maxAttempts) {
            await this.jobRepository.updateStatus(job.id, {
              deliveryStatus: DeliveryStatus.PERMANENT_FAILURE,
              failureReason: `Max attempts ${job.maxAttempts} reached - stuck job detected`,
            });
            await this.auditService.logPermanentFailure(job.tenantId, job.id, job.attemptCount, 'Stuck job - max attempts reached');
            failed++;
            processed++;
            continue;
          }

          // Check if job is stuck (nextAttemptAt in past by > 1 hour and still RETRY_SCHEDULED)
          if (job.nextAttemptAt) {
            const nextAttempt = new Date(job.nextAttemptAt);
            const hoursSinceScheduled = (Date.now() - nextAttempt.getTime()) / (1000 * 60 * 60);
            if (hoursSinceScheduled > 24) {
              this.logger.warn(`Stuck job detected id=${job.id} scheduled=${job.nextAttemptAt} hoursAgo=${hoursSinceScheduled}`);
              await this.auditService.logReconciliationDetected(job.tenantId, 'STUCK_JOB', job.id, `Job stuck in RETRY_SCHEDULED for ${hoursSinceScheduled.toFixed(1)} hours`, 'HIGH');
            }
          }

          processed++;
          const result = await this.processJobWithTimeout(job.id, 30000);

          if (result.deliveryStatus === DeliveryStatus.SENT || result.deliveryStatus === DeliveryStatus.DELIVERED) {
            succeeded++;
          } else if (result.deliveryStatus === DeliveryStatus.RETRY_SCHEDULED) {
            retried++;
          } else {
            failed++;
          }
        } catch (e: any) {
          failed++;
          this.logger.warn(`Failed to process retryable job ${job.id}: ${e.message}`);
        }
      }
    } finally {
      this.isProcessing = false;
    }

    this.logger.log(`Worker batch complete processed=${processed} succeeded=${succeeded} failed=${failed} retried=${retried}`);

    return { processed, succeeded, failed, retried };
  }

  private async processJobWithTimeout(jobId: string, timeoutMs: number): Promise<any> {
    return Promise.race([
      this.deliveryService.deliverJob(jobId),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Job ${jobId} timeout after ${timeoutMs}ms`)), timeoutMs)),
    ]);
  }

  async detectStuckJobs(thresholdHours: number = 2): Promise<any[]> {
    // Find jobs stuck in PROCESSING for more than threshold
    try {
      const pendingJobs = await this.jobRepository.findPendingJobs(1000);
      const stuck: any[] = [];

      for (const job of pendingJobs) {
        if (job.deliveryStatus === DeliveryStatus.PROCESSING) {
          const updatedAt = new Date(job.updatedAt);
          const hoursSinceUpdate = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60);
          if (hoursSinceUpdate > thresholdHours) {
            stuck.push({
              jobId: job.id,
              tenantId: job.tenantId,
              eventKey: job.eventKey,
              channel: job.channel,
              status: job.deliveryStatus,
              hoursStuck: hoursSinceUpdate,
              attemptCount: job.attemptCount,
            });

            // Reset stuck job to RETRY_SCHEDULED
            await this.jobRepository.updateStatus(job.id, {
              deliveryStatus: DeliveryStatus.RETRY_SCHEDULED,
              nextAttemptAt: new Date(Date.now() + 60 * 1000).toISOString(),
              failureReason: `Stuck in PROCESSING for ${hoursSinceUpdate.toFixed(1)} hours - reset to retry`,
            });

            await this.auditService.logReconciliationDetected(job.tenantId, 'STUCK_JOB', job.id, `Job stuck in PROCESSING for ${hoursSinceUpdate.toFixed(1)} hours`, 'HIGH');
          }
        }
      }

      return stuck;
    } catch (e: any) {
      this.logger.warn(`Failed to detect stuck jobs: ${e.message}`);
      return [];
    }
  }

  async processJobById(jobId: string): Promise<any> {
    return this.deliveryService.deliverJob(jobId);
  }
}
