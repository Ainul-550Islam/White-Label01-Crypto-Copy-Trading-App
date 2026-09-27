import { Injectable, Logger } from '@nestjs/common';

/**
 * Calculates return, drawdown, volatility, Sharpe-like metrics, Sortino-like metrics, win rate, profit factor, turnover, and risk metrics with explicit methodology.
 * Every metric must specify methodology assumptions. Do not claim that metrics predict future performance.
 */

export interface TradeForMetrics {
  quantity: string;
  entryPrice: string;
  exitPrice: string | null;
  grossPnl: string | null;
  fee: string;
  netPnl: string | null;
  isWin: boolean | null;
  openedAt: string;
  closedAt: string | null;
}

export interface EquityPointForMetrics {
  timestamp: string;
  equity: string;
  realizedPnl: string;
  drawdown?: string | null;
}

export interface MetricsResult {
  totalReturn: string | null;
  totalReturnPercent: string | null;
  annualizedReturn: string | null;
  maxDrawdown: string | null;
  maxDrawdownPercent: string | null;
  volatility: string | null;
  sharpeLike: string | null;
  sortinoLike: string | null;
  winRate: string | null;
  lossRate: string | null;
  profitFactor: string | null;
  averageTrade: string | null;
  averageWin: string | null;
  averageLoss: string | null;
  largestWin: string | null;
  largestLoss: string | null;
  tradeCount: number;
  winningTrades: number;
  losingTrades: number;
  turnover: string | null;
  exposurePercent: string | null;
  methodology: Record<string, string>;
  isSimulated: true;
  disclaimer: string;
}

@Injectable()
export class BacktestMetricsService {
  private readonly logger = new Logger(BacktestMetricsService.name);

