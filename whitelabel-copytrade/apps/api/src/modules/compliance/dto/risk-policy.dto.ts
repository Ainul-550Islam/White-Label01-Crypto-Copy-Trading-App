import { IsOptional, IsString, IsBoolean, IsNotEmpty, IsArray, IsObject, IsNumber, MaxLength, IsEnum, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Jurisdiction } from '../compliance.types';

export class TransactionThresholdsDto {
  @IsOptional()
  @IsString()
  reviewAmount?: string;

  @IsOptional()
  @IsString()
  blockAmount?: string;

  @IsString()
  currency: string;

  @IsOptional()
  @IsNumber()
  highRiskMultiplier?: number;
}

export class RiskThresholdsDto {
  @IsNumber()
  lowMax: number;

  @IsNumber()
  mediumMax: number;

  @IsNumber()
  highMax: number;

  @IsNumber()
  criticalMin: number;

  @IsOptional()
  @IsNumber()
  blockScore?: number;

  @IsOptional()
  @IsNumber()
  reviewScore?: number;
}

export class PolicyRuleDto {
  @IsString()
  @IsNotEmpty()
  ruleId: string;

  @IsBoolean()
  enabled: boolean;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsOptional()
  @IsNumber()
  weight?: number;

  @IsOptional()
  @IsNumber()
  threshold?: number;
}

export class CreatePolicyDto {
  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsString()
  @IsNotEmpty()
  jurisdiction: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  policyVersion: string;

  @IsOptional()
  @IsBoolean()
  kycRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  amlRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  sanctionsRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  pepRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  eddRequired?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => TransactionThresholdsDto)
  transactionThresholds?: TransactionThresholdsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RiskThresholdsDto)
  riskThresholds?: RiskThresholdsDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  highRiskCountries?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  blockedCountries?: string[];

  @IsOptional()
  @IsNumber()
  reverificationIntervalDays?: number;

  @IsOptional()
  @IsBoolean()
  manualReviewRequired?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PolicyRuleDto)
  rules?: PolicyRuleDto[];
}

export class UpdatePolicyDto {
  @IsOptional()
  @IsBoolean()
  kycRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  amlRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  sanctionsRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  pepRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  eddRequired?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => TransactionThresholdsDto)
  transactionThresholds?: TransactionThresholdsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RiskThresholdsDto)
  riskThresholds?: RiskThresholdsDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  highRiskCountries?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  blockedCountries?: string[];

  @IsOptional()
  @IsNumber()
  reverificationIntervalDays?: number;

  @IsOptional()
  @IsBoolean()
  manualReviewRequired?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PolicyRuleDto)
  rules?: PolicyRuleDto[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CalculateRiskScoreDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsOptional()
  @IsString()
  jurisdiction?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}
