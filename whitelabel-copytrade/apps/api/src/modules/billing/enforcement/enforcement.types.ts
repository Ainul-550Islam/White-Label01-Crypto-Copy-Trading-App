import type { PlanLimits, SubscriptionStatus } from '@wlct/shared-types';

/** Scope at which a limit or feature check is evaluated. */
export enum EnforcementScope {
  TENANT = 'TENANT',
  USER = 'USER',
  TRADER = 'TRADER',
  FOLLOWER = 'FOLLOWER',
}

/** Category of enforcement being performed. */
export enum EnforcementType {
  FEATURE = 'FEATURE',
  LIMIT = 'LIMIT',
  RATE_LIMIT = 'RATE_LIMIT',
}

/** Machine-readable decision codes returned to callers and logged. */
export enum EnforcementDecisionCode {
  ALLOWED = 'ALLOWED',
  FEATURE_NOT_INCLUDED = 'FEATURE_NOT_INCLUDED',
  PLAN_LIMIT_EXCEEDED = 'PLAN_LIMIT_EXCEEDED',
  SUBSCRIPTION_INACTIVE = 'SUBSCRIPTION_INACTIVE',
  BILLING_CONTEXT_UNAVAILABLE = 'BILLING_CONTEXT_UNAVAILABLE',
  USAGE_UNAVAILABLE = 'USAGE_UNAVAILABLE',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
}

/**
 * Resolved tenant billing context: the subscription and plan data needed by
 * every enforcement decision, fetched once per request and passed down.
 */
export interface TenantBillingContext {
  tenantId: string;
  subscriptionId: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  planId: string | null;
  planCode: string | null;
  planLimits: PlanLimits;
  planFeatures: string[];
  /** True when the tenant is in a valid paying/trial state. */
  subscriptionActive: boolean;
  /** True when the tenant has a lifetime plan that does not expire. */
  isLifetime: boolean;
}

/** Identity of the authenticated caller resolved from the request pipeline. */
export interface EnforcementActor {
  userId: string;
  tenantId: string;
  roles: string[];
  ipHash: string;
  requestId: string;
  correlationId: string;
}

/** Resource-specific metadata attached to an enforcement check. */
export interface EnforcementResource {
  type: string;
  id?: string;
  ownerUserId?: string;
  ownerTraderId?: string;
  ownerFollowerId?: string;
}

/**
 * The complete context object assembled before an enforcement decision is made.
 * Built by enforcement.context.ts from the request pipeline.
 */
export interface EnforcementContext {
  tenant: TenantBillingContext;
  actor: EnforcementActor;
  resource?: EnforcementResource;
}

/** Result of a boolean feature check. */
export interface FeatureCheckResult {
  allowed: boolean;
  decision: EnforcementDecisionCode;
  featureKey: string;
  reason?: string;
}

/** Result of a numeric quota / limit check. */
export interface QuotaCheckResult {
  allowed: boolean;
  decision: EnforcementDecisionCode;
  limitKey: string;
  currentUsage: number;
  configuredMaximum: number | null;
  remaining: number | null;
  scope: EnforcementScope;
  scopeId?: string;
  reason?: string;
  /** Window start ISO string for rate-based limits. */
  windowStart?: string;
  /** Window end ISO string for rate-based limits. */
  windowEnd?: string;
  /** Suggested retry-after seconds for rate-limit rejections. */
  retryAfterSeconds?: number;
}

/** Snapshot of current usage against a limit key. */
export interface UsageSnapshot {
  limitKey: string;
  current: number;
  maximum: number | null;
  remaining: number | null;
  scope: EnforcementScope;
  scopeId: string;
  windowStart?: Date;
  windowEnd?: Date;
  updatedAt: Date;
}

/**
 * Normalised enforcement decision returned by the service layer.
 * Callers that need strict mode call the service with `throwOnDeny: true`.
 */
export interface EnforcementDecision {
  allowed: boolean;
  decision: EnforcementDecisionCode;
  limitKey?: string;
  featureKey?: string;
  currentUsage?: number;
  configuredMaximum?: number | null;
  remaining?: number | null;
  scope?: EnforcementScope;
  scopeId?: string;
  reason?: string;
  retryAfterSeconds?: number;
}
