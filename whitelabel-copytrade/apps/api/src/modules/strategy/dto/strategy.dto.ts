import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Request shapes for the strategy API.
 *
 * The conventions from the execution DTOs carry over unchanged.
 *
 * No DTO accepts a `tenantId`. Tenancy is resolved from the authenticated
 * session; a body field that could override it is a cross-tenant vulnerability
 * waiting for one forgotten authorization check, so the field does not exist.
 *
 * Every state change carries a `reason`, stored on the audit record.
 *
 * One convention is specific to this module: a numeric value that ends up in
 * Decimal arithmetic is accepted as a **string** and validated with a regex,
 * never as a JSON number. `0.1` in JSON is already not 0.1 by the time it
 * reaches the parser, and a fee rate that is quietly wrong in the twelfth
 * decimal place produces a backtest that cannot be reproduced.
 */

const BOOLEAN_FROM_QUERY = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()) : value;

/** A plain decimal literal. No exponent, no separators, no leading `+`. */
const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

const SYMBOL_PATTERN = /^[A-Z0-9]+-[A-Z0-9]+$/;

const VENUES = ['BINANCE', 'BYBIT', 'OKX', 'KRAKEN', 'PAPER'] as const;
const MARKET_TYPES = ['SPOT', 'MARGIN', 'FUTURES_USDT', 'FUTURES_COIN'] as const;

// -----------------------------------------------------------------------------
// Catalogue queries
// -----------------------------------------------------------------------------

export class ListStrategyDefinitionsDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Include reserved-but-unimplemented catalogue entries. Off by default: they cannot be ' +
      'run, and listing them alongside runnable strategies invites someone to try.',
  })
  @IsOptional()
  @Transform(BOOLEAN_FROM_QUERY)
  @IsBoolean()
  includeReserved?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  category?: string;
}

export class ListStrategyVersionsDto {
  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED', 'DEPRECATED', 'DISABLED'] })
  @IsOptional()
  @IsIn(['DRAFT', 'PUBLISHED', 'DEPRECATED', 'DISABLED'])
  status?: string;
}

// -----------------------------------------------------------------------------
// Instance queries
// -----------------------------------------------------------------------------

export class ListStrategyInstancesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['DRAFT', 'ENABLED', 'DISABLED', 'ERROR'] })
  @IsOptional()
  @IsIn(['DRAFT', 'ENABLED', 'DISABLED', 'ERROR'])
  status?: string;

  @ApiPropertyOptional({
    enum: ['UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNHEALTHY', 'QUARANTINED'],
  })
  @IsOptional()
  @IsIn(['UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNHEALTHY', 'QUARANTINED'])
  health?: string;

  @ApiPropertyOptional({ enum: VENUES })
  @IsOptional()
  @IsIn(VENUES as unknown as string[])
  venue?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(BOOLEAN_FROM_QUERY)
  @IsBoolean()
  enabledOnly?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  definitionId?: string;
}

export class ListStrategyRunsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['STARTING', 'RUNNING', 'STOPPED', 'FAILED', 'HALTED'] })
  @IsOptional()
  @IsIn(['STARTING', 'RUNNING', 'STOPPED', 'FAILED', 'HALTED'])
  status?: string;
}

export class ListStrategyIncidentsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['INFO', 'WARNING', 'CRITICAL'] })
  @IsOptional()
  @IsIn(['INFO', 'WARNING', 'CRITICAL'])
  severity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  strategyId?: string;

  @ApiPropertyOptional({ description: 'Only incidents nobody has closed yet.' })
  @IsOptional()
  @Transform(BOOLEAN_FROM_QUERY)
  @IsBoolean()
  unresolvedOnly?: boolean;
}

// -----------------------------------------------------------------------------
// Instance commands
// -----------------------------------------------------------------------------

