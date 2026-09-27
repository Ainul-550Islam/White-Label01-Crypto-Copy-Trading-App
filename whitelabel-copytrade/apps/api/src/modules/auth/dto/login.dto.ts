import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'trader@acme-capital.test', maxLength: 254 })
  @IsEmail({}, { message: 'Must be a valid email address' })
  @MaxLength(254)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email!: string;

  @ApiProperty({ description: 'Account password.', minLength: 1, maxLength: 128 })
  @IsString()
  @MinLength(1, { message: 'Password is required' })
  @MaxLength(128)
  password!: string;

  @ApiProperty({
    description:
      'Stable identifier generated and stored by the client. Binds refresh tokens to one device.',
    example: 'ios-6E9F1C7A-2B34-4A11-9E7C-D0F2A1B3C4D5',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9._:-]+$/, { message: 'Device id contains unsupported characters' })
  deviceId!: string;

  @ApiPropertyOptional({ example: "Rashed's iPhone 15" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  deviceName?: string;

  @ApiPropertyOptional({ enum: ['ios', 'android', 'web', 'desktop'] })
  @IsOptional()
  @IsIn(['ios', 'android', 'web', 'desktop'])
  platform?: string;

  @ApiPropertyOptional({ example: '1.4.2' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  appVersion?: string;

  @ApiPropertyOptional({
    description: 'Marks the device as trusted, which may relax future 2FA prompts.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  rememberDevice: boolean = false;
}
