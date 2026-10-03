/**
 * SaaS Admin Control Plane API client.
 * Authenticated, tenant/admin scoped, no secrets, no direct DB calls.
 */

import { apiClient } from '@/lib/api-client';

const PROXY_PREFIX = '/api/proxy';
const API_BASE = `${PROXY_PREFIX}/billing/saas-admin`;

/**
 * All calls go through the console's same-origin proxy (/api/proxy/* ->
 * API_BASE_URL/v1/*): the bearer token lives in an httpOnly cookie that only
 * the proxy can read, and mutations carry the CSRF header. Before this the
 * module fetched `{API_BASE}` on the admin origin, which has no such route, so
 * every call 404'd. apiClient also unwraps the {success, data} envelope, which
 * is the shape the billing components read (e.g. `result.tenantSlug`).
 */
async function fetchJson(url: string, options?: RequestInit): Promise<any> {
  const path = url.startsWith(PROXY_PREFIX) ? url.slice(PROXY_PREFIX.length) : url;
  const method = (options?.method ?? 'GET').toUpperCase();
  const body =
    typeof options?.body === 'string' && options.body.length > 0 ? JSON.parse(options.body) : undefined;
  switch (method) {
    case 'POST':
      return apiClient.post(path, body);
    case 'PATCH':
      return apiClient.patch(path, body);
    case 'PUT':
      return apiClient.put(path, body);
    case 'DELETE':
      return apiClient.delete(path, body === undefined ? {} : { body });
    default:
      return apiClient.get(path);
  }
}

// Tenants
export async function listTenants(params?: { status?: string; planCode?: string; search?: string; page?: number; limit?: number }): Promise<any> {
  const q = new URLSearchParams();
  if (params?.status) q.append('status', params.status);
  if (params?.planCode) q.append('planCode', params.planCode);
  if (params?.search) q.append('search', params.search);
  if (params?.page) q.append('page', String(params.page));
  if (params?.limit) q.append('limit', String(params.limit));
  return fetchJson(`${API_BASE}/tenants?${q.toString()}`);
}

export async function getTenantDetail(id: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${id}`);
}

export async function provisionTenant(payload: { slug: string; name: string; legalName?: string; contactEmail?: string; countryCode?: string; defaultCurrency?: string; planId?: string; billingEmail?: string; billingName?: string; idempotencyKey?: string }): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/provision`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getTenantSubscription(id: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${id}/subscription`);
}

// Plans
export async function assignPlan(tenantId: string, planId: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/plan/assign`, {
    method: 'POST',
    body: JSON.stringify({ planId }),
  });
}

export async function changePlan(tenantId: string, planId: string, atPeriodEnd?: boolean): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/plan/change`, {
    method: 'POST',
    body: JSON.stringify({ planId, atPeriodEnd }),
  });
}

export async function changeInterval(tenantId: string, newInterval: string, atPeriodEnd?: boolean): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/plan/change-interval`, {
    method: 'POST',
    body: JSON.stringify({ newInterval, atPeriodEnd }),
  });
}

// Feature access
export async function getFeatureAccess(tenantId: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/feature-access`);
}

export async function checkFeature(tenantId: string, featureKey: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/feature-access/${featureKey}`);
}

// Branding
export async function getBranding(tenantId: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/branding`);
}

export async function updateBranding(tenantId: string, payload: Record<string, any>): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/branding`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// Custom domains
export async function listDomains(tenantId: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/domains`);
}

export async function getDomainStatus(tenantId: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/domains/status`);
}

export async function registerDomain(tenantId: string, domain: string, isPrimary?: boolean): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/domains/register`, {
    method: 'POST',
    body: JSON.stringify({ domain, isPrimary }),
  });
}

export async function generateVerificationChallenge(tenantId: string, domain: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/domains/verification-challenge`, {
    method: 'POST',
    body: JSON.stringify({ domain }),
  });
}

export async function verifyDomain(tenantId: string, domain: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/domains/verify`, {
    method: 'POST',
    body: JSON.stringify({ domain }),
  });
}

export async function getVerificationStatus(tenantId: string, domain: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/domains/${encodeURIComponent(domain)}/verification-status`);
}

export async function removeDomain(tenantId: string, domain: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/domains`, {
    method: 'DELETE',
    body: JSON.stringify({ domain }),
  });
}

// White-label
export async function getWhiteLabelState(tenantId: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/white-label`);
}

export async function requestWhiteLabel(tenantId: string, configuration?: Record<string, any>): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/white-label/request`, {
    method: 'POST',
    body: JSON.stringify({ configuration }),
  });
}

export async function enableWhiteLabel(tenantId: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/white-label/enable`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function disableWhiteLabel(tenantId: string, reason?: string): Promise<any> {
  return fetchJson(`${API_BASE}/tenants/${tenantId}/white-label/disable`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

// Canonical plan catalog for UI - no hardcoded pricing.
// GET /v1/billing/plans through the proxy (the former raw fetch of
// /api/v1/billing/plans hit the admin origin, which has no such route, so the
// plan list was always empty). Only purchasable (active) plans are offered
// for assignment, which is the API default (ListPlansDto.includeInactive =
// false); the client-side filter is a belt-and-braces check, and the API
// refuses an inactive plan anyway.
export async function getPlanCatalog(): Promise<any> {
  const page = await apiClient.get<{ items: any[]; pagination: unknown }>('/billing/plans', {
    searchParams: { limit: 100, sortBy: 'sortOrder', sortOrder: 'asc' },
  });
  return { ...page, items: (page.items ?? []).filter((plan: any) => plan.isActive !== false) };
}
