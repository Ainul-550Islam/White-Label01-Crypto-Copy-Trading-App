import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsNumber, IsObject, IsNotEmpty } from 'class-validator';
import { PayoutProvider, PayoutStatus, BeneficiaryType } from '../payout.types';

export class CreatePayoutRequestDto {
  @ApiProperty({ description: 'Settlement ID to payout from - must be FINALIZED' })
  @IsString()
  @IsNotEmpty()
  settlementId: string;

  @ApiProperty({ description: 'Beneficiary ID (trader, tenant, etc)' })
  @IsString()
  @IsNotEmpty()
  beneficiaryId: string;

  @ApiProperty({ enum: BeneficiaryType, description: 'Beneficiary type' })
  @IsEnum(BeneficiaryType)
  beneficiaryType: BeneficiaryType;

  @ApiPropertyOptional({ description: 'Payout amount - if not provided uses settlement final amount. Never exceeds settlement.' })
  @IsOptional()
  @IsString()
  amount?: string;

  @ApiPropertyOptional({ description: 'Currency - must match settlement currency' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ description: 'Payout destination safe reference' })
  @IsObject()
  destination: {
    type: 'bank_account' | 'crypto_wallet' | 'internal_account' | 'stripe_account';
    reference: string;
    maskedReference: string;
    currency: string;
    country?: string;
    metadata?: Record<string, unknown>;
  };

  @ApiPropertyOptional({ enum: PayoutProvider, description: 'Payout provider, defaults to manual' })
  @IsOptional()
  @IsEnum(PayoutProvider)
  provider?: PayoutProvider;

  @ApiPropertyOptional({ description: 'Idempotency key' })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @ApiPropertyOptional({ description: 'Safe metadata, no secrets' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class PayoutActionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  settlementId: string;

  @ApiProperty()
  beneficiaryId: string;

  @ApiProperty({ enum: BeneficiaryType })
  beneficiaryType: BeneficiaryType;

  @ApiProperty()
  tenantId: string;

  @ApiProperty()
  amount: string;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  destination: Record<string, unknown>;

  @ApiProperty({ enum: PayoutProvider })
  provider: PayoutProvider;

  @ApiPropertyOptional()
  providerPayoutId: string | null;

  @ApiPropertyOptional()
  providerReference: string | null;

  @ApiProperty({ enum: PayoutStatus })
  status: PayoutStatus;

  @ApiPropertyOptional()
  failureReason: string | null;

  @ApiProperty()
  idempotencyKey: string;

  @ApiProperty()
  requestedAt: string;

  @ApiPropertyOptional()
  processedAt: string | null;

  @ApiPropertyOptional()
  succeededAt: string | null;

  @ApiPropertyOptional()
  failedAt: string | null;

  @ApiPropertyOptional()
  cancelledAt: string | null;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}

export class PayoutStatusResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: PayoutStatus })
  status: PayoutStatus;

  @ApiPropertyOptional()
  providerPayoutId: string | null;

  @ApiPropertyOptional()
  failureReason: string | null;

  @ApiProperty()
  verified: boolean;

  @ApiPropertyOptional()
  providerStatus: string | null;

  @ApiProperty()
  updatedAt: string;
}

export class ApprovePayoutRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

export class RetryPayoutRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class CancelPayoutRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class PayoutListQueryDto {
  @ApiPropertyOptional({ enum: PayoutStatus })
  @IsOptional()
  @IsEnum(PayoutStatus)
  status?: PayoutStatus;

  @ApiPropertyOptional({ enum: PayoutProvider })
  @IsOptional()
  @IsEnum(PayoutProvider)
  provider?: PayoutProvider;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  beneficiaryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  currency?: string;

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
