import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from 'class-validator';
import { UserStatus } from '@wlct/shared-types';

export class UpdateUserDto {
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  displayName?: string;

  @ApiPropertyOptional({ example: '+8801712345678' })
  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, { message: 'Phone must be in E.164 format' })
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  avatarUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @ApiPropertyOptional({ example: 'BD' })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  countryCode?: string;

  @ApiPropertyOptional({ example: 'Asia/Dhaka' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({ enum: ['en', 'es', 'ar', 'bn', 'tr'] })
  @IsOptional()
  @IsIn(['en', 'es', 'ar', 'bn', 'tr'])
  locale?: string;

  @ApiPropertyOptional({ enum: ['USD', 'EUR', 'GBP', 'AED', 'BDT', 'TRY'] })
  @IsOptional()
  @IsIn(['USD', 'EUR', 'GBP', 'AED', 'BDT', 'TRY'])
  preferredCurrency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  marketingOptIn?: boolean;
}

export class AdminUpdateUserDto extends UpdateUserDto {
  @ApiPropertyOptional({ enum: UserStatus, description: 'Administrative status override.' })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

export class SuspendUserDto {
  @ApiPropertyOptional({ description: 'Reason recorded in the audit trail.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AssignRolesDto {
  @ApiPropertyOptional({ description: 'Role ids to assign.', type: [String] })
  @IsString({ each: true })
  roleIds!: string[];
}
