import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDate, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { KycStatus, UserStatus } from '@wlct/shared-types';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListUsersDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({ enum: KycStatus })
  @IsOptional()
  @IsEnum(KycStatus)
  kycStatus?: KycStatus;

  @ApiPropertyOptional({ description: 'Filter by role key, e.g. TRADER.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  roleKey?: string;

  @ApiPropertyOptional({ description: 'Created at or after this timestamp.' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  createdFrom?: Date;

  @ApiPropertyOptional({ description: 'Created at or before this timestamp.' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  createdTo?: Date;

  @ApiPropertyOptional({ description: 'Include soft-deleted accounts.', default: false })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value === 'true' : Boolean(value)))
  @IsBoolean()
  includeDeleted: boolean = false;
}
