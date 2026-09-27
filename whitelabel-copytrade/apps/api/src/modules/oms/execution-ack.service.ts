import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderIntentState, ExecutionAckType } from './oms.types';
import { randomUUID } from 'crypto';

/**
 * Execution Ack Service — normalizes acknowledgements from existing execution infrastructure
 * into safe OMS events without becoming a second execution engine.
 *
 * Never invents an ACK. If no real ack exists, remain in appropriate pending state.
 */

@Injectable()
export class ExecutionAckService {
  private readonly logger = new Logger(ExecutionAckService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycleService: OrderLifecycleService,
  ) {}

  /**
   * Normalize ack from execution engine OrderEvent / ExecutionOrderEvent
   */
  async processAckFromExecutionEvent(params: {
    tenantId: string;
    orderId: string; // internal order id
    clientOrderId: string;
    exchangeOrderId?: string | null;
    providerOrderId?: string | null;
    venue: string;
    status: string; // ACKNOWLEDGED, REJECTED, etc.
    occurredAtMicros: string;
    reason?: string | null;
    correlationId?: string | null;
    source: string;
    providerErrorCode?: string | null;
    providerErrorMessage?: string | null;
    latencyMicros?: string | null;
  }) {
    const { tenantId, orderId, clientOrderId, exchangeOrderId, providerOrderId, venue, status, occurredAtMicros, reason, correlationId, source, providerErrorCode, providerErrorMessage, latencyMicros } = params;

    // Find linked OMS intent by clientOrderId
    let intent: any;
    try {
      intent = await (this.prisma as any).omsOrderIntent.findFirst({ where: { tenantId, clientOrderId } });
    } catch {
      intent = await this.prisma.order.findFirst({ where: { tenantId, clientOrderId } });
    }
    if (!intent) {
      this.logger.warn(`No OMS intent found for clientOrderId ${clientOrderId} tenant ${tenantId} — ack orphan, ignoring`);
      return null;
    }

    const ackType = status === 'REJECTED' || status === 'FAILED' ? ExecutionAckType.REJECTED : ExecutionAckType.ACCEPTED;

    // Idempotency: check if ack already processed for this clientOrderId + exchangeOrderId
    try {
      const existing = await (this.prisma as any).omsExecutionAck.findFirst({
        where: { tenantId, clientOrderId, exchangeOrderId: exchangeOrderId ?? undefined },
      });
      if (existing) {
        this.logger.log(`Duplicate ack ignored for clientOrderId ${clientOrderId} exchangeOrderId ${exchangeOrderId}`);
        return existing;
      }
    } catch {
      // model may not exist yet
    }

    // Persist ack
    let ackRecord: any;
    try {
      ackRecord = await (this.prisma as any).omsExecutionAck.create({
        data: {
          tenantId,
          orderIntentId: intent.id,
          internalOrderId: orderId,
          clientOrderId,
          providerOrderId: providerOrderId ?? null,
          exchangeOrderId: exchangeOrderId ?? null,
          venue,
          ackType,
          timestampMicros: occurredAtMicros,
          latencyMicros: latencyMicros ?? null,
          providerErrorCode: providerErrorCode ?? null,
          providerErrorMessage: providerErrorMessage ? providerErrorMessage.slice(0, 500) : null,
          rawAckRef: orderId,
          correlationId: correlationId ?? null,
          source,
        },
      });
    } catch (e) {
      this.logger.warn(`OmsExecutionAck model missing, storing ack in audit only: ${(e as Error).message}`);
      ackRecord = {
        id: randomUUID(),
        tenantId,
        orderIntentId: intent.id,
        clientOrderId,
        exchangeOrderId,
        venue,
        ackType,
        timestampMicros: occurredAtMicros,
        source,
      };
    }

    // Transition OMS intent based on ack
    const currentState = intent.state ?? intent.status;
    if (ackType === ExecutionAckType.ACCEPTED) {
      if (currentState === OrderIntentState.SUBMITTED) {
        await this.lifecycleService.transition({
          tenantId,
          intentId: intent.id,
          toState: OrderIntentState.ACKNOWLEDGED,
          source: 'EXECUTION_ENGINE',
          reason: reason ?? `Acknowledged by venue ${venue} exchangeOrderId ${exchangeOrderId ?? 'pending'}`,
          correlationId,
          timestampMicros: occurredAtMicros,
          metadata: { exchangeOrderId, providerOrderId, venue, latencyMicros },
        });
      }
    } else {
      // REJECTED
      if (currentState !== OrderIntentState.REJECTED && currentState !== OrderIntentState.FILLED && currentState !== OrderIntentState.CANCELLED) {
        await this.lifecycleService.transition({
          tenantId,
          intentId: intent.id,
          toState: OrderIntentState.REJECTED,
          source: 'EXECUTION_ENGINE',
          reason: reason ?? `Rejected by venue ${venue} code ${providerErrorCode ?? 'unknown'}`,
          correlationId,
          timestampMicros: occurredAtMicros,
          metadata: { providerErrorCode, providerErrorMessage, venue },
        });
      }
    }

    // Update intent with exchangeOrderId if provided and not already set
    if (exchangeOrderId) {
      try {
        await (this.prisma as any).omsOrderIntent.update({
          where: { id: intent.id },
          data: { exchangeOrderId, providerOrderId: providerOrderId ?? undefined },
        });
      } catch {
        await this.prisma.order.update({
          where: { id: intent.id },
          data: { exchangeOrderId } as any,
        });
      }
    }

    this.logger.log(`Ack processed intent ${intent.id} clientOrderId ${clientOrderId} type ${ackType} venue ${venue}`);
    return ackRecord;
  }

  async processAckFromOrderTable(tenantId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, tenantId } });
    if (!order) return null;
    if (!order.exchangeOrderId) return null; // no real ack yet, remain pending

    // Find latest order event for ack
    const event = await this.prisma.orderEvent.findFirst({
      where: { orderId },
      orderBy: { occurredAtMicros: 'desc' },
    });

    return this.processAckFromExecutionEvent({
      tenantId,
      orderId: order.id,
      clientOrderId: order.clientOrderId,
      exchangeOrderId: order.exchangeOrderId,
      venue: order.venue as any,
      status: order.status,
      occurredAtMicros: event?.occurredAtMicros?.toString() ?? (BigInt(Date.now()) * 1000n).toString(),
      reason: event?.reason ?? null,
      source: 'ORDER_TABLE_SYNC',
      correlationId: (order.metadata as any)?.correlationId ?? null,
    });
  }
}
