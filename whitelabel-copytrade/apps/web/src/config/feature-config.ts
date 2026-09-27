/**
 * Frontend capability presentation configuration.
 * Backend remains authoritative for entitlement/security enforcement.
 * Frontend feature hiding is UX only, never security boundary.
 */

export type FeatureKey =
  | 'dashboard'
  | 'portfolio'
  | 'traders'
  | 'strategies'
  | 'copy_trading'
  | 'exchanges'
  | 'funding'
  | 'billing'
  | 'statements'
  | 'security'
  | 'notifications'
  | 'account'
  | 'api_keys'
  | 'onboarding';

export interface FeatureConfig {
  key: FeatureKey;
  label: string;
  route: string;
  requiresEntitlement?: string;
  requiresRole?: string[];
  beta?: boolean;
}

export const featureCatalog: FeatureConfig[] = [
  { key: 'dashboard', label: 'Dashboard', route: '/dashboard' },
  { key: 'portfolio', label: 'Portfolio', route: '/portfolio' },
  { key: 'traders', label: 'Traders', route: '/traders' },
  { key: 'strategies', label: 'Strategies', route: '/strategies' },
  { key: 'copy_trading', label: 'Copy Trading', route: '/copy-trading', requiresEntitlement: 'copy_trading' },
  { key: 'exchanges', label: 'Exchanges', route: '/exchanges', requiresEntitlement: 'exchange_accounts' },
  { key: 'funding', label: 'Funding', route: '/funding', requiresEntitlement: 'funding' },
  { key: 'billing', label: 'Billing', route: '/billing', requiresEntitlement: 'billing' },
  { key: 'statements', label: 'Statements', route: '/statements', requiresEntitlement: 'statements' },
  { key: 'security', label: 'Security', route: '/security' },
  { key: 'notifications', label: 'Notifications', route: '/notifications' },
  { key: 'account', label: 'Account', route: '/account' },
  { key: 'onboarding', label: 'Onboarding', route: '/onboarding' },
];

export function isFeatureEnabled(
  feature: FeatureKey,
  entitlements: Record<string, boolean>,
  roles: string[]
): boolean {
  const config = featureCatalog.find((f) => f.key === feature);
  if (!config) return false;
  if (config.requiresEntitlement && !entitlements[config.requiresEntitlement]) {
    return false;
  }
  if (config.requiresRole && config.requiresRole.length > 0) {
    return config.requiresRole.some((r) => roles.includes(r));
  }
  return true;
}
