import { IsString, IsOptional, IsEnum, IsUUID, MaxLength, Matches, IsNotEmpty } from 'class-validator';

/**
 * Validated actions: cancel, replace, retry, recovery, acknowledge exception, operator note
 * No arbitrary status mutation.
 */

export enum OrderActionTypeDto {
  CANCEL = 'CANCEL',
  REPLACE = 'REPLACE',
  RETRY = 'RETRY',
  RECOVERY = 'RECOVERY',
  ACKNOWLEDGE_EXCEPTION = 'ACKNOWLEDGE_EXCEPTION',
  OPERATOR_NOTE = 'OPERATOR_NOTE',
}

export enum RecoveryTypeDto {
  RECONCILE = 'RECONCILE',
  RESUBMIT = 'RESUBMIT',
  FORCE_CANCEL = 'FORCE_CANCEL',
  MANUAL_REVIEW = 'MANUAL_REVIEW',
}

export class CancelOrderDto {
  @IsUUID()
  @IsNotEmpty()
  intentId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  correlationId?: string;
}

export class ReplaceOrderDto {
  @IsUUID()
  @IsNotEmpty()
  intentId!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d+)?$/, { message: 'newQuantity must be decimal string' })
  @MaxLength(40)
  newQuantity?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d+)?$/, { message: 'newPrice must be decimal string' })
  @MaxLength(40)
  newPrice?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d+)?$/, { message: 'newStopPrice must be decimal string' })
  @MaxLength(40)
  newStopPrice?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  correlationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  requestId?: string;
}

export class RetryOrderDto {
  @IsUUID()
  @IsNotEmpty()
  intentId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class RecoveryOrderDto {
  @IsUUID()
  @IsNotEmpty()
  intentId!: string;

  @IsEnum(RecoveryTypeDto)
  recoveryType!: RecoveryTypeDto;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  correlationId?: string;
}

export class AcknowledgeExceptionDto {
  @IsUUID()
  @IsNotEmpty()
  operationalId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  note!: string;
}

export class OperatorNoteDto {
  @IsUUID()
  @IsNotEmpty()
  operationalId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  note!: string;
}

export class AcknowledgeReconciliationDto {
  @IsUUID()
  @IsNotEmpty()
  reconciliationId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  resolutionNote!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  resolution?: string; // RESOLVED, IGNORED
}
