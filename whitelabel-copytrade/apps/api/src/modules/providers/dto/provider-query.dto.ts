/**
 * Provider Query DTOs
 * Validated provider health/capability/reconciliation query DTOs.
 * No secret/config credential fields accepted from clients.
 */

import { IsString, IsEnum, IsOptional, IsBoolean, IsArray } from 'class-validator';
import { ProviderDomain, ProviderName } from '../provider.types';

export class ProviderHealthQueryDto {
  @IsOptional()
  @IsEnum(ProviderDomain)
  domain?: ProviderDomain;

  @IsOptional()
  @IsEnum(ProviderName)
  provider?: ProviderName;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsString()
  tenantId?: string;
}

export class ProviderCapabilityQueryDto {
  @IsOptional()
  @IsEnum(ProviderDomain)
  domain?: ProviderDomain;

  @IsOptional()
  @IsEnum(ProviderName)
  provider?: ProviderName;

  @IsOptional()
  @IsString()
  correlationId?: string;
}

export class ProviderReconciliationQueryDto {
  @IsEnum(ProviderDomain)
  domain: ProviderDomain;

  @IsEnum(ProviderName)
  provider: ProviderName;

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsString()
  correlationId: string;

  @IsOptional()
  @IsString()
  fromDate?: string;

  @IsOptional()
  @IsString()
  toDate?: string;
}

export class ProviderObservationQueryDto {
  @IsOptional()
  @IsEnum(ProviderDomain)
  domain?: ProviderDomain;

  @IsOptional()
  @IsEnum(ProviderName)
  provider?: ProviderName;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsString()
  providerReference?: string;
}

export class WebhookDiagnosticsQueryDto {
  @IsEnum(ProviderDomain)
  domain: ProviderDomain;

  @IsEnum(ProviderName)
  provider: ProviderName;

  @IsOptional()
  @IsString()
  eventId?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;
}
