import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { OperationalAuditService } from './operational-audit.service';
import { JobHealthResult, redactSecrets } from './operations.types';

/**
 * Tracks operational health of scheduled/background jobs, detects stale or repeatedly failing jobs,
 * records execution metadata, and exposes safe diagnostics without changing business truth.
 */

@Injectable()
export class JobHealthService {
  private readonly logger = new Logger(JobHealthService.name);

  private readonly STALE_JOB_MS = 10 * 60 * 1000; // 10 minutes without heartbeat is stale
  private readonly FAILING_THRESHOLD = 5; // 5 failures in a row is repeatedly failing

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly auditService: OperationalAuditService,
  ) {}

  async evaluate(): Promise<JobHealthResult[]> {
    const checkedAt = new Date().toISOString();
    const results: JobHealthResult[] = [];

    try {
      // Check BullMQ jobs for staleness and repeated failures
      const depths = await this.queueService.getDepths().catch(() => []);
      // For each queue, we would inspect jobs - but to avoid heavy scan, we use depth metadata
      // and supplement with known scheduled jobs from existing infrastructure

      // Known operational jobs from existing scheduler/queue infrastructure
      const knownJobs = [
        { jobName: 'reconciliation-scheduler', queueName: 'MAINTENANCE' },
        { jobName: 'risk-snapshot', queueName: 'RISK_CONTROL' },
        { jobName: 'market-snapshot', queueName: 'MARKET_SNAPSHOT' },
        { jobName: 'trade-signal', queueName: 'TRADE_SIGNAL' },
        { jobName: 'trade-execution', queueName: 'TRADE_EXECUTION' },
        { jobName: 'billing-cycle', queueName: 'BILLING' },
        { jobName: 'audit-flush', queueName: 'AUDIT' },
        { jobName: 'notification-delivery', queueName: 'NOTIFICATION' },
      ];

      for (const known of knownJobs) {
        const queueDepth = depths.find((d) => (d.name as string).toLowerCase().includes(known.queueName.toLowerCase()));
        const isStale = queueDepth ? (queueDepth.oldestWaitingAgeMs ?? 0) > this.STALE_JOB_MS : false;
        const failureCount = queueDepth?.failed ?? 0;
        const isRepeatedlyFailing = failureCount >= this.FAILING_THRESHOLD;

        results.push({
          jobName: known.jobName,
          queueName: known.queueName,
          lastRunAt: null, // Would be populated from job execution metadata if available
          lastSuccessAt: null,
          lastFailureAt: isRepeatedlyFailing ? checkedAt : null,
          failureCount,
          isStale,
          isRepeatedlyFailing,
          executionMetadata: redactSecrets({
            waiting: queueDepth?.waiting ?? 0,
            active: queueDepth?.active ?? 0,
            failed: failureCount,
            oldestWaitingAgeMs: queueDepth?.oldestWaitingAgeMs ?? null,
          }),
          checkedAt,
        });
      }

      // Check for stale reconciliation runs that never finished
      try {
        const staleThreshold = new Date(Date.now() - this.STALE_JOB_MS);
        const staleRecons = await (this.prisma as any).operationalReconciliationRun.findMany({
          where: {
            status: 'RUNNING',
            startTime: { lt: staleThreshold },
          },
          take: 20,
        });
        for (const stale of staleRecons) {
          results.push({
            jobName: `reconciliation-${stale.reconciliationType}`,
            queueName: 'RECONCILIATION',
            lastRunAt: stale.startTime?.toISOString() ?? null,
            lastSuccessAt: null,
            lastFailureAt: null,
            failureCount: 0,
            isStale: true,
            isRepeatedlyFailing: false,
            executionMetadata: redactSecrets({
              runId: stale.id,
              type: stale.reconciliationType,
              durationMs: stale.durationMs,
              status: stale.status,
            }),
            checkedAt,
          });
        }
      } catch {}

      await this.auditService.record({
        tenantId: null,
        eventType: 'JOB_HEALTH_CHECK' as any,
        actorId: null,
        actorType: 'SYSTEM',
        targetType: 'JOB',
        targetId: 'all',
        evidence: redactSecrets({
          jobCount: results.length,
          staleCount: results.filter((r) => r.isStale).length,
          failingCount: results.filter((r) => r.isRepeatedlyFailing).length,
        }),
        correlationId: null,
      });

      return results;
    } catch (e) {
      const msg = (e as Error).message;
      this.logger.error(`Job health evaluation failed: ${msg}`);
      await this.auditService.record({
        tenantId: null,
        eventType: 'JOB_HEALTH_CHECK' as any,
        actorId: null,
        actorType: 'SYSTEM',
        targetType: 'JOB',
        targetId: 'all',
        evidence: redactSecrets({ error: msg }),
        correlationId: null,
      });
      return [];
    }
  }

  async getStaleJobs(): Promise<JobHealthResult[]> {
    const all = await this.evaluate();
    return all.filter((j) => j.isStale);
  }

  async getFailingJobs(): Promise<JobHealthResult[]> {
    const all = await this.evaluate();
    return all.filter((j) => j.isRepeatedlyFailing);
  }
}
