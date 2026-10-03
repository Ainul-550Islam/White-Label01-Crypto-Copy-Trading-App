/**
 * Plan Types for Admin Web
 *
 * The plan shape is the API's own contract (`SubscriptionPlanDto` from
 * @wlct/shared-types, served by /v1/billing/plans). An earlier version of this
 * module described a different, never-implemented API (tiers, slugs, price
 * objects, plan stats/history); it was removed in round 7 so the console can
 * only call routes that exist.
 */

import type {
  BillingInterval as SharedBillingInterval,
  PlanAudience as SharedPlanAudience,
  PlanLimits as SharedPlanLimits,
  SubscriptionPlanDto,
} from '@wlct/shared-types';

/** A plan exactly as GET /v1/billing/plans returns it. */
export type Plan = SubscriptionPlanDto;

export type PlanLimits = SharedPlanLimits;

/** Billing intervals the API accepts (`BillingInterval` in shared-types). */
export const BILLING_INTERVALS = ['MONTHLY', 'QUARTERLY', 'YEARLY', 'LIFETIME'] as const;
export type BillingInterval = `${SharedBillingInterval}`;

/** Plan audiences the API accepts (`PlanAudience` in shared-types). */
export const PLAN_AUDIENCES = ['TENANT', 'END_USER'] as const;
export type PlanAudience = `${SharedPlanAudience}`;

/** Currencies CreatePlanDto accepts. */
export const PLAN_CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'BDT', 'TRY'] as const;
export type PlanCurrency = (typeof PLAN_CURRENCIES)[number];

/** Derived lifecycle shown in the console; the API stores `isActive` (archive = DELETE). */
export enum PlanStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

/**
 * Query keys GET /v1/billing/plans accepts (ListPlansDto = PaginationQueryDto +
 * audience). Any other key is refused with 422 by the API's validation pipe.
 */
export interface PlanFilter {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  audience?: PlanAudience;
  /** ListPlansDto.includeInactive: without it the API returns active plans only. */
  includeInactive?: boolean;
}

/** The paginated envelope the list route returns (after the {success,data} unwrap). */
export interface PlanPage {
  items: Plan[];
  pagination: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    hasNextPage?: boolean;
    hasPreviousPage?: boolean;
  };
}

/** POST /v1/billing/plans body (CreatePlanDto). */
export interface CreatePlanRequest {
  code: string;
  name: string;
  description?: string;
  audience?: PlanAudience;
  price: string;
  currency?: PlanCurrency;
  interval?: BillingInterval;
  trialDays?: number;
  performanceFeeBps?: number;
  platformFeeBps?: number;
  limits?: Partial<PlanLimits>;
  features?: string[];
  isActive?: boolean;
  sortOrder?: number;
  externalPriceId?: string;
}

/** PATCH /v1/billing/plans/:id body (UpdatePlanDto). Code, audience and currency are immutable. */
export interface UpdatePlanRequest {
  name?: string;
  description?: string;
  price?: string;
  interval?: BillingInterval;
  trialDays?: number;
  performanceFeeBps?: number;
  platformFeeBps?: number;
  limits?: Partial<PlanLimits>;
  features?: string[];
  isActive?: boolean;
  sortOrder?: number;
  externalPriceId?: string;
}

/** DELETE /v1/billing/plans/:id result. */
export interface ArchivePlanResult {
  id: string;
  archived: true;
}

export function planStatus(plan: Pick<Plan, 'isActive'>): PlanStatus {
  return plan.isActive ? PlanStatus.ACTIVE : PlanStatus.INACTIVE;
}
