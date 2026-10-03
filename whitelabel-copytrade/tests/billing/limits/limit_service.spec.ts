import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { LimitService } from '../../../apps/api/src/modules/billing/limits/limit.service';
import {
  LimitPeriod,
  LimitScope,
  LimitStatus,
  LimitType,
} from '../../../apps/api/src/modules/billing/limits/limit.types';
import { MemoryLimitRepository } from './limit.fixtures';

describe('LimitService', () => {
  let repo: MemoryLimitRepository;
  let service: LimitService;

  beforeEach(() => {
    repo = new MemoryLimitRepository();
    service = new LimitService(repo);
  });

  describe('checkLimit', () => {
    it('allows within a hard limit and reports what is left after the request', async () => {
      repo.setUsage('lim-orders', 'user-1', 40);
      const r = await service.checkLimit('orders_per_day', 'tenant-1', 'user-1', 10);
      expect(r).toMatchObject({ allowed: true, used: 40, remaining: 50 });
    });

    it('denies past a hard limit', async () => {
      repo.setUsage('lim-orders', 'user-1', 95);
      const r = await service.checkLimit('orders_per_day', 'tenant-1', 'user-1', 6);
      expect(r).toMatchObject({ allowed: false, used: 95, remaining: 0 });
    });

    it('counts no stored usage as zero', async () => {
      expect((await service.checkLimit('orders_per_day', 'tenant-1', 'user-1', 100)).allowed).toBe(
        true,
      );
      expect((await service.checkLimit('orders_per_day', 'tenant-1', 'user-1', 101)).allowed).toBe(
        false,
      );
    });

    it('soft limits allow but never report negative headroom', async () => {
      repo.setUsage('lim-portfolios', 'user-1', 5);
      expect(await service.checkLimit('max_portfolios', 'tenant-1', 'user-1', 3)).toMatchObject({
        allowed: true,
        remaining: 0,
      });
    });

    it('-1 is unlimited', async () => {
      repo.setUsage('lim-exchanges', 'user-1', 1_000);
      expect(await service.checkLimit('max_exchanges', 'tenant-1', 'user-1', 1_000)).toMatchObject({
        allowed: true,
        remaining: -1,
      });
    });

    it('a limit that is not ACTIVE denies', async () => {
      expect(await service.checkLimit('max_strategies', 'tenant-1', 'user-1')).toMatchObject({
        allowed: false,
        remaining: 0,
      });
    });

    it("uses the caller tenant's definition of a key, never another tenant's", async () => {
      // tenant-2 defines orders_per_day = 1; tenant-1 = 100
      expect((await service.checkLimit('orders_per_day', 'tenant-1', 'user-1', 50)).allowed).toBe(
        true,
      );
      expect((await service.checkLimit('orders_per_day', 'tenant-2', 'user-1', 2)).allowed).toBe(
        false,
      );
    });

    it('an unknown key is an error, not an implicit allow', async () => {
      await expect(service.checkLimit('nope', 'tenant-1', 'user-1')).rejects.toThrow(
        'Limit not found with key: nope',
      );
    });

    it('burst policy stretches a hard limit by its percentage only', async () => {
      const bursty = new LimitService(repo, { allowBurst: true, burstPercentage: 10 });
      repo.setUsage('lim-orders', 'user-1', 100);
      expect((await bursty.checkLimit('orders_per_day', 'tenant-1', 'user-1', 10)).allowed).toBe(
        true,
      );
      expect((await bursty.checkLimit('orders_per_day', 'tenant-1', 'user-1', 11)).allowed).toBe(
        false,
      );
    });
  });

  describe('recordUsage', () => {
    it('adds usage when allowed', async () => {
      await service.recordUsage('orders_per_day', 'tenant-1', 'user-1', 3);
      const usage = await service.recordUsage('orders_per_day', 'tenant-1', 'user-1', 2);
      expect(usage.used).toBe(5);
    });

    it('refuses and stores nothing when it would exceed the limit', async () => {
      repo.setUsage('lim-orders', 'user-1', 99);
      await expect(service.recordUsage('orders_per_day', 'tenant-1', 'user-1', 2)).rejects.toThrow(
        'Limit exceeded: orders_per_day',
      );
      expect((await repo.getUsage('lim-orders', 'user-1'))!.used).toBe(99);
    });
  });

  describe('definitions', () => {
    const valid = {
      key: 'max_bots',
      name: 'Bots',
      description: 'Maximum bots',
      type: LimitType.HARD,
      scope: LimitScope.USER,
      period: LimitPeriod.LIFETIME,
      value: 3,
      unit: 'bots',
    };

    it('creates a valid limit in the given tenant', async () => {
      const created = await service.createLimit(valid, 'tenant-1');
      expect(created).toMatchObject({ key: 'max_bots', tenantId: 'tenant-1', value: 3 });
    });

    it('rejects an invalid definition with every problem listed', async () => {
      await expect(
        service.createLimit(
          { ...valid, key: '', unit: ' ', value: -2, type: 'bogus' as LimitType },
          'tenant-1',
        ),
      ).rejects.toThrow(
        'Validation failed: Limit key is required, Invalid limit type, Limit value must be -1 (unlimited) or a positive number, Limit unit is required',
      );
    });

    it('rejects a duplicate key within a tenant but not across tenants', async () => {
      await expect(
        service.createLimit({ ...valid, key: 'orders_per_day' }, 'tenant-1'),
      ).rejects.toThrow("Limit with key 'orders_per_day' already exists");
      await expect(
        service.createLimit({ ...valid, key: 'max_portfolios' }, 'tenant-2'),
      ).resolves.toMatchObject({ tenantId: 'tenant-2' });
    });

    it('get / update / delete by id are confined to the tenant when one is given', async () => {
      await expect(service.getLimit('lim-other-tenant', 'tenant-1')).rejects.toThrow(
        'Limit not found: lim-other-tenant',
      );
      await expect(
        service.updateLimit('lim-other-tenant', { value: 1_000 }, 'tenant-1'),
      ).rejects.toThrow('Limit not found');
      await expect(service.deleteLimit('lim-other-tenant', 'tenant-1')).rejects.toThrow(
        'Limit not found',
      );
      expect(repo.limits.get('lim-other-tenant')!.value).toBe(1);

      expect((await service.getLimit('lim-orders', 'tenant-1')).key).toBe('orders_per_day');
      expect((await service.updateLimit('lim-orders', { value: 150 }, 'tenant-1')).value).toBe(150);
      await service.deleteLimit('lim-orders', 'tenant-1');
      expect(repo.limits.has('lim-orders')).toBe(false);
    });

    it('update applies the same value rule as create', async () => {
      await expect(service.updateLimit('lim-orders', { value: -5 }, 'tenant-1')).rejects.toThrow(
        'Limit value must be -1 (unlimited) or a positive number',
      );
      expect((await service.updateLimit('lim-orders', { value: -1 }, 'tenant-1')).value).toBe(-1);
    });

    it("lists the tenant's limits with filters", async () => {
      const hard = await service.listLimits(
        { type: LimitType.HARD, status: LimitStatus.ACTIVE },
        'tenant-1',
      );
      expect(hard.map((l) => l.key).sort()).toEqual([
        'max_exchanges',
        'max_order_value',
        'orders_per_day',
      ]);
    });
  });

  describe('usage reporting', () => {
    beforeEach(() => {
      repo.setUsage('lim-orders', 'user-1', 100);
      repo.setUsage('lim-value', 'user-1', 8_500);
      repo.setUsage('lim-portfolios', 'user-1', 1);
      repo.setUsage('lim-exchanges', 'user-1', 50);
    });

    it('hasExceededHardLimits lists hard limits at or over their value (not soft, not unlimited)', async () => {
      expect(await service.hasExceededHardLimits('user-1', 'user', 'tenant-1')).toEqual({
        exceeded: true,
        limits: ['orders_per_day'],
      });
    });

    it('getLimitsNearThreshold uses the given threshold, including an explicit 0', async () => {
      const at80 = await service.getLimitsNearThreshold('user-1', 'user', 'tenant-1', 80);
      expect(at80.map((l) => l.limit.key)).toEqual(['orders_per_day', 'max_order_value']);
      const at0 = await service.getLimitsNearThreshold('user-1', 'user', 'tenant-1', 0);
      expect(at0).toHaveLength(4);
    });
  });

  describe('resets', () => {
    let errorSpy: ReturnType<typeof jest.spyOn>;
    beforeEach(() => {
      errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => errorSpy.mockRestore());

    it('bulkResetExpiredLimits resets only usages whose reset time has passed', async () => {
      repo.setUsage('lim-orders', 'user-1', 80, { resetAt: new Date(Date.now() - 1_000) });
      repo.setUsage('lim-value', 'user-1', 500, { resetAt: new Date(Date.now() + 60_000) });
      repo.setUsage('lim-portfolios', 'user-1', 2);
      const results = await service.bulkResetExpiredLimits('user-1', 'user', 'tenant-1');
      expect(results).toEqual([
        expect.objectContaining({ limitId: 'lim-orders', previousUsed: 80 }),
      ]);
      expect(repo.resetCalls).toEqual([{ limitId: 'lim-orders', entityId: 'user-1' }]);
    });

    it("resetUsage resolves the key in the caller's tenant", async () => {
      repo.setUsage('lim-orders', 'user-1', 7);
      const r = await service.resetUsage('orders_per_day', 'tenant-1', 'user-1');
      expect(r).toMatchObject({ limitId: 'lim-orders', previousUsed: 7 });
    });
  });

  describe('checkRateLimit', () => {
    const config = { requests: 5, window: 60 };

    it('allows with no recorded usage', async () => {
      expect(
        await service.checkRateLimit('api_requests_per_minute', 'tenant-1', 'user-1', config),
      ).toEqual({ allowed: true });
    });

    it('denies inside the window at the request cap, with a retry hint', async () => {
      repo.setUsage('lim-api', 'user-1', 5, { lastUsedAt: new Date(Date.now() - 10_000) });
      const r = await service.checkRateLimit(
        'api_requests_per_minute',
        'tenant-1',
        'user-1',
        config,
      );
      expect(r.allowed).toBe(false);
      expect(r.retryAfter).toBeGreaterThanOrEqual(49);
      expect(r.retryAfter).toBeLessThanOrEqual(50);
    });

    it('allows again once the window has elapsed', async () => {
      repo.setUsage('lim-api', 'user-1', 5, { lastUsedAt: new Date(Date.now() - 61_000) });
      expect(
        (await service.checkRateLimit('api_requests_per_minute', 'tenant-1', 'user-1', config))
          .allowed,
      ).toBe(true);
    });
  });
});
