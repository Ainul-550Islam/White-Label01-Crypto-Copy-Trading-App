import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

import {
  MOBILE_ENVIRONMENT_DECORATOR,
  MOBILE_ENVIRONMENT_VALUES,
  MOBILE_PLATFORM_DECORATOR,
  MOBILE_PLATFORM_VALUES,
} from './mobile-app.dto';

/**
 * Query filters for the mobile-release read surfaces.
 *
 * tenantId is NEVER accepted from the body/path on tenant-scoped routes (the
 * tenant context is server-resolved); this DTO exists for PLATFORM-side
 * listing where a platform operator may filter by tenant explicitly.
 */
export class MobileAppQueryDto {
  @ApiPropertyOptional({ enum: MOBILE_PLATFORM_VALUES })
  @IsOptional()
  @MOBILE_PLATFORM_DECORATOR()
  readonly platform?: (typeof MOBILE_PLATFORM_VALUES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['PROVISIONING', 'CONFIGURED', 'READY_FOR_BUILD', 'BUILDING', 'BUILD_FAILED', 'BUILT', 'SIGNING', 'SIGNED', 'SECURITY_REVIEW', 'READY_FOR_RELEASE', 'ACTIVE', 'SUSPENDED', 'ARCHIVED'])
  readonly state?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  readonly page: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  readonly pageSize: number = 20;
}

export class MobileBuildQueryDto {
  @ApiPropertyOptional({ description: 'Filter by application' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-fA-F-]{8,64}$/)
  readonly applicationId?: string;

  @ApiPropertyOptional({ enum: MOBILE_PLATFORM_VALUES })
  @IsOptional()
  @MOBILE_PLATFORM_DECORATOR()
  readonly platform?: (typeof MOBILE_PLATFORM_VALUES)[number];

  @ApiPropertyOptional({ enum: MOBILE_ENVIRONMENT_VALUES })
  @IsOptional()
  @MOBILE_ENVIRONMENT_DECORATOR()
  readonly environment?: (typeof MOBILE_ENVIRONMENT_VALUES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['QUEUED', 'VALIDATING', 'BUILDING', 'FAILED', 'BUILT', 'VERIFYING', 'VERIFIED', 'REJECTED'])
  readonly state?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  readonly page: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  readonly pageSize: number = 20;
}

export class MobileReleaseQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-fA-F-]{8,64}$/)
  readonly applicationId?: string;

  @ApiPropertyOptional({ enum: MOBILE_PLATFORM_VALUES })
  @IsOptional()
  @MOBILE_PLATFORM_DECORATOR()
  readonly platform?: (typeof MOBILE_PLATFORM_VALUES)[number];

  @ApiPropertyOptional({ enum: MOBILE_ENVIRONMENT_VALUES })
  @IsOptional()
  @MOBILE_ENVIRONMENT_DECORATOR()
  readonly environment?: (typeof MOBILE_ENVIRONMENT_VALUES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['DRAFT', 'REVIEW', 'APPROVAL_REQUIRED', 'APPROVED', 'SUBMITTING', 'SUBMITTED', 'PUBLISHED', 'ROLLED_OUT', 'HALTED', 'ROLLED_BACK', 'REJECTED'])
  readonly state?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  readonly page: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  readonly pageSize: number = 20;
}

export class MobileCrashQueryDto {
  @ApiPropertyOptional({ description: 'Filter crashes by release' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-fA-F-]{8,64}$/)
  readonly releaseId?: string;

  @ApiPropertyOptional({ description: 'Evaluation window in minutes (1-1440)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  readonly windowMinutes?: number;
}

export class MobileReconciliationQueryDto {
  @ApiPropertyOptional({ description: 'Platform-side: restrict the run to one tenant' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-fA-F-]{8,64}$/)
  readonly tenantId?: string;

  @ApiPropertyOptional({ description: 'Replay an existing run id (idempotent)' })
  @IsOptional()
  @IsString()
  @Length(6, 64)
  readonly runId?: string;
}

