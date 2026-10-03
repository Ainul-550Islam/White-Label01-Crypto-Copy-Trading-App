import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  EntitlementGuard,
  GuardContext,
} from '../../../apps/api/src/modules/billing/entitlements/entitlement.guard';
import { EntitlementService } from '../../../apps/api/src/modules/billing/entitlements/entitlement.service';
import { EntitlementStatus } from '../../../apps/api/src/modules/billing/entitlements/entitlement.types';
import { makeEntitlement, MemoryEntitlementRepository } from './entitlement.fixtures';

const ctx: GuardContext = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  roles: ['TENANT_ADMIN'],
  permissions: ['billing:read'],
};

describe('EntitlementGuard', () => {
  let repo: MemoryEntitlementRepository;
  let guard: EntitlementGuard;

  beforeEach(() => {
    repo = new MemoryEntitlementRepository();
    repo.rows.set('ent-1', makeEntitlement());
    guard = new EntitlementGuard(new EntitlementService(repo));
  });

  describe('hasFeatureAccess', () => {
    it('allows an enabled feature and returns the access detail', async () => {
      const r = await guard.hasFeatureAccess('copy_trading', ctx);
      expect(r.allowed).toBe(true);
      expect(r.featureAccess?.featureKey).toBe('copy_trading');
    });

    it('denies a disabled feature with the reason', async () => {
      const r = await guard.hasFeatureAccess('api_access', ctx);
      expect(r).toMatchObject({ allowed: false, reason: 'Feature not enabled' });
    });

    it('denies everything on a suspended entitlement', async () => {
      repo.rows.set('ent-1', makeEntitlement({ status: EntitlementStatus.SUSPENDED }));
      const r = await guard.hasFeatureAccess('copy_trading', ctx);
      expect(r).toMatchObject({ allowed: false, reason: 'Entitlement is not active' });
    });

    it('denies an unknown feature', async () => {
      expect((await guard.hasFeatureAccess('white_label', ctx)).allowed).toBe(false);
    });
  });

  describe('hasAllFeatures / hasAnyFeature', () => {
    it('all: allowed only when every feature is accessible, naming the first missing one', async () => {
      expect((await guard.hasAllFeatures(['copy_trading', 'signals'], ctx)).allowed).toBe(true);
      const r = await guard.hasAllFeatures(['copy_trading', 'api_access', 'white_label'], ctx);
      expect(r).toMatchObject({ allowed: false, reason: 'Missing access to feature: api_access' });
    });

    it('any: allowed when one feature is accessible', async () => {
      expect((await guard.hasAnyFeature(['api_access', 'copy_trading'], ctx)).allowed).toBe(true);
      const r = await guard.hasAnyFeature(['api_access', 'white_label'], ctx);
      expect(r).toMatchObject({
        allowed: false,
        reason: 'No access to any of: api_access, white_label',
      });
    });
  });

  describe('roles and permissions come from the verified context only', () => {
    it('hasRole / hasPermission', async () => {
      expect((await guard.hasRole('TENANT_ADMIN', ctx)).allowed).toBe(true);
      expect(await guard.hasRole('PLATFORM_ADMIN', ctx)).toEqual({
        allowed: false,
        reason: 'Missing role: PLATFORM_ADMIN',
      });
      expect((await guard.hasPermission('billing:read', ctx)).allowed).toBe(true);
      expect((await guard.hasPermission('billing:write', ctx)).allowed).toBe(false);
      expect((await guard.hasRole('TENANT_ADMIN', { userId: 'u', tenantId: 't' })).allowed).toBe(
        false,
      );
    });
  });

  describe('limits', () => {
    it('canPerformAction allows within the limit and denies beyond it', async () => {
      expect(
        (await guard.canPerformAction('copy_trading', 'orders_per_day', ctx, 60)).allowed,
      ).toBe(true);
      const r = await guard.canPerformAction('copy_trading', 'orders_per_day', ctx, 61);
      expect(r).toMatchObject({ allowed: false, reason: 'Limit exceeded' });
      expect(r.entitlementCheck?.limit?.key).toBe('orders_per_day');
    });

    it('isNearLimits lists the keys at or above the threshold', async () => {
      expect(await guard.isNearLimits(ctx, 80)).toEqual({
        nearLimits: true,
        limits: ['api_calls'],
      });
      expect(await guard.isNearLimits(ctx, 99)).toEqual({ nearLimits: false, limits: [] });
    });
  });

  describe('checkAndRecordUsage', () => {
    it('records usage only after access is granted', async () => {
      expect((await guard.checkAndRecordUsage('orders_per_day', ctx, 2)).allowed).toBe(true);
      expect(repo.usage).toHaveLength(1);

      expect((await guard.checkAndRecordUsage('api_access', ctx)).allowed).toBe(false);
      expect(repo.usage).toHaveLength(1);
    });

    it('reports a failed usage write as denied, not as success', async () => {
      const r = await guard.checkAndRecordUsage('orders_per_day', ctx, 61);
      expect(r.allowed).toBe(false);
      expect(r.reason).toBe('Failed to record usage: Limit exceeded');
      expect(repo.usage).toHaveLength(0);
    });
  });

  describe('plan changes', () => {
    it('upgrade needs an active entitlement', async () => {
      expect((await guard.canUpgradePlan(ctx)).allowed).toBe(true);
      repo.rows.clear();
      expect(await guard.canUpgradePlan(ctx)).toEqual({
        allowed: false,
        reason: 'No active entitlement to upgrade',
      });
    });

    it('downgrade is allowed when no limit is in use', async () => {
      repo.rows.set(
        'ent-1',
        makeEntitlement({
          limits: [
            {
              key: 'orders_per_day',
              name: 'Orders',
              value: 100,
              used: 0,
              unit: 'orders',
              hardLimit: true,
            },
            {
              key: 'exchanges',
              name: 'Exchanges',
              value: 5,
              used: 0,
              unit: 'accounts',
              hardLimit: true,
            },
          ],
        }),
      );
      expect(await guard.canDowngradePlan(ctx)).toEqual({ allowed: true });
    });

    it('downgrade is refused while limits are in use, and without an entitlement', async () => {
      expect(await guard.canDowngradePlan(ctx)).toEqual({
        allowed: false,
        reason: 'Cannot downgrade: current usage exceeds lower plan limits',
      });
      repo.rows.clear();
      expect((await guard.canDowngradePlan(ctx)).reason).toBe('No active entitlement to downgrade');
    });
  });
});
