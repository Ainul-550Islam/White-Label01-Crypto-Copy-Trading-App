import { IsString, IsOptional, IsEnum, IsObject, IsNotEmpty, MaxLength, Matches, ValidateIf } from 'class-validator';
import { CopySubscriptionState, CopySizingMode } from '../copy-trading.types';

export class CreateFollowerSubscriptionDto {
  @IsString()
  @IsNotEmpty()
  traderId!: string;

  @IsString()
  @IsNotEmpty()
  strategyId!: string;

  @IsEnum(CopySizingMode)
  allocationMode!: CopySizingMode;

  @IsString()
  @IsNotEmpty()
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'allocationAmount must be a valid decimal string - no float' })
  @MaxLength(64)
  allocationAmount!: string;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'maxAllocation must be a valid decimal string' })
  @MaxLength(64)
  maxAllocation?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'minAllocation must be a valid decimal string' })
  @MaxLength(64)
  minAllocation?: string | null;

  @IsOptional()
  @IsObject()
  copyPolicy?: Record<string, any>;

  @IsOptional()
  @IsObject()
  riskPolicy?: Record<string, any>;

  @IsOptional()
  @IsString()
  followerAccountId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  idempotencyKey?: string | null;
}

export class UpdateFollowerSubscriptionDto {
  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'allocationAmount must be valid decimal string' })
  @MaxLength(64)
  allocationAmount?: string;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'maxAllocation must be valid decimal string' })
  @MaxLength(64)
  maxAllocation?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'minAllocation must be valid decimal string' })
  @MaxLength(64)
  minAllocation?: string | null;

  @IsOptional()
  @IsEnum(CopySizingMode)
  allocationMode?: CopySizingMode;

  @IsOptional()
  @IsObject()
  copyPolicy?: Record<string, any>;

  @IsOptional()
  @IsObject()
  riskPolicy?: Record<string, any>;

  @IsOptional()
  @IsString()
  followerAccountId?: string | null;
}

export class FollowerSubscriptionFilterDto {
  @IsOptional()
  @IsEnum(CopySubscriptionState)
  state?: CopySubscriptionState;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}

export class CopyExecutionFilterDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  subscriptionId?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}
