// # Enables partner portal navigation when tenant feature flag is active
import { APP_ROUTES, type AppRouteDefinition } from "./routes";

export interface TenantFeatureFlags {
  copyTradingEnabled: boolean;
  partnerPortalEnabled: boolean;
  fundingEnabled: boolean;
  supportHelpdeskEnabled: boolean;
}

export const DEFAULT_TENANT_FEATURES: TenantFeatureFlags = {
  copyTradingEnabled: true,
  partnerPortalEnabled: true,
  fundingEnabled: true,
  supportHelpdeskEnabled: true,
};

export function resolveActiveCustomerRoutes(
  flags: Partial<TenantFeatureFlags> = DEFAULT_TENANT_FEATURES,
): AppRouteDefinition[] {
  const effective: TenantFeatureFlags = { ...DEFAULT_TENANT_FEATURES, ...flags };
  return Object.values(APP_ROUTES).filter((route) => {
    if (route.section === "partner" && !effective.partnerPortalEnabled) {
      return false;
    }
    if (route.path === "/funding" && !effective.fundingEnabled) {
      return false;
    }
    if (route.section === "support" && !effective.supportHelpdeskEnabled) {
      return false;
    }
    return true;
  });
}


export interface CustomerFeatureCatalogEntry {
  key: string;
  requiresEntitlement?: string;
  requiresPermission?: readonly string[];
  requiresRole?: readonly string[];
}

export const featureCatalog: readonly CustomerFeatureCatalogEntry[] = [
  { key: 'dashboard' },
  { key: 'portfolio', requiresPermission: ['portfolio:read', 'risk:read'] },
  { key: 'traders', requiresEntitlement: 'copy_trading' },
  { key: 'strategies', requiresEntitlement: 'copy_trading' },
  { key: 'copy_trading', requiresEntitlement: 'copy_trading' },
  { key: 'exchanges', requiresPermission: ['exchange:read'] },
  { key: 'funding', requiresEntitlement: 'funding' },
  { key: 'billing' },
  { key: 'statements', requiresPermission: ['portfolio:read'] },
  { key: 'security' },
  { key: 'notifications' },
  { key: 'account' },
  { key: 'risk_exposure', requiresPermission: ['risk:read', 'portfolio:read'] },
];
