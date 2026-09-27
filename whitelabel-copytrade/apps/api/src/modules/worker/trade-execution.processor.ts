/**
 * TRADE_EXECUTION consumer: the queue half of the trading worker.
 *
 * This processor deliberately contains no trading logic. It admits, routes,
 * and acknowledges:
 *
 *  1. VALIDATE the job against the mirrored producer contract
 *     (worker.types.ts). Malformed or unknown names are Unrecoverable -
 *     retrying a payload no worker can execute wastes attempts and hides the
 *     real failure.
 *  2. ADMIT by partition: the account in the payload maps to a partition,
 *     and this process may act only while it HOLDS that partition's claim
 *     (coordination service; synchronous verdict, fail-closed on staleness).
 *     Not admitted => delayed re-delivery, counted, ceilinged - never
 *     "processed anyway", and never a silent success.
 *  3. SERIALISE per account within this process, cheaply. Cross-process
 *     serialisation for the same account is STRUCTURAL (one owner per
 *     partition, and one account always lands in one partition); inside the
 *     engine, the core's own per-order/per-account locks run underneath. A
 *     fourth lock layer here would guard nothing and cost a Redis RTT.
 *  4. FORWARD to the execution engine over the internal client, then apply
 *     the ack policy: an HTTP 2xx is a durable answer (accepted OR
 *     rejected-by-risk/venue) and completes the job; the engine's terminal
 *     4xx/501 fail the job VISIBLY with the engine's reason; transport
 *     failures and 5xx throw so BullMQ retries inside the producer's attempt
 *     budget. This boundary is the only place the word "success" is earned.
 *
 * Correlation and tracing ride the Part 10 machinery: the publisher's
 * context is restored from the queue sidecar, every job runs inside
 * 'queue.process', and completions/failures fold into the SAME queueproc
 * counters the maintenance worker feeds - the SLO gap law counts this queue
 * with no extra wiring.
 */

import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Job, UnrecoverableError } from 'bullmq';
import { JOB_NAMES, QUEUE_NAMES } from '@wlct/config';

import { AppConfigService } from '../../config/app-config.service';
import { TracingService } from '../../infrastructure/tracing/tracing.service';
import { SloSamplesService } from '../observability/slo-samples';
import { EngineCallError, EngineInternalClient } from './engine-internal.client';
import { WorkerCoordinationService } from './worker-coordination.service';
import { parseTradeExecutionPayload, TRADE_EXECUTION_COMMANDS } from './worker.types';

interface DeferProgress {
  readonly defers: number;
}

function readDefers(job: Job): number {
  if (typeof job.progress === 'object' && job.progress !== null) {
    const raw = (job.progress as Partial<DeferProgress>).defers;
    return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : 0;
  }
  return 0;
}

@Injectable()
@Processor(QUEUE_NAMES.TRADE_EXECUTION, { concurrency: 10 })
export class TradeExecutionProcessor extends WorkerHost implements OnApplicationBootstrap {
  /** Accounts with a command in flight in THIS process. The guard is
   * in-memory by necessity (it protects the handler, not the venue) and
   * sufficient because cross-process contention is partition-owned above. */
  private readonly inFlightAccounts = new Set<string>();

  constructor(
    private readonly config: AppConfigService,
    private readonly coordination: WorkerCoordinationService,
    private readonly engine: EngineInternalClient,
    private readonly tracing: TracingService,
    private readonly sloSamples: SloSamplesService,
    @InjectPinoLogger(TradeExecutionProcessor.name) private readonly logger: PinoLogger,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    // Same queueproc fold as every other inline worker: completed/failed on
    // the BullMQ events, not on guesses inside the handler (a handler can
    // return and still have the job moved by another path; the events are
    // the truth BullMQ itself reports).
    this.worker.on('completed', () => {
      void this.sloSamples.recordCounters('queueproc', 1, 0).catch(() => undefined);
    });
    this.worker.on('failed', () => {
      void this.sloSamples.recordCounters('queueproc', 0, 1).catch(() => undefined);
    });
    this.logger.info(
      {
        event: 'worker.trade_execution_started',
        memberId: this.config.workerId,
        partitionCount: this.config.workerPartitionCount,
        commands: [...TRADE_EXECUTION_COMMANDS],
      },
      'TRADE_EXECUTION consumer online',
    );
  }

  async process(job: Job): Promise<Record<string, unknown>> {
    return this.tracing.withJobContext(
      QUEUE_NAMES.TRADE_EXECUTION,
      job.id ?? 'unknown',
      'queue.process',
      () => this.handle(job),
    );
  }

