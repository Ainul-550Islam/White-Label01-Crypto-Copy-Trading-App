import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { QueueEvents } from 'bullmq';
import { Prisma } from '@prisma/client';
import { JOB_NAMES, QUEUE_NAMES } from '@wlct/config';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import { QueueService } from '../queue/queue.service';
import { ExecutionAckService } from './execution-ack.service';
import { clientOrderIdFromJobId } from './order-submission.payload';

/**
 * Phase 3 — records what the execution engine decided about a SUBMIT_ORDER
 * job back onto the platform's own records.
 *
 * The worker holds no database (worker.module.ts), so the verdict travels as
 * the job's return value: the engine's SubmitOrderResponse plus the platform
 * ids the worker echoes (platformOrderId, omsIntentId, tenantId). This
 * service reads it from BullMQ's own event stream. A bound no-fill ACK is
 * committed with the canonical order, intent, outbox and copy execution. A
 * refusal on a retry and an aggregate-only fill remain unresolved: neither
 * proves that the canonical position and reservation can safely be released.
 *
 * A replay uses the same tenant-scoped row locks and ACK identity. Events
 * missed while the API was down are recovered tenant-by-tenant by
 * {@link sweepPending}, which reads the deterministic BullMQ job.
 */

export type SubmissionVerdict =
  | { kind: 'accepted'; orderStatus: 'ACKNOWLEDGED' | 'PARTIALLY_FILLED' | 'FILLED' }
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

/** Fit the canonical NUMERIC(28,12) columns exactly; never round or turn
 * an invalid/missing execution amount into a fabricated zero. */
function executionDecimal(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64 || !/^\d+(?:\.\d+)?$/.test(value)) return false;
  const [whole, fraction = ''] = value.split('.');
  return (whole!.replace(/^0+/, '').length <= 16) && fraction.length <= 12;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
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
  if (!tenantId || !platformOrderId || !clientOrderId || !outcome ||
      !executionDecimal(record.filledQuantity) || !executionDecimal(record.cumulativeFee) ||
      (record.averageFillPrice !== null && !executionDecimal(record.averageFillPrice)) ||
      typeof record.isSimulated !== 'boolean') return null;
  return {
    tenantId,
    platformOrderId,
    omsIntentId: str(record.omsIntentId),
    clientOrderId,
    outcome,
    engineOrderId: str(record.engineOrderId),
    exchangeOrderId: str(record.exchangeOrderId),
    orderStatus: str(record.orderStatus) ?? 'UNKNOWN',
    filledQuantity: record.filledQuantity,
    averageFillPrice: record.averageFillPrice as string | null,
    cumulativeFee: record.cumulativeFee,
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
      if (result.orderStatus === 'ACKNOWLEDGED') return { kind: 'accepted', orderStatus: 'ACKNOWLEDGED' };
      return { kind: 'unknown', reason: 'Original order state is not established by the engine response.' };
    }
    case 'REJECTED_LOCALLY':
    case 'REJECTED_BY_EXCHANGE':
    case 'DRY_RUN':
      return { kind: 'unknown', reason: 'A refusal on this attempt does not exclude an earlier transmission; reconcile the client order.' };
    default:
      return { kind: 'unknown', reason: result.message ?? `Engine outcome ${result.outcome}` };
  }
}

