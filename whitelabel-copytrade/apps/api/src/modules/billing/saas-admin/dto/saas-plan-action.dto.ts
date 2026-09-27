import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsEnum, IsUUID } from 'class-validator';
import { BillingInterval } from '@wlct/shared-types';

export class AssignPlanRequestDto {
  @ApiProperty({ description: 'Canonical plan ID from catalog' })
  @IsString()
  @IsUUID()
  planId: string;
}

export class ChangePlanRequestDto {
  @ApiProperty({ description: 'Canonical plan ID from catalog' })
  @IsString()
  @IsUUID()
  planId: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  atPeriodEnd?: boolean;
}

export class ChangeBillingIntervalRequestDto {
  @ApiProperty({ enum: BillingInterval })
  @IsEnum(BillingInterval)
  newInterval: BillingInterval;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  atPeriodEnd?: boolean;
}

export class SaasPlanActionResponseDto {
  @ApiProperty() tenantId: string;
  @ApiProperty() action: string;
  @ApiProperty() planId: string;
  @ApiPropertyOptional() subscriptionId: string | null;
  @ApiPropertyOptional() previousPlanId: string | null;
  @ApiProperty() changeType: string;
  @ApiPropertyOptional() priceDelta: string | null;
  @ApiPropertyOptional() effectiveAt: string | null;
  @ApiProperty() message: string;
  @ApiPropertyOptional() requiresCheckout: boolean;
  @ApiPropertyOptional() checkout: any | null;
  @ApiProperty() updatedAt: string;
}

export class CheckoutRequiredResponseDto {
  @ApiProperty() requiresCheckout: true;
  @ApiProperty() checkoutId: string;
  @ApiProperty() checkoutUrl: string;
  @ApiProperty() provider: string;
  @ApiProperty() amount: string;
  @ApiProperty() currency: string;
  @ApiProperty() currentPlan: any;
  @ApiProperty() requestedPlan: any;
  @ApiProperty() changeType: string;
  @ApiPropertyOptional() priceDelta: string | null;
  @ApiProperty() message: string;
}
