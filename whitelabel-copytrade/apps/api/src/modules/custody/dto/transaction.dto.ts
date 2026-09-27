import { IsString, IsOptional, IsEnum, IsObject, IsNumber } from 'class-validator';

export class CreateTransactionDto {
  @IsString()
  tenantId!: string;

  @IsOptional()
  @IsString()
  walletId?: string | null;

  @IsString()
  assetId!: string;

  @IsString()
  networkId!: string;

  @IsEnum(['IN', 'OUT', 'INTERNAL'])
  direction!: string;

  @IsString()
  amount!: string;

  @IsOptional()
  @IsString()
  transactionHash?: string | null;

  @IsOptional()
  @IsString()
  blockHash?: string | null;

  @IsOptional()
  @IsString()
  blockNumber?: string | null;

  @IsOptional()
  @IsString()
  providerReference?: string | null;

  @IsOptional()
  @IsObject()
  providerMetadata?: any;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsNumber()
  confirmationCount?: number;

  @IsOptional()
  @IsNumber()
  requiredConfirmationCount?: number;

  @IsOptional()
  @IsString()
  estimatedFee?: string | null;

  @IsOptional()
  @IsString()
  actualFee?: string | null;

  @IsOptional()
  @IsString()
  feeAsset?: string | null;

  @IsOptional()
  @IsString()
  sourceWorkflowType?: string | null;

  @IsOptional()
  @IsString()
  sourceWorkflowId?: string | null;

  @IsOptional()
  @IsString()
  depositId?: string | null;

  @IsOptional()
  @IsString()
  withdrawalId?: string | null;

  @IsOptional()
  @IsObject()
  evidence?: any;
}

export class TransitionTransactionDto {
  @IsString()
  transactionId!: string;

  @IsEnum(['PENDING', 'QUEUED', 'SUBMITTED', 'OBSERVED', 'CONFIRMING', 'CONFIRMED', 'FINAL', 'FAILED', 'REORGED', 'REJECTED', 'CANCELLED'])
  toState!: string;

  @IsOptional()
  @IsString()
  blockHash?: string | null;

  @IsOptional()
  @IsString()
  blockNumber?: string | null;

  @IsOptional()
  @IsNumber()
  confirmationCount?: number | null;

  @IsOptional()
  @IsString()
  actualFee?: string | null;

  @IsOptional()
  @IsString()
  failureReason?: string | null;

  @IsOptional()
  @IsString()
  operatorId?: string | null;

  @IsOptional()
  @IsString()
  correlationId?: string | null;
}

export class ObserveDepositDto {
  @IsString()
  assetId!: string;

  @IsString()
  networkId!: string;

  @IsString()
  toAddress!: string;

  @IsOptional()
  @IsString()
  fromAddress?: string | null;

  @IsString()
  amount!: string;

  @IsString()
  transactionHash!: string;

  @IsOptional()
  @IsString()
  blockHash?: string | null;

  @IsOptional()
  @IsString()
  blockNumber?: string | null;

  @IsOptional()
  @IsString()
  providerReference?: string | null;

  @IsOptional()
  @IsString()
  fundingRequestId?: string | null;

  @IsOptional()
  @IsString()
  walletId?: string | null;

  @IsOptional()
  @IsString()
  addressId?: string | null;
}

export class CreateInternalTransferDto {
  @IsString()
  sourceWalletId!: string;

  @IsString()
  destinationWalletId!: string;

  @IsString()
  assetId!: string;

  @IsOptional()
  @IsString()
  networkId?: string | null;

  @IsString()
  amount!: string;

  @IsOptional()
  @IsString()
  operatorId?: string | null;

  @IsOptional()
  @IsString()
  reason?: string | null;

  @IsOptional()
  @IsString()
  authorizationReference?: string | null;

  @IsOptional()
  @IsString()
  correlationId?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: any;
}

export class CreateSweepDto {
  @IsString()
  sourceWalletId!: string;

  @IsString()
  destinationWalletId!: string;

  @IsString()
  assetId!: string;

  @IsString()
  networkId!: string;

  @IsString()
  amount!: string;

  @IsOptional()
  @IsString()
  operatorId?: string | null;

  @IsOptional()
  @IsString()
  reason?: string | null;

  @IsOptional()
  @IsString()
  correlationId?: string | null;
}

export class CreateReserveDto {
  @IsOptional()
  @IsString()
  walletId?: string | null;

  @IsString()
  assetId!: string;

  @IsOptional()
  @IsString()
  networkId?: string | null;

  @IsString()
  reserveType!: string;

  @IsString()
  requiredAmount!: string;

  @IsOptional()
  @IsString()
  operatorId?: string | null;

  @IsOptional()
  @IsString()
  reason?: string | null;

  @IsOptional()
  @IsString()
  correlationId?: string | null;
}

export class ListTransactionsDto {
  @IsOptional()
  @IsString()
  walletId?: string;

  @IsOptional()
  @IsString()
  assetId?: string;

  @IsOptional()
  @IsString()
  networkId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  direction?: string;

  @IsOptional()
  @IsString()
  sourceWorkflowId?: string;

  @IsOptional()
  @IsNumber()
  page?: number;

  @IsOptional()
  @IsNumber()
  limit?: number;
}
