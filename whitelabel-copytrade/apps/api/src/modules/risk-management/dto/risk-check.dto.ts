import { IsString, IsEnum, IsOptional, IsNumberString, IsUUID, MaxLength, Matches } from 'class-validator';

/**
 * Pre-trade risk check DTO — safe fields only.
 * Client may submit: symbol, side, qty, order type, price, account, strategy, follower, env.
 * Server resolves authoritative balance/position/leverage/exposure/price/compliance.
 * Client CANNOT submit trusted balance/PnL/risk score.
 */

export enum RiskCheckSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum RiskCheckOrderType {
  MARKET = 'MARKET',
  LIMIT = 'LIMIT',
  STOP = 'STOP',
  STOP_LIMIT = 'STOP_LIMIT',
}

export enum RiskCheckEnvironment {
  PAPER = 'PAPER',
  LIVE = 'LIVE',
}

export class RiskCheckDto {
  @IsString()
  @MaxLength(32)
  @Matches(/^[A-Z0-9\-_\/]+$/, { message: 'symbol must be uppercase alphanumeric with - _ /' })
  symbol!: string;

  @IsEnum(RiskCheckSide)
  side!: RiskCheckSide;

  @IsNumberString()
  @MaxLength(32)
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'quantity must be decimal string' })
  quantity!: string;

  @IsEnum(RiskCheckOrderType)
  orderType!: RiskCheckOrderType;

  @IsOptional()
  @IsNumberString()
  @MaxLength(32)
  @Matches(/^-?\d+(\.\d+)?$/, { message: 'price must be decimal string' })
  price?: string;

  @IsUUID()
  accountId!: string;

  @IsOptional()
  @IsUUID()
  strategyId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  traderId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  followerId?: string;

  @IsOptional()
  @IsEnum(RiskCheckEnvironment)
  environment?: RiskCheckEnvironment;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  requestId?: string;
}

export class RiskCheckResponseDto {
  decision!: string;
  state!: string;
  blockingReasons!: string[];
  warnings!: string[];
  ruleIds!: string[];
  policyVersion!: string;
  timestamp!: string;
  details!: Array<{
    dimension: string;
    decision: string;
    state: string;
    ruleId: string;
    policyVersion: string;
    current: string | null;
    threshold: string | null;
    severity: string;
    reason: string;
  }>;
}
