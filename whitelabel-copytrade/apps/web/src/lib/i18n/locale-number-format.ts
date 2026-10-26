// # Responsibility: implements a Batch 04 commercial interface component or supporting utility.
// # Formats decimal money strings without binary floating-point conversion, including half-even rounding and Bengali grouping.
export type SupportedNumberLocale = 'en' | 'bn' | 'bn-BD';

export interface DecimalFormatOptions {
  locale: SupportedNumberLocale;
  minFraction?: number;
  maxFraction?: number;
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const CURRENCY_FRACTIONS: Readonly<Record<string, number>> = Object.freeze({
  BDT: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
  BTC: 8,
  ETH: 8,
});
const CURRENCY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  BDT: '৳',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  BTC: 'BTC ',
  ETH: 'ETH ',
});

function assertScale(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 18) {
    throw new RangeError(`${label} must be an integer from 0 through 18`);
  }
}

function parseDecimal(value: string): { negative: boolean; integer: string; fraction: string } {
  if (typeof value !== 'string' || !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)) {
    throw new TypeError('A canonical decimal string is required');
  }
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integer = '0', fraction = ''] = unsigned.split('.');
  return { negative, integer, fraction };
}

function roundHalfEven(integer: string, fraction: string, maxFraction: number): { integer: string; fraction: string } {
  const padded = fraction.padEnd(maxFraction + 1, '0');
  const kept = padded.slice(0, maxFraction).padEnd(maxFraction, '0');
  const guard = Number(padded[maxFraction] ?? '0');
  const sticky = /[1-9]/.test(padded.slice(maxFraction + 1));
  const lastKept = maxFraction === 0 ? Number(integer.at(-1) ?? '0') : Number(kept.at(-1) ?? '0');
  const increment = guard > 5 || (guard === 5 && (sticky || lastKept % 2 === 1));
  if (!increment) return { integer, fraction: kept };
  const combined = BigInt(integer + kept) + 1n;
  const digits = combined.toString().padStart(maxFraction + 1, '0');
  if (maxFraction === 0) return { integer: digits, fraction: '' };
  return { integer: digits.slice(0, -maxFraction), fraction: digits.slice(-maxFraction) };
}

function groupInteger(integer: string, locale: SupportedNumberLocale): string {
  if (locale === 'bn' || locale === 'bn-BD') {
    if (integer.length <= 3) return integer;
    const lastThree = integer.slice(-3);
    const preceding = integer.slice(0, -3);
    const groups: string[] = [];
    for (let end = preceding.length; end > 0; end -= 2) {
      groups.unshift(preceding.slice(Math.max(0, end - 2), end));
    }
    return `${groups.join(',')},${lastThree}`;
  }
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function localizeDigits(value: string, locale: SupportedNumberLocale): string {
  if (locale === 'en') return value;
  return value.replace(/[0-9]/g, (digit) => BN_DIGITS[Number(digit)] ?? digit);
}

export function formatDecimalString(value: string, options: DecimalFormatOptions): string {
  const maxFraction = options.maxFraction ?? 2;
  const minFraction = options.minFraction ?? 0;
  assertScale(maxFraction, 'maxFraction');
  assertScale(minFraction, 'minFraction');
  if (minFraction > maxFraction) throw new RangeError('minFraction cannot exceed maxFraction');
  const parsed = parseDecimal(value);
  const rounded = roundHalfEven(parsed.integer, parsed.fraction, maxFraction);
  let fraction = rounded.fraction;
  while (fraction.length > minFraction && fraction.endsWith('0')) fraction = fraction.slice(0, -1);
  const sign = parsed.negative && (BigInt(rounded.integer) !== 0n || /[1-9]/.test(fraction)) ? '-' : '';
  const grouped = groupInteger(rounded.integer, options.locale);
  const decimalMark = options.locale === 'en' ? '.' : '٫';
  const output = `${sign}${grouped}${fraction.length > 0 ? `${decimalMark}${fraction}` : ''}`;
  return localizeDigits(output, options.locale);
}

export function formatMoney(value: string, currency: string, locale: SupportedNumberLocale): string {
  const normalized = currency.toUpperCase();
  const fractionDigits = CURRENCY_FRACTIONS[normalized];
  if (fractionDigits === undefined) throw new RangeError(`Unsupported display currency: ${currency}`);
  const symbol = CURRENCY_LABELS[normalized];
  if (symbol === undefined) throw new RangeError(`Unsupported display currency: ${currency}`);
  const formatted = formatDecimalString(value, { locale, minFraction: fractionDigits, maxFraction: fractionDigits });
  return locale === 'en' ? `${symbol}${formatted}` : `${symbol}${formatted}`;
}
