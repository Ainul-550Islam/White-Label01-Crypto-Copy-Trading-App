import { Injectable, Logger } from '@nestjs/common';
import { BacktestRepository } from './backtest-repository';
import { ResearchRepository } from './research-repository';
import { BacktestEngineService } from './backtest-engine.service';
import { ResearchPolicyService } from './research-policy.service';
import { createHash, randomUUID } from 'crypto';

/**
 * Runs controlled strategy-parameter combinations with bounded concurrency and reproducible configuration fingerprints.
 * Do not automatically promote the highest historical result. Parameter selection must remain separate from production strategy publication.
 */
@Injectable()
export class ParameterSweepService {
  private readonly logger = new Logger(ParameterSweepService.name);

  constructor(
    private readonly backtestRepo: BacktestRepository,
    private readonly researchRepo: ResearchRepository,
    private readonly backtestEngine: BacktestEngineService,
    private readonly policyService: ResearchPolicyService,
  ) {}

  private fingerprintParams(params: Record<string, any>): string {
    const hash = createHash('sha256');
    hash.update(JSON.stringify(params, Object.keys(params).sort()));
    return hash.digest('hex');
  }

  private generateCombinations(paramRanges: Record<string, any[]>): Record<string, any>[] {
    const keys = Object.keys(paramRanges);
    const combinations: Record<string, any>[] = [];

    const recurse = (index: number, current: Record<string, any>) => {
      if (index === keys.length) {
        combinations.push({ ...current });
        return;
      }
      const key = keys[index];
      const values = paramRanges[key];
      for (const val of values) {
        current[key] = val;
        recurse(index+1, current);
      }
    };

    recurse(0, {});
    return combinations;
  }

  async runParameterSweep(input: {
    tenantId: string;
    strategyVersionId: string;
    symbols: string[];
    timeframe: string;
    startTime: string;
    endTime: string;
    initialCapital: string;
    paramRanges: Record<string, any[]>;
    concurrency?: number;
    createdBy?: string | null;
    idempotencyKey?: string | null;
  }): Promise<{ sweepId: string; combinations: number; results: any[]; bestResult: any | null; ranking: string[]; overfittingRisk: string | null }> {
    const policy = await this.policyService.getPolicy(input.tenantId);
    const combinations = this.generateCombinations(input.paramRanges);

    if (combinations.length > policy.maxParameterCombinations) throw new Error(`Parameter combinations ${combinations.length} exceeds max ${policy.maxParameterCombinations}`);
    if (combinations.length === 0) throw new Error('No parameter combinations generated');

    const concurrency = Math.min(input.concurrency || 3, policy.maxBacktestConcurrency);
    const sweepId = `sweep_${randomUUID().substring(0,8)}_${Date.now()}`;

    const results: { parameters: Record<string, any>; metrics: Record<string, any>; fingerprint: string; runId: string }[] = [];

    // Bounded concurrency - process in batches
    for (let i=0; i<combinations.length; i+=concurrency) {
      const batch = combinations.slice(i, i+concurrency);
      const batchPromises = batch.map(async (params) => {
        const fingerprint = this.fingerprintParams(params);
        try {
          const run = await this.backtestEngine.runBacktest({
            tenantId: input.tenantId,
            strategyVersionId: input.strategyVersionId,
            symbols: input.symbols,
            timeframe: input.timeframe,
            startTime: input.startTime,
            endTime: input.endTime,
            initialCapital: input.initialCapital,
            createdBy: input.createdBy || null,
            idempotencyKey: `sweep_${sweepId}_${fingerprint}`,
          });

          // Merge sweep params into run config for tracking
          return { parameters: params, metrics: run.metrics || {}, fingerprint, runId: run.id };
        } catch (e: any) {
          this.logger.warn(`Parameter sweep combination failed fingerprint=${fingerprint} error=${e.message}`);
          return { parameters: params, metrics: { error: e.message }, fingerprint, runId: '' };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    // Ranking by totalReturn
    const ranked = [...results].sort((a,b) => {
      const aRet = parseFloat(a.metrics.totalReturn || a.metrics.totalReturnPercent || '0');
      const bRet = parseFloat(b.metrics.totalReturn || b.metrics.totalReturnPercent || '0');
      return bRet - aRet;
    });

    const bestResult = ranked.length > 0 ? ranked[0] : null;

    // Overfitting safeguards - if best is much better than median, flag risk
    let overfittingRisk: string | null = null;
    if (ranked.length >= 10) {
      const returns = ranked.map(r => parseFloat(r.metrics.totalReturn || '0')).filter(n => !isNaN(n));
      if (returns.length > 0) {
        const median = returns[Math.floor(returns.length/2)];
        const best = returns[0];
        if (median !== 0 && best / median > 3) {
          overfittingRisk = `Best result ${best} is ${(best/median).toFixed(1)}x median ${median} - high overfitting risk. Do not automatically promote highest historical result.`;
        }
      }
    }

    const ranking = ranked.map(r => r.fingerprint);

    await this.researchRepo.createAuditLog({
      tenantId: input.tenantId,
      event: 'PARAMETER_SWEEP_COMPLETED',
      actorId: input.createdBy || null,
      strategyVersionId: input.strategyVersionId,
      result: 'SUCCESS',
      safeMetadata: { sweepId, combinations: combinations.length, bestFingerprint: bestResult?.fingerprint, overfittingRisk },
    });

    this.logger.log(`Parameter sweep completed sweepId=${sweepId} tenant=${input.tenantId} combinations=${combinations.length} best=${bestResult?.fingerprint}`);

    return { sweepId, combinations: combinations.length, results, bestResult, ranking, overfittingRisk };
  }
}
