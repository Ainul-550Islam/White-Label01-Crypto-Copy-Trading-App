import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class AssignSubscriptionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  planId!: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  seatsPurchased: number = 1;

  @ApiPropertyOptional({
    description: 'Customer id at the payment provider. No card data is ever accepted here.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalCustomerId?: string;

  @ApiPropertyOptional({ description: 'Subscription id at the payment provider.' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalSubscriptionId?: string;
}

export class ChangePlanDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  planId!: string;

  @ApiPropertyOptional({
    description: 'Apply at the end of the current period instead of immediately.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  atPeriodEnd: boolean = false;
}

export class CancelSubscriptionDto {
  @ApiPropertyOptional({
    description: 'Keep access until the period ends instead of cancelling immediately.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  atPeriodEnd: boolean = true;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
