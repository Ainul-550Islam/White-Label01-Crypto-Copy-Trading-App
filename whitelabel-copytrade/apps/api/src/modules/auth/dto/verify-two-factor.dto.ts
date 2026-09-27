import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class VerifyTwoFactorDto {
  @ApiProperty({ description: 'Challenge token returned by the login endpoint.' })
  @IsString()
  @MinLength(20)
  @MaxLength(4096)
  challengeToken!: string;

  @ApiPropertyOptional({ description: '6-digit code from the authenticator app.', example: '482913' })
  @ValidateIf((dto: VerifyTwoFactorDto) => !dto.recoveryCode)
  @IsString()
  @Matches(/^\d{6,8}$/, { message: 'Authenticator code must be 6-8 digits' })
  code?: string;

  @ApiPropertyOptional({ description: 'Single-use recovery code.', example: 'A1B2-C3D4-E5F6' })
  @ValidateIf((dto: VerifyTwoFactorDto) => !dto.code)
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/, {
    message: 'Recovery code format is XXXX-XXXX-XXXX',
  })
  recoveryCode?: string;

  @ApiProperty({ description: 'Must match the device used in the login request.' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9._:-]+$/, { message: 'Device id contains unsupported characters' })
  deviceId!: string;

  @ApiPropertyOptional({ description: 'Remember this device for future sign-ins.', default: false })
  @IsOptional()
  @IsBoolean()
  trustDevice: boolean = false;
}
