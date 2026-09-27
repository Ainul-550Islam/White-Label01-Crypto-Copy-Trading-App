/**
 * Entitlement Guard - Authorization guard for entitlements
 * 
 * This module provides guards and middleware for checking
 * entitlements before allowing access to protected resources.
 */

import { EntitlementService } from './entitlement.service';
import { EntitlementPolicy } from './entitlement.policy';
import { FeatureAccess, EntitlementCheckResult } from './entitlement.types';

export interface GuardContext {
  userId: string;
  tenantId: string;
  roles?: string[];
  permissions?: string[];
}

export interface GuardResult {
  allowed: boolean;
  reason?: string;
  featureAccess?: FeatureAccess;
  entitlementCheck?: EntitlementCheckResult;
}

export class EntitlementGuard {
  private readonly policy: EntitlementPolicy;

  constructor(private readonly service: EntitlementService) {
    this.policy = new EntitlementPolicy();
  }

  /**
   * Guard: Check if user has access to a feature
   */
  async hasFeatureAccess(
    featureKey: string,
    context: GuardContext
  ): Promise<GuardResult> {
    const featureAccess = await this.service.checkFeatureAccess(
      context.userId,
      context.tenantId,
      featureKey
    );

    return {
      allowed: featureAccess.allowed,
      reason: featureAccess.reason,
      featureAccess,
    };
  }

  /**
   * Guard: Check if user has access to a feature with limit
   */
  async hasFeatureAccessWithLimit(
    featureKey: string,
    limitKey: string,
    context: GuardContext,
    requestedAmount: number = 1
  ): Promise<GuardResult> {
    const entitlementCheck = await this.service.checkEntitlement(
      context.userId,
      context.tenantId,
      featureKey,
      limitKey,
      requestedAmount
    );

    return {
      allowed: entitlementCheck.allowed,
      reason: entitlementCheck.reason,
      entitlementCheck,
    };
  }

  /**
   * Guard: Check if user has active entitlement
   */
  async hasActiveEntitlement(context: GuardContext): Promise<GuardResult> {
    const isActive = await this.service.isEntitlementActive(
      context.userId,
      context.tenantId
    );

    return {
      allowed: isActive,
      reason: isActive ? undefined : 'No active entitlement',
    };
  }

  /**
   * Guard: Check multiple features (all must be accessible)
   */
  async hasAllFeatures(
    featureKeys: string[],
    context: GuardContext
  ): Promise<GuardResult> {
    for (const featureKey of featureKeys) {
      const result = await this.hasFeatureAccess(featureKey, context);
      if (!result.allowed) {
        return {
          allowed: false,
          reason: `Missing access to feature: ${featureKey}`,
          featureAccess: result.featureAccess,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Guard: Check multiple features (any one must be accessible)
   */
  async hasAnyFeature(
    featureKeys: string[],
    context: GuardContext
  ): Promise<GuardResult> {
    for (const featureKey of featureKeys) {
      const result = await this.hasFeatureAccess(featureKey, context);
      if (result.allowed) {
        return { allowed: true };
      }
    }

    return {
      allowed: false,
      reason: `No access to any of: ${featureKeys.join(', ')}`,
    };
  }

  /**
   * Guard: Check if user has a specific role
   */
  async hasRole(
    role: string,
    context: GuardContext
  ): Promise<GuardResult> {
    const hasRole = context.roles?.includes(role) ?? false;

    return {
      allowed: hasRole,
      reason: hasRole ? undefined : `Missing role: ${role}`,
    };
  }

  /**
   * Guard: Check if user has a specific permission
   */
  async hasPermission(
    permission: string,
    context: GuardContext
  ): Promise<GuardResult> {
    const hasPermission = context.permissions?.includes(permission) ?? false;

    return {
      allowed: hasPermission,
      reason: hasPermission ? undefined : `Missing permission: ${permission}`,
    };
  }

  /**
   * Guard: Check feature access and record usage
   */
  async checkAndRecordUsage(
    featureKey: string,
    context: GuardContext,
    amount: number = 1
  ): Promise<GuardResult> {
    // First check access
    const accessResult = await this.hasFeatureAccess(featureKey, context);
    if (!accessResult.allowed) {
      return accessResult;
    }

    // Then record usage
    try {
      await this.service.recordUsage(
        context.userId,
        context.tenantId,
        featureKey,
        amount
      );
      return { allowed: true };
    } catch (error) {
      return {
        allowed: false,
        reason: `Failed to record usage: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Guard: Check if user can perform an action based on limits
   */
  async canPerformAction(
    featureKey: string,
    limitKey: string,
    context: GuardContext,
    requestedAmount: number = 1
  ): Promise<GuardResult> {
    return this.hasFeatureAccessWithLimit(
      featureKey,
      limitKey,
      context,
      requestedAmount
    );
  }

  /**
   * Guard: Check if entitlement is near limits
   */
  async isNearLimits(
    context: GuardContext,
    thresholdPercentage: number = 80
  ): Promise<{ nearLimits: boolean; limits: string[] }> {
    const limits = await this.service.getLimitsNearThreshold(
      context.userId,
      context.tenantId,
      thresholdPercentage
    );

    return {
      nearLimits: limits.length > 0,
      limits: limits.map(l => l.key),
    };
  }

  /**
   * Guard: Check if user can upgrade plan
   */
  async canUpgradePlan(context: GuardContext): Promise<GuardResult> {
    // Check if user has active entitlement
    const hasActive = await this.hasActiveEntitlement(context);
    if (!hasActive.allowed) {
      return {
        allowed: false,
        reason: 'No active entitlement to upgrade',
      };
    }

    // Additional upgrade logic can be added here
    return { allowed: true };
  }

  /**
   * Guard: Check if user can downgrade plan
   */
  async canDowngradePlan(context: GuardContext): Promise<GuardResult> {
    // Check if user has active entitlement
    const hasActive = await this.hasActiveEntitlement(context);
    if (!hasActive.allowed) {
      return {
        allowed: false,
        reason: 'No active entitlement to downgrade',
      };
    }

    // Check if downgrade would violate current usage
    const limits = await this.service.getLimitsNearThreshold(
      context.userId,
      context.tenantId,
      0 // Any usage at all
    );

    if (limits.length > 0) {
      return {
        allowed: false,
        reason: 'Cannot downgrade: current usage exceeds lower plan limits',
      };
    }

    return { allowed: true };
  }
}