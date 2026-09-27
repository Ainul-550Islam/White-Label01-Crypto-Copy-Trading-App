import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    description: 'The refresh token issued with the previous token pair.',
    minLength: 20,
    maxLength: 4096,
  })
  @IsString()
  @MinLength(20)
  @MaxLength(4096)
  refreshToken!: string;

  @ApiProperty({
    description: 'Must match the device the refresh token was issued to.',
    example: 'ios-6E9F1C7A-2B34-4A11-9E7C-D0F2A1B3C4D5',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9._:-]+$/, { message: 'Device id contains unsupported characters' })
  deviceId!: string;
}
