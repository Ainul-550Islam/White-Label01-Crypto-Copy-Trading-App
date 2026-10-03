/**
 * Billing Portal API client for admin-web.
 * Consumes canonical billing APIs, never hardcodes pricing.
 * No secrets exposed.
 */

import { apiClient } from '@/lib/api-client';

const PROXY_PREFIX = '/api/proxy';
const API_BASE = `${PROXY_PREFIX}/billing/portal`;

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

export async function getBillingOverview(): Promise<any> {
  return fetchJson(`${API_BASE}/overview`);
}

export async function getCurrentSubscription(): Promise<any> {
  return fetchJson(`${API_BASE}/subscription`);
}

export async function getAvailablePlans(): Promise<any> {
  return fetchJson(`${API_BASE}/plans`);
}

export async function getPlanComparison(): Promise<any> {
  return fetchJson(`${API_BASE}/plans/comparison`);
}

export async function getUsageSummary(): Promise<any> {
  return fetchJson(`${API_BASE}/usage`);
}

export async function listInvoices(params?: { status?: string; limit?: number; fromDate?: string; toDate?: string }): Promise<any> {
  const q = new URLSearchParams();
  if (params?.status) q.append('status', params.status);
  if (params?.limit) q.append('limit', String(params.limit));
  if (params?.fromDate) q.append('fromDate', params.fromDate);
  if (params?.toDate) q.append('toDate', params.toDate);
  return fetchJson(`${API_BASE}/invoices?${q.toString()}`);
}

export async function getInvoiceDetail(id: string): Promise<any> {
  return fetchJson(`${API_BASE}/invoices/${id}`);
}

export async function getInvoicePdfMetadata(id: string): Promise<any> {
  return fetchJson(`${API_BASE}/invoices/${id}/pdf-metadata`);
}

export async function listPayments(params?: { status?: string; provider?: string; limit?: number }): Promise<any> {
  const q = new URLSearchParams();
  if (params?.status) q.append('status', params.status);
  if (params?.provider) q.append('provider', params.provider);
  if (params?.limit) q.append('limit', String(params.limit));
  return fetchJson(`${API_BASE}/payments?${q.toString()}`);
}

export async function getPaymentDetail(id: string): Promise<any> {
  return fetchJson(`${API_BASE}/payments/${id}`);
}

export async function getPaymentStatus(id: string): Promise<any> {
  return fetchJson(`${API_BASE}/payments/${id}/status`);
}

export async function createCheckoutSession(payload: { planId: string; billingInterval?: string; currency?: string; provider?: string; successUrl?: string; cancelUrl?: string; idempotencyKey?: string }): Promise<any> {
  return fetchJson(`${API_BASE}/checkout`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getCheckoutStatus(id: string): Promise<any> {
  return fetchJson(`${API_BASE}/checkout/${id}/status`);
}

export async function cancelSubscription(payload: { reason?: string; atPeriodEnd?: boolean }): Promise<any> {
  return fetchJson(`${API_BASE}/subscription/cancel`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function resumeSubscription(): Promise<any> {
  return fetchJson(`${API_BASE}/subscription/resume`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function changePlan(payload: { planId: string; atPeriodEnd?: boolean }): Promise<any> {
  return fetchJson(`${API_BASE}/subscription/change-plan`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function changeInterval(payload: { newInterval: string; atPeriodEnd?: boolean }): Promise<any> {
  return fetchJson(`${API_BASE}/subscription/change-interval`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
