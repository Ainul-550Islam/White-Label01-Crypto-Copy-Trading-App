import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

import {
  MOBILE_ENVIRONMENT_DECORATOR,
  MOBILE_ENVIRONMENT_VALUES,
  MOBILE_PLATFORM_DECORATOR,
  MOBILE_PLATFORM_VALUES,
} from './mobile-app.dto';

/**
 * Release lifecycle action DTOs.
 *
 * Clients can ask for actions; they can never supply the OUTCOMES. There is
 * deliberately no field here for approval decisions, publication state,
 * rollout percentages, evidence, or crash metrics — the approval service, the
 * store adapter evidence path, and the telemetry ingest own those truths.
 */
export class CreateMobileReleaseDto {
  @ApiProperty({ description: 'Verified artifact to release' })
  @IsString()
  @Matches(/^[0-9a-fA-F-]{8,64}$/)
  readonly artifactId!: string;

  @ApiPropertyOptional({ description: 'Human release notes (customer-visible)' })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  readonly releaseNotes?: string;
}

export class ApproveReleaseDto {
  @ApiPropertyOptional({ description: 'Why the release is approved' })
  @IsOptional()
  @IsString()
  @Length(4, 500)
  readonly reason?: string;
}

export class RejectReleaseDto {
  @ApiProperty({ description: 'Why the release is rejected (recorded verbatim in the audit)' })
  @IsString()
  @Length(4, 500)
  readonly reason!: string;
}

export class StoreSubmitDto {
  @ApiProperty({ enum: ['GOOGLE_PLAY', 'APPLE_APP_STORE', 'ENTERPRISE_DISTRIBUTION', 'INTERNAL_DISTRIBUTION'] })
  @IsIn(['GOOGLE_PLAY', 'APPLE_APP_STORE', 'ENTERPRISE_DISTRIBUTION', 'INTERNAL_DISTRIBUTION'])
  readonly provider!: string;

  @ApiProperty({ description: 'Store track (production / beta / enterprise ...)' })
  @IsString()
  @Length(2, 64)
  readonly track!: string;
}

export class StoreStatusDto {
  @ApiProperty({ enum: ['GOOGLE_PLAY', 'APPLE_APP_STORE', 'ENTERPRISE_DISTRIBUTION', 'INTERNAL_DISTRIBUTION'] })
  @IsIn(['GOOGLE_PLAY', 'APPLE_APP_STORE', 'ENTERPRISE_DISTRIBUTION', 'INTERNAL_DISTRIBUTION'])
  readonly provider!: string;
}

export class RollbackDto {
  @ApiPropertyOptional({ description: 'Explicit previous release to restore; omit for the latest eligible' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-fA-F-]{8,64}$/)
  readonly targetReleaseId?: string;
}

/**
 * Trusted fields that must never appear on action DTOs. The security spec
 * asserts this list stays empty of outcomes and that services ignore client
 * attempts to post them (global whitelist validation strips them first).
 */
export const FORBIDDEN_ACTION_FIELDS: readonly string[] = Object.freeze([
  'decision',
  'platformApproval',
  'published',
  'publicationState',
  'rolloutCompleted',
  'observedPercentage',
  'evidence',
  'crashCount',
  'health',
]);
