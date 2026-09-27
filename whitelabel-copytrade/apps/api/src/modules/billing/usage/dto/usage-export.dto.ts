import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsArray, IsDateString, IsBoolean } from 'class-validator';
import { MeterKey, UsageScope } from '../usage-metering.types';

export enum ExportFormat {
  JSON = 'JSON',
  CSV = 'CSV',
}

export class UsageExportRequestDto {
  @ApiProperty({ enum: ExportFormat, description: 'Export format' })
  @IsEnum(ExportFormat)
  format: ExportFormat;

  @ApiPropertyOptional({ description: 'From date ISO' })
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional({ description: 'To date ISO' })
  @IsOptional()
  @IsDateString()
  toDate?: string;

  @ApiPropertyOptional({ description: 'Start date alias' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date alias' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Period ID' })
  @IsOptional()
  @IsString()
  periodId?: string;

  @ApiPropertyOptional({ description: 'Meter keys to include' })
  @IsOptional()
  @IsArray()
  @IsEnum(MeterKey, { each: true })
  meterKeys?: MeterKey[];

  @ApiPropertyOptional({ enum: UsageScope })
  @IsOptional()
  @IsEnum(UsageScope)
  scope?: UsageScope;

  @ApiPropertyOptional({ description: 'Subject/resource ID' })
  @IsOptional()
  @IsString()
  subjectId?: string;

  @ApiPropertyOptional({ description: 'Include quota snapshots' })
  @IsOptional()
  @IsBoolean()
  includeQuota?: boolean;

  @ApiPropertyOptional({ description: 'Include overage' })
  @IsOptional()
  @IsBoolean()
  includeOverage?: boolean;

  @ApiPropertyOptional({ description: 'Max records, bounded 10000' })
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional({ description: 'Export mode' })
  @IsOptional()
  @IsString()
  exportMode?: string;
}

export class UsageExportResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ExportFormat })
  format: ExportFormat;

  @ApiProperty()
  tenantId: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  recordCount: number;

  @ApiProperty()
  exportedAt: string;

  @ApiPropertyOptional()
  downloadUrl?: string;

  @ApiPropertyOptional()
  expiresAt?: string;

  @ApiPropertyOptional()
  data?: any;

  @ApiPropertyOptional()
  csv?: string;
}

export class ExportStatusResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  tenantId: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  createdAt: string;

  @ApiPropertyOptional()
  completedAt?: string;

  @ApiPropertyOptional()
  failureReason?: string;
}
