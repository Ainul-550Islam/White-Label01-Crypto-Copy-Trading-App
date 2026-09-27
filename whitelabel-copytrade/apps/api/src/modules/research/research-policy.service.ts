import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface ResearchPolicy {
  maxHistoricalLookbackDays: number;
  allowedTimeframes: string[];
  maxSymbolsPerRun: number;
  maxBacktestConcurrency: number;
  maxParameterCombinations: number;
  paperTradingMinimumDurationMinutes: number;
  requiredOutOfSampleValidation: boolean;
  minimumDataQualityScore: number;
  maxDatasetSizeRecords: number;
  promotionPrerequisites: {
    requireBacktest: boolean;
    requireOutOfSample: boolean;
    requirePaperTrading: boolean;
    requireRiskReview: boolean;
    requireComplianceReview: boolean;
    minPaperTradingDurationMinutes: number;
    minBacktestTradeCount: number;
  };
  allowedVenues: string[];
  maxWalkForwardWindows: number;
  maxMonteCarloIterations: number;
}

/**
 * Resolves research limits/policies: maximum lookback, allowed timeframes, dataset restrictions, backtest concurrency, paper-trading requirements, and promotion conditions.
 */
@Injectable()
export class ResearchPolicyService {
  private readonly logger = new Logger(ResearchPolicyService.name);

  private readonly defaultPolicy: ResearchPolicy = {
    maxHistoricalLookbackDays: 365 * 2,
    allowedTimeframes: ['1m','3m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','3d','1w'],
    maxSymbolsPerRun: 10,
    maxBacktestConcurrency: 5,
    maxParameterCombinations: 100,
    paperTradingMinimumDurationMinutes: 60,
    requiredOutOfSampleValidation: true,
    minimumDataQualityScore: 0.7,
    maxDatasetSizeRecords: 1000000,
    promotionPrerequisites: {
      requireBacktest: true,
      requireOutOfSample: true,
      requirePaperTrading: false,
      requireRiskReview: true,
      requireComplianceReview: true,
      minPaperTradingDurationMinutes: 1440,
      minBacktestTradeCount: 20,
    },
    allowedVenues: ['BINANCE','BYBIT','OKX','KRAKEN','PAPER'],
    maxWalkForwardWindows: 20,
    maxMonteCarloIterations: 10000,
  };

  constructor(private readonly prisma: PrismaService) {}

  async getPolicy(tenantId: string): Promise<ResearchPolicy> {
    try {
      const setting = await this.prisma.tenantSetting.findFirst({ where: { tenantId, key: 'research_policy' } });
      if (setting && setting.value) {
        const override = setting.value as Partial<ResearchPolicy>;
        return { ...this.defaultPolicy, ...override, promotionPrerequisites: { ...this.defaultPolicy.promotionPrerequisites, ...(override.promotionPrerequisites || {}) } };
      }
    } catch {}
    return this.defaultPolicy;
  }

  async validateTimeframe(tenantId: string, timeframe: string): Promise<boolean> {
    const policy = await this.getPolicy(tenantId);
    return policy.allowedTimeframes.includes(timeframe);
  }

  async validateSymbols(tenantId: string, symbols: string[]): Promise<{ valid: boolean; reason?: string }> {
    const policy = await this.getPolicy(tenantId);
    if (symbols.length > policy.maxSymbolsPerRun) return { valid: false, reason: `Max symbols per run ${policy.maxSymbolsPerRun} exceeded: ${symbols.length}` };
    if (symbols.length === 0) return { valid: false, reason: 'At least one symbol required' };
    return { valid: true };
  }

  async validateLookback(tenantId: string, startTime: string, endTime: string): Promise<{ valid: boolean; reason?: string }> {
    const policy = await this.getPolicy(tenantId);
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();
    if (isNaN(start) || isNaN(end)) return { valid: false, reason: 'Invalid start/end time' };
    if (start >= end) return { valid: false, reason: 'Start must be before end' };
    const days = (end - start) / (1000*60*60*24);
    if (days > policy.maxHistoricalLookbackDays) return { valid: false, reason: `Lookback ${days.toFixed(1)} days exceeds max ${policy.maxHistoricalLookbackDays}` };
    return { valid: true };
  }

  async validateDatasetQuality(tenantId: string, qualityScore: number | null): Promise<{ valid: boolean; reason?: string }> {
    const policy = await this.getPolicy(tenantId);
    if (qualityScore === null) return { valid: false, reason: 'Dataset quality score missing' };
    if (qualityScore < policy.minimumDataQualityScore) return { valid: false, reason: `Quality score ${qualityScore} below minimum ${policy.minimumDataQualityScore}` };
    return { valid: true };
  }
}
