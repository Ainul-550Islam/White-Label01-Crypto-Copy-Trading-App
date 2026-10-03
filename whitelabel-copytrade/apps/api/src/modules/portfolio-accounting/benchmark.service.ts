import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AccountingPolicyService } from './accounting-policy.service';
import { deterministicIdempotencyKey, redactSecrets, add, sub, mul, div } from './portfolio-accounting.types';

/**
 * Manages benchmark definitions and observations using verified market/index data, never fabricated.
 * Calculates alpha vs benchmark.
 */

@Injectable()
export class BenchmarkService {
  private readonly logger = new Logger(BenchmarkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: AccountingPolicyService,
  ) {}

  async defineBenchmark(params: {
    tenantId: string;
    profileId: string;
    benchmarkId: string;
    name: string;
    description?: string | null;
    source: string;
    baseCurrency: string;
  }): Promise<any> {
    // Benchmark definition stored in evidence/metadata — for now return definition
    // In full implementation, would have Benchmark model, but we reuse existing structure
    const policy = await this.policyService.resolvePolicy({ tenantId: params.tenantId, scope: 'TENANT' as any, scopeId: params.profileId });
    return {
      benchmarkId: params.benchmarkId,
      name: params.name,
      description: params.description ?? null,
      source: params.source,
      baseCurrency: params.baseCurrency ?? policy.baseCurrency,
      calculationVersion: policy.calculationVersion,
      policyVersion: policy.policyVersion,
    };
  }

  /** Candle intervals in order of preference for a benchmark series. */
  private static readonly SERIES_INTERVALS: readonly string[] = ['1d', '4h', '1h', '15m', '5m', '1m'];

  /**
   * One venue/interval series out of mixed candle rows. Interleaving a 1m and
   * a 1d series (or two venues) would fabricate returns between unrelated
   * closes, so exactly one series is kept: the most preferred interval, and
   * within it the venue with the most observations. Input order is kept.
   */
  static pickSeries<T extends { venue: string; interval: string }>(rows: readonly T[]): T[] {
    if (rows.length === 0) {
      return [];
    }
    const groups = new Map<string, T[]>();
    for (const row of rows) {
      const key = `${row.venue}|${row.interval}`;
      const group = groups.get(key);
      if (group === undefined) {
        groups.set(key, [row]);
      } else {
        group.push(row);
      }
    }
    const rank = (interval: string): number => {
      const i = BenchmarkService.SERIES_INTERVALS.indexOf(interval);
      return i === -1 ? BenchmarkService.SERIES_INTERVALS.length : i;
    };
    let best: T[] | null = null;
    for (const group of groups.values()) {
      if (best === null) {
        best = group;
        continue;
      }
      const g = rank((group[0] as T).interval);
      const b = rank((best[0] as T).interval);
      if (g < b || (g === b && group.length > best.length)) {
        best = group;
      }
    }
    return best ?? [];
  }

  async getBenchmarkObservations(params: {
    tenantId: string;
    benchmarkId: string;
    from: Date;
    to: Date;
  }): Promise<Array<{ timestamp: Date; value: string; source: string }>> {
    // Must use verified market/index data: MarketDataRecord candles, keyed by
    // symbol (benchmarkId is a symbol such as BTCUSDT). No such data -> [].
    const rows = await this.prisma.marketDataRecord.findMany({
      where: { symbol: params.benchmarkId, closeTime: { gte: params.from, lte: params.to } },
      orderBy: { closeTime: 'asc' },
      select: { close: true, closeTime: true, venue: true, interval: true },
    });

    const series = BenchmarkService.pickSeries(rows);
    if (series.length > 0) {
      return series.map((p) => ({
        timestamp: p.closeTime,
        value: p.close.toString(),
        source: `MARKET_DATA:${p.venue}:${p.interval}`,
      }));
    }

    // No benchmark data — explicit, not fabricated
    return [];
  }

  async calculateBenchmarkReturn(params: {
    tenantId: string;
    profileId: string;
    benchmarkId: string;
    periodStart: Date;
    periodEnd: Date;
    baseCurrency?: string;
  }): Promise<{ returnPercent: string | null; evidence: any; canCalculate: boolean }> {
    const observations = await this.getBenchmarkObservations({
      tenantId: params.tenantId,
      benchmarkId: params.benchmarkId,
      from: params.periodStart,
      to: params.periodEnd,
    });

    const policy = await this.policyService.resolvePolicy({ tenantId: params.tenantId, scope: 'TENANT' as any, scopeId: params.profileId });

    if (observations.length < 2) {
      return {
        returnPercent: null,
        canCalculate: false,
        evidence: {
          benchmarkId: params.benchmarkId,
          periodStart: params.periodStart.toISOString(),
          periodEnd: params.periodEnd.toISOString(),
          observationsCount: observations.length,
          returnPercent: null,
          calculationVersion: policy.calculationVersion,
          policyVersion: policy.policyVersion,
          dataCompleteness: 'MISSING_BENCHMARK_OBSERVATIONS',
          sourceReferences: [],
        },
      };
    }

    const startValue = observations[0].value;
    const endValue = observations[observations.length - 1].value;

    try {
      const ratio = div(endValue, startValue);
      const ret = mul(sub(ratio, '1'), '100');
      return {
        returnPercent: ret,
        canCalculate: true,
        evidence: {
          benchmarkId: params.benchmarkId,
          periodStart: params.periodStart.toISOString(),
          periodEnd: params.periodEnd.toISOString(),
          startValue,
          endValue,
          observationsCount: observations.length,
          returnPercent: ret,
          calculationVersion: policy.calculationVersion,
          policyVersion: policy.policyVersion,
          dataCompleteness: 'COMPLETE',
          sourceReferences: [...new Set(observations.map((o) => o.source))],
        },
      };
    } catch {
      return {
        returnPercent: null,
        canCalculate: false,
        evidence: {
          benchmarkId: params.benchmarkId,
          periodStart: params.periodStart.toISOString(),
          periodEnd: params.periodEnd.toISOString(),
          observationsCount: observations.length,
          returnPercent: null,
          calculationVersion: policy.calculationVersion,
          policyVersion: policy.policyVersion,
          dataCompleteness: 'CALCULATION_FAILED',
          sourceReferences: [],
        },
      };
    }
  }

  async calculateAlpha(params: {
    tenantId: string;
    profileId: string;
    portfolioReturn: string | null;
    benchmarkReturn: string | null;
    benchmarkId: string;
  }): Promise<{ alpha: string | null; evidence: any }> {
    if (params.portfolioReturn === null || params.benchmarkReturn === null) {
      return { alpha: null, evidence: { benchmarkId: params.benchmarkId, portfolioReturn: params.portfolioReturn, benchmarkReturn: params.benchmarkReturn, alpha: null, dataCompleteness: 'MISSING_OBSERVATIONS' } };
    }

    try {
      const alpha = sub(params.portfolioReturn, params.benchmarkReturn);
      return {
        alpha,
        evidence: {
          benchmarkId: params.benchmarkId,
          portfolioReturn: params.portfolioReturn,
          benchmarkReturn: params.benchmarkReturn,
          alpha,
          dataCompleteness: 'COMPLETE',
        },
      };
    } catch {
      return { alpha: null, evidence: { benchmarkId: params.benchmarkId, alpha: null, dataCompleteness: 'CALCULATION_FAILED' } };
    }
  }
}
