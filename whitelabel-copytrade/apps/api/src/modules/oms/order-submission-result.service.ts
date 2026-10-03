import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { QueueEvents } from 'bullmq';
import { JOB_NAMES, QUEUE_NAMES } from '@wlct/config';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import { QueueService } from '../queue/queue.service';
import { ExecutionAckService } from './execution-ack.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderIntentState } from './oms.types';
import { clientOrderIdFromJobId } from './order-submission.payload';

/**
 * Phase 3 — records what the execution engine decided about a SUBMIT_ORDER
 * job back onto the platform's own records.
 *
 * The worker holds no database (worker.module.ts), so the verdict travels as
 * the job's return value: the engine's SubmitOrderResponse plus the platform
 * ids the worker echoes (platformOrderId, omsIntentId, tenantId). This
 * service reads it from BullMQ's own event stream - the truth BullMQ reports,
 * not a guess - and applies it to three records:
 *
 *   1. the canonical `order` row (status, fills summary, rejection);
 *   2. the OMS intent, via ExecutionAckService (ACK/REJECT) and the lifecycle
 *      service (FILLED / PARTIALLY_FILLED);
 *   3. the copy execution the order was created for, when there is one.
 *
 * Every write is idempotent: a replayed event (two API replicas, a restart
 * sweep) re-applies the same terminal facts. Events missed while the API was
 * down are recovered by {@link sweepPending}, which asks BullMQ for the job by
 * its deterministic id.
 */

export type SubmissionVerdict =
  | { kind: 'accepted'; orderStatus: 'ACKNOWLEDGED' | 'PARTIALLY_FILLED' | 'FILLED' }
  | { kind: 'rejected'; code: string; reason: string }
  | { kind: 'unknown'; reason: string };

export interface SubmissionResultView {
  tenantId: string;
  platformOrderId: string;
  omsIntentId: string | null;
  clientOrderId: string;
  outcome: string;
  engineOrderId: string | null;
  exchangeOrderId: string | null;
  orderStatus: string;
  filledQuantity: string;
  averageFillPrice: string | null;
  cumulativeFee: string;
  feeCurrency: string | null;
  errorCode: string | null;
  message: string | null;
  latencyMicros: number | null;
  isSimulated: boolean;
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function decimalOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && DECIMAL.test(value) ? value : fallback;
}

/** Parse a SUBMIT_ORDER job's return value. Returns null for anything that is
 * not one (another command's receipt, a truncated value) so the caller
 * ignores it instead of writing guesses. */
export function parseSubmissionResult(raw: unknown): SubmissionResultView | null {
  let value: unknown = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const tenantId = str(record.tenantId);
  const platformOrderId = str(record.platformOrderId);
  const clientOrderId = str(record.clientOrderId);
  const outcome = str(record.outcome);
  if (!tenantId || !platformOrderId || !clientOrderId || !outcome) return null;
  return {
    tenantId,
    platformOrderId,
    omsIntentId: str(record.omsIntentId),
    clientOrderId,
    outcome,
    engineOrderId: str(record.engineOrderId),
    exchangeOrderId: str(record.exchangeOrderId),
    orderStatus: str(record.orderStatus) ?? 'UNKNOWN',
    filledQuantity: decimalOr(record.filledQuantity, '0'),
    averageFillPrice: typeof record.averageFillPrice === 'string' && DECIMAL.test(record.averageFillPrice) ? record.averageFillPrice : null,
    cumulativeFee: decimalOr(record.cumulativeFee, '0'),
    feeCurrency: str(record.feeCurrency),
    errorCode: str(record.errorCode),
    message: typeof record.message === 'string' ? record.message : null,
    latencyMicros: typeof record.latencyMicros === 'number' && Number.isFinite(record.latencyMicros) ? record.latencyMicros : null,
    isSimulated: record.isSimulated === true,
  };
}

/** The engine's outcome vocabulary mapped onto the platform's order states.
 * UNKNOWN (an ambiguous venue answer) is deliberately NOT mapped to a
 * rejection: the order may exist, so it stays SUBMITTED and is flagged for
 * reconciliation. */
