import { IsOptional, IsString, IsEmail, IsEnum, IsNotEmpty, MinLength, IsPhoneNumber } from 'class-validator';

/**
 * Validated DTOs for client-profile creation/update.
 * Clients cannot submit trusted lifecycle state, compliance state, risk approval, audit metadata, balances, or funding settlement state.
 */

export enum ClientProfileTypeDto {
  CLIENT = 'CLIENT',
  INVESTOR = 'INVESTOR',
  INSTITUTIONAL = 'INSTITUTIONAL',
  MANAGED_ACCOUNT = 'MANAGED_ACCOUNT',
}

export class CreateClientProfileDto {
  @IsOptional()
  @IsEnum(ClientProfileTypeDto)
  clientType?: ClientProfileTypeDto = ClientProfileTypeDto.CLIENT;

  @IsOptional()
  @IsString()
  @MinLength(1)
  legalName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  displayName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsOptional()
  @IsString()
  externalIdentityRef?: string;

  // Clients cannot submit trusted lifecycle state, compliance state, risk approval, audit metadata, balances, or funding settlement state
  // The following fields are intentionally NOT allowed:
  // - status (server authoritative)
  // - complianceStatus (from ComplianceModule)
  // - riskStatus (from RiskManagementModule)
  // - kycState, amlState (from ComplianceModule)
  // - balances (from Exchange/Finance authority)
  // - fundingConfirmed (from payment authority)
}

export class UpdateClientProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  legalName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  displayName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsOptional()
  @IsString()
  externalIdentityRef?: string;
}

export class CreateInstitutionalAccountDto {
  @IsString()
  @IsNotEmpty()
  clientProfileId!: string;

  @IsOptional()
  @IsString()
  accountType?: string = 'TRADING';

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  ownerType?: string;
}
