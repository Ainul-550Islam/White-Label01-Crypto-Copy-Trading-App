// # Responsibility: regression tests for exact decimal-string arithmetic with no binary floating-point conversion.

import { divideDecimalStrings, formatDecimalString, isDecimalString, multiplyDecimalStrings, parseDecimalString } from './decimal-string';

describe('decimal-string arithmetic', () => {
  it('round-trips decimal values while preserving significant precision', () => {
    expect(formatDecimalString(parseDecimalString('0.000000000001'), 12)).toBe('0.000000000001');
    expect(formatDecimalString(parseDecimalString('-125.340000000000'), 8)).toBe('-125.34');
  });

  it('rejects exponent notation, non-string input and excess precision', () => {
    expect(() => parseDecimalString('1e-8')).toThrow(TypeError);
    expect(() => parseDecimalString('0.1234567890123')).toThrow(TypeError);
    expect(() => parseDecimalString(1 as unknown as string)).toThrow(TypeError);
  });

  it('validates unknown decimal input without throwing or floating-point conversion', () => {
    expect(isDecimalString('12.5')).toBe(true);
    expect(isDecimalString('1e-8')).toBe(false);
    expect(isDecimalString('0.1234567890123')).toBe(false);
    expect(isDecimalString(null)).toBe(false);
    expect(isDecimalString('9'.repeat(81))).toBe(false);
  });

  it('multiplies and divides with deterministic half-away-from-zero rounding', () => {
    expect(formatDecimalString(multiplyDecimalStrings(parseDecimalString('1.25'), parseDecimalString('2.4')))).toBe('3');
    expect(formatDecimalString(divideDecimalStrings(parseDecimalString('1'), parseDecimalString('3')), 12)).toBe('0.333333333333');
    expect(formatDecimalString(divideDecimalStrings(parseDecimalString('-1'), parseDecimalString('6')), 12)).toBe('-0.166666666667');
  });
});