export class EnableStrategyInstanceDto {
  @ApiProperty({
    description:
      'Why this strategy is being started. Stored on the audit record and on the run.',
    minLength: 10,
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(10, {
    message:
      'reason must be at least 10 characters. "test" is not a reason anyone can act on in six ' +
      'months.',
  })
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({
    description:
      'Required ONLY when the deployment is configured for LIVE execution. Must be the exact ' +
      'string "ENABLE STRATEGY IN LIVE MODE". Starting a strategy while live execution is ' +
      'armed is the one path where an automated decision can become a real order, so it is ' +
      'never a single click.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  confirmation?: string;
}

export class DisableStrategyInstanceDto {
  @ApiProperty({ minLength: 3, maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MinLength(3, { message: 'reason must be at least 3 characters' })
  @MaxLength(500)
  reason!: string;
}

export class ResolveStrategyIncidentDto {
  @ApiProperty({
    description: 'What was found and what was done about it.',
    minLength: 10,
    maxLength: 1000,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(10, { message: 'note must be at least 10 characters' })
  @MaxLength(1000)
  note!: string;
}

// -----------------------------------------------------------------------------
// Backtesting
// -----------------------------------------------------------------------------

export class SubmitBacktestDto {
  @ApiPropertyOptional({
    description:
      'Run against an existing instance, inheriting its venue, symbol and parameters. Provide ' +
      'either this or definitionKey + version.',
  })
  @IsOptional()
  @IsUUID('4')
  strategyId?: string;

  @ApiPropertyOptional({ description: 'Catalogue key, e.g. DETERMINISTIC_IMBALANCE_V1.' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9_]+$/, { message: 'definitionKey must be upper snake case' })
  @MaxLength(64)
  definitionKey?: string;

  @ApiPropertyOptional({ description: 'Published version, e.g. 1.0.0.' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+\.\d+\.\d+$/, { message: 'version must be semantic, e.g. 1.0.0' })
  @MaxLength(20)
  version?: string;

  @ApiProperty({ enum: VENUES })
  @IsIn(VENUES as unknown as string[])
  venue!: string;

  @ApiProperty({ example: 'BTC-USDT' })
  @IsString()
  @Matches(SYMBOL_PATTERN, { message: 'symbol must be canonical, e.g. BTC-USDT' })
  @MaxLength(32)
  symbol!: string;

  @ApiPropertyOptional({ enum: MARKET_TYPES, default: 'SPOT' })
  @IsOptional()
  @IsIn(MARKET_TYPES as unknown as string[])
  marketType?: string;

  @ApiProperty({
    description:
      'Identifier of a stored dataset. The backtest replays that data; it fetches nothing ' +
      'from a venue and opens no socket. When datasetVersionId is set, the service RECHECKS ' +
      'this against the canonical `hst-<key>@v<version>` of that version and refuses a ' +
      'mismatch: a run may not label itself with data it did not cite.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  datasetId!: string;

  @ApiPropertyOptional({
    description:
      'Registered dataset version (Part 7). When present the run is bound to an immutable ' +
      'version row: its status must be VALID, its venue and symbol must match the request, ' +
      'and any datasetChecksum given must equal the version content checksum. In a ' +
      'BACKTEST_DATASET_REQUIRED deployment this is mandatory - a backtest that does not ' +
      'pin which version of which dataset it replayed is not a reproducible experiment.',
  })
  @IsOptional()
  @IsUUID()
  datasetVersionId?: string;

  @ApiPropertyOptional({
    description:
      'Expected dataset checksum. When supplied, the worker refuses to run if the stored ' +
      'dataset does not match, because a result attributed to the wrong data is worse than ' +
      'no result.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{16,64}$/, { message: 'datasetChecksum must be lowercase hex' })
  datasetChecksum?: string;

  @ApiPropertyOptional({
    description: 'Strategy parameters. Validated against the version parameter schema.',
  })
  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Initial capital as a decimal string. Defaults to the configured value.',
    example: '10000',
  })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_PATTERN, { message: 'initialCapital must be a plain decimal string' })
  @MaxLength(30)
  initialCapital?: string;

  @ApiPropertyOptional({ description: 'Maker fee RATE, not bps. 0.001 is ten bps.' })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_PATTERN, { message: 'makerFeeRate must be a plain decimal string' })
  @MaxLength(12)
  makerFeeRate?: string;

  @ApiPropertyOptional({ description: 'Taker fee RATE, not bps.' })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_PATTERN, { message: 'takerFeeRate must be a plain decimal string' })
  @MaxLength(12)
  takerFeeRate?: string;

  @ApiPropertyOptional({ description: 'Slippage in basis points against every taker fill.' })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_PATTERN, { message: 'slippageBps must be a plain decimal string' })
  @MaxLength(12)
  slippageBps?: string;

  @ApiPropertyOptional({
    description: 'Simulated submit-to-fill latency in microseconds.',
    minimum: 0,
    maximum: 60_000_000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60_000_000)
  latencyMicros?: number;

  @ApiPropertyOptional({
    enum: ['TRAINING', 'VALIDATION', 'TEST'],
    description:
      'Walk-forward segment this run belongs to. Labelling only: the platform performs no ' +
      'parameter optimisation, so nothing here selects a winner for you.',
  })
  @IsOptional()
  @IsIn(['TRAINING', 'VALIDATION', 'TEST'])
  walkForwardSegment?: string;
}

export class ListBacktestRunsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'] })
  @IsOptional()
  @IsIn(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  strategyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(SYMBOL_PATTERN, { message: 'symbol must be canonical, e.g. BTC-USDT' })
  symbol?: string;

  @ApiPropertyOptional({
    description:
      'Find every run produced by one exact configuration. Two runs sharing this hash and a ' +
      'dataset checksum must have produced identical results.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{64}$/, { message: 'configurationHash must be 64 lowercase hex characters' })
  configurationHash?: string;
}

// -----------------------------------------------------------------------------
// Paper trading
// -----------------------------------------------------------------------------

export class StartPaperSessionDto {
  @ApiProperty({ description: 'The instance to run. It is not started for live execution.' })
  @IsUUID('4')
  strategyId!: string;

  @ApiProperty({ example: 'BTC-USDT' })
  @IsString()
  @Matches(SYMBOL_PATTERN, { message: 'symbol must be canonical, e.g. BTC-USDT' })
  @MaxLength(32)
  symbol!: string;

  @ApiPropertyOptional({ example: '10000' })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_PATTERN, { message: 'initialCapital must be a plain decimal string' })
  @MaxLength(30)
  initialCapital?: string;

  @ApiProperty({ minLength: 10, maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MinLength(10, { message: 'reason must be at least 10 characters' })
  @MaxLength(500)
  reason!: string;
}

export class StopPaperSessionDto {
  @ApiProperty({ minLength: 3, maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MinLength(3, { message: 'reason must be at least 3 characters' })
  @MaxLength(500)
  reason!: string;
}

export class ListPaperSessionsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['STARTING', 'RUNNING', 'STOPPED', 'FAILED'] })
  @IsOptional()
  @IsIn(['STARTING', 'RUNNING', 'STOPPED', 'FAILED'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  strategyId?: string;
}

export class ListPaperSnapshotsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 1000, default: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}
