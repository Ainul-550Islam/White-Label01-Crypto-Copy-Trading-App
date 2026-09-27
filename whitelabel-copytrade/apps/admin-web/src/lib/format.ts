/** Presentation helpers shared by server and client components. */

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) {
    return '—';
  }

  const date = typeof value === 'string' ? new Date(value) : value;

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date);
}

export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) {
    return '—';
  }

  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  const deltaSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const thresholds: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 30],
    ['month', 12],
    ['year', Number.POSITIVE_INFINITY],
  ];

  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  let value_ = deltaSeconds;

  for (const [unit, limit] of thresholds) {
    if (Math.abs(value_) < limit) {
      return formatter.format(Math.round(value_), unit);
    }
    value_ = value_ / limit;
  }

  return formatter.format(Math.round(value_), 'year');
}

/** Money arrives from the API as a decimal string; never parse it into a float. */
export function formatMoney(amount: string | null | undefined, currency = 'USD'): string {
  if (amount === null || amount === undefined || amount === '') {
    return '—';
  }

  const numeric = Number(amount);
  if (Number.isNaN(numeric)) {
    return amount;
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
}

export function formatBasisPoints(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) {
    return '—';
  }
  return `${(bps / 100).toFixed(2)}%`;
}

export function formatLimit(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return 'Unlimited';
  }
  return new Intl.NumberFormat('en-US').format(value);
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
