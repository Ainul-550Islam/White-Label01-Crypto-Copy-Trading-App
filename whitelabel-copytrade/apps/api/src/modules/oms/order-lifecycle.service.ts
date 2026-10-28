// # Manages canonical OMS order state transitions including PARTIALLY_FILLED and FILLED
import { Injectable, Logger, BadRequestException, Optional } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { OrderIntentState, VALID_TRANSITIONS, isValidTransition, isTerminalState, TERMINAL_STATES } from './oms.types';
import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';

export interface LifecycleTransitionInput {
  tenantId: string;
  intentId: string;
  toState: OrderIntentState | string;
  source: string;
  reason: string;
  correlationId?: string | null;
  policyVersion?: string | null;
  riskRuleId?: string | null;
  actorId?: string | null;
  actorType?: string;
  metadata?: Record<string, unknown> | null;
  timestampMicros?: string | null;
}

/**
 * Order Lifecycle Service — controls valid state transitions, idempotency, event ordering,
 * terminal-state protection, and lifecycle history.
 */

@Injectable()
export class OrderLifecycleService {
  private readonly logger = new Logger(OrderLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly outbox?: OutboxService,
  ) {}

  private isMissingIntentModel(error: unknown): boolean {
    const candidate = error as { code?: string; message?: string; meta?: { modelName?: string } };
    if (candidate.code !== 'P2021' && candidate.code !== 'P2022') return false;
    return candidate.meta?.modelName === 'OmsOrderIntent' || /OmsOrderIntent/.test(candidate.message ?? '');
  }

  async transition(params: LifecycleTransitionInput) {
    return this.prisma.withTenantRls(params.tenantId, (tx) => this.transitionInTransaction(tx, params));
  }

