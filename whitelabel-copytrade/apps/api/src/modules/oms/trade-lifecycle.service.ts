import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TradeState, isValidDecimal, parseScaled, formatScaled, add, sub } from './oms.types';
import { randomUUID } from 'crypto';

/**
 * Trade Lifecycle Service — builds trade lifecycle from canonical orders/fills
 * and coordinates open/closed/partial states using canonical trading data.
 * Does NOT create a second position/PnL engine. Uses canonical fill/position sources.
 */

@Injectable()
export class TradeLifecycleService {
  private readonly logger = new Logger(TradeLifecycleService.name);

  constructor(private readonly prisma: PrismaService) {}

  async buildOrUpdateTradeFromFill(params: {
    tenantId: string;
    accountId: string;
    symbol: string;
    venue?: string | null;
    strategyId?: string | null;
    traderId?: string | null;
    followerId?: string | null;
    orderIntentId: string;
    fillId: string;
    fillQuantity: string;
    fillPrice: string;
    fillSide: string; // BUY/SELL
    isSimulated?: boolean;
    correlationId?: string | null;
  }) {
    const { tenantId, accountId, symbol, venue, strategyId, traderId, followerId, orderIntentId, fillId, fillQuantity, fillPrice, fillSide, isSimulated, correlationId } = params;

    // Find existing open trade for this account+symbol+strategy
    let trade: any;
    try {
      trade = await (this.prisma as any).omsTrade.findFirst({
        where: { tenantId, accountId, symbol, state: { in: [TradeState.OPEN, TradeState.PARTIAL] }, strategyId: strategyId ?? undefined },
        orderBy: { createdAt: 'desc' },
      });
    } catch {
      trade = null;
    }

    if (!trade) {
      // Open new trade
      const side = fillSide === 'BUY' ? 'LONG' : 'SHORT';
      try {
        trade = await (this.prisma as any).omsTrade.create({
          data: {
            tenantId,
            accountId,
            symbol,
            venue: venue ?? null,
            strategyId: strategyId ?? null,
            traderId: traderId ?? null,
            followerId: followerId ?? null,
            state: TradeState.OPEN,
            side,
            openQuantity: fillQuantity,
            closedQuantity: '0',
            remainingQuantity: fillQuantity,
            averageEntryPrice: fillPrice,
            totalFee: '0',
            orderIds: [orderIntentId],
            fillIds: [fillId],
            openedAt: new Date(),
            correlationId: correlationId ?? null,
            isSimulated: isSimulated ?? false,
          },
        });
        this.logger.log(`Trade OPENED ${trade.id} tenant ${tenantId} ${symbol} ${side} qty ${fillQuantity}`);
        return trade;
      } catch (e) {
        this.logger.warn(`OmsTrade model missing: ${(e as Error).message}`);
        return { id: randomUUID(), state: TradeState.OPEN, openQuantity: fillQuantity, averageEntryPrice: fillPrice, side };
      }
    }

    // Update existing trade — need to handle same side (increase) vs opposite side (reduce/close)
    const currentSide = trade.side;
    const fillIsBuy = fillSide === 'BUY';
    const isSameSide = (currentSide === 'LONG' && fillIsBuy) || (currentSide === 'SHORT' && !fillIsBuy);

    if (isSameSide) {
      // Increase position — recalculate average entry
      const existingQty = parseScaled(trade.openQuantity ?? trade.remainingQuantity ?? '0');
      const existingPrice = trade.averageEntryPrice && isValidDecimal(trade.averageEntryPrice) ? parseScaled(trade.averageEntryPrice) : 0n;
      const newQty = parseScaled(fillQuantity);
      const newPrice = parseScaled(fillPrice);
      const totalQty = existingQty + newQty;
      const totalNotional = (existingQty * existingPrice) / BigInt(1_000_000_000_000) + (newQty * newPrice) / BigInt(1_000_000_000_000);
      const avgPrice = totalQty > 0n ? formatScaled((totalNotional * BigInt(1_000_000_000_000)) / totalQty) : fillPrice;

      try {
        trade = await (this.prisma as any).omsTrade.update({
          where: { id: trade.id },
          data: {
            openQuantity: formatScaled(totalQty),
            remainingQuantity: formatScaled(totalQty),
            averageEntryPrice: avgPrice,
            orderIds: { push: orderIntentId } as any,
            fillIds: { push: fillId } as any,
            state: TradeState.OPEN,
            updatedAt: new Date(),
          },
        });
      } catch {
        trade.openQuantity = formatScaled(totalQty);
        trade.averageEntryPrice = avgPrice;
      }
    } else {
      // Opposite side — closing or partial close
      const existingRemaining = parseScaled(trade.remainingQuantity ?? trade.openQuantity ?? '0');
      const closingQty = parseScaled(fillQuantity);
      if (closingQty >= existingRemaining) {
        // Fully closed
        const closedQty = formatScaled(existingRemaining);
        const extraQty = closingQty > existingRemaining ? formatScaled(closingQty - existingRemaining) : null;
        try {
          trade = await (this.prisma as any).omsTrade.update({
            where: { id: trade.id },
            data: {
              closedQuantity: closedQty,
              remainingQuantity: '0',
              averageExitPrice: fillPrice,
              state: TradeState.CLOSED,
              closedAt: new Date(),
              orderIds: { push: orderIntentId } as any,
              fillIds: { push: fillId } as any,
              updatedAt: new Date(),
            },
          });
        } catch {
          trade.state = TradeState.CLOSED;
          trade.closedQuantity = closedQty;
          trade.averageExitPrice = fillPrice;
        }
        this.logger.log(`Trade CLOSED ${trade.id} ${symbol} qty ${closedQty} exit ${fillPrice}`);

        // If over-closed, open new trade in opposite direction with remainder
        if (extraQty && parseScaled(extraQty) > 0n) {
          const newSide = currentSide === 'LONG' ? 'SHORT' : 'LONG';
          try {
            const newTrade = await (this.prisma as any).omsTrade.create({
              data: {
                tenantId,
                accountId,
                symbol,
                venue: venue ?? null,
                strategyId: strategyId ?? null,
                traderId: traderId ?? null,
                followerId: followerId ?? null,
                state: TradeState.OPEN,
                side: newSide,
                openQuantity: extraQty,
                closedQuantity: '0',
                remainingQuantity: extraQty,
                averageEntryPrice: fillPrice,
                totalFee: '0',
                orderIds: [orderIntentId],
                fillIds: [fillId],
                openedAt: new Date(),
                correlationId: correlationId ?? null,
                isSimulated: isSimulated ?? false,
              },
            });
            this.logger.log(`Trade OPENED (flip) ${newTrade.id} ${symbol} ${newSide} qty ${extraQty}`);
            return newTrade;
          } catch {}
        }
      } else {
        // Partial close
        const remaining = existingRemaining - closingQty;
        try {
          trade = await (this.prisma as any).omsTrade.update({
            where: { id: trade.id },
            data: {
              closedQuantity: add(trade.closedQuantity ?? '0', fillQuantity),
              remainingQuantity: formatScaled(remaining),
              averageExitPrice: fillPrice,
              state: TradeState.PARTIAL,
              orderIds: { push: orderIntentId } as any,
              fillIds: { push: fillId } as any,
              updatedAt: new Date(),
            },
          });
        } catch {
          trade.state = TradeState.PARTIAL;
          trade.remainingQuantity = formatScaled(remaining);
        }
        this.logger.log(`Trade PARTIAL ${trade.id} ${symbol} remaining ${formatScaled(remaining)}`);
      }
    }

    return trade;
  }

