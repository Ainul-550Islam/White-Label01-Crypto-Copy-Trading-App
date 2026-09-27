/**
 * Precision-safe display formatting without performing authoritative financial calculations.
 * Frontend displays backend-authoritative values only.
 * Never calculates balances, PnL, NAV solely in browser.
 */

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
  if (typeof stringValue === 'string' && !/^-?\d+(\.\d+)?$/.test(stringValue) && stringValue !== '—') {
    // If backend returned something non-numeric (like UNKNOWN), show as-is safely
    return <span className={className}>{stringValue}</span>;
  }

  const num = typeof value === 'number' ? value : parseFloat(stringValue);

  if (isNaN(num)) {
    return <span className={className}>{stringValue}</span>;
  }

  const isNegative = num < 0;
  const absNum = Math.abs(num);

  // Use Intl.NumberFormat for safe display, but preserve backend precision
  const formatter = new Intl.NumberFormat('en-US', {
    style: currency ? 'currency' : 'decimal',
    currency: currency,
    minimumFractionDigits: precision ?? 2,
    maximumFractionDigits: precision ?? 8,
  });

  let formatted: string;
  try {
    formatted = currency ? formatter.format(absNum) : absNum.toLocaleString('en-US', {
      minimumFractionDigits: precision ?? 2,
      maximumFractionDigits: precision ?? 8,
    });
  } catch {
    formatted = stringValue;
  }

  if (isNegative) {
    formatted = `-${formatted}`;
  } else if (showSign && num > 0) {
    formatted = `+${formatted}`;
  }

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
