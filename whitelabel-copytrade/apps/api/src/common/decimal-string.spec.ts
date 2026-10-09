// # Responsibility: regression tests for exact decimal-string arithmetic with no binary floating-point conversion.
//
// Two jobs, and the first is the original one: the Layer 1 functions in this module are imported
// across the API, so their observable behaviour is pinned here rather than left to whatever the
// next refactor assumes. The block below this header is that contract, unchanged.
//
// The second job is coverage for the arbitrary-scale `Decimal` layer added on top of Layer 1:
// exact arithmetic, the five rounding modes, venue step/tick snapping, and the regression where
// the previous hand-rolled BigInt helpers silently fell back to `parseFloat` (triggered by
// `String(1e-7 / 100) === '1e-9'`, which their parser could not tokenise).

import {
  DECIMAL_FACTOR,
  DECIMAL_SCALE,
  Decimal,
  DecimalError,
  bpsOf,
  clampDecimal,
  dec,
  decimalFromScaled12,
  divideDecimalStrings,
  formatDecimalString,
  isDecimalString,
  maxDecimal,
  minDecimal,
  multiplyDecimalStrings,
  parseDecimalString,
} from './decimal-string';

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

describe('Decimal (Layer 2): parsing', () => {
  it('parses integers, fixed point, signs and exponent notation exactly', () => {
    expect(Decimal.parse('0').toString()).toBe('0');
    expect(Decimal.parse('42').toString()).toBe('42');
    expect(Decimal.parse('0.001').toString()).toBe('0.001');
    expect(Decimal.parse('-1.50').toString()).toBe('-1.5');
    expect(Decimal.parse('1e-7').toString()).toBe('0.0000001');
    expect(Decimal.parse('1e-9').toString()).toBe('0.000000001');
    expect(Decimal.parse('2.5E+3').toString()).toBe('2500');
    expect(Decimal.parse('.5').toString()).toBe('0.5');
    expect(Decimal.parse('5.').toString()).toBe('5');
    expect(Decimal.parse('+3.25').toString()).toBe('3.25');
  });

  it('never emits exponent notation, even for tiny values', () => {
    // The regression that broke the copy-sizing path: 1e-7 / 100.
    const tiny = Decimal.parse('1e-7').div(100, 18);
    expect(tiny.toString()).toBe('0.000000001');
    expect(tiny.toString()).not.toMatch(/e/i);
    expect(Decimal.parse('0.000000000000000001').toString()).toBe('0.000000000000000001');
  });

  it('parses beyond Layer 1 precision, which is the reason Layer 2 exists', () => {
    // Layer 1's pattern admits at most 12 fractional digits.
    expect(isDecimalString('0.000000000000000001')).toBe(false);
    // Layer 2 holds it exactly.
    expect(Decimal.parse('0.000000000000000001').toString()).toBe('0.000000000000000001');
  });

  it('rejects non-finite and malformed input', () => {
    expect(() => Decimal.parse('')).toThrow(DecimalError);
    expect(() => Decimal.parse('abc')).toThrow(DecimalError);
    expect(() => Decimal.parse('1.2.3')).toThrow(DecimalError);
    expect(() => Decimal.parse('.' as never)).toThrow(DecimalError);
    expect(() => Decimal.parse(NaN)).toThrow(DecimalError);
    expect(() => Decimal.parse(Infinity)).toThrow(DecimalError);
  });

  it('exact string maths beats the float equivalent', () => {
    // Every finite double round-trips through its shortest decimal form, so a
    // float input parses - but to the float's value, not the intended one. That
    // is why financial call sites pass strings.
    expect(Decimal.parse(String(0.1 + 0.2)).toString()).toBe('0.30000000000000004');
    expect(Decimal.parse(String(0.1 + 0.2)).eq('0.3')).toBe(false);
    expect(Decimal.parse('0.1').add('0.2').eq('0.3')).toBe(true);
    expect(Decimal.parse('0.1').add('0.2').toString()).toBe('0.3');
  });

  it('tryParse and isDecimal are non-throwing', () => {
    expect(Decimal.tryParse('nope')).toBeNull();
    expect(Decimal.tryParse(null)).toBeNull();
    expect(Decimal.tryParse('1.5')!.toString()).toBe('1.5');
    expect(Decimal.isDecimal('1e-9')).toBe(true);
    expect(Decimal.isDecimal('x')).toBe(false);
  });
});

