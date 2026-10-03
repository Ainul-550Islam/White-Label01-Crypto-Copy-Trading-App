/**
 * Entitlement Types for Admin Web
 *
 * In this platform an entitlement is not a stored record: it is DERIVED from
 * the tenant's subscription plan (its `features` array and `limits`), plus
 * feature flags, by the API's TenantFeatureAccessService. These types mirror
 * what the API returns for that derivation. The earlier version of this module
 * described entitlement CRUD (create/suspend/reset usage/...) that the API has
 * never had; it was removed in round 7.
 */

import type { PlanLimits } from '@wlct/shared-types';

/** Where an effective feature decision came from (SaasEntitlementSummary.source). */
export type EntitlementSource = 'plan_features' | 'plan_limits_boolean' | 'feature_flag' | 'none';

/** One effective feature of a tenant (SaasEntitlementSummary). */
export interface TenantEntitlement {
  featureKey: string;
  enabled: boolean;
  source: EntitlementSource;
  planCode: string | null;
  subscriptionStatus: string | null;
  reason: string | null;
}

/** One effective limit of a tenant with its current usage (SaasLimitSummary). */
export interface TenantLimit {
  limitKey: string;
  configuredLimit: number | null;
  currentUsage: number;
  remaining: number | null;
  unlimited: boolean;
  percentageUsed: number | null;
  source: 'plan_limits' | 'tenant_override' | 'none';
}

/** GET /v1/billing/saas-admin/tenants/:id/feature-access */
export interface TenantFeatureAccess {
  tenantId: string;
  features: TenantEntitlement[];
  limits: TenantLimit[];
  fetchedAt: string;
}

/** GET /v1/billing/saas-admin/tenants/:id/feature-access/:featureKey */
export interface FeatureCheckResult {
  tenantId: string;
  featureKey: string;
  allowed: boolean;
  reason: string | null;
  planCode: string | null;
  subscriptionStatus: string | null;
  source: EntitlementSource;
}

/** GET /v1/billing/subscription/limits - the caller's own plan limits (null without a subscription). */
export type OwnPlanLimits = PlanLimits | null;

/** One usage line of GET /v1/billing/portal/usage (PortalUsageItem). */
export interface UsageItem {
  key: string;
  label: string;
  current: number;
  limit: number | null;
  remaining: number | null;
  unlimited: boolean;
  percentageUsed: number | null;
  scope: string;
}

/** One feature line of GET /v1/billing/portal/usage (PortalFeatureAvailability). */
export interface FeatureAvailability {
  key: string;
  label: string;
  included: boolean;
  source: 'features_array' | 'limits_boolean' | 'none';
}

/** GET /v1/billing/portal/usage - the caller's own usage against its plan. */
export interface OwnUsageSummary {
  tenantId: string;
  items: UsageItem[];
  features: FeatureAvailability[];
  fetchedAt: string;
}
