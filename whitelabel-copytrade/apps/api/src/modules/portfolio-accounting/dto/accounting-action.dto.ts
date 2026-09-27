import { IsString, IsOptional, IsEnum, IsDateString, MinLength, IsNotEmpty } from 'class-validator';
import {
  PortfolioAccountingScope,
  PortfolioType,
  PortfolioReturnMethodology,
  PortfolioAdjustmentType,
  PortfolioCashFlowType,
} from '../portfolio-accounting.types';

export class CreateProfileDto {
  @IsEnum(PortfolioAccountingScope)
  scope!: PortfolioAccountingScope;

  @IsString()
  @IsNotEmpty()
  scopeId!: string;

  @IsOptional()
  @IsEnum(PortfolioType)
  portfolioType?: PortfolioType;

  @IsOptional()
  @IsString()
  baseCurrency?: string;

  @IsOptional()
  @IsEnum(PortfolioReturnMethodology)
  returnMethodology?: PortfolioReturnMethodology;

  @IsOptional()
  @IsString()
  costBasisMethod?: string;
}

export class CreatePeriodDto {
  @IsString()
  @IsNotEmpty()
  profileId!: string;

  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;

  @IsOptional()
  @IsString()
  periodType?: string;

  @IsOptional()
  @IsString()
  baseCurrency?: string;
}

export class ClosePeriodDto {
  @IsString()
  @IsNotEmpty()
  periodId!: string;
}

export class CreateSnapshotDto {
  @IsString()
  @IsNotEmpty()
  profileId!: string;

  @IsOptional()
  @IsDateString()
  timestamp?: string;

  @IsOptional()
  @IsString()
  baseCurrency?: string;

  @IsEnum(PortfolioAccountingScope)
  scope!: PortfolioAccountingScope;

  @IsString()
  @IsNotEmpty()
  scopeId!: string;
}

export class GenerateStatementDto {
  @IsString()
  @IsNotEmpty()
  profileId!: string;

  @IsString()
  @IsNotEmpty()
  periodId!: string;
}

export class CreateAdjustmentDto {
  @IsString()
  @IsNotEmpty()
  profileId!: string;

  @IsOptional()
  @IsString()
  originalEventId?: string;

  @IsEnum(PortfolioAdjustmentType)
  adjustmentType!: PortfolioAdjustmentType;

  @IsString()
  @MinLength(5)
  reason!: string;

  @IsOptional()
  @IsString()
  adjustedAmount?: string;

  @IsOptional()
  @IsString()
  adjustedQuantity?: string;

  @IsOptional()
  @IsString()
  asset?: string;
}

export class ReconciliationActionDto {
  @IsString()
  @IsNotEmpty()
  profileId!: string;

  @IsOptional()
  @IsString()
  periodId?: string;

  @IsString()
  scope!: string;

  @IsOptional()
  @IsString()
  trigger?: string;
}

export class IngestEventDto {
  @IsString()
  @IsNotEmpty()
  profileId!: string;

  @IsString()
  @IsNotEmpty()
  sourceType!: string;

  @IsString()
  @IsNotEmpty()
  sourceId!: string;

  @IsOptional()
  @IsString()
  asset?: string;

  @IsOptional()
  @IsString()
  quantity?: string;

  @IsOptional()
  @IsString()
  price?: string;

  @IsOptional()
  @IsString()
  amount?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsDateString()
  sourceTimestamp?: string;

  @IsOptional()
  @IsEnum(PortfolioCashFlowType)
  cashFlowType?: PortfolioCashFlowType;
}

export class PerformanceQueryDto {
  @IsString()
  @IsNotEmpty()
  profileId!: string;

  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;

  @IsOptional()
  @IsEnum(PortfolioReturnMethodology)
  methodology?: PortfolioReturnMethodology;

  @IsOptional()
  @IsString()
  baseCurrency?: string;

  @IsOptional()
  @IsString()
  benchmarkId?: string;
}

export class AttributionQueryDto {
  @IsString()
  @IsNotEmpty()
  profileId!: string;

  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;

  @IsString()
  @IsNotEmpty()
  dimension!: string;

  @IsOptional()
  @IsString()
  baseCurrency?: string;
}