describe('Decimal (Layer 2): arithmetic is exact', () => {
  it('adds and subtracts without float drift', () => {
    expect(dec('0.1').add('0.2').toString()).toBe('0.3');
    expect(dec('1.005').sub('1').toString()).toBe('0.005');
    expect(dec('0.3').sub('0.1').toString()).toBe('0.2');
    expect(dec('1e-9').add('1e-9').toString()).toBe('0.000000002');
  });

  it('multiplies exactly at full precision', () => {
    expect(dec('0.0000123456789').mul('1').toString()).toBe('0.0000123456789');
    expect(dec('60000').mul('0.001').toString()).toBe('60');
    expect(dec('1e-7').mul('1e-9').toString()).toBe('0.0000000000000001');
  });

  it('divides with an explicit scale and rounding mode', () => {
    expect(dec('1').div('3', 4).toString()).toBe('0.3333');
    expect(dec('1').div('3', 2, 'FLOOR').toString()).toBe('0.33');
    expect(dec('2').div('3', 2, 'CEIL').toString()).toBe('0.67');
    expect(dec('0.15').div('0.1', 2).toString()).toBe('1.5');
    expect(dec('100').div('3', 0, 'HALF_UP').toString()).toBe('33');
    expect(() => dec('1').div('0')).toThrow(DecimalError);
  });

  it('compares exactly, including across scales and signs', () => {
    expect(dec('0.1').add('0.2').cmp('0.3')).toBe(0);
    expect(dec('1.0').cmp('1')).toBe(0);
    expect(dec('-2').cmp('-1')).toBe(-1);
    expect(dec('1e-9').gt('0')).toBe(true);
    expect(dec('5').lte('5')).toBe(true);
  });

  it('applies HALF_EVEN (banker) rounding', () => {
    expect(dec('2.5').toFixed(0, 'HALF_EVEN')).toBe('2');
    expect(dec('3.5').toFixed(0, 'HALF_EVEN')).toBe('4');
    expect(dec('2.5').toFixed(0, 'HALF_UP')).toBe('3');
    expect(dec('-2.5').toFixed(0, 'HALF_UP')).toBe('-3');
    expect(dec('-2.5').toFixed(0, 'FLOOR')).toBe('-3');
    expect(dec('-2.5').toFixed(0, 'DOWN')).toBe('-2');
  });
});

describe('Decimal (Layer 2): venue precision normalisation', () => {
  it('floors a size down to the step and refuses to return zero', () => {
    expect(Decimal.floorToStep('0.00123', '0.001')!.toString()).toBe('0.001');
    // A size below one step must not silently become an order.
    expect(Decimal.floorToStep('0.0005', '0.001')).toBeNull();
    expect(Decimal.floorToStep('0', '0.001')).toBeNull();
    expect(Decimal.floorToStep('7.9', '1')!.toString()).toBe('7');
    // An 18-dp step is representable in Layer 2 and not in Layer 1.
    expect(isDecimalString('0.000000000000000001')).toBe(false);
    expect(Decimal.floorToStep('0.0000123456789', '0.000000000000000001')!.toString()).toBe('0.0000123456789');
  });

  it('snaps prices to a tick in the requested direction', () => {
    expect(Decimal.roundToTick('60000.007', '0.01', 'FLOOR').toString()).toBe('60000');
    expect(Decimal.roundToTick('60000.001', '0.01', 'CEIL').toString()).toBe('60000.01');
    expect(Decimal.roundToTick('60000.005', '0.01').toString()).toBe('60000.01');
    expect(Decimal.ceilToTick('60000.00', '0.01').toString()).toBe('60000');
    expect(Decimal.floorToTick('60000.009', '0.01').toString()).toBe('60000');
  });

  it('rejects an invalid step instead of returning the raw size', () => {
    expect(Decimal.floorToStep('1', '0')).toBeNull();
    expect(Decimal.floorToStep('1', '-0.1')).toBeNull();
  });
});

describe('Decimal (Layer 2): helpers', () => {
  it('computes basis points exactly', () => {
    expect(bpsOf('60000', 50).toString()).toBe('300');
    expect(bpsOf('0.00001234', 100).toString()).toBe('0.0000001234');
    expect(() => bpsOf('1', -1)).toThrow(DecimalError);
  });

  it('clamps, mins and maxes', () => {
    expect(clampDecimal('5', '1', '10').toString()).toBe('5');
    expect(clampDecimal('0', '1', '10').toString()).toBe('1');
    expect(clampDecimal('99', '1', '10').toString()).toBe('10');
    expect(() => clampDecimal('5', '10', '1')).toThrow(DecimalError);
    expect(maxDecimal('1', '2', '3').toString()).toBe('3');
    expect(minDecimal('1', '2', '3').toString()).toBe('1');
  });

  it('round-trips to scaled bigint only when exact', () => {
    expect(dec('1.23').toScaledBigInt(2)).toBe(123n);
    expect(() => dec('1.234').toScaledBigInt(2)).toThrow(DecimalError);
    expect(dec('100').toScaledBigInt(0)).toBe(100n);
  });

  it('normalises away trailing zeros but keeps zero canonical', () => {
    expect(dec('1.5000').normalize().toString()).toBe('1.5');
    expect(dec('0.000').toString()).toBe('0');
    expect(dec('-0.0').toString()).toBe('0');
  });
});

