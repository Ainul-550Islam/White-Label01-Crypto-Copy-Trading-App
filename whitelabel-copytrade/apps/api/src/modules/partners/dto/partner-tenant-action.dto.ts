import { IsString, IsEnum, IsOptional, MinLength, IsBoolean, IsObject, MaxLength } from 'class-validator';
import { PartnerTenantRelationshipType } from '../partner.types';

export class AssignTenantDto {
  @IsString()
  partnerId!: string;

  @IsString()
  tenantId!: string;

  @IsEnum(PartnerTenantRelationshipType)
  relationshipType!: PartnerTenantRelationshipType;

  @IsString()
  assignedBy!: string;

  @IsString()
  @MinLength(5)
  correlationId!: string;

  @IsString()
  @MinLength(8)
  idempotencyKey!: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsOptional()
  @IsString()
  referralCode?: string;

  @IsOptional()
  @IsString()
  attributionId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class TransferTenantDto {
  @IsString()
  tenantId!: string;

  @IsString()
  fromPartnerId!: string;

  @IsString()
  toPartnerId!: string;

  @IsString()
  transferredBy!: string;

  @IsString()
  @MinLength(5)
  correlationId!: string;

  @IsString()
  @MinLength(10)
  reason!: string;

  @IsString()
  @MinLength(8)
  idempotencyKey!: string;
}

export class UnassignTenantDto {
  @IsString()
  partnerId!: string;

  @IsString()
  unassignedBy!: string;

  @IsString()
  @MinLength(5)
  correlationId!: string;

  @IsString()
  @MinLength(10)
  reason!: string;
}

export class CreateTenantForPartnerDto {
  @IsString()
  partnerId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(63)
  slug!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  legalName?: string;

  @IsString()
  @IsEnum(PartnerTenantRelationshipType)
  relationshipType!: PartnerTenantRelationshipType;

  @IsString()
  contactEmail!: string;

  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsString()
  createdBy!: string;

  @IsString()
  correlationId!: string;

  @IsString()
  @MinLength(8)
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsOptional()
  @IsString()
  referralCode?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
