import { loadTaxRateTable, resolveTaxRate } from './tax-rates.config';
import { DEFAULT_TAX_RATES } from './tax.types';

describe('tax rate table (TAX_RATES_JSON)', () => {
  it('defaults to DEFAULT_TAX_RATES and 0% for unknown countries', () => {
    const t = loadTaxRateTable({});
    expect(resolveTaxRate(t, 'de')).toBe(DEFAULT_TAX_RATES.DE);
    expect(resolveTaxRate(t, 'BD')).toBe(0);
    expect(t.overridden).toEqual([]);
  });

  it('overrides and extends, with regional keys winning over the country', () => {
    const t = loadTaxRateTable({ TAX_RATES_JSON: '{"DE":1600,"bd":1500,"US-CA":725}' });
    expect(resolveTaxRate(t, 'DE')).toBe(1600);
    expect(resolveTaxRate(t, 'BD')).toBe(1500);
    expect(resolveTaxRate(t, 'US', 'ca')).toBe(725);
    expect(resolveTaxRate(t, 'US', 'NY')).toBe(DEFAULT_TAX_RATES.US);
    expect(t.overridden).toEqual(['DE', 'BD', 'US-CA']);
  });

  it('TAX_UNKNOWN_COUNTRY=reject throws instead of silently charging 0%', () => {
    const t = loadTaxRateTable({ TAX_UNKNOWN_COUNTRY: 'reject' });
    expect(resolveTaxRate(t, 'GB')).toBe(DEFAULT_TAX_RATES.GB);
    expect(() => resolveTaxRate(t, 'BD')).toThrow(/No tax rate configured for BD/);
  });

  it('invalid configuration fails loudly (never falls back to defaults)', () => {
    expect(() => loadTaxRateTable({ TAX_RATES_JSON: '{DE:19}' })).toThrow(/not valid JSON/);
    expect(() => loadTaxRateTable({ TAX_RATES_JSON: '[1900]' })).toThrow(/JSON object/);
    expect(() => loadTaxRateTable({ TAX_RATES_JSON: '{"Germany":1900}' })).toThrow(
      /ISO country code/,
    );
    expect(() => loadTaxRateTable({ TAX_RATES_JSON: '{"DE":19.5}' })).toThrow(/basis points/);
    expect(() => loadTaxRateTable({ TAX_RATES_JSON: '{"DE":"1900"}' })).toThrow(/basis points/);
    expect(() => loadTaxRateTable({ TAX_RATES_JSON: '{"DE":10001}' })).toThrow(/basis points/);
    expect(() => loadTaxRateTable({ TAX_UNKNOWN_COUNTRY: 'maybe' })).toThrow(/zero" or "reject/);
  });
});
