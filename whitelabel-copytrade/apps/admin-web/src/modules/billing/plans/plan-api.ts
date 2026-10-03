/**
 * Plan API for Admin Web
 *
 * The plan catalogue routes of the platform API, called through the console's
 * same-origin proxy (/api/proxy/* -> API_BASE_URL/v1/*), which holds the
 * bearer token in an httpOnly cookie and adds the CSRF header to mutations.
 * apiClient unwraps the {success, data} envelope.
 *
 *   GET    /v1/billing/plans        plan:read    paginated catalogue
 *   GET    /v1/billing/plans/:id    plan:read
 *   POST   /v1/billing/plans        plan:manage  create
 *   PATCH  /v1/billing/plans/:id    plan:manage  update (incl. isActive)
 *   DELETE /v1/billing/plans/:id    plan:manage  archive (refused while the
 *                                                plan has live subscribers)
 *
 * Before round 7 this module fetched `/api/billing/plans` on the admin origin
 * (no such route - every call 404'd), used PUT where the API has PATCH, and
 * offered duplicate / stats / history calls for which the API has no route.
 * Those were removed instead of being pointed at invented endpoints.
 * Activation is the real `isActive` field of PATCH.
 */

import { apiClient } from '@/lib/api-client';

import type {
  ArchivePlanResult,
  CreatePlanRequest,
  Plan,
  PlanFilter,
  PlanPage,
  UpdatePlanRequest,
} from './plan-types';

/** Only the query keys ListPlansDto declares are sent (others are a 422). */
export async function getPlans(filter?: PlanFilter): Promise<PlanPage> {
  // The keys are written out literally (no helper) so that
  // scripts/check-web-api-contract.js can verify each against ListPlansDto.
  return apiClient.get<PlanPage>('/billing/plans', {
    searchParams: {
      page: filter?.page,
      limit: filter?.limit,
      search: filter?.search?.trim() || undefined,
      sortBy: filter?.sortBy,
      sortOrder: filter?.sortOrder,
      audience: filter?.audience,
      // Sent only when asked for: the API default (false) lists active plans only.
      includeInactive: filter?.includeInactive ? true : undefined,
    },
  });
}

export async function getPlan(id: string): Promise<Plan> {
  return apiClient.get<Plan>(`/billing/plans/${encodeURIComponent(id)}`);
}

export async function createPlan(request: CreatePlanRequest): Promise<Plan> {
  return apiClient.post<Plan>('/billing/plans', request);
}

export async function updatePlan(id: string, request: UpdatePlanRequest): Promise<Plan> {
  return apiClient.patch<Plan>(`/billing/plans/${encodeURIComponent(id)}`, request);
}

/** Makes the plan purchasable again (PATCH isActive=true). */
export async function activatePlan(id: string): Promise<Plan> {
  return updatePlan(id, { isActive: true });
}

/** Stops new purchases of the plan; existing subscriptions are unaffected (PATCH isActive=false). */
export async function deactivatePlan(id: string): Promise<Plan> {
  return updatePlan(id, { isActive: false });
}

/** Archives the plan (DELETE). The API refuses while trialing/active/past-due subscribers remain. */
export async function archivePlan(id: string): Promise<ArchivePlanResult> {
  return apiClient.delete<ArchivePlanResult>(`/billing/plans/${encodeURIComponent(id)}`);
}