export function interpretSubmission(result: SubmissionResultView): SubmissionVerdict {
  switch (result.outcome) {
    case 'ACCEPTED':
    case 'DUPLICATE': {
      if (result.orderStatus === 'FILLED') return { kind: 'accepted', orderStatus: 'FILLED' };
      if (result.orderStatus === 'PARTIALLY_FILLED') return { kind: 'accepted', orderStatus: 'PARTIALLY_FILLED' };
      if (result.orderStatus === 'REJECTED') {
        return { kind: 'rejected', code: result.errorCode ?? 'REJECTED', reason: result.message ?? 'Rejected' };
      }
      if (result.outcome === 'DUPLICATE' && result.orderStatus === 'UNKNOWN') {
        return { kind: 'unknown', reason: 'Duplicate submission; original order state not visible to the engine' };
      }
      return { kind: 'accepted', orderStatus: 'ACKNOWLEDGED' };
    }
    case 'REJECTED_LOCALLY':
    case 'REJECTED_BY_EXCHANGE':
      return { kind: 'rejected', code: result.errorCode ?? result.outcome, reason: result.message ?? result.outcome };
    case 'DRY_RUN':
      return { kind: 'rejected', code: 'DRY_RUN', reason: 'Engine is in dry-run mode; the order was not transmitted' };
    default:
      return { kind: 'unknown', reason: result.message ?? `Engine outcome ${result.outcome}` };
  }
}

