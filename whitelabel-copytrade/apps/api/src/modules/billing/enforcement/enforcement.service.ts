import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { EnforcementContextBuilder } from './enforcement.context';
import { EnforcementAuditService } from './enforcement.audit';
import {
  EnforcementDecisionCode,
  EnforcementScope,
  type EnforcementActor,
  type EnforcementContext,
  type EnforcementDecision,
  type EnforcementResource,
  type FeatureCheckResult,
  type QuotaCheckResult,
} from './enforcement.types';
import {
  FeatureNotIncludedError,
  PlanLimitExceededError,
  SubscriptionInactiveError,
  UsageUnavailableError,
} from './enforcement.errors';

/**
 * The single entry-point for runtime enforcement decisions.
 *
 * Application services call this instead of reaching into billing internals
 * directly.  The service resolves context, evaluates the policy, logs the
 * audit trail, and returns a deterministic decision.
 */
@Injectable()
export class EnforcementService {
  constructor(
    private readonly contextBuilder: EnforcementContextBuilder,
    private readonly audit: EnforcementAuditService,
    @InjectPinoLogger(EnforcementService.name) private readonly logger: PinoLogger,
  ) {}

  // ---------------------------------------------------------------------------
  // Context helpers
  // ---------------------------------------------------------------------------

  /** Build context once for the current request. */
  async resolveContext(actor: EnforcementActor, resource?: EnforcementResource): Promise<EnforcementContext> {
    return this.contextBuilder.build(actor, resource);
  }

  // ---------------------------------------------------------------------------
  // Feature checks
  // ---------------------------------------------------------------------------

  /**
   * Check whether a boolean feature is included in the tenant's current plan.
   *
   * Features are read from the plan's `features` array (a list of string keys)
   * or, where the limit object uses a boolean field, from the corresponding
   * `PlanLimits` entry.
   */
  async checkFeature(
    ctx: EnforcementContext,
    featureKey: string,
    options: { strict?: boolean; actorId?: string } = {},
  ): Promise<FeatureCheckResult> {
    const { tenant } = ctx;

    if (!tenant.subscriptionActive) {
      const result: FeatureCheckResult = {
        allowed: false,
        decision: EnforcementDecisionCode.SUBSCRIPTION_INACTIVE,
        featureKey,
        reason: 'An active subscription is required.',
      };

      await this.audit.logFeatureCheck(ctx, result, options.actorId);
      if (options.strict) {
        throw new SubscriptionInactiveError(tenant.subscriptionStatus, tenant.planCode);
      }
      return result;
    }

    const included = this.isFeatureIncluded(tenant.planLimits, tenant.planFeatures, featureKey);

    const result: FeatureCheckResult = included
      ? { allowed: true, decision: EnforcementDecisionCode.ALLOWED, featureKey }
      : {
          allowed: false,
          decision: EnforcementDecisionCode.FEATURE_NOT_INCLUDED,
          featureKey,
          reason: `Feature '${featureKey}' is not included in the ${tenant.planCode ?? 'current'} plan.`,
        };

    await this.audit.logFeatureCheck(ctx, result, options.actorId);

    if (!included && options.strict) {
      throw new FeatureNotIncludedError(featureKey, tenant.planCode);
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Limit / quota checks
  // ---------------------------------------------------------------------------

  /**
   * Check a numeric plan limit against the supplied current usage.
   *
   * The `currentUsage` is passed in rather than read here so that callers can
   * use the correct counting method for their domain (DB count, Redis counter,
   * etc.) and so that this service stays free of domain-specific persistence.
   */
  async checkLimit(
    ctx: EnforcementContext,
    limitKey: string,
    currentUsage: number,
    scope: EnforcementScope,
    options: { scopeId?: string; strict?: boolean; actorId?: string } = {},
  ): Promise<QuotaCheckResult> {
    const { tenant } = ctx;

    if (!tenant.subscriptionActive) {
      const result: QuotaCheckResult = {
        allowed: false,
        decision: EnforcementDecisionCode.SUBSCRIPTION_INACTIVE,
        limitKey,
        currentUsage,
        configuredMaximum: null,
        remaining: null,
        scope,
        scopeId: options.scopeId,
        reason: 'An active subscription is required.',
      };

      await this.audit.logLimitCheck(ctx, result, options.actorId);
      if (options.strict) {
        throw new SubscriptionInactiveError(tenant.subscriptionStatus, tenant.planCode);
      }
      return result;
    }

    const maximum = this.resolveLimitValue(tenant.planLimits, limitKey);

    // null means unlimited
    if (maximum === null) {
      const result: QuotaCheckResult = {
        allowed: true,
        decision: EnforcementDecisionCode.ALLOWED,
        limitKey,
        currentUsage,
        configuredMaximum: null,
        remaining: null,
        scope,
        scopeId: options.scopeId,
      };

      await this.audit.logLimitCheck(ctx, result, options.actorId);
      return result;
    }

    const remaining = Math.max(0, maximum - currentUsage);
    const allowed = currentUsage < maximum;

    const result: QuotaCheckResult = {
      allowed,
      decision: allowed ? EnforcementDecisionCode.ALLOWED : EnforcementDecisionCode.PLAN_LIMIT_EXCEEDED,
      limitKey,
      currentUsage,
      configuredMaximum: maximum,
      remaining,
      scope,
      scopeId: options.scopeId,
      reason: allowed
        ? undefined
        : `Plan limit reached: ${currentUsage}/${maximum} for '${limitKey}'.`,
    };

    await this.audit.logLimitCheck(ctx, result, options.actorId);

    if (!allowed && options.strict) {
      throw new PlanLimitExceededError({
        limitKey,
        currentUsage,
        configuredMaximum: maximum,
        remaining: 0,
        scope,
        scopeId: options.scopeId,
      });
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Determine whether a feature key is included in the tenant's plan.
   *
   * Checks two sources:
   *   1. The plan's `features` string array (canonical feature keys).
   *   2. The `PlanLimits` boolean fields (customDomain, whiteLabelMobileApp,
   *      prioritySupport).
   */
  private isFeatureIncluded(
    limits: import('@wlct/shared-types').PlanLimits,
    features: string[],
    featureKey: string,
  ): boolean {
    if (features.includes(featureKey)) {
      return true;
    }

    // Boolean limit fields that act as feature toggles.
    switch (featureKey) {
      case 'customDomain':
        return limits.customDomain === true;
      case 'whiteLabelMobileApp':
        return limits.whiteLabelMobileApp === true;
      case 'prioritySupport':
        return limits.prioritySupport === true;
      default:
        return false;
    }
  }

  /**
   * Extract a numeric limit value from the PlanLimits object by key name.
   * Returns `null` when the limit is not set (unlimited).
   */
  private resolveLimitValue(
    limits: import('@wlct/shared-types').PlanLimits,
    limitKey: string,
  ): number | null {
    const key = limitKey as keyof import('@wlct/shared-types').PlanLimits;
    const value = limits[key];
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value === 'boolean') {
      return null;
    }
    return value as number;
  }
}
