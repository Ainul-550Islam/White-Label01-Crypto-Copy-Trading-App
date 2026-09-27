import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsEnum, IsBoolean } from 'class-validator';
import { TenantStatus } from '@wlct/shared-types';

export class SaasTenantListQueryDto {
  @ApiPropertyOptional({ enum: TenantStatus })
  @IsOptional()
  @IsEnum(TenantStatus)
  status?: TenantStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  planCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  includeDeleted?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  sortOrder?: 'asc' | 'desc';
}

export class SaasSubscriptionSummaryDto {
  @ApiPropertyOptional() id: string | null;
  @ApiProperty() tenantId: string;
  @ApiPropertyOptional() planId: string | null;
  @ApiPropertyOptional() planCode: string | null;
  @ApiPropertyOptional() planName: string | null;
  @ApiPropertyOptional() status: string | null;
  @ApiPropertyOptional() interval: string | null;
  @ApiPropertyOptional() currentPeriodStart: string | null;
  @ApiPropertyOptional() currentPeriodEnd: string | null;
  @ApiPropertyOptional() trialEndsAt: string | null;
  @ApiProperty() cancelAtPeriodEnd: boolean;
  @ApiProperty() isActive: boolean;
  @ApiProperty() isPastDue: boolean;
  @ApiPropertyOptional() renewalDate: string | null;
}

export class SaasBrandingStateDto {
  @ApiProperty() tenantId: string;
  @ApiProperty() appName: string;
  @ApiPropertyOptional() logoUrl: string | null;
  @ApiPropertyOptional() logoDarkUrl: string | null;
  @ApiPropertyOptional() faviconUrl: string | null;
  @ApiProperty() primaryColor: string;
  @ApiProperty() secondaryColor: string;
  @ApiProperty() accentColor: string;
  @ApiProperty() backgroundColor: string;
  @ApiProperty() textColor: string;
  @ApiProperty() fontFamily: string;
  @ApiProperty() themeMode: string;
  @ApiPropertyOptional() supportEmail: string | null;
  @ApiProperty() hasCustomCss: boolean;
  @ApiPropertyOptional() updatedAt: string | null;
}

export class SaasCustomDomainStateDto {
  @ApiProperty() tenantId: string;
  @ApiPropertyOptional() domain: string | null;
  @ApiProperty() isPrimary: boolean;
  @ApiPropertyOptional() status: string | null;
  @ApiPropertyOptional() verifiedAt: string | null;
  @ApiProperty() verificationRequired: boolean;
  @ApiProperty() entitlementAllowed: boolean;
  @ApiPropertyOptional() entitlementReason: string | null;
}

export class SaasWhiteLabelStateDto {
  @ApiProperty() tenantId: string;
  @ApiProperty() eligible: boolean;
  @ApiProperty() entitlementAllowed: boolean;
  @ApiPropertyOptional() entitlementReason: string | null;
  @ApiProperty() provisioningState: string;
  @ApiPropertyOptional() requestedAt: string | null;
  @ApiPropertyOptional() enabledAt: string | null;
  @ApiPropertyOptional() configuration: Record<string, unknown> | null;
}

export class SaasUsageSummaryDto {
  @ApiProperty() tenantId: string;
  @ApiPropertyOptional() maxUsers: number | null;
  @ApiProperty() currentUsers: number;
  @ApiPropertyOptional() maxTraders: number | null;
  @ApiProperty() currentTraders: number;
  @ApiPropertyOptional() apiRequestsPerMinute: number | null;
  @ApiPropertyOptional() websocketConnections: number | null;
}

export class SaasTenantSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() slug: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() legalName: string | null;
  @ApiProperty({ enum: TenantStatus }) status: TenantStatus;
  @ApiProperty() lifecycleState: string;
  @ApiProperty() provisioningState: string;
  @ApiPropertyOptional() contactEmail: string | null;
  @ApiPropertyOptional() countryCode: string | null;
  @ApiProperty() defaultCurrency: string;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
  @ApiPropertyOptional({ type: SaasSubscriptionSummaryDto }) subscriptionSummary: SaasSubscriptionSummaryDto | null;
  @ApiPropertyOptional({ type: SaasBrandingStateDto }) brandingState: SaasBrandingStateDto | null;
  @ApiPropertyOptional({ type: SaasCustomDomainStateDto }) customDomainState: SaasCustomDomainStateDto | null;
  @ApiPropertyOptional({ type: SaasWhiteLabelStateDto }) whiteLabelState: SaasWhiteLabelStateDto | null;
  @ApiPropertyOptional({ type: SaasUsageSummaryDto }) usageSummary: SaasUsageSummaryDto | null;
}

export class SaasTenantDetailDto extends SaasTenantSummaryDto {
  @ApiProperty({ type: [Object] }) entitlements: any[];
  @ApiProperty({ type: [Object] }) limits: any[];
  @ApiProperty({ type: [String] }) availableActions: string[];
  @ApiPropertyOptional() billingCustomer: any | null;
  @ApiProperty({ type: [Object] }) domains: any[];
  @ApiProperty({ type: [Object] }) featureFlags: any[];
}

export class SaasTenantListResponseDto {
  @ApiProperty({ type: [SaasTenantSummaryDto] }) items: SaasTenantSummaryDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}

export class ProvisionTenantRequestDto {
  @ApiProperty({ example: 'acme-capital' })
  @IsString()
  slug: string;

  @ApiProperty({ example: 'Acme Capital' })
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  legalName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  countryCode?: string;

  @ApiPropertyOptional({ default: 'USD' })
  @IsOptional()
  @IsString()
  defaultCurrency?: string;

  @ApiPropertyOptional({ description: 'Canonical plan ID from catalog' })
  @IsOptional()
  @IsString()
  planId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingName?: string;

  @ApiPropertyOptional({ description: 'Idempotency key' })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class ProvisionTenantResponseDto {
  @ApiProperty() tenantId: string;
  @ApiProperty() tenantSlug: string;
  @ApiProperty() provisioningState: string;
  @ApiPropertyOptional() subscriptionId: string | null;
  @ApiPropertyOptional() planId: string | null;
  @ApiPropertyOptional() brandingId: string | null;
  @ApiProperty() message: string;
  @ApiProperty() idempotent: boolean;
}