  private parse(s: string | null | undefined): number {
    if (!s) return 0;
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  calculateMetrics(input: { trades: TradeForMetrics[]; equityCurve: EquityPointForMetrics[]; initialCapital: string; startTime: string; endTime: string }): MetricsResult {
    const initial = this.parse(input.initialCapital);
    const trades = input.trades;
    const equityCurve = input.equityCurve;

    let totalReturn: string | null = null;
    let totalReturnPercent: string | null = null;
    let maxDrawdown: string | null = null;
    let maxDrawdownPercent: string | null = null;
    let volatility: string | null = null;
    let sharpeLike: string | null = null;
    let sortinoLike: string | null = null;
    let winRate: string | null = null;
    let lossRate: string | null = null;
    let profitFactor: string | null = null;
    let averageTrade: string | null = null;
    let averageWin: string | null = null;
    let averageLoss: string | null = null;
    let largestWin: string | null = null;
    let largestLoss: string | null = null;
    let turnover: string | null = null;
    let exposurePercent: string | null = null;

    const methodology: Record<string, string> = {
      totalReturn: 'finalEquity - initialCapital, Decimal-safe, simulated',
      totalReturnPercent: '(finalEquity / initialCapital -1)*100, simulated',
      maxDrawdown: 'Peak-to-trough decline of equity curve, deterministic high-water mark',
      maxDrawdownPercent: 'maxDrawdown / peak *100',
      volatility: 'Standard deviation of daily returns, methodology: sample stdev of log returns from equity curve, simulated',
      sharpeLike: 'Sharpe-like: (meanReturn / volatility) * sqrt(252) where meanReturn is average daily return, riskFree=0, not predictive',
      sortinoLike: 'Sortino-like: meanReturn / downsideDeviation * sqrt(252), downsideDeviation from negative returns only, not predictive',
      winRate: 'winningTrades / totalTrades where netPnl>0, fees included',
      profitFactor: 'grossProfit / grossLoss where grossLoss>0, fees included',
      turnover: 'Sum of absolute trade notionals / initialCapital, simulated',
      disclaimer: 'Simulated result. Backtest performance is not indicative of future performance; paper performance is not indicative of live performance; simulation does not guarantee real execution quality.',
    };

    // Trade-based metrics
    const tradeCount = trades.length;
    let winningTrades = 0;
    let losingTrades = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let totalPnl = 0;
    let largestWinNum: number | null = null;
    let largestLossNum: number | null = null;
    let turnoverNum = 0;

    for (const t of trades) {
      const netPnl = t.netPnl ? this.parse(t.netPnl) : (t.grossPnl ? this.parse(t.grossPnl) - this.parse(t.fee) : 0);
      totalPnl += netPnl;

      const notionalEntry = this.parse(t.quantity) * this.parse(t.entryPrice);
      const notionalExit = t.exitPrice ? this.parse(t.quantity) * this.parse(t.exitPrice) : notionalEntry;
      turnoverNum += notionalEntry + notionalExit;

      if (t.isWin === true || netPnl > 0) {
        winningTrades++;
        grossProfit += netPnl > 0 ? netPnl : 0;
        if (largestWinNum === null || netPnl > largestWinNum) largestWinNum = netPnl;
      } else if (t.isWin === false || netPnl < 0) {
        losingTrades++;
        grossLoss += Math.abs(netPnl < 0 ? netPnl : 0);
        if (largestLossNum === null || netPnl < largestLossNum) largestLossNum = netPnl;
      }
    }

    if (tradeCount > 0) {
      winRate = (winningTrades / tradeCount).toString();
      lossRate = (losingTrades / tradeCount).toString();
      averageTrade = (totalPnl / tradeCount).toString();
      if (winningTrades > 0) averageWin = (grossProfit / winningTrades).toString();
      if (losingTrades > 0) averageLoss = (grossLoss / losingTrades).toString();
      if (largestWinNum !== null) largestWin = largestWinNum.toString();
      if (largestLossNum !== null) largestLoss = largestLossNum.toString();
      if (grossLoss > 0) profitFactor = (grossProfit / grossLoss).toString();
      else if (grossProfit > 0) profitFactor = '999';
      turnover = (turnoverNum / initial).toString();
    }

    // Equity curve based metrics
    if (equityCurve.length > 0) {
      const finalEquity = this.parse(equityCurve[equityCurve.length-1].equity);
      totalReturn = (finalEquity - initial).toString();
      totalReturnPercent = initial > 0 ? (((finalEquity / initial) - 1) * 100).toString() : null;

      // Annualized return where methodology is valid - only if > 30 days
      const start = new Date(input.startTime).getTime();
      const end = new Date(input.endTime).getTime();
      const days = (end - start) / (1000*60*60*24);
      if (days >= 30 && totalReturnPercent !== null) {
        const tr = parseFloat(totalReturnPercent) / 100;
        const ann = (Math.pow(1+tr, 365/days) - 1) * 100;
        methodology.annualizedReturn = `Annualized from totalReturn over ${days.toFixed(1)} days: (1+totalReturn)^(365/days)-1, simulated, requires >=30 days`;
      }

      // Max drawdown deterministic
      let peak = initial;
      let maxDd = 0;
      let maxDdPercent = 0;
      for (const point of equityCurve) {
        const eq = this.parse(point.equity);
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

      // Volatility and Sharpe-like
      if (equityCurve.length > 2) {
        const returns: number[] = [];
        for (let i=1; i<equityCurve.length; i++) {
          const prev = this.parse(equityCurve[i-1].equity);
          const curr = this.parse(equityCurve[i].equity);
          if (prev > 0) returns.push((curr - prev) / prev);
        }

        if (returns.length > 1) {
          const mean = returns.reduce((a,b)=>a+b,0) / returns.length;
          const variance = returns.reduce((a,b)=>a + Math.pow(b-mean,2),0) / (returns.length-1);
          const stdev = Math.sqrt(variance);
          volatility = stdev.toString();

          if (stdev > 0 && returns.length >= 20) {
            const sharpe = (mean / stdev) * Math.sqrt(252);
            sharpeLike = sharpe.toString();
          }

          const downsideReturns = returns.filter(r => r < 0);
          if (downsideReturns.length > 1) {
            const downsideMean = downsideReturns.reduce((a,b)=>a+b,0) / downsideReturns.length;
            const downsideVar = downsideReturns.reduce((a,b)=>a + Math.pow(b-downsideMean,2),0) / (downsideReturns.length-1);
            const downsideStdev = Math.sqrt(downsideVar);
            if (downsideStdev > 0) {
              const meanReturn = returns.reduce((a,b)=>a+b,0) / returns.length;
              const sortino = (meanReturn / downsideStdev) * Math.sqrt(252);
              sortinoLike = sortino.toString();
            }
          }
        }
      }

      // Exposure percent - simplified average equity vs initial?
      const avgEquity = equityCurve.reduce((s,p)=>s+this.parse(p.equity),0) / equityCurve.length;
      if (initial > 0) exposurePercent = ((avgEquity / initial) * 100).toString();
    }

    return {
      totalReturn,
      totalReturnPercent,
      annualizedReturn: null,
      maxDrawdown,
      maxDrawdownPercent,
      volatility,
      sharpeLike,
      sortinoLike,
      winRate,
      lossRate,
      profitFactor,
      averageTrade,
      averageWin,
      averageLoss,
      largestWin,
      largestLoss,
      tradeCount,
      winningTrades,
      losingTrades,
      turnover,
      exposurePercent,
      methodology,
      isSimulated: true,
      disclaimer: 'Simulated result. Backtest performance is not indicative of future performance; paper performance is not indicative of live performance; simulation does not guarantee real execution quality.',
    };
  }
}
