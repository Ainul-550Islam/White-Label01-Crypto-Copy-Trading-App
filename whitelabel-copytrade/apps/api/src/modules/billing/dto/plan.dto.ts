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
} from 'class-validator';
import { BillingInterval, PlanAudience } from '@wlct/shared-types';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class PlanLimitsDto {
  @ApiPropertyOptional({ description: 'Null means unlimited.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxUsers: number | null = null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxTraders: number | null = null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxFollowersPerTrader: number | null = null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxExchangeAccountsPerUser: number | null = null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxCopySubscriptionsPerFollower: number | null = null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxApiRequestsPerMinute: number | null = null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  websocketConnections: number | null = null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  customDomain: boolean = false;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  whiteLabelMobileApp: boolean = false;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  prioritySupport: boolean = false;
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
