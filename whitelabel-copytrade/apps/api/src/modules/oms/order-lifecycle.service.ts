import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OrderIntentState, isValidTransition, isTerminalState, TERMINAL_STATES } from './oms.types';
import { randomUUID } from 'crypto';

/**
 * Order Lifecycle Service — controls valid state transitions, idempotency, event ordering,
 * terminal-state protection, and lifecycle history.
 */

@Injectable()
export class OrderLifecycleService {
  private readonly logger = new Logger(OrderLifecycleService.name);

  constructor(private readonly prisma: PrismaService) {}

  async transition(params: {
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
  }) {
    const { tenantId, intentId, toState, source, reason, correlationId, policyVersion, riskRuleId, actorId, actorType, metadata, timestampMicros } = params;

    // Fetch current intent
    let intent: any;
    try {
      intent = await (this.prisma as any).omsOrderIntent.findFirst({ where: { id: intentId, tenantId } });
    } catch {
      intent = await this.prisma.order.findFirst({ where: { id: intentId, tenantId } });
    }
    if (!intent) throw new BadRequestException(`Intent ${intentId} not found for tenant ${tenantId}`);

    const currentState = intent.state ?? intent.status;
    if (!currentState) throw new BadRequestException(`Intent ${intentId} has no state`);

    // Idempotency: same-state transition is allowed and is no-op
    if (currentState === toState) {
      this.logger.log(`Idempotent transition ${intentId} ${currentState} → ${toState} source ${source}`);
      return intent;
    }

    // Terminal-state protection
    if (isTerminalState(currentState)) {
      throw new BadRequestException(`Cannot transition from terminal state ${currentState} to ${toState} for intent ${intentId}`);
    }

    // Validate transition
    if (!isValidTransition(currentState, toState)) {
      throw new BadRequestException(`Invalid transition ${currentState} → ${toState} for intent ${intentId}. Allowed: ${(require('./oms.types').VALID_TRANSITIONS[currentState] || []).join(', ')}`);
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const micros = timestampMicros ?? (BigInt(now.getTime()) * 1000n).toString();

    // Out-of-order detection: if provided timestampMicros is older than last transition, log but allow if transition is valid
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

    // Persist
    try {
      const updated = await (this.prisma as any).omsOrderIntent.update({
        where: { id: intentId },
        data: {
          state: toState,
          metadata: newMetadata,
          ...(toState === OrderIntentState.SUBMITTED ? { submittedAt: now } : {}),
          ...(toState === OrderIntentState.ACKNOWLEDGED ? { acknowledgedAt: now } : {}),
          ...(TERMINAL_STATES.has(toState) ? { terminalAt: now } : {}),
          updatedAt: now,
        },
      });
      this.logger.log(`Intent ${intentId} transitioned ${currentState} → ${toState} via ${source} reason ${reason}`);
      return updated;
    } catch {
      // Fallback to Order table
      const updated = await this.prisma.order.update({
        where: { id: intentId },
        data: {
          status: toState as any,
          metadata: newMetadata as any,
          ...(TERMINAL_STATES.has(toState) ? { terminalAt: now } : {}),
          updatedAt: now,
        },
      });
      return updated;
    }
  }

  async getHistory(tenantId: string, intentId: string) {
    let intent: any;
    try {
      intent = await (this.prisma as any).omsOrderIntent.findFirst({ where: { id: intentId, tenantId } });
    } catch {
      intent = await this.prisma.order.findFirst({ where: { id: intentId, tenantId } });
    }
    if (!intent) throw new BadRequestException(`Intent ${intentId} not found`);
    return (intent.metadata?.transitions as any[]) ?? [];
  }

  async isTerminal(tenantId: string, intentId: string): Promise<boolean> {
    let intent: any;
    try {
      intent = await (this.prisma as any).omsOrderIntent.findFirst({ where: { id: intentId, tenantId } });
    } catch {
      intent = await this.prisma.order.findFirst({ where: { id: intentId, tenantId } });
    }
    if (!intent) return false;
    return isTerminalState(intent.state ?? intent.status);
  }
}
