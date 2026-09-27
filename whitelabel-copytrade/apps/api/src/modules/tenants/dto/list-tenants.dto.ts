import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { TenantStatus } from '@wlct/shared-types';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListTenantsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TenantStatus })
  @IsOptional()
  @IsEnum(TenantStatus)
  status?: TenantStatus;

  @ApiPropertyOptional({ description: 'Include soft-deleted tenants.', default: false })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value === 'true' : Boolean(value)))
  @IsBoolean()
  includeDeleted: boolean = false;
}
