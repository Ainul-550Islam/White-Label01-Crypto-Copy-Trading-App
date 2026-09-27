import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'new.follower@acme-capital.test' })
  @IsEmail({}, { message: 'Must be a valid email address' })
  @MaxLength(254)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email!: string;

  @ApiProperty({
    description:
      'Must satisfy the password policy: 12+ characters with upper, lower, digit and symbol.',
    minLength: 12,
    maxLength: 128,
  })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({ example: 'Rashed' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Karim' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  lastName?: string;

  @ApiPropertyOptional({ enum: ['en', 'es', 'ar', 'bn', 'tr'], default: 'en' })
  @IsOptional()
  @IsIn(['en', 'es', 'ar', 'bn', 'tr'])
  locale?: 'en' | 'es' | 'ar' | 'bn' | 'tr';

  @ApiPropertyOptional({ description: 'Referral code of the inviting user.' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  referralCode?: string;

  @ApiProperty({ description: 'Must be true. Records acceptance of the terms of service.' })
  @IsBoolean()
  @Equals(true, { message: 'You must accept the terms of service' })
  acceptedTerms!: boolean;

  @ApiProperty({ example: 'web-8F2A1C7B-4D55-4E23-9A61-B7C8D9E0F1A2' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9._:-]+$/, { message: 'Device id contains unsupported characters' })
  deviceId!: string;

  @ApiPropertyOptional({ example: 'Chrome on macOS' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  deviceName?: string;

  @ApiPropertyOptional({ enum: ['ios', 'android', 'web', 'desktop'] })
  @IsOptional()
  @IsIn(['ios', 'android', 'web', 'desktop'])
  platform?: string;

  @ApiPropertyOptional({ example: '1.0.0' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  appVersion?: string;
}
