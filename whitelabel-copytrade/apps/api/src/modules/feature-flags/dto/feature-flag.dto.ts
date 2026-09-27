import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpsertFeatureFlagDto {
  @ApiProperty({ example: 'copy_trading' })
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'Feature flag keys are lowercase snake_case',
  })
  key!: string;

  @ApiProperty({ example: 'Copy trading' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Value applied when a tenant has no override.' })
  @IsOptional()
  @IsBoolean()
  isGlobalDefault?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 100, default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  rolloutPercentage?: number;
}

export class SetTenantFlagDto {
  @ApiProperty({ example: 'copy_trading' })
  @IsString()
  @MaxLength(64)
  key!: string;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 100,
    description: 'Overrides the definition rollout for this tenant only.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  rolloutPercentage?: number;

  @ApiPropertyOptional({ description: 'Free-form configuration attached to the flag.' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
