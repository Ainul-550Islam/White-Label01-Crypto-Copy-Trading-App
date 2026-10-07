// # Validates and serializes full follower copy policy settings with decimal string constraints and explicit bounds
// # Validates leverage policy and margin constraint parameters on copy policies
import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsArray,
  IsObject,
  IsIn,
  MaxLength,
  Matches,
  Min,
  Max,
} from 'class-validator';
import { CopyPolicy, CopySizingMode, FollowerRiskPolicy } from '../copy-trading.types';

export class CreateCopyPolicyDto {
  @IsEnum(CopySizingMode)
  sizingMode!: CopySizingMode;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'proportionalRatio must be valid decimal string' })
  @MaxLength(64)
  proportionalRatio?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'fixedQuantity must be valid decimal string' })
  @MaxLength(64)
  fixedQuantity?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'fixedNotional must be valid decimal string' })
  @MaxLength(64)
  fixedNotional?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'maxOrderNotional must be valid decimal string' })
  @MaxLength(64)
  maxOrderNotional?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'maxDailyNotional must be valid decimal string' })
  @MaxLength(64)
  maxDailyNotional?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1000)
  maxConcurrentCopies?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  slippageToleranceBps?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(60000)
  executionDelayMs?: number | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedSymbols?: string[] | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  blockedSymbols?: string[] | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedSides?: string[] | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  leveragePolicy?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d+)?$/, { message: 'maxLeverage must be a positive decimal string' })
  @MaxLength(32)
  maxLeverage?: string | null;

  @IsOptional()
  @IsString()
  @IsIn(['SPOT', 'ISOLATED', 'CROSS'])
  marginMode?: 'SPOT' | 'ISOLATED' | 'CROSS' | null;

  @IsOptional()
  @IsBoolean()
  reduceOnly?: boolean | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  takeProfitBps?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  stopLossBps?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  trailingStopBps?: number | null;

  @IsOptional()
  @IsObject()
  stopCopyConditions?: Record<string, any> | null;
}

export class UpdateCopyPolicyDto extends CreateCopyPolicyDto {}

export class FollowerRiskPolicyDto {
  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'maxDailyLoss must be valid decimal string' })
  @MaxLength(64)
  maxDailyLoss?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'maxTotalLoss must be valid decimal string' })
  @MaxLength(64)
  maxTotalLoss?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'maxDrawdown must be valid decimal string' })
  @MaxLength(64)
  maxDrawdown?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'maxExposure must be valid decimal string' })
  @MaxLength(64)
  maxExposure?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'maxPositionSize must be valid decimal string' })
  @MaxLength(64)
  maxPositionSize?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'maxSymbolExposure must be valid decimal string' })
  @MaxLength(64)
  maxSymbolExposure?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10000)
  maxCopyCount?: number | null;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d+)?$/, { message: 'maxLeverage must be a positive decimal string' })
  @MaxLength(32)
  maxLeverage?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d+)?$/, { message: 'minMarginRatio must be a positive decimal string' })
  @MaxLength(32)
  minMarginRatio?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedMarginModes?: string[] | null;

  @IsOptional()
  @IsBoolean()
  emergencyStopCopy?: boolean;

  @IsOptional()
  @IsBoolean()
  dailyPauseEnabled?: boolean;
}

export class LeaderEventDto {
  @IsString()
  eventId!: string;

  @IsOptional()
  @IsString()
  orderId?: string | null;

  @IsOptional()
  @IsString()
  fillId?: string | null;

  @IsString()
  symbol!: string;

  @IsString()
  exchangeSymbol!: string;

  @IsString()
  side!: string;

  @IsString()
  type!: string;

  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'quantity must be valid decimal string' })
  quantity!: string;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'price must be valid decimal string' })
  price?: string | null;

  @IsOptional()
  @IsString()
  stopPrice?: string | null;

  @IsString()
  venue!: string;

  @IsString()
  timestamp!: string;

  @IsOptional()
  @IsBoolean()
  isSimulated?: boolean;
}

export function serializeCopyPolicy(raw: Partial<CopyPolicy> | null | undefined): CopyPolicy {
  return {
    sizingMode: raw?.sizingMode ?? CopySizingMode.PROPORTIONAL,
    proportionalRatio: raw?.proportionalRatio ?? null,
    fixedQuantity: raw?.fixedQuantity ?? null,
    fixedNotional: raw?.fixedNotional ?? null,
    maxOrderNotional: raw?.maxOrderNotional ?? null,
    maxDailyNotional: raw?.maxDailyNotional ?? null,
    maxConcurrentCopies: raw?.maxConcurrentCopies ?? null,
    slippageToleranceBps: raw?.slippageToleranceBps ?? null,
    executionDelayMs: raw?.executionDelayMs ?? null,
    allowedSymbols: Array.isArray(raw?.allowedSymbols) ? [...raw.allowedSymbols] : null,
    blockedSymbols: Array.isArray(raw?.blockedSymbols) ? [...raw.blockedSymbols] : null,
    allowedSides: Array.isArray(raw?.allowedSides) ? [...raw.allowedSides] : null,
    leveragePolicy: raw?.leveragePolicy ?? null,
    maxLeverage: raw?.maxLeverage ?? null,
    marginMode: raw?.marginMode ?? null,
    reduceOnly: raw?.reduceOnly ?? null,
    takeProfitBps: raw?.takeProfitBps ?? null,
    stopLossBps: raw?.stopLossBps ?? null,
    trailingStopBps: raw?.trailingStopBps ?? null,
    stopCopyConditions: raw?.stopCopyConditions ? { ...raw.stopCopyConditions } : null,
  };
}

export function serializeFollowerRiskPolicy(raw: Partial<FollowerRiskPolicy> | null | undefined): FollowerRiskPolicy {
  return {
    maxDailyLoss: raw?.maxDailyLoss ?? null,
    maxTotalLoss: raw?.maxTotalLoss ?? null,
    maxDrawdown: raw?.maxDrawdown ?? null,
    maxExposure: raw?.maxExposure ?? null,
    maxPositionSize: raw?.maxPositionSize ?? null,
    maxSymbolExposure: raw?.maxSymbolExposure ?? null,
    maxCopyCount: raw?.maxCopyCount ?? null,
    maxLeverage: raw?.maxLeverage ?? null,
    minMarginRatio: raw?.minMarginRatio ?? null,
    allowedMarginModes: Array.isArray(raw?.allowedMarginModes) ? [...raw.allowedMarginModes] : null,
    emergencyStopCopy: Boolean(raw?.emergencyStopCopy),
    dailyPauseEnabled: Boolean(raw?.dailyPauseEnabled),
  };
}
