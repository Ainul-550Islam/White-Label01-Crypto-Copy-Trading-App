import { IsOptional, IsString, IsDateString, IsEnum, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { PortfolioAccountingScope, PortfolioReturnMethodology, PortfolioAttributionDimension } from '../portfolio-accounting.types';

export class PortfolioQueryDto {
  @IsOptional()
  @IsString()
  profileId?: string;

  @IsOptional()
  @IsEnum(PortfolioAccountingScope)
  scope?: PortfolioAccountingScope;

  @IsOptional()
  @IsString()
  scopeId?: string;

  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsString()
  asset?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsDateString()
  at?: string;

  @IsOptional()
  @IsString()
  baseCurrency?: string;

  @IsOptional()
  @IsEnum(PortfolioReturnMethodology)
  methodology?: PortfolioReturnMethodology;

  @IsOptional()
  @IsEnum(PortfolioAttributionDimension)
  dimension?: PortfolioAttributionDimension;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(1000)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(1000)
  limit?: number = 50;

  // Prohibit client-provided calculated totals — never trust client NAV/PnL
  // These fields are intentionally not allowed to be set by client for calculations
  // Any attempt to provide nav, pnl, balance will be ignored via validation
}

export class PortfolioPeriodQueryDto {
  @IsOptional()
  @IsString()
  profileId?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(1000)
  limit?: number = 50;
}

export class PortfolioSnapshotQueryDto {
  @IsOptional()
  @IsString()
  profileId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(1000)
  limit?: number = 50;
}
