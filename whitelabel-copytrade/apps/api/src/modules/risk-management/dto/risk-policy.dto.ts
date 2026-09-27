import { IsString, IsOptional, IsEnum, IsNumber, IsBoolean, IsObject, MaxLength, MinLength, Matches, IsNumberString } from 'class-validator';

/**
 * Risk policy DTO — validated thresholds exposure/margin/leverage/drawdown/daily loss/concentration/correlation/VaR/stress/breaker/stale-data.
 * Structured only, no executable.
 */

export enum RiskPolicyScopeDto {
  PLATFORM = 'PLATFORM',
  TENANT = 'TENANT',
  TRADER = 'TRADER',
  STRATEGY = 'STRATEGY',
  FOLLOWER = 'FOLLOWER',
}

export class RiskPolicyThresholdsDto {
  @IsOptional()
  @IsNumberString()
  maxGrossExposure?: string;

  @IsOptional()
  @IsNumberString()
  maxNetExposure?: string;

  @IsOptional()
  @IsNumberString()
  maxSymbolExposure?: string;

  @IsOptional()
  @IsNumberString()
  maxVenueExposure?: string;

  @IsOptional()
  @IsNumberString()
  maxAccountExposure?: string;

  @IsOptional()
  @IsNumberString()
  maxStrategyExposure?: string;

  @IsOptional()
  @IsNumberString()
  maxTraderExposure?: string;

  @IsOptional()
  @IsNumberString()
  maxFollowerExposure?: string;

  @IsOptional()
  @IsNumberString()
  maxPositionNotional?: string;

  @IsOptional()
  @IsNumberString()
  maxOrderNotional?: string;

  @IsOptional()
  @IsNumber()
  maxOpenOrders?: number;

  @IsOptional()
  @IsNumberString()
  maxLeverageGross?: string;

  @IsOptional()
  @IsNumberString()
  maxLeverageNet?: string;

  @IsOptional()
  @IsNumberString()
  maxLeverageSymbol?: string;

  @IsOptional()
  @IsNumberString()
  maxLeverageAccount?: string;

  @IsOptional()
  @IsNumberString()
  marginWarningUtilization?: string;

  @IsOptional()
  @IsNumberString()
  marginCriticalUtilization?: string;

  @IsOptional()
  @IsNumberString()
  liquidationWarningDistance?: string;

  @IsOptional()
  @IsNumberString()
  liquidationCriticalDistance?: string;

  @IsOptional()
  @IsNumberString()
  maxConcentrationAssetPercent?: string;

  @IsOptional()
  @IsNumberString()
  maxConcentrationSymbolPercent?: string;

  @IsOptional()
  @IsNumberString()
  maxConcentrationVenuePercent?: string;

  @IsOptional()
  @IsNumberString()
  maxConcentrationAccountPercent?: string;

  @IsOptional()
  @IsNumberString()
  maxConcentrationStrategyPercent?: string;

  @IsOptional()
  @IsNumberString()
  maxConcentrationTraderPercent?: string;

  @IsOptional()
  @IsNumberString()
  maxConcentrationFollowerPercent?: string;

  @IsOptional()
  @IsNumberString()
  maxDrawdownPercent?: string;

  @IsOptional()
  @IsNumberString()
  maxIntradayDrawdownPercent?: string;

  @IsOptional()
  @IsNumberString()
  maxDailyLoss?: string;

  @IsOptional()
  @IsBoolean()
  dailyLossIncludesUnrealized?: boolean;

  @IsOptional()
  @IsNumberString()
  maxCorrelation?: string;

  @IsOptional()
  @IsNumber()
  correlationLookbackDays?: number;

  @IsOptional()
  @IsNumber()
  correlationMinObservations?: number;

  @IsOptional()
  @IsNumberString()
  varConfidence?: string;

  @IsOptional()
  @IsNumber()
  varHorizonDays?: number;

  @IsOptional()
  @IsNumber()
  varWindowDays?: number;

  @IsOptional()
  @IsNumber()
  varMinObservations?: number;

  @IsOptional()
  @IsNumberString()
  varThreshold?: string;

  @IsOptional()
  @IsNumberString()
  stressLossThreshold?: string;

  @IsOptional()
  @IsNumber()
  marketDataMaxAgeMs?: number;

  @IsOptional()
  @IsNumber()
  exchangeHealthMaxAgeMs?: number;

  @IsOptional()
  @IsNumber()
  executionFailureBurstThreshold?: number;

  @IsOptional()
  @IsNumber()
  executionFailureWindowMs?: number;

  @IsOptional()
  @IsNumberString()
  circuitBreakerLossThreshold?: string;

  @IsOptional()
  @IsNumberString()
  circuitBreakerDrawdownThreshold?: string;

  @IsOptional()
  @IsBoolean()
  circuitBreakerEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  killSwitchEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  allowRiskReducingOrders?: boolean;
}

export class UpsertRiskPolicyDto {
  @IsEnum(RiskPolicyScopeDto)
  scope!: RiskPolicyScopeDto;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  scopeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  tenantId?: string;

  @IsObject()
  thresholds!: RiskPolicyThresholdsDto;

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  @Matches(/^[^`$\\{}()<>]*$/, { message: 'changeReason contains disallowed characters' })
  changeReason!: string;
}

export class RiskPolicyResponseDto {
  id!: string;
  scope!: string;
  scopeId!: string | null;
  version!: number;
  digest!: string;
  thresholds!: any;
  ruleIds!: string[];
  isActive!: boolean;
  createdAt!: string;
}
