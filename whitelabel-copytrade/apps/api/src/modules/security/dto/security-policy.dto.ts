import { IsOptional, IsString, IsBoolean, IsInt, IsArray, IsNotEmpty, MaxLength, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Validated tenant/platform security policy configuration DTOs for MFA/session/device/API-key/SSO controls.
 * Structured configuration only, no executable expressions/scripts.
 */

export class CreateSecurityPolicyDto {
  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  policyVersion: string;

  @IsOptional()
  @IsBoolean()
  mfaRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  mfaForPrivilegedRoles?: boolean;

  @IsOptional()
  @IsBoolean()
  mfaForSensitiveOperations?: boolean;

  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(2592000)
  sessionAbsoluteTimeoutSec?: number;

  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(86400)
  sessionIdleTimeoutSec?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxConcurrentSessions?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  deviceTrustDurationDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  apiKeyExpirationDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  apiKeyRotationDays?: number;

  @IsOptional()
  @IsBoolean()
  ssoEnforced?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedSsoDomains?: string[];

  @IsOptional()
  @IsBoolean()
  jitProvisioning?: boolean;

  @IsOptional()
  @IsBoolean()
  privilegedReauthRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  securityNotifications?: boolean;

  @IsOptional()
  @IsInt()
  @Min(8)
  @Max(128)
  passwordMinLength?: number;
}

export class UpdateSecurityPolicyDto {
  @IsOptional()
  @IsBoolean()
  mfaRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  mfaForPrivilegedRoles?: boolean;

  @IsOptional()
  @IsBoolean()
  mfaForSensitiveOperations?: boolean;

  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(2592000)
  sessionAbsoluteTimeoutSec?: number;

  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(86400)
  sessionIdleTimeoutSec?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxConcurrentSessions?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  deviceTrustDurationDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  apiKeyExpirationDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  apiKeyRotationDays?: number;

  @IsOptional()
  @IsBoolean()
  ssoEnforced?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedSsoDomains?: string[];

  @IsOptional()
  @IsBoolean()
  jitProvisioning?: boolean;

  @IsOptional()
  @IsBoolean()
  privilegedReauthRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  securityNotifications?: boolean;

  @IsOptional()
  @IsInt()
  @Min(8)
  @Max(128)
  passwordMinLength?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SecurityPolicyQueryDto {
  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SessionQueryDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class DeviceQueryDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class SecurityEventQueryDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  severity?: string;

  @IsOptional()
  @IsString()
  fromDate?: string;

  @IsOptional()
  @IsString()
  toDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class ThreatQueryDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  riskLevel?: string;

  @IsOptional()
  @IsString()
  ruleId?: string;

  @IsOptional()
  @IsString()
  resolved?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
