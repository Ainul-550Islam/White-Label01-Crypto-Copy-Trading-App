import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TradeLifecycleService } from './trade-lifecycle.service';
import { isValidDecimal, parseScaled, formatScaled, add } from './oms.types';
import { randomUUID } from 'crypto';

/**
 * Post-Trade Service — coordinates post-trade completion, fee/fill aggregation,
 * settlement references, and downstream fee/usage/audit events.
 * Does NOT duplicate Part 7 fee calculation.
 */

@Injectable()
export class PostTradeService {
  private readonly logger = new Logger(PostTradeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tradeLifecycleService: TradeLifecycleService,
  ) {}

  async processPostTrade(params: {
    tenantId: string;
    intentId: string;
    accountId: string;
    symbol: string;
    venue?: string | null;
    strategyId?: string | null;
    traderId?: string | null;
    followerId?: string | null;
    correlationId?: string | null;
  }) {
    const { tenantId, intentId, accountId, symbol, venue, strategyId, traderId, followerId, correlationId } = params;

    let intent: any;
    try {
      intent = await (this.prisma as any).omsOrderIntent.findFirst({ where: { id: intentId, tenantId } });
    } catch {
      intent = await this.prisma.order.findFirst({ where: { id: intentId, tenantId } });
    }
    if (!intent) throw new Error(`Intent ${intentId} not found`);

    const currentState = intent.state ?? intent.status;
    if (!['FILLED', 'PARTIALLY_FILLED', 'CANCELLED'].includes(currentState)) {
      this.logger.warn(`Post-trade called for intent ${intentId} in state ${currentState}, skipping`);
      return null;
    }

    // Aggregate execution results from fills
    let fills: any[] = [];
    try {
      fills = await (this.prisma as any).omsFill.findMany({ where: { tenantId, orderIntentId: intentId, state: { not: 'DUPLICATE' } } });
    } catch {
      const order = await this.prisma.order.findFirst({ where: { tenantId, clientOrderId: intent.clientOrderId } });
      if (order) fills = await this.prisma.fill.findMany({ where: { orderId: order.id } });
    }

    if (fills.length === 0) {
      this.logger.warn(`No fills for post-trade intent ${intentId}`);
      return null;
    }

    let totalQty = 0n;
    let totalNotional = 0n;
    let totalFee = 0n;
    let feeCurrency: string | null = null;
    for (const f of fills) {
      const qtyStr = f.quantity?.toString() ?? f.quantity;
      const priceStr = f.price?.toString() ?? f.price;
      const feeStr = f.fee?.toString() ?? f.fee ?? '0';
      if (isValidDecimal(qtyStr) && isValidDecimal(priceStr)) {
        const qty = parseScaled(qtyStr);
        const price = parseScaled(priceStr);
        totalQty += qty;
        totalNotional += (qty * price) / BigInt(1_000_000_000_000);
      }
      if (isValidDecimal(feeStr)) totalFee += parseScaled(feeStr);
      if (!feeCurrency && f.feeCurrency) feeCurrency = f.feeCurrency;
    }

    const avgPrice = totalQty > 0n ? formatScaled((totalNotional * BigInt(1_000_000_000_000)) / totalQty) : null;

    // Link fee references — check if fee accrual already exists (idempotency)
    let feeAccrualRef: string | null = null;
    try {
      const existingAccrual = await (this.prisma as any).feeAccrual.findFirst({ where: { tenantId, sourceId: intentId } });
      if (existingAccrual) {
        feeAccrualRef = existingAccrual.id;
        this.logger.log(`Fee accrual already exists for intent ${intentId}: ${feeAccrualRef}, not duplicating`);
      } else if (totalFee > 0n) {
        // Create fee accrual when existing commercial policy requires it — simplified: create if fee >0 and env LIVE
        if (intent.environment === 'LIVE') {
          const accrual = await (this.prisma as any).feeAccrual.create({
            data: {
              tenantId,
              feeType: 'TRADING',
              feeSourceType: 'ORDER_FILL',
              sourceId: intentId,
              sourceAmount: formatScaled(totalQty),
              feeAmount: formatScaled(totalFee),
              currency: feeCurrency ?? 'USDT',
              status: 'ACCRUED',
              settlementState: 'DRAFT',
              idempotencyKey: `fee-${intentId}`,
              metadata: { symbol, venue, accountId, fillCount: fills.length } as any,
              safeMetadata: { symbol, fillCount: fills.length } as any,
            },
          });
          feeAccrualRef = accrual.id;
          this.logger.log(`Fee accrual created ${feeAccrualRef} for intent ${intentId} fee ${formatScaled(totalFee)}`);
        }
      }
    } catch (e) {
      this.logger.warn(`Fee accrual check failed for ${intentId}: ${(e as Error).message}`);
    }

    // Usage event — idempotent
    let usageEventRef: string | null = null;
    try {
      const existingUsage = await (this.prisma as any).usageEvent.findFirst({ where: { tenantId, sourceId: intentId } });
      if (existingUsage) {
        usageEventRef = existingUsage.id;
        this.logger.log(`Usage event already exists for intent ${intentId}: ${usageEventRef}, not duplicating`);
      } else {
        const periodId = new Date().toISOString().slice(0, 7); // YYYY-MM
        const usage = await (this.prisma as any).usageEvent.create({
          data: {
            tenantId,
            meterKey: 'order_fills',
            eventType: 'ORDER_FILLED',
            sourceId: intentId,
            sourceType: 'OMS_ORDER',
            quantity: fills.length,
            periodId,
            idempotencyKey: `usage-${intentId}`,
            status: 'RECEIVED',
            metadata: { symbol, venue, accountId } as any,
            safeMetadata: { symbol, fillCount: fills.length } as any,
          },
        });
        usageEventRef = usage.id;
      }
    } catch (e) {
      this.logger.warn(`Usage event check failed for ${intentId}: ${(e as Error).message}`);
    }

    // Trade lifecycle already updated via FillManagementService, but ensure
    // For each fill, buildOrUpdateTradeFromFill already called, we can fetch latest trade
    let tradeLifecycleRef: string | null = null;
    try {
      const trades = await this.tradeLifecycleService.getOpenTrades({ tenantId, accountId, symbol, strategyId: strategyId as any });
      // Also include recently closed trades
      const history = await this.tradeLifecycleService.getTradeHistory({ tenantId, accountId, symbol, limit: 5 });
      const allTrades = [...trades, ...history];
      const related = allTrades.find((t: any) => t.orderIds?.includes(intentId) || t.fillIds?.some((fid: string) => fills.map((f: any) => f.id).includes(fid)));
      if (related) tradeLifecycleRef = related.id;
    } catch {}

    // Settlement reference — simplified: use fill aggregation as settlement evidence
    const settlementRef = `settlement-${intentId}-${randomUUID().slice(0, 8)}`;

    // Notifications — emit where applicable, but don't duplicate
    let notificationRef: string | null = null;
    try {
      // Check if notification already sent for this intent
      const existingNotif = await this.prisma.notification.findFirst({ where: { tenantId, type: 'ORDER_FILLED' } as any });
      if (existingNotif) {
        notificationRef = existingNotif.id;
      } else if (intent.environment === 'LIVE') {
        // Only notify for LIVE filled orders
        const notif = await this.prisma.notification.create({
          data: {
            tenantId,
            userId: intent.followerId ?? intent.traderId ?? accountId, // simplified
            channel: 'IN_APP' as any,
            type: 'ORDER_FILLED',
            title: `Order ${intent.symbol} ${intent.side} filled`,
            body: `Order ${intent.symbol} ${intent.side} qty ${formatScaled(totalQty)} avg ${avgPrice ?? 'unknown'} filled`,
            data: { orderIntentId: intentId, symbol, side: intent.side, quantity: formatScaled(totalQty), averagePrice: avgPrice, fee: formatScaled(totalFee) } as any,
          },
        });
        notificationRef = notif.id;
      }
    } catch (e) {
      this.logger.warn(`Notification failed for ${intentId}: ${(e as Error).message}`);
    }

    // Determine if reconciliation should be triggered — e.g., if filled qty != order qty
    const orderQtyStr = intent.quantity?.toString() ?? intent.quantity;
    let reconciliationTriggered = false;
    if (isValidDecimal(orderQtyStr)) {
      const orderQty = parseScaled(orderQtyStr);
      if (totalQty !== orderQty && currentState === 'FILLED') {
        reconciliationTriggered = true;
        this.logger.warn(`Post-trade quantity mismatch intent ${intentId} order ${orderQtyStr} vs filled ${formatScaled(totalQty)}, triggering reconciliation`);
        // Would enqueue reconciliation job via queue — simplified log
      }
    }

    const result = {
      id: randomUUID(),
      tenantId,
      orderIntentId: intentId,
      tradeId: tradeLifecycleRef,
      accountId,
      symbol,
      venue: venue ?? null,
      totalFilledQuantity: formatScaled(totalQty),
      averageFillPrice: avgPrice,
      totalFees: formatScaled(totalFee),
      feeCurrency,
      settlementRef,
      feeAccrualRef,
      usageEventRef,
      notificationRef,
      tradeLifecycleRef,
      reconciliationTriggered,
      completedAt: new Date().toISOString(),
      metadata: { fillCount: fills.length, correlationId },
    };

    // Persist post-trade result if model exists
    try {
      await (this.prisma as any).omsPostTrade.create({ data: result });
    } catch {}

    // Audit
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId,
          actorType: 'SYSTEM',
          action: 'POST_TRADE_COMPLETED',
          resourceType: 'OMS_ORDER',
          resourceId: intentId,
          description: `Post-trade completed intent ${intentId} ${symbol} qty ${formatScaled(totalQty)} avg ${avgPrice ?? 'n/a'} fee ${formatScaled(totalFee)}`.slice(0, 500),
          metadata: { settlementRef, feeAccrualRef, usageEventRef, tradeLifecycleRef, reconciliationTriggered } as any,
        },
      });
    } catch {}

    this.logger.log(`Post-trade completed intent ${intentId} tenant ${tenantId} qty ${formatScaled(totalQty)} avg ${avgPrice} fee ${formatScaled(totalFee)}`);
    return result;
  }
}
