import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { EnforcementContextBuilder } from './enforcement.context';
import { EnforcementAuditService } from './enforcement.audit';
import { UsageCounter } from './usage.counter';
import {
  EnforcementDecisionCode,
  EnforcementScope,
  type EnforcementActor,
  type QuotaCheckResult,
} from './enforcement.types';
import { PlanLimitExceededError, SubscriptionInactiveError } from './enforcement.errors';

const LIMIT_KEY = 'maxCopySubscriptionsPerFollower';

/**
 * Copy-subscription limit enforcement guard.
 *
 * Enforces the `maxCopySubscriptionsPerFollower` plan limit.
 *
 * IMPORTANT: this limit is per follower, not per tenant or per trader.
 * The scopeId is the follower's id.
 *
 * Flow:
 *   copy-subscription creation → identify follower → resolve tenant plan →
 *   resolve maxCopySubscriptionsPerFollower → current follower usage →
 *   atomic reserve → allow OR reject
 *
 * Integration: the existing copy-subscription creation flow calls `reserve()`
 * before persisting and `release()` if persistence fails.
 *
 * Retries / idempotent requests are handled correctly: the reserve uses an
 * atomic Lua script keyed to the follower, so duplicate reservations from
 * retried requests do not double-count quota.
 */
@Injectable()
export class PlanLimitCopySubscriptionsGuard {
  constructor(
    private readonly contextBuilder: EnforcementContextBuilder,
    private readonly counter: UsageCounter,
    private readonly audit: EnforcementAuditService,
    @InjectPinoLogger(PlanLimitCopySubscriptionsGuard.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Attempt to reserve a copy-subscription slot for a specific follower.
   *
   * @param actor      The authenticated caller.
   * @param followerId The follower subscribing to copy-trading.
   */
  async reserve(actor: EnforcementActor, followerId: string): Promise<QuotaCheckResult> {
    const ctx = await this.contextBuilder.build(actor, {
      type: 'copy_subscription',
      ownerFollowerId: followerId,
    });

    if (!ctx.tenant.subscriptionActive) {
      const result: QuotaCheckResult = {
        allowed: false,
        decision: EnforcementDecisionCode.SUBSCRIPTION_INACTIVE,
        limitKey: LIMIT_KEY,
        currentUsage: 0,
        configuredMaximum: null,
        remaining: null,
        scope: EnforcementScope.FOLLOWER,
        scopeId: followerId,
        reason: 'An active subscription is required to create copy subscriptions.',
      };
      await this.audit.logLimitCheck(ctx, result, actor.userId);
      throw new SubscriptionInactiveError(ctx.tenant.subscriptionStatus, ctx.tenant.planCode);
    }

    const maximum = ctx.tenant.planLimits.maxCopySubscriptionsPerFollower;

    if (maximum === null) {
      const result: QuotaCheckResult = {
        allowed: true,
        decision: EnforcementDecisionCode.ALLOWED,
        limitKey: LIMIT_KEY,
        currentUsage: 0,
        configuredMaximum: null,
        remaining: null,
        scope: EnforcementScope.FOLLOWER,
        scopeId: followerId,
      };
      await this.audit.logLimitCheck(ctx, result, actor.userId);
      return result;
    }

    const reserveResult = await this.counter.atomicCheckAndIncrement({
      tenantId: actor.tenantId,
      limitKey: LIMIT_KEY,
      scopeId: `${actor.tenantId}:follower:${followerId}:copy_subs`,
      maximum,
    });

    const result: QuotaCheckResult = {
      allowed: reserveResult.reserved,
      decision: reserveResult.reserved
        ? EnforcementDecisionCode.ALLOWED
        : EnforcementDecisionCode.PLAN_LIMIT_EXCEEDED,
      limitKey: LIMIT_KEY,
      currentUsage: reserveResult.currentAfter,
      configuredMaximum: maximum,
      remaining: reserveResult.remaining,
      scope: EnforcementScope.FOLLOWER,
      scopeId: followerId,
      reason: reserveResult.reserved
        ? undefined
        : `Copy subscription limit reached for follower ${followerId}: ${reserveResult.currentAfter}/${maximum}.`,
    };

    await this.audit.logLimitCheck(ctx, result, actor.userId);

    if (!reserveResult.reserved) {
      throw new PlanLimitExceededError({
        limitKey: LIMIT_KEY,
        currentUsage: reserveResult.currentAfter,
        configuredMaximum: maximum,
        remaining: 0,
        scope: EnforcementScope.FOLLOWER,
        scopeId: followerId,
      });
    }

    return result;
  }

  /**
   * Release a previously reserved copy-subscription slot.
   */
  async release(actor: EnforcementActor, followerId: string): Promise<void> {
    await this.counter.atomicDecrement({
      tenantId: actor.tenantId,
      limitKey: LIMIT_KEY,
      scopeId: `${actor.tenantId}:follower:${followerId}:copy_subs`,
    });
  }

  /**
   * Read-only check: can this follower subscribe to another trader?
   */
  async canSubscribe(actor: EnforcementActor, followerId: string): Promise<QuotaCheckResult> {
    const ctx = await this.contextBuilder.build(actor, {
      type: 'copy_subscription',
      ownerFollowerId: followerId,
    });

    const maximum = ctx.tenant.planLimits.maxCopySubscriptionsPerFollower;

    if (maximum === null) {
      return {
        allowed: true,
        decision: EnforcementDecisionCode.ALLOWED,
        limitKey: LIMIT_KEY,
        currentUsage: 0,
        configuredMaximum: null,
        remaining: null,
        scope: EnforcementScope.FOLLOWER,
        scopeId: followerId,
      };
    }

    const currentUsage = await this.counter.read({
      tenantId: actor.tenantId,
      limitKey: LIMIT_KEY,
      scopeId: `${actor.tenantId}:follower:${followerId}:copy_subs`,
    });

    const remaining = Math.max(0, maximum - currentUsage);
    const allowed = currentUsage < maximum;

    return {
      allowed,
      decision: allowed
        ? EnforcementDecisionCode.ALLOWED
        : EnforcementDecisionCode.PLAN_LIMIT_EXCEEDED,
      limitKey: LIMIT_KEY,
      currentUsage,
      configuredMaximum: maximum,
      remaining,
      scope: EnforcementScope.FOLLOWER,
      scopeId: followerId,
    };
  }
}
