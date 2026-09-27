import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { EnforcementService } from './enforcement.service';
import { EnforcementContextBuilder } from './enforcement.context';
import {
  EnforcementScope,
  type EnforcementActor,
  type EnforcementResource,
  type QuotaCheckResult,
} from './enforcement.types';

/**
 * Generic numeric quota guard.
 *
 * Supports every commercial limit key in `PlanLimits`:
 *   maxUsers, maxTraders, maxFollowersPerTrader,
 *   maxExchangeAccountsPerUser, maxCopySubscriptionsPerFollower,
 *   maxApiRequestsPerMinute, websocketConnections
 *
 * The guard does NOT hardcode numeric values; it resolves the configured plan
 * limit dynamically from the tenant's active subscription.
 *
 * Usage:
 *
 *   const result = await this.limitGuard.check(
 *     actor,
 *     'maxUsers',
 *     currentUserCount,
 *     EnforcementScope.TENANT,
 *   );
 *   if (!result.allowed) { … }
 */
@Injectable()
export class EnforcementLimitGuard {
  constructor(
    private readonly enforcement: EnforcementService,
    private readonly contextBuilder: EnforcementContextBuilder,
    @InjectPinoLogger(EnforcementLimitGuard.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Perform a quota check for a numeric plan limit.
   *
   * @param actor       The authenticated caller.
   * @param limitKey    The plan-limit key (e.g. 'maxUsers').
   * @param currentUsage The current count of consumed units.
   * @param scope       The scope at which the limit is evaluated.
   * @param options     Optional scopeId and strict mode.
   */
  async check(
    actor: EnforcementActor,
    limitKey: string,
    currentUsage: number,
    scope: EnforcementScope,
    options: { scopeId?: string; strict?: boolean } = {},
  ): Promise<QuotaCheckResult> {
    const ctx = await this.contextBuilder.build(actor);
    return this.enforcement.checkLimit(ctx, limitKey, currentUsage, scope, {
      scopeId: options.scopeId,
      strict: options.strict,
      actorId: actor.userId,
    });
  }

  /**
   * Require the quota to be available or throw `PlanLimitExceededError`.
   *
   * Use this in code paths where the caller must abort if the limit is reached.
   */
  async require(
    actor: EnforcementActor,
    limitKey: string,
    currentUsage: number,
    scope: EnforcementScope,
    options: { scopeId?: string } = {},
  ): Promise<QuotaCheckResult> {
    const ctx = await this.contextBuilder.build(actor);
    return this.enforcement.checkLimit(ctx, limitKey, currentUsage, scope, {
      scopeId: options.scopeId,
      strict: true,
      actorId: actor.userId,
    });
  }

  /**
   * Resolve the configured maximum for a limit key, returning null for
   * unlimited plans.
   */
  async resolveMaximum(
    actor: EnforcementActor,
    limitKey: string,
  ): Promise<number | null> {
    const ctx = await this.contextBuilder.build(actor);
    const key = limitKey as keyof typeof ctx.tenant.planLimits;
    const value = ctx.tenant.planLimits[key];
    if (value === undefined || value === null || typeof value === 'boolean') {
      return null;
    }
    return value as number;
  }

  /**
   * Calculate remaining capacity for a limit key.
   *
   * Returns null when the limit is unlimited.
   */
  async remaining(
    actor: EnforcementActor,
    limitKey: string,
    currentUsage: number,
  ): Promise<number | null> {
    const maximum = await this.resolveMaximum(actor, limitKey);
    if (maximum === null) {
      return null;
    }
    return Math.max(0, maximum - currentUsage);
  }
}
