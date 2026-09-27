import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '@wlct/shared-types';
import { EnforcementDecisionCode, type EnforcementScope } from './enforcement.types';

/** Base class for all enforcement-layer errors. */
abstract class EnforcementError extends AppException {
  public readonly enforcementCode: EnforcementDecisionCode;

  constructor(
    code: ErrorCode,
    enforcementCode: EnforcementDecisionCode,
    message: string,
    context?: Record<string, unknown>,
  ) {
    super({ code, message, context });
    this.enforcementCode = enforcementCode;
  }
}

/**
 * The tenant's current plan does not include the requested feature.
 *
 * Example: a tenant on the Basic plan tries to enable `customDomain`.
 */
export class FeatureNotIncludedError extends EnforcementError {
  constructor(featureKey: string, planCode?: string | null) {
    super(
      ErrorCode.FEATURE_DISABLED,
      EnforcementDecisionCode.FEATURE_NOT_INCLUDED,
      'This feature is not included in your current plan.',
      { featureKey, planCode: planCode ?? undefined },
    );
    this.name = 'FeatureNotIncludedError';
  }
}

/**
 * A numeric plan limit has been reached.
 *
 * Metadata includes the limit key, current usage, configured maximum, and
 * remaining capacity.  No credentials or tokens are ever included.
 */
export class PlanLimitExceededError extends EnforcementError {
  constructor(params: {
    limitKey: string;
    currentUsage: number;
    configuredMaximum: number;
    remaining: number;
    scope: EnforcementScope;
    scopeId?: string;
  }) {
    super(
      ErrorCode.SUBSCRIPTION_LIMIT_REACHED,
      EnforcementDecisionCode.PLAN_LIMIT_EXCEEDED,
      'Your current plan limit for this resource has been reached.',
      {
        limitKey: params.limitKey,
        currentUsage: params.currentUsage,
        configuredMaximum: params.configuredMaximum,
        remaining: params.remaining,
        scope: params.scope,
        scopeId: params.scopeId,
      },
    );
    this.name = 'PlanLimitExceededError';
  }
}

/**
 * The platform could not read the tenant's usage counters.
 *
 * This is a transient infrastructure failure, not a business rejection.
 */
export class UsageUnavailableError extends EnforcementError {
  constructor(limitKey: string, cause?: unknown) {
    super(
      ErrorCode.SERVICE_UNAVAILABLE,
      EnforcementDecisionCode.USAGE_UNAVAILABLE,
      'Usage information is temporarily unavailable. Please retry shortly.',
      { limitKey },
    );
    this.name = 'UsageUnavailableError';
  }
}

/**
 * The tenant's subscription is in a state that blocks the requested action.
 *
 * Valid states that pass: TRIALING, ACTIVE, and LIFETIME.
 */
export class SubscriptionInactiveError extends EnforcementError {
  constructor(subscriptionStatus: string | null, planCode?: string | null) {
    super(
      ErrorCode.SUBSCRIPTION_REQUIRED,
      EnforcementDecisionCode.SUBSCRIPTION_INACTIVE,
      'An active subscription is required to perform this action.',
      { subscriptionStatus: subscriptionStatus ?? 'NONE', planCode: planCode ?? undefined },
    );
    this.name = 'SubscriptionInactiveError';
  }
}

/**
 * The platform could not resolve the tenant's billing state at all.
 *
 * This can happen when the tenant record itself is missing or when the
 * subscription resolution service is unreachable.
 */
export class TenantBillingContextError extends EnforcementError {
  constructor(tenantId: string, reason?: string) {
    super(
      ErrorCode.TENANT_NOT_FOUND,
      EnforcementDecisionCode.BILLING_CONTEXT_UNAVAILABLE,
      'Your billing information could not be resolved.',
      { tenantId, reason },
    );
    this.name = 'TenantBillingContextError';
  }
}

/**
 * The tenant's plan allows the action but the per-window rate limit has been
 * exceeded.
 *
 * Metadata includes retry-after information when available.
 */
export class RateLimitExceededError extends EnforcementError {
  constructor(params: {
    limitKey: string;
    currentUsage: number;
    configuredMaximum: number;
    windowStart?: Date;
    windowEnd?: Date;
    retryAfterSeconds?: number;
  }) {
    super(
      ErrorCode.RATE_LIMIT_EXCEEDED,
      EnforcementDecisionCode.RATE_LIMIT_EXCEEDED,
      'Too many requests. Please slow down and try again shortly.',
      {
        limitKey: params.limitKey,
        currentUsage: params.currentUsage,
        configuredMaximum: params.configuredMaximum,
        retryAfterSeconds: params.retryAfterSeconds,
        windowStart: params.windowStart?.toISOString(),
        windowEnd: params.windowEnd?.toISOString(),
      },
    );
    this.name = 'RateLimitExceededError';
  }
}
