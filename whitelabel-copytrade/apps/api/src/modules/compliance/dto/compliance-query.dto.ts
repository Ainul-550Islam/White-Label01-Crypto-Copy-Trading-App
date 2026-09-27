import { IsOptional, IsString, IsEnum, IsDateString, IsInt, Min, Max, IsUUID, IsArray } from 'class-validator';
import { Type } from 'class-transformer';
import { ComplianceCaseState, ComplianceCaseType, RiskLevel, ComplianceDecision, KycState, AmlState, Jurisdiction } from '../compliance.types';

export class ComplianceQueryDto {
  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsEnum(ComplianceCaseState)
  state?: ComplianceCaseState;

  @IsOptional()
  @IsEnum(ComplianceCaseType)
  caseType?: ComplianceCaseType;

  @IsOptional()
  @IsEnum(RiskLevel)
  riskLevel?: RiskLevel;

  @IsOptional()
  @IsEnum(ComplianceDecision)
  decision?: ComplianceDecision;

  @IsOptional()
  @IsEnum(KycState)
  kycState?: KycState;

  @IsOptional()
  @IsEnum(AmlState)
  amlState?: AmlState;

  @IsOptional()
  @IsString()
  jurisdiction?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;

  @IsOptional()
  @IsString()
  ruleId?: string;

  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @IsOptional()
  @IsDateString()
  toDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc';
}

export class KycStatusQueryDto {
  @IsOptional()
  @IsString()
  providerReference?: string;

  @IsOptional()
  @IsString()
  userId?: string;
}

export class AmlStatusQueryDto {
  @IsOptional()
  @IsString()
  providerReference?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsEnum(AmlState)
  amlState?: AmlState;
}

export class RiskScoreQueryDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsEnum(RiskLevel)
  riskLevel?: RiskLevel;

  @IsOptional()
  @IsString()
  jurisdiction?: string;

  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @IsOptional()
  @IsDateString()
  toDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class MonitoringSignalQueryDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  ruleId?: string;

  @IsOptional()
  @IsEnum(RiskLevel)
  riskLevel?: RiskLevel;

  @IsOptional()
  @IsEnum(ComplianceDecision)
  decision?: ComplianceDecision;

  @IsOptional()
  @IsString()
  sourceType?: string;

  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @IsOptional()
  @IsDateString()
  toDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class ReconciliationQueryDto {
  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @Type(() => Boolean)
  fullScan?: boolean = false;
}
