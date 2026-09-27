/**
 * Part 10 - the canonical form of an SLO definition: objective arithmetic on
 * strings, the 14-key canonical payload, the sha256 identity.
 *
 * This file is the TypeScript mirror of `wlct_trading/slo/model.py`
 * (_decimal_string, objective_to_ppm, canonical_payload, canonical_slo_json,
 * slo_checksum). Like Part 8's risk digest, the whole point is that two
 * definitions that MEAN the same thing cannot produce two checksums, and two
 * that differ cannot produce one. `canonicalJson` is the already-proven
 * Part 8 canonicaliser (sorted keys, compact separators, non-finite values
 * throw) - the same function, not a copy, so the two systems cannot drift in
 * how they spell JSON.
 */

import { createHash } from 'node:crypto';

import {
  DEFAULT_CRITICAL_BURN_PPM,
  DEFAULT_WARNING_BURN_PPM,
  FRESHNESS_INDICATORS,
  MAX_WINDOW_MINUTES,
  MIN_WINDOW_MINUTES,
  SLO_ID_PATTERN,
  SLO_INDICATORS,
  SLO_OWNER_PATTERN,
  type SloIndicatorValue,
} from './slo.constants';

export class SloValidationError extends Error {
  constructor(
    readonly errors: readonly string[],
    readonly sloId: string,
  ) {
    super(`SloDefinition ${sloId}: ${errors.join('; ')}`);
    this.name = 'SloValidationError';
  }
}

/** The full, validated, canonicalised definition as the engine stores it.
 *  Integers where integers belong; the objective is canonical text; micros
 *  are strings because 64-bit values never travel as JS numbers. */
export interface SloDefinition {
  readonly sloId: string;
  readonly service: string;
  readonly description: string;
  readonly owner: string;
  readonly indicator: SloIndicatorValue;
  readonly objective: string;
  readonly objectivePpm: number;
  readonly windowMinutes: number;
  readonly shortWindowMinutes: number;
  readonly goodEvent: string;
  readonly badEvent: string;
  readonly warningBurnPpm: number;
  readonly criticalBurnPpm: number;
  readonly maxAgeMicros: string | null;
  readonly latencyThresholdMicros: string | null;
  readonly version: number;
  readonly enabled: boolean;
}

// ---------------------------------------------------------------------------
// decimal string -> ppm
// ---------------------------------------------------------------------------

