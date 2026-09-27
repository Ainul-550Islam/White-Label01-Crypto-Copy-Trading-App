import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderIntentState, OmsFillState, isValidDecimal, parseScaled, formatScaled, add, cmp } from './oms.types';
import { randomUUID } from 'crypto';

/**
 * Fill Management Service — normalizes and persists canonical fill events,
 * duplicate detection, cumulative fills, average price, fees, fill lifecycle.
 * Does not create synthetic fills unless existing execution model explicitly provides one.
 */

@Injectable()
export class FillManagementService {
  private readonly logger = new Logger(FillManagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycleService: OrderLifecycleService,
  ) {}

  private validateFill(params: { quantity: string; price: string; fee?: string }) {
    if (!isValidDecimal(params.quantity)) throw new BadRequestException(`Invalid fill quantity ${params.quantity}`);
    if (!isValidDecimal(params.price)) throw new BadRequestException(`Invalid fill price ${params.price}`);
    if (parseScaled(params.quantity) <= 0n) throw new BadRequestException('Fill quantity must be > 0');
    if (parseScaled(params.price) <= 0n) throw new BadRequestException('Fill price must be > 0');
    if (params.fee && !isValidDecimal(params.fee)) throw new BadRequestException(`Invalid fee ${params.fee}`);
  }

