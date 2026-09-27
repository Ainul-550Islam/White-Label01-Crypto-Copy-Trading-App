import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderIntentService } from './order-intent.service';
import { RiskDecisionService } from '../risk-management/risk-decision.service';
import { OrderIntentState, isValidDecimal, parseScaled } from './oms.types';
import { ExchangeSymbolService } from '../exchanges/exchange-symbol.service';

/**
 * Order Replace/Amend Service — coordinates replace/amend requests where venue/execution engine supports them
 * without bypassing risk validation.
 * Requirements: re-run risk, re-run precision, preserve original identity/reference, preserve audit trail, never mutate filled data.
 */

@Injectable()
export class OrderReplaceService {
  private readonly logger = new Logger(OrderReplaceService.name);

  private static readonly REPLACEABLE_STATES = new Set<string>([
    OrderIntentState.SUBMITTED,
    OrderIntentState.ACKNOWLEDGED,
    OrderIntentState.PARTIALLY_FILLED,
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycleService: OrderLifecycleService,
    private readonly intentService: OrderIntentService,
    private readonly riskDecisionService: RiskDecisionService,
    private readonly symbolService: ExchangeSymbolService,
  ) {}

  async requestReplace(params: {
    tenantId: string;
    intentId: string;
    userId?: string | null;
    newQuantity?: string | null;
    newPrice?: string | null;
    newStopPrice?: string | null;
    reason: string;
    correlationId?: string | null;
    requestId?: string | null;
  }) {
    const { tenantId, intentId, userId, newQuantity, newPrice, newStopPrice, reason, correlationId, requestId } = params;

    let intent: any;
    try {
      intent = await (this.prisma as any).omsOrderIntent.findFirst({ where: { id: intentId, tenantId } });
    } catch {
      intent = await this.prisma.order.findFirst({ where: { id: intentId, tenantId } });
    }
    if (!intent) throw new BadRequestException(`Intent ${intentId} not found`);

    const currentState = intent.state ?? intent.status;
    if (!OrderReplaceService.REPLACEABLE_STATES.has(currentState)) {
      throw new BadRequestException(`Order ${intentId} not replaceable in state ${currentState}`);
    }

    // Validate provider capability — check if venue supports amend
    const symbolRecord = await this.prisma.tradingSymbol.findFirst({
      where: { tenantId, symbol: intent.symbol, isTradeable: true },
      include: { exchange: true },
    });
    if (!symbolRecord) throw new BadRequestException(`Symbol ${intent.symbol} not found`);

    // Some venues don't support amend — we must check via symbol service or exchange metadata
    // For now, we assume cancel-replace is supported if exchange is enabled
    if (!symbolRecord.exchange.isEnabled) throw new BadRequestException(`Exchange ${symbolRecord.exchange.venue} not enabled for replace`);

    // Re-run precision validation
    if (newQuantity) {
      if (!isValidDecimal(newQuantity)) throw new BadRequestException(`Invalid newQuantity ${newQuantity}`);
      if (parseScaled(newQuantity) <= 0n) throw new BadRequestException('newQuantity must be > 0');
      // Cannot reduce below already filled quantity
      const filledQty = intent.filledQuantity?.toString() ?? '0';
      if (isValidDecimal(filledQty) && parseScaled(newQuantity) < parseScaled(filledQty)) {
        throw new BadRequestException(`newQuantity ${newQuantity} cannot be less than already filled ${filledQty}`);
      }
    }
    if (newPrice && !isValidDecimal(newPrice)) throw new BadRequestException(`Invalid newPrice ${newPrice}`);
    if (newStopPrice && !isValidDecimal(newStopPrice)) throw new BadRequestException(`Invalid newStopPrice ${newStopPrice}`);

    // Re-run risk validation with new qty/price
    const riskResult = await this.riskDecisionService.evaluateUnifiedRisk({
      tenantId,
      userId: userId ?? null,
      accountId: intent.accountId,
      symbol: intent.symbol,
      traderId: intent.traderId as any,
      followerId: intent.followerId as any,
      strategyId: intent.strategyId as any,
      orderIntent: {
        side: intent.side,
        quantity: newQuantity ?? intent.quantity?.toString() ?? intent.quantity,
        price: newPrice ?? intent.price?.toString() ?? intent.price ?? null,
        orderType: intent.orderType,
      } as any,
      environment: intent.environment ?? 'PAPER',
      requestId: requestId as any,
    } as any);

    if (riskResult.decision === 'BLOCK' || riskResult.decision === 'KILL_SWITCH_REQUIRED') {
      throw new ForbiddenException(`Risk BLOCK prevents replace for intent ${intentId}: ${riskResult.blockingReasons.join(', ')}`);
    }

    // Preserve original identity/reference — create new intent that references original
    const newIntent = await this.intentService.createIntent({
      tenantId,
      accountId: intent.accountId,
      symbol: intent.symbol,
      side: intent.side,
      orderType: intent.orderType,
      quantity: newQuantity ?? intent.quantity?.toString() ?? intent.quantity,
      price: newPrice ?? intent.price?.toString() ?? intent.price ?? null,
      stopPrice: newStopPrice ?? intent.stopPrice?.toString() ?? intent.stopPrice ?? null,
      timeInForce: intent.timeInForce ?? 'GTC',
      reduceOnly: intent.reduceOnly ?? false,
      strategyId: intent.strategyId ?? undefined,
      traderId: intent.traderId ?? undefined,
      followerId: intent.followerId ?? undefined,
      subscriptionId: intent.subscriptionId ?? undefined,
      environment: intent.environment ?? 'PAPER',
      source: intent.source ?? 'MANUAL',
      signalId: intent.signalId ?? undefined,
      correlationId: correlationId ?? intent.correlationId ?? undefined,
      requestId: requestId ?? undefined,
      userId: userId ?? undefined,
      venue: intent.venue ?? undefined,
    });

    // Mark original as REPLACED — preserve audit trail
    await this.lifecycleService.transition({
      tenantId,
      intentId,
      toState: OrderIntentState.REPLACED,
      source: 'OMS_REPLACE',
      reason: `Replaced by new intent ${newIntent.id} reason ${reason}`,
      correlationId,
      policyVersion: riskResult.policyVersion,
      actorId: userId ?? null,
      actorType: userId ? 'USER' : 'SYSTEM',
      metadata: { newIntentId: newIntent.id, newQuantity, newPrice, newStopPrice },
    });

    // Link replacement in new intent metadata
    try {
      await (this.prisma as any).omsOrderIntent.update({
        where: { id: newIntent.id },
        data: { metadata: { ...(newIntent.metadata as any), replacedFrom: intentId, replaceReason: reason } },
      });
    } catch {}

    this.logger.log(`Intent ${intentId} REPLACED by ${newIntent.id} tenant ${tenantId} qty ${newQuantity ?? 'same'} price ${newPrice ?? 'same'}`);
    return { originalIntentId: intentId, newIntentId: newIntent.id, riskDecisionId: riskResult.id };
  }
}
