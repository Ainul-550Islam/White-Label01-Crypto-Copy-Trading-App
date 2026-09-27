import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { NotificationWorkerService } from './notification-worker.service';
import { NotificationReconciliationService } from './notification-reconciliation.service';

/**
 * Scheduler for billing notification worker and reconciliation.
 * Processes pending jobs every 30s, detects stuck jobs every 5m, reconciles hourly.
 * Bounded batch, no infinite retries, tenant-safe.
 */
@Injectable()
export class NotificationSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationSchedulerService.name);
  private intervals: NodeJS.Timeout[] = [];
  private isEnabled: boolean;

  constructor(
    private readonly workerService: NotificationWorkerService,
    private readonly reconciliationService: NotificationReconciliationService,
  ) {
    this.isEnabled = process.env.BILLING_NOTIFICATIONS_SCHEDULER_ENABLED !== 'false';
  }

  onModuleInit(): void {
    if (!this.isEnabled) {
      this.logger.log('Billing notification scheduler disabled via env BILLING_NOTIFICATIONS_SCHEDULER_ENABLED=false');
      return;
    }

    this.logger.log('Starting billing notification scheduler: worker 30s, stuck detection 5m, reconciliation 1h');

    // Process pending jobs every 30 seconds
    const workerInterval = setInterval(async () => {
      try {
        const result = await this.workerService.processPendingJobs(50);
        if (result.processed > 0) {
          this.logger.log(`Scheduler worker batch processed=${result.processed} succeeded=${result.succeeded} failed=${result.failed} retried=${result.retried}`);
        }
      } catch (e: any) {
        this.logger.warn(`Scheduler worker failed: ${e.message}`);
      }
    }, 30 * 1000);
    this.intervals.push(workerInterval);

    // Detect stuck jobs every 5 minutes
    const stuckInterval = setInterval(async () => {
      try {
        const stuck = await this.workerService.detectStuckJobs(2);
        if (stuck.length > 0) {
          this.logger.warn(`Scheduler detected ${stuck.length} stuck notification jobs`);
        }
      } catch (e: any) {
        this.logger.warn(`Scheduler stuck detection failed: ${e.message}`);
      }
    }, 5 * 60 * 1000);
    this.intervals.push(stuckInterval);

    // Reconciliation every hour (sample of tenants)
    const reconInterval = setInterval(async () => {
      try {
        const results = await this.reconciliationService.reconcileAllTenants(20);
        if (results.length > 0) {
          this.logger.warn(`Scheduler reconciliation found ${results.length} tenants with issues`);
        }
      } catch (e: any) {
        this.logger.warn(`Scheduler reconciliation failed: ${e.message}`);
      }
    }, 60 * 60 * 1000);
    this.intervals.push(reconInterval);
  }

  onModuleDestroy(): void {
    this.logger.log('Stopping billing notification scheduler');
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals = [];
  }

  async triggerWorkerManually(batchSize: number = 50): Promise<any> {
    return this.workerService.processPendingJobs(batchSize);
  }

  async triggerStuckDetectionManually(thresholdHours: number = 2): Promise<any> {
    return this.workerService.detectStuckJobs(thresholdHours);
  }

  async triggerReconciliationManually(tenantId?: string): Promise<any> {
    if (tenantId) {
      return this.reconciliationService.reconcileTenant(tenantId);
    }
    return this.reconciliationService.reconcileAllTenants(20);
  }
}
