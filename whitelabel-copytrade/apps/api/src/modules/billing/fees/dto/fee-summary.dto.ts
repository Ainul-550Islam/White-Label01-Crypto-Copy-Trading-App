import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsNumber, IsDateString } from 'class-validator';
import { FeeType } from '../fee.types';

export enum FeeSummaryPeriod {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  YEARLY = 'YEARLY',
  ALL = 'ALL',
}

export class FeeSummaryQueryDto {
  @ApiPropertyOptional({ enum: FeeType, description: 'Filter by fee type' })
  @IsOptional()
  @IsEnum(FeeType)
  feeType?: FeeType;

  @ApiPropertyOptional({ description: 'Currency filter' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ enum: FeeSummaryPeriod })
  @IsOptional()
  @IsEnum(FeeSummaryPeriod)
  period?: FeeSummaryPeriod;

  @ApiPropertyOptional({ description: 'From date ISO' })
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional({ description: 'To date ISO' })
  @IsOptional()
  @IsDateString()
  toDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceType?: string;
}

export class FeeSummaryItemDto {
  @ApiProperty()
  tenantId: string;

  @ApiPropertyOptional()
  periodStart: string | null;

  @ApiPropertyOptional()
  periodEnd: string | null;

  @ApiProperty()
  currency: string;

  @ApiProperty({ enum: FeeType, enumName: 'FeeType' })
  feeType: FeeType | 'ALL';

  @ApiProperty({ description: 'Gross/source amount' })
  grossAmount: string;

  @ApiProperty({ description: 'Fee amount calculated' })
  feeAmount: string;

  @ApiProperty({ description: 'Net amount after fee' })
  netAmount: string;

  @ApiProperty()
  accruedCount: number;

  @ApiProperty()
  settledCount: number;

  @ApiProperty()
  paidCount: number;

  @ApiProperty()
  pendingCount: number;

  @ApiProperty()
  accruedTotal: string;

  @ApiProperty()
  settledTotal: string;

  @ApiProperty()
  paidTotal: string;

  @ApiProperty()
  pendingTotal: string;

  @ApiPropertyOptional({ description: 'Effective rate in BPS' })
  effectiveRateBps: number | null;

  @ApiPropertyOptional()
  feeRate: string;

  @ApiPropertyOptional()
  rateBasis: string;
}

export class FeeSummaryResponseDto {
  @ApiProperty()
  tenantId: string;

  @ApiProperty({ type: [FeeSummaryItemDto] })
  summaries: FeeSummaryItemDto[];

  @ApiProperty()
  totalGross: string;

  @ApiProperty()
  totalFees: string;

  @ApiProperty()
  totalNet: string;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  fetchedAt: string;
}

export class FeeAccrualResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  tenantId: string;

  @ApiProperty()
  sourceType: string;

  @ApiProperty()
  sourceId: string;

  @ApiProperty({ enum: FeeType })
  feeType: FeeType;

  @ApiProperty()
  feeRateBps: number;

  @ApiProperty()
  rateBasis: string;

  @ApiProperty()
  grossAmount: string;

  @ApiProperty()
  feeAmount: string;

  @ApiProperty()
  netAmount: string;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  settlementState: string;

  @ApiPropertyOptional()
  payoutState: string | null;

  @ApiPropertyOptional()
  settlementId: string | null;

  @ApiPropertyOptional()
  payoutId: string | null;

  @ApiProperty()
  idempotencyKey: string;

  @ApiProperty()
  calculationTimestamp: string;

  @ApiPropertyOptional()
  settlementTimestamp: string | null;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  @ApiPropertyOptional()
  safeMetadata: Record<string, unknown> | null;
}
