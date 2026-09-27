import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions.service';
import { EnforcementService } from '../enforcement/enforcement.service';
import { EnforcementContextBuilder } from '../enforcement/enforcement.context';
import { EnforcementScope } from '../enforcement/enforcement.types';
import type { PortalUsageSummary, PortalUsageItem, PortalFeatureAvailability } from './billing-portal.types';
import { BillingInterval } from '@wlct/shared-types';

/**
 * Customer-visible usage summary.
 * Resolves canonical limits and actual usage for display.
 * Data must come from existing enforcement/plan-limit system, never duplicated.
 */
@Injectable()
export class BillingUsageSummaryService {
  private readonly logger = new Logger(BillingUsageSummaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly enforcementService: EnforcementService,
    private readonly contextBuilder: EnforcementContextBuilder,
  ) {}

  async getUsageSummary(tenantId: string): Promise<PortalUsageSummary> {
    const subscription = await this.subscriptionsService.getCurrent(tenantId);
    const limits = subscription?.plan?.limits || await this.subscriptionsService.getLimits(tenantId);

    // Resolve actual usage counts from canonical sources
    const [usersCount, tradersCount, followersCount, exchangeAccountsCount, copySubsCount] = await Promise.all([
      this.countUsers(tenantId),
      this.countTraders(tenantId),
      this.countFollowers(tenantId),
      this.countExchangeAccounts(tenantId),
      this.countCopySubscriptions(tenantId),
    ]);

    // Build enforcement context for feature checks (uses canonical plan limits)
    let enforcementContext: any = null;
    try {
      enforcementContext = await this.contextBuilder.build({ tenantId, userId: 'system' } as any);
    } catch {
      // Fallback if context builder fails
    }

    const limitDefinitions: Array<{ key: string; label: string; current: number; scope: EnforcementScope }> = [
      { key: 'maxUsers', label: 'Users', current: usersCount, scope: EnforcementScope.TENANT },
      { key: 'maxTraders', label: 'Traders', current: tradersCount, scope: EnforcementScope.TENANT },
      { key: 'maxFollowersPerTrader', label: 'Followers per Trader', current: followersCount, scope: EnforcementScope.TENANT },
      { key: 'maxExchangeAccountsPerUser', label: 'Exchange Accounts per User', current: exchangeAccountsCount, scope: EnforcementScope.USER },
      { key: 'maxCopySubscriptionsPerFollower', label: 'Copy Subscriptions per Follower', current: copySubsCount, scope: EnforcementScope.USER },
      { key: 'maxApiRequestsPerMinute', label: 'API Requests per Minute', current: 0, scope: EnforcementScope.TENANT },
      { key: 'websocketConnections', label: 'WebSocket Connections', current: 0, scope: EnforcementScope.TENANT },
    ];

    const items: PortalUsageItem[] = limitDefinitions.map((def) => {
      const limitValue = (limits as any)?.[def.key] ?? null;
      const unlimited = limitValue === null || limitValue === undefined;
      const remaining = unlimited ? null : Math.max(0, (limitValue as number) - def.current);
      const percentageUsed = unlimited || limitValue === 0 ? null : Math.min(100, Math.round((def.current / (limitValue as number)) * 100));

      return {
        key: def.key,
        label: def.label,
        current: def.current,
        limit: limitValue,
        remaining,
        unlimited,
        percentageUsed,
        scope: def.scope,
      };
    });

    // Feature availability from canonical plan
    const featureKeys = ['customDomain', 'whiteLabelMobileApp', 'prioritySupport'];
    const features: PortalFeatureAvailability[] = featureKeys.map((key) => {
      const fromLimits = (limits as any)?.[key] === true;
      const fromFeaturesArray = (subscription?.plan?.features || []).includes(key);
      const included = fromLimits || fromFeaturesArray;

      return {
        key,
        label: this.featureLabel(key),
        included,
        source: fromFeaturesArray ? 'features_array' : fromLimits ? 'limits_boolean' : 'none',
      };
    });

    // Add additional features from plan features array
    const additionalFeatures = (subscription?.plan?.features || []).filter((f: string) => !featureKeys.includes(f));
    for (const fKey of additionalFeatures) {
      features.push({
        key: fKey,
        label: this.featureLabel(fKey),
        included: true,
        source: 'features_array',
      });
    }

    return {
      tenantId,
      items,
      features,
      fetchedAt: new Date().toISOString(),
    };
  }

  private async countUsers(tenantId: string): Promise<number> {
    try {
      return await this.prisma.user.count({ where: { tenantId, deletedAt: null } });
    } catch {
      return 0;
    }
  }

  private async countTraders(tenantId: string): Promise<number> {
    try {
      const result = await (this.prisma as any).trader?.count({ where: { tenantId, deletedAt: null } });
      return result ?? 0;
    } catch {
      try {
        const result = await (this.prisma as any).user.count({ where: { tenantId, role: 'TRADER', deletedAt: null } });
        return result ?? 0;
      } catch {
        return 0;
      }
    }
  }

  private async countFollowers(tenantId: string): Promise<number> {
    try {
      const result = await (this.prisma as any).follower?.count({ where: { tenantId, deletedAt: null } });
      return result ?? 0;
    } catch {
      try {
        const result = await (this.prisma as any).copySubscription?.count({ where: { tenantId } });
        return result ?? 0;
      } catch {
        return 0;
      }
    }
  }

  private async countExchangeAccounts(tenantId: string): Promise<number> {
    try {
      const result = await (this.prisma as any).exchangeAccount?.count({ where: { tenantId, deletedAt: null } });
      return result ?? 0;
    } catch {
      return 0;
    }
  }

  private async countCopySubscriptions(tenantId: string): Promise<number> {
    try {
      const result = await (this.prisma as any).copySubscription?.count({ where: { tenantId } });
      return result ?? 0;
    } catch {
      return 0;
    }
  }

  private featureLabel(key: string): string {
    const labels: Record<string, string> = {
      customDomain: 'Custom Domain',
      whiteLabelMobileApp: 'White-Label Mobile App',
      prioritySupport: 'Priority Support',
      copyTrading: 'Copy Trading',
      apiAccess: 'API Access',
      webhooks: 'Webhooks',
      advancedAnalytics: 'Advanced Analytics',
      riskManagement: 'Risk Management',
      multiExchange: 'Multi-Exchange Support',
    };
    return labels[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
  }
}
