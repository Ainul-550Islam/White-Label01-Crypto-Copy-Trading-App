import { IsString, IsOptional, IsNumber, IsObject, IsEnum } from 'class-validator';

export class SubmitWithdrawalDto {
  @IsString()
  custodyWithdrawalId!: string;

  @IsOptional()
  @IsString()
  operatorId?: string | null;

  @IsOptional()
  @IsString()
  correlationId?: string | null;
}

export class EvaluateWithdrawalEligibilityDto {
  @IsOptional()
  @IsString()
  accountId?: string | null;

  @IsOptional()
  @IsString()
  walletId?: string | null;

  @IsString()
  assetId!: string;

  @IsString()
  networkId!: string;

  @IsString()
  amount!: string;

  @IsString()
  destinationAddress!: string;

  @IsOptional()
  @IsString()
  operatorId?: string | null;
}

export class ApproveInternalTransferDto {
  @IsString()
  transferId!: string;

  @IsString()
  approverId!: string;

  @IsOptional()
  @IsString()
  reason?: string | null;

  @IsOptional()
  @IsString()
  correlationId?: string | null;
}

export class SettleInternalTransferDto {
  @IsString()
  transferId!: string;

  @IsOptional()
  @IsString()
  operatorId?: string | null;

  @IsOptional()
  @IsString()
  settlementReference?: string | null;

  @IsOptional()
  @IsString()
  correlationId?: string | null;
}

export class ApproveSweepDto {
  @IsString()
  sweepId!: string;

  @IsString()
  approverId!: string;

  @IsOptional()
  @IsString()
  reason?: string | null;

  @IsOptional()
  @IsString()
  correlationId?: string | null;
}

export class ExecuteSweepDto {
  @IsString()
  sweepId!: string;

  @IsOptional()
  @IsString()
  operatorId?: string | null;

  @IsOptional()
  @IsString()
  correlationId?: string | null;
}

export class FinalizeSettlementDto {
  @IsOptional()
  @IsString()
  depositId?: string;

  @IsOptional()
  @IsString()
  custodyWithdrawalId?: string;

  @IsOptional()
  @IsString()
  operatorId?: string | null;

  @IsOptional()
  @IsString()
  correlationId?: string | null;
}

export class RunReconciliationDto {
  @IsOptional()
  @IsString()
  assetId?: string;

  @IsOptional()
  @IsString()
  networkId?: string;

  @IsOptional()
  @IsString()
  walletId?: string;

  @IsOptional()
  @IsString()
  operatorId?: string | null;

  @IsOptional()
  @IsString()
  correlationId?: string | null;
}

export class ResolveReconciliationDto {
  @IsString()
  reconciliationId!: string;

  @IsString()
  operatorId!: string;

  @IsString()
  resolutionNote!: string;

  @IsOptional()
  @IsString()
  correctiveAction?: string | null;
}

export class EstimateFeeDto {
  @IsString()
  assetId!: string;

  @IsString()
  networkId!: string;

  @IsString()
  fromAddress!: string;

  @IsString()
  toAddress!: string;

  @IsString()
  amount!: string;
}
