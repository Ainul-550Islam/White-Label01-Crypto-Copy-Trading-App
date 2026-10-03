import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { EnforcementContextBuilder } from '../enforcement/enforcement.context';
import { EnforcementService } from '../enforcement/enforcement.service';
import { EnforcementScope } from '../enforcement/enforcement.types';
import { SaasAdminAuditService } from './saas-admin-audit.service';
import type { SaasEntitlementSummary, SaasLimitSummary } from './saas-admin.types';

/**
 * Resolves effective tenant feature access from canonical entitlements,
 * feature flags, subscription state, and plan limits without creating
 * a second entitlement source.
 * All checks go through EnforcementService / EnforcementContextBuilder.
 */
@Injectable()
export class TenantFeatureAccessService {
  private readonly logger = new Logger(TenantFeatureAccessService.name);

  // Commercial features that must be plan-gated
  private readonly COMMERCIAL_FEATURES = ['customDomain', 'whiteLabelMobileApp', 'prioritySupport'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly contextBuilder: EnforcementContextBuilder,
    private readonly enforcementService: EnforcementService,
    private readonly auditService: SaasAdminAuditService,
  ) {}

  async getEffectiveFeatureAccess(tenantId: string, actorId?: string): Promise<SaasEntitlementSummary[]> {
    const billingContext = await this.contextBuilder.resolveBillingContext(tenantId);

    // Get feature flags for tenant
    let featureFlags: any[] = [];
    try {
      featureFlags = await (this.prisma as any).tenantFeatureFlag?.findMany({ where: { tenantId } }) ?? [];
    } catch {
      featureFlags = [];
    }

    // All feature keys from plan + flags + commercial
    const allFeatureKeys = new Set<string>([
      ...this.COMMERCIAL_FEATURES,
      ...(billingContext.planFeatures || []),
      ...featureFlags.map((f: any) => f.key),
    ]);

    // Also collect boolean limit keys as features
    const booleanLimitKeys = ['customDomain', 'whiteLabelMobileApp', 'prioritySupport'];
    for (const k of booleanLimitKeys) {
      if ((billingContext.planLimits as any)?.[k] !== undefined) {
        allFeatureKeys.add(k);
      }
    }

    const results: SaasEntitlementSummary[] = [];

    for (const featureKey of allFeatureKeys) {
      const access = await this.checkFeatureAccess(tenantId, featureKey);
      results.push(access);

      if (actorId) {
        await this.auditService.logFeatureAccessChecked(tenantId, actorId, featureKey, access.enabled, access.source).catch(() => {});
      }
    }

    return results;
  }

  async checkFeatureAccess(tenantId: string, featureKey: string): Promise<SaasEntitlementSummary> {
    const billingContext = await this.contextBuilder.resolveBillingContext(tenantId);

    if (!billingContext.subscriptionActive) {
      return {
        featureKey,
        enabled: false,
        source: 'none',
        planCode: billingContext.planCode,
        subscriptionStatus: billingContext.subscriptionStatus,
        reason: 'Subscription inactive',
      };
    }

    try {
      const enforcementCtx = await this.contextBuilder.build({ tenantId, userId: 'system' } as any);
      const result = await this.enforcementService.checkFeature(enforcementCtx, featureKey, { strict: false });

      if (result.allowed) {
        // Determine source
        let source: SaasEntitlementSummary['source'] = 'none';
        if ((billingContext.planFeatures || []).includes(featureKey)) {
          source = 'plan_features';
        } else if ((billingContext.planLimits as any)?.[featureKey] === true) {
          source = 'plan_limits_boolean';
        } else {
          // Check feature flag
          try {
            // The flag key lives on the related FeatureFlag, not on the tenant override row.
            const flag = await (this.prisma as any).tenantFeatureFlag?.findFirst({ where: { tenantId, featureFlag: { key: featureKey } } });
            if (flag?.enabled) source = 'feature_flag';
          } catch {}
        }

        return {
          featureKey,
          enabled: true,
          source,
          planCode: billingContext.planCode,
          subscriptionStatus: billingContext.subscriptionStatus,
          reason: null,
        };
      } else {
        return {
          featureKey,
          enabled: false,
          source: 'none',
          planCode: billingContext.planCode,
          subscriptionStatus: billingContext.subscriptionStatus,
          reason: result.reason || `Feature ${featureKey} not included in plan ${billingContext.planCode}`,
        };
      }
    } catch (error: any) {
      return {
        featureKey,
        enabled: false,
        source: 'none',
        planCode: billingContext.planCode,
        subscriptionStatus: billingContext.subscriptionStatus,
        reason: error.message || 'Feature check failed',
      };
    }
  }

