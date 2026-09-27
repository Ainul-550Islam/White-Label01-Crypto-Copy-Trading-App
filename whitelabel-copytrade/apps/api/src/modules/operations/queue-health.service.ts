import { Injectable, Logger } from '@nestjs/common';
import { QueueService } from '../queue/queue.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OperationalAuditService } from './operational-audit.service';
import { QueueHealthResult, redactSecrets } from './operations.types';

/**
 * Evaluates queue connectivity, backlog, stale jobs, failed jobs, retry pressure,
 * worker availability, and processing latency using the existing queue infrastructure.
 * Must not create a second queue implementation.
 */

@Injectable()
export class QueueHealthService {
  private readonly logger = new Logger(QueueHealthService.name);

  private readonly STALE_JOB_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes waiting is stale
  private readonly RETRY_PRESSURE_FAILED_THRESHOLD = 100;

  constructor(
    private readonly queueService: QueueService,
    private readonly prisma: PrismaService,
    private readonly auditService: OperationalAuditService,
  ) {}

  async evaluate(): Promise<QueueHealthResult[]> {
    const checkedAt = new Date().toISOString();
    try {
      const depths = await this.queueService.getDepths();
      const results: QueueHealthResult[] = depths.map((depth) => {
        const hasStaleJobs = depth.oldestWaitingAgeMs !== null && depth.oldestWaitingAgeMs > this.STALE_JOB_THRESHOLD_MS;
        const hasRetryPressure = depth.failed > this.RETRY_PRESSURE_FAILED_THRESHOLD;
        return {
          queueName: depth.name as string,
          isConnected: true,
          waiting: depth.waiting,
          active: depth.active,
          delayed: depth.delayed,
          failed: depth.failed,
          paused: depth.paused,
          oldestWaitingAgeMs: depth.oldestWaitingAgeMs,
          hasStaleJobs,
          hasRetryPressure,
          evidence: redactSecrets({
            waiting: depth.waiting,
            active: depth.active,
            delayed: depth.delayed,
            failed: depth.failed,
            paused: depth.paused,
            oldestWaitingAgeMs: depth.oldestWaitingAgeMs,
          }),
          checkedAt,
        };
      });

      await this.auditService.record({
        tenantId: null,
        eventType: 'QUEUE_HEALTH_CHECK' as any,
        actorId: null,
        actorType: 'SYSTEM',
        targetType: 'QUEUE',
        targetId: 'all',
        evidence: redactSecrets({
          queueCount: results.length,
          totalWaiting: results.reduce((a, r) => a + r.waiting, 0),
          totalFailed: results.reduce((a, r) => a + r.failed, 0),
          hasStale: results.some((r) => r.hasStaleJobs),
          hasRetryPressure: results.some((r) => r.hasRetryPressure),
        }),
        correlationId: null,
      });

      return results;
    } catch (e) {
      const msg = (e as Error).message;
      this.logger.error(`Queue health check failed: ${msg}`);
      // Never report healthy unless actually verified — on failure, report UNAVAILABLE via empty result with evidence
      await this.auditService.record({
        tenantId: null,
        eventType: 'QUEUE_HEALTH_CHECK' as any,
        actorId: null,
        actorType: 'SYSTEM',
        targetType: 'QUEUE',
        targetId: 'all',
        evidence: redactSecrets({ error: msg, isConnected: false }),
        correlationId: null,
      });
      // Return a synthetic result indicating failure detected correctly
      return [
        {
          queueName: 'unknown',
          isConnected: false,
          waiting: 0,
          active: 0,
          delayed: 0,
          failed: 0,
          paused: false,
          oldestWaitingAgeMs: null,
          hasStaleJobs: false,
          hasRetryPressure: false,
          evidence: redactSecrets({ error: msg, isConnected: false }),
          checkedAt,
        },
      ];
    }
  }

  async getQueueDepth(queueName: string): Promise<QueueHealthResult | null> {
    const all = await this.evaluate();
    return all.find((q) => q.queueName === queueName) ?? null;
  }

  async isQueueHealthy(queueName: string): Promise<boolean> {
    const depth = await this.getQueueDepth(queueName);
    if (!depth) return false;
    if (!depth.isConnected) return false;
    if (depth.paused) return false;
    if (depth.hasStaleJobs) return false;
    if (depth.failed > this.RETRY_PRESSURE_FAILED_THRESHOLD) return false;
    return true;
  }
}