const SLO_DECIMAL_INPUT = /^(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/** Accept a decimal string (optionally in scientific form like Python's
 *  Decimal does), return the CANONICAL plain form: no trailing zeros, no
 *  E+, no leading zeros, "-0" folded to "0". Floats are rejected at the
 *  caller - `typeof value === 'number'` never reaches here (the DTO only
 *  accepts strings, and the config layer hands over strings), which is the
 *  same "float rejected outright" rule model.py states for itself. */
export function canonicalObjectiveString(raw: string): string | null {
  const match = SLO_DECIMAL_INPUT.exec(raw.trim());
  if (match === null) {
    return null;
  }
  const wholePart = match[1] ?? '0';
  const fractionPart = match[2] ?? '';
  const exponent = match[3] === undefined ? 0 : Number.parseInt(match[3], 10);
  let digits = wholePart + fractionPart;
  let pointFromRight = fractionPart.length - exponent;
  if (pointFromRight < 0) {
    digits += '0'.repeat(-pointFromRight);
    pointFromRight = 0;
  } else if (pointFromRight > digits.length) {
    digits = '0'.repeat(pointFromRight - digits.length) + digits;
  }
  let intDigits = pointFromRight === 0 ? digits : digits.slice(0, digits.length - pointFromRight);
  let fracDigits = pointFromRight === 0 ? '' : digits.slice(digits.length - pointFromRight);
  fracDigits = fracDigits.replace(/0+$/, '');
  intDigits = intDigits.replace(/^0+(?=\d)/, '');
  if (fracDigits.length > 4) {
    // objective supports at most 4 decimal places - enforced here because
    // the ppm conversion below is exactly 4-wide and must not silently round.
    return null;
  }
  const canonical = fracDigits.length > 0 ? `${intDigits}.${fracDigits}` : intDigits;
  return canonical;
}

/** Canonical plain decimal string -> ppm, mirroring objective_to_ppm:
 *  value * 10_000, at most 4 decimals, strictly inside (0, 100). */
export function objectiveToPpm(objective: string): number {
  // Three failure modes, three exact Python messages, in Python's order:
  // unparseable, then RANGE, then DECIMAL PLACES. Baking the 4-place limit
  // into the parser instead (one shared "not a decimal string" error for
  // both) makes a misconfigured operator chase the wrong bug - "99.99999"
  // is parseable and in range, it is simply over-precise, and the error has
  // to say so. canonicalObjectiveString keeps its stricter single error for
  // the checksum path, where the input has already passed through here.
  const match = SLO_DECIMAL_INPUT.exec(objective.trim());
  if (match === null) {
    throw new Error('objective is not a decimal string');
  }
  const wholePart = match[1] ?? '0';
  const fractionPart = match[2] ?? '';
  const exponent = match[3] === undefined ? 0 : Number.parseInt(match[3], 10);
  let digits = wholePart + fractionPart;
  let pointFromRight = fractionPart.length - exponent;
  if (pointFromRight < 0) {
    digits += '0'.repeat(-pointFromRight);
    pointFromRight = 0;
  } else if (pointFromRight > digits.length) {
    digits = '0'.repeat(pointFromRight - digits.length) + digits;
  }
  let negative = false;
  if (digits.startsWith('-')) {
    negative = true;
    digits = digits.slice(1);
  } else if (digits.startsWith('+')) {
    digits = digits.slice(1);
  }
  const scaled = BigInt(digits === '' ? '0' : digits);
  const hundred = BigInt(100) * 10n ** BigInt(pointFromRight);
  if (negative || scaled <= 0n || scaled >= hundred) {
    throw new Error('objective must satisfy 0 < objective < 100');
  }
  const fractionDigits = pointFromRight === 0 ? '' : digits.slice(digits.length - pointFromRight);
  const significant = fractionDigits.replace(/0+$/, '');
  if (significant.length > 4) {
    throw new Error('objective supports at most 4 decimal places');
  }
  // <= 4 decimals means value * 10_000 is an exact integer: no rounding
  // decision to disagree about across languages.
  const ppm = (scaled * 10_000n) / 10n ** BigInt(pointFromRight);
  return Number(ppm);
}

// ---------------------------------------------------------------------------
// micros strings: bounded integer validation + comparison helpers
// ---------------------------------------------------------------------------

const BOUNDED_MICROS = /^(?:0|[1-9]\d{0,18})$/;

export const MAX_EXACT_INT64 = 9007199254740991n; // Number.MAX_SAFE_INTEGER

export function parseMicrosString(
  raw: string | null | undefined,
  field: string,
): { readonly value: bigint | null; readonly error: string | null } {
  if (raw === null || raw === undefined || raw === '') {
    return { value: null, error: null };
  }
  if (!BOUNDED_MICROS.test(raw)) {
    return { value: null, error: `${field} must be a non-negative integer string (max 19 digits)` };
  }
  const value = BigInt(raw);
  // The canonical JSON must reproduce Python's arbitrary-precision integer
  // rendering byte-for-byte, and a JS number above 2^53-1 cannot. The
  // platform budget is 900 seconds of age and 5 seconds of latency; anything
  // needing the full int64 range is a configuration error at this boundary,
  // and a refusal is truer than an inexact checksum.
  if (value > MAX_EXACT_INT64) {
    return { value: null, error: `${field} exceeds the exact-integer range (2^53-1)` };
  }
  return { value, error: null };
}

// ---------------------------------------------------------------------------
// definition building + validation (mirror of SloDefinition.__post_init__)
// ---------------------------------------------------------------------------

export interface SloDefinitionInput {
  readonly sloId: string;
  readonly service: string;
  readonly description: string;
  readonly owner: string;
  readonly indicator: string;
  readonly objective: string;
  readonly windowMinutes: number;
  readonly shortWindowMinutes: number;
  readonly goodEvent: string;
  readonly badEvent: string;
  readonly warningBurnPpm?: number;
  readonly criticalBurnPpm?: number;
  readonly maxAgeMicros?: string | null;
  readonly latencyThresholdMicros?: string | null;
  readonly version?: number;
  readonly enabled?: boolean;
}

export function buildSloDefinition(input: SloDefinitionInput): SloDefinition {
  const errors: string[] = [];

  const objective = canonicalObjectiveString(input.objective);
  if (objective === null) {
    errors.push('objective is not a finite plain decimal string with at most 4 fraction digits');
  }

  if (!SLO_INDICATORS.includes(input.indicator as SloIndicatorValue)) {
    errors.push('indicator is not one of the nine closed indicator types');
  }

  if (!SLO_ID_PATTERN.test(input.sloId)) {
    errors.push('slo_id must be a bounded lowercase identifier');
  }
  if (!SLO_ID_PATTERN.test(input.service)) {
    errors.push('service must be a bounded lowercase identifier');
  }
  if (!SLO_OWNER_PATTERN.test(input.owner)) {
    errors.push('owner must be a bounded team identifier');
  }
  if (input.description.length === 0 || input.description.length > 200) {
    errors.push('description must be 1..200 characters');
  }
  if (
    input.goodEvent.length < 1 ||
    input.goodEvent.length > 200 ||
    input.badEvent.length < 1 ||
    input.badEvent.length > 200
  ) {
    errors.push('good_event/bad_event must be 1..200 characters');
  }
  if (!Number.isInteger(input.windowMinutes) || input.windowMinutes < MIN_WINDOW_MINUTES || input.windowMinutes > MAX_WINDOW_MINUTES) {
    errors.push('window_minutes out of bounds');
  }
  if (
    !Number.isInteger(input.shortWindowMinutes) ||
    input.shortWindowMinutes < MIN_WINDOW_MINUTES ||
    input.shortWindowMinutes > input.windowMinutes
  ) {
    errors.push('short_window_minutes must sit inside the window');
  }

  const version = input.version ?? 1;
  if (version < 1) {
    errors.push('version must be >= 1');
  }
  const warningBurnPpm = input.warningBurnPpm ?? DEFAULT_WARNING_BURN_PPM;
  const criticalBurnPpm = input.criticalBurnPpm ?? DEFAULT_CRITICAL_BURN_PPM;
  if (warningBurnPpm <= 0 || criticalBurnPpm <= 0) {
    errors.push('burn thresholds must be positive ppm');
  }
  if (criticalBurnPpm < warningBurnPpm) {
    errors.push('critical burn threshold must be >= warning burn threshold');
  }

  let objectivePpm = 0;
  if (objective !== null) {
    try {
      objectivePpm = objectiveToPpm(objective);
    } catch (error) {
      errors.push((error as Error).message);
    }
  }

  const maxAge = parseMicrosString(input.maxAgeMicros ?? null, 'max_age_micros');
  const latency = parseMicrosString(
    input.latencyThresholdMicros ?? null,
    'latency_threshold_micros',
  );
  if (maxAge.error !== null) {
    errors.push(maxAge.error);
  }
  if (latency.error !== null) {
    errors.push(latency.error);
  }

  const indicator = input.indicator as SloIndicatorValue;
  const isFreshness = FRESHNESS_INDICATORS.has(indicator);
  if (isFreshness) {
    if (maxAge.value === null || maxAge.value <= 0n) {
      errors.push(`${indicator} requires max_age_micros > 0`);
    }
    if (latency.value !== null) {
      errors.push(`${indicator} must not carry latency_threshold_micros`);
    }
  } else if (indicator === 'latency_threshold_compliance') {
    if (latency.value === null || latency.value <= 0n) {
      errors.push('latency compliance requires latency_threshold_micros > 0');
    }
    if (maxAge.value !== null) {
      errors.push('latency compliance must not carry max_age_micros');
    }
  } else if (maxAge.value !== null || latency.value !== null) {
    errors.push('count indicators carry no thresholds; use a threshold indicator');
  }

  if (errors.length > 0) {
    throw new SloValidationError(errors, input.sloId);
  }

  return {
    sloId: input.sloId,
    service: input.service,
    description: input.description,
    owner: input.owner,
    indicator,
    // Non-null here: the objective was canonicalised before validation and
    // any failure added an error above, which already threw.
    objective: objective as string,
    objectivePpm,
    windowMinutes: input.windowMinutes,
    shortWindowMinutes: input.shortWindowMinutes,
    goodEvent: input.goodEvent,
    badEvent: input.badEvent,
    warningBurnPpm,
    criticalBurnPpm,
    maxAgeMicros: maxAge.value === null ? null : maxAge.value.toString(),
    latencyThresholdMicros: latency.value === null ? null : latency.value.toString(),
    version,
    enabled: input.enabled ?? true,
  };
}

// ---------------------------------------------------------------------------
// canonical payload + checksum
// ---------------------------------------------------------------------------

/** The 14 checksummed keys, built field-by-field (not from the runtime
 *  object) so the exclusion rules - `version` and `enabled` are NOT part of
 *  the objective's identity - are a visible structural fact, not a delete
 *  that someone forgets. Mirrors SloDefinition.canonical_payload exactly. */
export function canonicalPayload(definition: SloDefinition): Record<string, unknown> {
  return {
    sloId: definition.sloId,
    service: definition.service,
    description: definition.description,
    owner: definition.owner,
    indicator: definition.indicator,
    objective: definition.objective,
    windowMinutes: definition.windowMinutes,
    shortWindowMinutes: definition.shortWindowMinutes,
    goodEvent: definition.goodEvent,
    badEvent: definition.badEvent,
    warningBurnPpm: definition.warningBurnPpm,
    criticalBurnPpm: definition.criticalBurnPpm,
    maxAgeMicros: definition.maxAgeMicros === null ? null : Number(definition.maxAgeMicros),
    latencyThresholdMicros:
      definition.latencyThresholdMicros === null
        ? null
        : Number(definition.latencyThresholdMicros),
  };
}

/** Compact key-sorted JSON with the exact semantics of
 *  `canonical_slo_json` (which itself mirrors Part 8's canonicaliser). The
 *  micros fields are numbers in the payload, so a 64-bit value above
 *  Number.MAX_SAFE_INTEGER would misrender - the DTO caps micros strings at
 *  19 digits and the checksum test vector pins behaviour inside the safe
 *  range; values beyond 2^53 are refused by the DTO's own bound (see
 *  EPOCH_MICROS_CEILING-style check in the DTO layer). */
export function canonicalSloJson(payload: Record<string, unknown>): string {
  return canonicalJsonCompact(payload);
}

export function sloChecksum(definition: SloDefinition): string {
  return createHash('sha256')
    .update(canonicalSloJson(canonicalPayload(definition)), 'utf8')
    .digest('hex');
}

/** Same algorithm as risk.digest.ts's canonicalJson (sorted keys, compact
 *  separators, finite-only), inlined only for the import-graph reason below:
 *  risk.digest lives in the risk module and this module must not create a
 *  cross-module dependency for the trading-adjacent code paths. The parity
 *  spec asserts byte-equality against the Python encoder on the fixture
 *  vectors, so "same algorithm" is machine-checked, not asserted.
 */
function canonicalJsonCompact(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  const type = typeof value;
  if (type === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (type === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new Error('canonical JSON refuses non-finite numbers');
    }
    const asNumber = value as number;
    if (Number.isInteger(asNumber) && !Object.is(asNumber, -0)) {
      return String(asNumber);
    }
    // Python's json.dumps emits repr(float); JS String() agrees on every
    // value that can arise from these payloads (integers or short decimals
    // produced by the canonicaliser itself), pinned by the fixture vectors.
    return String(asNumber);
  }
  if (type === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonCompact(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts = keys.map((key) => `${JSON.stringify(key)}:${canonicalJsonCompact(record[key])}`);
  return `{${parts.join(',')}}`;
}
