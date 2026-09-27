import { IsString, IsOptional, IsEnum, IsNumber, Min, Max, IsIn, IsBoolean } from 'class-validator';
import { PartnerType, PartnerState, PartnerTenantRelationshipType, PartnerTenantRelationshipState, PartnerCommissionState, PartnerSettlementState, PartnerPayoutState, PartnerCampaignState } from '../partner.types';

export class PartnerQueryDto {
  @IsOptional()
  @IsEnum(PartnerType)
  type?: PartnerType;

  @IsOptional()
  @IsEnum(PartnerState)
  state?: PartnerState;

  @IsOptional()
  @IsString()
  ownerUserId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @IsOptional()
  @IsString()
  correlationId?: string;
}

export class PartnerTenantQueryDto {
  @IsString()
  partnerId!: string;

  @IsOptional()
  @IsEnum(PartnerTenantRelationshipState)
  state?: PartnerTenantRelationshipState;

  @IsOptional()
  @IsEnum(PartnerTenantRelationshipType)
  relationshipType?: PartnerTenantRelationshipType;

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class PartnerCommissionQueryDto {
  @IsString()
  partnerId!: string;

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsEnum(PartnerCommissionState)
  state?: PartnerCommissionState;

  @IsOptional()
  @IsString()
  settlementId?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  periodStart?: string;

  @IsOptional()
  @IsString()
  periodEnd?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class PartnerSettlementQueryDto {
  @IsString()
  partnerId!: string;

  @IsOptional()
  @IsEnum(PartnerSettlementState)
  state?: PartnerSettlementState;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  periodStart?: string;

  @IsOptional()
  @IsString()
  periodEnd?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;
}

export class PartnerPayoutQueryDto {
  @IsString()
  partnerId!: string;

  @IsOptional()
  @IsString()
  settlementId?: string;

  @IsOptional()
  @IsEnum(PartnerPayoutState)
  state?: PartnerPayoutState;

  @IsOptional()
  @IsString()
  correlationId?: string;
}

export class PartnerAnalyticsQueryDto {
  @IsString()
  partnerId!: string;

  @IsString()
  @IsIn(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'LIFETIME'])
  granularity!: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'LIFETIME';

  @IsString()
  periodStart!: string;

  @IsString()
  periodEnd!: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;
}

export class PartnerPortalQueryDto {
  @IsString()
  partnerId!: string;

  @IsString()
  userId!: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  periodStart?: string;

  @IsOptional()
  @IsString()
  periodEnd?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;
}

export class ReconciliationQueryDto {
  @IsString()
  partnerId!: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  severity?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;
}
