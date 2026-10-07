// # Responsibility: exact decimal-string arithmetic for trading, risk, and fee calculations.

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
