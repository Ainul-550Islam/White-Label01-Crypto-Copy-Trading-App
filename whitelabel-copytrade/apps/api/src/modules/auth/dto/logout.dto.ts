import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class LogoutDto {
  @ApiPropertyOptional({
    description: 'Revoke every session for this account, not just the current device.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  allDevices: boolean = false;
}
