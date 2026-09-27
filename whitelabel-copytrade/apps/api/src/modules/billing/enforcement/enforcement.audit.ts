import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditAction, AuditActorType, AuditOutcome } from '@wlct/shared-types';

import { AuditService } from '../../audit/audit.service';
import {
  type EnforcementContext,
  type FeatureCheckResult,
  type QuotaCheckResult,
} from './enforcement.types';

/**
 * Structured audit support for enforcement activity.
 *
 * Every significant allow/reject enforcement decision is logged through the
 * existing audit infrastructure.  No credentials, API keys, private keys,
 * or tokens are ever included in audit payloads.
 */

export const EnforcementAuditAction = {
  USER_LIMIT_CHECKED: 'USER_LIMIT_CHECKED',
  USER_LIMIT_REJECTED: 'USER_LIMIT_REJECTED',
  TRADER_LIMIT_CHECKED: 'TRADER_LIMIT_CHECKED',
  TRADER_LIMIT_REJECTED: 'TRADER_LIMIT_REJECTED',
  FOLLOWER_LIMIT_CHECKED: 'FOLLOWER_LIMIT_CHECKED',
  FOLLOWER_LIMIT_REJECTED: 'FOLLOWER_LIMIT_REJECTED',
  EXCHANGE_ACCOUNT_LIMIT_CHECKED: 'EXCHANGE_ACCOUNT_LIMIT_CHECKED',
  EXCHANGE_ACCOUNT_LIMIT_REJECTED: 'EXCHANGE_ACCOUNT_LIMIT_REJECTED',
  COPY_SUBSCRIPTION_LIMIT_CHECKED: 'COPY_SUBSCRIPTION_LIMIT_CHECKED',
  COPY_SUBSCRIPTION_LIMIT_REJECTED: 'COPY_SUBSCRIPTION_LIMIT_REJECTED',
  FEATURE_CHECKED: 'FEATURE_CHECKED',
  FEATURE_REJECTED: 'FEATURE_REJECTED',
  API_RATE_LIMIT_CHECKED: 'API_RATE_LIMIT_CHECKED',
  API_RATE_LIMIT_REJECTED: 'API_RATE_LIMIT_REJECTED',
  WEBSOCKET_LIMIT_CHECKED: 'WEBSOCKET_LIMIT_CHECKED',
  WEBSOCKET_LIMIT_REJECTED: 'WEBSOCKET_LIMIT_REJECTED',
} as const;

/** Map limit keys to their paired checked/rejected audit actions. */
const LIMIT_AUDIT_ACTIONS: Record<string, { checked: string; rejected: string }> = {
  maxUsers: {
    checked: EnforcementAuditAction.USER_LIMIT_CHECKED,
    rejected: EnforcementAuditAction.USER_LIMIT_REJECTED,
  },
  maxTraders: {
    checked: EnforcementAuditAction.TRADER_LIMIT_CHECKED,
    rejected: EnforcementAuditAction.TRADER_LIMIT_REJECTED,
  },
  maxFollowersPerTrader: {
    checked: EnforcementAuditAction.FOLLOWER_LIMIT_CHECKED,
    rejected: EnforcementAuditAction.FOLLOWER_LIMIT_REJECTED,
  },
  maxExchangeAccountsPerUser: {
    checked: EnforcementAuditAction.EXCHANGE_ACCOUNT_LIMIT_CHECKED,
    rejected: EnforcementAuditAction.EXCHANGE_ACCOUNT_LIMIT_REJECTED,
  },
  maxCopySubscriptionsPerFollower: {
    checked: EnforcementAuditAction.COPY_SUBSCRIPTION_LIMIT_CHECKED,
    rejected: EnforcementAuditAction.COPY_SUBSCRIPTION_LIMIT_REJECTED,
  },
  maxApiRequestsPerMinute: {
    checked: EnforcementAuditAction.API_RATE_LIMIT_CHECKED,
    rejected: EnforcementAuditAction.API_RATE_LIMIT_REJECTED,
  },
  websocketConnections: {
    checked: EnforcementAuditAction.WEBSOCKET_LIMIT_CHECKED,
    rejected: EnforcementAuditAction.WEBSOCKET_LIMIT_REJECTED,
  },
};

