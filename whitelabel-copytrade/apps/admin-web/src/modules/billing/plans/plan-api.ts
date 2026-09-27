/**
 * Plan API for Admin Web
 * 
 * API client for managing billing plans in the admin interface.
 */

import {
  Plan,
  PlanSummary,
  PlanFilter,
  CreatePlanRequest,
  UpdatePlanRequest,
  PlanTier,
  PlanStatus,
} from './plan-types';

const API_BASE = '/api/billing/plans';

export async function getPlans(filter?: PlanFilter): Promise<PlanSummary[]> {
  const params = new URLSearchParams();
  if (filter?.tier) params.append('tier', filter.tier);
  if (filter?.status) params.append('status', filter.status);
  if (filter?.search) params.append('search', filter.search);

  const response = await fetch(`${API_BASE}?${params.toString()}`);
  if (!response.ok) throw new Error('Failed to fetch plans');
  return response.json();
}

export async function getPlan(id: string): Promise<Plan> {
  const response = await fetch(`${API_BASE}/${id}`);
  if (!response.ok) throw new Error('Failed to fetch plan');
  return response.json();
}

export async function createPlan(request: CreatePlanRequest): Promise<Plan> {
  const response = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error('Failed to create plan');
  return response.json();
}

export async function updatePlan(id: string, request: UpdatePlanRequest): Promise<Plan> {
  const response = await fetch(`${API_BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error('Failed to update plan');
  return response.json();
}

export async function deletePlan(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete plan');
}

export async function activatePlan(id: string): Promise<Plan> {
  const response = await fetch(`${API_BASE}/${id}/activate`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to activate plan');
  return response.json();
}

export async function deactivatePlan(id: string): Promise<Plan> {
  const response = await fetch(`${API_BASE}/${id}/deactivate`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to deactivate plan');
  return response.json();
}

export async function archivePlan(id: string): Promise<Plan> {
  const response = await fetch(`${API_BASE}/${id}/archive`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to archive plan');
  return response.json();
}

export async function duplicatePlan(id: string, newName: string): Promise<Plan> {
  const response = await fetch(`${API_BASE}/${id}/duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName }),
  });
  if (!response.ok) throw new Error('Failed to duplicate plan');
  return response.json();
}

export async function getPlanStats(id: string): Promise<{
  totalSubscribers: number;
  activeSubscribers: number;
  revenue: number;
  churnRate: number;
}> {
  const response = await fetch(`${API_BASE}/${id}/stats`);
  if (!response.ok) throw new Error('Failed to fetch plan stats');
  return response.json();
}

export async function getPlanHistory(id: string): Promise<{
  id: string;
  action: string;
  timestamp: string;
  user: string;
  changes: Record<string, { old: unknown; new: unknown }>;
}[]> {
  const response = await fetch(`${API_BASE}/${id}/history`);
  if (!response.ok) throw new Error('Failed to fetch plan history');
  return response.json();
}