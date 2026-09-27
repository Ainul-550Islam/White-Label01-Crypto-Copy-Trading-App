import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID, IsEnum, IsBoolean } from 'class-validator';
import { BillingInterval } from '@wlct/shared-types';

export class CancelSubscriptionRequestDto {
  @ApiPropertyOptional({ description: 'Reason for cancellation' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({ description: 'Cancel at period end, defaults true' })
  @IsOptional()
  @IsBoolean()
  atPeriodEnd?: boolean;
}

export class ResumeSubscriptionRequestDto {
  @ApiPropertyOptional({ description: 'Optional reason for resume' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ChangePlanRequestDto {
  @ApiProperty({ description: 'Canonical plan ID from catalog' })
  @IsString()
  @IsUUID()
  planId: string;

  @ApiPropertyOptional({ description: 'Change at period end' })
  @IsOptional()
  @IsBoolean()
  atPeriodEnd?: boolean;
}

export class ChangeIntervalRequestDto {
  @ApiProperty({ enum: BillingInterval, description: 'New billing interval' })
  @IsEnum(BillingInterval)
  newInterval: BillingInterval;

  @ApiPropertyOptional({ description: 'Change at period end' })
  @IsOptional()
  @IsBoolean()
  atPeriodEnd?: boolean;
}

export class SubscriptionActionResponseDto {
  @ApiProperty() tenantId: string;
  @ApiProperty() action: string;
  @ApiProperty() subscriptionId: string;
  @ApiProperty() status: string;
  @ApiPropertyOptional() effectiveAt: string | null;
  @ApiPropertyOptional() message: string | null;
  @ApiPropertyOptional() requiresCheckout: boolean;
  @ApiPropertyOptional() checkoutUrl: string | null;
  @ApiPropertyOptional() priceDelta: string | null;
  @ApiProperty() updatedAt: string;
}

export class SubscriptionStateResponseDto {
  @ApiPropertyOptional() subscription: any | null;
  @ApiProperty() canCancel: boolean;
  @ApiProperty() canResume: boolean;
  @ApiProperty() canChangePlan: boolean;
  @ApiProperty() canChangeInterval: boolean;
  @ApiProperty({ type: [String] }) effectiveActions: string[];
}