  async getOpenTrades(params: { tenantId: string; accountId?: string; symbol?: string; strategyId?: string }) {
    const { tenantId, accountId, symbol, strategyId } = params;
    try {
      return await (this.prisma as any).omsTrade.findMany({
        where: { tenantId, ...(accountId ? { accountId } : {}), ...(symbol ? { symbol } : {}), ...(strategyId ? { strategyId } : {}), state: { in: [TradeState.OPEN, TradeState.PARTIAL] } },
        orderBy: { openedAt: 'desc' },
      });
    } catch {
      return [];
    }
  }

  async getTradeHistory(params: { tenantId: string; accountId?: string; symbol?: string; from?: Date; to?: Date; page?: number; limit?: number }) {
    const { tenantId, accountId, symbol, from, to, page = 1, limit = 20 } = params;
    try {
      return await (this.prisma as any).omsTrade.findMany({
        where: {
          tenantId,
          ...(accountId ? { accountId } : {}),
          ...(symbol ? { symbol } : {}),
          ...(from || to ? { openedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        },
        orderBy: { openedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      });
    } catch {
      return [];
    }
  }

  async getTradeById(tenantId: string, tradeId: string) {
    try {
      return await (this.prisma as any).omsTrade.findFirst({ where: { id: tradeId, tenantId } });
    } catch {
      return null;
    }
  }
}
