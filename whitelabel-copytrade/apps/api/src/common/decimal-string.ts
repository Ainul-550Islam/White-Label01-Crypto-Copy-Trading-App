// # Responsibility: exact decimal-string arithmetic for trading, risk, and fee calculations.
//
// This is the ONE canonical module for money, prices, quantities and rates on the
// API. It exposes two layers over the same representation, and a call site picks
// the layer that matches what it knows about the value.
//
//   Layer 1 - fixed scale 12 (DECIMAL_SCALE).
//     `parseDecimalString` / `formatDecimalString` / `divideDecimalStrings` /
//     `multiplyDecimalStrings`. Fast, allocation-light, and the convention most
//     of the API already speaks: every value is a bigint of 12-place scaled
//     units. Use it when the value provably fits 12 decimal places.
//
//   Layer 2 - arbitrary scale (`Decimal`).
//     An exact `unscaled * 10^-scale` value with an explicit scale, so it can
//     represent a venue step of 1e-18 without silently truncating, and with the
//     rounding modes that directional decisions need (a size floors DOWN, a
//     slippage ceiling rounds UP). Use it wherever a value crosses the venue
//     precision boundary or needs deterministic rounding.
//
// WHY BOTH, AND WHY THEY ARE NOT DUPLICATES
// ----------------------------------------
// Layer 1 cannot express what the copy-execution path needs: its pattern admits
// at most 12 fractional digits (`\d{1,12}`), and a venue that quotes a quantity
// step of 0.000000000000000001 is not representable at all. Neither layer 1
// helper can round in a chosen direction, and size snapping must floor - any
// other direction can over-allocate a follower's balance. Rather than fork a
// second decimal library, the arbitrary-precision layer lives here, next to the
// fixed-scale one it supersedes, and `Decimal.toScaled12Exact()` bridges back.
//
// INVARIANTS
// ----------
//   1. No operation ever uses `number` for a value. `number` input is accepted
//      for ergonomics and parsed at its shortest round-trip decimal, which is the
//      float's value and not necessarily the intended one; financial call sites
//      must pass strings. No arithmetic here is performed on a `number`.
//   2. Parsing is total over exact decimal and scientific-notation input and
//      throws `DecimalError` on anything else. It never degrades to a float.
//   3. `Decimal.toString()` / `.toFixed()` never emit exponent notation, so the
//      result is always safe to hand to an exchange REST/WS API.
//   4. Rounding is explicit at every point where precision is lost. Size snapping
//      floors; price snapping takes a direction; division requires a scale.
//   5. Layer 1's exported signatures and behaviour are frozen - they predate this
//      module's Layer 2 and are depended on across the API.

// =============================================================================
// Layer 1 - fixed scale 12 (frozen).
// =============================================================================

export const DECIMAL_SCALE = 12;
export const DECIMAL_FACTOR = 1_000_000_000_000n;
const DECIMAL_STRING_PATTERN = /^([+-]?)(0|[1-9]\d*)(?:\.(\d{1,12}))?$/;

/** Returns whether unknown input is a plain, exactly representable decimal string. */
export function isDecimalString(input: unknown): input is string {
  return typeof input === 'string' && input.length <= 80 && DECIMAL_STRING_PATTERN.test(input.trim());
}

/** Parse a base-10 decimal string into a 12-place scaled integer without floating point. */
export function parseDecimalString(input: string): bigint {
  if (typeof input !== 'string' || input.length > 80) {
    throw new TypeError('Decimal value must be a string of at most 80 characters');
  }
  const match = DECIMAL_STRING_PATTERN.exec(input.trim());
  if (!match) throw new TypeError('Decimal value must be a plain base-10 string with at most 12 decimal places');
  const sign = match[1] === '-' ? -1n : 1n;
  const fractional = (match[3] ?? '').padEnd(DECIMAL_SCALE, '0');
  return sign * (BigInt(match[2]) * DECIMAL_FACTOR + BigInt(fractional || '0'));
}

