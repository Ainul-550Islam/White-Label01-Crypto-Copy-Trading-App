import { Injectable, Logger } from '@nestjs/common';
import { PaperTradingRepository } from './paper-trading-repository';

/**
 * Aggregates paper session performance from simulated portfolio/order/fill records and exposes ACTUAL_SIMULATION status, never live performance.
 * Every result must clearly identify PAPER_SIMULATION
 */
@Injectable()
export class PaperPerformanceService {
  private readonly logger = new Logger(PaperPerformanceService.name);

  constructor(private readonly paperRepo: PaperTradingRepository) {}

  async getPerformance(tenantId: string, sessionId: string): Promise<{
    sessionId: string;
    tenantId: string;
    initialCapital: string;
    currentEquity: string | null;
    realizedPnl: string;
    unrealizedPnl: string | null;
    totalReturn: string | null;
    totalReturnPercent: string | null;
    maxDrawdown: string | null;
    maxDrawdownPercent: string | null;
    tradeCount: number;
    winCount: number;
    lossCount: number;
    winRate: string | null;
    feesPaid: string;
    exposure: string | null;
    isSimulated: true;
    status: string;
    disclaimer: string;
    source: string;
  } | null> {
    const session = await this.paperRepo.findSessionById(sessionId, tenantId);
    if (!session) return null;

    const fillsResult = await this.paperRepo.listPaperFills(tenantId, sessionId, { page: 1, limit: 10000 });
    const fills = fillsResult.data;

    const snapshots = await this.paperRepo.listSnapshots(tenantId, sessionId);

    const initial = parseFloat(session.initialCapital);
    const current = session.currentEquity ? parseFloat(session.currentEquity) : initial;

    const totalReturn = (current - initial).toString();
    const totalReturnPercent = initial > 0 ? (((current / initial) - 1) * 100).toString() : null;

    // Calculate win/loss from fills - pair buys and sells FIFO
    let winCount = 0;
    let lossCount = 0;
    let realizedPnl = 0;

    const buys: { qty: number; price: number; cost: number }[] = [];

    for (const fill of fills.sort((a:any,b:any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())) {
      const qty = parseFloat(fill.quantity);
      const price = parseFloat(fill.price);
      const fee = parseFloat(fill.fee || '0');
      const notional = qty * price;

      if (fill.side === 'BUY') {
        buys.push({ qty, price, cost: notional + fee });
      } else {
        let remainingSellQty = qty;
        let tradePnl = 0;
        while (remainingSellQty > 0 && buys.length > 0) {
          const buy = buys[0];
          const matchedQty = Math.min(remainingSellQty, buy.qty);
          const buyCost = (buy.cost / buy.qty) * matchedQty;
          const sellProceeds = (notional / qty) * matchedQty;
          const pnl = sellProceeds - buyCost - fee;
          tradePnl += pnl;
          realizedPnl += pnl;

          buy.qty -= matchedQty;
          if (buy.qty <= 0.00000001) buys.shift();
          else buy.cost -= buyCost;

          remainingSellQty -= matchedQty;
        }

        if (tradePnl > 0) winCount++;
        else if (tradePnl < 0) lossCount++;
      }
    }

    const tradeCount = winCount + lossCount;
    const winRate = tradeCount > 0 ? (winCount / tradeCount).toString() : null;

    // Max drawdown from snapshots
    let maxDrawdown: string | null = null;
    let maxDrawdownPercent: string | null = null;
    if (snapshots.length > 0) {
      let peak = initial;
      let maxDd = 0;
      let maxDdPercent = 0;
      for (const snap of snapshots) {
        const eq = parseFloat(snap.equity);
        if (eq > peak) peak = eq;
        const dd = peak - eq;
        if (dd > maxDd) {
          maxDd = dd;
          maxDdPercent = peak > 0 ? (dd / peak) * 100 : 0;
        }
      }
      if (maxDd > 0) {
        maxDrawdown = maxDd.toString();
        maxDrawdownPercent = maxDdPercent.toString();
      }
    }

    return {
      sessionId,
      tenantId,
      initialCapital: session.initialCapital,
      currentEquity: session.currentEquity || null,
      realizedPnl: session.realizedPnl || realizedPnl.toString(),
      unrealizedPnl: session.unrealizedPnl || null,
      totalReturn,
      totalReturnPercent,
      maxDrawdown,
      maxDrawdownPercent,
      tradeCount,
      winCount,
      lossCount,
      winRate,
      feesPaid: session.feesPaid || '0',
      exposure: null,
      isSimulated: true,
      status: 'PAPER_SIMULATION',
      disclaimer: 'PAPER_SIMULATION: This is simulated paper trading performance, not live performance. Paper performance is not indicative of live performance; simulation does not guarantee real execution quality.',
      source: 'PAPER_TRADING',
    };
  }

  async getEquityCurve(tenantId: string, sessionId: string): Promise<any[]> {
    const snapshots = await this.paperRepo.listSnapshots(tenantId, sessionId);
    return snapshots.map((s:any) => ({
      timestamp: new Date(s.timestamp).toISOString(),
      sequence: s.sequence,
      equity: s.equity,
      cash: s.cash,
      realizedPnl: s.realizedPnl,
      unrealizedPnl: s.unrealizedPnl,
      drawdown: s.drawdown,
      isSimulated: true,
    }));
  }
}
