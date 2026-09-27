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

const LIMIT_KEY = 'maxExchangeAccountsPerUser';

/**
 * Exchange-account limit enforcement guard.
 *
 * Enforces the `maxExchangeAccountsPerUser` plan limit.
 *
 * IMPORTANT: the limit is per end-user, not globally across the tenant.
 * The scopeId is the user id, not the tenant id.
 *
 * Flow:
 *   exchange-account link/create → identify user → resolve tenant plan →
 *   resolve maxExchangeAccountsPerUser → read user usage → atomic reserve →
 *   allow OR reject
 *
 * Integration: the existing `ExchangeAccountsService` creation/linking path
 * calls `reserve()` before persisting and `release()` if persistence fails.
 *
 * Only active/linkable exchange accounts are counted, according to the
 * existing business rules in `ExchangeAccountsService`.
 */
@Injectable()
export class PlanLimitExchangeAccountsGuard {
  constructor(
    private readonly contextBuilder: EnforcementContextBuilder,
    private readonly counter: UsageCounter,
    private readonly audit: EnforcementAuditService,
    @InjectPinoLogger(PlanLimitExchangeAccountsGuard.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Attempt to reserve an exchange-account slot for a specific user.
   *
   * @param actor  The authenticated caller.
   * @param userId The user who is linking the exchange account.
   */
  async reserve(actor: EnforcementActor, userId: string): Promise<QuotaCheckResult> {
    const ctx = await this.contextBuilder.build(actor, {
      type: 'exchange_account',
      ownerUserId: userId,
    });

    if (!ctx.tenant.subscriptionActive) {
      const result: QuotaCheckResult = {
        allowed: false,
        decision: EnforcementDecisionCode.SUBSCRIPTION_INACTIVE,
        limitKey: LIMIT_KEY,
        currentUsage: 0,
        configuredMaximum: null,
        remaining: null,
        scope: EnforcementScope.USER,
        scopeId: userId,
        reason: 'An active subscription is required to link exchange accounts.',
      };
      await this.audit.logLimitCheck(ctx, result, actor.userId);
      throw new SubscriptionInactiveError(ctx.tenant.subscriptionStatus, ctx.tenant.planCode);
    }

    const maximum = ctx.tenant.planLimits.maxExchangeAccountsPerUser;

    if (maximum === null) {
      const result: QuotaCheckResult = {
        allowed: true,
        decision: EnforcementDecisionCode.ALLOWED,
        limitKey: LIMIT_KEY,
        currentUsage: 0,
        configuredMaximum: null,
        remaining: null,
        scope: EnforcementScope.USER,
        scopeId: userId,
      };
      await this.audit.logLimitCheck(ctx, result, actor.userId);
      return result;
    }

    const reserveResult = await this.counter.atomicCheckAndIncrement({
      tenantId: actor.tenantId,
      limitKey: LIMIT_KEY,
      scopeId: `${actor.tenantId}:user:${userId}:exchange_accounts`,
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
      scope: EnforcementScope.USER,
      scopeId: userId,
      reason: reserveResult.reserved
        ? undefined
        : `Exchange account limit reached for user ${userId}: ${reserveResult.currentAfter}/${maximum}.`,
    };

    await this.audit.logLimitCheck(ctx, result, actor.userId);

    if (!reserveResult.reserved) {
      throw new PlanLimitExceededError({
        limitKey: LIMIT_KEY,
        currentUsage: reserveResult.currentAfter,
        configuredMaximum: maximum,
        remaining: 0,
        scope: EnforcementScope.USER,
        scopeId: userId,
      });
    }

    return result;
  }

  /**
   * Release a previously reserved exchange-account slot.
   */
  async release(actor: EnforcementActor, userId: string): Promise<void> {
    await this.counter.atomicDecrement({
      tenantId: actor.tenantId,
      limitKey: LIMIT_KEY,
      scopeId: `${actor.tenantId}:user:${userId}:exchange_accounts`,
    });
  }

  /**
   * Read-only check: can this user link another exchange account?
   */
  async canLink(actor: EnforcementActor, userId: string): Promise<QuotaCheckResult> {
    const ctx = await this.contextBuilder.build(actor, {
      type: 'exchange_account',
      ownerUserId: userId,
    });

    const maximum = ctx.tenant.planLimits.maxExchangeAccountsPerUser;

    if (maximum === null) {
      return {
        allowed: true,
        decision: EnforcementDecisionCode.ALLOWED,
        limitKey: LIMIT_KEY,
        currentUsage: 0,
        configuredMaximum: null,
        remaining: null,
        scope: EnforcementScope.USER,
        scopeId: userId,
      };
    }

    const currentUsage = await this.counter.read({
      tenantId: actor.tenantId,
      limitKey: LIMIT_KEY,
      scopeId: `${actor.tenantId}:user:${userId}:exchange_accounts`,
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
      scope: EnforcementScope.USER,
      scopeId: userId,
    };
  }
}
