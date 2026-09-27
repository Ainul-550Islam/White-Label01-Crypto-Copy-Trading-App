import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Request shapes for the execution API.
 *
 * Two conventions run through the whole file.
 *
 * First, no DTO accepts a `tenantId`. Multi-tenancy is resolved from the
 * authenticated session, and a body field that could override it is a
 * cross-tenant vulnerability waiting for someone to forget one authorization
 * check. The field does not exist, so it cannot be trusted by mistake.
 *
 * Second, every state change that can affect money requires a `reason`. It is
 * stored on the audit record, and a post-mortem that can answer "why did
 * someone release the kill switch at 03:12" is worth the extra field.
 */

const BOOLEAN_FROM_QUERY = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()) : value;

// -----------------------------------------------------------------------------
// Queries
// -----------------------------------------------------------------------------

export class ListExchangeAccountsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING_VALIDATION', 'ACTIVE', 'DISABLED', 'CREDENTIALS_INVALID', 'WITHDRAWAL_ENABLED_REJECTED'] })
  @IsOptional()
  @IsIn([
    'PENDING_VALIDATION',
    'ACTIVE',
    'DISABLED',
    'CREDENTIALS_INVALID',
    'WITHDRAWAL_ENABLED_REJECTED',
  ])
  status?: string;

  @ApiPropertyOptional({ enum: ['BINANCE', 'BYBIT', 'OKX', 'KRAKEN', 'PAPER'] })
  @IsOptional()
  @IsIn(['BINANCE', 'BYBIT', 'OKX', 'KRAKEN', 'PAPER'])
  venue?: string;
}

export class ListBalancesDto {
  @ApiPropertyOptional({
    description:
      'Include assets with a zero total. Off by default: a spot account routinely carries ' +
      'hundreds of dust rows that bury the three balances anyone cares about.',
  })
  @IsOptional()
  @Transform(BOOLEAN_FROM_QUERY)
  @IsBoolean()
  includeZero?: boolean;
}

export class ListOrdersDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  strategyId?: string;

  @ApiPropertyOptional({ description: 'Exact venue symbol, e.g. BTCUSDT.' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  symbol?: string;

  @ApiPropertyOptional({
    enum: [
      'PENDING',
      'SUBMITTED',
      'ACKNOWLEDGED',
      'PARTIALLY_FILLED',
      'FILLED',
      'CANCEL_REQUESTED',
      'CANCELLED',
      'REJECTED',
      'EXPIRED',
      'FAILED',
    ],
  })
  @IsOptional()
  @IsIn([
    'PENDING',
    'SUBMITTED',
    'ACKNOWLEDGED',
    'PARTIALLY_FILLED',
    'FILLED',
    'CANCEL_REQUESTED',
    'CANCELLED',
    'REJECTED',
    'EXPIRED',
    'FAILED',
  ])
  status?: string;

  @ApiPropertyOptional({ enum: ['IN_SYNC', 'UNKNOWN', 'PENDING_RECONCILIATION', 'DIVERGED'] })
  @IsOptional()
  @IsIn(['IN_SYNC', 'UNKNOWN', 'PENDING_RECONCILIATION', 'DIVERGED'])
  reconciliationState?: string;

  @ApiPropertyOptional({
    description: 'Return only orders whose local state is not trusted by the platform.',
  })
  @IsOptional()
  @Transform(BOOLEAN_FROM_QUERY)
  @IsBoolean()
  unreconciledOnly?: boolean;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

export class ListFillsDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  symbol?: string;
}

export class ListPositionsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  symbol?: string;

  @ApiPropertyOptional({ description: 'Include closed (FLAT) positions.' })
  @IsOptional()
  @Transform(BOOLEAN_FROM_QUERY)
  @IsBoolean()
  includeFlat?: boolean;
}

export class ListReconciliationRunsDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  accountId?: string;

  @ApiPropertyOptional({ enum: ['RUNNING', 'COMPLETED', 'SKIPPED', 'FAILED'] })
  @IsOptional()
  @IsIn(['RUNNING', 'COMPLETED', 'SKIPPED', 'FAILED'])
  status?: string;
}

export class ListDiscrepanciesDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  runId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  orderId?: string;

  @ApiPropertyOptional({
    enum: [
      'ORDER_STATUS_MISMATCH',
      'ORDER_MISSING_LOCALLY',
      'ORDER_MISSING_AT_VENUE',
      'MISSED_FILL',
      'QUANTITY_MISMATCH',
      'BALANCE_MISMATCH',
      'POSITION_MISMATCH',
      'UNKNOWN_ORDER_RESOLVED',
      'UNKNOWN_ORDER_NEVER_PLACED',
    ],
  })
  @IsOptional()
  @IsIn([
    'ORDER_STATUS_MISMATCH',
    'ORDER_MISSING_LOCALLY',
    'ORDER_MISSING_AT_VENUE',
    'MISSED_FILL',
    'QUANTITY_MISMATCH',
    'BALANCE_MISMATCH',
    'POSITION_MISMATCH',
    'UNKNOWN_ORDER_RESOLVED',
    'UNKNOWN_ORDER_NEVER_PLACED',
  ])
  discrepancyType?: string;

  @ApiPropertyOptional({ description: 'Include discrepancies already closed by review.' })
  @IsOptional()
  @Transform(BOOLEAN_FROM_QUERY)
  @IsBoolean()
  includeRepaired?: boolean;
}

