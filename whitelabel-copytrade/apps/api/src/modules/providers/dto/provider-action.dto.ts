/**
 * Provider Action DTOs
 * Validated platform-only provider actions such as health check,
 * reconciliation trigger, provider enable/disable request, webhook replay request,
 * and controlled retry request. Trusted provider result cannot be client-supplied.
 */

import { IsString, IsEnum, IsOptional, IsBoolean, IsNotEmpty, MinLength, MaxLength, IsObject } from 'class-validator';
import { ProviderDomain, ProviderName } from '../provider.types';

export class TriggerHealthCheckDto {
  @IsEnum(ProviderDomain)
  domain: ProviderDomain;

  @IsEnum(ProviderName)
  provider: ProviderName;

  @IsString()
  @IsNotEmpty()
  correlationId: string;

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsString()
  triggeredBy?: string;
}

export class TriggerReconciliationDto {
  @IsEnum(ProviderDomain)
  domain: ProviderDomain;

  @IsEnum(ProviderName)
  provider: ProviderName;

  @IsString()
  @IsNotEmpty()
  correlationId: string;

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsString()
  @IsNotEmpty()
  triggeredBy: string;

  @IsOptional()
  @IsString()
  fromDate?: string;

  @IsOptional()
  @IsString()
  toDate?: string;

  @IsOptional()
  @IsObject()
  safeParams?: Record<string, unknown>;
}

export class ProviderEnableDisableDto {
  @IsEnum(ProviderDomain)
  domain: ProviderDomain;

  @IsEnum(ProviderName)
  provider: ProviderName;

  @IsBoolean()
  enabled: boolean;

  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason: string;

  @IsString()
  @IsNotEmpty()
  correlationId: string;

  @IsString()
  @IsNotEmpty()
  operatorId: string;

  @IsOptional()
  @IsString()
  approvalReference?: string;
}

export class WebhookReplayRequestDto {
  @IsEnum(ProviderDomain)
  domain: ProviderDomain;

  @IsEnum(ProviderName)
  provider: ProviderName;

  @IsString()
  @IsNotEmpty()
  eventId: string;

  @IsString()
  @IsNotEmpty()
  correlationId: string;

  @IsString()
  @IsNotEmpty()
  operatorId: string;

  @IsString()
  @MinLength(10)
  reason: string;

  @IsOptional()
  @IsString()
  approvalReference?: string;
}

export class ControlledRetryRequestDto {
  @IsEnum(ProviderDomain)
  domain: ProviderDomain;

  @IsEnum(ProviderName)
  provider: ProviderName;

  @IsString()
  @IsNotEmpty()
  providerReference: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;

  @IsString()
  @IsNotEmpty()
  correlationId: string;

  @IsString()
  @IsNotEmpty()
  operatorId: string;

  @IsString()
  @MinLength(10)
  reason: string;

  @IsOptional()
  @IsString()
  approvalReference?: string;

  @IsOptional()
  @IsObject()
  safeParams?: Record<string, unknown>;
}

export class ProviderConfigurationStatusDto {
  @IsOptional()
  @IsEnum(ProviderDomain)
  domain?: ProviderDomain;

  @IsOptional()
  @IsEnum(ProviderName)
  provider?: ProviderName;

  @IsString()
  @IsNotEmpty()
  correlationId: string;
}
