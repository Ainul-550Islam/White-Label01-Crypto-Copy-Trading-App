// # Responsibility: establishes the unit of institutional monetary exposure limits without guessing or cross-scope inheritance.
import type { EffectiveRiskPolicy, RiskPolicyThresholds } from './risk-management.types';

export const MONETARY_EXPOSURE_KEYS = [
  'maxGrossExposure', 'maxNetExposure', 'maxSymbolExposure', 'maxVenueExposure', 'maxAccountExposure',
  'maxStrategyExposure', 'maxTraderExposure', 'maxFollowerExposure', 'maxPositionNotional', 'maxOrderNotional',
] as const satisfies ReadonlyArray<keyof RiskPolicyThresholds>;

/**
 * Every scope which supplied a monetary amount must explicitly name the same
 * currency. A later scope cannot retrospectively label an older naked number.
 * The caller must separately prove that the instrument/exposure uses this quote.
 */
export function validatedExposureCurrency(policy: Pick<EffectiveRiskPolicy, 'thresholds' | 'sourcePolicies'>): string | null {
  const currency = policy?.thresholds?.notionalCurrency;
  if (typeof currency !== 'string' || !/^[A-Z0-9]{2,16}$/.test(currency) || !Array.isArray(policy.sourcePolicies)) return null;
  for (const key of MONETARY_EXPOSURE_KEYS) {
    if (policy.thresholds[key] == null) continue;
    const contributors = policy.sourcePolicies.filter((source) => source?.thresholds?.[key] != null);
    if (!contributors.length || contributors.some((source) => source.thresholds.notionalCurrency !== currency)) return null;
  }
  return currency;
}
