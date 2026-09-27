/**
 * Limit Guard - Authorization guard for limits
 * 
 * This module provides guards and middleware for checking
 * limits before allowing access to protected resources.
 */

import { LimitService } from './limit.service';
import { LimitPolicy } from './limit.policy';
import { LimitCheckResult, RateLimitConfig } from './limit.types';

export interface LimitGuardContext {
  userId: string;
  tenantId: string;
  roles?: string[];
  permissions?: string[];
}

export interface LimitGuardResult {
  allowed: boolean;
  reason?: string;
  limitCheck?: LimitCheckResult;
  retryAfter?: number;
}

export class LimitGuard {
  private readonly policy: LimitPolicy;

  constructor(private readonly service: LimitService) {
    this.policy = new LimitPolicy();
  }

  /**
   * Guard: Check if user can perform action within limits
   */
  async canPerformAction(
    limitKey: string,
    context: LimitGuardContext,
    requestedAmount: number = 1
  ): Promise<LimitGuardResult> {
    try {
      const limitCheck = await this.service.checkLimit(
        limitKey,
        context.tenantId,
        context.userId,
        requestedAmount
      );

      return {
        allowed: limitCheck.allowed,
        reason: limitCheck.allowed ? undefined : `Limit exceeded: ${limitKey}`,
        limitCheck,
      };
    } catch (error) {
      return {
        allowed: false,
        reason: `Failed to check limit: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Guard: Check rate limit
   */
  async checkRateLimit(
    limitKey: string,
    config: RateLimitConfig,
    context: LimitGuardContext
  ): Promise<LimitGuardResult> {
    try {
      const result = await this.service.checkRateLimit(
        limitKey,
        context.tenantId,
        context.userId,
        config
      );

      return {
        allowed: result.allowed,
        reason: result.allowed ? undefined : `Rate limit exceeded: ${limitKey}`,
        retryAfter: result.retryAfter,
      };
    } catch (error) {
      return {
        allowed: false,
        reason: `Failed to check rate limit: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Guard: Check multiple limits (all must pass)
   */
  async checkAllLimits(
    limitKeys: string[],
    context: LimitGuardContext,
    requestedAmount: number = 1
  ): Promise<LimitGuardResult> {
    for (const limitKey of limitKeys) {
      const result = await this.canPerformAction(limitKey, context, requestedAmount);
      if (!result.allowed) {
        return {
          allowed: false,
          reason: `Limit exceeded: ${limitKey}`,
          limitCheck: result.limitCheck,
          retryAfter: result.retryAfter,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Guard: Check multiple limits (any one must pass)
   */
  async checkAnyLimit(
    limitKeys: string[],
    context: LimitGuardContext,
    requestedAmount: number = 1
  ): Promise<LimitGuardResult> {
    for (const limitKey of limitKeys) {
      const result = await this.canPerformAction(limitKey, context, requestedAmount);
      if (result.allowed) {
        return { allowed: true };
      }
    }

    return {
      allowed: false,
      reason: `All limits exceeded: ${limitKeys.join(', ')}`,
    };
  }

  /**
   * Guard: Check if user has exceeded hard limits
   */
  async hasExceededHardLimits(
    context: LimitGuardContext
  ): Promise<LimitGuardResult> {
    try {
      const result = await this.service.hasExceededHardLimits(
        context.userId,
        'user',
        context.tenantId
      );

      return {
        allowed: !result.exceeded,
        reason: result.exceeded
          ? `Hard limits exceeded: ${result.limits.join(', ')}`
          : undefined,
      };
    } catch (error) {
      return {
        allowed: false,
        reason: `Failed to check hard limits: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Guard: Check if user is near any limits
   */
  async isNearAnyLimit(
    context: LimitGuardContext,
    thresholdPercentage: number = 80
  ): Promise<{ nearLimits: boolean; limits: string[] }> {
    try {
      const limits = await this.service.getLimitsNearThreshold(
        context.userId,
        'user',
        context.tenantId,
        thresholdPercentage
      );

      return {
        nearLimits: limits.length > 0,
        limits: limits.map(l => l.limit.key),
      };
    } catch (error) {
      return {
        nearLimits: false,
        limits: [],
      };
    }
  }

  /**
   * Guard: Check and record usage
   */
  async checkAndRecordUsage(
    limitKey: string,
    context: LimitGuardContext,
    amount: number = 1
  ): Promise<LimitGuardResult> {
    // First check limit
    const checkResult = await this.canPerformAction(limitKey, context, amount);
    if (!checkResult.allowed) {
      return checkResult;
    }

    // Then record usage
    try {
      await this.service.recordUsage(
        limitKey,
        context.tenantId,
        context.userId,
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
   * Guard: Check if user can make an order
   */
  async canMakeOrder(
    context: LimitGuardContext,
    orderValue: number
  ): Promise<LimitGuardResult> {
    // Check order count limit
    const orderCountResult = await this.canPerformAction(
      'orders_per_day',
      context,
      1
    );
    if (!orderCountResult.allowed) {
      return orderCountResult;
    }

    // Check order value limit
    const orderValueResult = await this.canPerformAction(
      'max_order_value',
      context,
      orderValue
    );
    if (!orderValueResult.allowed) {
      return orderValueResult;
    }

    return { allowed: true };
  }

  /**
   * Guard: Check if user can create a portfolio
   */
  async canCreatePortfolio(
    context: LimitGuardContext
  ): Promise<LimitGuardResult> {
    return this.canPerformAction('max_portfolios', context, 1);
  }

  /**
   * Guard: Check if user can add an exchange
   */
  async canAddExchange(
    context: LimitGuardContext
  ): Promise<LimitGuardResult> {
    return this.canPerformAction('max_exchanges', context, 1);
  }

  /**
   * Guard: Check if user can create a strategy
   */
  async canCreateStrategy(
    context: LimitGuardContext
  ): Promise<LimitGuardResult> {
    return this.canPerformAction('max_strategies', context, 1);
  }

  /**
   * Guard: Check if user can add a team member
   */
  async canAddTeamMember(
    context: LimitGuardContext
  ): Promise<LimitGuardResult> {
    return this.canPerformAction('max_team_members', context, 1);
  }

  /**
   * Guard: Check if user can make an API call
   */
  async canMakeApiCall(
    context: LimitGuardContext
  ): Promise<LimitGuardResult> {
    return this.canPerformAction('api_requests_per_minute', context, 1);
  }
}