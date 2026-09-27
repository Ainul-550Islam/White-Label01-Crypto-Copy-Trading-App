import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { PlanLimits, SubscriptionStatus } from '@wlct/shared-types';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CacheService } from '../../../infrastructure/redis/cache.service';
import {
  type EnforcementActor,
  type EnforcementContext,
  type EnforcementResource,
  type TenantBillingContext,
} from './enforcement.types';

const BILLING_CONTEXT_TTL_SECONDS = 30;

const EMPTY_LIMITS: PlanLimits = {
  maxUsers: null,
  maxTraders: null,
  maxFollowersPerTrader: null,
  maxExchangeAccountsPerUser: null,
  maxCopySubscriptionsPerFollower: null,
  maxApiRequestsPerMinute: null,
  websocketConnections: null,
  customDomain: false,
  whiteLabelMobileApp: false,
  prioritySupport: false,
};

/**
 * Builds the single normalised runtime billing context used by every
 * enforcement guard.  The context is cached briefly so that a single request
 * that triggers multiple checks (feature + limit + rate) does not pay for the
 * same database round-trip three times.
 */
@Injectable()
export class EnforcementContextBuilder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    @InjectPinoLogger(EnforcementContextBuilder.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Assemble the full enforcement context for an authenticated request.
   *
   * The actor's tenantId is always the source of truth; the resource is
   * optional because some checks (e.g. API rate limit) do not carry one.
   */
  async build(actor: EnforcementActor, resource?: EnforcementResource): Promise<EnforcementContext> {
    const tenant = await this.resolveBillingContext(actor.tenantId);
    return { tenant, actor, resource };
  }

  /**
   * Resolve billing context with a short-lived cache so repeated checks in the
   * same request do not each hit the database.
   */
  async resolveBillingContext(tenantId: string): Promise<TenantBillingContext> {
    const cacheKey = `enforcement:ctx:${tenantId}`;

    const cached = await this.cache.get<TenantBillingContext>(cacheKey);
    if (cached) {
      return cached;
    }

    const ctx = await this.fetchBillingContext(tenantId);
    await this.cache.set(cacheKey, ctx, BILLING_CONTEXT_TTL_SECONDS);
    return ctx;
  }

  private async fetchBillingContext(tenantId: string): Promise<TenantBillingContext> {
    const [tenant, subscription] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true },
      }),
      this.prisma.tenantSubscription.findFirst({
        where: { tenantId },
        include: { plan: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    if (!tenant) {
      this.logger.warn(
        { event: 'enforcement.tenant_not_found', tenantId },
        'Billing context requested for unknown tenant',
      );
      return this.emptyContext(tenantId);
    }

    if (!subscription) {
      this.logger.debug(
        { event: 'enforcement.no_subscription', tenantId },
        'Tenant has no subscription record',
      );
      return this.emptyContext(tenantId);
    }

    const planLimits = (subscription.plan.limits as unknown as PlanLimits) ?? EMPTY_LIMITS;
    const planFeatures = (subscription.plan.features as string[]) ?? [];
    // Prisma and @wlct/shared-types declare the same membership for
    // SubscriptionStatus (TRIALING/ACTIVE/PAST_DUE/CANCELED/EXPIRED/PAUSED);
    // normalise to the shared contract at the boundary.
    const status = subscription.status as SubscriptionStatus;
    const isActive = status === 'TRIALING' || status === 'ACTIVE';
    const isLifetime = subscription.plan.interval === 'LIFETIME';

    return {
      tenantId,
      subscriptionId: subscription.id,
      subscriptionStatus: status,
      planId: subscription.planId,
      planCode: subscription.plan.code,
      planLimits: { ...EMPTY_LIMITS, ...planLimits },
      planFeatures,
      subscriptionActive: isActive || isLifetime,
      isLifetime,
    };
  }

  private emptyContext(tenantId: string): TenantBillingContext {
    return {
      tenantId,
      subscriptionId: null,
      subscriptionStatus: null,
      planId: null,
      planCode: null,
      planLimits: { ...EMPTY_LIMITS },
      planFeatures: [],
      subscriptionActive: false,
      isLifetime: false,
    };
  }
}
