import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ResearchRepository } from './research-repository';
import { ResearchPolicyService } from './research-policy.service';
import { createHash, randomUUID } from 'crypto';

/**
 * Resolves and validates backtest configuration: strategy version, symbols, timeframe, dates, capital, fees, slippage, leverage, benchmark, and execution assumptions.
 * Do not allow client to inject arbitrary executable strategy code.
 */
@Injectable()
export class BacktestConfigService {
  private readonly logger = new Logger(BacktestConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly researchRepo: ResearchRepository,
    private readonly policyService: ResearchPolicyService,
  ) {}

  private isDecimalString(value: string): boolean {
    return /^-?\d+(\.\d+)?$/.test(value.trim());
  }

  private fingerprintConfig(config: Record<string, any>): string {
    const hash = createHash('sha256');
    hash.update(JSON.stringify(config, Object.keys(config).sort()));
    return hash.digest('hex');
  }

  async validateAndResolve(input: {
    tenantId: string;
    strategyVersionId: string;
    symbols: string[];
    timeframe: string;
    startTime: string;
    endTime: string;
    initialCapital: string;
    quoteCurrency?: string;
    feeAssumption?: Record<string, any>;
    slippageAssumption?: Record<string, any>;
    latencyAssumption?: Record<string, any>;
    leverage?: string | null;
    benchmark?: string | null;
    executionModel?: Record<string, any>;
    datasetId?: string | null;
    datasetFingerprint?: string | null;
  }): Promise<{ valid: boolean; errors: string[]; config: Record<string, any>; fingerprint: string; runIdentifier: string }> {
    const errors: string[] = [];

    // Strategy version must exist and be at least VALID
    const strategyVersion = await this.researchRepo.findStrategyVersionById(input.strategyVersionId, input.tenantId);
    if (!strategyVersion) errors.push(`Strategy version ${input.strategyVersionId} not found for tenant ${input.tenantId}`);
    else if (!['VALID','FROZEN','PUBLISHED'].includes(strategyVersion.status)) errors.push(`Strategy version must be VALID/FROZEN/PUBLISHED to backtest, current=${strategyVersion.status}`);

    // Symbols validation
    const symbolsValidation = await this.policyService.validateSymbols(input.tenantId, input.symbols);
    if (!symbolsValidation.valid) errors.push(symbolsValidation.reason!);

    // Timeframe validation
    const timeframeValid = await this.policyService.validateTimeframe(input.tenantId, input.timeframe);
    if (!timeframeValid) errors.push(`Timeframe ${input.timeframe} not allowed`);

    // Lookback validation
    const lookbackValidation = await this.policyService.validateLookback(input.tenantId, input.startTime, input.endTime);
    if (!lookbackValidation.valid) errors.push(lookbackValidation.reason!);

    // Initial capital Decimal-safe
    if (!this.isDecimalString(input.initialCapital)) errors.push('initialCapital must be valid decimal string');
    else if (parseFloat(input.initialCapital) <= 0) errors.push('initialCapital must be positive');

    // Fee assumption validation
    if (input.feeAssumption) {
      if (input.feeAssumption.makerFeeRate && !this.isDecimalString(input.feeAssumption.makerFeeRate.toString())) errors.push('makerFeeRate must be decimal string');
      if (input.feeAssumption.takerFeeRate && !this.isDecimalString(input.feeAssumption.takerFeeRate.toString())) errors.push('takerFeeRate must be decimal string');
      const maker = parseFloat(input.feeAssumption.makerFeeRate || '0');
      const taker = parseFloat(input.feeAssumption.takerFeeRate || '0');
      if (maker < 0 || maker > 1) errors.push('makerFeeRate must be 0-1');
      if (taker < 0 || taker > 1) errors.push('takerFeeRate must be 0-1');
    }

    // Slippage assumption
    if (input.slippageAssumption) {
      if (input.slippageAssumption.slippageBps !== undefined) {
        const bps = parseFloat(input.slippageAssumption.slippageBps);
        if (isNaN(bps) || bps < 0 || bps > 10000) errors.push('slippageBps must be 0-10000');
      }
    }

    // Leverage
    if (input.leverage && !this.isDecimalString(input.leverage)) errors.push('leverage must be decimal string');

    // Execution model - do not allow executable code
    if (input.executionModel) {
      const forbidden = ['eval','exec','Function','code','script'];
      const str = JSON.stringify(input.executionModel).toLowerCase();
      for (const f of forbidden) {
        if (str.includes(f.toLowerCase())) errors.push(`executionModel contains forbidden reference ${f}`);
      }
    }

    // Dataset validation if provided
    if (input.datasetId) {
      const dataset = await this.researchRepo.findDatasetById(input.datasetId, input.tenantId);
      if (!dataset) errors.push(`Dataset ${input.datasetId} not found`);
      else if (dataset.status !== 'VALID') errors.push(`Dataset must be VALID, current=${dataset.status}`);
    }

    const config = {
      strategyVersionId: input.strategyVersionId,
      symbols: input.symbols,
      timeframe: input.timeframe,
      startTime: input.startTime,
      endTime: input.endTime,
      initialCapital: input.initialCapital,
      quoteCurrency: input.quoteCurrency || 'USDT',
      feeAssumption: input.feeAssumption || { makerFeeRate: '0.001', takerFeeRate: '0.001' },
      slippageAssumption: input.slippageAssumption || { slippageBps: 5 },
      latencyAssumption: input.latencyAssumption || { latencyMs: 100 },
      leverage: input.leverage || null,
      benchmark: input.benchmark || null,
      executionModel: input.executionModel || { type: 'MARKET', partialFills: true },
      datasetId: input.datasetId || null,
      datasetFingerprint: input.datasetFingerprint || null,
      strategyFingerprint: strategyVersion?.fingerprint || null,
    };

    const fingerprint = this.fingerprintConfig(config);
    const runIdentifier = `bt_${fingerprint.substring(0,24)}_${randomUUID().substring(0,8)}`;

    const valid = errors.length === 0;

    this.logger.log(`Backtest config validated tenant=${input.tenantId} strategyVersion=${input.strategyVersionId} valid=${valid} errors=${errors.length} fingerprint=${fingerprint}`);

    return { valid, errors, config, fingerprint, runIdentifier };
  }
}
