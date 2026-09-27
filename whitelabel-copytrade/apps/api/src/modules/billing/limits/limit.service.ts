/**
 * Limit Service - Business logic for limits
 * 
 * This module handles business operations for limits including
 * creation, updates, checking, and usage tracking.
 */

import {
  Limit,
  LimitUsage,
  CreateLimitRequest,
  UpdateLimitRequest,
  LimitFilter,
  LimitCheckResult,
  LimitUsageSummary,
  LimitResetResult,
  LimitStatus,
  LimitType,
} from './limit.types';
import { LimitPolicy } from './limit.policy';

export interface LimitRepository {
  findById(id: string): Promise<Limit | null>;
  findByKey(key: string, tenantId: string): Promise<Limit | null>;
  findMany(filter: LimitFilter, tenantId: string): Promise<Limit[]>;
  create(data: CreateLimitRequest, tenantId: string): Promise<Limit>;
  update(id: string, data: UpdateLimitRequest): Promise<Limit>;
  delete(id: string): Promise<void>;
  getUsage(limitId: string, entityId: string): Promise<LimitUsage | null>;
  updateUsage(limitId: string, entityId: string, amount: number): Promise<LimitUsage>;
  resetUsage(limitId: string, entityId: string): Promise<LimitResetResult>;
  getUsageSummary(entityId: string, entityType: string): Promise<LimitUsageSummary>;
}

export class LimitService {
  private readonly policy: LimitPolicy;

  constructor(
    private readonly repository: LimitRepository,
    policyConfig?: Partial<import('./limit.policy').LimitPolicyConfig>
  ) {
    this.policy = new LimitPolicy(policyConfig);
  }

  /**
   * Get a limit by ID
   */
  async getLimit(id: string): Promise<Limit> {
    const limit = await this.repository.findById(id);
    if (!limit) {
      throw new Error(`Limit not found: ${id}`);
    }
    return limit;
  }

  /**
   * Get a limit by key
   */
  async getLimitByKey(key: string, tenantId: string): Promise<Limit> {
    const limit = await this.repository.findByKey(key, tenantId);
    if (!limit) {
      throw new Error(`Limit not found with key: ${key}`);
    }
    return limit;
  }

  /**
   * List limits with optional filters
   */
  async listLimits(filter: LimitFilter, tenantId: string): Promise<Limit[]> {
    return this.repository.findMany(filter, tenantId);
  }

  /**
   * Create a new limit
   */
  async createLimit(data: CreateLimitRequest, tenantId: string): Promise<Limit> {
    // Validate the request
    const errors = this.policy.validateLimitConfig(data);
    if (errors.length > 0) {
      throw new Error(`Validation failed: ${errors.join(', ')}`);
    }

    // Check if limit key already exists
    const existing = await this.repository.findByKey(data.key, tenantId);
    if (existing) {
      throw new Error(`Limit with key '${data.key}' already exists`);
    }

    return this.repository.create(data, tenantId);
  }

