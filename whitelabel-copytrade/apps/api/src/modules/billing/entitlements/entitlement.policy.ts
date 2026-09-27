/**
 * Entitlement Policy - Business rules for entitlements
 * 
 * This module defines the policies and rules for how entitlements
 * are granted, checked, and enforced.
 */

import {
  Entitlement,
  EntitlementFeature,
  EntitlementLimit,
  FeatureAccess,
  EntitlementCheckResult,
  EntitlementStatus,
} from './entitlement.types';

export interface EntitlementPolicyConfig {
  allowTrialFeatures: boolean;
  allowGracePeriod: boolean;
  gracePeriodDays: number;
  enforceHardLimits: boolean;
  allowLimitBurst: boolean;
  burstPercentage: number;
}

export const DEFAULT_POLICY_CONFIG: EntitlementPolicyConfig = {
  allowTrialFeatures: true,
  allowGracePeriod: true,
  gracePeriodDays: 7,
  enforceHardLimits: true,
  allowLimitBurst: false,
  burstPercentage: 10,
};

export class EntitlementPolicy {
  private readonly config: EntitlementPolicyConfig;

  constructor(config: Partial<EntitlementPolicyConfig> = {}) {
    this.config = { ...DEFAULT_POLICY_CONFIG, ...config };
  }

  /**
   * Check if an entitlement is currently active
   */
  isEntitlementActive(entitlement: Entitlement): boolean {
    if (entitlement.status !== EntitlementStatus.ACTIVE) {
      return false;
    }

    const now = new Date();

    // Check if entitlement has started
    if (entitlement.startsAt > now) {
      return false;
    }

    // Check if entitlement has expired
    if (entitlement.expiresAt && entitlement.expiresAt < now) {
      // Check grace period
      if (this.config.allowGracePeriod) {
        const gracePeriodEnd = new Date(entitlement.expiresAt);
        gracePeriodEnd.setDate(gracePeriodEnd.getDate() + this.config.gracePeriodDays);
        return now <= gracePeriodEnd;
      }
      return false;
    }

    return true;
  }

  /**
   * Check if a feature is enabled for an entitlement
   */
  isFeatureEnabled(entitlement: Entitlement, featureKey: string): boolean {
    if (!this.isEntitlementActive(entitlement)) {
      return false;
    }

    const feature = entitlement.features.find(f => f.key === featureKey);
    if (!feature) {
      return false;
    }

    // Check if feature is explicitly enabled
    if (!feature.enabled) {
      return false;
    }

    // Check if feature has expired
    if (feature.expiresAt && feature.expiresAt < new Date()) {
      return false;
    }

    return true;
  }

  /**
   * Check if a limit allows additional usage
   */
  checkLimit(
    entitlement: Entitlement,
    limitKey: string,
    requestedAmount: number = 1
  ): { allowed: boolean; remaining: number; limit?: EntitlementLimit } {
    const limit = entitlement.limits.find(l => l.key === limitKey);

    if (!limit) {
      // No limit defined means unlimited
      return { allowed: true, remaining: -1 };
    }

    // Check if limit has reset
    if (limit.resetAt && limit.resetAt <= new Date()) {
      // Limit has reset, allow usage
      return { allowed: true, remaining: limit.value - requestedAmount, limit };
    }

    // -1 means unlimited
    if (limit.value === -1) {
      return { allowed: true, remaining: -1, limit };
    }

    const remaining = limit.value - limit.used;

    // Check hard limits
    if (this.config.enforceHardLimits && limit.hardLimit) {
      const allowed = remaining >= requestedAmount;
      
      // Check burst allowance
      if (!allowed && this.config.allowLimitBurst) {
        const burstLimit = limit.value * (1 + this.config.burstPercentage / 100);
        const burstAllowed = (limit.used + requestedAmount) <= burstLimit;
        return {
          allowed: burstAllowed,
          remaining: burstAllowed ? remaining - requestedAmount : 0,
          limit,
        };
      }

      return { allowed, remaining: allowed ? remaining - requestedAmount : 0, limit };
    }

    // Soft limits always allow but track usage
    return { allowed: true, remaining: Math.max(0, remaining - requestedAmount), limit };
  }

