import { IsString, IsOptional, IsEnum, IsUUID, IsInt, Min, Max, IsDateString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Validated queries for orders, fills, trades, lifecycle, rejection, reconciliation views.
 * Tenant isolation mandatory.
 */

export enum OmsOrderStateQueryDto {
  CREATED = 'CREATED',
  VALIDATING = 'VALIDATING',
  APPROVED = 'APPROVED',
  SUBMITTED = 'SUBMITTED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  FILLED = 'FILLED',
  CANCEL_REQUESTED = 'CANCEL_REQUESTED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  REPLACED = 'REPLACED',
  FAILED = 'FAILED',
  RECONCILIATION_REQUIRED = 'RECONCILIATION_REQUIRED',
}

export enum RejectionCategoryQueryDto {
  RISK_BLOCK = 'RISK_BLOCK',
  COMPLIANCE_BLOCK = 'COMPLIANCE_BLOCK',
  SECURITY_BLOCK = 'SECURITY_BLOCK',
  INVALID_SYMBOL = 'INVALID_SYMBOL',
  INVALID_PRECISION = 'INVALID_PRECISION',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  INSUFFICIENT_MARGIN = 'INSUFFICIENT_MARGIN',
  EXCHANGE_REJECT = 'EXCHANGE_REJECT',
  RATE_LIMITED = 'RATE_LIMITED',
  MARKET_DATA_STALE = 'MARKET_DATA_STALE',
  LIVE_GATE_BLOCK = 'LIVE_GATE_BLOCK',
  CREDENTIAL_FAILURE = 'CREDENTIAL_FAILURE',
  UNKNOWN = 'UNKNOWN',
}

export enum ReconciliationStateQueryDto {
  PENDING = 'PENDING',
  RESOLVED = 'RESOLVED',
  ALL = 'ALL',
}

export class OmsOrdersQueryDto {
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsUUID()
  strategyId?: string;

  @IsOptional()
  @IsUUID()
  traderId?: string;

  @IsOptional()
  @IsUUID()
  followerId?: string;

  @IsOptional()
  @IsUUID()
  subscriptionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  symbol?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  venue?: string;

  @IsOptional()
  @IsEnum(OmsOrderStateQueryDto)
  state?: OmsOrderStateQueryDto;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class OmsFillsQueryDto {
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  symbol?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  venue?: string;

  @IsOptional()
  @IsUUID()
  orderIntentId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class OmsTradesQueryDto {
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  symbol?: string;

  @IsOptional()
  @IsUUID()
  strategyId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  state?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class OmsRejectionQueryDto {
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  symbol?: string;

  @IsOptional()
  @IsEnum(RejectionCategoryQueryDto)
  category?: RejectionCategoryQueryDto;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class OmsReconciliationQueryDto {
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;

  @IsOptional()
  @IsEnum(ReconciliationStateQueryDto)
  state?: ReconciliationStateQueryDto;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class OmsExecutionQualityQueryDto {
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  symbol?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  venue?: string;

  @IsOptional()
  @IsUUID()
  strategyId?: string;

  @IsOptional()
  @IsUUID()
  traderId?: string;

  @IsOptional()
  @IsDateString()
  from!: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class OmsAuditQueryDto {
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  symbol?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  eventType?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
