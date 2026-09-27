import { describe, it, expect, beforeEach } from 'vitest';
import { LimitGuard } from '../../../apps/api/src/modules/billing/limits/limit.guard';
import { LimitType, LimitScope, LimitPeriod, LimitStatus } from '../../../apps/api/src/modules/billing/limits/limit.types';

describe('LimitGuard', () => {
  let guard: LimitGuard;

  beforeEach(() => {
    guard = new LimitGuard();
  });

  describe('canPerformAction', () => {
    it('should allow action when within limits', () => {
      const limits = [
        {
          key: 'max_orders_per_day',
          limitType: LimitType.HARD,
          value: 100,
          usage: 50,
          unit: 'orders',
        },
      ];

      const result = guard.canPerformAction(limits as any, 'max_orders_per_day', 1);
      expect(result.allowed).toBe(true);
    });

    it('should deny action when hard limit exceeded', () => {
      const limits = [
        {
          key: 'max_orders_per_day',
          limitType: LimitType.HARD,
          value: 100,
          usage: 100,
          unit: 'orders',
        },
      ];

      const result = guard.canPerformAction(limits as any, 'max_orders_per_day', 1);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('exceeded');
    });

    it('should allow action for unlimited limits', () => {
      const limits = [
        {
          key: 'max_orders_per_day',
          limitType: LimitType.HARD,
          value: -1,
          usage: 1000,
          unit: 'orders',
        },
      ];

      const result = guard.canPerformAction(limits as any, 'max_orders_per_day', 1);
      expect(result.allowed).toBe(true);
    });
  });

  describe('checkRateLimit', () => {
    it('should allow when within rate limit', () => {
      const limits = [
        {
          key: 'api_requests_per_minute',
          limitType: LimitType.RATE,
          value: 100,
          usage: 50,
          unit: 'req/min',
        },
      ];

      const result = guard.checkRateLimit(limits as any, 'api_requests_per_minute', 1.1);
      expect(result.allowed).toBe(true);
    });

    it('should deny when rate limit exceeded', () => {
      const limits = [
        {
          key: 'api_requests_per_minute',
          limitType: LimitType.RATE,
          value: 100,
          usage: 110,
          unit: 'req/min',
        },
      ];

      const result = guard.checkRateLimit(limits as any, 'api_requests_per_minute', 1.1);
      expect(result.allowed).toBe(false);
    });
  });

  describe('checkAllLimits', () => {
    it('should return true when all limits are within bounds', () => {
      const limits = [
        { key: 'max_orders_per_day', limitType: LimitType.HARD, value: 100, usage: 50, unit: 'orders' },
        { key: 'max_portfolios', limitType: LimitType.HARD, value: 3, usage: 2, unit: 'portfolios' },
      ];

      const result = guard.checkAllLimits(limits as any);
      expect(result).toBe(true);
    });

    it('should return false when any limit is exceeded', () => {
      const limits = [
        { key: 'max_orders_per_day', limitType: LimitType.HARD, value: 100, usage: 50, unit: 'orders' },
        { key: 'max_portfolios', limitType: LimitType.HARD, value: 3, usage: 4, unit: 'portfolios' },
      ];

      const result = guard.checkAllLimits(limits as any);
      expect(result).toBe(false);
    });
  });

  describe('checkAnyLimit', () => {
    it('should return true when at least one limit allows', () => {
      const limits = [
        { key: 'max_orders_per_day', limitType: LimitType.HARD, value: 100, usage: 100, unit: 'orders' },
        { key: 'max_portfolios', limitType: LimitType.HARD, value: 3, usage: 2, unit: 'portfolios' },
      ];

      const result = guard.checkAnyLimit(limits as any);
      expect(result).toBe(true);
    });

    it('should return false when all limits exceeded', () => {
      const limits = [
        { key: 'max_orders_per_day', limitType: LimitType.HARD, value: 100, usage: 105, unit: 'orders' },
        { key: 'max_portfolios', limitType: LimitType.HARD, value: 3, usage: 4, unit: 'portfolios' },
      ];

      const result = guard.checkAnyLimit(limits as any);
      expect(result).toBe(false);
    });
  });

  describe('canMakeOrder', () => {
    it('should allow order when within limits', () => {
      const limits = [
        { key: 'max_orders_per_day', limitType: LimitType.HARD, value: 100, usage: 50, unit: 'orders' },
        { key: 'max_orders_per_hour', limitType: LimitType.HARD, value: 20, usage: 10, unit: 'orders' },
      ];

      const result = guard.canMakeOrder(limits as any);
      expect(result.allowed).toBe(true);
    });

    it('should deny order when daily limit exceeded', () => {
      const limits = [
        { key: 'max_orders_per_day', limitType: LimitType.HARD, value: 100, usage: 100, unit: 'orders' },
      ];

      const result = guard.canMakeOrder(limits as any);
      expect(result.allowed).toBe(false);
    });
  });

  describe('canCreatePortfolio', () => {
    it('should allow portfolio creation when within limit', () => {
      const limits = [
        { key: 'max_portfolios', limitType: LimitType.HARD, value: 3, usage: 2, unit: 'portfolios' },
      ];

      const result = guard.canCreatePortfolio(limits as any);
      expect(result.allowed).toBe(true);
    });

    it('should deny portfolio creation when limit reached', () => {
      const limits = [
        { key: 'max_portfolios', limitType: LimitType.HARD, value: 3, usage: 3, unit: 'portfolios' },
      ];

      const result = guard.canCreatePortfolio(limits as any);
      expect(result.allowed).toBe(false);
    });
  });

  describe('canAddExchange', () => {
    it('should allow exchange addition when within limit', () => {
      const limits = [
        { key: 'max_exchanges', limitType: LimitType.HARD, value: 5, usage: 3, unit: 'exchanges' },
      ];

      const result = guard.canAddExchange(limits as any);
      expect(result.allowed).toBe(true);
    });

    it('should deny exchange addition when limit reached', () => {
      const limits = [
        { key: 'max_exchanges', limitType: LimitType.HARD, value: 5, usage: 5, unit: 'exchanges' },
      ];

      const result = guard.canAddExchange(limits as any);
      expect(result.allowed).toBe(false);
    });
  });

  describe('canMakeApiCall', () => {
    it('should allow API call when within rate limit', () => {
      const limits = [
        { key: 'api_requests_per_minute', limitType: LimitType.RATE, value: 100, usage: 50, unit: 'req/min' },
      ];

      const result = guard.canMakeApiCall(limits as any);
      expect(result.allowed).toBe(true);
    });

    it('should deny API call when rate limit exceeded', () => {
      const limits = [
        { key: 'api_requests_per_minute', limitType: LimitType.RATE, value: 100, usage: 110, unit: 'req/min' },
      ];

      const result = guard.canMakeApiCall(limits as any);
      expect(result.allowed).toBe(false);
    });
  });
});