export class ListIncidentsDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  accountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  orderId?: string;

  @ApiPropertyOptional({
    enum: [
      'UNKNOWN_ORDER_RESULT',
      'ORDER_STATE_MISMATCH',
      'MISSING_FILL',
      'UNEXPECTED_ORDER',
      'BALANCE_MISMATCH',
      'POSITION_MISMATCH',
      'ILLEGAL_TRANSITION',
      'CREDENTIAL_FAILURE',
      'CLOCK_SKEW',
      'PRIVATE_STREAM_FAILURE',
      'RATE_LIMIT_BREACH',
      'RECONCILIATION_FAILURE',
      'SAFETY_GATE_BLOCK',
    ],
  })
  @IsOptional()
  @IsIn([
    'UNKNOWN_ORDER_RESULT',
    'ORDER_STATE_MISMATCH',
    'MISSING_FILL',
    'UNEXPECTED_ORDER',
    'BALANCE_MISMATCH',
    'POSITION_MISMATCH',
    'ILLEGAL_TRANSITION',
    'CREDENTIAL_FAILURE',
    'CLOCK_SKEW',
    'PRIVATE_STREAM_FAILURE',
    'RATE_LIMIT_BREACH',
    'RECONCILIATION_FAILURE',
    'SAFETY_GATE_BLOCK',
  ])
  incidentType?: string;

  @ApiPropertyOptional({ enum: ['INFO', 'WARNING', 'CRITICAL'] })
  @IsOptional()
  @IsIn(['INFO', 'WARNING', 'CRITICAL'])
  severity?: string;

  @ApiPropertyOptional({ description: 'Include already-resolved incidents.' })
  @IsOptional()
  @Transform(BOOLEAN_FROM_QUERY)
  @IsBoolean()
  includeResolved?: boolean;
}

// -----------------------------------------------------------------------------
// Mutations
// -----------------------------------------------------------------------------

/**
 * Shared base for every administrative toggle.
 *
 * `reason` is mandatory and non-trivial. An audit trail full of "test" is not
 * an audit trail, but a minimum length at least forces a deliberate keystroke
 * and catches the empty-string default that a UI sends when a field is missed.
 */
export class ReasonDto {
  @ApiProperty({ minLength: 5, maxLength: 500 })
  @IsString()
  @MinLength(5, { message: 'reason must be at least 5 characters' })
  @MaxLength(500)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  reason!: string;
}

export class SetEnabledDto extends ReasonDto {
  @ApiProperty({ description: 'True to enable the account for trading, false to disable it.' })
  @IsBoolean()
  enabled!: boolean;
}

export class SetLiveTradingDto extends ReasonDto {
  @ApiProperty({
    description:
      'True to arm live trading on this account. Refused unless the deployment is also ' +
      'configured for live trading; both halves of the gate must agree.',
  })
  @IsBoolean()
  enabled!: boolean;

  /**
   * A typed confirmation string, required only when arming.
   *
   * Deliberately awkward. Every other boolean in this API is a switch; this one
   * asks the caller to type the words, because an accidental `{"enabled": true}`
   * against the wrong account id is the mistake that costs real money, and a
   * confirmation phrase makes it impossible to make that mistake silently from
   * a shell history or a mis-clicked toggle.
   */
  @ApiPropertyOptional({
    description: 'Required when enabling. Must be exactly "ENABLE LIVE TRADING".',
  })
  @IsOptional()
  @IsString()
  @Matches(/^ENABLE LIVE TRADING$/, {
    message: 'confirmation must be exactly "ENABLE LIVE TRADING"',
  })
  confirmation?: string;
}

export class SetPrivateStreamDto extends ReasonDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}

export class SetKillSwitchDto extends ReasonDto {
  @ApiProperty({ enum: ['GLOBAL', 'EXCHANGE', 'STRATEGY', 'SYMBOL'] })
  @IsEnum(['GLOBAL', 'EXCHANGE', 'STRATEGY', 'SYMBOL'] as unknown as object)
  @IsIn(['GLOBAL', 'EXCHANGE', 'STRATEGY', 'SYMBOL'])
  scope!: 'GLOBAL' | 'EXCHANGE' | 'STRATEGY' | 'SYMBOL';

  @ApiPropertyOptional({
    description: 'Venue, strategy id or symbol. Required for every scope except GLOBAL.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  target?: string;

  @ApiProperty({ description: 'True to engage (stop trading), false to release.' })
  @IsBoolean()
  engaged!: boolean;
}

export class ResolutionNoteDto {
  @ApiProperty({ minLength: 5, maxLength: 1000 })
  @IsString()
  @MinLength(5, { message: 'note must be at least 5 characters' })
  @MaxLength(1000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  note!: string;
}

export class CancelOrderDto extends ReasonDto {}
