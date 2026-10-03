import { describe, it, expect, beforeEach } from '@jest/globals';
import { LimitResolver } from '../../../apps/api/src/modules/billing/limits/limit.resolver';
import { LimitService } from '../../../apps/api/src/modules/billing/limits/limit.service';
import {
  LimitPeriod,
  LimitScope,
  LimitType,
} from '../../../apps/api/src/modules/billing/limits/limit.types';
import { makeLimit, MemoryLimitRepository } from './limit.fixtures';

const ctx = { userId: 'user-1', tenantId: 'tenant-1' };

describe('LimitResolver', () => {
  let repo: MemoryLimitRepository;
  let resolver: LimitResolver;

  beforeEach(() => {
    repo = new MemoryLimitRepository();
    resolver = new LimitResolver(new LimitService(repo));
  });

  describe('queries', () => {
    it("resolves a limit of the caller's tenant by id; another tenant's id resolves to null", async () => {
      expect((await resolver.getLimit('lim-orders', ctx))?.key).toBe('orders_per_day');
      expect(await resolver.getLimit('lim-other-tenant', ctx)).toBeNull();
      expect(await resolver.getLimit('missing', ctx)).toBeNull();
    });

    it("resolves by key inside the caller's tenant", async () => {
      expect((await resolver.getLimitByKey('orders_per_day', ctx))?.value).toBe(100);
      expect(
        (await resolver.getLimitByKey('orders_per_day', { userId: 'u', tenantId: 'tenant-2' }))
          ?.value,
      ).toBe(1);
      expect(await resolver.getLimitByKey('unknown', ctx)).toBeNull();
    });

    it("lists only the caller's tenant", async () => {
      const rows = await resolver.listLimits({}, ctx);
      expect(rows.every((l) => l.tenantId === 'tenant-1')).toBe(true);
      expect(rows).toHaveLength(6);
    });

    it('checkLimit / getUsageSummary / hasExceededHardLimits act on the caller as the entity', async () => {
      repo.setUsage('lim-orders', 'user-1', 100);
      repo.setUsage('lim-orders', 'user-2', 1);
      expect((await resolver.checkLimit('orders_per_day', 1, ctx)).allowed).toBe(false);
      expect((await resolver.getUsageSummary(ctx)).limits).toHaveLength(1);
      expect(await resolver.hasExceededHardLimits(ctx)).toEqual({
        exceeded: true,
        limits: ['orders_per_day'],
      });
      expect((await resolver.getLimitsNearThreshold(50, ctx)).map((l) => l.limit.key)).toEqual([
        'orders_per_day',
      ]);
    });
  });

  describe('mutations', () => {
    it("creates in the caller's tenant", async () => {
      const created = await resolver.createLimit(
        {
          key: 'max_bots',
          name: 'Bots',
          description: 'Maximum bots',
          type: LimitType.HARD,
          scope: LimitScope.USER,
          period: LimitPeriod.LIFETIME,
          value: 2,
          unit: 'bots',
        },
        ctx,
      );
      expect(created.tenantId).toBe('tenant-1');
    });

    it("cannot update or delete another tenant's limit by id", async () => {
      await expect(resolver.updateLimit('lim-other-tenant', { value: 999 }, ctx)).rejects.toThrow(
        'Limit not found',
      );
      expect(await resolver.deleteLimit('lim-other-tenant', ctx)).toBe(false);
      expect(repo.limits.get('lim-other-tenant')).toMatchObject({ value: 1 });
    });

    it('updates and deletes its own limit', async () => {
      expect((await resolver.updateLimit('lim-orders', { value: 250 }, ctx)).value).toBe(250);
      expect(await resolver.deleteLimit('lim-orders', ctx)).toBe(true);
      expect(await resolver.deleteLimit('lim-orders', ctx)).toBe(false);
    });

    it('recordUsage / resetUsage / bulkResetExpiredLimits', async () => {
      expect((await resolver.recordUsage('orders_per_day', 3, ctx)).used).toBe(3);
      expect((await resolver.resetUsage('orders_per_day', ctx)).previousUsed).toBe(3);
      repo.setUsage('lim-value', 'user-1', 10, { resetAt: new Date(Date.now() - 1) });
      expect(await resolver.bulkResetExpiredLimits(ctx)).toHaveLength(1);
    });
  });

  describe('field resolvers', () => {
    const limit = makeLimit({ value: 200 });

    it('usagePercentage caps at 100 and is 0 for unlimited', async () => {
      expect(await resolver.usagePercentage(limit, 50, ctx)).toBe(25);
      expect(await resolver.usagePercentage(limit, 500, ctx)).toBe(100);
      expect(await resolver.usagePercentage(makeLimit({ value: -1 }), 500, ctx)).toBe(0);
    });

    it('severity bands', async () => {
      expect(await resolver.severity(limit, 100, ctx)).toBe('low');
      expect(await resolver.severity(limit, 140, ctx)).toBe('medium');
      expect(await resolver.severity(limit, 180, ctx)).toBe('high');
      expect(await resolver.severity(limit, 200, ctx)).toBe('critical');
    });

    it('isNearThreshold honours an explicit threshold and a zero allowance', async () => {
      expect(await resolver.isNearThreshold(limit, 160, 80, ctx)).toBe(true);
      expect(await resolver.isNearThreshold(limit, 150, 80, ctx)).toBe(false);
      expect(await resolver.isNearThreshold(limit, 0, 0, ctx)).toBe(true);
      expect(await resolver.isNearThreshold(makeLimit({ value: 0 }), 1, 80, ctx)).toBe(true);
      expect(await resolver.isNearThreshold(makeLimit({ value: 0 }), 0, 80, ctx)).toBe(false);
      expect(await resolver.isNearThreshold(makeLimit({ value: -1 }), 1e9, 1, ctx)).toBe(false);
    });

    it('resetTime rolls to the next period boundary (local time)', async () => {
      const last = new Date(2026, 2, 15, 13, 45, 30); // Sun 15 Mar 2026 13:45:30
      expect(
        await resolver.resetTime(makeLimit({ period: LimitPeriod.MINUTE }), last, ctx),
      ).toEqual(new Date(2026, 2, 15, 13, 46, 0));
      expect(await resolver.resetTime(makeLimit({ period: LimitPeriod.HOUR }), last, ctx)).toEqual(
        new Date(2026, 2, 15, 14, 0, 0),
      );
      expect(await resolver.resetTime(makeLimit({ period: LimitPeriod.DAY }), last, ctx)).toEqual(
        new Date(2026, 2, 16, 0, 0, 0),
      );
      expect(await resolver.resetTime(makeLimit({ period: LimitPeriod.MONTH }), last, ctx)).toEqual(
        new Date(2026, 3, 1, 0, 0, 0),
      );
      expect(await resolver.resetTime(makeLimit({ period: LimitPeriod.YEAR }), last, ctx)).toEqual(
        new Date(2027, 0, 1, 0, 0, 0),
      );
      // Weeks roll over at the start of Sunday; from a Sunday that is 7 days on.
      expect(await resolver.resetTime(makeLimit({ period: LimitPeriod.WEEK }), last, ctx)).toEqual(
        new Date(2026, 2, 22, 0, 0, 0),
      );
    });
  });
});