describe('Layer 1 <-> Layer 2 interop', () => {
  it('bridges to 12-place scaled units only when exact', () => {
    expect(dec('1.5').toScaled12Exact()).toBe(parseDecimalString('1.5'));
    expect(decimalFromScaled12(parseDecimalString('1.5')).toString()).toBe('1.5');
    // 18 dp does not fit, and must throw rather than silently truncate.
    expect(dec('0.000000000000000001').fitsLayer1()).toBe(false);
    expect(() => dec('0.000000000000000001').toScaled12Exact()).toThrow(DecimalError);
    expect(dec('1.5').fitsLayer1()).toBe(true);
  });

  it('round-trips a Layer 1 value through Layer 2 losslessly', () => {
    for (const text of ['0', '1', '-1', '0.1', '60000.123456789', '-0.000000000001', '99999999.999999999999']) {
      const scaled = parseDecimalString(text);
      const roundTripped = decimalFromScaled12(scaled);
      expect(roundTripped.toString()).toBe(Decimal.parse(text).toString());
      expect(roundTripped.toScaled12Exact()).toBe(scaled);
    }
  });
});

describe('Layer 1 (frozen): existing exports behave as the API already depends on', () => {
  it('DECIMAL_SCALE and DECIMAL_FACTOR stay at 12 places', () => {
    expect(DECIMAL_SCALE).toBe(12);
    expect(DECIMAL_FACTOR).toBe(1_000_000_000_000n);
  });

  it('isDecimalString accepts plain 12-dp input and rejects anything else', () => {
    expect(isDecimalString('0')).toBe(true);
    expect(isDecimalString('123')).toBe(true);
    expect(isDecimalString('-0.5')).toBe(true);
    expect(isDecimalString('0.123456789012')).toBe(true);
    // 13 places, exponent form, leading zeros and junk are all rejected.
    expect(isDecimalString('0.1234567890123')).toBe(false);
    expect(isDecimalString('1e-7')).toBe(false);
    expect(isDecimalString('007')).toBe(false);
    expect(isDecimalString('')).toBe(false);
    expect(isDecimalString(null)).toBe(false);
    expect(isDecimalString(undefined)).toBe(false);
    expect(isDecimalString(5)).toBe(false);
  });

  it('parseDecimalString scales exactly and throws on bad input', () => {
    expect(parseDecimalString('1')).toBe(DECIMAL_FACTOR);
    expect(parseDecimalString('1.5')).toBe(DECIMAL_FACTOR + DECIMAL_FACTOR / 2n);
    expect(parseDecimalString('-1')).toBe(-DECIMAL_FACTOR);
    expect(parseDecimalString('0')).toBe(0n);
    expect(() => parseDecimalString('1e-7')).toThrow(TypeError);
    expect(() => parseDecimalString('0.1234567890123')).toThrow(TypeError);
  });

  it('formatDecimalString trims trailing zeros and honours outputPlaces', () => {
    expect(formatDecimalString(DECIMAL_FACTOR)).toBe('1');
    expect(formatDecimalString(DECIMAL_FACTOR + DECIMAL_FACTOR / 2n)).toBe('1.5');
    expect(formatDecimalString(0n)).toBe('0');
    expect(formatDecimalString(parseDecimalString('-0.00000001'))).toBe('-0.00000001');
    expect(formatDecimalString(parseDecimalString('1.123456789'), 2)).toBe('1.12');
    expect(formatDecimalString(parseDecimalString('1.5'), 0)).toBe('1');
    expect(() => formatDecimalString(0n, 13)).toThrow(RangeError);
    expect(() => formatDecimalString(0n, -1)).toThrow(RangeError);
  });

  it('divideDecimalStrings and multiplyDecimalStrings round half away from zero', () => {
    expect(divideDecimalStrings(parseDecimalString('1'), parseDecimalString('3')))
      .toBe(parseDecimalString('0.333333333333'));
    expect(() => divideDecimalStrings(1n, 0n)).toThrow(RangeError);
    expect(multiplyDecimalStrings(parseDecimalString('2'), parseDecimalString('3')))
      .toBe(parseDecimalString('6'));
    expect(multiplyDecimalStrings(parseDecimalString('0.1'), parseDecimalString('3')))
      .toBe(parseDecimalString('0.3'));
    expect(multiplyDecimalStrings(parseDecimalString('-2'), parseDecimalString('0.5')))
      .toBe(parseDecimalString('-1'));
  });
});
