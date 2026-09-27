import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  IsUUID,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  CREDENTIAL_KEY_PATTERN,
  DECIMAL_STRING_PATTERN,
  EPOCH_MICROS_CEILING,
  MAX_CORRELATION_GROUPS,
  MAX_POLICY_ENTRIES,
  MIN_ACKNOWLEDGEMENT_REASON,
  MIN_PROTECTION_CLEAR_REASON,
  MIN_REASON_LENGTH,
  PROTECTION_ACTIONS,
  PROTECTION_CLEAR_CONFIRMATION,
  RISK_EVENT_SEVERITIES,
  RISK_KILL_SCOPES,
  RISK_CONSOLE_ENGAGE_SCOPES,
  RISK_LIMIT_SCOPES,
  RISK_LIMIT_UNITS,
  RISK_RULE_IDS,
  RATE_WINDOWS_MICROS,
  WIDEN_CONFIRMATION,
} from '../risk.constants';

/**
 * Request shapes for the Part 8 risk control API.
 *
 * Two rules govern every DTO in this file:
 *
 * 1. Money is a decimal STRING. `value` on a limit entry, `maxNotional` on a
 *    correlation group: a JSON number would run through IEEE-754 before the
 *    engine ever saw it, and a limit that passed through a float is a limit
 *    nobody configured. The Python configuration loader refuses floats at
 *    parse for the same reason; the API refuses them at the door so the
 *    rejection message is actionable ("quote your number") rather than a
 *    digest mismatch three hops later.
 * 2. No input may carry credential-shaped keys or values. This guard is
 *    INTENTIONALLY a second, independent implementation of the datasets
 *    module's `NoCredentialKeysConstraint` rather than a shared import: the
 *    boundary double-check is the point - the secret that lands is the one
 *    some other component forgot to screen. The pattern constants it uses
 *    are the same strings the Python side enforces, and each side's spec
 *    tests its own boundary.
 *
 * No DTO here accepts a tenantId (the session supplies it) and none accepts
 * anything order-shaped: the risk module configures, inspects and halts; it
 * cannot submit, and the shape of its inputs is part of that proof.
 */

const BOOLEAN_FROM_QUERY = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()) : value;

const MAX_PARAM_KEYS = 32;
const MAX_PARAM_VALUE_LENGTH = 200;

function credentialHitsIn(value: unknown, path: string): string[] {
  if (typeof value === 'string') {
    return CREDENTIAL_KEY_PATTERN.test(value) ? [path] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => credentialHitsIn(item, `${path}[${index}]`));
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.flatMap(([key, inner]) => {
      const keyHit = CREDENTIAL_KEY_PATTERN.test(key) ? [`${path}.${key}`] : [];
      return [...keyHit, ...credentialHitsIn(inner, `${path}.${key}`)];
    });
  }
  return [];
}

@ValidatorConstraint({ name: 'noCredentialKeys', async: false })
export class RiskNoCredentialKeysConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, _args: ValidationArguments): boolean {
    if (value === undefined || value === null) {
      return true;
    }
    if (credentialHitsIn(value, 'policy').length > 0) {
      return false;
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length > MAX_PARAM_KEYS) {
        return false;
      }
      for (const [, inner] of entries) {
        if (typeof inner === 'string' && inner.length > MAX_PARAM_VALUE_LENGTH) {
          return false;
        }
      }
    }
    return true;
  }

  defaultMessage(args: ValidationArguments): string {
    const hits = credentialHitsIn(args.value, 'policy');
    if (hits.length > 0) {
      return (
        'Risk policy objects are stored in versioned documents, mirrored to ' +
        'Redis and surfaced in admin views; they must never contain ' +
        `credential-shaped keys or values (offending paths: ${hits
          .slice(0, 3)
          .join(', ')}). A risk engine has exactly zero reasons to hold a secret.`
      );
    }
    if (
      typeof args.value === 'object' &&
      args.value !== null &&
      Object.keys(args.value as Record<string, unknown>).length > MAX_PARAM_KEYS
    ) {
      return `Risk policy objects are bounded at ${MAX_PARAM_KEYS} keys.`;
    }
    return `Risk policy string values must stay within ${MAX_PARAM_VALUE_LENGTH} characters.`;
  }
}

function NoCredentialKeys(): PropertyDecorator {
  return Validate(RiskNoCredentialKeysConstraint);
}

