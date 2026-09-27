/**
 * Limit Policy - Business rules for limits
 * 
 * This module defines the policies and rules for how limits
 * are enforced, checked, and managed.
 */

import {
  Limit,
  LimitType,
  LimitScope,
  LimitPeriod,
  LimitStatus,
  LimitCheckResult,
  LimitUsage,
  RateLimitConfig,
} from './limit.types';

export interface LimitPolicyConfig {
  enforceHardLimits: boolean;
  allowBurst: boolean;
  burstPercentage: number;
  gracePeriodMs: number;
  resetOnLimitExceeded: boolean;
  notifyOnThreshold: boolean;
  thresholdPercentage: number;
}

export const DEFAULT_LIMIT_POLICY_CONFIG: LimitPolicyConfig = {
  enforceHardLimits: true,
  allowBurst: false,
  burstPercentage: 10,
  gracePeriodMs: 60000,
  resetOnLimitExceeded: false,
  notifyOnThreshold: true,
  thresholdPercentage: 80,
};

export class LimitPolicy {
  private readonly config: LimitPolicyConfig;

  constructor(config: Partial<LimitPolicyConfig> = {}) {
    this.config = { ...DEFAULT_LIMIT_POLICY_CONFIG, ...config };
  }

  /**
   * Check if a limit allows additional usage
   */
  checkLimit(
    limit: Limit,
    currentUsage: number,
    requestedAmount: number = 1
  ): LimitCheckResult {
    // -1 means unlimited
    if (limit.value === -1) {
      return {
        allowed: true,
        limit,
        used: currentUsage,
        remaining: -1,
      };
    }

    const remaining = limit.value - currentUsage;

    // Check hard limits
    if (limit.type === LimitType.HARD && this.config.enforceHardLimits) {
      const allowed = remaining >= requestedAmount;

      // Check burst allowance
      if (!allowed && this.config.allowBurst) {
        const burstLimit = limit.value * (1 + this.config.burstPercentage / 100);
        const burstAllowed = (currentUsage + requestedAmount) <= burstLimit;
        return {
          allowed: burstAllowed,
          limit,
          used: currentUsage,
          remaining: burstAllowed ? remaining - requestedAmount : 0,
        };
      }

      return {
        allowed,
        limit,
        used: currentUsage,
        remaining: allowed ? remaining - requestedAmount : 0,
      };
    }

    // Soft limits always allow but track usage
    return {
      allowed: true,
      limit,
      used: currentUsage,
      remaining: Math.max(0, remaining - requestedAmount),
    };
  }

  /**
   * Check rate limit
   */
  checkRateLimit(
    config: RateLimitConfig,
    currentCount: number,
    windowStart: Date,
    now: Date = new Date()
  ): { allowed: boolean; retryAfter?: number } {
    const windowMs = config.window * 1000;
    const elapsed = now.getTime() - windowStart.getTime();

    // Check if window has reset
    if (elapsed >= windowMs) {
      return { allowed: true };
    }

    // Check burst limit first
    if (config.burst && config.burstWindow) {
      const burstWindowMs = config.burstWindow * 1000;
      if (elapsed < burstWindowMs && currentCount >= config.burst) {
        const retryAfter = Math.ceil((burstWindowMs - elapsed) / 1000);
        return { allowed: false, retryAfter };
      }
    }

    // Check regular limit
    if (currentCount >= config.requests) {
      const retryAfter = Math.ceil((windowMs - elapsed) / 1000);
      return { allowed: false, retryAfter };
    }

    return { allowed: true };
  }

  /**
   * Calculate reset time for a limit period
   */
  calculateResetTime(
    period: LimitPeriod,
    lastReset?: Date
  ): Date {
    const now = lastReset || new Date();
    const resetTime = new Date(now);

    switch (period) {
      case LimitPeriod.MINUTE:
        resetTime.setMinutes(resetTime.getMinutes() + 1, 0, 0);
        break;
      case LimitPeriod.HOUR:
        resetTime.setHours(resetTime.getHours() + 1, 0, 0, 0);
        break;
      case LimitPeriod.DAY:
        resetTime.setDate(resetTime.getDate() + 1);
        resetTime.setHours(0, 0, 0, 0);
        break;
      case LimitPeriod.WEEK:
        resetTime.setDate(resetTime.getDate() + (7 - resetTime.getDay()));
        resetTime.setHours(0, 0, 0, 0);
        break;
      case LimitPeriod.MONTH:
        resetTime.setMonth(resetTime.getMonth() + 1, 1);
        resetTime.setHours(0, 0, 0, 0);
        break;
      case LimitPeriod.YEAR:
        resetTime.setFullYear(resetTime.getFullYear() + 1, 0, 1);
        resetTime.setHours(0, 0, 0, 0);
        break;
      case LimitPeriod.LIFETIME:
        resetTime.setFullYear(resetTime.getFullYear() + 100);
        break;
    }

    return resetTime;
  }

