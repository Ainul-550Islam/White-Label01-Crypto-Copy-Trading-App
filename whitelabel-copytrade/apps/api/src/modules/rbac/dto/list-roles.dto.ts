import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { RoleScope } from '@wlct/shared-types';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListRolesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: RoleScope })
  @IsOptional()
  @IsEnum(RoleScope)
  scope?: RoleScope;

  @ApiPropertyOptional({ description: 'Include built-in system roles.', default: true })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value !== 'false' : Boolean(value)))
  @IsBoolean()
  includeSystem: boolean = true;
}