  async getEffectiveLimits(tenantId: string): Promise<SaasLimitSummary[]> {
    const billingContext = await this.contextBuilder.resolveBillingContext(tenantId);

    const limitKeys = [
      'maxUsers',
      'maxTraders',
      'maxFollowersPerTrader',
      'maxExchangeAccountsPerUser',
      'maxCopySubscriptionsPerFollower',
      'maxApiRequestsPerMinute',
      'websocketConnections',
    ];

    const results: SaasLimitSummary[] = [];

    for (const limitKey of limitKeys) {
      const configuredLimit = (billingContext.planLimits as any)?.[limitKey] ?? null;
      const currentUsage = await this.getCurrentUsage(tenantId, limitKey);
      const unlimited = configuredLimit === null || configuredLimit === undefined;
      const remaining = unlimited ? null : Math.max(0, (configuredLimit as number) - currentUsage);
      const percentageUsed = unlimited || configuredLimit === 0 ? null : Math.min(100, Math.round((currentUsage / (configuredLimit as number)) * 100));

      results.push({
        limitKey,
        configuredLimit,
        currentUsage,
        remaining,
        unlimited,
        percentageUsed,
        source: configuredLimit !== null ? 'plan_limits' : 'none',
      });
    }

    return results;
  }

  async checkLimitAccess(tenantId: string, limitKey: string, requestedAmount = 1): Promise<{ allowed: boolean; limit: number | null; current: number; remaining: number | null; reason?: string }> {
    try {
      const billingContext = await this.contextBuilder.resolveBillingContext(tenantId);
      const configuredLimit = (billingContext.planLimits as any)?.[limitKey] ?? null;

      if (configuredLimit === null) {
        return { allowed: true, limit: null, current: 0, remaining: null };
      }

      const currentUsage = await this.getCurrentUsage(tenantId, limitKey);
      const allowed = currentUsage + requestedAmount <= configuredLimit;
      const remaining = Math.max(0, configuredLimit - currentUsage);

      return {
        allowed,
        limit: configuredLimit,
        current: currentUsage,
        remaining,
        reason: allowed ? undefined : `Limit ${limitKey} exceeded: ${currentUsage}/${configuredLimit}`,
      };
    } catch (error: any) {
      return { allowed: false, limit: null, current: 0, remaining: null, reason: error.message };
    }
  }

  async isFeatureAllowed(tenantId: string, featureKey: string): Promise<boolean> {
    const access = await this.checkFeatureAccess(tenantId, featureKey);
    return access.enabled;
  }

  private async getCurrentUsage(tenantId: string, limitKey: string): Promise<number> {
    switch (limitKey) {
      case 'maxUsers':
        return await this.prisma.user.count({ where: { tenantId, deletedAt: null } });
      case 'maxTraders':
        return await this.prisma.traderProfile.count({ where: { tenantId, deletedAt: null } });
      // The three "per X" limits are compared against the busiest X, not the
      // tenant-wide total: 10 traders with 5 followers each is 5 against a
      // maxFollowersPerTrader of 10, not 50.
      case 'maxFollowersPerTrader': {
        const perTrader = await this.prisma.copySubscription.groupBy({
          by: ['traderId'],
          where: { tenantId, state: 'ACTIVE' },
          _count: { _all: true },
        });
        return this.maxGroupCount(perTrader);
      }
      case 'maxExchangeAccountsPerUser': {
        const perUser = await this.prisma.tradingAccount.groupBy({
          by: ['userId'],
          where: { tenantId, deletedAt: null, userId: { not: null } },
          _count: { _all: true },
        });
        return this.maxGroupCount(perUser);
      }
      case 'maxCopySubscriptionsPerFollower': {
        const perFollower = await this.prisma.copySubscription.groupBy({
          by: ['followerId'],
          where: { tenantId, state: 'ACTIVE' },
          _count: { _all: true },
        });
        return this.maxGroupCount(perFollower);
      }
      default:
        return 0;
    }
  }

  /** Largest `_count._all` across groupBy rows; 0 for no rows. */
  private maxGroupCount(rows: ReadonlyArray<{ _count: { _all: number } }>): number {
    let max = 0;
    for (const row of rows) {
      if (row._count._all > max) {
        max = row._count._all;
      }
    }
    return max;
  }
}
