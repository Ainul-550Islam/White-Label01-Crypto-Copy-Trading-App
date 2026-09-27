import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderIntentState, isTerminalState } from './oms.types';
import { ExecutionOrdersService } from '../execution/execution-orders.service';
import { RiskDecisionService } from '../risk-management/risk-decision.service';

/**
 * Order Cancel Service — coordinates cancellation through existing execution infrastructure
 * and validates cancellability against current order state.
 * Never marks CANCELLED before authoritative confirmation unless provider semantics says request itself is terminal.
 */

@Injectable()
export class OrderCancelService {
  private readonly logger = new Logger(OrderCancelService.name);

  private static readonly CANCELLABLE_STATES = new Set<string>([
    OrderIntentState.SUBMITTED,
    OrderIntentState.ACKNOWLEDGED,
    OrderIntentState.PARTIALLY_FILLED,
    OrderIntentState.CREATED,
    OrderIntentState.VALIDATING,
    OrderIntentState.APPROVED,
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycleService: OrderLifecycleService,
    private readonly executionOrdersService: ExecutionOrdersService,
    private readonly riskDecisionService: RiskDecisionService,
  ) {}

  async requestCancel(params: {
    tenantId: string;
    intentId: string;
    userId?: string | null;
    reason: string;
    correlationId?: string | null;
  }) {
    const { tenantId, intentId, userId, reason, correlationId } = params;

    let intent: any;
    try {
      intent = await (this.prisma as any).omsOrderIntent.findFirst({ where: { id: intentId, tenantId } });
    } catch {
      intent = await this.prisma.order.findFirst({ where: { id: intentId, tenantId } });
    }
    if (!intent) throw new BadRequestException(`Intent ${intentId} not found`);

    const currentState = intent.state ?? intent.status;
    if (isTerminalState(currentState)) {
      throw new BadRequestException(`Cannot cancel terminal order ${intentId} state ${currentState}`);
    }
    if (currentState === OrderIntentState.CANCEL_REQUESTED) {
      this.logger.log(`Cancel already requested for ${intentId}, idempotent`);
      return intent;
    }
    if (!OrderCancelService.CANCELLABLE_STATES.has(currentState)) {
      throw new BadRequestException(`Order ${intentId} not cancellable in state ${currentState}`);
    }
    if (currentState === OrderIntentState.FILLED) {
      throw new BadRequestException(`Cannot cancel already FILLED order ${intentId}`);
    }

    // Risk/compliance/security checks if policy requires — for cancel, usually allowed as risk-reducing
    // But check if account is blocked for security
    const threat = await this.prisma.securityThreatSignal.findFirst({
      where: { tenantId, resolved: false, riskLevel: { in: ['HIGH', 'CRITICAL'] as any } },
      orderBy: { createdAt: 'desc' },
    });
    if (threat && threat.decision === 'DENY') {
      // Even cancel should be allowed? For safety, allow cancel as risk-reducing unless policy explicitly blocks
      this.logger.warn(`Security threat exists but allowing cancel as risk-reducing for ${intentId}`);
    }

    // Transition to CANCEL_REQUESTED
    await this.lifecycleService.transition({
      tenantId,
      intentId,
      toState: OrderIntentState.CANCEL_REQUESTED,
      source: 'OMS_CANCEL',
      reason: `Cancel requested: ${reason}`,
      correlationId,
      actorId: userId ?? null,
      actorType: userId ? 'USER' : 'SYSTEM',
    });

    // Call existing execution cancel boundary — ExecutionOrdersService.requestCancel
    try {
      const canonicalOrder = await this.prisma.order.findFirst({ where: { tenantId, clientOrderId: intent.clientOrderId } });
      const orderIdToCancel = canonicalOrder?.id ?? intent.id;

      const result = await this.executionOrdersService.requestCancel(
        tenantId,
        orderIdToCancel,
        { userId: userId ?? 'system', requestId: correlationId ?? null },
        reason,
      );

      this.logger.log(`Cancel command accepted for intent ${intentId} order ${orderIdToCancel} via ExecutionOrdersService`);
      return { intentId, orderId: orderIdToCancel, state: OrderIntentState.CANCEL_REQUESTED, order: result };
    } catch (e) {
      this.logger.warn(`Cancel command failed for ${intentId}: ${(e as Error).message}`);
      throw new BadRequestException(`Cancel request failed: ${(e as Error).message}`);
    }
  }

  async confirmCancelled(params: {
    tenantId: string;
    intentId: string;
    exchangeOrderId?: string | null;
    reason?: string | null;
    timestampMicros?: string | null;
    correlationId?: string | null;
  }) {
    const { tenantId, intentId, exchangeOrderId, reason, timestampMicros, correlationId } = params;

    let intent: any;
    try {
      intent = await (this.prisma as any).omsOrderIntent.findFirst({ where: { id: intentId, tenantId } });
    } catch {
      intent = await this.prisma.order.findFirst({ where: { id: intentId, tenantId } });
    }
    if (!intent) throw new BadRequestException(`Intent ${intentId} not found`);

    const currentState = intent.state ?? intent.status;
    if (currentState === OrderIntentState.CANCELLED) return intent;
    if (currentState === OrderIntentState.FILLED) throw new BadRequestException(`Cannot confirm CANCELLED for already FILLED order ${intentId}`);

    await this.lifecycleService.transition({
      tenantId,
      intentId,
      toState: OrderIntentState.CANCELLED,
      source: 'EXECUTION_ENGINE',
      reason: reason ?? `Cancelled confirmed by provider exchangeOrderId ${exchangeOrderId ?? 'unknown'}`,
      correlationId,
      timestampMicros,
    });

    this.logger.log(`Intent ${intentId} confirmed CANCELLED tenant ${tenantId}`);
    return intent;
  }
}
