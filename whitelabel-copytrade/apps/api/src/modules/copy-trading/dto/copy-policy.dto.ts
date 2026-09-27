import { IsString, IsOptional, IsEnum, IsNumber, IsBoolean, IsArray, IsObject, MaxLength, Matches, Min, Max, ValidateIf } from 'class-validator';
import { CopySizingMode } from '../copy-trading.types';

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
  leveragePolicy?: string | null;

  @IsOptional()
  @IsBoolean()
  reduceOnly?: boolean | null;

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