  private async handle(job: Job): Promise<Record<string, unknown>> {
    let payload;
    try {
      payload = parseTradeExecutionPayload(job.name, job.data);
    } catch (error) {
      throw new UnrecoverableError(
        error instanceof Error ? error.message : 'payload validation failure',
      );
    }

    const partition = this.coordination.partitionForAccount(payload.tenantId, payload.accountId);
    if (!this.coordination.holds(partition)) {
      return this.defer(job, partition);
    }

    const accountKey = `${payload.tenantId}:${payload.accountId}`;
    if (this.inFlightAccounts.has(accountKey)) {
      // Same account, same process, overlapping jobs: defer rather than
      // interleave. This is rarer than it sounds (cancel + refresh for one
      // account), but it is exactly the case where ordering would otherwise
      // be decided by coroutine luck.
      return this.defer(job, partition);
    }

    this.inFlightAccounts.add(accountKey);
    try {
      const correlationId = `${job.id ?? 'job'}:${job.attemptsMade}`;
      if (job.name === JOB_NAMES.CANCEL_ORDER && 'orderId' in payload) {
        const receipt = await this.engine.cancelOrder(payload, correlationId);
        this.logger.info(
          {
            event: 'worker.trade_execution.done',
            command: job.name,
            tenantId: payload.tenantId,
            accountId: payload.accountId,
            orderId: payload.orderId,
            outcome: receipt.outcome,
            code: receipt.code,
            jobId: job.id ?? '',
          },
          'TRADE_EXECUTION job completed',
        );
        return receipt.detail as Record<string, unknown>;
      }
      if (job.name === JOB_NAMES.CANCEL_ORDER) {
        // parseTradeExecutionPayload guarantees the fields for cancel; this
        // arm is unreachable unless the validator and the types drift apart.
        // Unrecoverable beats "cast and pray" for drift: it fails visibly.
        throw new UnrecoverableError('CANCEL_ORDER payload lost its order identity');
      }
      const receipt = await this.engine.executeAccountCommand(job.name, payload, correlationId);
      this.logger.info(
        {
          event: 'worker.trade_execution.done',
          command: job.name,
          tenantId: payload.tenantId,
          accountId: payload.accountId,
          outcome: receipt.outcome,
          code: receipt.code,
          jobId: job.id ?? '',
        },
        'TRADE_EXECUTION job completed',
      );
      return receipt.detail as Record<string, unknown>;
    } catch (error) {
      if (error instanceof EngineCallError) {
        if (error.isTerminal) {
          this.logger.warn(
            {
              event: 'worker.trade_execution.terminal_failure',
              command: job.name,
              tenantId: payload.tenantId,
              accountId: payload.accountId,
              code: error.code,
              status: error.status ?? 0,
              ...(error.correlationId !== undefined ? { engineCorrelation: error.correlationId } : {}),
            },
            'TRADE_EXECUTION job failed terminally at the engine',
          );
          throw new UnrecoverableError(`${error.code}: ${error.message}`);
        }
        this.logger.warn(
          {
            event: 'worker.trade_execution.retryable_failure',
            command: job.name,
            tenantId: payload.tenantId,
            accountId: payload.accountId,
            code: error.code,
            attempt: job.attemptsMade + 1,
            ...(error.correlationId !== undefined ? { engineCorrelation: error.correlationId } : {}),
          },
          'TRADE_EXECUTION job will be retried',
        );
        throw error; // ordinary Error semantics: BullMQ retries within budget
      }
      throw error;
    } finally {
      this.inFlightAccounts.delete(accountKey);
    }
  }

  /** The not-owner path: delayed re-delivery, counted and ceilinged.
   *
   * `moveToDelayed` while processing is BullMQ's own deferral primitive:
   * the job is re-queued for later WITHOUT completing and WITHOUT
   * consuming an attempt. The attempt budget stays reserved for real
   * execution failures - churn over partition ownership is a routing fact,
   * not worker error, and mixing the two would make a rebalance look like
   * a crash loop (and vice versa). The progress counter exists so the
   * ceiling can fail a permanently homeless job instead of letting it
   * orbit forever; the ceiling value itself is config.
   */
  private async defer(job: Job, partition: number): Promise<Record<string, unknown>> {
    this.coordination.noteDeferral();
    const defers = readDefers(job) + 1;
    if (defers > this.config.workerMaxDefers) {
      throw new UnrecoverableError(
        `partition ${partition} is not claimable by ${this.config.workerId} after ` +
          `${defers - 1} deferrals; failing visibly - check WORKER_MEMBERSHIP and Redis`,
      );
    }
    await job.updateProgress({ defers });
    await job.moveToDelayed(Date.now() + this.config.workerDeferDelayMs);
    this.logger.debug(
      {
        event: 'worker.trade_execution.deferred',
        jobId: job.id ?? '',
        partition,
        defers,
      },
      'job deferred to the partition owner',
    );
    // Returning after moveToDelayed is the documented deferral completion:
    // the job is DELAYED in Redis at this point, so this return value
    // describes "parked", not "done" - no caller may read trading meaning
    // into it, and the type here is a bare object for exactly that reason.
    return { deferred: true, partition, defers };
  }
}