@Injectable()
export class EnforcementAuditService {
  constructor(
    private readonly audit: AuditService,
    @InjectPinoLogger(EnforcementAuditService.name) private readonly logger: PinoLogger,
  ) {}

  async logFeatureCheck(
    ctx: EnforcementContext,
    result: FeatureCheckResult,
    actorId?: string,
  ): Promise<void> {
    const action = result.allowed
      ? EnforcementAuditAction.FEATURE_CHECKED
      : EnforcementAuditAction.FEATURE_REJECTED;

    await this.audit.record({
      tenantId: ctx.tenant.tenantId,
      actorType: AuditActorType.USER,
      actorId: actorId ?? ctx.actor.userId,
      action: action as AuditAction,
      outcome: result.allowed ? AuditOutcome.SUCCESS : AuditOutcome.DENIED,
      resourceType: 'enforcement',
      resourceId: ctx.tenant.subscriptionId,
      description: result.allowed
        ? `Feature '${result.featureKey}' allowed`
        : `Feature '${result.featureKey}' denied: ${result.reason}`,
      metadata: {
        featureKey: result.featureKey,
        decision: result.decision,
        planCode: ctx.tenant.planCode,
      },
      ipHash: ctx.actor.ipHash,
      requestId: ctx.actor.requestId,
    });
  }

  async logLimitCheck(
    ctx: EnforcementContext,
    result: QuotaCheckResult,
    actorId?: string,
  ): Promise<void> {
    const actions = LIMIT_AUDIT_ACTIONS[result.limitKey];
    const action = result.allowed
      ? actions?.checked ?? 'ENFORCEMENT_LIMIT_CHECKED'
      : actions?.rejected ?? 'ENFORCEMENT_LIMIT_REJECTED';

    await this.audit.record({
      tenantId: ctx.tenant.tenantId,
      actorType: AuditActorType.USER,
      actorId: actorId ?? ctx.actor.userId,
      action: action as AuditAction,
      outcome: result.allowed ? AuditOutcome.SUCCESS : AuditOutcome.DENIED,
      resourceType: 'enforcement',
      resourceId: ctx.tenant.subscriptionId,
      description: result.allowed
        ? `Limit '${result.limitKey}' check passed (${result.currentUsage}/${result.configuredMaximum ?? 'unlimited'})`
        : `Limit '${result.limitKey}' exceeded (${result.currentUsage}/${result.configuredMaximum})`,
      metadata: {
        limitKey: result.limitKey,
        decision: result.decision,
        currentUsage: result.currentUsage,
        configuredMaximum: result.configuredMaximum,
        remaining: result.remaining,
        scope: result.scope,
        scopeId: result.scopeId,
        planCode: ctx.tenant.planCode,
      },
      ipHash: ctx.actor.ipHash,
      requestId: ctx.actor.requestId,
    });
  }

  async logRateLimitCheck(
    ctx: EnforcementContext,
    result: QuotaCheckResult,
    actorId?: string,
  ): Promise<void> {
    const action = result.allowed
      ? EnforcementAuditAction.API_RATE_LIMIT_CHECKED
      : EnforcementAuditAction.API_RATE_LIMIT_REJECTED;

    await this.audit.record({
      tenantId: ctx.tenant.tenantId,
      actorType: AuditActorType.USER,
      actorId: actorId ?? ctx.actor.userId,
      action: action as AuditAction,
      outcome: result.allowed ? AuditOutcome.SUCCESS : AuditOutcome.DENIED,
      resourceType: 'enforcement',
      resourceId: ctx.tenant.subscriptionId,
      description: result.allowed
        ? `Rate limit '${result.limitKey}' check passed (${result.currentUsage}/${result.configuredMaximum ?? 'unlimited'})`
        : `Rate limit '${result.limitKey}' exceeded (${result.currentUsage}/${result.configuredMaximum})`,
      metadata: {
        limitKey: result.limitKey,
        decision: result.decision,
        currentUsage: result.currentUsage,
        configuredMaximum: result.configuredMaximum,
        remaining: result.remaining,
        retryAfterSeconds: result.retryAfterSeconds,
        windowStart: result.windowStart,
        windowEnd: result.windowEnd,
        planCode: ctx.tenant.planCode,
      },
      ipHash: ctx.actor.ipHash,
      requestId: ctx.actor.requestId,
    });
  }
}
