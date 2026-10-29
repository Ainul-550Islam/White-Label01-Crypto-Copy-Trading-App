// # Responsibility: decimal-safe base-unit conversions for chain observations; BigInt-only, never binary float.
/**
 * Chain amounts arrive as raw base-unit integers (EVM hex quantities, TRON
 * sun strings) and leave as fixed-scale decimal strings understood by the
 * custody ledger (`Decimal` columns, string DTOs). Every hop stays integer:
 * a binary float anywhere in this path reintroduces the drift Part 21 banned.
 */
const HEX_QUANTITY_PATTERN = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const INTEGER_PATTERN = /^\+?\d+$/;

export class ChainAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChainAmountError';
  }
}

export class InvalidAssetDecimalsError extends ChainAmountError {
  constructor(decimals: number) {
    super(
      `Invalid asset decimals ${decimals}: custodied assets use integer scale ` +
        '0..36 (wei is 18, sun is 6, extreme ERC-20 deployments cap at 36).',
    );
    this.name = 'InvalidAssetDecimalsError';
  }
}

export const MAX_ASSET_DECIMALS = 36;

export function assertAssetDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_ASSET_DECIMALS) {
    throw new InvalidAssetDecimalsError(decimals);
  }
}

/** `"0x1a2b"` / `"+42"` style chain quantities -> BigInt. Reject negative, float, hex-with-sign. */
export function parseBaseUnit(quantity: string, what: string): bigint {
  if (typeof quantity !== 'string') {
    throw new ChainAmountError(`${what}: expected a string quantity, got ${typeof quantity}`);
  }
  const text = quantity.trim();
  if (HEX_QUANTITY_PATTERN.test(text)) {
    return BigInt(text);
  }
  if (!INTEGER_PATTERN.test(text)) {
    throw new ChainAmountError(
      `${what}: expected an unsigned integer or 0x-hex quantity, received a ` +
        'non-integer or negative value (signed or fractional chain flux is a protocol violation)',
    );
  }
  return BigInt(text.replace(/^\+/, ''));
}

/** Format an integer base-unit amount as a decimal string with exactly `decimals` fraction digits. */
export function formatDecimalString(amount: bigint, decimals: number): string {
  assertAssetDecimals(decimals);
  if (amount < 0n) {
    throw new ChainAmountError('formatDecimalString: amount must be non-negative');
  }
  if (decimals === 0) {
    return amount.toString(10);
  }
  const digits = amount.toString(10).padStart(decimals + 1, '0');
  const intPart = digits.slice(0, digits.length - decimals);
  const fracPart = digits.slice(digits.length - decimals);
  return `${intPart}.${fracPart}`;
}

/** Parse a decimal string into BigInt base units; refuses to drop sub-base-unit dust silently. */
export function parseDecimalString(value: string, decimals: number, what: string): bigint {
  assertAssetDecimals(decimals);
  const text = value.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) {
    throw new ChainAmountError(`${what}: not a non-negative decimal string (${JSON.stringify(value)})`);
  }
  const [, intPart, fracPartRaw] = match;
  const fracPartRawSafe = fracPartRaw ?? '';
  if (fracPartRawSafe.length > decimals) {
    const beyond = fracPartRawSafe.slice(decimals);
    if (/[1-9]/.test(beyond)) {
      throw new ChainAmountError(
        `${what}: value ${text} exceeds asset scale ${decimals}; truncated dust would be fabricated accounting`,
      );
    }
  }
  const fracPart = fracPartRawSafe.length > decimals ? fracPartRawSafe.slice(0, decimals) : fracPartRawSafe;
  const padded = fracPart.padEnd(decimals, '0');
  return BigInt(intPart + (decimals > 0 ? padded : ''));
}

/** EVM `quantity` hex (balance, gas price, per-Wei values) -> decimal string. */
export function weiHexToDecimalString(hexQuantity: string, decimals: number): string {
  return formatDecimalString(parseBaseUnit(hexQuantity, 'wei hex quantity'), decimals);
}

/** TRON sun integer string/number chain quantity -> decimal string. */
export function sunToDecimalString(sunQuantity: string | number, decimals: number): string {
  if (typeof sunQuantity === 'number') {
    if (!Number.isSafeInteger(sunQuantity) || sunQuantity < 0) {
      throw new ChainAmountError('sun quantity: must be a non-negative safe integer or a decimal string');
    }
    return formatDecimalString(BigInt(sunQuantity), decimals);
  }
  return formatDecimalString(parseBaseUnit(sunQuantity, 'sun quantity'), decimals);
}

/** Compare two base-unit integers; -1/0/1. */
export function compareBaseUnits(left: bigint, right: bigint): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** true when `amount` is greater than `threshold`; both base units. */
export function exceedsBaseUnit(amount: bigint, threshold: bigint): boolean {
  return compareBaseUnits(amount, threshold) > 0;
}
