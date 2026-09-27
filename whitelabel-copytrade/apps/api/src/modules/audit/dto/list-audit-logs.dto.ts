import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AuditOutcome } from '@wlct/shared-types';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListAuditLogsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by acting user id.' })
  @IsOptional()
  @IsUUID('4')
  actorId?: string;

  @ApiPropertyOptional({ description: 'Filter by audit action, e.g. USER_LOGIN_SUCCEEDED.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  action?: string;

  @ApiPropertyOptional({ enum: AuditOutcome })
  @IsOptional()
  @IsEnum(AuditOutcome)
  outcome?: AuditOutcome;

  @ApiPropertyOptional({ description: 'Filter by resource type, e.g. Tenant.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  resourceType?: string;

  @ApiPropertyOptional({ description: 'Filter by resource identifier.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  resourceId?: string;

  @ApiPropertyOptional({ description: 'Inclusive lower bound (ISO-8601).' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ description: 'Inclusive upper bound (ISO-8601).' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @ApiPropertyOptional({
    description: 'Platform operators only: inspect a specific tenant.',
  })
  @IsOptional()
  @IsUUID('4')
  tenantId?: string;
}
