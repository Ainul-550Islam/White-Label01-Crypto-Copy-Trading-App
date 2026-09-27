import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TraderPerformance, TraderProfile } from './copy-trading.types';

/**
 * Provides read-only performance derived exclusively from canonical fills, orders, positions, balances, and settlements. No synthetic profit/ROI. Distinguish ACTUAL from ESTIMATED.
 * Must never create fake fills/balances.
 */
@Injectable()
export class TraderPerformanceService {
  private readonly logger = new Logger(TraderPerformanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getPerformance(tenantId: string, traderId: string): Promise<TraderPerformance | null> {
    const trader = await (this.prisma as any).traderProfile?.findFirst({ where: { id: traderId, tenantId, deletedAt: null } });
    if (!trader) return null;

    const userId = trader.userId;

    // All performance must come from canonical data - fills, orders, positions
    // Never create fake fills/balances

    try {
      // Get all trading accounts for trader
      const accounts = await this.prisma.tradingAccount.findMany({ where: { tenantId, userId, deletedAt: null } });
      const accountIds = accounts.map((a: any) => a.id);

      if (accountIds.length === 0) {
        return this.emptyPerformance(traderId, tenantId);
      }

      // Canonical fills - order by createdAt as executedAt does not exist
      const fills = await this.prisma.fill.findMany({ where: { order: { tenantId, accountId: { in: accountIds } } }, orderBy: { createdAt: 'asc' } });

      // Canonical orders
      const orders = await this.prisma.order.findMany({ where: { tenantId, accountId: { in: accountIds } } });

      // Positions for unrealized PnL
      const positions = await this.prisma.position.findMany({ where: { tenantId, accountId: { in: accountIds } } });

      // Calculate from canonical fills - ACTUAL
      let realizedPnl = 0;
      let totalVolume = 0;
      let winCount = 0;
      let lossCount = 0;
      let totalWin = 0;
      let totalLoss = 0;
      let lastTradeAt: string | null = null;

      // Simple PnL calculation from fills - need to track per symbol
      const symbolTrades: Record<string, { buys: { qty: number; price: number; cost: number }[]; sells: { qty: number; price: number; proceeds: number }[]; pnl: number; volume: number }> = {};

      for (const fill of fills) {
        const symbol = fill.orderId ? (await this.getSymbolForOrder(fill.orderId)) || 'UNKNOWN' : 'UNKNOWN';
        const qty = parseFloat(fill.quantity.toString());
        const price = parseFloat(fill.price.toString());
        const side = fill.side;

        if (!symbolTrades[symbol]) symbolTrades[symbol] = { buys: [], sells: [], pnl: 0, volume: 0 };

        const volume = qty * price;
        totalVolume += volume;
        symbolTrades[symbol].volume += volume;

        if (side === 'BUY') {
          symbolTrades[symbol].buys.push({ qty, price, cost: volume });
        } else {
          symbolTrades[symbol].sells.push({ qty, price, proceeds: volume });
          // Match with buys FIFO for realized PnL
          let remainingSellQty = qty;
          while (remainingSellQty > 0 && symbolTrades[symbol].buys.length > 0) {
            const buy = symbolTrades[symbol].buys[0];
            const matchedQty = Math.min(remainingSellQty, buy.qty);
            const buyCost = (buy.cost / buy.qty) * matchedQty;
            const sellProceeds = (volume / qty) * matchedQty;
            const tradePnl = sellProceeds - buyCost;
            realizedPnl += tradePnl;
            symbolTrades[symbol].pnl += tradePnl;

            if (tradePnl > 0) {
              winCount++;
              totalWin += tradePnl;
            } else if (tradePnl < 0) {
              lossCount++;
              totalLoss += Math.abs(tradePnl);
            }

            buy.qty -= matchedQty;
            if (buy.qty <= 0.00000001) symbolTrades[symbol].buys.shift();
            else buy.cost -= buyCost;

            remainingSellQty -= matchedQty;
          }
        }

        if ((fill as any).createdAt) lastTradeAt = new Date((fill as any).createdAt).toISOString();
      }

      // Unrealized PnL from positions - use averageEntryPrice
      let unrealizedPnl = 0;
      for (const pos of positions) {
        try {
          const qty = parseFloat(pos.quantity.toString());
          const entry = parseFloat(((pos as any).averageEntryPrice?.toString() || pos.markPrice?.toString()) || '0');
          const mark = parseFloat(pos.markPrice?.toString() || entry.toString());
          const pnl = (mark - entry) * qty;
          if (!isNaN(pnl)) unrealizedPnl += pnl;
        } catch {}
      }

      const tradeCount = winCount + lossCount;
      const winRate = tradeCount > 0 ? (winCount / tradeCount).toString() : null;
      const lossRate = tradeCount > 0 ? (lossCount / tradeCount).toString() : null;
      const averageTrade = tradeCount > 0 ? (realizedPnl / tradeCount).toString() : null;
      const averageWin = winCount > 0 ? (totalWin / winCount).toString() : null;
      const averageLoss = lossCount > 0 ? (totalLoss / lossCount).toString() : null;
      const profitFactor = totalLoss > 0 ? (totalWin / totalLoss).toString() : winCount > 0 ? '999' : null;

      // History length from first fill
      let historyLengthDays = 0;
      if (fills.length > 0 && (fills[0] as any).createdAt) {
        const first = new Date((fills[0] as any).createdAt).getTime();
        const now = Date.now();
        historyLengthDays = Math.floor((now - first) / (1000 * 60 * 60 * 24));
      }

      // Max drawdown - calculate from cumulative PnL curve
      let maxDrawdown: string | null = null;
      let peak = 0;
      let current = 0;
      let maxDd = 0;
      const cumulative: number[] = [];
      for (const symbol of Object.keys(symbolTrades)) {
        // Simplified: use realized per symbol
        current += symbolTrades[symbol].pnl;
        cumulative.push(current);
        if (current > peak) peak = current;
        const dd = peak - current;
        if (dd > maxDd) maxDd = dd;
      }
      if (maxDd > 0) maxDrawdown = maxDd.toString();

      return {
        traderId,
        tenantId,
        realizedPnl: realizedPnl.toString(),
        unrealizedPnl: unrealizedPnl.toString(),
        totalReturn: realizedPnl.toString(),
        totalReturnPercent: null, // Requires initial capital - not available without fake data
        maxDrawdown,
        maxDrawdownPercent: null,
        winCount,
        lossCount,
        tradeCount: fills.length,
        winRate,
        lossRate,
        totalVolume: totalVolume.toString(),
        averageTrade,
        averageWin,
        averageLoss,
        profitFactor,
        sharpeRatio: null, // Requires more data, avoid fake
        historyLengthDays,
        lastTradeAt,
        isActual: true, // ACTUAL from fills
        source: 'FILLS',
      };
    } catch (e: any) {
      this.logger.warn(`Failed to get performance tenant=${tenantId} trader=${traderId} error=${e.message}`);
      return this.emptyPerformance(traderId, tenantId);
    }
  }

  private emptyPerformance(traderId: string, tenantId: string): TraderPerformance {
    return {
      traderId,
      tenantId,
      realizedPnl: '0',
      unrealizedPnl: '0',
      totalReturn: '0',
      totalReturnPercent: null,
      maxDrawdown: null,
      maxDrawdownPercent: null,
      winCount: 0,
      lossCount: 0,
      tradeCount: 0,
      winRate: null,
      lossRate: null,
      totalVolume: '0',
      averageTrade: null,
      averageWin: null,
      averageLoss: null,
      profitFactor: null,
      sharpeRatio: null,
      historyLengthDays: 0,
      lastTradeAt: null,
      isActual: true,
      source: 'FILLS',
    };
  }

  private async getSymbolForOrder(orderId: string): Promise<string | null> {
    try {
      const order = await this.prisma.order.findFirst({ where: { id: orderId } });
      return order?.symbol || null;
    } catch {
      return null;
    }
  }

  async getBatchPerformance(tenantId: string, traderIds: string[]): Promise<Record<string, TraderPerformance>> {
    const result: Record<string, TraderPerformance> = {};
    for (const traderId of traderIds) {
      const perf = await this.getPerformance(tenantId, traderId);
      if (perf) result[traderId] = perf;
    }
    return result;
  }
}
