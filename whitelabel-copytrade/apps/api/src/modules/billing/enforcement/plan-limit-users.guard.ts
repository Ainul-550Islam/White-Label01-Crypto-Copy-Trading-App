import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { EnforcementContextBuilder } from './enforcement.context';
import { EnforcementAuditService } from './enforcement.audit';
import { UsageService } from './usage.service';
import { UsageCounter } from './usage.counter';
import {
  EnforcementDecisionCode,
  EnforcementScope,
  type EnforcementActor,
  type QuotaCheckResult,
} from './enforcement.types';
import { PlanLimitExceededError, SubscriptionInactiveError } from './enforcement.errors';

const LIMIT_KEY = 'maxUsers';
const SCOPE_ID_SUFFIX = 'users';

/**
 * User-limit enforcement integration.
 *
 * Enforces the `maxUsers` plan limit at the point of user creation.
 *
 * Flow:
 *   before user creation → resolve tenant billing context → resolve maxUsers →
 *   atomic reserve → allow OR reject → create user → finalize OR release
 *
 * The guard is called by the `UsersService` creation path.  It uses an atomic
 * Redis Lua script to prevent two concurrent user-creation requests from both
 * succeeding when only one slot remains.
 *
 * On failed user creation, `release()` must be called to return the reserved
 * slot.
 */
@Injectable()
export class PlanLimitUsersGuard {
  constructor(
    private readonly contextBuilder: EnforcementContextBuilder,
    private readonly usageService: UsageService,
    private readonly counter: UsageCounter,
    private readonly audit: EnforcementAuditService,
    @InjectPinoLogger(PlanLimitUsersGuard.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Attempt to reserve a user slot for the tenant.
   *
   * Returns a `QuotaCheckResult`; when `allowed` is false the caller must
   * reject the user creation request.
   */
  async reserve(actor: EnforcementActor): Promise<QuotaCheckResult> {
    const ctx = await this.contextBuilder.build(actor);

    if (!ctx.tenant.subscriptionActive) {
      const result: QuotaCheckResult = {
        allowed: false,
        decision: EnforcementDecisionCode.SUBSCRIPTION_INACTIVE,
        limitKey: LIMIT_KEY,
        currentUsage: 0,
        configuredMaximum: null,
        remaining: null,
        scope: EnforcementScope.TENANT,
        reason: 'An active subscription is required to create users.',
      };
      await this.audit.logLimitCheck(ctx, result, actor.userId);
      throw new SubscriptionInactiveError(ctx.tenant.subscriptionStatus, ctx.tenant.planCode);
    }

    const maximum = ctx.tenant.planLimits.maxUsers;

    // null means unlimited
    if (maximum === null) {
      const result: QuotaCheckResult = {
        allowed: true,
        decision: EnforcementDecisionCode.ALLOWED,
        limitKey: LIMIT_KEY,
        currentUsage: 0,
        configuredMaximum: null,
        remaining: null,
        scope: EnforcementScope.TENANT,
      };
      await this.audit.logLimitCheck(ctx, result, actor.userId);
      return result;
    }

    const reserveResult = await this.counter.atomicCheckAndIncrement({
      tenantId: actor.tenantId,
      limitKey: LIMIT_KEY,
      scopeId: `${actor.tenantId}:${SCOPE_ID_SUFFIX}`,
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
      scope: EnforcementScope.TENANT,
      reason: reserveResult.reserved
        ? undefined
        : `User limit reached: ${reserveResult.currentAfter}/${maximum}.`,
    };

    await this.audit.logLimitCheck(ctx, result, actor.userId);

    if (!reserveResult.reserved) {
      throw new PlanLimitExceededError({
        limitKey: LIMIT_KEY,
        currentUsage: reserveResult.currentAfter,
        configuredMaximum: maximum,
        remaining: 0,
        scope: EnforcementScope.TENANT,
      });
    }

    return result;
  }

  /**
   * Release a previously reserved user slot.
   *
   * Must be called when the user creation fails after the reservation was
   * granted, so the counter does not permanently leak.
   */
  async release(actor: EnforcementActor): Promise<void> {
    await this.counter.atomicDecrement({
      tenantId: actor.tenantId,
      limitKey: LIMIT_KEY,
      scopeId: `${actor.tenantId}:${SCOPE_ID_SUFFIX}`,
    });
  }

  /**
   * Read-only check: can the tenant add another user?
   *
   * Does not reserve a slot; use for UI hints and pre-flight checks.
   */
  async canCreate(actor: EnforcementActor): Promise<QuotaCheckResult> {
    const ctx = await this.contextBuilder.build(actor);
    const maximum = ctx.tenant.planLimits.maxUsers;

    if (maximum === null) {
      return {
        allowed: true,
        decision: EnforcementDecisionCode.ALLOWED,
        limitKey: LIMIT_KEY,
        currentUsage: 0,
        configuredMaximum: null,
        remaining: null,
        scope: EnforcementScope.TENANT,
      };
    }

    const currentUsage = await this.counter.read({
      tenantId: actor.tenantId,
      limitKey: LIMIT_KEY,
      scopeId: `${actor.tenantId}:${SCOPE_ID_SUFFIX}`,
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
      scope: EnforcementScope.TENANT,
    };
  }
}
