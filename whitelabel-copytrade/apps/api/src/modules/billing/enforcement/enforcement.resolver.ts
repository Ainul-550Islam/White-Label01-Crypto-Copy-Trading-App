import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { SubscriptionStatus, type PlanLimits } from '@wlct/shared-types';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CacheService } from '../../../infrastructure/redis/cache.service';
import { NotFoundException } from '../../../common/errors/app.exception';

const RESOLVER_CACHE_TTL = 30;

/**
 * Resolves the effective runtime billing state for a tenant.
 *
 * This resolver is the one place that translates the raw database rows into
 * the normalised shapes the enforcement guards consume.  It handles every
 * subscription state the system already supports:
 *
 *   - TRIALING  → active (plan limits apply)
 *   - ACTIVE    → active
 *   - PAST_DUE  → inactive (grace expired)
 *   - CANCELED  → inactive
 *   - EXPIRED   → inactive
 *   - LIFETIME  → active (never expires)
 *   - missing   → inactive
 */
@Injectable()
export class EnforcementResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    @InjectPinoLogger(EnforcementResolver.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Resolve the current plan limits for a tenant.
   *
   * Returns `null` when no active subscription exists, which callers must
   * treat as "no plan — deny creation actions".
   */
  async resolvePlanLimits(tenantId: string): Promise<PlanLimits | null> {
    const cacheKey = `enforcement:limits:${tenantId}`;

    const cached = await this.cache.get<PlanLimits | null>(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const limits = await this.fetchPlanLimits(tenantId);
    await this.cache.set(cacheKey, limits, RESOLVER_CACHE_TTL);
    return limits;
  }

  /**
   * Resolve the current plan features for a tenant.
   *
   * Returns an empty array when no active subscription exists.
   */
  async resolvePlanFeatures(tenantId: string): Promise<string[]> {
    const cacheKey = `enforcement:features:${tenantId}`;

    const cached = await this.cache.get<string[]>(cacheKey);
    if (cached !== undefined && cached !== null) {
      return cached;
    }

    const features = await this.fetchPlanFeatures(tenantId);
    await this.cache.set(cacheKey, features, RESOLVER_CACHE_TTL);
    return features;
  }

  /**
   * Determine whether the tenant's subscription is in a state that permits
   * creation / modification actions.
   */
  async isSubscriptionActive(tenantId: string): Promise<boolean> {
    const subscription = await this.prisma.tenantSubscription.findFirst({
      where: { tenantId },
      select: { status: true, plan: { select: { interval: true } } },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription) {
      return false;
    }

    if (subscription.status === SubscriptionStatus.ACTIVE || subscription.status === SubscriptionStatus.TRIALING) {
      return true;
    }

    if (subscription.plan.interval === 'LIFETIME') {
      return true;
    }

    return false;
  }

  /**
   * Resolve the subscription status string, or null when the tenant has no
   * subscription record at all.
   */
  async resolveSubscriptionStatus(tenantId: string): Promise<string | null> {
    const subscription = await this.prisma.tenantSubscription.findFirst({
      where: { tenantId },
      select: { status: true },
      orderBy: { createdAt: 'desc' },
    });

    return subscription?.status ?? null;
  }

  /**
   * Resolve the plan code for the tenant's current subscription.
   */
  async resolvePlanCode(tenantId: string): Promise<string | null> {
    const subscription = await this.prisma.tenantSubscription.findFirst({
      where: { tenantId },
      select: { plan: { select: { code: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return subscription?.plan?.code ?? null;
  }

  /**
   * Invalidate cached billing context for a tenant.
   *
   * Called after subscription changes (assign, upgrade, cancel) so the next
   * enforcement check sees the new state immediately.
   */
  async invalidateCache(tenantId: string): Promise<void> {
    await this.cache.delete(
      `enforcement:ctx:${tenantId}`,
      `enforcement:limits:${tenantId}`,
      `enforcement:features:${tenantId}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async fetchPlanLimits(tenantId: string): Promise<PlanLimits | null> {
    const subscription = await this.prisma.tenantSubscription.findFirst({
      where: { tenantId },
      include: { plan: { select: { limits: true, interval: true } } },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription) {
      return null;
    }

    // Lifetime plans are always active regardless of the subscription status
    // column; other plans require ACTIVE or TRIALING.
    const isLifetime = subscription.plan.interval === 'LIFETIME';
    const isActive =
      subscription.status === SubscriptionStatus.ACTIVE ||
      subscription.status === SubscriptionStatus.TRIALING;

    if (!isActive && !isLifetime) {
      return null;
    }

    return (subscription.plan.limits as unknown as PlanLimits) ?? null;
  }

  private async fetchPlanFeatures(tenantId: string): Promise<string[]> {
    const subscription = await this.prisma.tenantSubscription.findFirst({
      where: { tenantId },
      include: { plan: { select: { features: true, interval: true } } },
      orderBy: { createdAt: 'desc' },
    });

    if (!subscription) {
      return [];
    }

    const isLifetime = subscription.plan.interval === 'LIFETIME';
    const isActive =
      subscription.status === SubscriptionStatus.ACTIVE ||
      subscription.status === SubscriptionStatus.TRIALING;

    if (!isActive && !isLifetime) {
      return [];
    }

    return (subscription.plan.features as string[]) ?? [];
  }
}
