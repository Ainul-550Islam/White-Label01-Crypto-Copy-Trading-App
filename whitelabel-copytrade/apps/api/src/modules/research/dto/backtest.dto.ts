import { IsString, IsOptional, IsArray, IsObject, IsNotEmpty, MaxLength, Matches, IsNumber, Min, Max, IsEnum, ArrayMaxSize, ValidateIf } from 'class-validator';
import { ResearchSignalSide } from '../signal.types';

export class CreateDatasetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsString()
  @IsNotEmpty()
  venue!: string;

  @IsString()
  @IsNotEmpty()
  symbol!: string;

  @IsString()
  @IsNotEmpty()
  timeframe!: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsString()
  @IsNotEmpty()
  source!: string;

  @IsOptional()
  @IsObject()
  sourceMetadata?: Record<string, any>;

  @IsString()
  @IsNotEmpty()
  startTime!: string;

  @IsString()
  @IsNotEmpty()
  endTime!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  idempotencyKey?: string | null;
}

export class CreateStrategyVersionDto {
  @IsOptional()
  @IsString()
  strategyId?: string | null;

  @IsOptional()
  @IsString()
  traderStrategyId?: string | null;

  @IsOptional()
  @IsString()
  definitionId?: string | null;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+\.\d+\.\d+$/, { message: 'version must be semver x.y.z' })
  version!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsObject()
  parameters!: Record<string, any>;

  @IsOptional()
  @IsObject()
  riskProfile?: Record<string, any>;

  @IsOptional()
  @IsObject()
  executionModel?: Record<string, any>;

  @IsOptional()
  @IsObject()
  logic?: Record<string, any>;

  @IsOptional()
  @IsString()
  parentVersionId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  changeNote?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  idempotencyKey?: string | null;
}

export class CreateBacktestDto {
  @IsString()
  @IsNotEmpty()
  strategyVersionId!: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  symbols!: string[];

  @IsString()
  @IsNotEmpty()
  timeframe!: string;

  @IsString()
  @IsNotEmpty()
  startTime!: string;

  @IsString()
  @IsNotEmpty()
  endTime!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'initialCapital must be valid decimal string' })
  @MaxLength(64)
  initialCapital!: string;

  @IsOptional()
  @IsString()
  quoteCurrency?: string;

  @IsOptional()
  @IsObject()
  feeAssumption?: Record<string, any>;

  @IsOptional()
  @IsObject()
  slippageAssumption?: Record<string, any>;

  @IsOptional()
  @IsObject()
  latencyAssumption?: Record<string, any>;

  @IsOptional()
  @IsString()
  leverage?: string | null;

  @IsOptional()
  @IsString()
  benchmark?: string | null;

  @IsOptional()
  @IsObject()
  executionModel?: Record<string, any>;

  @IsOptional()
  @IsString()
  datasetId?: string | null;

  @IsOptional()
  @IsString()
  datasetFingerprint?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  idempotencyKey?: string | null;
}

export class WalkForwardDto {
  @IsString()
  @IsNotEmpty()
  strategyVersionId!: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  symbols!: string[];

  @IsString()
  @IsNotEmpty()
  timeframe!: string;

  @IsString()
  @IsNotEmpty()
  startTime!: string;

  @IsString()
  @IsNotEmpty()
  endTime!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'initialCapital must be valid decimal string' })
  initialCapital!: string;

  @IsNumber()
  @Min(1)
  @Max(365)
  trainingWindowDays!: number;

  @IsNumber()
  @Min(1)
  @Max(365)
  testingWindowDays!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(365)
  validationWindowDays?: number;

  @IsEnum(['ROLLING','EXPANDING'] as any)
  mode!: 'ROLLING' | 'EXPANDING';

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(365)
  stepDays?: number;

  @IsOptional()
  @IsString()
  idempotencyKey?: string | null;
}

export class MonteCarloDto {
  @IsString()
  @IsNotEmpty()
  backtestRunId!: string;

  @IsNumber()
  @Min(10)
  @Max(10000)
  iterations!: number;

