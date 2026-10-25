// # Responsibility: validate exchange environment/operation/capability membership and expose unknown telemetry as nullable rather than measured zero.
import { IsString, IsEnum, IsOptional, IsBoolean, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ExchangeVenue, ExchangeEnvironment, ExchangeCapability } from '../exchange.types';

export class CheckConnectivityDto {
  @IsEnum(ExchangeVenue)
  venue!: ExchangeVenue;

  @IsEnum(ExchangeEnvironment)
  environment!: ExchangeEnvironment;

  @IsOptional()
  @IsString()
  accountId?: string;
}

export class RefreshCapabilitiesDto {
  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsEnum(ExchangeVenue)
  venue?: ExchangeVenue;

  @IsOptional()
  @IsEnum(ExchangeEnvironment)
  environment?: ExchangeEnvironment;
}

export class CheckHealthDto {
  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsEnum(ExchangeVenue)
  venue?: ExchangeVenue;

  @IsOptional()
  @IsEnum(ExchangeEnvironment)
  environment?: ExchangeEnvironment;
}

export class SyncBalancesDto {
  @IsString()
  accountId!: string;

  @IsOptional()
  @IsEnum(ExchangeVenue)
  venue?: ExchangeVenue;

  @IsOptional()
  @IsEnum(ExchangeEnvironment)
  environment?: ExchangeEnvironment;
}

export class SyncPositionsDto {
  @IsString()
  accountId!: string;

  @IsOptional()
  @IsEnum(ExchangeVenue)
  venue?: ExchangeVenue;

  @IsOptional()
  @IsEnum(ExchangeEnvironment)
  environment?: ExchangeEnvironment;
}

export class SyncOrdersDto {
  @IsString()
  accountId!: string;

  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsEnum(ExchangeVenue)
  venue?: ExchangeVenue;

  @IsOptional()
  @IsEnum(ExchangeEnvironment)
  environment?: ExchangeEnvironment;
}

export class RouteExchangeDto {
  @IsEnum(ExchangeVenue, { each: false })
  @IsOptional()
  venue?: ExchangeVenue;

  @IsEnum(ExchangeCapability)
  requiredCapability!: ExchangeCapability;

  @IsEnum(ExchangeEnvironment)
  environment!: ExchangeEnvironment;

  @IsIn(['READ', 'MARKET_DATA', 'TRADE', 'WITHDRAWAL'])
  operation!: 'READ' | 'MARKET_DATA' | 'TRADE' | 'WITHDRAWAL';

  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsString()
  accountId?: string | null;

  @IsOptional()
  @IsBoolean()
  complianceAllowed?: boolean = true;

  @IsOptional()
  @IsBoolean()
  riskAllowed?: boolean = true;
}

export class ListSymbolsDto {
  @IsOptional()
  @IsString()
  baseAsset?: string;

  @IsOptional()
  @IsString()
  quoteAsset?: string;

  @IsOptional()
  @IsBoolean()
  isTradeable?: boolean;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 50;
}

export class ConnectivitySafeResponseDto {
  connected!: boolean;
  degraded!: boolean;
  state!: string;
  latencyMs!: number;
  serverTimeMicros!: string | null;
  clockDriftMs!: number | null;
  capabilities!: string[];
  failureCode!: string | null;
  failureReason!: string | null;
  isSimulated!: boolean;
  environment!: ExchangeEnvironment;
}

export class HealthSafeResponseDto {
  accountId!: string;
  tenantId!: string;
  venue!: ExchangeVenue;
  environment!: ExchangeEnvironment;
  state!: string;
  latencyMs!: number | null;
  authFailures!: number | null;
  apiErrors!: number | null;
  rateLimitPressure!: number | null;
  dataCompleteness!: 'OBSERVED' | 'UNKNOWN';
  syncAgeMs!: number | null;
  clockDriftMs!: number | null;
  websocketConnected!: boolean | null;
  providerAvailable!: boolean;
  credentialExpired!: boolean;
  credentialRevoked!: boolean;
  lastCheckedAt!: string;
  lastErrorCode!: string | null;
  message!: string | null;
}

export class RoutingSafeResponseDto {
  selectedAccountId!: string | null;
  selectedVenue!: ExchangeVenue | null;
  environment!: ExchangeEnvironment | null;
  eligibleAccounts!: string[];
  routingReason!: string;
  capabilities!: string[];
  health!: string | null;
  liveExecutionPermitted!: boolean;
  liveGateBlockingReasons!: string[];
  complianceAllowed!: boolean;
  riskAllowed!: boolean;
}
