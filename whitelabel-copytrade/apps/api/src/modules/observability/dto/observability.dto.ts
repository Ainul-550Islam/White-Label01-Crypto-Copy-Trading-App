import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Equals, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { ALERT_FORCE_RESOLVE_PHRASE } from '@wlct/config';

import { ALERT_SEVERITIES, ALERT_STATES } from '../alert.constants';

/**
 * Request shapes for the Part 9 operations API.
 *
 * The mutations are tiny - acknowledging and force-resolving an alert - and
 * both are shaped by the same principle the risk console follows: an action
 * that dismisses evidence must be expensive to do accidentally. Acknowledge
 * requires a short reason (it records judgement, not authority); force-resolve
 * requires the typed phrase AND a long reason, because it closes a condition
 * the platform is still observing. Reads carry only pagination and exact
 * enum filters: no free-text search that could leak into a query shape.
 */

export class ListOpsAlertsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ALERT_STATES })
  @IsOptional()
  @IsIn(ALERT_STATES)
  state?: (typeof ALERT_STATES)[number];

  @ApiPropertyOptional({ enum: ALERT_SEVERITIES })
  @IsOptional()
  @IsIn(ALERT_SEVERITIES)
  severity?: (typeof ALERT_SEVERITIES)[number];

  @ApiPropertyOptional({ description: 'Component filter, e.g. "market-data".' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{1,64}$/, { message: 'component must be a bounded identifier' })
  component?: string;
}

export class AcknowledgeAlertDto {
  @ApiProperty({
    minLength: 5,
    maxLength: 500,
    description: 'Who/what is on it. Recorded on the alert and in the audit trail.',
  })
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(5, 500)
  reason!: string;
}

export class ForceResolveAlertDto {
  @ApiProperty({
    minLength: 20,
    maxLength: 500,
    description:
      'Why this may be closed WITHOUT an observed recovery. Twenty characters ' +
      'is the floor because a one-liner is not a justification for dismissing ' +
      'an open operational condition.',
  })
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(20, 500)
  reason!: string;

  @ApiProperty({
    description: `Must equal "${ALERT_FORCE_RESOLVE_PHRASE}" verbatim.`,
    example: ALERT_FORCE_RESOLVE_PHRASE,
  })
  @IsString()
  // Equals, not a regex: the phrase contains spaces and a regex over
  // operator-editable constants is how escapes go wrong. Exact match or 400.
  @Equals(ALERT_FORCE_RESOLVE_PHRASE, {
    message: `confirmPhrase must be exactly "${ALERT_FORCE_RESOLVE_PHRASE}"`,
  })
  confirmPhrase!: string;
}

export class ListOpsIncidentsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'REVIEWING', 'CLOSED'] })
  @IsOptional()
  @IsIn(['OPEN', 'REVIEWING', 'CLOSED'])
  status?: 'OPEN' | 'REVIEWING' | 'CLOSED';
}

export class SetIncidentStatusDto {
  @ApiProperty({ enum: ['OPEN', 'REVIEWING', 'CLOSED'] })
  @IsIn(['OPEN', 'REVIEWING', 'CLOSED'])
  status!: 'OPEN' | 'REVIEWING' | 'CLOSED';

  @ApiPropertyOptional({
    minLength: 10,
    maxLength: 500,
    description: 'Required when closing; recorded on the incident and in the audit trail.',
  })
  @IsOptional()
  @IsString()
  @Length(10, 500)
  note?: string;
}
