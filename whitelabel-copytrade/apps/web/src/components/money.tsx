/**
 * Precision-safe display formatting without performing authoritative financial calculations.
 * Frontend displays backend-authoritative values only.
 * Never calculates balances, PnL, NAV solely in browser.
 */

import type { JSX } from 'react';
import { formatDecimalString } from '@/lib/i18n/locale-number-format';

interface MoneyProps {
  value: string | number | null | undefined;
  currency?: string;
  className?: string;
  precision?: number;
  showSign?: boolean;
}

export function Money({ value, currency = 'USD', className, precision, showSign }: MoneyProps): JSX.Element {
  if (value === null || value === undefined || value === '') {
    return <span className={`text-muted ${className ?? ''}`}>—</span>;
  }

  const stringValue = typeof value === 'number' ? value.toString() : value;

  // Validate that value is a safe decimal string, not a float calculation
  if (!/^-?\d+(\.\d+)?$/.test(stringValue)) {
    // If backend returned something non-numeric (like UNKNOWN), show as-is safely
    return <span className={className}>{stringValue}</span>;
  }

  // Group decimal strings directly: converting them to Number can silently
  // change large amounts and low-order fractional digits. Numeric props are
  // displayed as supplied, but precision lost by an upstream number cannot be recovered.
  const unsigned = stringValue.startsWith('-') ? stringValue.slice(1) : stringValue;
  const [integerPart = '0', fraction = ''] = unsigned.split('.');
  const integer = integerPart.replace(/^0+(?=\d)/, '');
  const canonical = `${integer}${fraction ? `.${fraction}` : ''}`;
  const nonZero = /[1-9]/.test(canonical);
  const isNegative = stringValue.startsWith('-') && nonZero;
  let digits: string;
  if (precision !== undefined && Number.isInteger(precision) && precision >= 0 && precision <= 18) {
    digits = formatDecimalString(canonical, { locale: 'en', minFraction: precision, maxFraction: precision });
  } else {
    const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const decimals = fraction.padEnd(2, '0');
    digits = `${grouped}${decimals ? `.${decimals}` : ''}`;
  }

  // Intl accepts only three-letter currency codes. Token symbols such as USDT
  // are displayed verbatim instead of throwing or inventing a fiat symbol.
  const code = currency.toUpperCase();
  let prefix = code ? `${code} ` : '';
  if (/^[A-Z]{3}$/.test(code)) {
    try {
      const symbol = new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).formatToParts(0).find((part) => part.type === 'currency')?.value;
      prefix = symbol ? (symbol === code ? `${symbol} ` : symbol) : prefix;
    } catch { /* Keep the explicit currency code. */ }
  }
  const formatted = `${isNegative ? '-' : showSign && nonZero ? '+' : ''}${prefix}${digits}`;

  return (
    <span className={`${isNegative ? 'text-red-600' : ''} ${className ?? ''}`} aria-label={`${stringValue} ${currency}`}>
      {formatted}
    </span>
  );
}

export function MoneyWithState({
  value,
  currency,
  valuationState,
}: {
  value: string;
  currency?: string;
  valuationState?: string;
}): JSX.Element {
  if (valuationState && ['STALE', 'MISSING_PRICE', 'MISSING_FX', 'INCOMPLETE', 'UNAVAILABLE'].includes(valuationState)) {
    return (
      <span className="inline-flex items-center gap-1">
        <Money value={value} currency={currency} className="opacity-60" />
        <span className="text-xs text-yellow-600" title={`Valuation state: ${valuationState}`}>
          ⚠️ {valuationState}
        </span>
      </span>
    );
  }

  return <Money value={value} currency={currency} />;
}
