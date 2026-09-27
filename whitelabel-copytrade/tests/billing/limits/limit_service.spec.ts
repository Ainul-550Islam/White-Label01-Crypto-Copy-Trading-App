import { describe, it, expect, beforeEach } from 'vitest';
import { LimitService } from '../../../apps/api/src/modules/billing/limits/limit.service';
import { LimitType, LimitScope, LimitPeriod, LimitStatus } from '../../../apps/api/src/modules/billing/limits/limit.types';

describe('LimitService', () => {
  let service: LimitService;

  beforeEach(() => {
    service = new LimitService();
  });

  describe('checkLimit', () => {
    it('should allow action when within limits', () => {
      const limit = {
        id: 'limit-1',
        key: 'max_orders_per_day',
        name: 'Daily Orders',
        limitType: LimitType.HARD,
        scope: LimitScope.USER,
        period: LimitPeriod.DAY,
        value: 100,
        unit: 'orders',
        status: LimitStatus.ACTIVE,
      };

      const result = service.checkLimit(limit as any, 50, 1);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(49);
    });

    it('should deny action when hard limit exceeded', () => {
      const limit = {
        id: 'limit-1',
        key: 'max_orders_per_day',
        name: 'Daily Orders',
        limitType: LimitType.HARD,
        scope: LimitScope.USER,
        period: LimitPeriod.DAY,
        value: 100,
        unit: 'orders',
        status: LimitStatus.ACTIVE,
      };

      const result = service.checkLimit(limit as any, 100, 1);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('exceeded');
    });

    it('should allow action for soft limit even when exceeded', () => {
      const limit = {
        id: 'limit-1',
        key: 'max_orders_per_day',
        name: 'Daily Orders',
        limitType: LimitType.SOFT,
        scope: LimitScope.USER,
        period: LimitPeriod.DAY,
        value: 100,
        unit: 'orders',
        status: LimitStatus.ACTIVE,
      };

      const result = service.checkLimit(limit as any, 100, 1);
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('warning');
    });

    it('should handle unlimited limits', () => {
      const limit = {
        id: 'limit-1',
        key: 'max_orders_per_day',
        name: 'Daily Orders',
        limitType: LimitType.HARD,
        scope: LimitScope.USER,
        period: LimitPeriod.DAY,
        value: -1,
        unit: 'orders',
        status: LimitStatus.ACTIVE,
      };

      const result = service.checkLimit(limit as any, 1000, 1);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(-1);
    });
  });

  describe('recordUsage', () => {
    it('should record usage for a limit', () => {
      const usage = {
        limitId: 'limit-1',
        userId: 'user-1',
        usage: 50,
      };

      const result = service.recordUsage(usage as any, 1);
      expect(result.newUsage).toBe(51);
    });

    it('should not exceed limit for hard limits', () => {
      const limit = {
        id: 'limit-1',
        limitType: LimitType.HARD,
        value: 100,
      };
      const usage = {
        limitId: 'limit-1',
        userId: 'user-1',
        usage: 100,
      };

      const result = service.recordUsage(usage as any, 1);
      expect(result.exceeded).toBe(true);
    });
  });

  describe('resetUsage', () => {
    it('should reset usage to zero', () => {
      const usage = {
        limitId: 'limit-1',
        userId: 'user-1',
        usage: 50,
      };

      const result = service.resetUsage(usage as any);
      expect(result.newUsage).toBe(0);
    });
  });

  describe('getUsageSummary', () => {
    it('should return usage summary', () => {
      const limits = [
        { key: 'max_orders_per_day', value: 100, usage: 50, unit: 'orders' },
        { key: 'max_portfolios', value: 3, usage: 2, unit: 'portfolios' },
      ];

      const summary = service.getUsageSummary(limits as any);
      expect(summary.totalLimits).toBe(2);
      expect(summary.nearLimit).toBe(0);
      expect(summary.exceeded).toBe(0);
    });

    it('should identify near-limit usage', () => {
      const limits = [
        { key: 'max_orders_per_day', value: 100, usage: 85, unit: 'orders' },
      ];

      const summary = service.getUsageSummary(limits as any);
      expect(summary.nearLimit).toBe(1);
    });

    it('should identify exceeded usage', () => {
      const limits = [
        { key: 'max_orders_per_day', value: 100, usage: 105, unit: 'orders' },
      ];

      const summary = service.getUsageSummary(limits as any);
      expect(summary.exceeded).toBe(1);
    });
  });

  describe('checkRateLimit', () => {
    it('should check rate limit with burst allowance', () => {
      const limit = {
        id: 'limit-1',
        key: 'api_requests_per_minute',
        name: 'API Rate',
        limitType: LimitType.RATE,
        value: 100,
        unit: 'req/min',
      };

      const result = service.checkRateLimit(limit as any, 95, 1.1);
      expect(result.allowed).toBe(true); // 95 < 110 (100 * 1.1)
    });

    it('should deny when burst allowance exceeded', () => {
      const limit = {
        id: 'limit-1',
        key: 'api_requests_per_minute',
        name: 'API Rate',
        limitType: LimitType.RATE,
        value: 100,
        unit: 'req/min',
      };

      const result = service.checkRateLimit(limit as any, 110, 1.1);
      expect(result.allowed).toBe(false);
    });
  });

  describe('hasExceededHardLimits', () => {
    it('should return true when any hard limit is exceeded', () => {
      const limits = [
        { key: 'max_orders_per_day', value: 100, usage: 50, hardLimit: true },
        { key: 'max_portfolios', value: 3, usage: 4, hardLimit: true },
      ];

      const result = service.hasExceededHardLimits(limits as any);
      expect(result).toBe(true);
    });

    it('should return false when no hard limits exceeded', () => {
      const limits = [
        { key: 'max_orders_per_day', value: 100, usage: 50, hardLimit: true },
        { key: 'max_portfolios', value: 3, usage: 2, hardLimit: true },
      ];

      const result = service.hasExceededHardLimits(limits as any);
      expect(result).toBe(false);
    });
  });
});