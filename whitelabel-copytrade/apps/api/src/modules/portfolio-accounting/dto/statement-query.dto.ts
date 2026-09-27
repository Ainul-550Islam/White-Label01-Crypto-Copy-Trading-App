import { IsOptional, IsString, IsDateString, IsEnum, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { PortfolioStatementState } from '../portfolio-accounting.types';

export class StatementQueryDto {
  @IsOptional()
  @IsString()
  profileId?: string;

  @IsOptional()
  @IsString()
  periodId?: string;

  @IsOptional()
  @IsEnum(PortfolioStatementState)
  state?: PortfolioStatementState;

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

export class StatementExportDto {
  @IsString()
  statementId!: string;

  @IsOptional()
  @IsEnum(['CSV', 'JSON'] as any)
  format?: string = 'JSON';
}

export class HoldingsExportDto {
  @IsString()
  profileId!: string;

  @IsOptional()
  @IsDateString()
  at?: string;

  @IsOptional()
  @IsEnum(['CSV', 'JSON'] as any)
  format?: string = 'CSV';
}

export class CashLedgerExportDto {
  @IsString()
  profileId!: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsEnum(['CSV', 'JSON'] as any)
  format?: string = 'CSV';
}
