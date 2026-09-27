import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'analyst@acme-capital.test' })
  @IsEmail({}, { message: 'Must be a valid email address' })
  @MaxLength(254)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email!: string;

  @ApiPropertyOptional({
    description:
      'Initial password. Omit to send an invitation instead, which is the recommended flow.',
    minLength: 12,
  })
  @IsOptional()
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password?: string;

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

  @ApiPropertyOptional({ example: '+8801712345678' })
  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, { message: 'Phone must be in E.164 format' })
  phone?: string;

  @ApiPropertyOptional({ enum: ['en', 'es', 'ar', 'bn', 'tr'] })
  @IsOptional()
  @IsIn(['en', 'es', 'ar', 'bn', 'tr'])
  locale?: string;

  @ApiPropertyOptional({
    description: 'Role keys to assign, e.g. ["TRADER"]. Defaults to FOLLOWER.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Transform(({ value }) =>
    Array.isArray(value) ? value.map((entry: string) => entry.trim().toUpperCase()) : value,
  )
  roleKeys?: string[];

  @ApiPropertyOptional({ description: 'Send an invitation email.', default: true })
  @IsOptional()
  @IsBoolean()
  sendInvite: boolean = true;
}
