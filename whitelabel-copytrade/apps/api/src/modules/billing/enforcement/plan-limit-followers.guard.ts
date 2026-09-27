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

const LIMIT_KEY = 'maxFollowersPerTrader';

/**
 * Follower-limit enforcement guard.
 *
 * Enforces the `maxFollowersPerTrader` plan limit.
 *
 * IMPORTANT: this is a per-trader limit, not a global tenant limit.
 * The scopeId is the target trader's id, not the tenant id.
 *
 * Flow:
 *   follower association/creation → identify target trader → resolve tenant
 *   plan → resolve maxFollowersPerTrader → read target trader follower
 *   usage → atomic reserve → allow OR reject
 *
 * Two concurrent follower creations for the same trader cannot both succeed
 * when only one slot remains, because the reserve uses an atomic Lua script
 * keyed to the trader.
 */
@Injectable()
export class PlanLimitFollowersGuard {
  constructor(
    private readonly contextBuilder: EnforcementContextBuilder,
    private readonly counter: UsageCounter,
    private readonly audit: EnforcementAuditService,
    @InjectPinoLogger(PlanLimitFollowersGuard.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Attempt to reserve a follower slot for a specific trader.
   *
   * @param actor     The authenticated caller.
   * @param traderId  The trader being followed.
   */
  async reserve(actor: EnforcementActor, traderId: string): Promise<QuotaCheckResult> {
    const ctx = await this.contextBuilder.build(actor, {
      type: 'trader',
      id: traderId,
    });

    if (!ctx.tenant.subscriptionActive) {
      const result: QuotaCheckResult = {
        allowed: false,
        decision: EnforcementDecisionCode.SUBSCRIPTION_INACTIVE,
        limitKey: LIMIT_KEY,
        currentUsage: 0,
        configuredMaximum: null,
        remaining: null,
        scope: EnforcementScope.TRADER,
        scopeId: traderId,
        reason: 'An active subscription is required to manage followers.',
      };
      await this.audit.logLimitCheck(ctx, result, actor.userId);
      throw new SubscriptionInactiveError(ctx.tenant.subscriptionStatus, ctx.tenant.planCode);
    }

    const maximum = ctx.tenant.planLimits.maxFollowersPerTrader;

    if (maximum === null) {
      const result: QuotaCheckResult = {
        allowed: true,
        decision: EnforcementDecisionCode.ALLOWED,
        limitKey: LIMIT_KEY,
        currentUsage: 0,
        configuredMaximum: null,
        remaining: null,
        scope: EnforcementScope.TRADER,
        scopeId: traderId,
      };
      await this.audit.logLimitCheck(ctx, result, actor.userId);
      return result;
    }

    const reserveResult = await this.counter.atomicCheckAndIncrement({
      tenantId: actor.tenantId,
      limitKey: LIMIT_KEY,
      scopeId: `${actor.tenantId}:trader:${traderId}:followers`,
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
      scope: EnforcementScope.TRADER,
      scopeId: traderId,
      reason: reserveResult.reserved
        ? undefined
        : `Follower limit reached for trader ${traderId}: ${reserveResult.currentAfter}/${maximum}.`,
    };

    await this.audit.logLimitCheck(ctx, result, actor.userId);

    if (!reserveResult.reserved) {
      throw new PlanLimitExceededError({
        limitKey: LIMIT_KEY,
        currentUsage: reserveResult.currentAfter,
        configuredMaximum: maximum,
        remaining: 0,
        scope: EnforcementScope.TRADER,
        scopeId: traderId,
      });
    }

    return result;
  }

  /**
   * Release a previously reserved follower slot for a trader.
   */
  async release(actor: EnforcementActor, traderId: string): Promise<void> {
    await this.counter.atomicDecrement({
      tenantId: actor.tenantId,
      limitKey: LIMIT_KEY,
      scopeId: `${actor.tenantId}:trader:${traderId}:followers`,
    });
  }

  /**
   * Read-only check: can this trader accept another follower?
   */
  async canFollow(actor: EnforcementActor, traderId: string): Promise<QuotaCheckResult> {
    const ctx = await this.contextBuilder.build(actor, {
      type: 'trader',
      id: traderId,
    });

    const maximum = ctx.tenant.planLimits.maxFollowersPerTrader;

    if (maximum === null) {
      return {
        allowed: true,
        decision: EnforcementDecisionCode.ALLOWED,
        limitKey: LIMIT_KEY,
        currentUsage: 0,
        configuredMaximum: null,
        remaining: null,
        scope: EnforcementScope.TRADER,
        scopeId: traderId,
      };
    }

    const currentUsage = await this.counter.read({
      tenantId: actor.tenantId,
      limitKey: LIMIT_KEY,
      scopeId: `${actor.tenantId}:trader:${traderId}:followers`,
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
      scope: EnforcementScope.TRADER,
      scopeId: traderId,
    };
  }
}