  @IsEnum(['TRADE_ORDER_PERMUTATION','RETURN_RESAMPLING','DRAWDOWN_DISTRIBUTION'] as any)
  method!: 'TRADE_ORDER_PERMUTATION' | 'RETURN_RESAMPLING' | 'DRAWDOWN_DISTRIBUTION';

  @IsOptional()
  @IsString()
  seed?: string | null;

  @IsOptional()
  @IsString()
  idempotencyKey?: string | null;
}

export class ParameterSweepDto {
  @IsString()
  @IsNotEmpty()
  strategyVersionId!: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  symbols!: string[];

  @IsString()
  @IsNotEmpty()
  timeframe!: string;

  @IsString()
  @IsNotEmpty()
  startTime!: string;

  @IsString()
  @IsNotEmpty()
  endTime!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'initialCapital must be valid decimal string' })
  initialCapital!: string;

  @IsObject()
  paramRanges!: Record<string, any[]>;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10)
  concurrency?: number;

  @IsOptional()
  @IsString()
  idempotencyKey?: string | null;
}

export class BenchmarkDto {
  @IsString()
  @IsNotEmpty()
  backtestRunId!: string;

  @IsString()
  @IsNotEmpty()
  benchmarkSymbol!: string;

  @IsOptional()
  @IsString()
  benchmarkType?: 'BUY_AND_HOLD' | 'MARKET_INDEX';
}

export class CreatePaperSessionDto {
  @IsString()
  @IsNotEmpty()
  strategyVersionId!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'initialCapital must be valid decimal string' })
  initialCapital!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  symbols?: string[];

  @IsOptional()
  @IsString()
  timeframe?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, any>;

  @IsOptional()
  @IsString()
  expiresAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  idempotencyKey?: string | null;
}

export class CreatePaperOrderDto {
  @IsString()
  @IsNotEmpty()
  sessionId!: string;

  @IsString()
  @IsNotEmpty()
  symbol!: string;

  @IsEnum(['BUY','SELL'] as any)
  side!: 'BUY' | 'SELL';

  @IsEnum(['MARKET','LIMIT','STOP','STOP_LIMIT'] as any)
  type!: 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';

  @IsString()
  @IsNotEmpty()
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'quantity must be valid decimal string' })
  quantity!: string;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'price must be valid decimal string' })
  price?: string | null;

  @IsOptional()
  @IsString()
  stopPrice?: string | null;

  @IsOptional()
  @IsString()
  idempotencyKey?: string | null;
}

export class CreateSignalDto {
  @IsString()
  @IsNotEmpty()
  strategyVersionId!: string;

  @IsString()
  @IsNotEmpty()
  symbol!: string;

  @IsEnum(ResearchSignalSide)
  side!: ResearchSignalSide;

  @IsOptional()
  @IsString()
  strength?: string | null;

  @IsOptional()
  @IsString()
  confidence?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'price must be valid decimal string' })
  price?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'quantity must be valid decimal string' })
  quantity?: string | null;

  @IsString()
  @IsNotEmpty()
  timestamp!: string;

  @IsOptional()
  @IsString()
  expiresAt?: string | null;

  @IsOptional()
  @IsObject()
  sourceEvent?: Record<string, any> | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @IsOptional()
  @IsString()
  idempotencyKey?: string | null;
}

export class CreatePromotionDto {
  @IsString()
  @IsNotEmpty()
  strategyVersionId!: string;

  @IsOptional()
  @IsString()
  backtestRunId?: string | null;

  @IsOptional()
  @IsString()
  paperSessionId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  idempotencyKey?: string | null;
}

export class PromotionActionDto {
  @IsEnum(['BACKTEST_VALIDATION','OUT_OF_SAMPLE','PAPER_TRADING','RISK_REVIEW','COMPLIANCE_REVIEW','PUBLICATION'] as any)
  step!: 'BACKTEST_VALIDATION' | 'OUT_OF_SAMPLE' | 'PAPER_TRADING' | 'RISK_REVIEW' | 'COMPLIANCE_REVIEW' | 'PUBLICATION';

  @IsOptional()
  @IsString()
  reason?: string | null;
}
