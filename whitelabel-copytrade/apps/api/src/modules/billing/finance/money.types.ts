/**
 * Canonical monetary types, currency handling, Decimal-safe arithmetic boundaries,
 * rounding modes, minor-unit conversion, and money comparison helpers.
 *
 * Requirements:
 *  - precise decimal-safe representation
 *  - Never use JavaScript floating-point arithmetic for ledger totals
 *  - Compatible with Prisma Decimal conventions
 *  - Support basis-point and percentage calculations
 */

export enum Currency {
  USD = 'USD',
  EUR = 'EUR',
  GBP = 'GBP',
  JPY = 'JPY',
  CAD = 'CAD',
  AUD = 'AUD',
  BTC = 'BTC',
  ETH = 'ETH',
  USDT = 'USDT',
  USDC = 'USDC',
}

export enum RoundingMode {
  HALF_UP = 'HALF_UP',
  HALF_DOWN = 'HALF_DOWN',
  HALF_EVEN = 'HALF_EVEN',
  UP = 'UP',
  DOWN = 'DOWN',
  CEILING = 'CEILING',
  FLOOR = 'FLOOR',
}

export interface Money {
  amount: string;
  currency: string;
  minorUnit: number;
}

export interface MoneyWithCurrency extends Money {
  currency: Currency | string;
}

export interface Percentage {
  basisPoints: number;
  percent: string;
}

export const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW', 'VND', 'CLP', 'PYG', 'RWF', 'UGX', 'VUV', 'XAF', 'XOF', 'XPF', 'BTC', 'ETH']);

export const CURRENCY_MINOR_UNITS: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
  CAD: 2,
  AUD: 2,
  BTC: 8,
  ETH: 18,
  USDT: 6,
  USDC: 6,
};

export function getMinorUnitForCurrency(currency: string): number {
  return CURRENCY_MINOR_UNITS[currency.toUpperCase()] ?? 2;
}

export function isZeroDecimalCurrency(currency: string): boolean {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase());
}

export function createMoney(amount: string, currency: string): Money {
  const minorUnit = getMinorUnitForCurrency(currency);
  return {
    amount: normalizeAmount(amount, minorUnit),
    currency: currency.toUpperCase(),
    minorUnit,
  };
}

export function normalizeAmount(amount: string, minorUnit: number): string {
  if (!amount) return '0';
  const parsed = amount.toString().trim();
  if (parsed === '' || isNaN(parseFloat(parsed))) {
    throw new Error(`Invalid amount: ${amount}`);
  }
  const factor = Math.pow(10, minorUnit);
  const integerValue = Math.round(parseFloat(parsed) * factor);
  return (integerValue / factor).toFixed(minorUnit);
}

export function parseToMinorUnits(amount: string, currency: string): number {
  const minorUnit = getMinorUnitForCurrency(currency);
  const factor = Math.pow(10, minorUnit);
  const parsed = parseFloat(amount);
  if (isNaN(parsed)) {
    throw new Error(`Invalid amount: ${amount}`);
  }
  return Math.round(parsed * factor);
}

export function formatFromMinorUnits(minorUnits: number, currency: string): string {
  const minorUnit = getMinorUnitForCurrency(currency);
  const factor = Math.pow(10, minorUnit);
  return (minorUnits / factor).toFixed(minorUnit);
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
  const aMinor = parseToMinorUnits(a.amount, a.currency);
  const bMinor = parseToMinorUnits(b.amount, b.currency);
  const resultMinor = aMinor + bMinor;
  return {
    amount: formatFromMinorUnits(resultMinor, a.currency),
    currency: a.currency,
    minorUnit: a.minorUnit,
  };
}

export function subtractMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
  const aMinor = parseToMinorUnits(a.amount, a.currency);
  const bMinor = parseToMinorUnits(b.amount, b.currency);
  const resultMinor = aMinor - bMinor;
  return {
    amount: formatFromMinorUnits(resultMinor, a.currency),
    currency: a.currency,
    minorUnit: a.minorUnit,
  };
}

