import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsNumber, IsBoolean, Min, Max } from 'class-validator';
import { MeterKey } from '../usage-metering.types';
import { AlertThresholdType, AlertSeverity } from '../usage-alert.types';

export class CreateUsageAlertConfigDto {
  @ApiProperty({ enum: MeterKey, description: 'Meter to monitor' })
  @IsEnum(MeterKey)
  meterKey: MeterKey;

  @ApiProperty({ description: 'Limit key (e.g., maxUsers)' })
  @IsString()
  limitKey: string;

  @ApiProperty({ enum: AlertThresholdType, description: 'Threshold type' })
  @IsEnum(AlertThresholdType)
  thresholdType: AlertThresholdType;

  @ApiProperty({ description: 'Threshold value (percentage 1-200 or absolute >=1)' })
  @IsNumber()
  @Min(1)
  @Max(1000000)
  thresholdValue: number;

  @ApiProperty({ enum: AlertSeverity })
  @IsEnum(AlertSeverity)
  severity: AlertSeverity;

  @ApiPropertyOptional({ description: 'Enabled', default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Cooldown minutes', default: 60 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10080)
  cooldownMinutes?: number;
}

export class UpdateUsageAlertConfigDto {
  @ApiPropertyOptional({ description: 'Threshold value' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1000000)
  thresholdValue?: number;

  @ApiPropertyOptional({ enum: AlertSeverity })
  @IsOptional()
  @IsEnum(AlertSeverity)
  severity?: AlertSeverity;

  @ApiPropertyOptional({ description: 'Enabled' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Cooldown minutes' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10080)
  cooldownMinutes?: number;
}

export class UsageAlertConfigResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  tenantId: string;

  @ApiProperty({ enum: MeterKey })
  meterKey: MeterKey;

  @ApiProperty()
  limitKey: string;

  @ApiProperty({ enum: AlertThresholdType })
  thresholdType: AlertThresholdType;

  @ApiProperty()
  thresholdValue: number;

  @ApiProperty({ enum: AlertSeverity })
  severity: AlertSeverity;

  @ApiProperty()
  enabled: boolean;

  @ApiProperty()
  cooldownMinutes: number;

  @ApiPropertyOptional()
  lastTriggeredAt: string | null;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}

export class UsageAlertEventResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  tenantId: string;

  @ApiProperty()
  configId: string;

  @ApiProperty({ enum: MeterKey })
  meterKey: MeterKey;

  @ApiProperty()
  limitKey: string;

  @ApiProperty({ enum: AlertThresholdType })
  thresholdType: AlertThresholdType;

  @ApiProperty()
  thresholdValue: number;

  @ApiProperty()
  currentValue: number;

  @ApiPropertyOptional()
  maximumValue: number | null;

  @ApiPropertyOptional()
  utilizationPercent: number | null;

  @ApiProperty({ enum: AlertSeverity })
  severity: AlertSeverity;

  @ApiProperty()
  state: string;

  @ApiProperty()
  periodId: string;

  @ApiProperty()
  triggeredAt: string;

  @ApiProperty()
  deliveryState: string;

  @ApiProperty()
  idempotencyKey: string;

  @ApiProperty()
  createdAt: string;
}

export class AlertQueryDto {
  @ApiPropertyOptional({ enum: MeterKey })
  @IsOptional()
  @IsEnum(MeterKey)
  meterKey?: MeterKey;

  @ApiPropertyOptional({ enum: AlertSeverity })
  @IsOptional()
  @IsEnum(AlertSeverity)
  severity?: AlertSeverity;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fromDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  toDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  offset?: number;
}
