// # Converts payment decimal strings into exact minor units and safe provider-required numbers.
import { Decimal } from './decimal-string';

const CURRENCY_SCALE: Readonly<Record<string, number>> = Object.freeze({
  AUD: 2,
  BHD: 3,
  BIF: 0,
  BNB: 18,
  BTC: 8,
  CAD: 2,
  CLP: 0,
  DOGE: 8,
  DJF: 0,
  EUR: 2,
  GBP: 2,
  GNF: 0,
  IQD: 3,
  ISK: 0,
  JOD: 3,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  KWD: 3,
  LYD: 3,
  LTC: 8,
  OMR: 3,
  PYG: 0,
  RWF: 0,
  TND: 3,
  TRX: 6,
  UGX: 0,
  USD: 2,
  USDC: 6,
  USDT: 6,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
  ETH: 18,
});

/**
 * Returns a safely representable integer count of currency minor units.
 * The decimal is scaled with BigInt and rejected rather than rounded when its precision exceeds
 * the configured currency scale or the resulting integer exceeds JavaScript's exact integer range.
 */
export function paymentAmountToMinorUnits(amountValue: unknown, currencyValue: unknown): number {
  if (typeof amountValue !== 'string' || amountValue.trim() === '') {
    throw new TypeError('Payment amount must be a non-empty exact decimal string');
  }
  if (typeof currencyValue !== 'string' || currencyValue.trim() === '') {
    throw new TypeError('Payment currency must be a non-empty string');
  }

  const currency = currencyValue.trim().toUpperCase();
  const scale = CURRENCY_SCALE[currency];
  if (scale === undefined) {
    throw new TypeError(`Minor-unit scale is not configured for ${currency}`);
  }

  const amount = Decimal.parse(amountValue);
  if (amount.isNegative()) throw new TypeError('Payment amount must not be negative');
  const minorUnits = amount.toScaledBigInt(scale);
  if (minorUnits > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Payment amount exceeds the exact safe minor-unit range');
  }
  return Number(minorUnits);
}

/**
 * NOWPayments' invoice endpoint requires `price_amount` to be a JSON number. This conversion is
 * permitted only when its JSON round-trip decimal is identical to the authoritative input string.
 */
export function nowPaymentsInvoiceAmountToNumber(amountValue: unknown): number {
  if (typeof amountValue !== 'string' || amountValue.trim() === '') {
    throw new TypeError('NOWPayments invoice amount must be a non-empty exact decimal string');
  }

  const exactAmount = Decimal.parse(amountValue);
  if (exactAmount.isNegative() || exactAmount.isZero()) {
    throw new TypeError('NOWPayments invoice amount must be greater than zero');
  }

  const numericAmount = Number(exactAmount.toString());
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new RangeError('NOWPayments invoice amount is outside the supported JSON number range');
  }
  if (!Decimal.parse(numericAmount.toString()).eq(exactAmount)) {
    throw new RangeError('NOWPayments invoice amount cannot be represented losslessly as a JSON number');
  }
  return numericAmount;
}
