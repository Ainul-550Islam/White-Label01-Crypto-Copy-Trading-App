import { IsString, IsEnum, IsOptional, IsBoolean, IsUUID, MaxLength, Matches, IsNotEmpty } from 'class-validator';

/**
 * Validated DTO for order intent creation.
 * Client cannot supply trusted: fill status, order status, provider order ID, execution confirmation, risk approval.
 */

export enum OrderIntentSideDto {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum OrderIntentTypeDto {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
  STOP = 'STOP',
  STOP_LIMIT = 'STOP_LIMIT',
}

export enum OrderIntentTifDto {
  GTC = 'GTC',
  IOC = 'IOC',
  FOK = 'FOK',
  DAY = 'DAY',
}

export enum OrderIntentEnvDto {
  PAPER = 'PAPER',
  LIVE = 'LIVE',
}

export enum OrderIntentSourceDto {
  STRATEGY = 'STRATEGY',
  COPY_TRADING = 'COPY_TRADING',
  MANUAL = 'MANUAL',
  RESEARCH_PROMOTION = 'RESEARCH_PROMOTION',
}

export class CreateOrderIntentDto {
  @IsUUID()
  @IsNotEmpty()
  accountId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(/^[A-Z0-9\-\/_]+$/, { message: 'symbol must be uppercase alphanumeric with -/_' })
  symbol!: string;

  @IsEnum(OrderIntentSideDto)
  side!: OrderIntentSideDto;

  @IsEnum(OrderIntentTypeDto)
  orderType!: OrderIntentTypeDto;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+(\.\d+)?$/, { message: 'quantity must be decimal string' })
  @MaxLength(40)
  quantity!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d+)?$/, { message: 'price must be decimal string' })
  @MaxLength(40)
  price?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d+)?$/, { message: 'stopPrice must be decimal string' })
  @MaxLength(40)
  stopPrice?: string;

  @IsOptional()
  @IsEnum(OrderIntentTifDto)
  timeInForce?: OrderIntentTifDto;

  @IsOptional()
  @IsBoolean()
  reduceOnly?: boolean;

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
  @MaxLength(128)
  signalId?: string;

  @IsEnum(OrderIntentEnvDto)
  environment!: OrderIntentEnvDto;

  @IsOptional()
  @IsEnum(OrderIntentSourceDto)
  source?: OrderIntentSourceDto;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  correlationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  requestId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  venue?: string;

  // Forbidden fields are NOT in DTO — client cannot supply trusted execution state
  // No: fillStatus, orderStatus, providerOrderId, executionConfirmation, riskApproval
}
