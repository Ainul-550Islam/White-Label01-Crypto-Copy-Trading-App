import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ description: 'The password currently in use.' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({ description: 'New password, subject to the password policy.', minLength: 12 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;

  @ApiPropertyOptional({
    description: 'Sign out every other device after the change.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  revokeOtherSessions: boolean = true;
}
