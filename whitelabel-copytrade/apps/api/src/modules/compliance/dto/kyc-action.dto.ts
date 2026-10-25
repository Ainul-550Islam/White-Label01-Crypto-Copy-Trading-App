// # Responsibility: declare validated API inputs while keeping arbitrary extension metadata unknown until runtime narrowing.
import { IsOptional, IsString, IsNotEmpty, IsObject, MaxLength } from 'class-validator';


/**
 * DTOs for KYC actions: start verification, retry, callback, status check
 * No client-supplied VERIFIED/CLEAR/score, no PII in logs, safe metadata only
 */

export class StartKycVerificationDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsOptional()
  @IsString()
  jurisdiction?: string;

  @IsOptional()
  @IsString()
  levelName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;

  @IsOptional()
  @IsObject()
  safeMetadata?: Record<string, unknown>;
}

export class RetryKycVerificationDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class KycProviderCallbackDto {
  @IsString()
  @IsNotEmpty()
  providerReference: string;

  @IsString()
  @IsNotEmpty()
  provider: string;

  @IsString()
  @IsNotEmpty()
  status: string;

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsObject()
  safeMetadata?: Record<string, unknown>;

  // Note: no VERIFIED from client claim - server must verify via provider
}

export class ScreenPersonDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsOptional()
  @IsString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  jurisdiction?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class ScreenTransactionDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  transactionId: string;

  @IsString()
  @IsNotEmpty()
  transactionType: string;

  @IsString()
  @IsNotEmpty()
  amount: string;

  @IsString()
  @IsNotEmpty()
  currency: string;

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsString()
  counterparty?: string;

  @IsOptional()
  @IsString()
  jurisdiction?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class CreateComplianceCaseDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsString()
  @IsNotEmpty()
  caseType: string;

  @IsOptional()
  @IsString()
  riskLevel?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  safeSummary: string;

  @IsOptional()
  @IsString()
  severity?: string;

  @IsOptional()
  @IsString()
  jurisdiction?: string;

  @IsOptional()
  @IsString({ each: true })
  ruleIds?: string[];

  @IsOptional()
  @IsObject({ each: true })
  sourceRefs?: Array<{ type: string; id: string }>;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}
