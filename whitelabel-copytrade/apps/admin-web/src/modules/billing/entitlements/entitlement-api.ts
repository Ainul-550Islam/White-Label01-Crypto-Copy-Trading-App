/**
 * Entitlement API for Admin Web
 * 
 * API client for managing billing entitlements in the admin interface.
 */

import {
  Entitlement,
  EntitlementSummary,
  EntitlementFilter,
  CreateEntitlementRequest,
  UpdateEntitlementRequest,
  UsageRecord,
  EntitlementStatus,
} from './entitlement-types';

const API_BASE = '/api/billing/entitlements';

export async function getEntitlements(filter?: EntitlementFilter): Promise<EntitlementSummary[]> {
  const params = new URLSearchParams();
  if (filter?.tenantId) params.append('tenantId', filter.tenantId);
  if (filter?.userId) params.append('userId', filter.userId);
  if (filter?.planId) params.append('planId', filter.planId);
  if (filter?.status) params.append('status', filter.status);
  if (filter?.search) params.append('search', filter.search);

  const response = await fetch(`${API_BASE}?${params.toString()}`);
  if (!response.ok) throw new Error('Failed to fetch entitlements');
  return response.json();
}

export async function getEntitlement(id: string): Promise<Entitlement> {
  const response = await fetch(`${API_BASE}/${id}`);
  if (!response.ok) throw new Error('Failed to fetch entitlement');
  return response.json();
}

export async function createEntitlement(request: CreateEntitlementRequest): Promise<Entitlement> {
  const response = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error('Failed to create entitlement');
  return response.json();
}

export async function updateEntitlement(id: string, request: UpdateEntitlementRequest): Promise<Entitlement> {
  const response = await fetch(`${API_BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error('Failed to update entitlement');
  return response.json();
}

export async function deleteEntitlement(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete entitlement');
}

export async function suspendEntitlement(id: string, reason?: string): Promise<Entitlement> {
  const response = await fetch(`${API_BASE}/${id}/suspend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  if (!response.ok) throw new Error('Failed to suspend entitlement');
  return response.json();
}

export async function reactivateEntitlement(id: string): Promise<Entitlement> {
  const response = await fetch(`${API_BASE}/${id}/reactivate`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to reactivate entitlement');
  return response.json();
}

export async function cancelEntitlement(id: string, reason?: string): Promise<Entitlement> {
  const response = await fetch(`${API_BASE}/${id}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  if (!response.ok) throw new Error('Failed to cancel entitlement');
  return response.json();
}

export async function changePlan(id: string, newPlanId: string): Promise<Entitlement> {
  const response = await fetch(`${API_BASE}/${id}/change-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId: newPlanId }),
  });
  if (!response.ok) throw new Error('Failed to change plan');
  return response.json();
}

export async function getUsageHistory(
  id: string,
  featureKey?: string,
  limit?: number
): Promise<UsageRecord[]> {
  const params = new URLSearchParams();
  if (featureKey) params.append('featureKey', featureKey);
  if (limit) params.append('limit', limit.toString());

  const response = await fetch(`${API_BASE}/${id}/usage?${params.toString()}`);
  if (!response.ok) throw new Error('Failed to fetch usage history');
  return response.json();
}

export async function resetUsage(id: string, featureKey: string): Promise<void> {
  const response = await fetch(`${API_BASE}/${id}/usage/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ featureKey }),
  });
  if (!response.ok) throw new Error('Failed to reset usage');
}

export async function getEntitlementStats(): Promise<{
  totalEntitlements: number;
  activeEntitlements: number;
  trialEntitlements: number;
  churnRate: number;
  averageRevenue: number;
}> {
  const response = await fetch(`${API_BASE}/stats`);
  if (!response.ok) throw new Error('Failed to fetch entitlement stats');
  return response.json();
}

export async function checkFeatureAccess(
  entitlementId: string,
  featureKey: string
): Promise<{ allowed: boolean; reason?: string }> {
  const response = await fetch(`${API_BASE}/${entitlementId}/check/${featureKey}`);
  if (!response.ok) throw new Error('Failed to check feature access');
  return response.json();
}