// -----------------------------------------------------------------------------
// Queries
// -----------------------------------------------------------------------------

export class ListRiskEventsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter to one trading account (uuid)' })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({ description: 'Filter to one strategy (uuid)' })
  @IsOptional()
  @IsUUID()
  strategyId?: string;

  @ApiPropertyOptional({ enum: RISK_EVENT_SEVERITIES })
  @IsOptional()
  @IsIn(RISK_EVENT_SEVERITIES)
  severity?: (typeof RISK_EVENT_SEVERITIES)[number];

  @ApiPropertyOptional({ enum: RISK_RULE_IDS })
  @IsOptional()
  @IsIn(RISK_RULE_IDS)
  ruleId?: (typeof RISK_RULE_IDS)[number];

  @ApiPropertyOptional({ description: 'Include the simulated-state trail (default false)' })
  @IsOptional()
  @Transform(BOOLEAN_FROM_QUERY)
  @IsBoolean()
  includeSimulated?: boolean;

  @ApiPropertyOptional({ description: 'ISO timestamp lower bound (inclusive)' })
  @IsOptional()
  @IsString()
  since?: string;

  @ApiPropertyOptional({ description: 'ISO timestamp upper bound (exclusive)' })
  @IsOptional()
  @IsString()
  until?: string;
}

export class ListRiskSnapshotsDto extends PaginationQueryDto {
  @ApiProperty({ description: 'Account whose snapshot timeline to read (uuid)' })
  @IsUUID()
  accountId!: string;
}

export class DailyPnlQueryDto {
  @ApiProperty({ description: 'Trading account (uuid)' })
  @IsUUID()
  accountId!: string;

