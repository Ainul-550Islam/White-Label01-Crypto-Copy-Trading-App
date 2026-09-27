import { Injectable, Logger } from '@nestjs/common';
import { BacktestRepository } from './backtest-repository';
import { ResearchRepository } from './research-repository';
import { MarketDataService } from './market-data-service';

/**
 * Compares strategy results against configured benchmarks using the same timeframe/dataset boundaries.
 * Use identical period boundaries and currency assumptions. Do not invent benchmark data.
 */
@Injectable()
export class StrategyBenchmarkService {
  private readonly logger = new Logger(StrategyBenchmarkService.name);

  constructor(
    private readonly backtestRepo: BacktestRepository,
    private readonly researchRepo: ResearchRepository,
    private readonly marketDataService: MarketDataService,
  ) {}

  async compareBenchmark(input: {
    tenantId: string;
    backtestRunId: string;
    benchmarkSymbol: string;
    benchmarkType?: 'BUY_AND_HOLD' | 'MARKET_INDEX';
    createdBy?: string | null;
  }): Promise<{ benchmarkSymbol: string; benchmarkReturn: string | null; strategyReturn: string | null; excessReturn: string | null; correlation: string | null; methodology: string; isSimulated: true }> {
    const backtestRun = await this.backtestRepo.findById(input.backtestRunId, input.tenantId);
    if (!backtestRun) throw new Error(`Backtest run ${input.backtestRunId} not found`);

    // Use identical period boundaries and currency assumptions
    const startTime = new Date(backtestRun.startTime).toISOString();
    const endTime = new Date(backtestRun.endTime).toISOString();
    const timeframe = backtestRun.timeframe;

    // Get benchmark data - do not invent benchmark data
    let benchmarkReturn: string | null = null;
    let benchmarkCandles: any[] = [];

    try {
      const benchmarkData = await this.marketDataService.getCandles({
        tenantId: input.tenantId,
        venue: 'BINANCE',
        symbol: input.benchmarkSymbol,
        timeframe,
        startTime,
        endTime,
      });

      benchmarkCandles = benchmarkData.candles;

      if (benchmarkCandles.length >= 2) {
        const firstClose = parseFloat(benchmarkCandles[0].close);
        const lastClose = parseFloat(benchmarkCandles[benchmarkCandles.length-1].close);
        if (firstClose > 0) {
          const ret = ((lastClose - firstClose) / firstClose) * 100;
          benchmarkReturn = ret.toString();
        }
      }
    } catch (e: any) {
      this.logger.warn(`Benchmark data unavailable symbol=${input.benchmarkSymbol} error=${e.message} - do not invent benchmark data`);
      throw new Error(`Benchmark data unavailable for ${input.benchmarkSymbol} from ${startTime} to ${endTime}: ${e.message}. Do not invent benchmark data.`);
    }

    const strategyReturn = backtestRun.metrics ? (backtestRun.metrics as any).totalReturnPercent || (backtestRun.metrics as any).totalReturn || null : null;

    let excessReturn: string | null = null;
    if (benchmarkReturn !== null && strategyReturn !== null) {
      const b = parseFloat(benchmarkReturn);
      const s = parseFloat(strategyReturn);
      if (!isNaN(b) && !isNaN(s)) excessReturn = (s - b).toString();
    }

    // Correlation - simplified
    let correlation: string | null = null;
    try {
      const snapshots = await this.backtestRepo.listSnapshots(input.tenantId, input.backtestRunId);
      if (snapshots.length > 1 && benchmarkCandles.length > 1) {
        // Align by timestamp and calculate correlation of returns
        const stratReturns: number[] = [];
        const benchReturns: number[] = [];

        for (let i=1; i<Math.min(snapshots.length, benchmarkCandles.length); i++) {
          const prevStrat = parseFloat(snapshots[i-1].equity);
          const currStrat = parseFloat(snapshots[i].equity);
          if (prevStrat > 0) stratReturns.push((currStrat - prevStrat) / prevStrat);

          const prevBench = parseFloat(benchmarkCandles[i-1].close);
          const currBench = parseFloat(benchmarkCandles[i].close);
          if (prevBench > 0) benchReturns.push((currBench - prevBench) / prevBench);
        }

        if (stratReturns.length > 2 && benchReturns.length === stratReturns.length) {
          const meanStrat = stratReturns.reduce((a,b)=>a+b,0) / stratReturns.length;
          const meanBench = benchReturns.reduce((a,b)=>a+b,0) / benchReturns.length;
          let num = 0, denStrat = 0, denBench = 0;
          for (let i=0; i<stratReturns.length; i++) {
            num += (stratReturns[i] - meanStrat) * (benchReturns[i] - meanBench);
            denStrat += Math.pow(stratReturns[i] - meanStrat, 2);
            denBench += Math.pow(benchReturns[i] - meanBench, 2);
          }
          const den = Math.sqrt(denStrat * denBench);
          if (den > 0) correlation = (num / den).toString();
        }
      }
    } catch {}

    const methodology = `Benchmark comparison using identical period boundaries ${startTime} to ${endTime}, timeframe ${timeframe}, currency ${backtestRun.quoteCurrency}. Benchmark type ${input.benchmarkType || 'BUY_AND_HOLD'}. Do not invent benchmark data. Simulated result.`;

    this.logger.log(`Benchmark comparison completed tenant=${input.tenantId} backtest=${input.backtestRunId} benchmark=${input.benchmarkSymbol} strategyReturn=${strategyReturn} benchmarkReturn=${benchmarkReturn}`);

    return {
      benchmarkSymbol: input.benchmarkSymbol,
      benchmarkReturn,
      strategyReturn,
      excessReturn,
      correlation,
      methodology,
      isSimulated: true,
    };
  }
}