/** Format a 12-place scaled integer as a non-exponential decimal string. */
export function formatDecimalString(value: bigint, outputPlaces = 8): string {
  if (!Number.isInteger(outputPlaces) || outputPlaces < 0 || outputPlaces > DECIMAL_SCALE) {
    throw new RangeError('outputPlaces must be an integer from 0 through 12');
  }
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const integer = absolute / DECIMAL_FACTOR;
  const fraction = (absolute % DECIMAL_FACTOR).toString().padStart(DECIMAL_SCALE, '0');
  const retained = fraction.slice(0, outputPlaces);
  const result = outputPlaces === 0 ? integer.toString() : `${integer}.${retained}`;
  const trimmed = result.includes('.') ? result.replace(/0+$/, '').replace(/\.$/, '') : result;
  return `${negative && absolute !== 0n ? '-' : ''}${trimmed}`;
}

/** Rounded division of two scaled values, returning another scaled value. */
export function divideDecimalStrings(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('Cannot divide by zero');
  const scaledNumerator = numerator * DECIMAL_FACTOR;
  const quotient = scaledNumerator / denominator;
  const remainder = scaledNumerator % denominator;
  const absRemainder = remainder < 0n ? -remainder : remainder;
  const absDenominator = denominator < 0n ? -denominator : denominator;
  const shouldRound = absRemainder * 2n >= absDenominator;
  if (!shouldRound) return quotient;
  const sign = (scaledNumerator < 0n) !== (denominator < 0n) ? -1n : 1n;
  return quotient + sign;
}

/** Multiply two scaled values and round half away from zero back to 12 places. */
export function multiplyDecimalStrings(left: bigint, right: bigint): bigint {
  const product = left * right;
  const quotient = product / DECIMAL_FACTOR;
  const remainder = product % DECIMAL_FACTOR;
  if ((remainder < 0n ? -remainder : remainder) * 2n < DECIMAL_FACTOR) return quotient;
  return quotient + (product < 0n ? -1n : 1n);
}

// =============================================================================
// Layer 2 - arbitrary scale, explicit rounding.
// =============================================================================

/** How a value is rounded when digits must be discarded. */
export type RoundingMode = 'FLOOR' | 'CEIL' | 'DOWN' | 'HALF_UP' | 'HALF_EVEN';

/** Thrown for any value this module refuses to represent. Never caught to continue. */
export class DecimalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecimalError';
  }
}

/** Digits per bigint limb do not exist here; these bound absurd input instead. */
const MAX_SCALE = 1_000;
const MAX_DIGITS = 10_000;
const DECIMAL_RE = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

function pow10(exponent: number): bigint {
  if (!Number.isInteger(exponent) || exponent < 0) {
    throw new DecimalError(`pow10 requires a non-negative integer, got ${exponent}`);
  }
  return 10n ** BigInt(exponent);
}

/** Truncating division that floors toward negative infinity. */
function divFloor(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new DecimalError('Division by zero');
  const quotient = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? quotient - 1n : quotient;
}

/** Truncating division that ceils toward positive infinity. */
function divCeil(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new DecimalError('Division by zero');
  const quotient = a / b;
  return a % b !== 0n && a < 0n === b < 0n ? quotient + 1n : quotient;
}

/**
 * An exact decimal: `unscaled * 10^-scale`, with `scale >= 0`.
 *
 * Addition and subtraction rescale to the larger scale and are always exact.
 * Multiplication is exact. Division is the only deliberately lossy operation and
 * therefore requires the caller to state a target scale and rounding mode.
 */
export class Decimal {
  /** Value = unscaled * 10^-scale. */
  readonly unscaled: bigint;
  /** Number of fractional digits held. Always >= 0. */
  readonly scale: number;

  private constructor(unscaled: bigint, scale: number) {
    this.unscaled = unscaled;
    this.scale = scale;
  }

  // ---------------------------------------------------------------- factories

