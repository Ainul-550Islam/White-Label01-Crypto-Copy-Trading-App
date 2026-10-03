import { describe, it, expect, beforeEach } from '@jest/globals';
import { EntitlementService } from '../../../apps/api/src/modules/billing/entitlements/entitlement.service';
import {
  EntitlementSource,
  EntitlementStatus,
} from '../../../apps/api/src/modules/billing/entitlements/entitlement.types';
import { DAY, makeEntitlement, MemoryEntitlementRepository } from './entitlement.fixtures';

describe('EntitlementService', () => {
  let repo: MemoryEntitlementRepository;
  let service: EntitlementService;

  beforeEach(() => {
    repo = new MemoryEntitlementRepository();
    service = new EntitlementService(repo);
  });

  describe('checkFeatureAccess', () => {
    it('allows an enabled feature on an active entitlement', async () => {
      repo.rows.set('ent-1', makeEntitlement());
      const access = await service.checkFeatureAccess('user-1', 'tenant-1', 'copy_trading');
      expect(access).toEqual({ featureKey: 'copy_trading', allowed: true });
    });

    it('denies a disabled feature', async () => {
      repo.rows.set('ent-1', makeEntitlement());
      const access = await service.checkFeatureAccess('user-1', 'tenant-1', 'api_access');
      expect(access.allowed).toBe(false);
      expect(access.reason).toBe('Feature not enabled');
    });

    it('denies a feature the plan does not contain', async () => {
      repo.rows.set('ent-1', makeEntitlement());
      const access = await service.checkFeatureAccess('user-1', 'tenant-1', 'white_label');
      expect(access.allowed).toBe(false);
      expect(access.reason).toBe('Feature not enabled');
    });

    it('denies everything when the entitlement is suspended', async () => {
      repo.rows.set('ent-1', makeEntitlement({ status: EntitlementStatus.SUSPENDED }));
      const access = await service.checkFeatureAccess('user-1', 'tenant-1', 'copy_trading');
      expect(access.allowed).toBe(false);
      expect(access.reason).toBe('Entitlement is not active');
    });

    it('denies when the user has no entitlement', async () => {
      const access = await service.checkFeatureAccess('user-1', 'tenant-1', 'copy_trading');
      expect(access).toEqual({
        featureKey: 'copy_trading',
        allowed: false,
        reason: 'No entitlement found',
      });
    });

    it("does not read another tenant's entitlement for the same user id", async () => {
      repo.rows.set('ent-1', makeEntitlement({ tenantId: 'tenant-2' }));
      const access = await service.checkFeatureAccess('user-1', 'tenant-1', 'copy_trading');
      expect(access.allowed).toBe(false);
    });

    it('keeps access inside the 7-day grace period after expiry, not after it', async () => {
      repo.rows.set('ent-1', makeEntitlement({ expiresAt: new Date(Date.now() - 3 * DAY) }));
      expect((await service.checkFeatureAccess('user-1', 'tenant-1', 'copy_trading')).allowed).toBe(
        true,
      );

      repo.rows.set('ent-1', makeEntitlement({ expiresAt: new Date(Date.now() - 8 * DAY) }));
      expect((await service.checkFeatureAccess('user-1', 'tenant-1', 'copy_trading')).allowed).toBe(
        false,
      );
    });

    it('honours a policy without grace period', async () => {
      const strict = new EntitlementService(repo, { allowGracePeriod: false });
      repo.rows.set('ent-1', makeEntitlement({ expiresAt: new Date(Date.now() - 60 * 1000) }));
      expect((await strict.checkFeatureAccess('user-1', 'tenant-1', 'copy_trading')).allowed).toBe(
        false,
      );
    });

    it('denies before the entitlement starts', async () => {
      repo.rows.set('ent-1', makeEntitlement({ startsAt: new Date(Date.now() + DAY) }));
      expect((await service.checkFeatureAccess('user-1', 'tenant-1', 'copy_trading')).allowed).toBe(
        false,
      );
    });

    it('enforces a per-feature allowance and reports the remainder', async () => {
      repo.rows.set('ent-1', makeEntitlement());
      const one = await service.checkFeatureAccess('user-1', 'tenant-1', 'signals', 1);
      expect(one).toMatchObject({ allowed: true, limit: 10, used: 9, remaining: 0 });

      const two = await service.checkFeatureAccess('user-1', 'tenant-1', 'signals', 2);
      expect(two).toMatchObject({ allowed: false, reason: 'Feature limit exceeded', remaining: 0 });
    });
  });

  describe('checkEntitlement (feature + limit)', () => {
    beforeEach(() => {
      repo.rows.set('ent-1', makeEntitlement());
    });

    it('allows within a hard limit', async () => {
      const r = await service.checkEntitlement(
        'user-1',
        'tenant-1',
        'copy_trading',
        'orders_per_day',
        60,
      );
      expect(r.allowed).toBe(true);
    });

    it('denies past a hard limit', async () => {
      const r = await service.checkEntitlement(
        'user-1',
        'tenant-1',
        'copy_trading',
        'orders_per_day',
        61,
      );
      expect(r.allowed).toBe(false);
      expect(r.reason).toBe('Limit exceeded');
      expect(r.limit?.key).toBe('orders_per_day');
    });

    it('lets a soft limit through', async () => {
      const r = await service.checkEntitlement(
        'user-1',
        'tenant-1',
        'copy_trading',
        'api_calls',
        500,
      );
      expect(r.allowed).toBe(true);
    });

    it('treats -1 as unlimited and an undefined limit as unlimited', async () => {
      expect(
        (await service.checkEntitlement('user-1', 'tenant-1', 'copy_trading', 'exchanges', 10_000))
          .allowed,
      ).toBe(true);
      expect(
        (
          await service.checkEntitlement(
            'user-1',
            'tenant-1',
            'copy_trading',
            'not_defined',
            10_000,
          )
        ).allowed,
      ).toBe(true);
    });

    it('burst allowance extends a hard limit by the configured percentage only', async () => {
      const bursty = new EntitlementService(repo, { allowLimitBurst: true, burstPercentage: 10 });
      // used 40 of 100; burst ceiling 110 -> up to 70 more
      expect(
        (await bursty.checkEntitlement('user-1', 'tenant-1', 'copy_trading', 'orders_per_day', 70))
          .allowed,
      ).toBe(true);
      expect(
        (await bursty.checkEntitlement('user-1', 'tenant-1', 'copy_trading', 'orders_per_day', 71))
          .allowed,
      ).toBe(false);
    });

    it('after the reset time, old usage no longer counts but the allowance still does', async () => {
      repo.rows.set(
        'ent-1',
        makeEntitlement({
          limits: [
            {
              key: 'orders_per_day',
              name: 'Orders per day',
              value: 100,
              used: 100,
              unit: 'orders',
              hardLimit: true,
              resetAt: new Date(Date.now() - 1000),
            },
          ],
        }),
      );
      expect(
        (await service.checkEntitlement('user-1', 'tenant-1', 'copy_trading', 'orders_per_day', 1))
          .allowed,
      ).toBe(true);
      expect(
        (
          await service.checkEntitlement(
            'user-1',
            'tenant-1',
            'copy_trading',
            'orders_per_day',
            100,
          )
        ).allowed,
      ).toBe(true);
      // A single request larger than the whole allowance is still refused.
      expect(
        (
          await service.checkEntitlement(
            'user-1',
            'tenant-1',
            'copy_trading',
            'orders_per_day',
            101,
          )
        ).allowed,
      ).toBe(false);
    });
  });

  describe('recordUsage', () => {
    it("records usage against the user's entitlement", async () => {
      repo.rows.set('ent-1', makeEntitlement());
      await service.recordUsage('user-1', 'tenant-1', 'orders_per_day', 5, { source: 'test' });
      expect(repo.usage).toHaveLength(1);
      expect(repo.usage[0].entitlementId).toBe('ent-1');
      expect(repo.usage[0].record).toMatchObject({
        featureKey: 'orders_per_day',
        amount: 5,
        metadata: { source: 'test' },
      });
    });

    it('rejects usage past the hard limit and records nothing', async () => {
      repo.rows.set('ent-1', makeEntitlement());
      await expect(service.recordUsage('user-1', 'tenant-1', 'orders_per_day', 61)).rejects.toThrow(
        'Limit exceeded',
      );
      expect(repo.usage).toHaveLength(0);
    });

    it('rejects a disabled feature, an inactive entitlement and a missing entitlement', async () => {
      await expect(service.recordUsage('user-1', 'tenant-1', 'copy_trading')).rejects.toThrow(
        'No entitlement found for user',
      );

      repo.rows.set('ent-1', makeEntitlement());
      await expect(service.recordUsage('user-1', 'tenant-1', 'api_access')).rejects.toThrow(
        'Feature not enabled',
      );

      repo.rows.set('ent-1', makeEntitlement({ status: EntitlementStatus.CANCELLED }));
      await expect(service.recordUsage('user-1', 'tenant-1', 'copy_trading')).rejects.toThrow(
        'Entitlement is not active',
      );
      expect(repo.usage).toHaveLength(0);
    });
  });

  describe('lifecycle', () => {
    it('refuses a second active entitlement for the same user and tenant', async () => {
      repo.rows.set('ent-1', makeEntitlement());
      await expect(
        service.createEntitlement({
          tenantId: 'tenant-1',
          userId: 'user-1',
          planId: 'p',
          source: EntitlementSource.PLAN,
        }),
      ).rejects.toThrow('User already has an active entitlement');
    });

    it('creates one when the previous entitlement is cancelled, defaulting startsAt to now', async () => {
      repo.rows.set('ent-1', makeEntitlement({ status: EntitlementStatus.CANCELLED }));
      const before = Date.now();
      await service.createEntitlement({
        tenantId: 'tenant-1',
        userId: 'user-1',
        planId: 'p2',
        source: EntitlementSource.TRIAL,
      });
      expect(repo.created).toHaveLength(1);
      expect(repo.created[0].startsAt!.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('cancel / suspend set the status; reactivate only works from SUSPENDED', async () => {
      repo.rows.set('ent-1', makeEntitlement());
      expect((await service.suspendEntitlement('ent-1')).status).toBe(EntitlementStatus.SUSPENDED);
      expect((await service.reactivateEntitlement('ent-1')).status).toBe(EntitlementStatus.ACTIVE);
      await expect(service.reactivateEntitlement('ent-1')).rejects.toThrow(
        'Only suspended entitlements can be reactivated',
      );
      expect((await service.cancelEntitlement('ent-1')).status).toBe(EntitlementStatus.CANCELLED);
    });

    it('reports a missing entitlement id', async () => {
      await expect(service.getEntitlement('nope')).rejects.toThrow('Entitlement not found: nope');
      await expect(service.updateEntitlement('nope', {})).rejects.toThrow(
        'Entitlement not found: nope',
      );
      await expect(service.cancelEntitlement('nope')).rejects.toThrow(
        'Entitlement not found: nope',
      );
    });
  });

  describe('summaries and thresholds', () => {
    it('summarises the entitlement', async () => {
      repo.rows.set('ent-1', makeEntitlement());
      const summary = await service.getEntitlementSummary('user-1', 'tenant-1');
      expect(summary).toMatchObject({
        id: 'ent-1',
        tenantId: 'tenant-1',
        planId: 'plan-premium',
        status: EntitlementStatus.ACTIVE,
        featureCount: 4,
        limitCount: 3,
      });
      expect(await service.getEntitlementSummary('user-9', 'tenant-1')).toBeNull();
    });

    it('lists only enabled, unexpired features', async () => {
      repo.rows.set(
        'ent-1',
        makeEntitlement({
          features: [
            { key: 'a', name: 'A', enabled: true },
            { key: 'b', name: 'B', enabled: false },
            { key: 'c', name: 'C', enabled: true, expiresAt: new Date(Date.now() - 1000) },
          ],
        }),
      );
      expect((await service.getActiveFeatures('user-1', 'tenant-1')).map((f) => f.key)).toEqual([
        'a',
      ]);
    });

    it('finds limits at or above the threshold, ignoring unlimited ones', async () => {
      repo.rows.set('ent-1', makeEntitlement());
      const near = await service.getLimitsNearThreshold('user-1', 'tenant-1', 80);
      expect(near.map((l) => l.key)).toEqual(['api_calls']);
    });

    it("resets usage on the user's entitlement", async () => {
      repo.rows.set('ent-1', makeEntitlement());
      await service.resetUsage('user-1', 'tenant-1', 'orders_per_day');
      expect(repo.resets).toEqual([{ entitlementId: 'ent-1', limitKey: 'orders_per_day' }]);
      await expect(service.resetUsage('user-9', 'tenant-1', 'x')).rejects.toThrow(
        'No entitlement found for user',
      );
    });
  });
});
