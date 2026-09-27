import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

/**
 * Tenant/mobile-app provisioning and configuration DTOs.
 *
 * SECURITY SHAPE: nothing in these DTOs can set a trusted release/build/
 * signing state. There is no "state", "sha256", "signingReference",
 * "signatureVerified", "storeState" or "health" field on any client input —
 * trusted state is produced exclusively by the services that own the
 * evidence. With the global whitelist validation pipe, a client attempting to
 * post those fields has them stripped, and the services never read them.
 */

export class CreateMobileAppDto {
  @ApiProperty({ description: 'Display name for the white-label app (mobile-safe length)' })
  @IsString()
  @Length(2, 30)
  readonly displayName!: string;

  @ApiPropertyOptional({ description: 'Optional short description' })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  readonly description?: string;

  @ApiPropertyOptional({ description: 'Optional partner id recorded for partner-scoped access' })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-fA-F-]{8,64}$/)
  readonly partnerId?: string;

  @ApiPropertyOptional({ description: 'Client idempotency key; the server derives its own deterministic key too' })
  @IsOptional()
  @IsString()
  @Length(8, 128)
  readonly idempotencyKey?: string;
}

export class UpdateMobileAppDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 30)
  readonly displayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 200)
  readonly description?: string;
}

export class MobileAppVersionMetadataDto {
  @ApiProperty({ description: 'Marketing version (X.Y.Z)' })
  @IsString()
  @Matches(/^\d+\.\d+\.\d+$/, { message: 'marketingVersion must be X.Y.Z' })
  readonly marketingVersion!: string;

  @ApiProperty({ description: 'Android versionCode (monotonic)' })
  @IsInt()
  @Min(1)
  @Max(2_100_000_000)
  readonly androidVersionCode!: number;

  @ApiProperty({ description: 'iOS build number (monotonic)' })
  @IsInt()
  @Min(1)
  @Max(2_100_000_000)
  readonly iosBuildNumber!: number;
}

const PLATFORMS = ['ANDROID', 'IOS'] as const;
const ENVIRONMENTS = ['DEVELOPMENT', 'STAGING', 'PRODUCTION'] as const;

/** Shared platform/environment validators (single source for DTOs). */
export const MOBILE_PLATFORM_VALUES = PLATFORMS;
export const MOBILE_ENVIRONMENT_VALUES = ENVIRONMENTS;
export const MOBILE_PLATFORM_DECORATOR = () =>
  IsIn(PLATFORMS as unknown as string[]);
export const MOBILE_ENVIRONMENT_DECORATOR = () =>
  IsIn(ENVIRONMENTS as unknown as string[]);