  static readonly ZERO = new Decimal(0n, 0);
  static readonly ONE = new Decimal(1n, 0);

  /** Build from already-scaled units. Prefer {@link parse} for textual input. */
  static fromUnscaled(unscaled: bigint, scale = 0): Decimal {
    if (!Number.isInteger(scale) || scale < 0 || scale > MAX_SCALE) {
      throw new DecimalError(`Invalid scale: ${scale}`);
    }
    return new Decimal(unscaled, scale);
  }

  /**
   * Parse an exact decimal.
   *
   * Accepts integers, fixed point (`"0.001"`), signs and scientific notation
   * (`"1e-9"`, `"2.5E+3"`) - all exactly, never through a float. Rejects `NaN`,
   * `Infinity`, empty strings and bare `.`/`+`.
   *
   * `number` input is accepted for ergonomics but is inherently lossy: a
   * fractional double parses at its shortest round-trip decimal, which is the
   * value the *float* holds, not necessarily the intended one (`0.1 + 0.2`
   * becomes `0.30000000000000004`, not `0.3`). Financial call sites must pass
   * strings; this module never performs arithmetic on a `number`.
   */
  static parse(value: string | number | bigint | Decimal): Decimal {
    if (value instanceof Decimal) return value;
    if (typeof value === 'bigint') return new Decimal(value, 0);

    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new DecimalError(`Cannot parse non-finite number: ${value}`);
      }
      if (Number.isInteger(value) && Number.isSafeInteger(value)) {
        return new Decimal(BigInt(value), 0);
      }
      return Decimal.parse(value.toString());
    }

    const raw = String(value).trim();
    if (raw.length === 0) throw new DecimalError('Cannot parse an empty string');
    if (raw.length > MAX_DIGITS) throw new DecimalError('Decimal input too long');

    const match = DECIMAL_RE.exec(raw);
    if (!match) throw new DecimalError(`Invalid decimal: "${raw}"`);

    const sign = match[1];
    const intPart = match[2] ?? '';
    const fracPart = match[3] ?? '';
    const expPart = match[4];

    if (intPart === '' && fracPart === '') {
      throw new DecimalError(`Invalid decimal: "${raw}"`);
    }

    const exponent = expPart ? Number(expPart) : 0;
    if (!Number.isSafeInteger(exponent)) {
      throw new DecimalError(`Invalid exponent in "${raw}"`);
    }

    const digits = intPart + fracPart;
    const unscaledAbs = digits.length > 0 ? BigInt(digits) : 0n;
    // Value = digits * 10^(exponent - fracPart.length)
    const netExponent = exponent - fracPart.length;

    let unscaled = sign === '-' ? -unscaledAbs : unscaledAbs;
    let scale: number;

    if (netExponent >= 0) {
      unscaled *= pow10(netExponent);
      scale = 0;
    } else {
      scale = -netExponent;
    }

    if (scale > MAX_SCALE) {
      throw new DecimalError(`Scale ${scale} exceeds the supported maximum`);
    }

    return new Decimal(unscaled, scale);
  }

  /** Parse, returning `null` instead of throwing. For optional input. */
  static tryParse(value: unknown): Decimal | null {
    if (value === null || value === undefined) return null;
    const acceptable =
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'bigint' ||
      value instanceof Decimal;
    if (!acceptable) return null;
    try {
      return Decimal.parse(value as string | number | bigint | Decimal);
    } catch {
      return null;
    }
  }

  /** True when the value is an exact decimal this module can parse. */
  static isDecimal(value: unknown): boolean {
    return Decimal.tryParse(value) !== null;
  }

  // ------------------------------------------------------------ normalisation

  /** Rescale two values to a common scale. Exact in both directions here. */
  private static align(a: Decimal, b: Decimal): [bigint, bigint, number] {
    const scale = Math.max(a.scale, b.scale);
    return [a.unscaled * pow10(scale - a.scale), b.unscaled * pow10(scale - b.scale), scale];
  }

  /** Rescale this value to `scale`, applying `mode` when digits must be lost. */
  rescale(scale: number, mode: RoundingMode = 'HALF_UP'): Decimal {
    if (!Number.isInteger(scale) || scale < 0 || scale > MAX_SCALE) {
      throw new DecimalError(`Invalid target scale: ${scale}`);
    }
    if (scale >= this.scale) {
      return new Decimal(this.unscaled * pow10(scale - this.scale), scale);
    }

    const drop = this.scale - scale;
    const divisor = pow10(drop);
    const remainder = this.unscaled % divisor;
    let quotient = this.unscaled / divisor;

    if (remainder !== 0n) {
      const negative = this.unscaled < 0n;
      const absRemainder = remainder < 0n ? -remainder : remainder;
      const twiceAbsRemainder = absRemainder * 2n;

      switch (mode) {
        case 'DOWN':
          break; // truncate toward zero
        case 'FLOOR':
          if (negative) quotient -= 1n;
          break;
        case 'CEIL':
          if (!negative) quotient += 1n;
          break;
        case 'HALF_UP':
          if (twiceAbsRemainder >= divisor) quotient += negative ? -1n : 1n;
          break;
        case 'HALF_EVEN':
          if (twiceAbsRemainder > divisor || (twiceAbsRemainder === divisor && quotient % 2n !== 0n)) {
            quotient += negative ? -1n : 1n;
          }
          break;
        default: {
          const exhaustive: never = mode;
          throw new DecimalError(`Unknown rounding mode: ${String(exhaustive)}`);
        }
      }
    }

    return new Decimal(quotient, scale);
  }

  /** Drop trailing fractional zeros so canonical output stays minimal. */
  normalize(): Decimal {
    let unscaled = this.unscaled;
    let scale = this.scale;
    if (unscaled === 0n) return Decimal.ZERO;
    while (scale > 0 && unscaled % 10n === 0n) {
      unscaled /= 10n;
      scale -= 1;
    }
    return new Decimal(unscaled, scale);
  }

  // --------------------------------------------------------------- arithmetic

  add(other: Decimal | string | number | bigint): Decimal {
    const o = Decimal.parse(other as never);
    const [a, b, scale] = Decimal.align(this, o);
    return new Decimal(a + b, scale).normalize();
  }

  sub(other: Decimal | string | number | bigint): Decimal {
    const o = Decimal.parse(other as never);
    const [a, b, scale] = Decimal.align(this, o);
    return new Decimal(a - b, scale).normalize();
  }

  /** Exact multiplication - no rounding, no precision loss. */
  mul(other: Decimal | string | number | bigint): Decimal {
    const o = Decimal.parse(other as never);
    return new Decimal(this.unscaled * o.unscaled, this.scale + o.scale).normalize();
  }

  /**
   * Division. `scale` is the fractional digits of the result and `mode` decides
   * the final digit, because division is the only operation that loses precision
   * by construction and the caller must say how much it wants.
   */
  div(other: Decimal | string | number | bigint, scale = 18, mode: RoundingMode = 'HALF_UP'): Decimal {
    const o = Decimal.parse(other as never);
    if (o.unscaled === 0n) throw new DecimalError('Division by zero');

    // (a / 10^as) / (b / 10^bs) = (a * 10^bs) / (b * 10^as); scale the numerator
    // by 10^scale to land the quotient on the requested number of digits.
    const numerator = this.unscaled * pow10(o.scale) * pow10(scale);
    const denominator = o.unscaled * pow10(this.scale);

    if (mode === 'FLOOR') return new Decimal(divFloor(numerator, denominator), scale).normalize();
    if (mode === 'CEIL') return new Decimal(divCeil(numerator, denominator), scale).normalize();

    const quotient = divFloor(numerator, denominator);
    const remainder = numerator - quotient * denominator;
    if (remainder === 0n) return new Decimal(quotient, scale).normalize();

    // Recompute with one guard digit so HALF_* modes see the true tail instead of
    // deciding from an already-truncated value.
    const extraNumerator = this.unscaled * pow10(o.scale) * pow10(scale + 1);
    const extraQuotient = divFloor(extraNumerator, denominator);
    return new Decimal(extraQuotient, scale + 1).rescale(scale, mode).normalize();
  }

  // -------------------------------------------------------------- comparisons

  /** -1, 0 or 1. Exact; never through a float. */
  cmp(other: Decimal | string | number | bigint): -1 | 0 | 1 {
    const o = Decimal.parse(other as never);
    const [a, b] = Decimal.align(this, o);
    return a < b ? -1 : a > b ? 1 : 0;
  }

  eq(other: Decimal | string | number | bigint): boolean { return this.cmp(other) === 0; }
  gt(other: Decimal | string | number | bigint): boolean { return this.cmp(other) > 0; }
  gte(other: Decimal | string | number | bigint): boolean { return this.cmp(other) >= 0; }
  lt(other: Decimal | string | number | bigint): boolean { return this.cmp(other) < 0; }
  lte(other: Decimal | string | number | bigint): boolean { return this.cmp(other) <= 0; }

  isZero(): boolean { return this.unscaled === 0n; }
  isPositive(): boolean { return this.unscaled > 0n; }
  isNegative(): boolean { return this.unscaled < 0n; }

  abs(): Decimal { return this.unscaled < 0n ? new Decimal(-this.unscaled, this.scale) : this; }
  neg(): Decimal { return new Decimal(-this.unscaled, this.scale); }

  // ------------------------------------------------------ step / tick snapping

  /**
   * Snap a size DOWN to a multiple of `step`, or `null` when the result is zero
   * or `step` is unusable.
   *
   * Flooring is the safe direction for quantities: it can only reduce exposure.
   * Returning `null` rather than `0` matters because a zero-sized order is not a
   * small order, it is an invalid one, and the caller has to decide what to do
   * about a size that vanishes at the venue's precision.
   */
  static floorToStep(value: Decimal | string, step: Decimal | string): Decimal | null {
    const v = Decimal.parse(value as never);
    const s = Decimal.parse(step as never);
    if (s.isZero() || s.isNegative()) return null;
    const steps = v.div(s, 0, 'FLOOR');
    const snapped = steps.mul(s).normalize();
    return snapped.isZero() ? null : snapped;
  }

  /**
   * Snap a price to a multiple of `tick` in the requested direction:
   *   - BUY ceiling   -> 'CEIL'  (never pay more than the bound allows)
   *   - SELL floor    -> 'FLOOR'
   *   - reference px  -> 'HALF_UP'
   */
  static roundToTick(
    value: Decimal | string,
    tick: Decimal | string,
    direction: RoundingMode = 'HALF_UP',
  ): Decimal {
    const v = Decimal.parse(value as never);
    const t = Decimal.parse(tick as never);
    if (t.isZero() || t.isNegative()) return v;
    const steps = v.div(t, 0, direction);
    return steps.mul(t).normalize();
  }

  /** Next tick boundary at or above `value`. */
  static ceilToTick(value: Decimal | string, tick: Decimal | string): Decimal {
    return Decimal.roundToTick(value, tick, 'CEIL');
  }

  /** Previous tick boundary at or below `value`. */
  static floorToTick(value: Decimal | string, tick: Decimal | string): Decimal {
    return Decimal.roundToTick(value, tick, 'FLOOR');
  }

  // ------------------------------------------------------------------- output

  /** Canonical plain-decimal string. Never exponent notation. `"0"` for zero. */
  toString(): string {
    if (this.unscaled === 0n) return '0';
    const negative = this.unscaled < 0n;
    const digits = (negative ? -this.unscaled : this.unscaled).toString();

    if (this.scale === 0) return (negative ? '-' : '') + digits;

    const padded = digits.padStart(this.scale + 1, '0');
    const intPart = padded.slice(0, -this.scale);
    const fracPart = padded.slice(-this.scale).replace(/0+$/, '');
    const body = fracPart ? `${intPart}.${fracPart}` : intPart;
    return (negative ? '-' : '') + body;
  }

  /** Fixed-point string carrying exactly `dp` fractional digits. */
  toFixed(dp: number, mode: RoundingMode = 'HALF_UP'): string {
    const rounded = this.rescale(dp, mode);
    const negative = rounded.unscaled < 0n;
    const digits = (negative ? -rounded.unscaled : rounded.unscaled).toString();
    if (dp === 0) return (negative ? '-' : '') + digits;
    const padded = digits.padStart(dp + 1, '0');
    return `${negative ? '-' : ''}${padded.slice(0, -dp)}.${padded.slice(-dp)}`;
  }

  /** Exact bigint of `value * 10^dp`; throws when digits would be lost. */
  toScaledBigInt(dp: number): bigint {
    const scaled = this.rescale(dp, 'DOWN');
    if (!scaled.eq(this)) {
      throw new DecimalError(`Cannot represent ${this.toString()} exactly at scale ${dp}`);
    }
    return scaled.unscaled;
  }

  // ------------------------------------------------------ Layer 1 interop

  /**
   * Convert to the Layer 1 representation (12-place scaled bigint), throwing when
   * the value does not fit. Silently truncating here would let a value that
   * needs 18 decimal places enter the fixed-scale world as a different number.
   */
  toScaled12Exact(): bigint {
    return this.toScaledBigInt(DECIMAL_SCALE);
  }

  /** True when this value is exactly representable in Layer 1. */
  fitsLayer1(): boolean {
    try {
      this.toScaled12Exact();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Lossy escape hatch for display and non-financial comparison only. Never use
   * the result in a decision or hand it to a venue.
   */
  toNumber(): number {
    return Number(this.toString());
  }

  toJSON(): string {
    return this.toString();
  }
}

/** Shorthand for {@link Decimal.parse}, so call sites stay short and consistent. */
export function dec(value: string | number | bigint | Decimal): Decimal {
  return Decimal.parse(value);
}

/** Build a {@link Decimal} from Layer 1 units without going through a string. */
export function decimalFromScaled12(scaled: bigint): Decimal {
  return Decimal.fromUnscaled(scaled, DECIMAL_SCALE);
}

/** Largest of the given values. Throws on an empty list. */
export function maxDecimal(...values: Array<Decimal | string | number>): Decimal {
  if (values.length === 0) throw new DecimalError('maxDecimal requires at least one value');
  return values.map((value) => Decimal.parse(value as never)).reduce((a, b) => (a.gte(b) ? a : b));
}

/** Smallest of the given values. Throws on an empty list. */
export function minDecimal(...values: Array<Decimal | string | number>): Decimal {
  if (values.length === 0) throw new DecimalError('minDecimal requires at least one value');
  return values.map((value) => Decimal.parse(value as never)).reduce((a, b) => (a.lte(b) ? a : b));
}

/** Clamp `value` into `[lo, hi]`. Throws when `lo > hi`. */
export function clampDecimal(
  value: Decimal | string,
  lo: Decimal | string,
  hi: Decimal | string,
): Decimal {
  const v = Decimal.parse(value as never);
  const l = Decimal.parse(lo as never);
  const h = Decimal.parse(hi as never);
  if (l.gt(h)) throw new DecimalError('clampDecimal: lower bound exceeds upper bound');
  if (v.lt(l)) return l;
  if (v.gt(h)) return h;
  return v;
}

/**
 * Basis points of a value, exact at every step.
 * 50 bps of 60000 is 300, with no float rounding anywhere in between.
 */
export function bpsOf(value: Decimal | string, bps: number | string): Decimal {
  const v = Decimal.parse(value as never);
  const b = Decimal.parse(bps as never);
  if (b.isNegative()) throw new DecimalError('bpsOf: basis points must not be negative');
  return v.mul(b).div(10_000, 18, 'HALF_UP').normalize();
}
