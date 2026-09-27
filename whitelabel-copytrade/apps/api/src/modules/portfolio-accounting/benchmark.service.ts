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

  async getBenchmarkObservations(params: {
    tenantId: string;
    benchmarkId: string;
    from: Date;
    to: Date;
  }): Promise<Array<{ timestamp: Date; value: string; source: string }>> {
    // Must use verified market/index data — check MarketPrice, IndexPrice, etc.
    try {
      // Try to fetch from market data — benchmarkId could be symbol like BTCUSDT or index like SPX
      const prices = await (this.prisma as any).marketPrice?.findMany?.({
        where: { symbol: params.benchmarkId, timestamp: { gte: params.from, lte: params.to } },
        orderBy: { timestamp: 'asc' },
      });

      if (prices && prices.length > 0) {
        return prices.map((p: any) => ({
          timestamp: new Date(p.timestamp),
          value: p.price.toString(),
          source: p.source ?? 'MARKET_DATA',
        }));
      }

      // No benchmark data — explicit, not fabricated
      return [];
    } catch {
      return [];
    }
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
