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
import { assertStepUpProof } from '@/api/step-up-proof';

import type {
  ArchivePlanResult,
  CreatePlanRequest,
  Plan,
  PlanFilter,
  PlanPage,
  UpdatePlanRequest,
} from './plan-types';


function canonicalPrice(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{1,12}(?:\.\d{1,6})?$/.test(value)) return null;
  const [integer = '', fraction = ''] = value.split('.');
  return `${integer.replace(/^0+(?=\d)/, '')}.${fraction.replace(/0+$/, '')}`;
}

/** A mutation is not acknowledged as successful unless every submitted field matches. */
function planResponse(value: unknown, id?: string, submitted?: CreatePlanRequest | UpdatePlanRequest): Plan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid plan response');
  const plan = value as Record<string, unknown>;
  const integerFields = ['trialDays', 'performanceFeeBps', 'platformFeeBps', 'sortOrder'];
  if (typeof plan.id !== 'string' || !plan.id || typeof plan.code !== 'string' || !plan.code || typeof plan.name !== 'string' ||
      (plan.tenantId !== null && typeof plan.tenantId !== 'string') || (plan.description !== null && typeof plan.description !== 'string') ||
      typeof plan.audience !== 'string' || typeof plan.currency !== 'string' || typeof plan.interval !== 'string' ||
      typeof plan.isActive !== 'boolean' || canonicalPrice(plan.price) === null ||
      integerFields.some((key) => !Number.isSafeInteger(plan[key]) || (plan[key] as number) < 0) ||
      !plan.limits || typeof plan.limits !== 'object' || Array.isArray(plan.limits) || !Array.isArray(plan.features) ||
      plan.features.some((feature) => typeof feature !== 'string') || typeof plan.createdAt !== 'string' || !Number.isFinite(Date.parse(plan.createdAt)) ||
      typeof plan.updatedAt !== 'string' || !Number.isFinite(Date.parse(plan.updatedAt)) || (id !== undefined && plan.id !== id)) {
    throw new Error('Invalid plan response');
  }
  if (submitted) {
    for (const [key, expected] of Object.entries(submitted)) {
      if (expected === undefined) continue;
      if (key === 'price') {
        if (canonicalPrice(expected) === null || canonicalPrice(expected) !== canonicalPrice(plan.price)) throw new Error('Invalid plan response');
      } else if (key === 'limits') {
        if (!expected || typeof expected !== 'object' || Array.isArray(expected) ||
            Object.entries(expected).some(([limit, v]) => v !== undefined && (plan.limits as Record<string, unknown>)[limit] !== v)) throw new Error('Invalid plan response');
      } else if (key === 'features') {
        if (!Array.isArray(expected) || expected.length !== (plan.features as unknown[]).length ||
            expected.some((feature, index) => feature !== (plan.features as unknown[])[index])) throw new Error('Invalid plan response');
      } else if (plan[key] !== expected) throw new Error('Invalid plan response');
    }
  }
  return value as Plan;
}

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

export async function createPlan(request: CreatePlanRequest, idempotencyKey: string): Promise<Plan> {
  if (canonicalPrice(request.price) === null) throw new Error('Invalid plan price');
  const value = await apiClient.post<unknown>('/billing/plans', request, { idempotencyKey });
  return planResponse(value, undefined, request);
}

export async function updatePlan(id: string, request: UpdatePlanRequest, idempotencyKey: string): Promise<Plan> {
  if (request.price !== undefined && canonicalPrice(request.price) === null) throw new Error('Invalid plan price');
  const value = await apiClient.patch<unknown>(`/billing/plans/${encodeURIComponent(id)}`, request, { idempotencyKey });
  return planResponse(value, id, request);
}

/** Makes the plan purchasable again (PATCH isActive=true). */
export async function activatePlan(id: string, idempotencyKey: string): Promise<Plan> {
  return updatePlan(id, { isActive: true }, idempotencyKey);
}

/** Stops new purchases of the plan; existing subscriptions are unaffected (PATCH isActive=false). */
export async function deactivatePlan(id: string, idempotencyKey: string): Promise<Plan> {
  return updatePlan(id, { isActive: false }, idempotencyKey);
}

/** Archives the plan (DELETE). The API refuses while trialing/active/past-due subscribers remain. */
export async function archivePlan(id: string, idempotencyKey: string): Promise<ArchivePlanResult> {
  const value = await apiClient.delete<unknown>(`/billing/plans/${encodeURIComponent(id)}`, { idempotencyKey });
  if (!value || typeof value !== 'object' || (value as { id?: unknown }).id !== id || (value as { archived?: unknown }).archived !== true) throw new Error('Invalid archive response');
  return value as ArchivePlanResult;
}

export type PlanAction = 'PLAN_CREATE' | 'PLAN_UPDATE' | 'PLAN_ARCHIVE' | 'PLAN_GRANTS_UPDATE';
export async function verifyPlanAction(action: PlanAction, method: 'TOTP' | 'PASSWORD' | 'RECOVERY_CODE', value: string, idempotencyKey: string): Promise<void> {
  const proof = await apiClient.post<unknown>('/v1/auth/step-up/verify', { action, method, ...(method === 'TOTP' ? { code: value } : method === 'PASSWORD' ? { password: value } : { recoveryCode: value }) }, { idempotencyKey });
  assertStepUpProof(proof, action, method);
}
export async function updatePlanGrants(id: string, grants: Record<string, number | boolean>, idempotencyKey: string): Promise<Plan> {
  const value = await apiClient.patch<unknown>(`/v1/billing/plans/${encodeURIComponent(id)}/grants`, grants, { idempotencyKey });
  const plan = planResponse(value, id);
  if (Object.entries(grants).some(([key, expected]) => (plan.limits as unknown as Record<string, unknown>)[key] !== expected)) throw new Error('Invalid grants response');
  return plan;
}
