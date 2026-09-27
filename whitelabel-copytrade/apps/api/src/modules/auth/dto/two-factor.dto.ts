import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class BeginTwoFactorSetupDto {
  @ApiProperty({ description: 'Current password. Required to start 2FA enrolment.' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class ConfirmTwoFactorSetupDto {
  @ApiProperty({ description: 'Code from the authenticator app.', example: '482913' })
  @IsString()
  @Matches(/^\d{6,8}$/, { message: 'Authenticator code must be 6-8 digits' })
  code!: string;
}

export class DisableTwoFactorDto {
  @ApiProperty({ description: 'Current password.' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({ description: 'Authenticator code.', example: '482913' })
  @ValidateIf((dto: DisableTwoFactorDto) => !dto.recoveryCode)
  @IsString()
  @Matches(/^\d{6,8}$/, { message: 'Authenticator code must be 6-8 digits' })
  code?: string;

  @ApiPropertyOptional({ description: 'Recovery code.', example: 'A1B2-C3D4-E5F6' })
  @ValidateIf((dto: DisableTwoFactorDto) => !dto.code)
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/, {
    message: 'Recovery code format is XXXX-XXXX-XXXX',
  })
  recoveryCode?: string;
}

export class RegenerateRecoveryCodesDto {
  @ApiProperty({ description: 'Current password.' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class RevokeSessionDto {
  @ApiPropertyOptional({ description: 'Reason recorded in the audit trail.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reason?: string;
}
