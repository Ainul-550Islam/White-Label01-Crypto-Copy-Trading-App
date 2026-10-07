// # Validates withdrawal request and admin review payloads
// # NEW — DTOs for approve/reject/release-hold/broadcast/confirm/fail
import { IsString, IsOptional, MinLength } from 'class-validator';

export class ApproveWithdrawalDto {
  @IsString()
  custodyWithdrawalId!: string;

  @IsString()
  approverId!: string;

  @IsOptional()
  @IsString()
  reason?: string | null;

  @IsOptional()
  @IsString()
  correlationId?: string | null;
}

export class RejectWithdrawalDto {
  @IsString()
  custodyWithdrawalId!: string;

  @IsString()
  operatorId!: string;

  @IsString()
  @MinLength(5)
  reason!: string;

  @IsOptional()
  @IsString()
  correlationId?: string | null;
}

export class ReleaseHoldWithdrawalDto {
  @IsString()
  custodyWithdrawalId!: string;

  @IsString()
  operatorId!: string;

  @IsString()
  @MinLength(5)
  reason!: string;

  @IsOptional()
  @IsString()
  correlationId?: string | null;
}

export class BroadcastWithdrawalDto {
  @IsString()
  custodyWithdrawalId!: string;

  @IsOptional()
  @IsString()
  operatorId?: string | null;

  @IsOptional()
  @IsString()
  correlationId?: string | null;
}

export class ConfirmWithdrawalDto {
  @IsString()
  custodyWithdrawalId!: string;

  @IsString()
  txHash!: string;

  @IsOptional()
  @IsString()
  operatorId?: string | null;
}

export class FailWithdrawalDto {
  @IsString()
  custodyWithdrawalId!: string;

  @IsString()
  @MinLength(5)
  failureReason!: string;

  @IsOptional()
  @IsString()
  operatorId?: string | null;
}

export function validateWithdrawalActionReason(
  action: 'APPROVE' | 'REJECT' | 'RELEASE_HOLD' | 'BROADCAST' | 'CONFIRM' | 'FAIL',
  reason?: string | null,
): { valid: boolean; error?: string } {
  if (['REJECT', 'RELEASE_HOLD', 'FAIL'].includes(action)) {
    if (!reason || reason.trim().length < 5) {
      return {
        valid: false,
        error: `Withdrawal action ${action} requires an operator reason of at least 5 characters.`,
      };
    }
  }
  return { valid: true };
}
