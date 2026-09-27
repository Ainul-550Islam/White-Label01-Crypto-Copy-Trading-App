import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsNumber, IsDateString } from 'class-validator';
import { MeterKey, UsageScope, AggregationWindow, PeriodType } from '../usage-metering.types';

export class UsageQueryDto {
  @ApiPropertyOptional({ enum: MeterKey, description: 'Filter by meter key' })
  @IsOptional()
  @IsEnum(MeterKey)
  meterKey?: MeterKey;

  @ApiPropertyOptional({ enum: UsageScope, description: 'Filter by scope' })
  @IsOptional()
  @IsEnum(UsageScope)
  scope?: UsageScope;

  @ApiPropertyOptional({ description: 'Resource/subject ID where authorized' })
  @IsOptional()
  @IsString()
  subjectId?: string;

  @ApiPropertyOptional({ description: 'Resource ID' })
  @IsOptional()
  @IsString()
  resourceId?: string;

  @ApiPropertyOptional({ enum: PeriodType })
  @IsOptional()
  @IsEnum(PeriodType)
  periodType?: PeriodType;

  @ApiPropertyOptional({ description: 'Period ID' })
  @IsOptional()
  @IsString()
  periodId?: string;

  @ApiPropertyOptional({ description: 'Start date ISO' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date ISO' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'From date ISO' })
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional({ description: 'To date ISO' })
  @IsOptional()
  @IsDateString()
  toDate?: string;

  @ApiPropertyOptional({ description: 'Page number' })
  @IsOptional()
  @IsNumber()
  page?: number;

  @ApiPropertyOptional({ description: 'Limit per page, max 1000' })
  @IsOptional()
  @IsNumber()
  limit?: number;

  @ApiPropertyOptional({ description: 'Source type filter' })
  @IsOptional()
  @IsString()
  sourceType?: string;
}

export class UsageOverviewQueryDto extends UsageQueryDto {
  @ApiPropertyOptional({ description: 'Include quota snapshots' })
  @IsOptional()
  includeQuota?: boolean;

  @ApiPropertyOptional({ description: 'Include overage' })
  @IsOptional()
  includeOverage?: boolean;
}

export class UsageBucketQueryDto {
  @ApiPropertyOptional({ enum: MeterKey })
  @IsOptional()
  @IsEnum(MeterKey)
  meterKey?: MeterKey;

  @ApiPropertyOptional({ enum: UsageScope })
  @IsOptional()
  @IsEnum(UsageScope)
  scope?: UsageScope;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subjectId?: string;

  @ApiPropertyOptional({ enum: AggregationWindow })
  @IsOptional()
  @IsEnum(AggregationWindow)
  window?: AggregationWindow;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  toDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  limit?: number;
}

export class QuotaSnapshotQueryDto {
  @ApiPropertyOptional({ enum: MeterKey })
  @IsOptional()
  @IsEnum(MeterKey)
  meterKey?: MeterKey;

  @ApiPropertyOptional({ enum: UsageScope })
  @IsOptional()
  @IsEnum(UsageScope)
  scope?: UsageScope;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subjectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  periodId?: string;
}

export class UsageEventResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  tenantId: string;

  @ApiProperty({ enum: MeterKey })
  meterKey: MeterKey;

  @ApiProperty({ enum: UsageScope })
  scope: UsageScope;

  @ApiPropertyOptional()
  subjectId?: string;

  @ApiPropertyOptional()
  resourceId?: string;

  @ApiProperty()
  quantity: number;

  @ApiProperty()
  unit: string;

  @ApiProperty()
  sourceType: string;

  @ApiProperty()
  sourceId: string;

  @ApiProperty()
  periodId: string;

  @ApiProperty()
  periodType: string;

  @ApiProperty()
  periodStart: string;

  @ApiProperty()
  periodEnd: string;

  @ApiProperty()
  timestamp: string;

  @ApiProperty()
  idempotencyKey: string;

  @ApiProperty()
  processingState: string;

  @ApiProperty()
  createdAt: string;

  @ApiPropertyOptional()
  safeMetadata?: Record<string, unknown> | null;
}

export class UsageBucketResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  tenantId: string;

  @ApiProperty({ enum: MeterKey })
  meterKey: MeterKey;

  @ApiProperty({ enum: UsageScope })
  scope: UsageScope;

  @ApiPropertyOptional()
  subjectId?: string;

  @ApiProperty({ enum: AggregationWindow })
  window: AggregationWindow;

  @ApiProperty()
  periodId: string;

  @ApiProperty()
  periodStart: string;

  @ApiProperty()
  periodEnd: string;

  @ApiProperty()
  totalQuantity: number;

  @ApiProperty()
  eventCount: number;

  @ApiProperty()
  unit: string;

  @ApiProperty()
  lastEventAt: string;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}

export class QuotaSnapshotResponseDto {
  @ApiProperty()
  tenantId: string;

  @ApiProperty({ enum: MeterKey })
  meterKey: MeterKey;

  @ApiProperty()
  limitKey: string;

  @ApiProperty({ enum: UsageScope })
  scope: UsageScope;

  @ApiPropertyOptional()
  subjectId?: string;

  @ApiPropertyOptional()
  maximum: number | null;

  @ApiProperty()
  current: number;

  @ApiPropertyOptional()
  remaining: number | null;

  @ApiPropertyOptional()
  utilizationPercent: number | null;

  @ApiProperty()
  status: string;

  @ApiProperty()
  periodId: string;

  @ApiProperty()
  periodStart: string;

  @ApiProperty()
  periodEnd: string;

  @ApiProperty()
  fetchedAt: string;

  @ApiPropertyOptional()
  planCode?: string | null;

  @ApiProperty()
  isEnforced: boolean;
}