  @ApiPropertyOptional({ description: 'UTC trading day, YYYY-MM-DD (default: today)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'day must be a YYYY-MM-DD UTC date' })
  day?: string;
}

// -----------------------------------------------------------------------------
// Configuration writes
// -----------------------------------------------------------------------------

export class RiskLimitEntryInputDto {
  @ApiProperty({ enum: RISK_RULE_IDS })
  @IsIn(RISK_RULE_IDS)
  ruleId!: (typeof RISK_RULE_IDS)[number];

  @ApiProperty({ enum: RISK_LIMIT_SCOPES })
  @IsIn(RISK_LIMIT_SCOPES)
  scope!: (typeof RISK_LIMIT_SCOPES)[number];

  @ApiPropertyOptional({
    description:
      'Scope target: venue id, account uuid, strategy uuid or SYMBOL. Absent ONLY for GLOBAL.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  target?: string;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({
    description: 'The ceiling as an exact decimal string; floats are rejected.',
    example: '5000',
  })
  @Matches(new RegExp(DECIMAL_STRING_PATTERN), {
    message: 'value must be a plain decimal string such as "5000" or "0.25"',
  })
  value!: string;

  @ApiProperty({ enum: RISK_LIMIT_UNITS })
  @IsIn(RISK_LIMIT_UNITS)
  unit!: (typeof RISK_LIMIT_UNITS)[number];

  @ApiProperty({ description: 'Tie-break priority; lower wins among equal values' })
  @IsInt()
  priority!: number;

  @ApiProperty({ description: 'Epoch micros of validity start' })
  @IsInt()
  @Min(0)
  @Max(EPOCH_MICROS_CEILING)
  effectiveFromMicros!: number;

  @ApiPropertyOptional({ description: 'Epoch micros of validity end (exclusive); null = open' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(EPOCH_MICROS_CEILING)
  effectiveUntilMicros?: number;

  @ApiProperty({ description: 'Per-entry revision, >= 1' })
  @IsInt()
  @Min(1)
  entryVersion!: number;

  @ApiPropertyOptional({
    description: 'Rate rules only: window micros, exactly 1000000 or 60000000.',
    enum: RATE_WINDOWS_MICROS,
  })
  @IsOptional()
  @IsIn(RATE_WINDOWS_MICROS)
  windowMicros?: number;
}

export class CorrelationGroupInputDto {
  @ApiProperty({ example: 'majors' })
  @Matches(/^[a-z0-9][a-z0-9-]{1,31}$/, {
    message: 'name must be lowercase, 2-32 chars, letters/digits/hyphen',
  })
  name!: string;

  @ApiProperty({ description: 'Venue id the group applies on', example: 'binance' })
  @IsString()
  @MaxLength(32)
  exchange!: string;

  @ApiProperty({ type: [String], description: '2-12 canonical symbols' })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @Matches(/^[A-Z0-9]+(-[A-Z0-9]+)?$/, { each: true, message: 'members must be canonical symbols' })
  members!: string[];

  @ApiPropertyOptional({ description: 'Group notional ceiling, exact decimal string' })
  @IsOptional()
  @Matches(new RegExp(DECIMAL_STRING_PATTERN), { message: 'maxNotional must be a decimal string' })
  maxNotional?: string;

  @ApiPropertyOptional({ description: 'Why these symbols share a bucket (travels with the group)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  rationale?: string;
}

export class ProtectionPolicyInputDto {
  @ApiPropertyOptional({ enum: PROTECTION_ACTIONS })
  @IsOptional()
  @IsIn(PROTECTION_ACTIONS)
  dailyLossAction?: (typeof PROTECTION_ACTIONS)[number];

  @ApiPropertyOptional({ enum: PROTECTION_ACTIONS })
  @IsOptional()
  @IsIn(PROTECTION_ACTIONS)
  strategyDailyLossAction?: (typeof PROTECTION_ACTIONS)[number];

  @ApiPropertyOptional({ enum: PROTECTION_ACTIONS })
  @IsOptional()
  @IsIn(PROTECTION_ACTIONS)
  drawdownAction?: (typeof PROTECTION_ACTIONS)[number];

  @ApiPropertyOptional({ enum: PROTECTION_ACTIONS })
  @IsOptional()
  @IsIn(PROTECTION_ACTIONS)
  consecutiveLossesAction?: (typeof PROTECTION_ACTIONS)[number];

  @ApiPropertyOptional({ enum: PROTECTION_ACTIONS })
  @IsOptional()
  @IsIn(PROTECTION_ACTIONS)
  orderRateAction?: (typeof PROTECTION_ACTIONS)[number];

  @ApiPropertyOptional({ enum: PROTECTION_ACTIONS })
  @IsOptional()
  @IsIn(PROTECTION_ACTIONS)
  cancelRateAction?: (typeof PROTECTION_ACTIONS)[number];

  @ApiPropertyOptional({ enum: PROTECTION_ACTIONS })
  @IsOptional()
  @IsIn(PROTECTION_ACTIONS)
  staleRiskStateAction?: (typeof PROTECTION_ACTIONS)[number];

  @ApiPropertyOptional({
    description:
      'Whether triggered (automatic) protections admit risk-reducing orders. ' +
      'Manual kill switches are ALWAYS total halts; this flag cannot open them.',
  })
  @IsOptional()
  @IsBoolean()
  allowRiskReducingOrders?: boolean;
}

export class UpdateRiskPolicyDto {
  @ApiProperty({ type: [RiskLimitEntryInputDto], description: 'The COMPLETE new entry set' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_POLICY_ENTRIES)
  @ValidateNested({ each: true })
  @Type(() => RiskLimitEntryInputDto)
  entries!: RiskLimitEntryInputDto[];

  @ApiPropertyOptional({ type: [CorrelationGroupInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CORRELATION_GROUPS)
  @ValidateNested({ each: true })
  @Type(() => CorrelationGroupInputDto)
  correlationGroups?: CorrelationGroupInputDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => ProtectionPolicyInputDto)
  protectionPolicy?: ProtectionPolicyInputDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  dailyLossIncludesUnrealized?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  dailyLossIncludesFees?: boolean;

  @ApiPropertyOptional({
    enum: ['MID', 'BEST_BID', 'BEST_ASK', 'SIDE_TOUCH', 'LAST_TRADE'],
    description: 'Reference the deviation band measures against. Default SIDE_TOUCH.',
  })
  @IsOptional()
  @IsIn(['MID', 'BEST_BID', 'BEST_ASK', 'SIDE_TOUCH', 'LAST_TRADE'])
  priceDeviationReference?: 'MID' | 'BEST_BID' | 'BEST_ASK' | 'SIDE_TOUCH' | 'LAST_TRADE';

  @ApiPropertyOptional({
    description:
      'Authoritative fee rate (bps) used by the fee-budget estimate. Absent means ' +
      'the fee rule refuses rather than guesses; it is never defaulted.',
  })
  @IsOptional()
  @Matches(new RegExp(DECIMAL_STRING_PATTERN), { message: 'feeRateBps must be a decimal string' })
  feeRateBps?: string;

  @ApiPropertyOptional({ description: 'Free-form note carried in the document (max 500)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiProperty({
    description:
      'Why this revision exists. Required because "never silently modify a risk ' +
      'limit" is the clause this whole endpoint exists to enforce.',
  })
  @IsString()
  @MinLength(MIN_REASON_LENGTH)
  @MaxLength(500)
  changeReason!: string;

  @ApiPropertyOptional({
    description:
      'Required when the revision WIDENS any effective ceiling relative to the ' +
      'current one (the service detects this and refuses without the phrase).',
  })
  @IsOptional()
  @IsString()
  confirm?: string;

  @ApiPropertyOptional({ description: 'Reserved for future policy bags; credential-screened' })
  @IsOptional()
  @NoCredentialKeys()
  annotations?: Record<string, unknown>;
}

export class RollbackRiskPolicyDto {
  @ApiProperty({ description: 'Configuration version to republish as a NEW revision' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  toVersion!: number;

  @ApiProperty({ description: 'Why the rollback is happening (>= 20 chars)' })
  @IsString()
  @MinLength(MIN_PROTECTION_CLEAR_REASON)
  @MaxLength(500)
  changeReason!: string;

  @ApiProperty({
    description:
      'Typed confirmation, exact. Rolling back to an older revision is a ' +
      'WIDENING act by intent, so it carries the widening phrase - and the ' +
      'service re-runs the loosening detection honestly either way.',
  })
  @Matches(new RegExp(`^${WIDEN_CONFIRMATION}$`), {
    message: `confirm must be exactly "${WIDEN_CONFIRMATION}"`,
  })
  confirm!: string;
}

// -----------------------------------------------------------------------------
// Switch lifecycle
// -----------------------------------------------------------------------------

export class EngageRiskSwitchDto {
  @ApiProperty({ enum: RISK_CONSOLE_ENGAGE_SCOPES })
  @IsIn(RISK_CONSOLE_ENGAGE_SCOPES)
  scope!: (typeof RISK_CONSOLE_ENGAGE_SCOPES)[number];

  @ApiPropertyOptional({
    description:
      'Required for ACCOUNT (account uuid), STRATEGY (strategy uuid) and SYMBOL ' +
      '(canonical symbol). The service enforces the pairing.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  target?: string;

  @ApiProperty({
    description:
      'Why the halt exists. No minimum for ENGAGE - stopping trading is never the ' +
      'wrong instinct - but a real reason beats a reflexive dash.',
  })
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class AcknowledgeRiskSwitchDto {
  @ApiProperty({
    description:
      'What was reviewed. Acknowledging keeps the switch ENGAGED; it records ' +
      'that a human has read the trigger, nothing more.',
  })
  @IsString()
  @MinLength(MIN_ACKNOWLEDGEMENT_REASON)
  @MaxLength(500)
  reason!: string;
}

export class ClearRiskSwitchDto {
  @ApiProperty({
    description:
      `Typed confirmation, exact: "${PROTECTION_CLEAR_CONFIRMATION}". Clearing a ` +
      'protection is the one action in this module that makes the system more ' +
      'willing to trade.',
  })
  @Matches(new RegExp(`^${PROTECTION_CLEAR_CONFIRMATION}$`), {
    message: `confirm must be exactly "${PROTECTION_CLEAR_CONFIRMATION}"`,
  })
  confirm!: string;

  @ApiProperty({ description: `Reason of at least ${MIN_PROTECTION_CLEAR_REASON} characters` })
  @IsString()
  @MinLength(MIN_PROTECTION_CLEAR_REASON)
  @MaxLength(500)
  reason!: string;
}

export class ListRiskSwitchesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: RISK_KILL_SCOPES })
  @IsOptional()
  @IsIn(RISK_KILL_SCOPES)
  scope?: (typeof RISK_KILL_SCOPES)[number];

  @ApiPropertyOptional({ description: 'Only currently-blocking switches' })
  @IsOptional()
  @Transform(BOOLEAN_FROM_QUERY)
  @IsBoolean()
  engagedOnly?: boolean;
}
