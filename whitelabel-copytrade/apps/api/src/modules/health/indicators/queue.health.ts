import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';

import { QueueService } from '../../queue/queue.service';

/**
 * Reports queue backlog. Deliberately not part of readiness: a growing backlog
 * is an operational signal, not a reason to pull an API node out of rotation.
 */
@Injectable()
export class QueueHealthIndicator extends HealthIndicator {
  private static readonly BACKLOG_THRESHOLD = 10_000;

  constructor(private readonly queues: QueueService) {
    super();
  }

  async check(key: string): Promise<HealthIndicatorResult> {
    try {
      const depths = await this.queues.getDepths();
      const totalWaiting = depths.reduce((sum, depth) => sum + depth.waiting, 0);
      const totalFailed = depths.reduce((sum, depth) => sum + depth.failed, 0);

      const healthy = totalWaiting < QueueHealthIndicator.BACKLOG_THRESHOLD;
      const details = {
        totalWaiting,
        totalFailed,
        queues: depths.map((depth) => ({
          name: depth.name,
          waiting: depth.waiting,
          active: depth.active,
          failed: depth.failed,
          paused: depth.paused,
        })),
      };

      if (!healthy) {
        throw new HealthCheckError('Queue backlog exceeds threshold', this.getStatus(key, false, details));
      }

      return this.getStatus(key, true, details);
    } catch (error) {
      if (error instanceof HealthCheckError) {
        throw error;
      }
      const result = this.getStatus(key, false, {
        error: error instanceof Error ? error.name : 'UnknownError',
      });
      throw new HealthCheckError('Queue backend is not available', result);
    }
  }
}
