import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  LimitGuard,
  LimitGuardContext,
} from '../../../apps/api/src/modules/billing/limits/limit.guard';
import { LimitService } from '../../../apps/api/src/modules/billing/limits/limit.service';
import { makeLimit, MemoryLimitRepository, standardLimits } from './limit.fixtures';
import { LimitPeriod, LimitType } from '../../../apps/api/src/modules/billing/limits/limit.types';

const ctx: LimitGuardContext = { userId: 'user-1', tenantId: 'tenant-1' };

describe('LimitGuard', () => {
  let repo: MemoryLimitRepository;
  let guard: LimitGuard;

  beforeEach(() => {
    repo = new MemoryLimitRepository([
      ...standardLimits(),
      makeLimit({
        id: 'lim-strategies-active',
        key: 'max_team_members',
        name: 'Team',
        value: 3,
        unit: 'members',
        period: LimitPeriod.LIFETIME,
      }),
    ]);
    guard = new LimitGuard(new LimitService(repo));
  });

  describe('canPerformAction', () => {
    it('allows within limits and carries the check detail', async () => {
      repo.setUsage('lim-orders', 'user-1', 10);
      const r = await guard.canPerformAction('orders_per_day', ctx, 1);
      expect(r.allowed).toBe(true);
      expect(r.reason).toBeUndefined();
      expect(r.limitCheck).toMatchObject({ used: 10, remaining: 89 });
    });

    it('denies when the hard limit is exceeded', async () => {
      repo.setUsage('lim-orders', 'user-1', 100);
      expect(await guard.canPerformAction('orders_per_day', ctx, 1)).toMatchObject({
        allowed: false,
        reason: 'Limit exceeded: orders_per_day',
      });
    });

    it('allows unlimited limits', async () => {
      repo.setUsage('lim-exchanges', 'user-1', 10_000);
      expect((await guard.canPerformAction('max_exchanges', ctx, 1)).allowed).toBe(true);
    });

    it('fails closed when the limit cannot be resolved', async () => {
      expect(await guard.canPerformAction('unknown_limit', ctx)).toEqual({
        allowed: false,
        reason: 'Failed to check limit: Limit not found with key: unknown_limit',
      });
    });
  });

  describe('checkRateLimit', () => {
    it('allows within the rate and denies at the cap with retryAfter', async () => {
      const config = { requests: 3, window: 60 };
      expect((await guard.checkRateLimit('api_requests_per_minute', config, ctx)).allowed).toBe(
        true,
      );

      repo.setUsage('lim-api', 'user-1', 3, { lastUsedAt: new Date(Date.now() - 1_000) });
      const r = await guard.checkRateLimit('api_requests_per_minute', config, ctx);
      expect(r.allowed).toBe(false);
      expect(r.reason).toBe('Rate limit exceeded: api_requests_per_minute');
      expect(r.retryAfter).toBeGreaterThan(0);
    });

    it('fails closed on an unknown rate limit', async () => {
      const r = await guard.checkRateLimit('nope', { requests: 1, window: 1 }, ctx);
      expect(r.allowed).toBe(false);
      expect(r.reason).toContain('Failed to check rate limit');
    });
  });

  describe('combinations', () => {
    it('checkAllLimits stops at the first exceeded limit', async () => {
      repo.setUsage('lim-value', 'user-1', 10_000);
      expect((await guard.checkAllLimits(['orders_per_day', 'max_exchanges'], ctx)).allowed).toBe(
        true,
      );
      expect(await guard.checkAllLimits(['orders_per_day', 'max_order_value'], ctx)).toMatchObject({
        allowed: false,
        reason: 'Limit exceeded: max_order_value',
      });
    });

    it('checkAnyLimit needs one limit with headroom', async () => {
      repo.setUsage('lim-orders', 'user-1', 100);
      repo.setUsage('lim-value', 'user-1', 10_000);
      expect((await guard.checkAnyLimit(['orders_per_day', 'max_exchanges'], ctx)).allowed).toBe(
        true,
      );
      expect(await guard.checkAnyLimit(['orders_per_day', 'max_order_value'], ctx)).toEqual({
        allowed: false,
        reason: 'All limits exceeded: orders_per_day, max_order_value',
      });
    });
  });

  describe('checkAndRecordUsage', () => {
    it('records only allowed usage', async () => {
      expect((await guard.checkAndRecordUsage('orders_per_day', ctx, 4)).allowed).toBe(true);
      expect((await repo.getUsage('lim-orders', 'user-1'))!.used).toBe(4);

      expect((await guard.checkAndRecordUsage('orders_per_day', ctx, 97)).allowed).toBe(false);
      expect((await repo.getUsage('lim-orders', 'user-1'))!.used).toBe(4);
    });
  });

  describe('domain shortcuts', () => {
    it('canMakeOrder checks the daily order count and then the order value', async () => {
      expect((await guard.canMakeOrder(ctx, 5_000)).allowed).toBe(true);
      expect(await guard.canMakeOrder(ctx, 10_001)).toMatchObject({
        allowed: false,
        reason: 'Limit exceeded: max_order_value',
      });

      repo.setUsage('lim-orders', 'user-1', 100);
      expect(await guard.canMakeOrder(ctx, 1)).toMatchObject({
        allowed: false,
        reason: 'Limit exceeded: orders_per_day',
      });
    });

    it('canAddTeamMember / canAddExchange / canCreatePortfolio map to their limit keys', async () => {
      repo.setUsage('lim-strategies-active', 'user-1', 3);
      expect((await guard.canAddTeamMember(ctx)).allowed).toBe(false);
      expect((await guard.canAddExchange(ctx)).allowed).toBe(true);
      // SOFT limit: over the value is still allowed
      repo.setUsage('lim-portfolios', 'user-1', 9);
      expect((await guard.canCreatePortfolio(ctx)).allowed).toBe(true);
    });

    it('canCreateStrategy is refused while that limit is suspended', async () => {
      expect((await guard.canCreateStrategy(ctx)).allowed).toBe(false);
    });

    it('canMakeApiCall enforces the per-minute request limit (RATE is a cap, not a soft limit)', async () => {
      expect(repo.limits.get('lim-api')!.type).toBe(LimitType.RATE);
      repo.setUsage('lim-api', 'user-1', 59);
      expect((await guard.canMakeApiCall(ctx)).allowed).toBe(true);
      repo.setUsage('lim-api', 'user-1', 60);
      expect(await guard.canMakeApiCall(ctx)).toMatchObject({
        allowed: false,
        reason: 'Limit exceeded: api_requests_per_minute',
      });
    });
  });

  describe('reporting', () => {
    it('hasExceededHardLimits turns exceeded hard limits into a denial', async () => {
      expect(await guard.hasExceededHardLimits(ctx)).toEqual({ allowed: true, reason: undefined });
      repo.setUsage('lim-orders', 'user-1', 100);
      expect(await guard.hasExceededHardLimits(ctx)).toEqual({
        allowed: false,
        reason: 'Hard limits exceeded: orders_per_day',
      });
    });

    it('isNearAnyLimit lists keys over the threshold', async () => {
      repo.setUsage('lim-orders', 'user-1', 85);
      repo.setUsage('lim-value', 'user-1', 100);
      expect(await guard.isNearAnyLimit(ctx, 80)).toEqual({
        nearLimits: true,
        limits: ['orders_per_day'],
      });
      expect(await guard.isNearAnyLimit(ctx, 90)).toEqual({ nearLimits: false, limits: [] });
    });
  });
});
