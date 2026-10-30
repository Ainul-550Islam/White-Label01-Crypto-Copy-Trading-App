// # Responsibility: decimal-string money arithmetic and formatting for the custody console, with no float conversion at any point.
//
// The API sends money as decimal strings precisely so that nothing downstream
// rounds it. `Number('0.1') + Number('0.2')` is the bug this module exists to
// avoid, and it is easy to reintroduce by "just formatting" a value. Every
// function here works on the digit string:
//
//   * `formatAmount` groups the integer part and pads the fraction without
//     ever calling `Number`, so a 30-decimal wei amount survives intact.
//   * `addAmounts` / `subtractAmounts` do fixed-point arithmetic on scaled
//     integers.
//   * `compareAmounts` returns -1/0/1 for the same reason.
//
// A value that is not a plain decimal string is returned unchanged rather than
// coerced: showing the operator what the API actually said beats showing a
// plausible number that is wrong.

const DECIMAL = /^-?\d+(?:\.\d+)?$/;

/** True for a plain, finite decimal string such as "1000.50" or "0". Never for "1e9", "", "NaN". */
export function isDecimalString(value: unknown): value is string {
  return typeof value === 'string' && DECIMAL.test(value);
}

function splitDecimal(value: string): { negative: boolean; whole: string; fraction: string } {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  return { negative, whole: whole === '' ? '0' : whole, fraction };
}

function groupWhole(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export interface FormatAmountOptions {
  /** Digits kept after the decimal point. Defaults to every digit the API sent. */
  fractionDigits?: number;
  /** Appended after the digits, e.g. " BTC". Never inserted into the number itself. */
  symbol?: string;
  /** Rendered when the value is null/undefined: an unknown amount is not zero. */
  placeholder?: string;
}

/**
 * Formats a decimal string for display. Null/undefined/'unknown' render the
 * placeholder (the API uses null to mean "not measured"), never "0".
 */
export function formatAmount(
  value: string | null | undefined,
  { fractionDigits, symbol, placeholder = 'Unavailable' }: FormatAmountOptions = {},
): string {
  if (value === null || value === undefined || value === '') return placeholder;
  if (!isDecimalString(value)) return value;

  const { negative, whole, fraction } = splitDecimal(value);
  const kept = fractionDigits === undefined ? fraction : fraction.slice(0, fractionDigits).padEnd(fractionDigits, '0');
  const digits = kept.length > 0 ? `${groupWhole(whole)}.${kept}` : groupWhole(whole);

  return `${negative ? '-' : ''}${digits}${symbol ? ` ${symbol}` : ''}`;
}

/** Scales a decimal string to an integer of `scale` fraction digits. Returns null when it would lose precision. */
function toScaled(value: string, scale: number): bigint | null {
  if (!isDecimalString(value)) return null;
  const { negative, whole, fraction } = splitDecimal(value);
  if (fraction.length > scale) {
    // Truncating here would silently change the amount, so refuse instead.
    if (/[1-9]/.test(fraction.slice(scale))) return null;
  }
  const digits = `${whole}${fraction.slice(0, scale).padEnd(scale, '0')}`;
  const magnitude = BigInt(digits);
  return negative ? -magnitude : magnitude;
}

function fromScaled(value: bigint, scale: number): string {
  const negative = value < BigInt(0);
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = scale === 0 ? '' : digits.slice(digits.length - scale);
  const trimmed = fraction.replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${trimmed ? `.${trimmed}` : ''}`;
}

/** Widest fraction length across the inputs, so nothing is truncated. */
function scaleOf(values: string[]): number {
  return values.reduce((widest, value) => Math.max(widest, splitDecimal(value).fraction.length), 0);
}

/**
 * Sums decimal strings exactly. Returns null when any input is not a decimal
 * string - a total that silently drops an unreadable row is worse than no
 * total, because the operator cannot tell which case they are looking at.
 */
export function addAmounts(values: Array<string | null | undefined>): string | null {
  const present = values.filter((value): value is string => value !== null && value !== undefined && value !== '');
  if (present.length === 0) return null;
  if (present.some((value) => !isDecimalString(value))) return null;

  const scale = scaleOf(present);
  let total = BigInt(0);
  for (const value of present) {
    const scaled = toScaled(value, scale);
    if (scaled === null) return null;
    total += scaled;
  }
  return fromScaled(total, scale);
}

/** `left - right`, exactly. Null when either side is unreadable or precision would be lost. */
export function subtractAmounts(left: string, right: string): string | null {
  if (!isDecimalString(left) || !isDecimalString(right)) return null;
  const scale = scaleOf([left, right]);
  const scaledLeft = toScaled(left, scale);
  const scaledRight = toScaled(right, scale);
  if (scaledLeft === null || scaledRight === null) return null;
  return fromScaled(scaledLeft - scaledRight, scale);
}

/** -1, 0 or 1. Throws for a non-decimal input rather than guessing an order. */
export function compareAmounts(left: string, right: string): -1 | 0 | 1 {
  if (!isDecimalString(left) || !isDecimalString(right)) {
    throw new TypeError('compareAmounts requires decimal strings');
  }
  const scale = scaleOf([left, right]);
  const scaledLeft = toScaled(left, scale);
  const scaledRight = toScaled(right, scale);
  if (scaledLeft === null || scaledRight === null) {
    throw new TypeError('compareAmounts requires decimal strings without excess precision');
  }
  if (scaledLeft < scaledRight) return -1;
  return scaledLeft > scaledRight ? 1 : 0;
}

/** True only when the value is a strict positive decimal string. */
export function isPositiveAmount(value: unknown): boolean {
  if (!isDecimalString(value)) return false;
  const { negative, whole, fraction } = splitDecimal(value);
  if (negative) return false;
  return /[1-9]/.test(`${whole}${fraction}`);
}

/** Days/hours/minutes from a millisecond duration, for cooldown copy. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'Ready now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}
