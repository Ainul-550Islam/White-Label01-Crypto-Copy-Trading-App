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
