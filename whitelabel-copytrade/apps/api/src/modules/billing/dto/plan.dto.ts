import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { BillingInterval, PlanAudience } from '@wlct/shared-types';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class PlanLimitsDto {
  @ApiPropertyOptional({ description: 'Null means unlimited.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxUsers?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxTraders?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxFollowersPerTrader?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxExchangeAccountsPerUser?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxCopySubscriptionsPerFollower?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxApiRequestsPerMinute?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  websocketConnections?: number | null;

  @ApiPropertyOptional({ default: false })
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  customDomain?: boolean;

  @ApiPropertyOptional({ default: false })
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  whiteLabelMobileApp?: boolean;

  @ApiPropertyOptional({ default: false })
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  prioritySupport?: boolean;
}

export class CreatePlanDto {
  @ApiProperty({ example: 'growth' })
  @IsString()
  @MaxLength(48)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @Matches(/^[a-z0-9][a-z0-9_-]*$/, { message: 'Plan codes are lowercase slugs' })
  code!: string;

  @ApiProperty({ example: 'Growth' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ enum: PlanAudience, default: PlanAudience.TENANT })
  @IsOptional()
  @IsEnum(PlanAudience)
  audience: PlanAudience = PlanAudience.TENANT;

  @ApiProperty({
    example: '499.000000',
    description: 'Decimal string. Never a float: money is stored as DECIMAL(18,6).',
  })
  @IsNumberString({ no_symbols: false }, { message: 'price must be a decimal string' })
  price!: string;

  @ApiPropertyOptional({ enum: ['USD', 'EUR', 'GBP', 'AED', 'BDT', 'TRY'], default: 'USD' })
  @IsOptional()
  @IsIn(['USD', 'EUR', 'GBP', 'AED', 'BDT', 'TRY'])
  currency: string = 'USD';

  @ApiPropertyOptional({ enum: BillingInterval, default: BillingInterval.MONTHLY })
  @IsOptional()
  @IsEnum(BillingInterval)
  interval: BillingInterval = BillingInterval.MONTHLY;

  @ApiPropertyOptional({ minimum: 0, maximum: 90, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(90)
  trialDays: number = 0;

  @ApiPropertyOptional({ minimum: 0, maximum: 10000, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  performanceFeeBps: number = 0;

  @ApiPropertyOptional({ minimum: 0, maximum: 10000, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  platformFeeBps: number = 0;

  @ApiPropertyOptional({ type: PlanLimitsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PlanLimitsDto)
  limits?: PlanLimitsDto;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  features?: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive: boolean = true;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder: number = 0;

  @ApiPropertyOptional({
    description: 'Identifier of the matching price object at the payment provider.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalPriceId?: string;
}

export class UpdatePlanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumberString({ no_symbols: false }, { message: 'price must be a decimal string' })
  price?: string;

  @ApiPropertyOptional({ enum: BillingInterval })
  @IsOptional()
  @IsEnum(BillingInterval)
  interval?: BillingInterval;

  @ApiPropertyOptional({ minimum: 0, maximum: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(90)
  trialDays?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 10000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  performanceFeeBps?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 10000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  platformFeeBps?: number;

  @ApiPropertyOptional({ type: PlanLimitsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PlanLimitsDto)
  limits?: PlanLimitsDto;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  features?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalPriceId?: string;
}

export class ListPlansDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PlanAudience })
  @IsOptional()
  @IsEnum(PlanAudience)
  audience?: PlanAudience;

  @ApiPropertyOptional({ description: 'Return inactive plans as well.', default: false })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value === 'true' : Boolean(value)))
  @IsBoolean()
  includeInactive: boolean = false;
}

/** Complete platform-owned grant set; missing or null values are never inferred. */
export class PlanGrantsDto {
  @IsInt() @Min(0) @Max(100000)
  developer_applications!: number;
  @IsInt() @Min(0) @Max(100000)
  developer_credentials_per_app!: number;
  @IsInt() @Min(0) @Max(100000)
  developer_redirect_uris!: number;
  @IsInt() @Min(0) @Max(100000)
  developer_webhook_subscriptions!: number;
  @IsInt() @Min(0) @Max(100000)
  developer_webhook_endpoints_per_app!: number;
  @IsInt() @Min(0) @Max(100000)
  developer_rate_burst_per_minute!: number;
  @IsInt() @Min(0) @Max(100000)
  developer_rate_sustained_per_minute!: number;
  @IsInt() @Min(0) @Max(1)
  developer_reactivation_review!: number;
  @IsBoolean()
  developer_feature_portfolio_read!: boolean;
  @IsBoolean()
  developer_feature_webhooks!: boolean;
  @IsBoolean()
  developer_feature_reporting!: boolean;
  @IsBoolean()
  developer_feature_billing!: boolean;
  @IsBoolean()
  developer_feature_trading!: boolean;
  @IsBoolean()
  developer_feature_copy_trading!: boolean;
  @IsBoolean()
  developer_feature_billing_manage!: boolean;
  @IsBoolean()
  developer_feature_funding!: boolean;
  @IsBoolean()
  developer_feature_management!: boolean;
  @IsBoolean()
  tenant_flag_grant_copy_trading!: boolean;
  @IsBoolean()
  tenant_flag_grant_spot_trading!: boolean;
  @IsBoolean()
  tenant_flag_grant_paper_trading!: boolean;
  @IsBoolean()
  tenant_flag_grant_referral_program!: boolean;
  @IsBoolean()
  tenant_flag_grant_kyc_required!: boolean;
  @IsBoolean()
  tenant_flag_grant_two_factor_mandatory!: boolean;
  @IsBoolean()
  tenant_flag_grant_public_registration!: boolean;
  @IsBoolean()
  tenant_flag_grant_mobile_app!: boolean;
  @IsBoolean()
  tenant_flag_grant_withdrawal_notifications!: boolean;
  @IsBoolean()
  tenant_flag_grant_custom_domain!: boolean;
  @IsBoolean()
  tenant_flag_grant_advanced_analytics!: boolean;
}
