import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class TenantSettingEntryDto {
  @ApiProperty({ example: 'copy_trading.max_leverage' })
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z][a-z0-9_.]*$/, {
    message: 'Setting keys are lowercase, dot or underscore separated',
  })
  key!: string;

  @ApiProperty({
    description: 'Arbitrary JSON value. Encrypted at rest when isSecret is true.',
    example: 10,
  })
  @IsDefined()
  value!: unknown;

  @ApiPropertyOptional({ example: 'trading', default: 'general' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  category?: string;

  @ApiPropertyOptional({
    description: 'Store the value encrypted and never return it in plaintext.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isSecret?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string;
}

export class UpsertTenantSettingsDto {
  @ApiProperty({ type: [TenantSettingEntryDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => TenantSettingEntryDto)
  settings!: TenantSettingEntryDto[];
}

export class CreateTenantDomainDto {
  @ApiProperty({ example: 'app.acme-capital.com' })
  @IsString()
  @MaxLength(253)
  @Matches(/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/, {
    message: 'Must be a valid fully qualified domain name',
  })
  domain!: string;

  @ApiPropertyOptional({ description: 'Make this the primary domain.', default: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class ListTenantsQueryExtrasDto {
  @ApiPropertyOptional({ description: 'Include archived and soft-deleted tenants.' })
  @IsOptional()
  @IsBoolean()
  includeDeleted?: boolean;
}
