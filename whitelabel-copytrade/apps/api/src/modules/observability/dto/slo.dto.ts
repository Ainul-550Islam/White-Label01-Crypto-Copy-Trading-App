/**
 * Request shapes for the Part 10 SLO surface.
 *
 * The DTO layer is SYNTAX; the service layer is SEMANTICS. The patterns here
 * are the cheap, universal refusals (types, lengths, digit-only micros);
 * the one real validator - the canonical builder that computes the checksum
 * the row is identified by - runs in the service, because "valid" for an SLO
 * means "this exact definition, spelled exactly this way", and there is no
 * second authority that could check it in parallel.
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { SLO_ID_PATTERN } from '../slo.constants';

const OBJECTIVE_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,4})?(?:[eE][+-]?\d+)?$/;
const MICROS_PATTERN = /^(?:0|[1-9]\d{0,18})$/;
const SLO_SERVICES = ['api', 'queues', 'market-data', 'trading-engine'] as const;

export class UpdateSloConfigDto {
  @ApiProperty({
    description:
      'Compliance objective as a plain decimal PERCENT string ("99.5"). Floats are refused by this shape on purpose: the value is checksummed, and a number that has been through IEEE-754 is not the promise anyone configured.',
    example: '99.5',
  })
  @Matches(OBJECTIVE_PATTERN, {
    message: 'objective must be a decimal string with at most 4 fraction digits',
  })
  objective!: string;

  @ApiProperty({ description: 'Evaluation window in minutes (5..10080).', example: 1440 })
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(10_080)
  windowMinutes!: number;

  @ApiProperty({ description: 'Short (paging) window in minutes, inside the long window.', example: 60 })
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(10_080)
  shortWindowMinutes!: number;

  @ApiProperty({ description: 'Owning team identifier.', example: 'platform-sre' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  owner!: string;

  @ApiProperty({ description: 'What the objective means, for whoever reads it at 3am.', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  description!: string;

  @ApiProperty({ description: 'The counting rule for a good sample, in words.', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  goodEvent!: string;

  @ApiProperty({ description: 'The counting rule for a bad sample, in words.', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  badEvent!: string;

  @ApiPropertyOptional({ description: 'Warning burn threshold, integer ppm (default 1_000_000 = 1.0x).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  warningBurnPpm?: number;

  @ApiPropertyOptional({ description: 'Critical burn threshold, integer ppm (default 2_000_000 = 2.0x).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  criticalBurnPpm?: number;

  @ApiPropertyOptional({
    description:
      'Freshness indicators: the age budget in MICROSECONDS as an integer string. Forbidden on count indicators; required on freshness ones.',
  })
  @IsOptional()
  @Transform(({ value }) => (value === null ? undefined : value))
  @Matches(MICROS_PATTERN, { message: 'maxAgeMicros must be an integer string' })
  maxAgeMicros?: string | null;

  @ApiPropertyOptional({
    description: 'Latency-compliance indicators: the compliance threshold in microseconds (integer string).',
  })
  @IsOptional()
  @Transform(({ value }) => (value === null ? undefined : value))
  @Matches(MICROS_PATTERN, { message: 'latencyThresholdMicros must be an integer string' })
  latencyThresholdMicros?: string | null;

  @ApiPropertyOptional({
    description:
      'Enablement. Flipping it never changes the checksummed identity of the objective (the version bumps; the promise does not).',
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class ListSloDefinitionsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SLO_SERVICES, description: 'Filter by owning service.' })
  @IsOptional()
  @IsIn(SLO_SERVICES as unknown as string[])
  service?: string;

  @ApiPropertyOptional({ description: 'Include disabled definitions (default: only enabled).' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeDisabled?: boolean;
}

export class ListSloEvaluationsDto extends PaginationQueryDto {}

export class PruneSloDto {
  @ApiPropertyOptional({
    description:
      'Retention in days for evaluation rows (definitions are NEVER pruned). The service clamps to a 7-day floor regardless of what the payload says.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  retentionDays?: number;
}

/** Route params validated at the edge with the SAME bounded identifier
 *  pattern the canonical builder uses - a malformed sloId is a 400 before it
 *  ever reaches a query, and a valid-shaped-but-unknown id is the service's
 *  honest 404. */
export class SloParamDto {
  @ApiProperty({ example: 'api.availability' })
  @Matches(SLO_ID_PATTERN, { message: 'sloId must be a bounded lowercase identifier' })
  sloId!: string;
}