@Injectable()
export class OrderSubmissionResultService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OrderSubmissionResultService.name);
  private events: QueueEvents | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private sweepInProgress = false;
  private sweepTenantCursor: string | null = null;
  private readonly sweepOrderCursors = new Map<string, { createdAt: Date; id: string }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ackService: ExecutionAckService,
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
    const clientOrderId = clientOrderIdFromJobId(jobId);
    if (!clientOrderId) return; // not a submission job
    const job = await this.queueService.getQueue(QUEUE_NAMES.TRADE_EXECUTION).getJob(jobId);
    const data = job && job.name === JOB_NAMES.SUBMIT_ORDER && job.data && typeof job.data === 'object'
      ? job.data as Record<string, unknown> : null;
    const result = parseSubmissionResult(returnvalue);
    if (!data || !result || data.clientOrderId !== clientOrderId || result.clientOrderId !== clientOrderId ||
        data.tenantId !== result.tenantId || data.orderId !== result.platformOrderId || data.omsIntentId !== result.omsIntentId) {
      if (data && typeof data.tenantId === 'string' && data.clientOrderId === clientOrderId) {
        await this.recordFailure({ tenantId: data.tenantId, clientOrderId, reason: 'Invalid result' });
      }
      this.logger.warn(`Submission job ${jobId} completed without an identity-matched result; leaving order for reconciliation`);
      return;
    }
    try {
      await this.recordResult(result);
    } catch (error) {
      await this.recordFailure({ tenantId: result.tenantId, clientOrderId, reason: 'Result could not be persisted' });
      throw error;
    }
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
      const data = job.name === JOB_NAMES.SUBMIT_ORDER && job.data && typeof job.data === 'object'
        ? job.data as Record<string, unknown> : null;
      if (data?.clientOrderId === clientOrderId && typeof data.tenantId === 'string') {
        await this.recordFailure({ tenantId: data.tenantId, clientOrderId, reason: failedReason ?? 'Submission job failed' });
      }
      return;
    }
    // A missing/unreadable job does not supply a tenant and does not prove
    // that the engine never received the request. Do not search by a
    // tenant-ambiguous client order id or manufacture a terminal outcome.
    this.logger.warn(`Submission job ${jobId} could not be resolved; leaving it for reconciliation`);
  }

  /** Bounded tenant-by-tenant recovery. A forced-RLS connection has no
   * cross-tenant order view: looking globally would silently return no rows.
   * Cursors advance even for unfinished jobs so one old unknown cannot starve
   * the remaining orders. */
  async sweepPending(limit = 200): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid submission sweep limit');
    if (this.sweepInProgress) return 0;
    this.sweepInProgress = true;
    try {
      let applied = 0;
      let inspected = 0;
      let visitedTenants = 0;
      const queue = this.queueService.getQueue(QUEUE_NAMES.TRADE_EXECUTION);
      while (inspected < limit && visitedTenants < 200) {
        const tenants = await this.prisma.tenant.findMany({
          where: this.sweepTenantCursor ? { id: { gt: this.sweepTenantCursor } } : undefined,
          orderBy: { id: 'asc' }, take: Math.min(32, 200 - visitedTenants), select: { id: true },
        });
        if (tenants.length === 0) { this.sweepTenantCursor = null; break; }
        for (const tenant of tenants) {
          if (inspected >= limit) break;
          this.sweepTenantCursor = tenant.id;
          visitedTenants += 1;
          const cursor = this.sweepOrderCursors.get(tenant.id);
          const pending = await this.prisma.withTenantRls(tenant.id, (tx) => tx.order.findMany({
            where: {
              tenantId: tenant.id, status: 'SUBMITTED', exchangeOrderId: null,
              ...(cursor ? { OR: [ { createdAt: { gt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } } ] } : {}),
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: Math.min(25, limit - inspected),
            select: { id: true, tenantId: true, clientOrderId: true, metadata: true, createdAt: true },
          }));
          if (pending.length === 0) {
            this.sweepOrderCursors.delete(tenant.id);
            continue;
          }
          for (const order of pending) {
            inspected += 1;
            this.sweepOrderCursors.set(tenant.id, { createdAt: order.createdAt, id: order.id });
            const metadata = order.metadata && typeof order.metadata === 'object' && !Array.isArray(order.metadata)
              ? order.metadata as Record<string, unknown> : {};
            if (typeof metadata.omsIntentId !== 'string') continue;
            const job = await queue.getJob(`oms-submit-${order.clientOrderId}`).catch(() => null);
            if (!job || job.name !== JOB_NAMES.SUBMIT_ORDER || !job.finishedOn) continue;
            const data = job.data && typeof job.data === 'object' ? job.data as Record<string, unknown> : null;
            if (!data || data.tenantId !== order.tenantId || data.orderId !== order.id ||
                data.clientOrderId !== order.clientOrderId || data.omsIntentId !== metadata.omsIntentId) {
              await this.recordFailure({ tenantId: order.tenantId, clientOrderId: order.clientOrderId, reason: 'Job identity mismatch' });
              continue;
            }
            if (job.returnvalue) {
              const result = parseSubmissionResult(job.returnvalue);
              if (!result || result.tenantId !== order.tenantId || result.platformOrderId !== order.id ||
                  result.clientOrderId !== order.clientOrderId || result.omsIntentId !== metadata.omsIntentId) {
                await this.recordFailure({ tenantId: order.tenantId, clientOrderId: order.clientOrderId, reason: 'Invalid result' });
                continue;
              }
              try {
                await this.recordResult(result);
                applied += 1;
              } catch {
                await this.recordFailure({ tenantId: order.tenantId, clientOrderId: order.clientOrderId, reason: 'Result could not be persisted' });
                this.logger.warn(`Submission result requires reconciliation for order ${order.id}`);
              }
            } else if (job.failedReason) {
              await this.recordFailure({ tenantId: order.tenantId, clientOrderId: order.clientOrderId, reason: job.failedReason });
              applied += 1;
            }
          }
        }
      }
      // Bound in-process cursor memory. Eviction only causes an earlier rescan,
      // not loss of a job or a cross-tenant read.
      while (this.sweepOrderCursors.size > 1000) {
        const first = this.sweepOrderCursors.keys().next().value as string | undefined;
        if (!first) break;
        this.sweepOrderCursors.delete(first);
      }
      return applied;
    } finally {
      this.sweepInProgress = false;
    }
  }

  async recordResult(result: SubmissionResultView): Promise<SubmissionVerdict> {
    const verdict = interpretSubmission(result);
    return this.prisma.withTenantRls(result.tenantId, async (tx) => {
      // Keep the canonical row, acknowledgement, intent transition, outbox and
      // copy execution on one connection/transaction. A failure rolls all of
      // them back; a retry can then replay the exact same job result.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM orders WHERE tenant_id=${result.tenantId}::uuid AND id=${result.platformOrderId}::uuid FOR UPDATE`;
      if (locked.length !== 1) return { kind: 'unknown', reason: 'Order is not available for this tenant.' };
      const order = await tx.order.findFirst({ where: { id: result.platformOrderId, tenantId: result.tenantId } });
      if (!order) return { kind: 'unknown', reason: 'Order is not available for this tenant.' };
      const metadata = order.metadata && typeof order.metadata === 'object' && !Array.isArray(order.metadata)
        ? order.metadata as Record<string, unknown> : {};
      if (order.clientOrderId !== result.clientOrderId || typeof metadata.omsIntentId !== 'string' ||
          metadata.omsIntentId !== result.omsIntentId) {
        return { kind: 'unknown', reason: 'Submission result identity is inconsistent.' };
      }
      const engineMetadata = {
        engineOutcome: result.outcome.slice(0, 64),
        engineOrderId: result.engineOrderId && result.engineOrderId.length <= 128 ? result.engineOrderId : null,
        engineOrderStatus: result.orderStatus.slice(0, 64),
        engineErrorCode: result.errorCode && /^[A-Za-z0-9_.-]{1,64}$/.test(result.errorCode) ? result.errorCode : null,
        engineRecordedAt: new Date().toISOString(),
      };
      const flagUnknown = async (reason: string): Promise<SubmissionVerdict> => {
        await tx.order.update({ where: { id: order.id }, data: {
          reconciliationState: 'UNKNOWN', reconciliationDetail: reason.slice(0, 500),
          metadata: { ...metadata, ...engineMetadata } as Prisma.InputJsonObject,
        } });
        return { kind: 'unknown', reason };
      };
      if (verdict.kind !== 'accepted') {
        return flagUnknown('Submission outcome is unconfirmed; reconcile the client order before retrying.');
      }
      if (!executionDecimal(result.filledQuantity) || !executionDecimal(result.cumulativeFee) ||
          (result.averageFillPrice !== null && !executionDecimal(result.averageFillPrice)) ||
          result.isSimulated !== order.isSimulated || !result.engineOrderId || result.engineOrderId.length > 128 ||
          (result.exchangeOrderId !== null && (!result.exchangeOrderId || result.exchangeOrderId.length > 64)) ||
          (!result.isSimulated && !result.exchangeOrderId) ||
          (result.feeCurrency !== null && (!result.feeCurrency || result.feeCurrency.length > 16)) ||
          (result.latencyMicros !== null && (!Number.isSafeInteger(result.latencyMicros) || result.latencyMicros < 0 || result.latencyMicros > 2_147_483_647))) {
        return flagUnknown('Execution evidence is incomplete or inconsistent; reconciliation is required.');
      }
      const filled = new Prisma.Decimal(result.filledQuantity);
      const fee = new Prisma.Decimal(result.cumulativeFee);
      const quantity = new Prisma.Decimal(order.quantity);
      const average = result.averageFillPrice === null ? null : new Prisma.Decimal(result.averageFillPrice);
      if (result.outcome === 'DUPLICATE') {
        // An engine idempotency key is only a tenant/client-id claim; a
        // different account or order could already own it. Trust a replay
        // only when the durable engine row binds the complete canonical intent.
        const original = await tx.executionOrder.findFirst({ where: {
          tenantId: result.tenantId, orderId: result.engineOrderId!, clientOrderId: result.clientOrderId,
        } });
        const sameOptionalDecimal = (left: string | null, right: Prisma.Decimal | null) =>
          left === null ? right === null : right !== null && executionDecimal(left) && new Prisma.Decimal(left).eq(right);
        if (!original || original.accountId !== order.accountId || original.strategyId !== order.strategyId ||
            original.exchange !== order.venue || original.symbol !== order.symbol || original.side !== order.side ||
            original.orderType !== order.orderType || original.timeInForce !== order.timeInForce ||
            original.reduceOnly !== order.reduceOnly || original.isSimulated !== order.isSimulated ||
            original.status !== result.orderStatus || original.exchangeOrderId !== result.exchangeOrderId ||
            !executionDecimal(original.quantity) || !new Prisma.Decimal(original.quantity).eq(quantity) ||
            !sameOptionalDecimal(original.price, order.price) || !sameOptionalDecimal(original.stopPrice, order.stopPrice) ||
            !executionDecimal(original.filledQuantity) || !new Prisma.Decimal(original.filledQuantity).eq(filled) ||
            !sameOptionalDecimal(original.averageFillPrice, average) || original.feeCurrency !== result.feeCurrency ||
            !executionDecimal(original.cumulativeFee) || !new Prisma.Decimal(original.cumulativeFee).eq(fee) ||
            (original.reconciliationState !== null && original.reconciliationState !== 'IN_SYNC')) {
          return flagUnknown('The original engine order could not be independently matched; reconciliation is required.');
        }
      }
      if (quantity.lte(0) || filled.gt(quantity) || (filled.gt(0) && (!average || average.lte(0))) ||
          (filled.eq(0) && (average !== null || fee.gt(0))) || (fee.gt(0) && !result.feeCurrency) ||
          (verdict.orderStatus === 'ACKNOWLEDGED' && !filled.eq(0)) ||
          (verdict.orderStatus === 'PARTIALLY_FILLED' && (!filled.gt(0) || !filled.lt(quantity))) ||
          (verdict.orderStatus === 'FILLED' && !filled.eq(quantity)) ||
          (order.exchangeOrderId && result.exchangeOrderId && order.exchangeOrderId !== result.exchangeOrderId)) {
        return flagUnknown('Execution amounts or venue identity do not match the canonical order.');
      }
      // A submit receipt reports aggregates, not the canonical fills or a
      // position-application journal. Finalizing from it would release order
      // exposure while the platform's position is still absent. Keep the
      // reservation until those individual executions are reconciled.
      if (verdict.orderStatus !== 'ACKNOWLEDGED') {
        return flagUnknown('Fill details and position application require reconciliation.');
      }
      const intentLocked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM oms_order_intents WHERE tenant_id=${result.tenantId}::uuid AND id=${metadata.omsIntentId}::uuid FOR UPDATE`;
      if (intentLocked.length !== 1) throw new Error('Linked order intent is unavailable');
      const intent = await tx.omsOrderIntent.findFirst({ where: {
        id: metadata.omsIntentId as string, tenantId: result.tenantId, clientOrderId: result.clientOrderId,
      } });
      if (!intent || intent.accountId !== order.accountId || intent.symbol !== order.symbol || intent.side !== order.side ||
          !executionDecimal(intent.filledQuantity) || !executionDecimal(intent.cumulativeFee) ||
          (intent.exchangeOrderId && result.exchangeOrderId && intent.exchangeOrderId !== result.exchangeOrderId) ||
          (intent.providerOrderId && result.engineOrderId && intent.providerOrderId !== result.engineOrderId) ||
          ['REJECTED', 'FAILED', 'EXPIRED', 'REPLACED'].includes(intent.state)) {
        return flagUnknown('Linked order intent is inconsistent; reconciliation is required.');
      }
      const rank: Record<string, number> = { PENDING: 0, SUBMITTED: 0, ACKNOWLEDGED: 1, PARTIALLY_FILLED: 2, FILLED: 3 };
      const currentRank = rank[order.status];
      if (currentRank === undefined) return flagUnknown('Execution evidence conflicts with the current order state.');
      const incomingRank = rank[verdict.orderStatus]!;
      // A delayed acknowledgement or smaller fill must never erase a newer
      // fill, fee or terminal state. It needs no second state transition.
      if (incomingRank < currentRank || filled.lt(order.filledQuantity) || filled.lt(new Prisma.Decimal(intent.filledQuantity)) ||
          fee.lt(order.cumulativeFee) || fee.lt(new Prisma.Decimal(intent.cumulativeFee))) return verdict;
      const updated = await tx.order.update({ where: { id: order.id }, data: {
        status: 'ACKNOWLEDGED', exchangeOrderId: result.exchangeOrderId ?? undefined,
        submitLatencyMicros: result.latencyMicros ?? undefined,
        metadata: { ...metadata, ...engineMetadata } as Prisma.InputJsonObject,
      } });
      const ack = await this.ackService.processAckInTransaction(tx, {
        tenantId: result.tenantId, orderId: updated.id, clientOrderId: result.clientOrderId,
        exchangeOrderId: result.exchangeOrderId, providerOrderId: result.engineOrderId,
        venue: order.venue, status: 'ACKNOWLEDGED',
        occurredAtMicros: (BigInt(Date.now()) * 1000n).toString(),
        source: result.isSimulated ? 'EXECUTION_ENGINE_SIMULATED' : 'EXECUTION_ENGINE',
        latencyMicros: result.latencyMicros !== null ? String(result.latencyMicros) : null,
      });
      if (!ack) throw new Error('Execution acknowledgement could not be bound to the canonical order');
      await this.applyToCopyExecution(tx, result, metadata, order.accountId);
      return verdict;
    });
  }

  async recordFailure(input: { tenantId: string | null; clientOrderId: string; reason: string }): Promise<void> {
    if (!input.tenantId) return;
    // A failed worker job can mean a timeout after the venue accepted the
    // order. It is not a rejection, even when retries are exhausted. Preserve
    // the order/intent/copy reservation until independent reconciliation.
    await this.prisma.withTenantRls(input.tenantId, async (tx) => {
      await tx.order.updateMany({
        where: {
          tenantId: input.tenantId as string,
          clientOrderId: input.clientOrderId,
          status: { in: ['SUBMITTED', 'PENDING'] },
          exchangeOrderId: null,
        },
        data: {
          reconciliationState: 'UNKNOWN',
          reconciliationDetail: 'Submission outcome is unconfirmed; reconcile the client order before retrying.',
        },
      });
    });
  }

  private async applyToCopyExecution(
    tx: Prisma.TransactionClient,
    result: SubmissionResultView,
    metadata: Record<string, unknown>,
    accountId: string,
  ): Promise<void> {
    const copyExecutionId = typeof metadata.copyExecutionId === 'string' ? metadata.copyExecutionId : null;
    if (!copyExecutionId) return;
    const execution = await tx.copyExecution.findFirst({ where: { id: copyExecutionId, tenantId: result.tenantId } });
    if (!execution || execution.followerAccountId !== accountId ||
        (execution.followerOrderId && execution.followerOrderId !== result.platformOrderId)) {
      throw new Error('Copy execution could not be bound to the canonical order');
    }
    if (execution.status === 'FILLED') throw new Error('Copy execution conflicts with the acknowledgement');
    if (!['PENDING', 'VALIDATED', 'MAPPED', 'RISK_CHECKED', 'ROUTED', 'SUBMITTED'].includes(execution.status)) {
      throw new Error('Copy execution conflicts with execution evidence');
    }
    await tx.copyExecution.update({ where: { id: execution.id }, data: {
      status: 'SUBMITTED',
      followerOrderId: result.platformOrderId,
      providerOrderId: result.exchangeOrderId ?? result.engineOrderId ?? undefined,
      followerPrice: result.averageFillPrice ?? undefined,
    } });
  }
}
