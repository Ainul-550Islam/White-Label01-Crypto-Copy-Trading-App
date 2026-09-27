import { IsString, IsOptional, IsEnum, IsNotEmpty, MinLength, IsDateString, Matches } from 'class-validator';

/**
 * Validated DTOs for deposits, funding requests, withdrawal requests, approvals, rejection reasons,
 * and external references. Financial values use strict decimal validation and cannot set completion state.
 */

export class CreateFundingRequestDto {
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @IsOptional()
  @IsString()
  clientProfileId?: string;

  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'requestedAmount must be a valid decimal string' })
  requestedAmount!: string;

  @IsString()
  @IsNotEmpty()
  currency!: string;

  @IsOptional()
  @IsString()
  externalReference?: string;

  @IsOptional()
  @IsString()
  sourceType?: string;

  @IsOptional()
  @IsString()
  destinationAddress?: string;

  @IsOptional()
  metadata?: any;

  // Cannot set completion state — server authoritative
  // The following are NOT allowed as client input:
  // - state (REQUESTED is server-set)
  // - approvedAmount, confirmedAmount, settledAmount (server/external authority)
  // - approvedAt, confirmedAt, etc.
}

export class CreateWithdrawalRequestDto {
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @IsOptional()
  @IsString()
  clientProfileId?: string;

  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'requestedAmount must be a valid decimal string' })
  requestedAmount!: string;

  @IsString()
  @IsNotEmpty()
  currency!: string;

  @IsOptional()
  @IsString()
  destinationAddress?: string;

  @IsOptional()
  @IsString()
  destinationType?: string;

  @IsOptional()
  @IsString()
  externalReference?: string;

  @IsOptional()
  @IsString()
  sourceType?: string;

  @IsOptional()
  metadata?: any;
}

export class TransitionFundingRequestDto {
  @IsString()
  @IsNotEmpty()
  fundingRequestId!: string;

  @IsString()
  @IsNotEmpty()
  toState!: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/)
  approvedAmount?: string;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/)
  submittedAmount?: string;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/)
  confirmedAmount?: string;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/)
  settledAmount?: string;

  @IsOptional()
  @IsString()
  externalReference?: string;
}

export class TransitionWithdrawalRequestDto {
  @IsString()
  @IsNotEmpty()
  withdrawalRequestId!: string;

  @IsString()
  @IsNotEmpty()
  toState!: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/)
  approvedAmount?: string;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/)
  confirmedAmount?: string;

  @IsOptional()
  @IsString()
  externalReference?: string;
}

export class ApproveFundingDto {
  @IsOptional()
  @IsString()
  fundingRequestId?: string;

  @IsOptional()
  @IsString()
  withdrawalRequestId?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d+)?$/)
  approvedAmount?: string;
}

export class RejectFundingDto {
  @IsOptional()
  @IsString()
  fundingRequestId?: string;

  @IsOptional()
  @IsString()
  withdrawalRequestId?: string;

  @IsString()
  @MinLength(5)
  reason!: string;
}

export class ReconciliationRequestDto {
  @IsOptional()
  @IsString()
  fundingRequestId?: string;

  @IsOptional()
  @IsString()
  withdrawalRequestId?: string;

  @IsOptional()
  @IsString()
  reconciliationType?: string = 'FUNDING_SETTLEMENT';
}
