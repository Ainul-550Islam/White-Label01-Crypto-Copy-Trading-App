/**
 * Limit Resolver - GraphQL resolver for limits
 * 
 * This module handles GraphQL queries and mutations for limits.
 */

import { LimitService } from './limit.service';
import { LimitPolicy } from './limit.policy';
import {
  Limit,
  LimitUsage,
  CreateLimitRequest,
  UpdateLimitRequest,
  LimitFilter,
  LimitCheckResult,
  LimitUsageSummary,
  LimitResetResult,
} from './limit.types';

export class LimitResolver {
  private readonly policy: LimitPolicy;

  constructor(private readonly service: LimitService) {
    this.policy = new LimitPolicy();
  }

  /**
   * Query: Get limit by ID
   */
  async getLimit(
    id: string,
    context: { userId: string; tenantId: string }
  ): Promise<Limit | null> {
    try {
      return await this.service.getLimit(id);
    } catch (error) {
      return null;
    }
  }

  /**
   * Query: Get limit by key
   */
  async getLimitByKey(
    key: string,
    context: { userId: string; tenantId: string }
  ): Promise<Limit | null> {
    try {
      return await this.service.getLimitByKey(key, context.tenantId);
    } catch (error) {
      return null;
    }
  }

  /**
   * Query: List limits
   */
  async listLimits(
    filter: LimitFilter,
    context: { userId: string; tenantId: string }
  ): Promise<Limit[]> {
    return this.service.listLimits(filter, context.tenantId);
  }

  /**
   * Query: Check limit
   */
  async checkLimit(
    limitKey: string,
    requestedAmount: number,
    context: { userId: string; tenantId: string }
  ): Promise<LimitCheckResult> {
    return this.service.checkLimit(
      limitKey,
      context.tenantId,
      context.userId,
      requestedAmount
    );
  }

  /**
   * Query: Get usage summary
   */
  async getUsageSummary(
    context: { userId: string; tenantId: string }
  ): Promise<LimitUsageSummary> {
    return this.service.getUsageSummary(context.userId, 'user');
  }

  /**
   * Query: Get limits near threshold
   */
  async getLimitsNearThreshold(
    thresholdPercentage: number,
    context: { userId: string; tenantId: string }
  ): Promise<{ limit: Limit; usage: number; percentage: number }[]> {
    return this.service.getLimitsNearThreshold(
      context.userId,
      'user',
      context.tenantId,
      thresholdPercentage
    );
  }

  /**
   * Query: Check if has exceeded hard limits
   */
  async hasExceededHardLimits(
    context: { userId: string; tenantId: string }
  ): Promise<{ exceeded: boolean; limits: string[] }> {
    return this.service.hasExceededHardLimits(
      context.userId,
      'user',
      context.tenantId
    );
  }

  /**
   * Mutation: Create limit
   */
  async createLimit(
    data: CreateLimitRequest,
    context: { userId: string; tenantId: string }
  ): Promise<Limit> {
    return this.service.createLimit(data, context.tenantId);
  }

  /**
   * Mutation: Update limit
   */
  async updateLimit(
    id: string,
    data: UpdateLimitRequest,
    context: { userId: string; tenantId: string }
  ): Promise<Limit> {
    return this.service.updateLimit(id, data);
  }

  /**
   * Mutation: Delete limit
   */
  async deleteLimit(
    id: string,
    context: { userId: string; tenantId: string }
  ): Promise<boolean> {
    try {
      await this.service.deleteLimit(id);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Mutation: Record usage
   */
  async recordUsage(
    limitKey: string,
    amount: number,
    context: { userId: string; tenantId: string }
  ): Promise<LimitUsage> {
    return this.service.recordUsage(
      limitKey,
      context.tenantId,
      context.userId,
      amount
    );
  }

  /**
   * Mutation: Reset usage
   */
  async resetUsage(
    limitKey: string,
    context: { userId: string; tenantId: string }
  ): Promise<LimitResetResult> {
    return this.service.resetUsage(
      limitKey,
      context.tenantId,
      context.userId
    );
  }

  /**
   * Mutation: Bulk reset expired limits
   */
  async bulkResetExpiredLimits(
    context: { userId: string; tenantId: string }
  ): Promise<LimitResetResult[]> {
    return this.service.bulkResetExpiredLimits(
      context.userId,
      'user',
      context.tenantId
    );
  }

  /**
   * Field resolver: Check if limit is near threshold
   */
  async isNearThreshold(
    limit: Limit,
    usage: number,
    thresholdPercentage: number,
    context: { userId: string; tenantId: string }
  ): Promise<boolean> {
    return this.policy.isNearThreshold(limit, usage, thresholdPercentage);
  }

  /**
   * Field resolver: Get usage percentage
   */
  async usagePercentage(
    limit: Limit,
    usage: number,
    context: { userId: string; tenantId: string }
  ): Promise<number> {
    return this.policy.getUsagePercentage(limit, usage);
  }

  /**
   * Field resolver: Get limit severity
   */
  async severity(
    limit: Limit,
    usage: number,
    context: { userId: string; tenantId: string }
  ): Promise<string> {
    return this.policy.getLimitSeverity(limit, usage);
  }

  /**
   * Field resolver: Calculate reset time
   */
  async resetTime(
    limit: Limit,
    lastReset: Date,
    context: { userId: string; tenantId: string }
  ): Promise<Date> {
    return this.policy.calculateResetTime(limit.period, lastReset);
  }
}