import {
  addAmounts,
  compareAmounts,
  formatAmount,
  isDecimalString,
  isPositiveAmount,
  subtractAmounts,
} from '@/features/shared/money';

/**
 * Money is a decimal string end to end. These tests are the guard against the
 * one-line regression - `Number(amount)` - that turns 0.1 + 0.2 into
 * 0.30000000000000004 and a wei amount into 1e+21.
 */
describe('decimal string recognition', () => {
  it('accepts plain decimals only', () => {
    expect(isDecimalString('1000.50')).toBe(true);
    expect(isDecimalString('0')).toBe(true);
    expect(isDecimalString('-12.5')).toBe(true);
    expect(isDecimalString('1e9')).toBe(false);
    expect(isDecimalString('0x10')).toBe(false);
    expect(isDecimalString('NaN')).toBe(false);
    expect(isDecimalString('')).toBe(false);
    expect(isDecimalString(12)).toBe(false);
    expect(isDecimalString(null)).toBe(false);
  });

  it('recognises a strictly positive amount', () => {
    expect(isPositiveAmount('0.00000001')).toBe(true);
    expect(isPositiveAmount('0')).toBe(false);
    expect(isPositiveAmount('0.000')).toBe(false);
    expect(isPositiveAmount('-1')).toBe(false);
    expect(isPositiveAmount('abc')).toBe(false);
  });
});

describe('formatting never parses to a float', () => {
  it('groups the integer part and keeps every fraction digit the API sent', () => {
    expect(formatAmount('1234567.890123')).toBe('1,234,567.890123');
    expect(formatAmount('0.10000000', { symbol: 'BTC' })).toBe('0.10000000 BTC');
    expect(formatAmount('1000')).toBe('1,000');
    expect(formatAmount('-250.5')).toBe('-250.5');
  });

  it('survives an amount large enough to lose precision as a double', () => {
    // Number('123456789012345678901.5') rounds; the string does not.
    expect(formatAmount('123456789012345678901.5')).toBe('123,456,789,012,345,678,901.5');
  });

  it('truncates only when a display precision is requested', () => {
    expect(formatAmount('1.987654321', { fractionDigits: 2 })).toBe('1.98');
    expect(formatAmount('1.5', { fractionDigits: 2 })).toBe('1.50');
  });

  it('renders an unavailable reading as unavailable, never as zero', () => {
    expect(formatAmount(null)).toBe('Unavailable');
    expect(formatAmount(undefined, { placeholder: 'Not measured' })).toBe('Not measured');
    expect(formatAmount('')).toBe('Unavailable');
  });

  it('passes an unparseable value through so the operator sees what arrived', () => {
    expect(formatAmount('unknown')).toBe('unknown');
  });
});

describe('exact arithmetic', () => {
  it('adds without float drift', () => {
    expect(addAmounts(['0.1', '0.2'])).toBe('0.3');
    expect(addAmounts(['0.1', '0.2', '0.3'])).toBe('0.6');
    expect(addAmounts(['100.00', '250.50', '0.00000001'])).toBe('350.50000001');
  });

  it('ignores blank rows but refuses an unreadable one', () => {
    expect(addAmounts(['10.00', null, undefined, ''])).toBe('10');
    expect(addAmounts(['10.00', 'not-a-number'])).toBeNull();
    expect(addAmounts([])).toBeNull();
  });

  it('subtracts exactly and reports a shortfall as a negative amount', () => {
    expect(subtractAmounts('1000.00', '250.75')).toBe('749.25');
    expect(subtractAmounts('100.00', '250.00')).toBe('-150');
    expect(subtractAmounts('1.0', 'abc')).toBeNull();
  });

  it('compares without converting to a double', () => {
    expect(compareAmounts('10.00', '9.99')).toBe(1);
    expect(compareAmounts('9.99', '10.00')).toBe(-1);
    expect(compareAmounts('10.0', '10.00')).toBe(0);
    expect(compareAmounts('9007199254740993', '9007199254740992')).toBe(1);
    expect(() => compareAmounts('abc', '1')).toThrow(TypeError);
  });

  it('keeps a 30-digit wei amount intact through a sum', () => {
    expect(addAmounts(['0.000000000000000001', '0.000000000000000002'])).toBe('0.000000000000000003');
  });
});
