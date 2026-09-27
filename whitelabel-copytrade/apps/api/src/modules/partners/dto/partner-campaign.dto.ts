import { IsString, IsEnum, IsOptional, MinLength, IsNumber, IsArray, MaxLength, IsBoolean, Min, Max, IsIn } from 'class-validator';
import { PartnerDiscountType, PartnerCampaignState } from '../partner.types';

export class CreateCampaignDto {
  @IsString()
  partnerId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(32)
  code!: string;

  @IsOptional()
  @IsEnum(PartnerDiscountType)
  discountType?: PartnerDiscountType;

  @IsOptional()
  @IsString()
  discountValue?: string;

  @IsOptional()
  @IsString()
  @IsIn(['USD', 'EUR', 'GBP', 'JPY', 'USDT', 'USDC', 'CAD', 'AUD'])
  discountCurrency?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  maxUses?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedPlans?: string[];

  @IsNumber()
  @Min(1)
  @Max(8760)
  attributionWindowHours!: number;

  @IsString()
  startsAt!: string;

  @IsOptional()
  @IsString()
  endsAt?: string;

  @IsString()
  createdBy!: string;

  @IsString()
  correlationId!: string;

  @IsString()
  @MinLength(8)
  idempotencyKey!: string;
}

export class CreateReferralDto {
  @IsString()
  partnerId!: string;

  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  maxUses?: number;

  @IsOptional()
  @IsString()
  expiresAt?: string;

  @IsString()
  createdBy!: string;

  @IsString()
  correlationId!: string;

  @IsString()
  @MinLength(8)
  idempotencyKey!: string;
}

export class CreateAttributionDto {
  @IsString()
  partnerId!: string;

  @IsString()
  tenantId!: string;

  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsOptional()
  @IsString()
  referralCode?: string;

  @IsOptional()
  @IsString()
  referralToken?: string;

  @IsString()
  attributionSource!: string;

  @IsString()
  capturedAt!: string;

  @IsOptional()
  @IsString()
  agreementVersion?: string;

  @IsString()
  createdBy!: string;

  @IsString()
  correlationId!: string;

  @IsString()
  @MinLength(8)
  idempotencyKey!: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class CreateDiscountDto {
  @IsString()
  partnerId!: string;

  @IsEnum(PartnerDiscountType)
  discountType!: PartnerDiscountType;

  @IsString()
  discountValue!: string;

  @IsString()
  @IsIn(['USD', 'EUR', 'GBP', 'JPY', 'USDT', 'USDC'])
  currency!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedPlans?: string[];

  @IsString()
  startsAt!: string;

  @IsOptional()
  @IsString()
  endsAt?: string;

  @IsString()
  createdBy!: string;

  @IsString()
  correlationId!: string;

  @IsString()
  idempotencyKey!: string;
}

export class TransitionCampaignStateDto {
  @IsEnum(PartnerCampaignState)
  targetState!: PartnerCampaignState;

  @IsString()
  correlationId!: string;

  @IsString()
  actorId!: string;
}

export class CalculateCommissionDto {
  @IsString()
  partnerId!: string;

  @IsString()
  tenantId!: string;

  @IsOptional()
  @IsString()
  sourcePaymentId?: string;

  @IsOptional()
  @IsString()
  sourceInvoiceId?: string;

  @IsOptional()
  @IsString()
  sourceSubscriptionId?: string;

  @IsOptional()
  @IsString()
  sourceFeeId?: string;

  @IsString()
  sourceEventId!: string;

  @IsString()
  @IsIn(['PAYMENT', 'INVOICE', 'SUBSCRIPTION', 'FEE', 'REFUND', 'CHARGEBACK'])
  sourceEventType!: 'PAYMENT' | 'INVOICE' | 'SUBSCRIPTION' | 'FEE' | 'REFUND' | 'CHARGEBACK';

  @IsString()
  grossRevenue!: string;

  @IsString()
  discountAmount!: string;

  @IsString()
  @IsIn(['USD', 'EUR', 'GBP', 'JPY', 'USDT', 'USDC', 'CAD', 'AUD', 'BTC', 'ETH'])
  currency!: string;

  @IsOptional()
  @IsString()
  sourceCurrency?: string;

  @IsString()
  correlationId!: string;

  @IsString()
  idempotencyKey!: string;

  @IsString()
  createdBy!: string;

  @IsOptional()
  @IsBoolean()
  isTrial?: boolean;

  @IsOptional()
  @IsBoolean()
  isLifetime?: boolean;

  @IsOptional()
  @IsBoolean()
  isFirstPeriod?: boolean;

  @IsOptional()
  @IsNumber()
  periodNumber?: number;

  @IsOptional()
  @IsString()
  planCode?: string;

  @IsOptional()
  @IsString()
  paymentStatus?: string;

  @IsOptional()
  @IsString()
  invoiceStatus?: string;
}

export class ReverseCommissionDto {
  @IsString()
  originalCommissionId!: string;

  @IsString()
  partnerId!: string;

  @IsString()
  tenantId!: string;

  @IsString()
  @MinLength(10)
  reversalReason!: string;

  @IsString()
  @IsIn(['REFUND', 'CHARGEBACK', 'CANCELLATION'])
  reversalType!: 'REFUND' | 'CHARGEBACK' | 'CANCELLATION';

  @IsOptional()
  @IsString()
  reversalAmount?: string;

  @IsString()
  correlationId!: string;

  @IsString()
  actorId!: string;

  @IsString()
  idempotencyKey!: string;
}

export class CreateSettlementDto {
  @IsString()
  partnerId!: string;

  @IsString()
  periodStart!: string;

  @IsString()
  periodEnd!: string;

  @IsString()
  @IsIn(['USD', 'EUR', 'GBP', 'JPY', 'USDT', 'USDC'])
  currency!: string;

  @IsString()
  createdBy!: string;

  @IsString()
  correlationId!: string;

  @IsString()
  idempotencyKey!: string;
}

export class RequestPayoutDto {
  @IsString()
  partnerId!: string;

  @IsString()
  settlementId!: string;

  @IsString()
  amount!: string;

  @IsString()
  @IsIn(['USD', 'EUR', 'GBP', 'JPY', 'USDT', 'USDC'])
  currency!: string;

  @IsString()
  @IsIn(['BANK_TRANSFER', 'CRYPTO', 'PAYPAL', 'WIRE'])
  method!: string;

  @IsString()
  requestedBy!: string;

  @IsString()
  correlationId!: string;

  @IsString()
  idempotencyKey!: string;
}

export class TransitionPayoutDto {
  @IsString()
  @IsIn(['ELIGIBLE', 'REQUESTED', 'APPROVED', 'SUBMITTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REVERSED'])
  targetState!: 'ELIGIBLE' | 'REQUESTED' | 'APPROVED' | 'SUBMITTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REVERSED';

  @IsString()
  correlationId!: string;

  @IsString()
  actorId!: string;

  @IsOptional()
  @IsString()
  providerPayoutId?: string;

  @IsOptional()
  @IsString()
  providerReference?: string;

  @IsOptional()
  @IsString()
  failureReason?: string;
}
