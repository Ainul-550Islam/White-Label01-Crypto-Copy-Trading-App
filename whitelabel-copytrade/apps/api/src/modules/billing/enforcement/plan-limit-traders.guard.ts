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

const LIMIT_KEY = 'maxTraders';
const SCOPE_ID_SUFFIX = 'traders';

/**
 * Trader-limit enforcement guard.
 *
 * Enforces the `maxTraders` plan limit at trader creation time.
 *
 * Flow:
 *   trader creation request → tenant billing context → maxTraders →
 *   atomic reserve → allow OR reject → create trader → finalize OR release
 *
 * Integration: the existing trader creation service calls `reserve()` before
 * persisting the new trader and `release()` if the persistence fails.
 */
@Injectable()
export class PlanLimitTradersGuard {
  constructor(
    private readonly contextBuilder: EnforcementContextBuilder,
    private readonly counter: UsageCounter,
    private readonly audit: EnforcementAuditService,
    @InjectPinoLogger(PlanLimitTradersGuard.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Attempt to reserve a trader slot for the tenant.
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
        reason: 'An active subscription is required to create traders.',
      };
      await this.audit.logLimitCheck(ctx, result, actor.userId);
      throw new SubscriptionInactiveError(ctx.tenant.subscriptionStatus, ctx.tenant.planCode);
    }

    const maximum = ctx.tenant.planLimits.maxTraders;

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
        : `Trader limit reached: ${reserveResult.currentAfter}/${maximum}.`,
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
   * Release a previously reserved trader slot.
   */
  async release(actor: EnforcementActor): Promise<void> {
    await this.counter.atomicDecrement({
      tenantId: actor.tenantId,
      limitKey: LIMIT_KEY,
      scopeId: `${actor.tenantId}:${SCOPE_ID_SUFFIX}`,
    });
  }

  /**
   * Read-only check: can the tenant add another trader?
   */
  async canCreate(actor: EnforcementActor): Promise<QuotaCheckResult> {
    const ctx = await this.contextBuilder.build(actor);
    const maximum = ctx.tenant.planLimits.maxTraders;

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