  /** The caller must supply a transaction already scoped with withTenantRls.
   * This lets acknowledgement, canonical order, lifecycle and outbox commit
   * or roll back together instead of publishing a partially recorded result. */
  async transitionInTransaction(tx: Prisma.TransactionClient, params: LifecycleTransitionInput) {
    const { tenantId, intentId, toState, source, reason, correlationId, policyVersion, riskRuleId, actorId, actorType, metadata, timestampMicros } = params;
    const now = new Date();
    const nowIso = now.toISOString();
    const micros = timestampMicros ?? (BigInt(now.getTime()) * 1000n).toString();

    const store = tx as any;
    const intentDelegate = store.omsOrderIntent;
    let useIntentModel = typeof intentDelegate?.findFirst === 'function';
    let intent: any = null;
    if (useIntentModel) {
      try {
        intent = await intentDelegate.findFirst({ where: { id: intentId, tenantId } });
      } catch (error) {
        if (!this.isMissingIntentModel(error)) throw error;
        useIntentModel = false;
      }
    }
    if (!useIntentModel) {
      intent = await store.order.findFirst({ where: { id: intentId, tenantId } });
    }
    if (!intent) throw new BadRequestException(`Intent ${intentId} not found for tenant ${tenantId}`);
    if (useIntentModel) {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM oms_order_intents WHERE id = ${intentId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;
      if (locked.length !== 1) throw new BadRequestException(`Intent ${intentId} not found for tenant ${tenantId}`);
      intent = await intentDelegate.findFirst({ where: { id: intentId, tenantId } });
    } else {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM orders WHERE id = ${intentId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`;
      if (locked.length !== 1) throw new BadRequestException(`Intent ${intentId} not found for tenant ${tenantId}`);
      intent = await store.order.findFirst({ where: { id: intentId, tenantId } });
    }
    if (!intent) throw new BadRequestException(`Intent ${intentId} not found for tenant ${tenantId}`);

    const currentState = intent.state ?? intent.status;
    if (!currentState) throw new BadRequestException(`Intent ${intentId} has no state`);

    // Idempotency: same-state transition is allowed and is no-op.
    if (currentState === toState) {
      this.logger.log(`Idempotent transition ${intentId} ${currentState} → ${toState} source ${source}`);
      return intent;
    }
    if (isTerminalState(currentState)) {
      throw new BadRequestException(`Cannot transition from terminal state ${currentState} to ${toState} for intent ${intentId}`);
    }
    if (!isValidTransition(currentState, toState)) {
      throw new BadRequestException(`Invalid transition ${currentState} → ${toState} for intent ${intentId}. Allowed: ${(VALID_TRANSITIONS[currentState] || []).join(', ')}`);
    }

    const developerEventType = toState === OrderIntentState.ACKNOWLEDGED
      ? 'order.acknowledged'
      : toState === OrderIntentState.FILLED
        ? 'order.filled'
        : toState === OrderIntentState.REJECTED
          ? 'order.rejected'
          : null;
    if (developerEventType && !this.outbox) {
      throw new Error(`Transactional outbox is unavailable; refusing ${toState} order transition without ${developerEventType}`);
    }

    const transitions = (intent.metadata?.transitions as any[]) ?? [];
    if (transitions.length > 0) {
      const last = transitions[transitions.length - 1];
      if (last?.timestampMicros) {
        const lastMicros = BigInt(last.timestampMicros);
        const newMicros = BigInt(micros);
        if (newMicros < lastMicros) {
          this.logger.warn(`Out-of-order event detected for intent ${intentId}: last ${last.timestampMicros} new ${micros} transition ${currentState}→${toState}`);
        }
      }
    }

    const event = {
      eventId: randomUUID(),
      fromState: currentState,
      toState,
      timestamp: nowIso,
      timestampMicros: micros,
      source,
      reason: reason.slice(0, 1000),
      correlationId: correlationId ?? intent.correlationId ?? null,
      policyVersion: policyVersion ?? null,
      riskRuleId: riskRuleId ?? null,
      actorId: actorId ?? null,
      actorType: actorType ?? 'SYSTEM',
      metadata: metadata ?? null,
    };
    const newMetadata = {
      ...(intent.metadata as any),
      transitions: [...transitions, event],
    };
    const omsData = {
      state: toState,
      metadata: newMetadata,
      ...(toState === OrderIntentState.SUBMITTED ? { submittedAt: now } : {}),
      ...(toState === OrderIntentState.ACKNOWLEDGED ? { acknowledgedAt: now } : {}),
      ...(TERMINAL_STATES.has(toState) ? { terminalAt: now } : {}),
      updatedAt: now,
    };

    let updated: any;
    if (useIntentModel) {
      try {
        updated = await intentDelegate.update({ where: { id: intentId }, data: omsData });
      } catch (error) {
        if (!this.isMissingIntentModel(error)) throw error;
        useIntentModel = false;
      }
    }
    if (!useIntentModel) {
      updated = await store.order.update({
        where: { id: intentId },
        data: {
          status: toState as any,
          metadata: newMetadata as any,
          ...(TERMINAL_STATES.has(toState) ? { terminalAt: now } : {}),
          updatedAt: now,
        },
      });
    }

    if (developerEventType) {
      const decimalString = (value: unknown): string | null => {
        if (value === null || value === undefined) return null;
        return typeof value === 'string' ? value : String(value);
      };
      const orderId = intent.id;
      const rawQuantity = toState === OrderIntentState.FILLED
        ? (intent.filledQuantity ?? intent.quantity)
        : intent.quantity;
      const rawPrice = toState === OrderIntentState.FILLED
        ? (intent.averageFillPrice ?? intent.price)
        : intent.price;
      const side = intent.side === 'BUY' || intent.side === 'SELL' ? intent.side : null;
      const outboxPayload = {
        orderId,
        status: toState,
        symbol: typeof intent.symbol === 'string' ? intent.symbol : null,
        side,
        quantity: decimalString(rawQuantity),
        price: decimalString(rawPrice),
      };
      await this.outbox!.append(tx, {
        tenantId,
        aggregateType: 'order',
        aggregateId: orderId,
        eventType: developerEventType,
        idempotencyKey: `order:${orderId}:transition:${event.eventId}`,
        correlationId: event.correlationId && event.correlationId.length <= 64 ? event.correlationId : null,
        occurredAt: now,
        payload: outboxPayload,
      });
    }

    this.logger.log(`Intent ${intentId} transitioned ${currentState} → ${toState} via ${source} reason ${reason}`);
    return updated;
  }

  private async findIntentInTransaction(tx: Prisma.TransactionClient, tenantId: string, intentId: string) {
    try {
      return await tx.omsOrderIntent.findFirst({ where: { id: intentId, tenantId } });
    } catch (error) {
      if (!this.isMissingIntentModel(error)) throw error;
      return tx.order.findFirst({ where: { id: intentId, tenantId } });
    }
  }

  async getHistory(tenantId: string, intentId: string) {
    return this.prisma.withTenantRls(tenantId, async (tx) => {
      const intent = await this.findIntentInTransaction(tx, tenantId, intentId);
      if (!intent) throw new BadRequestException(`Intent ${intentId} not found`);
      return ((intent.metadata as { transitions?: unknown[] } | null)?.transitions ?? []);
    });
  }

  async isTerminal(tenantId: string, intentId: string): Promise<boolean> {
    return this.prisma.withTenantRls(tenantId, async (tx) => {
      const intent = await this.findIntentInTransaction(tx, tenantId, intentId);
      if (!intent) return false;
      return isTerminalState('state' in intent ? intent.state : intent.status);
    });
  }
}
