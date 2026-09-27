interface PercentageProps {
  value: string | number | null | undefined;
  className?: string;
  showSign?: boolean;
  precision?: number;
}

export function Percentage({ value, className, showSign = true, precision = 2 }: PercentageProps): JSX.Element {
  if (value === null || value === undefined || value === '') {
    return <span className={`text-muted ${className ?? ''}`}>—</span>;
  }

  const stringValue = typeof value === 'number' ? value.toString() : value;

  if (typeof stringValue === 'string' && !/^-?\d+(\.\d+)?$/.test(stringValue)) {
    return <span className={className}>{stringValue}</span>;
  }

  const num = typeof value === 'number' ? value : parseFloat(stringValue);

  if (isNaN(num)) {
    return <span className={className}>{stringValue}</span>;
  }

  const isPositive = num > 0;
  const isNegative = num < 0;

  const formatted = `${showSign && isPositive ? '+' : ''}${num.toFixed(precision)}%`;

  return (
    <span className={`${isPositive ? 'text-green-600' : isNegative ? 'text-red-600' : ''} ${className ?? ''}`}>
      {formatted}
    </span>
  );
}