  async processCanonicalFill(params: {
    tenantId: string;
    orderId: string; // internal Order id
    venueTradeId: string;
    providerOrderId?: string | null;
    exchangeOrderId?: string | null;
    symbol: string;
    side: string;
    quantity: string;
    price: string;
    fee?: string;
    feeCurrency?: string;
    quoteQuantity?: string | null;
    isMaker?: boolean;
    isSimulated?: boolean;
    exchangeTimestampMicros?: string | null;
    receivedTimestampMicros?: string;
    source?: string;
    venue?: string | null;
    correlationId?: string | null;
  }) {
    const {
      tenantId,
      orderId,
      venueTradeId,
      providerOrderId,
      exchangeOrderId,
      symbol,
      side,
      quantity,
      price,
      fee,
      feeCurrency,
      quoteQuantity,
      isMaker,
      isSimulated,
      exchangeTimestampMicros,
      receivedTimestampMicros,
      source,
      venue,
      correlationId,
    } = params;

    this.validateFill({ quantity, price, fee });

    // Find OMS intent by internal orderId or clientOrderId
    const order = await this.prisma.order.findFirst({ where: { id: orderId, tenantId } });
    if (!order) throw new BadRequestException(`Order ${orderId} not found for tenant ${tenantId}`);

    let intent: any;
    try {
      intent = await (this.prisma as any).omsOrderIntent.findFirst({ where: { tenantId, clientOrderId: order.clientOrderId } });
    } catch {
      intent = order;
    }
    const intentId = intent?.id ?? orderId;

    // Duplicate detection: provider fill ID + order
    try {
      const existing = await (this.prisma as any).omsFill.findFirst({
        where: { tenantId, providerFillId: venueTradeId, orderIntentId: intentId },
      });
      if (existing) {
        this.logger.log(`Duplicate fill ignored tenant ${tenantId} fill ${venueTradeId} order ${orderId}`);
        // Mark as DUPLICATE if not already
        if (existing.state !== OmsFillState.DUPLICATE) {
          await (this.prisma as any).omsFill.update({ where: { id: existing.id }, data: { state: OmsFillState.DUPLICATE } });
        }
        return existing;
      }
    } catch {
      // model may not exist, check canonical Fill table duplicate
      const existingFill = await this.prisma.fill.findFirst({ where: { orderId, venueTradeId } });
      if (existingFill) {
        this.logger.log(`Duplicate canonical fill exists order ${orderId} venueTradeId ${venueTradeId}`);
        return existingFill;
      }
    }

    const now = new Date();
    const nowMicros = receivedTimestampMicros ?? (BigInt(now.getTime()) * 1000n).toString();

    // Calculate cumulative and average price — precision-safe
    let cumulativeQuantity = quantity;
    let averagePrice = price;
    try {
      const existingFills = await (this.prisma as any).omsFill.findMany({ where: { tenantId, orderIntentId: intentId, state: { not: OmsFillState.DUPLICATE } } });
      if (existingFills && existingFills.length > 0) {
        let totalQty = parseScaled(quantity);
        let totalNotional = parseScaled(quantity) * parseScaled(price);
        for (const f of existingFills) {
          if (f.quantity && isValidDecimal(f.quantity) && f.price && isValidDecimal(f.price)) {
            totalQty += parseScaled(f.quantity);
            totalNotional += parseScaled(f.quantity) * parseScaled(f.price);
          }
        }
        cumulativeQuantity = formatScaled(totalQty);
        if (totalQty > 0n) {
          const avgScaled = totalNotional / totalQty;
          averagePrice = formatScaled(avgScaled);
        }
      }
    } catch {
      // fallback: use canonical fills
      const fills = await this.prisma.fill.findMany({ where: { orderId } });
      if (fills.length > 0) {
        let totalQty = parseScaled(quantity);
        let totalNotional = parseScaled(quantity) * parseScaled(price);
        for (const f of fills) {
          const q = f.quantity.toString();
          const p = f.price.toString();
          if (isValidDecimal(q) && isValidDecimal(p)) {
            totalQty += parseScaled(q);
            totalNotional += parseScaled(q) * parseScaled(p);
          }
        }
        cumulativeQuantity = formatScaled(totalQty);
        if (totalQty > 0n) averagePrice = formatScaled(totalNotional / totalQty);
      }
    }

    // Persist normalized fill
    let omsFill: any;
    try {
      omsFill = await (this.prisma as any).omsFill.create({
        data: {
          tenantId,
          orderIntentId: intentId,
          internalOrderId: orderId,
          providerFillId: venueTradeId,
          providerOrderId: providerOrderId ?? null,
          exchangeOrderId: exchangeOrderId ?? order.exchangeOrderId ?? null,
          symbol,
          venue: venue ?? (order.venue as any) ?? null,
          side,
          quantity,
          price,
          fee: fee ?? '0',
          feeCurrency: feeCurrency ?? 'USDT',
          quoteQuantity: quoteQuantity ?? null,
          liquidity: isMaker ? 'MAKER' : 'TAKER',
          state: OmsFillState.RECEIVED,
          timestampMicros: nowMicros,
          exchangeTimestampMicros: exchangeTimestampMicros ?? null,
          receivedTimestampMicros: nowMicros,
          cumulativeQuantity,
          averagePrice,
          correlationId: correlationId ?? null,
          source: source ?? 'PRIVATE_STREAM',
          isSimulated: isSimulated ?? false,
        },
      });

      // Validate → Applied
      omsFill = await (this.prisma as any).omsFill.update({
        where: { id: omsFill.id },
        data: { state: OmsFillState.VALIDATED },
      });
      omsFill = await (this.prisma as any).omsFill.update({
        where: { id: omsFill.id },
        data: { state: OmsFillState.APPLIED },
      });
    } catch (e) {
      this.logger.warn(`OmsFill model missing, fill already in canonical table: ${(e as Error).message}`);
      // canonical fill already exists via execution engine, return it
      const canonical = await this.prisma.fill.findFirst({ where: { orderId, venueTradeId } });
      if (canonical) return canonical;
      // If not, we must not invent fill — return null and let caller know
      throw new BadRequestException(`Fill model not available and canonical fill not found for ${venueTradeId}`);
    }

    // Update intent filled quantity and average price
    try {
      await (this.prisma as any).omsOrderIntent.update({
        where: { id: intentId },
        data: { filledQuantity: cumulativeQuantity, averageFillPrice: averagePrice, cumulativeFee: add(intent.cumulativeFee ?? '0', fee ?? '0') },
      });
    } catch {
      // update Order table filledQuantity if OMS model missing
      try {
        await this.prisma.order.update({
          where: { id: orderId },
          data: { filledQuantity: cumulativeQuantity as any, averageFillPrice: averagePrice as any } as any,
        });
      } catch {}
    }

    // Transition lifecycle
    const orderQty = intent.quantity?.toString() ?? order.quantity.toString();
    if (isValidDecimal(orderQty) && isValidDecimal(cumulativeQuantity)) {
      const orderQtyScaled = parseScaled(orderQty);
      const cumQtyScaled = parseScaled(cumulativeQuantity);
      const isFilled = cumQtyScaled >= orderQtyScaled;
      const isPartial = cumQtyScaled > 0n && cumQtyScaled < orderQtyScaled;

      const currentState = intent.state ?? intent.status;
      if (isFilled && currentState !== OrderIntentState.FILLED) {
        await this.lifecycleService.transition({
          tenantId,
          intentId,
          toState: OrderIntentState.FILLED,
          source: 'FILL_MANAGEMENT',
          reason: `Fully filled ${cumulativeQuantity}/${orderQty} avg ${averagePrice}`,
          correlationId,
          timestampMicros: nowMicros,
        });
      } else if (isPartial && [OrderIntentState.ACKNOWLEDGED, OrderIntentState.SUBMITTED].includes(currentState as any)) {
        await this.lifecycleService.transition({
          tenantId,
          intentId,
          toState: OrderIntentState.PARTIALLY_FILLED,
          source: 'FILL_MANAGEMENT',
          reason: `Partially filled ${cumulativeQuantity}/${orderQty} avg ${averagePrice}`,
          correlationId,
          timestampMicros: nowMicros,
        });
      }
    }

    this.logger.log(`Fill applied tenant ${tenantId} intent ${intentId} fill ${venueTradeId} qty ${quantity} price ${price} cumulative ${cumulativeQuantity}`);
    return omsFill;
  }