export function multiplyMoneyByDecimal(money: Money, multiplier: string, roundingMode: RoundingMode = RoundingMode.HALF_UP): Money {
  const multiplierFloat = parseFloat(multiplier);
  if (isNaN(multiplierFloat)) {
    throw new Error(`Invalid multiplier: ${multiplier}`);
  }
  const minorUnits = parseToMinorUnits(money.amount, money.currency);
  let resultMinor: number;

  switch (roundingMode) {
    case RoundingMode.UP:
      resultMinor = Math.ceil(minorUnits * multiplierFloat);
      break;
    case RoundingMode.DOWN:
    case RoundingMode.FLOOR:
      resultMinor = Math.floor(minorUnits * multiplierFloat);
      break;
    case RoundingMode.CEILING:
      resultMinor = Math.ceil(minorUnits * multiplierFloat);
      break;
    case RoundingMode.HALF_UP:
    default:
      resultMinor = Math.round(minorUnits * multiplierFloat);
      break;
  }

  return {
    amount: formatFromMinorUnits(resultMinor, money.currency),
    currency: money.currency,
    minorUnit: money.minorUnit,
  };
}

export function calculatePercentageAmount(money: Money, basisPoints: number, roundingMode: RoundingMode = RoundingMode.HALF_UP): Money {
  if (basisPoints < 0 || basisPoints > 10000) {
    throw new Error(`Invalid basis points: ${basisPoints}, must be 0-10000`);
  }
  const multiplier = (basisPoints / 10000).toString();
  return multiplyMoneyByDecimal(money, multiplier, roundingMode);
}

export function calculateTaxAmount(taxableAmount: Money, taxRateBasisPoints: number): Money {
  return calculatePercentageAmount(taxableAmount, taxRateBasisPoints, RoundingMode.HALF_UP);
}

export function compareMoney(a: Money, b: Money): number {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
  const aMinor = parseToMinorUnits(a.amount, a.currency);
  const bMinor = parseToMinorUnits(b.amount, b.currency);
  if (aMinor < bMinor) return -1;
  if (aMinor > bMinor) return 1;
  return 0;
}

export function isMoneyZero(money: Money): boolean {
  return parseToMinorUnits(money.amount, money.currency) === 0;
}

export function isMoneyPositive(money: Money): boolean {
  return parseToMinorUnits(money.amount, money.currency) > 0;
}

export function isMoneyNegative(money: Money): boolean {
  return parseToMinorUnits(money.amount, money.currency) < 0;
}

export function isMoneyGreaterThan(a: Money, b: Money): boolean {
  return compareMoney(a, b) > 0;
}

export function isMoneyLessThan(a: Money, b: Money): boolean {
  return compareMoney(a, b) < 0;
}

export function isMoneyEqual(a: Money, b: Money): boolean {
  return compareMoney(a, b) === 0;
}

export function sumMoney(moneyArray: Money[]): Money {
  if (moneyArray.length === 0) {
    throw new Error('Cannot sum empty money array');
  }
  const currency = moneyArray[0].currency;
  let totalMinor = 0;
  for (const money of moneyArray) {
    if (money.currency !== currency) {
      throw new Error(`Currency mismatch in sum: ${currency} vs ${money.currency}`);
    }
    totalMinor += parseToMinorUnits(money.amount, money.currency);
  }
  return {
    amount: formatFromMinorUnits(totalMinor, currency),
    currency,
    minorUnit: getMinorUnitForCurrency(currency),
  };
}

export function absoluteMoney(money: Money): Money {
  const minorUnits = parseToMinorUnits(money.amount, money.currency);
  return {
    amount: formatFromMinorUnits(Math.abs(minorUnits), money.currency),
    currency: money.currency,
    minorUnit: money.minorUnit,
  };
}

export function negateMoney(money: Money): Money {
  const minorUnits = parseToMinorUnits(money.amount, money.currency);
  return {
    amount: formatFromMinorUnits(-minorUnits, money.currency),
    currency: money.currency,
    minorUnit: money.minorUnit,
  };
}

export function validateMoney(money: Money): void {
  if (!money.amount) {
    throw new Error('Money amount required');
  }
  if (!money.currency) {
    throw new Error('Money currency required');
  }
  const parsed = parseFloat(money.amount);
  if (isNaN(parsed)) {
    throw new Error(`Invalid money amount: ${money.amount}`);
  }
}

export function moneyToPrismaDecimal(money: Money): string {
  return money.amount;
}

export function prismaDecimalToMoney(decimal: any, currency: string): Money {
  const amount = typeof decimal === 'string' ? decimal : decimal?.toString() || '0';
  return createMoney(amount, currency);
}
