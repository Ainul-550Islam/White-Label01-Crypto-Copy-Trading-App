import { describe, it, expect, beforeEach } from 'vitest';
import { LimitResolver } from '../../../apps/api/src/modules/billing/limits/limit.resolver';
import { LimitType, LimitScope, LimitPeriod, LimitStatus } from '../../../apps/api/src/modules/billing/limits/limit.types';

describe('LimitResolver', () => {
  let resolver: LimitResolver;

  beforeEach(() => {
    resolver = new LimitResolver();
  });

  describe('limit', () => {
    it('should resolve limit by ID', async () => {
      const mockLimit = {
        id: 'limit-1',
        tenantId: 'tenant-1',
        key: 'max_orders_per_day',
        name: 'Daily Orders',
        limitType: LimitType.HARD,
        scope: LimitScope.USER,
        period: LimitPeriod.DAY,
        value: 100,
        unit: 'orders',
        status: LimitStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (resolver as any).limitService = {
        getLimit: async () => mockLimit,
      };

      const result = await resolver.limit({ id: 'limit-1' });
      expect(result).toEqual(mockLimit);
    });
  });

  describe('limits', () => {
    it('should resolve limits with filter', async () => {
      const mockLimits = [
        { id: 'limit-1', key: 'max_orders_per_day', value: 100 },
        { id: 'limit-2', key: 'max_portfolios', value: 3 },
      ];

      (resolver as any).limitService = {
        getLimits: async () => mockLimits,
      };

      const result = await resolver.limits({ tenantId: 'tenant-1' });
      expect(result).toHaveLength(2);
    });
  });

  describe('createLimit', () => {
    it('should create a new limit', async () => {
      const input = {
        tenantId: 'tenant-1',
        key: 'max_orders_per_day',
        name: 'Daily Orders',
        limitType: LimitType.HARD,
        scope: LimitScope.USER,
        period: LimitPeriod.DAY,
        value: 100,
        unit: 'orders',
      };

      const mockCreated = {
        id: 'limit-new',
        ...input,
        status: LimitStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (resolver as any).limitService = {
        createLimit: async () => mockCreated,
      };

      const result = await resolver.createLimit({ input });
      expect(result.id).toBe('limit-new');
      expect(result.value).toBe(100);
    });
  });

  describe('updateLimit', () => {
    it('should update an existing limit', async () => {
      const input = {
        value: 200,
      };

      const mockUpdated = {
        id: 'limit-1',
        value: 200,
      };

      (resolver as any).limitService = {
        updateLimit: async () => mockUpdated,
      };

      const result = await resolver.updateLimit({ id: 'limit-1', input });
      expect(result.value).toBe(200);
    });
  });

  describe('deleteLimit', () => {
    it('should delete a limit', async () => {
      (resolver as any).limitService = {
        deleteLimit: async () => true,
      };

      const result = await resolver.deleteLimit({ id: 'limit-1' });
      expect(result).toBe(true);
    });
  });

  describe('checkLimit', () => {
    it('should check limit usage', async () => {
      const mockResult = {
        allowed: true,
        limitKey: 'max_orders_per_day',
        currentUsage: 50,
        limitValue: 100,
        remaining: 50,
        usagePercentage: 50,
      };

      (resolver as any).limitService = {
        checkLimit: async () => mockResult,
      };

      const result = await resolver.checkLimit({
        tenantId: 'tenant-1',
        userId: 'user-1',
        limitKey: 'max_orders_per_day',
      });
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(50);
    });
  });

  describe('recordUsage', () => {
    it('should record usage', async () => {
      const mockResult = {
        success: true,
        newUsage: 51,
        limitExceeded: false,
      };

      (resolver as any).limitService = {
        recordUsage: async () => mockResult,
      };

      const result = await resolver.recordUsage({
        tenantId: 'tenant-1',
        userId: 'user-1',
        limitKey: 'max_orders_per_day',
        amount: 1,
      });
      expect(result.success).toBe(true);
      expect(result.newUsage).toBe(51);
    });
  });

  describe('resetUsage', () => {
    it('should reset usage', async () => {
      const mockResult = {
        success: true,
        previousUsage: 50,
        newUsage: 0,
      };

      (resolver as any).limitService = {
        resetUsage: async () => mockResult,
      };

      const result = await resolver.resetUsage({
        tenantId: 'tenant-1',
        userId: 'user-1',
        limitKey: 'max_orders_per_day',
      });
      expect(result.success).toBe(true);
      expect(result.newUsage).toBe(0);
    });
  });

  describe('field resolvers', () => {
    it('should resolve isUnlimited field', async () => {
      const limit = { id: 'limit-1', value: -1 };
      const result = await resolver.isUnlimited(limit as any);
      expect(result).toBe(true);
    });

    it('should resolve isNotUnlimited field', async () => {
      const limit = { id: 'limit-1', value: 100 };
      const result = await resolver.isUnlimited(limit as any);
      expect(result).toBe(false);
    });

    it('should resolve usage field', async () => {
      const limit = {
        id: 'limit-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
      };

      (resolver as any).limitService = {
        getUsage: async () => ({
          limitId: 'limit-1',
          usage: 50,
        }),
      };

      const result = await resolver.usage(limit as any);
      expect(result).toBeDefined();
      expect(result.usage).toBe(50);
    });

    it('should resolve usagePercentage field', async () => {
      const limit = {
        id: 'limit-1',
        value: 100,
        tenantId: 'tenant-1',
        userId: 'user-1',
      };

      (resolver as any).limitService = {
        getUsage: async () => ({
          limitId: 'limit-1',
          usage: 75,
        }),
      };

      const result = await resolver.usagePercentage(limit as any);
      expect(result).toBe(75);
    });
  });
});