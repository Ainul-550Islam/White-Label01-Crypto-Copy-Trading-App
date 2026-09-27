import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsArray, IsNumber, IsBoolean } from 'class-validator';
import { FeeType, SettlementState } from '../fee.types';

export class SettlementPreviewRequestDto {
  @ApiPropertyOptional({ description: 'Currency to settle' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ enum: FeeType })
  @IsOptional()
  @IsEnum(FeeType)
  feeType?: FeeType;

  @ApiPropertyOptional({ description: 'Specific accrual IDs to include' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  accrualIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  limit?: number;
}

export class SettlementPreviewResponseDto {
  @ApiProperty()
  tenantId: string;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  grossFeeAmount: string;

  @ApiProperty()
  finalSettlementAmount: string;

  @ApiProperty()
  numberOfAccruals: number;

  @ApiProperty({ enum: FeeType, description: 'Fee type or MIXED' })
  feeType: FeeType | 'MIXED';

  @ApiProperty({ type: [Object] })
  eligibleAccruals: any[];

  @ApiProperty()
  fetchedAt: string;
}

export class CreateSettlementRequestDto {
  @ApiPropertyOptional({ description: 'Currency to settle, defaults to USD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ enum: FeeType })
  @IsOptional()
  @IsEnum(FeeType)
  feeType?: FeeType;

  @ApiPropertyOptional({ description: 'Specific accrual IDs to settle' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  accrualIds?: string[];

  @ApiPropertyOptional({ description: 'Idempotency key for settlement creation' })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @ApiPropertyOptional({ description: 'Safe metadata, no secrets' })
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class SettlementActionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  tenantId: string;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  grossFeeAmount: string;

  @ApiProperty()
  adjustments: string;

  @ApiProperty()
  finalSettlementAmount: string;

  @ApiProperty()
  numberOfAccruals: number;

  @ApiProperty()
  feeType: string;

  @ApiProperty({ enum: SettlementState })
  status: SettlementState;

  @ApiProperty()
  idempotencyKey: string;

  @ApiProperty({ type: [String] })
  accrualIds: string[];

  @ApiProperty()
  createdAt: string;

  @ApiPropertyOptional()
  calculatedAt: string | null;

  @ApiPropertyOptional()
  approvedAt: string | null;

  @ApiPropertyOptional()
  finalizedAt: string | null;

  @ApiPropertyOptional()
  paidAt: string | null;

  @ApiPropertyOptional()
  metadata: Record<string, unknown> | null;

  @ApiPropertyOptional({ type: [Object] })
  items?: any[];
}

export class ApproveSettlementRequestDto {
  @ApiPropertyOptional({ description: 'Approval note' })
  @IsOptional()
  @IsString()
  note?: string;
}

export class FinalizeSettlementRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

export class RetrySettlementRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class SettlementListQueryDto {
  @ApiPropertyOptional({ enum: SettlementState })
  @IsOptional()
  @IsEnum(SettlementState)
  status?: SettlementState;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ enum: FeeType })
  @IsOptional()
  @IsEnum(FeeType)
  feeType?: FeeType;

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
