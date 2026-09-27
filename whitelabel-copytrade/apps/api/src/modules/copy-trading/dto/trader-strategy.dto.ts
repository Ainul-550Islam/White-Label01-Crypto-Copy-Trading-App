import { IsString, IsOptional, IsBoolean, IsArray, IsEnum, IsObject, IsNotEmpty, MaxLength, MinLength, ArrayMaxSize, ValidateIf } from 'class-validator';
import { TraderStrategyStatus, TraderStrategyType } from '../copy-trading.types';

export class CreateTraderProfileDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  displayName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  bio?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatarUrl?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  supportedVenues?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  supportedSymbols?: string[];

  @IsOptional()
  @IsObject()
  riskProfile?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

export class UpdateTraderProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  bio?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatarUrl?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  supportedVenues?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  supportedSymbols?: string[];

  @IsOptional()
  @IsObject()
  riskProfile?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

export class CreateTraderStrategyDto {
  @IsString()
  @IsNotEmpty()
  traderId!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsEnum(TraderStrategyType)
  type?: TraderStrategyType;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  supportedSymbols!: string[];

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  supportedVenues!: string[];

  @IsOptional()
  @IsObject()
  riskProfile?: Record<string, any>;

  @IsOptional()
  @IsObject()
  feePolicy?: Record<string, any>;

  @IsOptional()
  @IsObject()
  strategyConfig?: Record<string, any>;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  idempotencyKey?: string | null;
}

export class UpdateTraderStrategyDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  supportedSymbols?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  supportedVenues?: string[];

  @IsOptional()
  @IsObject()
  riskProfile?: Record<string, any>;

  @IsOptional()
  @IsObject()
  feePolicy?: Record<string, any>;

  @IsOptional()
  @IsObject()
  strategyConfig?: Record<string, any>;
}

export class TraderStrategyFilterDto {
  @IsOptional()
  @IsEnum(TraderStrategyStatus)
  status?: TraderStrategyStatus;

  @IsOptional()
  @IsString()
  traderId?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}