  /**
   * Comprehensive feature access check
   */
  checkFeatureAccess(
    entitlement: Entitlement | null,
    featureKey: string,
    requestedAmount: number = 1
  ): FeatureAccess {
    if (!entitlement) {
      return {
        featureKey,
        allowed: false,
        reason: 'No entitlement found',
      };
    }

    if (!this.isEntitlementActive(entitlement)) {
      return {
        featureKey,
        allowed: false,
        reason: 'Entitlement is not active',
      };
    }

    const feature = entitlement.features.find(f => f.key === featureKey);
    if (!feature || !feature.enabled) {
      return {
        featureKey,
        allowed: false,
        reason: 'Feature not enabled',
      };
    }

    // Check feature limit if applicable
    if (feature.limit !== undefined && feature.used !== undefined) {
      const remaining = feature.limit - feature.used;
      if (remaining < requestedAmount) {
        return {
          featureKey,
          allowed: false,
          reason: 'Feature limit exceeded',
          limit: feature.limit,
          used: feature.used,
          remaining: 0,
        };
      }

      return {
        featureKey,
        allowed: true,
        limit: feature.limit,
        used: feature.used,
        remaining: remaining - requestedAmount,
      };
    }

    return {
      featureKey,
      allowed: true,
    };
  }

  /**
   * Get comprehensive entitlement check result
   */
  checkEntitlement(
    entitlement: Entitlement | null,
    featureKey: string,
    limitKey?: string,
    requestedAmount: number = 1
  ): EntitlementCheckResult {
    if (!entitlement) {
      return {
        allowed: false,
        entitlement: null,
        reason: 'No entitlement found',
      };
    }

    if (!this.isEntitlementActive(entitlement)) {
      return {
        allowed: false,
        entitlement,
        reason: 'Entitlement is not active',
      };
    }

    // Check feature
    const feature = entitlement.features.find(f => f.key === featureKey);
    if (!feature || !feature.enabled) {
      return {
        allowed: false,
        entitlement,
        feature,
        reason: 'Feature not enabled',
      };
    }

    // Check limit if specified
    if (limitKey) {
      const limitCheck = this.checkLimit(entitlement, limitKey, requestedAmount);
      if (!limitCheck.allowed) {
        return {
          allowed: false,
          entitlement,
          feature,
          limit: limitCheck.limit,
          reason: 'Limit exceeded',
        };
      }
    }

    return {
      allowed: true,
      entitlement,
      feature,
    };
  }

  /**
   * Get feature usage percentage
   */
  getFeatureUsagePercentage(feature: EntitlementFeature): number {
    if (feature.limit === undefined || feature.used === undefined) {
      return 0;
    }
    if (feature.limit === 0) {
      return 0;
    }
    return Math.min(100, (feature.used / feature.limit) * 100);
  }

  /**
   * Get limit usage percentage
   */
  getLimitUsagePercentage(limit: EntitlementLimit): number {
    if (limit.value === -1) {
      return 0; // Unlimited
    }
    if (limit.value === 0) {
      return 0;
    }
    return Math.min(100, (limit.used / limit.value) * 100);
  }

  /**
   * Check if a limit is near threshold
   */
  isLimitNearThreshold(limit: EntitlementLimit, thresholdPercentage: number = 80): boolean {
    if (limit.value === -1) {
      return false; // Unlimited
    }
    const usagePercentage = this.getLimitUsagePercentage(limit);
    return usagePercentage >= thresholdPercentage;
  }

  /**
   * Get all active features for an entitlement
   */
  getActiveFeatures(entitlement: Entitlement): EntitlementFeature[] {
    if (!this.isEntitlementActive(entitlement)) {
      return [];
    }

    return entitlement.features.filter(feature => {
      if (!feature.enabled) {
        return false;
      }
      if (feature.expiresAt && feature.expiresAt < new Date()) {
        return false;
      }
      return true;
    });
  }

  /**
   * Get all limits that are near or at their threshold
   */
  getLimitsNearThreshold(
    entitlement: Entitlement,
    thresholdPercentage: number = 80
  ): EntitlementLimit[] {
    if (!this.isEntitlementActive(entitlement)) {
      return [];
    }

    return entitlement.limits.filter(limit => 
      this.isLimitNearThreshold(limit, thresholdPercentage)
    );
  }
}