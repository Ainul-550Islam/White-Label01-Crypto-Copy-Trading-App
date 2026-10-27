// # Responsibility: verifies the Batch 04 commercial behavior and its safety contracts.
// # Proves decimal-string formatting, half-even rounding, large values, locale grouping, and Bengali numeral behavior.
import { formatDecimalString, formatMoney } from '../lib/i18n/locale-number-format';

describe('formatDecimalString', () => {
  const cases: Array<[string, number, number, string]> = [
    ['0', 0, 2, '0'], ['0.1', 0, 2, '0.1'], ['0.2', 0, 2, '0.2'],
    ['0.3', 0, 2, '0.3'], ['1.005', 2, 2, '1.00'], ['1.015', 2, 2, '1.02'],
    ['2.5', 0, 0, '2'], ['3.5', 0, 0, '4'], ['-2.5', 0, 0, '-2'], ['-3.5', 0, 0, '-4'],
    ['999.999', 2, 2, '1,000.00'], ['1000000', 0, 0, '1,000,000'],
    ['123456789012345678.25', 2, 2, '123,456,789,012,345,678.25'],
    ['-0.00', 2, 2, '0.00'], ['-0.001', 2, 2, '0.00'],
    ['0.000000000000000005', 17, 18, '0.000000000000000005'],
  ];

  it.each(cases)('formats %s at scale %i..%i', (value, minFraction, maxFraction, expected) => {
    expect(formatDecimalString(value, { locale: 'en', minFraction, maxFraction })).toBe(expected);
  });

  it('groups Bangladeshi amounts in lakh/crore groups and uses Bengali digits', () => {
    expect(formatDecimalString('12345678.90', { locale: 'bn-BD', minFraction: 2, maxFraction: 2 })).toBe('১,২৩,৪৫,৬৭৮٫৯০');
    expect(formatDecimalString('100000000', { locale: 'bn', maxFraction: 0 })).toBe('১০,০০,০০,০০০');
  });

  it.each([
    ['ar', '٩٬٠٠٧٬١٩٩٬٢٥٤٬٧٤٠٬٩٩٣٫٠١'],
    ['es', '9.007.199.254.740.993,01'],
    ['tr', '9.007.199.254.740.993,01'],
  ] as const)('formats exact large decimals with %s separators and digits', (locale, expected) => {
    expect(formatDecimalString('9007199254740993.01', { locale, minFraction: 2, maxFraction: 2 })).toBe(expected);
  });

  it('rejects malformed decimals and invalid scales', () => {
    expect(() => formatDecimalString('1e3', { locale: 'en' })).toThrow();
    expect(() => formatDecimalString('01', { locale: 'en' })).toThrow();
    expect(() => formatDecimalString('1', { locale: 'en', minFraction: 3, maxFraction: 2 })).toThrow();
  });

  it('formats currency without converting the amount to a JavaScript number', () => {
    expect(formatMoney('9007199254740993.01', 'USD', 'en')).toBe('$9,007,199,254,740,993.01');
    expect(formatMoney('-10.5', 'BDT', 'bn-BD')).toBe('৳-১০٫৫০');
    expect(() => formatMoney('1', 'XYZ', 'en')).toThrow('Unsupported display currency');
  });
});