@Injectable()
export class OrderSubmissionResultService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OrderSubmissionResultService.name);
  private events: QueueEvents | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ackService: ExecutionAckService,
    private readonly lifecycleService: OrderLifecycleService,
    private readonly queueService: QueueService,
    @Optional() private readonly config?: AppConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Test harnesses and queue-less tools construct the module without Redis
    // settings; the recorder is then inert and says so once.
    const connection = (this.config as any)?.queueRedisOptions;
    if (!connection || process.env.NODE_ENV === 'test') {
      this.logger.log('Submission result listener not started (no queue connection or test environment)');
      return;
    }
    try {
      this.events = new QueueEvents(QUEUE_NAMES.TRADE_EXECUTION, { connection });
      this.events.on('completed', ({ jobId, returnvalue }) => {
        void this.onCompleted(jobId, returnvalue).catch((error: Error) =>
          this.logger.warn(`Recording submission result for job ${jobId} failed: ${error.message}`),
        );
      });
      this.events.on('failed', ({ jobId, failedReason }) => {
        void this.onFailed(jobId, failedReason).catch((error: Error) =>
          this.logger.warn(`Recording submission failure for job ${jobId} failed: ${error.message}`),
        );
      });
      this.sweepTimer = setInterval(() => {
        void this.sweepPending().catch((error: Error) => this.logger.warn(`Submission sweep failed: ${error.message}`));
      }, 60_000);
      this.sweepTimer.unref?.();
      void this.sweepPending().catch((error: Error) => this.logger.warn(`Initial submission sweep failed: ${error.message}`));
    } catch (error) {
      this.logger.warn(`Submission result listener could not start: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    if (this.events) await this.events.close().catch(() => undefined);
    this.events = null;
  }

  private async onCompleted(jobId: string, returnvalue: unknown): Promise<void> {
    if (!clientOrderIdFromJobId(jobId)) return; // not a submission job
    const result = parseSubmissionResult(returnvalue);
    if (!result) {
      this.logger.warn(`Submission job ${jobId} completed without a parseable result; leaving order for reconciliation`);
      return;
    }
    await this.recordResult(result);
  }

  private async onFailed(jobId: string, failedReason: string): Promise<void> {
    const clientOrderId = clientOrderIdFromJobId(jobId);
    if (!clientOrderId) return;
    // A 'failed' event fires for every failed attempt; only the final one is
    // terminal. Ask BullMQ whether retries remain before recording anything.
    const job = await this.queueService.getQueue(QUEUE_NAMES.TRADE_EXECUTION).getJob(jobId).catch(() => null);
    if (job) {
      const attempts = typeof job.opts?.attempts === 'number' ? job.opts.attempts : 1;
      const unrecoverable = /Unrecoverable|payload rejected|ENGINE_|HTTP_4/.test(failedReason ?? '');
      if (job.attemptsMade < attempts && !unrecoverable) return;
      const data = (job.data ?? {}) as Record<string, unknown>;
      await this.recordFailure({
        tenantId: typeof data.tenantId === 'string' ? data.tenantId : null,
        clientOrderId,
        reason: failedReason ?? 'Submission job failed',
      });
      return;
    }
    await this.recordFailure({ tenantId: null, clientOrderId, reason: failedReason ?? 'Submission job failed' });
  }

  /** Re-read every order still SUBMITTED by the OMS and apply the job's
   * outcome if BullMQ has one. Covers events missed while the API was down. */
  async sweepPending(limit = 200): Promise<number> {
    const pending = await this.prisma.order.findMany({
      where: { status: 'SUBMITTED' as any, exchangeOrderId: null },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true, tenantId: true, clientOrderId: true, metadata: true },
    });
    let applied = 0;
    const queue = this.queueService.getQueue(QUEUE_NAMES.TRADE_EXECUTION);
    for (const order of pending) {
      const metadata = (order.metadata ?? {}) as Record<string, unknown>;
      if (typeof metadata.omsIntentId !== 'string') continue;
      const job = await queue.getJob(`oms-submit-${order.clientOrderId}`).catch(() => null);
      if (!job || job.name !== JOB_NAMES.SUBMIT_ORDER) continue;
      if (job.finishedOn && job.returnvalue) {
        const result = parseSubmissionResult(job.returnvalue);
        if (result) {
          await this.recordResult(result);
          applied += 1;
        }
      } else if (job.finishedOn && job.failedReason) {
        await this.recordFailure({ tenantId: order.tenantId, clientOrderId: order.clientOrderId, reason: job.failedReason });
        applied += 1;
      }
    }
    return applied;
  }

  async recordResult(result: SubmissionResultView): Promise<SubmissionVerdict> {
    const verdict = interpretSubmission(result);
    const order = await this.prisma.order.findFirst({ where: { id: result.platformOrderId, tenantId: result.tenantId } });
    if (!order) {
      this.logger.warn(`Submission result for unknown order ${result.platformOrderId} tenant ${result.tenantId}; ignoring`);
      return verdict;
    }
    const existingMetadata = (order.metadata ?? {}) as Record<string, unknown>;
    const engineMetadata = {
      engineOutcome: result.outcome,
      engineOrderId: result.engineOrderId,
      engineOrderStatus: result.orderStatus,
      engineErrorCode: result.errorCode,
      engineRecordedAt: new Date().toISOString(),
    };
    const now = new Date();

    if (verdict.kind === 'accepted') {
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          status: verdict.orderStatus as any,
          exchangeOrderId: result.exchangeOrderId ? result.exchangeOrderId.slice(0, 64) : undefined,
          filledQuantity: result.filledQuantity as any,
          averageFillPrice: (result.averageFillPrice ?? undefined) as any,
          cumulativeFee: result.cumulativeFee as any,
          feeCurrency: result.feeCurrency ?? undefined,
          submitLatencyMicros: result.latencyMicros ?? undefined,
          terminalAt: verdict.orderStatus === 'FILLED' ? now : undefined,
          metadata: { ...existingMetadata, ...engineMetadata } as any,
        },
      });
    } else if (verdict.kind === 'rejected') {
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          status: 'REJECTED' as any,
          rejectionCode: verdict.code.slice(0, 64),
          rejectionReason: verdict.reason.slice(0, 500),
          wasDryRun: verdict.code === 'DRY_RUN' ? true : undefined,
          terminalAt: now,
          metadata: { ...existingMetadata, ...engineMetadata } as any,
        },
      });
    } else {
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          reconciliationState: 'UNKNOWN' as any,
          reconciliationDetail: verdict.reason.slice(0, 500),
          metadata: { ...existingMetadata, ...engineMetadata } as any,
        },
      });
    }

    await this.applyToIntent(result, verdict, order.venue as unknown as string);
    await this.applyToCopyExecution(result, verdict, existingMetadata);
    return verdict;
  }

  async recordFailure(input: { tenantId: string | null; clientOrderId: string; reason: string }): Promise<void> {
    const order = await this.prisma.order.findFirst({
      where: { clientOrderId: input.clientOrderId, ...(input.tenantId ? { tenantId: input.tenantId } : {}) },
    });
    if (!order) return;
    if (!['SUBMITTED', 'PENDING'].includes(order.status as unknown as string)) return; // already resolved
    const metadata = (order.metadata ?? {}) as Record<string, unknown>;
    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'FAILED' as any,
        rejectionCode: 'SUBMISSION_JOB_FAILED',
        rejectionReason: input.reason.slice(0, 500),
        terminalAt: new Date(),
      },
    });
    const omsIntentId = typeof metadata.omsIntentId === 'string' ? metadata.omsIntentId : null;
    if (omsIntentId) {
      await this.lifecycleService
        .transition({
          tenantId: order.tenantId,
          intentId: omsIntentId,
          toState: OrderIntentState.FAILED,
          source: 'EXECUTION_ENGINE',
          reason: `Submission job failed: ${input.reason}`.slice(0, 500),
        })
        .catch((error: Error) => this.logger.warn(`Intent ${omsIntentId} failure transition skipped: ${error.message}`));
    }
    const copyExecutionId = typeof metadata.copyExecutionId === 'string' ? metadata.copyExecutionId : null;
    if (copyExecutionId) {
      await this.updateCopyExecution(order.tenantId, copyExecutionId, 'FAILED', {
        followerOrderId: order.id,
        failureReason: `Submission failed: ${input.reason}`.slice(0, 500),
      });
    }
  }

  private async applyToIntent(result: SubmissionResultView, verdict: SubmissionVerdict, venue: string): Promise<void> {
    if (verdict.kind === 'unknown') return;
    try {
      await this.ackService.processAckFromExecutionEvent({
        tenantId: result.tenantId,
        orderId: result.platformOrderId,
        clientOrderId: result.clientOrderId,
        exchangeOrderId: result.exchangeOrderId,
        providerOrderId: result.engineOrderId,
        venue,
        status: verdict.kind === 'accepted' ? 'ACKNOWLEDGED' : 'REJECTED',
        occurredAtMicros: (BigInt(Date.now()) * 1000n).toString(),
        reason: verdict.kind === 'rejected' ? `${verdict.code}: ${verdict.reason}` : null,
        source: result.isSimulated ? 'EXECUTION_ENGINE_SIMULATED' : 'EXECUTION_ENGINE',
        providerErrorCode: verdict.kind === 'rejected' ? verdict.code : null,
        providerErrorMessage: verdict.kind === 'rejected' ? verdict.reason : null,
        latencyMicros: result.latencyMicros !== null ? String(result.latencyMicros) : null,
      });
    } catch (error) {
      this.logger.warn(`Ack processing for ${result.clientOrderId} failed: ${(error as Error).message}`);
    }
    if (verdict.kind === 'accepted' && verdict.orderStatus !== 'ACKNOWLEDGED' && result.omsIntentId) {
      const toState = verdict.orderStatus === 'FILLED' ? OrderIntentState.FILLED : OrderIntentState.PARTIALLY_FILLED;
      await this.lifecycleService
        .transition({
          tenantId: result.tenantId,
          intentId: result.omsIntentId,
          toState,
          source: 'EXECUTION_ENGINE',
          reason: `Engine reported ${verdict.orderStatus} filled ${result.filledQuantity}${result.isSimulated ? ' (simulated)' : ''}`,
          metadata: { filledQuantity: result.filledQuantity, averageFillPrice: result.averageFillPrice, isSimulated: result.isSimulated },
        })
        .catch((error: Error) => this.logger.warn(`Intent ${result.omsIntentId} fill transition skipped: ${error.message}`));
    }
  }

  private async applyToCopyExecution(
    result: SubmissionResultView,
    verdict: SubmissionVerdict,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const copyExecutionId = typeof metadata.copyExecutionId === 'string' ? metadata.copyExecutionId : null;
    if (!copyExecutionId) return;
    if (verdict.kind === 'accepted') {
      await this.updateCopyExecution(result.tenantId, copyExecutionId, verdict.orderStatus === 'FILLED' ? 'FILLED' : 'SUBMITTED', {
        followerOrderId: result.platformOrderId,
        providerOrderId: result.exchangeOrderId ?? result.engineOrderId ?? undefined,
        followerPrice: result.averageFillPrice ?? undefined,
      });
    } else if (verdict.kind === 'rejected') {
      await this.updateCopyExecution(result.tenantId, copyExecutionId, 'REJECTED', {
        followerOrderId: result.platformOrderId,
        failureReason: `${verdict.code}: ${verdict.reason}`.slice(0, 500),
      });
    }
  }

  private async updateCopyExecution(
    tenantId: string,
    copyExecutionId: string,
    status: 'SUBMITTED' | 'FILLED' | 'FAILED' | 'REJECTED',
    extra: { followerOrderId?: string; providerOrderId?: string; followerPrice?: string; failureReason?: string },
  ): Promise<void> {
    try {
      await (this.prisma as any).copyExecution.updateMany({
        // FILLED is terminal for a copy execution: a late or replayed event
        // must never move it backwards (same law as CopyExecutionRepository).
        where: { id: copyExecutionId, tenantId, ...(status === 'FILLED' ? {} : { NOT: { status: 'FILLED' } }) },
        data: {
          status,
          ...(extra.followerOrderId ? { followerOrderId: extra.followerOrderId } : {}),
          ...(extra.providerOrderId ? { providerOrderId: extra.providerOrderId } : {}),
          ...(extra.followerPrice ? { followerPrice: extra.followerPrice } : {}),
          ...(extra.failureReason ? { failureReason: extra.failureReason } : {}),
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.warn(`Copy execution ${copyExecutionId} status update failed: ${(error as Error).message}`);
    }
  }
}