  /**
   * Check if a limit has expired
   */
  isLimitExpired(limit: LimitUsage): boolean {
    if (!limit.resetAt) {
      return false;
    }
    return new Date() >= limit.resetAt;
  }

  /**
   * Check if a limit is near threshold
   */
  isNearThreshold(
    limit: Limit,
    currentUsage: number,
    thresholdPercentage?: number
  ): boolean {
    if (limit.value === -1) {
      return false; // Unlimited
    }

    const threshold = thresholdPercentage || this.config.thresholdPercentage;
    const usagePercentage = (currentUsage / limit.value) * 100;
    return usagePercentage >= threshold;
  }

  /**
   * Get usage percentage
   */
  getUsagePercentage(limit: Limit, currentUsage: number): number {
    if (limit.value === -1) {
      return 0; // Unlimited
    }
    if (limit.value === 0) {
      return 0;
    }
    return Math.min(100, (currentUsage / limit.value) * 100);
  }

  /**
   * Get limit severity
   */
  getLimitSeverity(limit: Limit, currentUsage: number): 'low' | 'medium' | 'high' | 'critical' {
    const percentage = this.getUsagePercentage(limit, currentUsage);

    if (percentage >= 100) return 'critical';
    if (percentage >= 90) return 'high';
    if (percentage >= 70) return 'medium';
    return 'low';
  }

  /**
   * Check if reset is needed
   */
  needsReset(limit: LimitUsage): boolean {
    if (!limit.resetAt) {
      return false;
    }
    return new Date() >= limit.resetAt;
  }

  /**
   * Get all limits that need reset
   */
  getLimitsNeedingReset(limits: LimitUsage[]): LimitUsage[] {
    return limits.filter(limit => this.needsReset(limit));
  }

  /**
   * Get all limits near threshold
   */
  getLimitsNearThreshold(
    limits: { limit: Limit; usage: number }[],
    thresholdPercentage?: number
  ): { limit: Limit; usage: number; percentage: number }[] {
    return limits
      .map(({ limit, usage }) => ({
        limit,
        usage,
        percentage: this.getUsagePercentage(limit, usage),
      }))
      .filter(({ percentage }) => {
        const threshold = thresholdPercentage || this.config.thresholdPercentage;
        return percentage >= threshold;
      });
  }

  /**
   * Validate limit configuration
   */
  validateLimitConfig(limit: CreateLimitRequest): string[] {
    const errors: string[] = [];

    if (!limit.key || limit.key.trim().length === 0) {
      errors.push('Limit key is required');
    }

    if (!limit.name || limit.name.trim().length === 0) {
      errors.push('Limit name is required');
    }

    if (!limit.description || limit.description.trim().length === 0) {
      errors.push('Limit description is required');
    }

    if (!Object.values(LimitType).includes(limit.type)) {
      errors.push('Invalid limit type');
    }

    if (!Object.values(LimitScope).includes(limit.scope)) {
      errors.push('Invalid limit scope');
    }

    if (!Object.values(LimitPeriod).includes(limit.period)) {
      errors.push('Invalid limit period');
    }

    if (typeof limit.value !== 'number') {
      errors.push('Limit value must be a number');
    }

    if (limit.value < -1) {
      errors.push('Limit value must be -1 (unlimited) or a positive number');
    }

    if (!limit.unit || limit.unit.trim().length === 0) {
      errors.push('Limit unit is required');
    }

    return errors;
  }
}

// Import the request type for validation
interface CreateLimitRequest {
  key: string;
  name: string;
  description: string;
  type: LimitType;
  scope: LimitScope;
  period: LimitPeriod;
  value: number;
  unit: string;
  metadata?: Record<string, string>;
}