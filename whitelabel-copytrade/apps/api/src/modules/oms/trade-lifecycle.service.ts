import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TradeState, isValidDecimal, parseScaled, formatScaled, add, sub } from './oms.types';

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
  }, options?: {
    /**
     * Run against this client instead of the service's own. The caller uses it to apply the trade in
     * the same transaction that inserts the fill, so the two cannot diverge: a crash between them
     * would otherwise leave a persisted fill with no trade, and the fill-sync idempotency check would
     * skip that fill forever on every later run.
     */
    client?: unknown;
  }) {
    const { tenantId, accountId, symbol, venue, strategyId, traderId, followerId, orderIntentId, fillId, fillQuantity, fillPrice, fillSide, isSimulated, correlationId } = params;
    const prisma: any = options?.client ?? this.prisma;

    // Idempotency first. A fill that has already been applied to a trade must not be applied
    // again: the open-trade lookup below is keyed on account+symbol+strategy, so a re-delivered
    // fill would find the trade it was already written into and increase the position a second
    // time - a duplicated fill silently doubling the position and the exposure the position
    // limiter reads. The fill id is the idempotency key, and it is checked before that lookup.
    let alreadyApplied: any;
    try {
      alreadyApplied = await prisma.omsTrade.findFirst({
        where: { tenantId, accountId, fillIds: { has: fillId } },
      });
    } catch (e) {
      // A failed read is not "no trade exists". Treating it as one would open a second trade for
      // a fill that may already be applied, which is the double-count this lookup exists to stop.
      throw new Error(`Trade lookup by fill ${fillId} failed: ${(e as Error).message}`);
    }
    if (alreadyApplied) {
      this.logger.log(`Fill ${fillId} already applied to trade ${alreadyApplied.id}; returning it unchanged`);
      return alreadyApplied;
    }

    // Find existing open trade for this account+symbol+strategy
    let trade: any;
    try {
      trade = await prisma.omsTrade.findFirst({
        where: { tenantId, accountId, symbol, state: { in: [TradeState.OPEN, TradeState.PARTIAL] }, strategyId: strategyId ?? undefined },
        orderBy: { createdAt: 'desc' },
      });
    } catch (e) {
      throw new Error(`Open trade lookup for ${symbol} failed: ${(e as Error).message}`);
    }

    if (!trade) {
      // Open new trade
      const side = fillSide === 'BUY' ? 'LONG' : 'SHORT';
      try {
        trade = await prisma.omsTrade.create({
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
        // Fail closed. Returning an in-memory trade here was a lie about durable state: the caller
        // feeds this record into position-slot accounting, so a trade that was never written would
        // occupy no slot, and the exposure it represents would be invisible to every later check.
        this.logger.error(`Trade OPEN failed for ${symbol} fill ${fillId}: ${(e as Error).message}`);
        throw e;
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
        trade = await prisma.omsTrade.update({
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
      } catch (e) {
        // The quantity and average entry are recomputed from the persisted row on every call, so
        // writing them onto this object only made the caller's view disagree with the database:
        // the position would be reported at the new size while the durable row kept the old one.
        this.logger.error(`Trade increase failed for ${trade.id}: ${(e as Error).message}`);
        throw e;
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
          trade = await prisma.omsTrade.update({
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
        } catch (e) {
          // A trade that fails to persist as CLOSED is still open. Reporting it closed in memory
          // would free its position slot while the venue-facing row still holds the exposure.
          this.logger.error(`Trade close failed for ${trade.id}: ${(e as Error).message}`);
          throw e;
        }
        this.logger.log(`Trade CLOSED ${trade.id} ${symbol} qty ${closedQty} exit ${fillPrice}`);

        // If over-closed, open new trade in opposite direction with remainder
        if (extraQty && parseScaled(extraQty) > 0n) {
          const newSide = currentSide === 'LONG' ? 'SHORT' : 'LONG';
          try {
            const newTrade = await prisma.omsTrade.create({
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
          } catch (e) {
            // An empty catch here dropped the remainder of an over-closing fill entirely: the
            // caller was told the trade closed, and the opposite position it should have opened
            // existed nowhere. That is untracked exposure, not a degraded result.
            this.logger.error(`Trade flip OPEN failed for ${symbol} remainder ${extraQty}: ${(e as Error).message}`);
            throw e;
          }
        }
      } else {
        // Partial close
        const remaining = existingRemaining - closingQty;
        try {
          trade = await prisma.omsTrade.update({
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
        } catch (e) {
          this.logger.error(`Trade partial close failed for ${trade.id}: ${(e as Error).message}`);
          throw e;
        }
        this.logger.log(`Trade PARTIAL ${trade.id} ${symbol} remaining ${formatScaled(remaining)}`);
      }
    }

    return trade;
  }

  async getOpenTrades(params: { tenantId: string; accountId?: string; symbol?: string; strategyId?: string }) {
    const { tenantId, accountId, symbol, strategyId } = params;
    return await (this.prisma as any).omsTrade.findMany({
      where: { tenantId, ...(accountId ? { accountId } : {}), ...(symbol ? { symbol } : {}), ...(strategyId ? { strategyId } : {}), state: { in: [TradeState.OPEN, TradeState.PARTIAL] } },
      orderBy: { openedAt: 'desc' },
    });
  }

  async getTradeHistory(params: { tenantId: string; accountId?: string; symbol?: string; from?: Date; to?: Date; page?: number; limit?: number }) {
    const { tenantId, accountId, symbol, from, to, page = 1, limit = 20 } = params;
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
  }

  async getTradeById(tenantId: string, tradeId: string) {
    return await (this.prisma as any).omsTrade.findFirst({ where: { id: tradeId, tenantId } });
  }
}
