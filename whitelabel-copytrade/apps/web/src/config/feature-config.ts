/**
 * Frontend capability presentation configuration.
 * Backend remains authoritative for entitlement/security enforcement.
 * Frontend feature hiding is UX only, never security boundary.
 */

import { permissionsAllowAny } from '@/auth/permissions';

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
  /** Backend feature flag key from GET /v1/tenants/public-config `features`. */
  requiresEntitlement?: string;
  requiresRole?: string[];
  /**
   * Permission keys from GET /v1/auth/me; any one of them is enough. Mirrors
   * the permission the backend routes behind this screen demand, so a menu
   * entry is never shown to a user who would only get 403 responses.
   */
  requiresPermission?: string[];
  beta?: boolean;
}

export const featureCatalog: FeatureConfig[] = [
  { key: 'dashboard', label: 'Dashboard', route: '/dashboard' },
  { key: 'portfolio', label: 'Portfolio', route: '/portfolio' },
  { key: 'traders', label: 'Traders', route: '/traders' },
  { key: 'strategies', label: 'Strategies', route: '/strategies', requiresPermission: ['strategy:read'] },
  { key: 'copy_trading', label: 'Copy Trading', route: '/copy-trading', requiresEntitlement: 'copy_trading' },
  { key: 'exchanges', label: 'Exchanges', route: '/exchanges', requiresPermission: ['exchange_account:read'] },
  { key: 'funding', label: 'Funding', route: '/funding' },
  { key: 'billing', label: 'Billing', route: '/billing', requiresPermission: ['subscription:read', 'invoice:read'] },
  { key: 'statements', label: 'Statements', route: '/statements' },
  { key: 'security', label: 'Security', route: '/security' },
  { key: 'notifications', label: 'Notifications', route: '/notifications' },
  { key: 'account', label: 'Account', route: '/account' },
  { key: 'onboarding', label: 'Onboarding', route: '/onboarding' },
];

export function isFeatureEnabled(
  feature: FeatureKey,
  entitlements: Record<string, boolean>,
  roles: string[],
  permissions: string[] = []
): boolean {
  const config = featureCatalog.find((f) => f.key === feature);
  if (!config) return false;
  if (config.requiresEntitlement && !entitlements[config.requiresEntitlement]) {
    return false;
  }
  if (config.requiresPermission && !permissionsAllowAny(permissions, config.requiresPermission)) {
    return false;
  }
  if (config.requiresRole && config.requiresRole.length > 0) {
    return config.requiresRole.some((r) => roles.includes(r));
  }
  return true;
}
