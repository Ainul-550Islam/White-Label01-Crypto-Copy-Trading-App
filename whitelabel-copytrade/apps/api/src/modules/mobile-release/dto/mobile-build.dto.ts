import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

import {
  MOBILE_ENVIRONMENT_DECORATOR,
  MOBILE_ENVIRONMENT_VALUES,
  MOBILE_PLATFORM_DECORATOR,
  MOBILE_PLATFORM_VALUES,
} from './mobile-app.dto';

/**
 * Build request DTOs.
 *
 * Clients can choose platform/environment/mode/version and (optionally) the
 * source commit — they can NEVER supply trusted build state (VERIFIED),
 * artifact hashes, signing results or log references. Those are produced by
 * the build/verification/signing services from real executions.
 */
export class CreateMobileBuildDto {
  @ApiProperty({ enum: MOBILE_PLATFORM_VALUES })
  @MOBILE_PLATFORM_DECORATOR()
  readonly platform!: (typeof MOBILE_PLATFORM_VALUES)[number];

  @ApiProperty({ enum: MOBILE_ENVIRONMENT_VALUES })
  @MOBILE_ENVIRONMENT_DECORATOR()
  readonly environment!: (typeof MOBILE_ENVIRONMENT_VALUES)[number];

  @ApiProperty({ enum: ['debug', 'release'] })
  @IsIn(['debug', 'release'])
  readonly buildMode: 'debug' | 'release' = 'release';

  @ApiProperty({ description: 'Marketing version X.Y.Z (must match pubspec)' })
  @IsString()
  @Matches(/^\d+\.\d+\.\d+$/)
  readonly versionName!: string;

  @ApiProperty({ description: 'Android versionCode / iOS build number' })
  @IsInt()
  @Min(1)
  @Max(2_100_000_000)
  readonly versionCode!: number;

  @ApiPropertyOptional({ description: 'iOS build number when it differs from versionCode' })
  @IsOptional()
  @IsInt()
  @Min(1)
  readonly iosBuildNumber?: number;

  @ApiPropertyOptional({ description: 'Source revision (40-hex SHA) this build stamps' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{40}$/)
  readonly commitSha?: string;
}

export class VerifyArtifactDto {
  @ApiProperty({ description: 'Artifact id to re-verify from bytes' })
  @IsString()
  @Matches(/^[0-9a-fA-F-]{8,64}$/)
  readonly artifactId!: string;
}

export class ScanArtifactDto {
  @ApiProperty({ description: 'Artifact id to scan' })
  @IsString()
  @Matches(/^[0-9a-fA-F-]{8,64}$/)
  readonly artifactId!: string;
}

/**
 * Trusted-state guard for reviewers: these fields are deliberately ABSENT
 * from every client DTO — documented as a negative contract so a code review
 * (and the security spec) can assert they never reappear.
 */
export const FORBIDDEN_CLIENT_FIELDS: readonly string[] = Object.freeze([
  'state',
  'sha256',
  'artifactSha256',
  'signingState',
  'signingReference',
  'signatureVerified',
  'securityScanState',
  'storeState',
  'releaseState',
  'rolloutState',
  'health',
  'observedPercentage',
  'verified',
]);
