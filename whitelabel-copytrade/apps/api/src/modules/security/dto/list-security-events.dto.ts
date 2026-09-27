import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { SecurityEventType, SecuritySeverity } from '@wlct/shared-types';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListSecurityEventsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SecurityEventType })
  @IsOptional()
  @IsEnum(SecurityEventType)
  type?: SecurityEventType;

  @ApiPropertyOptional({ enum: SecuritySeverity })
  @IsOptional()
  @IsEnum(SecuritySeverity)
  severity?: SecuritySeverity;

  @ApiPropertyOptional({ description: 'Filter by resolution state.' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value === 'true' : Boolean(value)))
  @IsBoolean()
  resolved?: boolean;

  @ApiPropertyOptional({ description: 'Filter by affected user id.' })
  @IsOptional()
  @IsUUID('4')
  userId?: string;
}
