/**
 * Entitlements Module - Admin Web Public API
 *
 * Read-only views of the API's entitlement derivation (see entitlement-api.ts).
 */

// Types
export type {
  EntitlementSource,
  TenantEntitlement,
  TenantLimit,
  TenantFeatureAccess,
  FeatureCheckResult,
  OwnPlanLimits,
  UsageItem,
  FeatureAvailability,
  OwnUsageSummary,
} from './entitlement-types';

// API
export { getTenantFeatureAccess, checkTenantFeature, getOwnPlanLimits, getOwnUsage } from './entitlement-api';
