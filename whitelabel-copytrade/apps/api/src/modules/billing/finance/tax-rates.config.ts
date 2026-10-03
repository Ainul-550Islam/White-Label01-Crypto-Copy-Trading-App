import { DEFAULT_TAX_RATES } from './tax.types';

/**
 * Tax-rate table for the internal tax rules (used when no external tax
 * provider is configured).
 *
 * TAX_RATES_JSON overrides/extends the built-in DEFAULT_TAX_RATES without a
 * code change. Keys are ISO-3166 alpha-2 country codes, optionally with a
 * region (`US-CA`, `CA-QC`); values are basis points (1900 = 19.00%), integer
 * 0..10000. A regional key wins over its country key.
 *
 *   TAX_RATES_JSON={"DE":1900,"BD":1500,"US-CA":725,"CA-QC":1498}
 *
 * TAX_UNKNOWN_COUNTRY=zero (default, the historical behaviour) charges 0% for
 * a country with no rate; TAX_UNKNOWN_COUNTRY=reject makes the invoice fail
 * instead, so a missing rate can never silently under-charge tax.
 *
 * Invalid configuration throws when the table is built (at boot), rather than
 * falling back to defaults: a typo in a tax table must not go unnoticed.
 */

export type UnknownCountryPolicy = 'zero' | 'reject';

export interface TaxRateTable {
  rates: Readonly<Record<string, number>>;
  unknownCountry: UnknownCountryPolicy;
  overridden: string[];
}

const KEY = /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/;

export function loadTaxRateTable(
  env: Record<string, string | undefined> = process.env,
): TaxRateTable {
  const rates: Record<string, number> = { ...DEFAULT_TAX_RATES };
  const overridden: string[] = [];

  const raw = (env.TAX_RATES_JSON || '').trim();
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`TAX_RATES_JSON is not valid JSON: ${(e as Error).message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('TAX_RATES_JSON must be a JSON object of {"CC" or "CC-REGION": basisPoints}');
    }
    for (const [rawKey, value] of Object.entries(parsed as Record<string, unknown>)) {
      const key = rawKey.trim().toUpperCase();
      if (!KEY.test(key)) {
        throw new Error(
          `TAX_RATES_JSON key "${rawKey}" is not an ISO country code (optionally CC-REGION)`,
        );
      }
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 10000) {
        throw new Error(
          `TAX_RATES_JSON["${rawKey}"] must be an integer number of basis points between 0 and 10000`,
        );
      }
      rates[key] = value;
      overridden.push(key);
    }
  }

  const policyRaw = (env.TAX_UNKNOWN_COUNTRY || 'zero').trim().toLowerCase();
  if (policyRaw !== 'zero' && policyRaw !== 'reject') {
    throw new Error('TAX_UNKNOWN_COUNTRY must be "zero" or "reject"');
  }

  return { rates: Object.freeze(rates), unknownCountry: policyRaw, overridden };
}

/** Rate in basis points for a country (and optional region). */
export function resolveTaxRate(table: TaxRateTable, country: string, region?: string): number {
  const cc = (country || '').trim().toUpperCase();
  const rg = (region || '').trim().toUpperCase();
  if (rg) {
    const regional = table.rates[`${cc}-${rg}`];
    if (regional !== undefined) return regional;
  }
  const national = table.rates[cc];
  if (national !== undefined) return national;
  if (table.unknownCountry === 'reject') {
    throw new Error(
      `No tax rate configured for ${cc}${rg ? `-${rg}` : ''} (TAX_UNKNOWN_COUNTRY=reject); add it to TAX_RATES_JSON`,
    );
  }
  return 0;
}
