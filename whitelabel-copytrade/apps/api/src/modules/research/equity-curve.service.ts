import { Injectable, Logger } from '@nestjs/common';

/**
 * Builds deterministic equity/drawdown/time-series curves and benchmark comparison from backtest portfolio events.
 * Output must be reproducible and deterministic.
 */

export interface EquitySnapshot {
  timestamp: string;
  sequence: number;
  equity: string;
  cash: string;
  exposure: string | null;
  realizedPnl: string;
  unrealizedPnl: string | null;
}

export interface EquityCurvePoint {
  timestamp: string;
  sequence: number;
  equity: string;
  cash: string;
  exposure: string | null;
  realizedPnl: string;
  unrealizedPnl: string | null;
  drawdown: string | null;
  highWaterMark: string;
  dailyReturn: string | null;
  isSimulated: true;
}

@Injectable()
export class EquityCurveService {
  private readonly logger = new Logger(EquityCurveService.name);

  private parse(s: string): number { const n = parseFloat(s); return isNaN(n) ? 0 : n; }

  buildCurve(snapshots: EquitySnapshot[], initialCapital: string): EquityCurvePoint[] {
    const sorted = [...snapshots].sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const curve: EquityCurvePoint[] = [];
    let highWaterMark = this.parse(initialCapital);
    let prevEquity = this.parse(initialCapital);

    for (const snap of sorted) {
      const equity = this.parse(snap.equity);
      if (equity > highWaterMark) highWaterMark = equity;

      const drawdown = highWaterMark - equity;
      const dailyReturn = prevEquity > 0 ? ((equity - prevEquity) / prevEquity).toString() : null;

      curve.push({
        timestamp: snap.timestamp,
        sequence: snap.sequence,
        equity: snap.equity,
        cash: snap.cash,
        exposure: snap.exposure,
        realizedPnl: snap.realizedPnl,
        unrealizedPnl: snap.unrealizedPnl,
        drawdown: drawdown > 0 ? drawdown.toString() : '0',
        highWaterMark: highWaterMark.toString(),
        dailyReturn,
        isSimulated: true,
      });

      prevEquity = equity;
    }

    this.logger.log(`Equity curve built points=${curve.length} initial=${initialCapital} final=${curve[curve.length-1]?.equity || initialCapital} maxDrawdown=${Math.max(...curve.map(c=>parseFloat(c.drawdown||'0')))}`);

    return curve;
  }

  calculateDrawdownCurve(curve: EquityCurvePoint[]): { timestamp: string; drawdown: string; drawdownPercent: string; highWaterMark: string }[] {
    return curve.map(p => ({
      timestamp: p.timestamp,
      drawdown: p.drawdown || '0',
      drawdownPercent: parseFloat(p.highWaterMark) > 0 ? ((parseFloat(p.drawdown||'0') / parseFloat(p.highWaterMark)) * 100).toString() : '0',
      highWaterMark: p.highWaterMark,
    }));
  }

  calculateDailyReturns(curve: EquityCurvePoint[]): { timestamp: string; return: string; cumulativeReturn: string }[] {
    const result: { timestamp: string; return: string; cumulativeReturn: string }[] = [];
    if (curve.length === 0) return result;

    const initial = parseFloat(curve[0].equity);
    for (let i=0; i<curve.length; i++) {
      const curr = parseFloat(curve[i].equity);
      const prev = i>0 ? parseFloat(curve[i-1].equity) : initial;
      const ret = prev > 0 ? ((curr - prev) / prev) : 0;
      const cum = initial > 0 ? ((curr - initial) / initial) : 0;
      result.push({ timestamp: curve[i].timestamp, return: ret.toString(), cumulativeReturn: cum.toString() });
    }
    return result;
  }

  compareWithBenchmark(curve: EquityCurvePoint[], benchmarkCurve: { timestamp: string; value: string }[]): { timestamp: string; strategyEquity: string; benchmarkValue: string; excessReturn: string }[] {
    const benchmarkMap = new Map<string, number>();
    for (const b of benchmarkCurve) benchmarkMap.set(new Date(b.timestamp).toISOString().split('T')[0], parseFloat(b.value));

    const result: { timestamp: string; strategyEquity: string; benchmarkValue: string; excessReturn: string }[] = [];

    for (const point of curve) {
      const day = new Date(point.timestamp).toISOString().split('T')[0];
      const bench = benchmarkMap.get(day);
      if (bench !== undefined) {
        const strat = parseFloat(point.equity);
        const excess = strat - bench;
        result.push({ timestamp: point.timestamp, strategyEquity: point.equity, benchmarkValue: bench.toString(), excessReturn: excess.toString() });
      }
    }

    return result;
  }
}