  async getFillsForIntent(tenantId: string, intentId: string) {
    try {
      return await (this.prisma as any).omsFill.findMany({ where: { tenantId, orderIntentId: intentId }, orderBy: { timestampMicros: 'asc' } });
    } catch {
      // fallback to canonical fills via Order
      const intent = await (this.prisma as any).omsOrderIntent.findFirst({ where: { id: intentId, tenantId } }).catch(() => null);
      const orderId = intent?.internalOrderId ?? intentId;
      return this.prisma.fill.findMany({ where: { orderId }, orderBy: { receivedTimestampMicros: 'asc' } });
    }
  }

  async calculateAveragePrice(fills: Array<{ quantity: string; price: string }>): Promise<{ cumulative: string; average: string | null }> {
    if (fills.length === 0) return { cumulative: '0', average: null };
    let totalQty = 0n;
    let totalNotional = 0n;
    for (const f of fills) {
      if (!isValidDecimal(f.quantity) || !isValidDecimal(f.price)) continue;
      const q = parseScaled(f.quantity);
      const p = parseScaled(f.price);
      totalQty += q;
      totalNotional += (q * p) / BigInt(1e12); // Actually need to keep scale: q is scaled, p scaled, product scaled^2, divide by SCALE
      // Correction: q * p = scaled*scaled = SCALE^2 * qty*price, so divide by SCALE to get notional scaled
    }
    // Recalculate correctly
    totalQty = 0n;
    totalNotional = 0n;
    for (const f of fills) {
      const q = parseScaled(f.quantity);
      const p = parseScaled(f.price);
      totalQty += q;
      totalNotional += (q * p) / (BigInt(1_000_000_000_000));
    }
    const cumulative = formatScaled(totalQty);
    const average = totalQty > 0n ? formatScaled(totalNotional * BigInt(1_000_000_000_000) / totalQty) : null;
    return { cumulative, average };
  }
}
