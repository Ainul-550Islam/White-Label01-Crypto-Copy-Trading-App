import { Injectable, Logger } from '@nestjs/common';
import { BacktestRepository } from './backtest-repository';
import { ResearchRepository } from './research-repository';
import { ResearchPolicyService } from './research-policy.service';
import { randomUUID, createHash } from 'crypto';

/**
 * Runs configurable Monte Carlo/resampling analysis from actual backtest trades/returns without claiming probabilistic certainty.
 * Clearly label results as simulation/analysis. Do not present Monte Carlo outputs as guaranteed probabilities of future performance.
 */
@Injectable()
export class MonteCarloService {
  private readonly logger = new Logger(MonteCarloService.name);

  constructor(
    private readonly backtestRepo: BacktestRepository,
    private readonly researchRepo: ResearchRepository,
    private readonly policyService: ResearchPolicyService,
  ) {}

  private seededRandom(seed: string): () => number {
    let hash = 0;
    for (let i=0; i<seed.length; i++) hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    return () => {
      hash = (hash * 1664525 + 1013904223) % 4294967296;
      return (hash / 4294967296 + 1) / 2;
    };
  }

  async runMonteCarlo(input: {
    tenantId: string;
    backtestRunId: string;
    iterations: number;
    method: 'TRADE_ORDER_PERMUTATION' | 'RETURN_RESAMPLING' | 'DRAWDOWN_DISTRIBUTION';
    seed?: string | null;
    createdBy?: string | null;
    idempotencyKey?: string | null;
  }): Promise<{ percentiles: Record<string, string>; distribution: string[]; summary: Record<string, any> }> {
    const policy = await this.policyService.getPolicy(input.tenantId);
    if (input.iterations > policy.maxMonteCarloIterations) throw new Error(`Iterations ${input.iterations} exceeds max ${policy.maxMonteCarloIterations}`);
    if (input.iterations <= 0) throw new Error('Iterations must be positive');

    const backtestRun = await this.backtestRepo.findById(input.backtestRunId, input.tenantId);
    if (!backtestRun) throw new Error(`Backtest run ${input.backtestRunId} not found`);

    const tradesResult = await this.backtestRepo.listTrades(input.tenantId, input.backtestRunId, { page: 1, limit: 10000 });
    const trades = tradesResult.data;

    if (trades.length === 0) throw new Error('No trades available for Monte Carlo analysis');

    const seed = input.seed || randomUUID();
    const random = this.seededRandom(seed);

    const distribution: number[] = [];

    for (let i=0; i<input.iterations; i++) {
      let simulatedPnl = 0;

      if (input.method === 'TRADE_ORDER_PERMUTATION') {
        // Shuffle trade order
        const shuffled = [...trades].sort(() => random() - 0.5);
        for (const trade of shuffled) {
          const pnl = trade.netPnl ? parseFloat(trade.netPnl) : (trade.grossPnl ? parseFloat(trade.grossPnl) - parseFloat(trade.fee) : 0);
          simulatedPnl += pnl;
        }
      } else if (input.method === 'RETURN_RESAMPLING') {
        // Resample returns with replacement
        for (let j=0; j<trades.length; j++) {
          const idx = Math.floor(random() * trades.length);
          const trade = trades[idx];
          const pnl = trade.netPnl ? parseFloat(trade.netPnl) : 0;
          simulatedPnl += pnl;
        }
      } else if (input.method === 'DRAWDOWN_DISTRIBUTION') {
        // Simulate drawdown by cumulative sum of shuffled trades
        const shuffled = [...trades].sort(() => random() - 0.5);
        let peak = 0;
        let current = 0;
        let maxDd = 0;
        for (const trade of shuffled) {
          const pnl = trade.netPnl ? parseFloat(trade.netPnl) : 0;
          current += pnl;
          if (current > peak) peak = current;
          const dd = peak - current;
          if (dd > maxDd) maxDd = dd;
        }
        simulatedPnl = maxDd; // For drawdown distribution, we track max drawdown
      }

      distribution.push(simulatedPnl);
    }

    distribution.sort((a,b)=>a-b);

    const percentiles: Record<string, string> = {
      '5': distribution[Math.floor(distribution.length * 0.05)]?.toString() || '0',
      '25': distribution[Math.floor(distribution.length * 0.25)]?.toString() || '0',
      '50': distribution[Math.floor(distribution.length * 0.5)]?.toString() || '0',
      '75': distribution[Math.floor(distribution.length * 0.75)]?.toString() || '0',
      '95': distribution[Math.floor(distribution.length * 0.95)]?.toString() || '0',
      '99': distribution[Math.floor(distribution.length * 0.99)]?.toString() || '0',
    };

    const summary = {
      method: input.method,
      iterations: input.iterations,
      seed,
      tradeCount: trades.length,
      originalPnl: trades.reduce((s,t)=>s+(t.netPnl ? parseFloat(t.netPnl) : 0),0).toString(),
      mean: (distribution.reduce((a,b)=>a+b,0) / distribution.length).toString(),
      median: percentiles['50'],
      min: Math.min(...distribution).toString(),
      max: Math.max(...distribution).toString(),
      disclaimer: 'Monte Carlo simulation/analysis from actual backtest trades. Results are simulation, not guaranteed probabilities of future performance. Methodology: ' + input.method,
      isSimulated: true,
      isReproducible: !!input.seed,
    };

    await this.researchRepo.createAuditLog({
      tenantId: input.tenantId,
      event: 'MONTE_CARLO_COMPLETED',
      actorId: input.createdBy || null,
      backtestRunId: input.backtestRunId,
      result: 'SUCCESS',
      safeMetadata: { method: input.method, iterations: input.iterations, seed, tradeCount: trades.length },
    });

    this.logger.log(`Monte Carlo completed tenant=${input.tenantId} backtest=${input.backtestRunId} method=${input.method} iterations=${input.iterations} seed=${seed}`);

    return { percentiles, distribution: distribution.map(d=>d.toString()), summary };
  }
}