  /**
   * Update a limit
   */
  async updateLimit(id: string, data: UpdateLimitRequest): Promise<Limit> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new Error(`Limit not found: ${id}`);
    }

    return this.repository.update(id, data);
  }

  /**
   * Delete a limit
   */
  async deleteLimit(id: string): Promise<void> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new Error(`Limit not found: ${id}`);
    }

    await this.repository.delete(id);
  }

  /**
   * Check if an entity can perform an action within limits
   */
  async checkLimit(
    limitKey: string,
    tenantId: string,
    entityId: string,
    requestedAmount: number = 1
  ): Promise<LimitCheckResult> {
    const limit = await this.repository.findByKey(limitKey, tenantId);
    if (!limit) {
      throw new Error(`Limit not found with key: ${limitKey}`);
    }

    if (limit.status !== LimitStatus.ACTIVE) {
      return {
        allowed: false,
        limit,
        used: 0,
        remaining: 0,
      };
    }

    const usage = await this.repository.getUsage(limit.id, entityId);
    const currentUsage = usage?.used || 0;

    return this.policy.checkLimit(limit, currentUsage, requestedAmount);
  }

  /**
   * Record usage of a limit
   */
  async recordUsage(
    limitKey: string,
    tenantId: string,
    entityId: string,
    amount: number = 1
  ): Promise<LimitUsage> {
    const limit = await this.repository.findByKey(limitKey, tenantId);
    if (!limit) {
      throw new Error(`Limit not found with key: ${limitKey}`);
    }

    // Check if limit allows this usage
    const checkResult = await this.checkLimit(limitKey, tenantId, entityId, amount);
    if (!checkResult.allowed) {
      throw new Error(`Limit exceeded: ${limitKey}`);
    }

    // Update usage
    return this.repository.updateUsage(limit.id, entityId, amount);
  }

  /**
   * Reset usage for a limit
   */
  async resetUsage(
    limitKey: string,
    tenantId: string,
    entityId: string
  ): Promise<LimitResetResult> {
    const limit = await this.repository.findByKey(limitKey, tenantId);
    if (!limit) {
      throw new Error(`Limit not found with key: ${limitKey}`);
    }

    return this.repository.resetUsage(limit.id, entityId);
  }

  /**
   * Get usage summary for an entity
   */
  async getUsageSummary(
    entityId: string,
    entityType: string
  ): Promise<LimitUsageSummary> {
    return this.repository.getUsageSummary(entityId, entityType);
  }

  /**
   * Check rate limit
   */
  async checkRateLimit(
    limitKey: string,
    tenantId: string,
    entityId: string,
    config: import('./limit.types').RateLimitConfig
  ): Promise<{ allowed: boolean; retryAfter?: number }> {
    const limit = await this.repository.findByKey(limitKey, tenantId);
    if (!limit) {
      throw new Error(`Limit not found with key: ${limitKey}`);
    }

    const usage = await this.repository.getUsage(limit.id, entityId);
    if (!usage) {
      return { allowed: true };
    }

    // Get window start from usage metadata or calculate it
    const windowStart = usage.lastUsedAt || new Date();
    const currentCount = usage.used;

    return this.policy.checkRateLimit(config, currentCount, windowStart);
  }

  /**
   * Get limits near threshold for an entity
   */
  async getLimitsNearThreshold(
    entityId: string,
    entityType: string,
    tenantId: string,
    thresholdPercentage?: number
  ): Promise<{ limit: Limit; usage: number; percentage: number }[]> {
    const summary = await this.getUsageSummary(entityId, entityType);
    
    const limitsWithUsage = summary.limits.map(({ limit, used }) => ({
      limit,
      usage: used,
    }));

    return this.policy.getLimitsNearThreshold(limitsWithUsage, thresholdPercentage);
  }

  /**
   * Get all limits that need reset
   */
  async getLimitsNeedingReset(
    entityId: string,
    entityType: string
  ): Promise<LimitUsage[]> {
    const summary = await this.getUsageSummary(entityId, entityType);
    
    const allUsages: LimitUsage[] = summary.limits.map(({ limit, used, remaining, resetsAt }) => ({
      id: `${limit.id}-${entityId}`,
      limitId: limit.id,
      entityId,
      entityType,
      used,
      remaining,
      resetAt: resetsAt,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    return this.policy.getLimitsNeedingReset(allUsages);
  }

  /**
   * Bulk reset all limits that need reset for an entity
   */
  async bulkResetExpiredLimits(
    entityId: string,
    entityType: string,
    tenantId: string
  ): Promise<LimitResetResult[]> {
    const limitsToReset = await this.getLimitsNeedingReset(entityId, entityType);
    const results: LimitResetResult[] = [];

    for (const usage of limitsToReset) {
      try {
        const limit = await this.repository.findById(usage.limitId);
        if (limit) {
          const result = await this.resetUsage(limit.key, tenantId, entityId);
          results.push(result);
        }
      } catch (error) {
        // Log error but continue with other resets
        console.error(`Failed to reset limit ${usage.limitId}:`, error);
      }
    }

    return results;
  }

  /**
   * Check if an entity has exceeded any hard limits
   */
  async hasExceededHardLimits(
    entityId: string,
    entityType: string,
    tenantId: string
  ): Promise<{ exceeded: boolean; limits: string[] }> {
    const summary = await this.getUsageSummary(entityId, entityType);
    const exceededLimits: string[] = [];

    for (const { limit, used } of summary.limits) {
      if (limit.type === LimitType.HARD && limit.value !== -1) {
        if (used >= limit.value) {
          exceededLimits.push(limit.key);
        }
      }
    }

    return {
      exceeded: exceededLimits.length > 0,
      limits: exceededLimits,
    };
  }
}