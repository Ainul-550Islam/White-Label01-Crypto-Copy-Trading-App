import { ConflictException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { failClosedMoneyOperation } from '../../common/money-path-failure';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderIntentState, ExecutionAckType } from './oms.types';

export interface ExecutionEventAck {
  tenantId: string;
  orderId: string;
  clientOrderId: string;
  exchangeOrderId?: string | null;
  providerOrderId?: string | null;
  venue: string;
  status: string;
  occurredAtMicros: string;
  reason?: string | null;
  correlationId?: string | null;
  source: string;
  providerErrorCode?: string | null;
  providerErrorMessage?: string | null;
  latencyMicros?: string | null;
}

/** Persists real execution acknowledgements and the corresponding OMS event in
 * the same tenant-scoped transaction. An unknown worker outcome is not an ACK. */
@Injectable()
export class ExecutionAckService {
  private readonly logger = new Logger(ExecutionAckService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycleService: OrderLifecycleService,
  ) {}

  async processAckFromExecutionEvent(params: ExecutionEventAck) {
    return this.prisma.withTenantRls(params.tenantId, (tx) => this.processAckInTransaction(tx, params));
  }

  /** `tx` must already be scoped to params.tenantId with withTenantRls. */
  async processAckInTransaction(tx: Prisma.TransactionClient, params: ExecutionEventAck) {
    const { tenantId, orderId, clientOrderId, exchangeOrderId, providerOrderId, venue, status, occurredAtMicros,
      reason, correlationId, source, providerErrorCode, providerErrorMessage, latencyMicros } = params;
    const ackType = ['ACKNOWLEDGED', 'PARTIALLY_FILLED', 'FILLED'].includes(status)
      ? ExecutionAckType.ACCEPTED : status === 'REJECTED' ? ExecutionAckType.REJECTED : null;
    if (!ackType) return null;
    if (!/^\d{1,32}$/.test(occurredAtMicros) || (latencyMicros != null && !/^\d{1,32}$/.test(latencyMicros)) ||
        !clientOrderId || clientOrderId.length > 128 || !venue || venue.length > 32 || !source || source.length > 64 ||
        (exchangeOrderId != null && (!exchangeOrderId || exchangeOrderId.length > 64)) ||
        (providerOrderId != null && (!providerOrderId || providerOrderId.length > 128)) ||
        (correlationId != null && correlationId.length > 64) || (providerErrorCode != null && providerErrorCode.length > 128)) {
      throw new ConflictException('Invalid execution acknowledgement');
    }

    // Always lock canonical order before intent. Read after locking so a late
    // event cannot overwrite a concurrent terminal/fill transition.
    const orderLock = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM orders WHERE tenant_id=${tenantId}::uuid AND id=${orderId}::uuid FOR UPDATE`;
    if (orderLock.length !== 1) return null;
    const order = await tx.order.findFirst({ where: { id: orderId, tenantId } });
    const metadata = order?.metadata && typeof order.metadata === 'object' && !Array.isArray(order.metadata)
      ? order.metadata as Record<string, unknown> : {};
    if (!order || order.clientOrderId !== clientOrderId || order.venue !== venue || typeof metadata.omsIntentId !== 'string') return null;
    if ((ackType === ExecutionAckType.ACCEPTED && !['ACKNOWLEDGED', 'PARTIALLY_FILLED', 'FILLED'].includes(order.status)) ||
        (ackType === ExecutionAckType.REJECTED && order.status !== 'REJECTED')) return null;
    const intentLock = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM oms_order_intents WHERE tenant_id=${tenantId}::uuid AND id=${metadata.omsIntentId}::uuid FOR UPDATE`;
    if (intentLock.length !== 1) return null;
    const intent = await tx.omsOrderIntent.findFirst({ where: { id: metadata.omsIntentId, tenantId, clientOrderId } });
    if (!intent || intent.accountId !== order.accountId || intent.symbol !== order.symbol || intent.side !== order.side ||
        intent.isSimulated !== order.isSimulated) return null;
    if ((order.exchangeOrderId && exchangeOrderId && order.exchangeOrderId !== exchangeOrderId) ||
        (intent.exchangeOrderId && exchangeOrderId && intent.exchangeOrderId !== exchangeOrderId) ||
        (intent.providerOrderId && providerOrderId && intent.providerOrderId !== providerOrderId)) {
      throw new ConflictException('Conflicting execution acknowledgement');
    }
    if ((ackType === ExecutionAckType.REJECTED && ![OrderIntentState.SUBMITTED, OrderIntentState.REJECTED].includes(intent.state as OrderIntentState)) ||
        (ackType === ExecutionAckType.ACCEPTED && [OrderIntentState.REJECTED, OrderIntentState.FAILED, OrderIntentState.EXPIRED,
          OrderIntentState.REPLACED].includes(intent.state as OrderIntentState))) {
      throw new ConflictException('Execution acknowledgement conflicts with the current order state');
    }

    // PostgreSQL unique indexes treat NULL exchange IDs as distinct. Holding
    // the intent lock makes this read/create pair safe even when the venue has
    // not yet supplied an ID, and avoids conflating NULL with an arbitrary ID.
    let ackRecord;
    try {
      const existing = await tx.omsExecutionAck.findMany({ where: { tenantId, clientOrderId }, take: 2 });
      if (existing.length > 1) throw new ConflictException('Conflicting execution acknowledgements require reconciliation');
      ackRecord = existing[0] ?? null;
      if (ackRecord && (ackRecord.orderIntentId !== intent.id || ackRecord.internalOrderId !== order.id ||
          ackRecord.ackType !== ackType || (ackRecord.exchangeOrderId && exchangeOrderId && ackRecord.exchangeOrderId !== exchangeOrderId) ||
          (ackRecord.providerOrderId && providerOrderId && ackRecord.providerOrderId !== providerOrderId))) {
        throw new ConflictException('Conflicting execution acknowledgement');
      }
      if (ackRecord && ((!ackRecord.exchangeOrderId && exchangeOrderId) || (!ackRecord.providerOrderId && providerOrderId))) {
        // A delayed venue identifier enriches the same acknowledgement; it
        // must not create a second one merely because NULL is unique-distinct.
        ackRecord = await tx.omsExecutionAck.update({ where: { id: ackRecord.id }, data: {
          ...(!ackRecord.exchangeOrderId && exchangeOrderId ? { exchangeOrderId } : {}),
          ...(!ackRecord.providerOrderId && providerOrderId ? { providerOrderId } : {}),
        } });
      }
      if (!ackRecord) {
        ackRecord = await tx.omsExecutionAck.create({ data: {
          tenantId, orderIntentId: intent.id, internalOrderId: orderId, clientOrderId,
          providerOrderId: providerOrderId ?? null, exchangeOrderId: exchangeOrderId ?? null,
          venue, ackType, timestampMicros: occurredAtMicros, latencyMicros: latencyMicros ?? null,
          providerErrorCode: providerErrorCode ?? null,
          providerErrorMessage: providerErrorMessage ? providerErrorMessage.slice(0, 500) : null,
          rawAckRef: orderId, correlationId: correlationId ?? null, source,
        } });
      }
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      failClosedMoneyOperation(error, { code: 'OMS_EXECUTION_ACK_PERSIST_FAILED', tenantId, entityId: orderId });
    }

    if (ackType === ExecutionAckType.ACCEPTED && intent.state === OrderIntentState.SUBMITTED) {
      await this.lifecycleService.transitionInTransaction(tx, {
        tenantId, intentId: intent.id, toState: OrderIntentState.ACKNOWLEDGED, source: 'EXECUTION_ENGINE',
        reason: reason ?? `Acknowledged by venue ${venue} exchangeOrderId ${exchangeOrderId ?? 'pending'}`,
        correlationId, timestampMicros: occurredAtMicros, metadata: { exchangeOrderId, providerOrderId, venue, latencyMicros },
      });
    } else if (ackType === ExecutionAckType.REJECTED && intent.state === OrderIntentState.SUBMITTED) {
      await this.lifecycleService.transitionInTransaction(tx, {
        tenantId, intentId: intent.id, toState: OrderIntentState.REJECTED, source: 'EXECUTION_ENGINE',
        reason: reason ?? `Rejected by venue ${venue} code ${providerErrorCode ?? 'unknown'}`,
        correlationId, timestampMicros: occurredAtMicros, metadata: { providerErrorCode, providerErrorMessage, venue },
      });
    }
    if (exchangeOrderId || providerOrderId) {
      await tx.omsOrderIntent.update({ where: { id: intent.id }, data: {
        ...(exchangeOrderId ? { exchangeOrderId } : {}), ...(providerOrderId ? { providerOrderId } : {}),
      } });
    }
    this.logger.log(`Acknowledgement recorded for intent ${intent.id} tenant ${tenantId} type ${ackType}`);
    return ackRecord;
  }

  async processAckFromOrderTable(tenantId: string, orderId: string) {
    const snapshot = await this.prisma.withTenantRls(tenantId, async (tx) => {
      const order = await tx.order.findFirst({ where: { id: orderId, tenantId } });
      if (!order || !order.exchangeOrderId) return null;
      const event = await tx.orderEvent.findFirst({ where: { orderId }, orderBy: { occurredAtMicros: 'desc' } });
      return { order, event };
    });
    if (!snapshot) return null;
    const { order, event } = snapshot;
    const metadata = order.metadata && typeof order.metadata === 'object' && !Array.isArray(order.metadata)
      ? order.metadata as Record<string, unknown> : {};
    return this.processAckFromExecutionEvent({
      tenantId, orderId: order.id, clientOrderId: order.clientOrderId, exchangeOrderId: order.exchangeOrderId,
      venue: order.venue, status: order.status,
      occurredAtMicros: event?.occurredAtMicros?.toString() ?? (BigInt(Date.now()) * 1000n).toString(),
      reason: event?.reason ?? null, source: 'ORDER_TABLE_SYNC',
      correlationId: typeof metadata.correlationId === 'string' ? metadata.correlationId : null,
    });
  }
}
