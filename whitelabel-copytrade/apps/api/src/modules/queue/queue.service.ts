import { Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Queue, type JobsOptions } from 'bullmq';
import { QUEUE_NAMES, type QueueName } from '@wlct/config';

import { TracingService } from '../../infrastructure/tracing/tracing.service';

export interface QueueDepth {
  name: QueueName;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  paused: boolean;
  /**
   * Age in ms of the oldest WAITING job, null when the queue is empty or the
   * head job cannot be read. Sampled with two extra BullMQ calls per queue
   * (peek the waiting head, fetch its timestamp) - deliberately bounded: it
   * reads ONE job id, never the list. A queue with a million waiting jobs
   * costs the same as an empty one, which is the whole reason this lives on
   * the depth snapshot instead of behind a separate endpoint.
   */
  oldestWaitingAgeMs: number | null;
}

/**
 * Typed facade over BullMQ.
 *
 * Enqueue failures never bubble into a request: background work is by
 * definition not part of the caller's transaction, so a Redis hiccup logs an
 * error rather than failing a user-visible operation. Callers that genuinely
 * need delivery guarantees use `enqueueOrThrow`.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly queues: Map<QueueName, Queue>;

  constructor(
    @InjectQueue(QUEUE_NAMES.AUDIT) auditQueue: Queue,
    @InjectQueue(QUEUE_NAMES.EMAIL) emailQueue: Queue,
    @InjectQueue(QUEUE_NAMES.NOTIFICATION) notificationQueue: Queue,
    @InjectQueue(QUEUE_NAMES.SECURITY) securityQueue: Queue,
    @InjectQueue(QUEUE_NAMES.MAINTENANCE) maintenanceQueue: Queue,
    @InjectQueue(QUEUE_NAMES.BILLING) billingQueue: Queue,
    @InjectQueue(QUEUE_NAMES.TRADE_SIGNAL) tradeSignalQueue: Queue,
    @InjectQueue(QUEUE_NAMES.TRADE_EXECUTION) tradeExecutionQueue: Queue,
    @InjectQueue(QUEUE_NAMES.MARKET_SNAPSHOT) marketSnapshotQueue: Queue,
    // Part 6 and Part 7 registered their queues at the BullMQ module level
    // but the facade's map still ended at the Part 3 set - a request that
    // reached `getQueue(STRATEGY_CONTROL)` outside the mocked test harness
    // would have thrown "not registered". Fixing that here, once, for all
    // three later queues, so every QUEUE_NAMES entry actually resolves.
    @InjectQueue(QUEUE_NAMES.STRATEGY_CONTROL) strategyControlQueue: Queue,
    @InjectQueue(QUEUE_NAMES.DATASET_CONTROL) datasetControlQueue: Queue,
    @InjectQueue(QUEUE_NAMES.RISK_CONTROL) riskControlQueue: Queue,
    @InjectPinoLogger(QueueService.name) private readonly logger: PinoLogger,
    // Part 10: optional so the test harness (and any queue-only tool) can
    // construct the service without the telemetry plane; LAST parameter, as
    // any optional-injection addition to a DI constructor must be.
    @Optional() private readonly tracing?: TracingService,
  ) {
    this.queues = new Map<QueueName, Queue>([
      [QUEUE_NAMES.AUDIT, auditQueue],
      [QUEUE_NAMES.EMAIL, emailQueue],
      [QUEUE_NAMES.NOTIFICATION, notificationQueue],
      [QUEUE_NAMES.SECURITY, securityQueue],
      [QUEUE_NAMES.MAINTENANCE, maintenanceQueue],
      [QUEUE_NAMES.BILLING, billingQueue],
      [QUEUE_NAMES.TRADE_SIGNAL, tradeSignalQueue],
      [QUEUE_NAMES.TRADE_EXECUTION, tradeExecutionQueue],
      [QUEUE_NAMES.MARKET_SNAPSHOT, marketSnapshotQueue],
      [QUEUE_NAMES.STRATEGY_CONTROL, strategyControlQueue],
      [QUEUE_NAMES.DATASET_CONTROL, datasetControlQueue],
      [QUEUE_NAMES.RISK_CONTROL, riskControlQueue],
    ]);
  }

  getQueue(name: QueueName): Queue {
    const queue = this.queues.get(name);
    if (!queue) {
      throw new Error(`Queue "${name}" is not registered`);
    }
    return queue;
  }

  /** Part 10: every successful publish carries the caller's trace into the
   *  job's sidecar - a transport annotation beside the payload, never
   *  inside it, because job payloads are replayed and versioned and a trace
   *  context is neither. Fire-and-forget by call sites: correlation is not
   *  allowed to fail a publish. */
  private async attachSidecar(name: QueueName, jobId: string | null): Promise<void> {
    if (this.tracing === undefined || jobId === null || jobId === '') {
      return;
    }
    await this.tracing.captureQueueSidecar(name, jobId).catch(() => undefined);
  }

  /** Best-effort enqueue. Returns the job id, or null when enqueueing failed. */
  async enqueue<T extends object>(
    name: QueueName,
    jobName: string,
    payload: T,
    options?: JobsOptions,
  ): Promise<string | null> {
    try {
      const job = await this.getQueue(name).add(jobName, payload, options);
      const jobId = job.id ?? null;
      await this.attachSidecar(name, jobId);
      return jobId;
    } catch (error) {
      this.logger.error(
        {
          event: 'queue.enqueue_failed',
          queue: name,
          jobName,
          err: error instanceof Error ? { message: error.message, name: error.name } : undefined,
        },
        'Failed to enqueue background job',
      );
      return null;
    }
  }

  /** Enqueue that propagates failures to the caller. */
  async enqueueOrThrow<T extends object>(
    name: QueueName,
    jobName: string,
    payload: T,
    options?: JobsOptions,
  ): Promise<string> {
    const job = await this.getQueue(name).add(jobName, payload, options);
    const jobId = job.id ?? '';
    await this.attachSidecar(name, jobId === '' ? null : jobId);
    return jobId;
  }

  /**
   * Registers a repeating job. `jobId` keeps the repeat definition idempotent
   * across restarts and rolling deployments.
   */
  async schedule<T extends object>(
    name: QueueName,
    jobName: string,
    payload: T,
    pattern: string,
  ): Promise<void> {
    await this.getQueue(name).add(jobName, payload, {
      repeat: { pattern },
      jobId: `repeat:${jobName}`,
      removeOnComplete: true,
    });
  }

  async getDepths(): Promise<QueueDepth[]> {
    const depths: QueueDepth[] = [];

    for (const [name, queue] of this.queues.entries()) {
      const counts = await queue.getJobCounts(
        'waiting',
        'active',
        'delayed',
        'failed',
        'completed',
      );

      let oldestWaitingAgeMs: number | null = null;
      if ((counts.waiting ?? 0) > 0) {
        // Best-effort: a head-job read failure leaves the age null (unknown),
        // never zero. Zero oldest-age on a waiting queue would be a
        // comfortable lie during exactly the backlog this is for.
        try {
          // BullMQ's getWaiting(start, end) materialises the page as Job
          // objects; a two-element page is a two-element fetch, not a scan.
          const [headJob] = await queue.getWaiting(0, 0);
          if (headJob?.timestamp) {
            oldestWaitingAgeMs = Math.max(0, Date.now() - headJob.timestamp);
          }
        } catch {
          oldestWaitingAgeMs = null;
        }
      }

      depths.push({
        name,
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
        completed: counts.completed ?? 0,
        paused: await queue.isPaused(),
        oldestWaitingAgeMs,
      });
    }

    return depths;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      [...this.queues.values()].map(async (queue) => {
        try {
          await queue.close();
        } catch {
          // Shutdown is best-effort; the process is exiting either way.
        }
      }),
    );
  }
}
