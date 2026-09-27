import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { TenantStatus } from '@wlct/shared-types';

export class UpdateTenantDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  legalName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  contactEmail?: string;

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

  @ApiPropertyOptional({ enum: ['en', 'es', 'ar', 'bn', 'tr'] })
  @IsOptional()
  @IsIn(['en', 'es', 'ar', 'bn', 'tr'])
  defaultLocale?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(['en', 'es', 'ar', 'bn', 'tr'], { each: true })
  supportedLocales?: string[];

  @ApiPropertyOptional({ enum: ['USD', 'EUR', 'GBP', 'AED', 'BDT', 'TRY'] })
  @IsOptional()
  @IsIn(['USD', 'EUR', 'GBP', 'AED', 'BDT', 'TRY'])
  defaultCurrency?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(['USD', 'EUR', 'GBP', 'AED', 'BDT', 'TRY'], { each: true })
  supportedCurrencies?: string[];

  @ApiPropertyOptional({ example: 'Asia/Dubai' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 10000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  platformFeeBps?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 10000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  performanceFeeBps?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxUsers?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxTraders?: number;
}

export class UpdateTenantStatusDto {
  @ApiPropertyOptional({ enum: TenantStatus })
  @IsEnum(TenantStatus)
  status!: TenantStatus;

  @ApiPropertyOptional({ description: 'Reason recorded in the audit trail.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
