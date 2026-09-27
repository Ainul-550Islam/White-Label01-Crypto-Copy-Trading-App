import { IsString, IsOptional, IsEnum, IsNotEmpty, MinLength, IsDateString } from 'class-validator';
import { AccountRestrictionType, RestrictionScope } from '../client-lifecycle.types';

/**
 * Validated DTOs for activate/restrict/suspend/restore/close/review/bind/unbind operations.
 * Trusted server state is never client-supplied.
 */

export class ActivateAccountDto {
  @IsString()
  @IsNotEmpty()
  accountId!: string;
}

export class RestrictAccountDto {
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @IsOptional()
  @IsString()
  clientProfileId?: string;

  @IsEnum(AccountRestrictionType)
  restrictionType!: AccountRestrictionType;

  @IsOptional()
  @IsEnum(RestrictionScope)
  scope?: RestrictionScope = RestrictionScope.ACCOUNT;

  @IsString()
  @MinLength(5)
  reason!: string;

  @IsString()
  @IsNotEmpty()
  source!: string;

  @IsOptional()
  @IsDateString()
  effectiveAt?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class SuspendAccountDto {
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @IsString()
  @MinLength(5)
  reason!: string;

  @IsOptional()
  @IsString()
  reasonCode?: string;

  @IsString()
  @IsNotEmpty()
  source!: string;

  @IsOptional()
  @IsDateString()
  effectiveAt?: string;
}

export class RestoreAccountDto {
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @IsString()
  @MinLength(5)
  reason!: string;

  @IsOptional()
  verificationEvidence?: any;
}

export class CloseAccountDto {
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @IsString()
  @MinLength(5)
  reason!: string;

  @IsOptional()
  @IsString()
  correlationId?: string;
}

export class CancelClosureDto {
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @IsString()
  @MinLength(5)
  reason!: string;
}

export class BindExchangeAccountDto {
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @IsString()
  @IsNotEmpty()
  exchangeAccountId!: string;
}

export class UnbindExchangeAccountDto {
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class BindPortfolioDto {
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @IsString()
  @IsNotEmpty()
  portfolioId!: string;
}

export class UnbindPortfolioDto {
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class CreateOwnershipDto {
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @IsOptional()
  @IsString()
  clientProfileId?: string;

  @IsString()
  @IsNotEmpty()
  ownerId!: string;

  @IsString()
  @IsNotEmpty()
  ownerType!: string;

  @IsOptional()
  @IsString()
  ownershipType?: string = 'OWNER';

  @IsOptional()
  @IsString()
  source?: string;
}

export class CreateRelationshipDto {
  @IsString()
  @IsNotEmpty()
  sourceId!: string;

  @IsString()
  @IsNotEmpty()
  sourceType!: string;

  @IsString()
  @IsNotEmpty()
  targetId!: string;

  @IsString()
  @IsNotEmpty()
  targetType!: string;

  @IsString()
  @IsNotEmpty()
  relationshipType!: string;

  @IsOptional()
  @IsString()
  clientProfileId?: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  source?: string;
}

export class CreateReviewDto {
  @IsOptional()
  @IsString()
  clientProfileId?: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsString()
  @IsNotEmpty()
  reviewType!: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsDateString()
  reviewPeriodStart?: string;

  @IsOptional()
  @IsDateString()
  reviewPeriodEnd?: string;

  @IsOptional()
  evidenceReferences?: string[];

  @IsOptional()
  @IsDateString()
  nextReviewDate?: string;
}

export class DecideReviewDto {
  @IsString()
  @IsNotEmpty()
  reviewId!: string;

  @IsString()
  @IsNotEmpty()
  decision!: string;

  @IsString()
  @MinLength(5)
  reason!: string;

  @IsOptional()
  @IsDateString()
  nextReviewDate?: string;
}
