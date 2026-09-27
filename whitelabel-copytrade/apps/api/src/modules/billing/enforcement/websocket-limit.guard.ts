import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

import { UsageService } from './usage.service';
import { EnforcementContextBuilder } from './enforcement.context';
import { EnforcementAuditService } from './enforcement.audit';
import {
  EnforcementDecisionCode,
  type EnforcementActor,
  type QuotaCheckResult,
} from './enforcement.types';
import { PlanLimitExceededError } from './enforcement.errors';

/**
 * Runtime enforcement for websocket connection limits.
 *
 * Enforces the `websocketConnections` plan limit at connection-open time.
 *
 * Flow:
 *   connection request → tenant context → current plan → websocket limit →
 *   current usage → reserve connection slot → allow/reject
 *
 * The reservation is released on:
 *   - disconnect
 *   - connection failure
 *   - server-side termination
 *
 * Concurrency: the reserve operation uses an atomic Lua script in Redis so
 * two simultaneous connection attempts cannot both succeed when only one slot
 * remains.
 */
@Injectable()
export class WebsocketLimitGuard {
  constructor(
    private readonly usageService: UsageService,
    private readonly contextBuilder: EnforcementContextBuilder,
    private readonly audit: EnforcementAuditService,
    @InjectPinoLogger(WebsocketLimitGuard.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Attempt to reserve a websocket connection slot for the tenant.
   *
   * Returns a `QuotaCheckResult` indicating whether the reservation succeeded.
   * When `allowed` is false, the caller must reject the connection.
   */
  async reserveConnection(actor: EnforcementActor): Promise<QuotaCheckResult> {
    const billingCtx = await this.contextBuilder.resolveBillingContext(actor.tenantId);
    const maximum = billingCtx.planLimits.websocketConnections;

    // Unlimited plan
    if (maximum === null) {
      return {
        allowed: true,
        decision: EnforcementDecisionCode.ALLOWED,
        limitKey: 'websocketConnections',
        currentUsage: 0,
        configuredMaximum: null,
        remaining: null,
        scope: 'TENANT' as any,
        scopeId: actor.tenantId,
      };
    }

    const reserveResult = await this.usageService.reserveWebsocketConnection(
      actor.tenantId,
      maximum,
    );

    const result: QuotaCheckResult = {
      allowed: reserveResult.reserved,
      decision: reserveResult.reserved
        ? EnforcementDecisionCode.ALLOWED
        : EnforcementDecisionCode.PLAN_LIMIT_EXCEEDED,
      limitKey: 'websocketConnections',
      currentUsage: reserveResult.currentAfter,
      configuredMaximum: maximum,
      remaining: reserveResult.remaining,
      scope: 'TENANT' as any,
      scopeId: actor.tenantId,
      reason: reserveResult.reserved
        ? undefined
        : `WebSocket connection limit reached: ${reserveResult.currentAfter}/${maximum}.`,
    };

    const enforcementCtx = { tenant: billingCtx, actor };
    await this.audit.logLimitCheck(enforcementCtx, result, actor.userId);

    if (!reserveResult.reserved) {
      throw new PlanLimitExceededError({
        limitKey: 'websocketConnections',
        currentUsage: reserveResult.currentAfter,
        configuredMaximum: maximum,
        remaining: 0,
        scope: 'TENANT' as any,
      });
    }

    return result;
  }

  /**
   * Release a previously reserved websocket connection slot.
   *
   * Must be called on disconnect, connection failure, or server-side
   * termination so the counter does not permanently leak.
   */
  async releaseConnection(tenantId: string): Promise<void> {
    await this.usageService.releaseWebsocketConnection(tenantId);
  }

  /**
   * Check whether the tenant can open another websocket connection without
   * reserving a slot.  Non-destructive: does not increment the counter.
   */
  async canConnect(actor: EnforcementActor): Promise<QuotaCheckResult> {
    const billingCtx = await this.contextBuilder.resolveBillingContext(actor.tenantId);
    const maximum = billingCtx.planLimits.websocketConnections;

    if (maximum === null) {
      return {
        allowed: true,
        decision: EnforcementDecisionCode.ALLOWED,
        limitKey: 'websocketConnections',
        currentUsage: 0,
        configuredMaximum: null,
        remaining: null,
        scope: 'TENANT' as any,
        scopeId: actor.tenantId,
      };
    }

    const usage = await this.usageService.getWebsocketUsage(actor.tenantId, maximum);
    const allowed = usage.current < maximum;

    return {
      allowed,
      decision: allowed
        ? EnforcementDecisionCode.ALLOWED
        : EnforcementDecisionCode.PLAN_LIMIT_EXCEEDED,
      limitKey: 'websocketConnections',
      currentUsage: usage.current,
      configuredMaximum: maximum,
      remaining: usage.remaining,
      scope: 'TENANT' as any,
      scopeId: actor.tenantId,
      reason: allowed
        ? undefined
        : `WebSocket connection limit reached: ${usage.current}/${maximum}.`,
    };
  }
}
