import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class TenantOwnerDto {
  @ApiProperty({ example: 'owner@acme-capital.test' })
  @IsEmail()
  @MaxLength(254)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email!: string;

  @ApiProperty({ description: 'Initial password for the tenant owner.', minLength: 12 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  lastName?: string;
}

export class CreateTenantDto {
  @ApiProperty({
    description: 'URL-safe identifier. Becomes the sub-domain: {slug}.copytrade.app',
    example: 'acme-capital',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(63)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @Matches(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, {
    message: 'Slug may contain lowercase letters, digits and hyphens',
  })
  slug!: string;

  @ApiProperty({ example: 'Acme Capital' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ example: 'Acme Capital Holdings Ltd.' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  legalName?: string;

  @ApiProperty({ example: 'ops@acme-capital.test' })
  @IsEmail()
  @MaxLength(254)
  contactEmail!: string;

  @ApiPropertyOptional({ example: '+971501234567' })
  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, { message: 'Phone must be in E.164 format' })
  contactPhone?: string;

  @ApiPropertyOptional({ example: 'AE' })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  countryCode?: string;

  @ApiPropertyOptional({ enum: ['en', 'es', 'ar', 'bn', 'tr'], default: 'en' })
  @IsOptional()
  @IsIn(['en', 'es', 'ar', 'bn', 'tr'])
  defaultLocale: string = 'en';

  @ApiPropertyOptional({ type: [String], default: ['en'] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(['en', 'es', 'ar', 'bn', 'tr'], { each: true })
  supportedLocales: string[] = ['en'];

  @ApiPropertyOptional({ enum: ['USD', 'EUR', 'GBP', 'AED', 'BDT', 'TRY'], default: 'USD' })
  @IsOptional()
  @IsIn(['USD', 'EUR', 'GBP', 'AED', 'BDT', 'TRY'])
  defaultCurrency: string = 'USD';

  @ApiPropertyOptional({ type: [String], default: ['USD'] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(['USD', 'EUR', 'GBP', 'AED', 'BDT', 'TRY'], { each: true })
  supportedCurrencies: string[] = ['USD'];

  @ApiPropertyOptional({ example: 'Asia/Dubai', default: 'UTC' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone: string = 'UTC';

  @ApiPropertyOptional({
    description: 'Platform fee in basis points (100 = 1%).',
    minimum: 0,
    maximum: 10000,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  platformFeeBps: number = 0;

  @ApiPropertyOptional({
    description: 'Performance fee charged by traders, in basis points.',
    minimum: 0,
    maximum: 10000,
    default: 2000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  performanceFeeBps: number = 2000;

  @ApiPropertyOptional({ description: 'Hard cap on user accounts. Null means unlimited.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxUsers?: number;

  @ApiPropertyOptional({ description: 'Hard cap on trader accounts. Null means unlimited.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxTraders?: number;

  @ApiPropertyOptional({ description: 'Subscription plan to attach immediately.' })
  @IsOptional()
  @IsString()
  planId?: string;

  @ApiPropertyOptional({ type: TenantOwnerDto, description: 'Creates the first tenant admin.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => TenantOwnerDto)
  owner?: TenantOwnerDto;
}
