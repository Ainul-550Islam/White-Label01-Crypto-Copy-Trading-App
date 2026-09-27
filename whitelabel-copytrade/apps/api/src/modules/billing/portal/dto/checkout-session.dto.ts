import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID, IsEnum, IsUrl } from 'class-validator';
import { BillingInterval } from '@wlct/shared-types';

export class CreateCheckoutSessionRequestDto {
  @ApiProperty({ description: 'Canonical plan ID from billing catalog' })
  @IsString()
  @IsUUID()
  planId: string;

  @ApiPropertyOptional({ enum: BillingInterval, description: 'Billing interval, defaults to plan interval' })
  @IsOptional()
  @IsEnum(BillingInterval)
  billingInterval?: BillingInterval;

  @ApiPropertyOptional({ description: 'Currency override where supported' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: 'Payment provider override where allowed' })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({ description: 'Success URL for provider redirect' })
  @IsOptional()
  @IsString()
  successUrl?: string;

  @ApiPropertyOptional({ description: 'Cancel URL for provider redirect' })
  @IsOptional()
  @IsString()
  cancelUrl?: string;

  @ApiPropertyOptional({ description: 'Idempotency key for safe retry' })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @ApiPropertyOptional({ description: 'Number of seats' })
  @IsOptional()
  seats?: number;
}

export class CheckoutSessionResponseDto {
  @ApiProperty({ description: 'Internal checkout/payment reference' })
  checkoutId: string;

  @ApiProperty() paymentId: string;

  @ApiProperty({ description: 'Provider used' })
  provider: string;

  @ApiProperty({ description: 'Checkout status' })
  status: string;

  @ApiProperty({ description: 'Payment status' })
  paymentStatus: string;

  @ApiProperty({ description: 'Safe checkout URL - no secrets' })
  checkoutUrl: string;

  @ApiPropertyOptional() invoiceUrl?: string | null;

  @ApiProperty() providerCheckoutId: string;

  @ApiPropertyOptional() providerSessionId?: string | null;

  @ApiProperty() amount: string;

  @ApiProperty() currency: string;

  @ApiProperty() planId: string;

  @ApiProperty() planCode: string;

  @ApiProperty() planName: string;

  @ApiProperty({ enum: BillingInterval }) billingInterval: BillingInterval;

  @ApiPropertyOptional() expiresAt: string | null;

  @ApiProperty() createdAt: string;
}

export class CheckoutStatusResponseDto {
  @ApiProperty() checkoutId: string;
  @ApiProperty() paymentId: string;
  @ApiProperty() provider: string;
  @ApiProperty() status: string;
  @ApiProperty() paymentStatus: string;
  @ApiProperty() amount: string;
  @ApiProperty() currency: string;
  @ApiProperty() planId: string;
  @ApiProperty() planCode: string;
  @ApiProperty() planName: string;
  @ApiPropertyOptional() checkoutUrl: string | null;
  @ApiPropertyOptional() invoiceUrl: string | null;
  @ApiProperty() providerCheckoutId: string;
  @ApiPropertyOptional() paidAt: string | null;
  @ApiPropertyOptional() failedAt: string | null;
  @ApiPropertyOptional() cancelledAt: string | null;
  @ApiPropertyOptional() expiresAt: string | null;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
  @ApiProperty() verified: boolean;
}
