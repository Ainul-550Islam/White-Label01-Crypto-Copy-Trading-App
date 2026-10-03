/**
 * Entitlement API for Admin Web
 *
 * Read-only access to the API's entitlement DERIVATION (plan features, plan
 * limits, feature flags), through the console's same-origin proxy
 * (/api/proxy/* -> API_BASE_URL/v1/*). apiClient unwraps {success, data}.
 *
 * Platform operators (platform:manage), any tenant:
 *   GET /v1/billing/saas-admin/tenants/:id/feature-access
 *   GET /v1/billing/saas-admin/tenants/:id/feature-access/:featureKey
 * The caller's own tenant (subscription:read):
 *   GET /v1/billing/subscription/limits
 *   GET /v1/billing/portal/usage
 *
 * Entitlements change only by changing the tenant's plan (billing portal or
 * SaaS admin plan routes) or its feature flags; there is deliberately no
 * entitlement write API. Before round 7 this module fetched
 * `/api/billing/entitlements/*` on the admin origin (no such route) and
 * offered create/suspend/cancel/reset-usage calls the API never had.
 */

import { apiClient } from '@/lib/api-client';

import type { FeatureCheckResult, OwnPlanLimits, OwnUsageSummary, TenantFeatureAccess } from './entitlement-types';

export async function getTenantFeatureAccess(tenantId: string): Promise<TenantFeatureAccess> {
  return apiClient.get<TenantFeatureAccess>(`/billing/saas-admin/tenants/${encodeURIComponent(tenantId)}/feature-access`);
}

export async function checkTenantFeature(tenantId: string, featureKey: string): Promise<FeatureCheckResult> {
  return apiClient.get<FeatureCheckResult>(
    `/billing/saas-admin/tenants/${encodeURIComponent(tenantId)}/feature-access/${encodeURIComponent(featureKey)}`,
  );
}

export async function getOwnPlanLimits(): Promise<OwnPlanLimits> {
  return apiClient.get<OwnPlanLimits>('/billing/subscription/limits');
}

export async function getOwnUsage(): Promise<OwnUsageSummary> {
  return apiClient.get<OwnUsageSummary>('/billing/portal/usage');
}
