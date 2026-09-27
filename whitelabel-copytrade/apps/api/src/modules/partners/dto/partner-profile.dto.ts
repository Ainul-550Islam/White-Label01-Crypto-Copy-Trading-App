import { IsString, IsEnum, IsOptional, MinLength, IsEmail, IsUUID, IsObject, MaxLength, IsIn } from 'class-validator';
import { PartnerType, PartnerState, PartnerAgreementState, PartnerTenantRelationshipType, PartnerUserRole } from '../partner.types';

export class CreatePartnerProfileDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  legalName?: string;

  @IsEnum(PartnerType)
  type!: PartnerType;

  @IsString()
  @MinLength(5)
  ownerUserId!: string;

  @IsEmail()
  contactEmail!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  website?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  countryCode?: string;

  @IsOptional()
  @IsString()
  taxId?: string;

  @IsOptional()
  @IsEmail()
  billingEmail?: string;

  @IsString()
  @IsIn(['USD', 'EUR', 'GBP', 'JPY', 'USDT', 'USDC', 'CAD', 'AUD', 'BTC', 'ETH'])
  currency!: string;

  @IsString()
  @MinLength(8)
  idempotencyKey!: string;

  @IsString()
  @MinLength(5)
  correlationId!: string;

  @IsString()
  @MinLength(3)
  createdBy!: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdatePartnerProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  legalName?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsEmail()
  billingEmail?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsString()
  correlationId!: string;

  @IsString()
  updatedBy!: string;
}

export class TransitionPartnerStateDto {
  @IsEnum(PartnerState)
  targetState!: PartnerState;

  @IsString()
  @MinLength(5)
  correlationId!: string;

  @IsString()
  @MinLength(3)
  actorId!: string;

  @IsOptional()
  @IsString()
  actorRole?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  reason?: string;
}

export class CreatePartnerAgreementDto {
  @IsString()
  partnerId!: string;

  @IsObject()
  commissionPolicy!: any;

  @IsOptional()
  pricingRules?: any[];

  @IsObject()
  payoutTerms!: any;

  @IsOptional()
  attributionRules?: any[];

  @IsString()
  effectiveFrom!: string;

  @IsOptional()
  @IsString()
  effectiveTo?: string;

  @IsOptional()
  @IsString()
  jurisdiction?: string;

  @IsString({ each: true })
  responsibilities!: string[];

  @IsOptional()
  @IsString()
  terminationClause?: string;

  @IsString()
  createdBy!: string;

  @IsString()
  correlationId!: string;
}

export class TransitionAgreementStateDto {
  @IsEnum(PartnerAgreementState)
  targetState!: PartnerAgreementState;

  @IsString()
  correlationId!: string;

  @IsString()
  actorId!: string;

  @IsOptional()
  @IsString()
  actorRole?: string;
}

export class InvitePartnerUserDto {
  @IsString()
  partnerId!: string;

  @IsString()
  userId!: string;

  @IsEnum(PartnerUserRole)
  role!: PartnerUserRole;

  @IsString()
  invitedBy!: string;

  @IsString()
  correlationId!: string;

  @IsString()
  @MinLength(8)
  idempotencyKey!: string;
}

export class ChangePartnerUserRoleDto {
  @IsEnum(PartnerUserRole)
  newRole!: PartnerUserRole;

  @IsString()
  changedBy!: string;

  @IsString()
  correlationId!: string;
}
