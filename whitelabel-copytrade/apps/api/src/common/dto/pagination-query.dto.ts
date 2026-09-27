import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PAGINATION_DEFAULTS } from '@wlct/config';

/** Shared query DTO for every list endpoint. */
export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: PAGINATION_DEFAULTS.PAGE })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be at least 1' })
  page: number = PAGINATION_DEFAULTS.PAGE;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: PAGINATION_DEFAULTS.MAX_LIMIT,
    default: PAGINATION_DEFAULTS.LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(PAGINATION_DEFAULTS.MAX_LIMIT, {
    message: `limit must not exceed ${PAGINATION_DEFAULTS.MAX_LIMIT}`,
  })
  limit: number = PAGINATION_DEFAULTS.LIMIT;

  @ApiPropertyOptional({ description: 'Field to sort by. Unknown fields are ignored.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'sortOrder must be "asc" or "desc"' })
  sortOrder: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ description: 'Free-text search term.' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;
}
