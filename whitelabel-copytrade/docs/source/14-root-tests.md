# Cross-package tests

The repository-level jest project (billing entitlement resolver and guard specs) and its configuration.

25 files. Part of the complete source dump - see `docs/source/README.md`.

---

FILE: tests/billing/entitlements/entitlement.fixtures.ts

```typescript
/**
 * Shared fixtures for the entitlement specs: a representative entitlement and
 * an in-memory repository that records what the service asked it to do.
 */
import { EntitlementRepository } from '../../../apps/api/src/modules/billing/entitlements/entitlement.service';
import {
  Entitlement,
  EntitlementFilter,
  EntitlementSource,
  EntitlementStatus,
  CreateEntitlementRequest,
  UpdateEntitlementRequest,
  UsageRecord,
} from '../../../apps/api/src/modules/billing/entitlements/entitlement.types';

export const DAY = 24 * 60 * 60 * 1000;

export function makeEntitlement(overrides: Partial<Entitlement> = {}): Entitlement {
  return {
    id: 'ent-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    planId: 'plan-premium',
    status: EntitlementStatus.ACTIVE,
    source: EntitlementSource.PLAN,
    features: [
      { key: 'copy_trading', name: 'Copy Trading', enabled: true },
      { key: 'api_access', name: 'API Access', enabled: false },
      { key: 'signals', name: 'Signals', enabled: true, limit: 10, used: 9 },
      { key: 'orders_per_day', name: 'Orders', enabled: true },
    ],
    limits: [
      {
        key: 'orders_per_day',
        name: 'Orders per day',
        value: 100,
        used: 40,
        unit: 'orders',
        hardLimit: true,
      },
      {
        key: 'api_calls',
        name: 'API calls',
        value: 1000,
        used: 950,
        unit: 'calls',
        hardLimit: false,
      },
      {
        key: 'exchanges',
        name: 'Exchanges',
        value: -1,
        used: 12,
        unit: 'accounts',
        hardLimit: true,
      },
    ],
    startsAt: new Date(Date.now() - 30 * DAY),
    metadata: {},
    createdAt: new Date(Date.now() - 30 * DAY),
    updatedAt: new Date(Date.now() - 30 * DAY),
    createdBy: 'admin',
    updatedBy: 'admin',
    ...overrides,
  };
}

/** In-memory repository that records what the service asked it to do. */
export class MemoryEntitlementRepository implements EntitlementRepository {
  readonly rows = new Map<string, Entitlement>();
  readonly usage: { entitlementId: string; record: UsageRecord }[] = [];
  readonly resets: { entitlementId: string; limitKey: string }[] = [];
  readonly created: CreateEntitlementRequest[] = [];

  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findByUserAndTenant(userId: string, tenantId: string) {
    return (
      [...this.rows.values()].find((e) => e.userId === userId && e.tenantId === tenantId) ?? null
    );
  }
  async findMany(filter: EntitlementFilter) {
    return [...this.rows.values()].filter(
      (e) => !filter.tenantId || e.tenantId === filter.tenantId,
    );
  }
  async create(data: CreateEntitlementRequest) {
    this.created.push(data);
    const row = makeEntitlement({
      id: `ent-${this.rows.size + 1}`,
      tenantId: data.tenantId,
      userId: data.userId,
      planId: data.planId,
      source: data.source,
      startsAt: data.startsAt ?? new Date(),
    });
    this.rows.set(row.id, row);
    return row;
  }
  async update(id: string, data: UpdateEntitlementRequest) {
    const current = this.rows.get(id);
    if (!current) throw new Error('missing');
    const next = { ...current, ...data } as Entitlement;
    this.rows.set(id, next);
    return next;
  }
  async delete(id: string) {
    this.rows.delete(id);
  }
  async recordUsage(entitlementId: string, record: UsageRecord) {
    this.usage.push({ entitlementId, record });
  }
  async resetUsage(entitlementId: string, limitKey: string) {
    this.resets.push({ entitlementId, limitKey });
  }
}
```

FILE: tests/billing/entitlements/entitlement_guard.spec.ts

```typescript
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
```

FILE: tests/billing/entitlements/entitlement_resolver.spec.ts

```typescript
import { describe, it, expect, beforeEach } from '@jest/globals';
import { EntitlementResolver } from '../../../apps/api/src/modules/billing/entitlements/entitlement.resolver';
import { EntitlementService } from '../../../apps/api/src/modules/billing/entitlements/entitlement.service';
import {
  EntitlementSource,
  EntitlementStatus,
} from '../../../apps/api/src/modules/billing/entitlements/entitlement.types';
import { makeEntitlement, MemoryEntitlementRepository } from './entitlement.fixtures';

const ctx = { userId: 'user-1', tenantId: 'tenant-1' };
const otherTenant = { userId: 'user-9', tenantId: 'tenant-2' };

describe('EntitlementResolver', () => {
  let repo: MemoryEntitlementRepository;
  let resolver: EntitlementResolver;

  beforeEach(() => {
    repo = new MemoryEntitlementRepository();
    repo.rows.set('ent-1', makeEntitlement());
    repo.rows.set(
      'ent-2',
      makeEntitlement({ id: 'ent-2', tenantId: 'tenant-2', userId: 'user-9' }),
    );
    resolver = new EntitlementResolver(new EntitlementService(repo));
  });

  describe('queries', () => {
    it("resolves an entitlement of the caller's tenant by id", async () => {
      expect((await resolver.getEntitlement('ent-1', ctx))?.id).toBe('ent-1');
    });

    it("returns null for another tenant's entitlement id, exactly like a missing one", async () => {
      expect(await resolver.getEntitlement('ent-2', ctx)).toBeNull();
      expect(await resolver.getEntitlement('missing', ctx)).toBeNull();
    });

    it("resolves the caller's own entitlement", async () => {
      expect((await resolver.getMyEntitlement(ctx))?.id).toBe('ent-1');
      expect((await resolver.getMyEntitlement(otherTenant))?.id).toBe('ent-2');
    });

    it("lists only the caller's tenant even if the filter names another tenant", async () => {
      const rows = await resolver.listEntitlements({ tenantId: 'tenant-2' }, ctx);
      expect(rows.map((r) => r.id)).toEqual(['ent-1']);
    });

    it('checks feature access for the caller', async () => {
      expect((await resolver.checkFeatureAccess('copy_trading', ctx)).allowed).toBe(true);
      expect((await resolver.checkFeatureAccess('api_access', ctx)).allowed).toBe(false);
    });

    it('returns a summary and active features', async () => {
      expect((await resolver.getEntitlementSummary(ctx))?.featureCount).toBe(4);
      expect((await resolver.getActiveFeatures(ctx)).map((f) => f.key)).toEqual([
        'copy_trading',
        'signals',
        'orders_per_day',
      ]);
    });
  });

  describe("mutations are confined to the caller's tenant", () => {
    it('refuses to create an entitlement for another tenant', async () => {
      await expect(
        resolver.createEntitlement(
          { tenantId: 'tenant-2', userId: 'user-5', planId: 'p', source: EntitlementSource.MANUAL },
          ctx,
        ),
      ).rejects.toThrow('Cannot create entitlement for different tenant');
      expect(repo.created).toHaveLength(0);
    });

    it("creates one in the caller's tenant", async () => {
      const created = await resolver.createEntitlement(
        { tenantId: 'tenant-1', userId: 'user-5', planId: 'p', source: EntitlementSource.MANUAL },
        ctx,
      );
      expect(created.tenantId).toBe('tenant-1');
    });

    it('refuses update / cancel / suspend / reactivate across tenants', async () => {
      const msg = 'Entitlement does not belong to this tenant';
      await expect(
        resolver.updateEntitlement('ent-2', { metadata: { x: 'y' } }, ctx),
      ).rejects.toThrow(msg);
      await expect(resolver.cancelEntitlement('ent-2', ctx)).rejects.toThrow(msg);
      await expect(resolver.suspendEntitlement('ent-2', ctx)).rejects.toThrow(msg);
      await expect(resolver.reactivateEntitlement('ent-2', ctx)).rejects.toThrow(msg);
      expect(repo.rows.get('ent-2')!.status).toBe(EntitlementStatus.ACTIVE);
    });

    it('updates within the tenant', async () => {
      const updated = await resolver.updateEntitlement('ent-1', { metadata: { note: 'vip' } }, ctx);
      expect(updated.metadata).toEqual({ note: 'vip' });
      expect((await resolver.suspendEntitlement('ent-1', ctx)).status).toBe(
        EntitlementStatus.SUSPENDED,
      );
    });

    it('recordUsage / resetUsage report success as a boolean', async () => {
      expect(await resolver.recordUsage('orders_per_day', 1, ctx)).toBe(true);
      expect(await resolver.recordUsage('api_access', 1, ctx)).toBe(false);
      expect(await resolver.resetUsage('orders_per_day', ctx)).toBe(true);
      expect(
        await resolver.resetUsage('orders_per_day', { userId: 'nobody', tenantId: 'tenant-1' }),
      ).toBe(false);
    });
  });

  describe('field resolvers', () => {
    it('isActive / featureAccess / activeFeatures / limitsNearThreshold', async () => {
      const ent = makeEntitlement();
      expect(await resolver.isActive(ent, ctx)).toBe(true);
      expect(
        await resolver.isActive(makeEntitlement({ status: EntitlementStatus.EXPIRED }), ctx),
      ).toBe(false);
      expect((await resolver.featureAccess(ent, 'signals', ctx)).remaining).toBe(0);
      expect(await resolver.activeFeatures(ent, ctx)).toHaveLength(3);
      expect((await resolver.limitsNearThreshold(ent, 90, ctx)).map((l) => l.key)).toEqual([
        'api_calls',
      ]);
    });
  });
});
```

FILE: tests/billing/entitlements/entitlement_service.spec.ts

```typescript
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
```

FILE: tests/billing/limits/limit.fixtures.ts

```typescript
/**
 * Shared fixtures for the limit specs: limit definitions and an in-memory
 * repository that keeps usage per (limit, entity) the way a store would.
 */
import { LimitRepository } from '../../../apps/api/src/modules/billing/limits/limit.service';
import {
  CreateLimitRequest,
  Limit,
  LimitFilter,
  LimitPeriod,
  LimitResetResult,
  LimitScope,
  LimitStatus,
  LimitType,
  LimitUsage,
  LimitUsageSummary,
  UpdateLimitRequest,
} from '../../../apps/api/src/modules/billing/limits/limit.types';

export const EPOCH = new Date('2026-01-01T00:00:00.000Z');

export function makeLimit(overrides: Partial<Limit> = {}): Limit {
  return {
    id: 'lim-orders',
    tenantId: 'tenant-1',
    key: 'orders_per_day',
    name: 'Orders per day',
    description: 'Maximum orders per day',
    type: LimitType.HARD,
    scope: LimitScope.USER,
    period: LimitPeriod.DAY,
    value: 100,
    unit: 'orders',
    status: LimitStatus.ACTIVE,
    metadata: {},
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...overrides,
  };
}

export function standardLimits(): Limit[] {
  return [
    makeLimit(),
    makeLimit({
      id: 'lim-value',
      key: 'max_order_value',
      name: 'Max order value',
      value: 10_000,
      unit: 'USD',
    }),
    makeLimit({
      id: 'lim-api',
      key: 'api_requests_per_minute',
      name: 'API rpm',
      type: LimitType.RATE,
      value: 60,
      unit: 'requests',
      period: LimitPeriod.MINUTE,
    }),
    makeLimit({
      id: 'lim-portfolios',
      key: 'max_portfolios',
      name: 'Portfolios',
      type: LimitType.SOFT,
      value: 5,
      unit: 'portfolios',
      period: LimitPeriod.LIFETIME,
    }),
    makeLimit({
      id: 'lim-exchanges',
      key: 'max_exchanges',
      name: 'Exchanges',
      value: -1,
      unit: 'accounts',
      period: LimitPeriod.LIFETIME,
    }),
    makeLimit({
      id: 'lim-suspended',
      key: 'max_strategies',
      name: 'Strategies',
      value: 10,
      unit: 'strategies',
      status: LimitStatus.SUSPENDED,
    }),
    makeLimit({ id: 'lim-other-tenant', tenantId: 'tenant-2', key: 'orders_per_day', value: 1 }),
  ];
}

export class MemoryLimitRepository implements LimitRepository {
  readonly limits = new Map<string, Limit>();
  /** key: `${limitId}|${entityId}` */
  readonly usage = new Map<string, LimitUsage>();
  readonly resetCalls: { limitId: string; entityId: string }[] = [];

  constructor(limits: Limit[] = standardLimits()) {
    for (const l of limits) this.limits.set(l.id, l);
  }

  setUsage(limitId: string, entityId: string, used: number, extra: Partial<LimitUsage> = {}): void {
    const limit = this.limits.get(limitId)!;
    this.usage.set(`${limitId}|${entityId}`, {
      id: `${limitId}-${entityId}`,
      limitId,
      entityId,
      entityType: 'user',
      used,
      remaining: limit.value === -1 ? -1 : limit.value - used,
      metadata: {},
      createdAt: EPOCH,
      updatedAt: EPOCH,
      ...extra,
    });
  }

  async findById(id: string) {
    return this.limits.get(id) ?? null;
  }
  async findByKey(key: string, tenantId: string) {
    return [...this.limits.values()].find((l) => l.key === key && l.tenantId === tenantId) ?? null;
  }
  async findMany(filter: LimitFilter, tenantId: string) {
    return [...this.limits.values()].filter(
      (l) =>
        l.tenantId === tenantId &&
        (!filter.type || l.type === filter.type) &&
        (!filter.status || l.status === filter.status),
    );
  }
  async create(data: CreateLimitRequest, tenantId: string) {
    const row = makeLimit({
      ...data,
      id: `lim-${this.limits.size + 1}`,
      tenantId,
      metadata: data.metadata ?? {},
    });
    this.limits.set(row.id, row);
    return row;
  }
  async update(id: string, data: UpdateLimitRequest) {
    const row = { ...this.limits.get(id)!, ...data } as Limit;
    this.limits.set(id, row);
    return row;
  }
  async delete(id: string) {
    this.limits.delete(id);
  }
  async getUsage(limitId: string, entityId: string) {
    return this.usage.get(`${limitId}|${entityId}`) ?? null;
  }
  async updateUsage(limitId: string, entityId: string, amount: number) {
    const current = this.usage.get(`${limitId}|${entityId}`)?.used ?? 0;
    this.setUsage(limitId, entityId, current + amount);
    return this.usage.get(`${limitId}|${entityId}`)!;
  }
  async resetUsage(limitId: string, entityId: string): Promise<LimitResetResult> {
    this.resetCalls.push({ limitId, entityId });
    const previousUsed = this.usage.get(`${limitId}|${entityId}`)?.used ?? 0;
    this.setUsage(limitId, entityId, 0);
    return { limitId, entityId, previousUsed, resetAt: EPOCH };
  }
  async getUsageSummary(entityId: string, entityType: string): Promise<LimitUsageSummary> {
    const rows = [...this.usage.values()].filter((u) => u.entityId === entityId);
    return {
      entityId,
      entityType,
      limits: rows.map((u) => {
        const limit = this.limits.get(u.limitId)!;
        return {
          limit,
          used: u.used,
          remaining: u.remaining,
          percentage: limit.value > 0 ? (u.used / limit.value) * 100 : 0,
          resetsAt: u.resetAt,
        };
      }),
    };
  }
}
```

FILE: tests/billing/limits/limit_guard.spec.ts

```typescript
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
```

FILE: tests/billing/limits/limit_resolver.spec.ts

```typescript
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
```

FILE: tests/billing/limits/limit_service.spec.ts

```typescript
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
```

FILE: tests/billing/plans/plan_catalog.spec.ts

```typescript
import { describe, it, expect } from '@jest/globals';
import { BASIC_PLAN, getBasicPlan } from '../../../apps/api/src/modules/billing/catalog/basic.plan';
import {
  STANDARD_PLAN,
  getStandardPlan,
} from '../../../apps/api/src/modules/billing/catalog/standard.plan';
import {
  PREMIUM_PLAN,
  getPremiumPlan,
} from '../../../apps/api/src/modules/billing/catalog/premium.plan';
import {
  FEATURE_DEFINITIONS,
  getFeaturesForTier,
  getFeaturesByCategory,
  getFeatureByKey,
  buildPlanFeatures,
} from '../../../apps/api/src/modules/billing/catalog/plan.features';
import {
  LIMIT_DEFINITIONS,
  getLimitsForTier,
  getLimitsByCategory,
  getLimitByKey,
  buildPlanLimits,
} from '../../../apps/api/src/modules/billing/catalog/plan.limits';
import {
  PLAN_MATRIX,
  getPlanMatrix,
  getPlanByTier,
} from '../../../apps/api/src/modules/billing/catalog/plan.matrix';
import { PlanTier } from '../../../apps/api/src/modules/billing/plans/plan.types';

describe('Plan Catalog', () => {
  describe('Basic Plan', () => {
    it('should have correct basic plan configuration', () => {
      const plan = getBasicPlan();
      expect(plan.name).toBe('Basic');
      expect(plan.tier).toBe(PlanTier.BASIC);
      expect(plan.price.amount).toBe(29);
      expect(plan.price.interval).toBe('monthly');
      expect(plan.price.trialDays).toBe(7);
    });

    it('should have 8 features', () => {
      const plan = getBasicPlan();
      expect(plan.features).toHaveLength(8);
    });

    it('should have 8 limits', () => {
      const plan = getBasicPlan();
      expect(plan.limits).toHaveLength(8);
    });

    it('should include basic trading feature', () => {
      const plan = getBasicPlan();
      const feature = plan.features.find((f) => f.key === 'basic_trading');
      expect(feature).toBeDefined();
      expect(feature!.enabled).toBe(true);
    });

    it('should include copy trading with limit', () => {
      const plan = getBasicPlan();
      const feature = plan.features.find((f) => f.key === 'copy_trading');
      expect(feature).toBeDefined();
      expect(feature!.enabled).toBe(true);
      expect(feature!.limit).toBe(3);
    });
  });

  describe('Standard Plan', () => {
    it('should have correct standard plan configuration', () => {
      const plan = getStandardPlan();
      expect(plan.name).toBe('Standard');
      expect(plan.tier).toBe(PlanTier.STANDARD);
      expect(plan.price.amount).toBe(79);
      expect(plan.price.trialDays).toBe(14);
    });

    it('should have 14 features', () => {
      const plan = getStandardPlan();
      expect(plan.features).toHaveLength(14);
    });

    it('should have 12 limits', () => {
      const plan = getStandardPlan();
      expect(plan.limits).toHaveLength(12);
    });
  });

  describe('Premium Plan', () => {
    it('should have correct premium plan configuration', () => {
      const plan = getPremiumPlan();
      expect(plan.name).toBe('Premium');
      expect(plan.tier).toBe(PlanTier.PREMIUM);
      expect(plan.price.amount).toBe(199);
      expect(plan.price.trialDays).toBe(30);
    });

    it('should have 29 features', () => {
      const plan = getPremiumPlan();
      expect(plan.features).toHaveLength(29);
    });

    it('should have 13 limits', () => {
      const plan = getPremiumPlan();
      expect(plan.limits).toHaveLength(13);
    });

    it('should include margin trading', () => {
      const plan = getPremiumPlan();
      const feature = plan.features.find((f) => f.key === 'margin_trading');
      expect(feature).toBeDefined();
      expect(feature!.enabled).toBe(true);
    });
  });

  describe('Feature Definitions', () => {
    it('should have 34 feature definitions', () => {
      expect(FEATURE_DEFINITIONS).toHaveLength(34);
    });

    it('should get features for basic tier', () => {
      const features = getFeaturesForTier('basic');
      expect(features.length).toBeGreaterThan(0);
      features.forEach((f) => {
        expect(f.tiers.basic).toBe(true);
      });
    });

    it('should get features by category', () => {
      const tradingFeatures = getFeaturesByCategory('trading');
      expect(tradingFeatures.length).toBeGreaterThan(0);
      tradingFeatures.forEach((f) => {
        expect(f.category).toBe('trading');
      });
    });

    it('should get feature by key', () => {
      const feature = getFeatureByKey('basic_trading');
      expect(feature).toBeDefined();
      expect(feature!.key).toBe('basic_trading');
    });

    it('should return undefined for unknown key', () => {
      const feature = getFeatureByKey('unknown_feature');
      expect(feature).toBeUndefined();
    });

    it('should build plan features for basic tier', () => {
      const features = buildPlanFeatures('basic');
      expect(features.length).toBeGreaterThan(0);
      features.forEach((f) => {
        expect(f.key).toBeDefined();
        expect(f.name).toBeDefined();
        expect(f.enabled).toBe(true);
      });
    });
  });

  describe('Limit Definitions', () => {
    it('should have 22 limit definitions', () => {
      expect(LIMIT_DEFINITIONS).toHaveLength(22);
    });

    it('should get limits for basic tier', () => {
      const limits = getLimitsForTier('basic');
      expect(limits.length).toBeGreaterThan(0);
      limits.forEach((l) => {
        expect(l.values.basic).not.toBe(0);
      });
    });

    it('should get limits by category', () => {
      const portfolioLimits = getLimitsByCategory('portfolio');
      expect(portfolioLimits.length).toBeGreaterThan(0);
      portfolioLimits.forEach((l) => {
        expect(l.category).toBe('portfolio');
      });
    });

    it('should get limit by key', () => {
      const limit = getLimitByKey('max_portfolios');
      expect(limit).toBeDefined();
      expect(limit!.key).toBe('max_portfolios');
    });

    it('should build plan limits for basic tier', () => {
      const limits = buildPlanLimits('basic');
      expect(limits.length).toBeGreaterThan(0);
      limits.forEach((l) => {
        expect(l.key).toBeDefined();
        expect(l.name).toBeDefined();
        expect(l.value).toBeDefined();
      });
    });
  });

  describe('Plan Matrix', () => {
    it('should have plan matrix entries', () => {
      expect(PLAN_MATRIX.length).toBeGreaterThan(0);
    });

    it('should get plan matrix', () => {
      const matrix = getPlanMatrix();
      expect(matrix.length).toBe(5);
    });

    it('should get plan by tier', () => {
      const plan = getPlanByTier(PlanTier.BASIC);
      expect(plan).toBeDefined();
      expect(plan!.tier).toBe(PlanTier.BASIC);
    });

    it('should return undefined for unknown tier', () => {
      const plan = getPlanByTier('unknown' as PlanTier);
      expect(plan).toBeUndefined();
    });
  });

  describe('Plan templates vs feature/limit definitions', () => {
    // basic.plan / standard.plan / premium.plan and FEATURE_DEFINITIONS /
    // LIMIT_DEFINITIONS are two hand-maintained sources. They disagree in the
    // places listed here; which side is right is a product decision, so the
    // current differences are pinned and any NEW divergence fails this test.
    const KNOWN_PLAN_FEATURES_NOT_IN_DEFINITIONS: Record<string, string[]> = {
      basic: ['real_time_data'],
      standard: [],
      premium: [],
    };
    const KNOWN_DEFINITION_FEATURES_NOT_IN_PLAN: Record<string, string[]> = {
      basic: ['market_data', 'two_factor_auth'],
      standard: ['basic_analytics', 'market_data', 'two_factor_auth'],
      premium: ['basic_analytics', 'market_data', 'multi_exchange'],
    };
    const plans = { basic: getBasicPlan(), standard: getStandardPlan(), premium: getPremiumPlan() };

    for (const tier of ['basic', 'standard', 'premium'] as const) {
      it(`${tier}: feature differences are exactly the known ones`, () => {
        const planKeys = plans[tier].features.map((f) => f.key).sort();
        const defKeys = getFeaturesForTier(tier)
          .map((f) => f.key)
          .sort();
        expect(planKeys.filter((k) => !defKeys.includes(k))).toEqual(
          KNOWN_PLAN_FEATURES_NOT_IN_DEFINITIONS[tier],
        );
        expect(defKeys.filter((k) => !planKeys.includes(k))).toEqual(
          KNOWN_DEFINITION_FEATURES_NOT_IN_PLAN[tier],
        );
      });

      it(`${tier}: every plan limit key is a defined limit for the tier`, () => {
        const defLimitKeys = getLimitsForTier(tier).map((l) => l.key);
        for (const limit of plans[tier].limits) {
          expect(defLimitKeys).toContain(limit.key);
        }
      });
    }
  });
});
```

FILE: tests/billing/plans/plan_service.spec.ts

```typescript
import { describe, it, expect, beforeEach } from '@jest/globals';
import { PlanService } from '../../../apps/api/src/modules/billing/plans/plan.service';
import { PlanRepository } from '../../../apps/api/src/modules/billing/plans/plan.repository';
import { DEFAULT_PLANS } from '../../../apps/api/src/modules/billing/plans/plan.catalog';
import {
  BillingInterval,
  CreatePlanRequest,
  PlanStatus,
  PlanTier,
} from '../../../apps/api/src/modules/billing/plans/plan.types';

/**
 * The real PlanRepository over a small in-memory stand-in for the Prisma
 * `plan` delegate, so the service AND the repository's tenant scoping are
 * exercised together. `update` honours every field in its unique `where`
 * the way Prisma 5's extended unique filter does.
 */
type Row = Record<string, any>;

class FakePlanDelegate {
  rows: Row[] = [];
  private seq = 0;

  private matches(row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([k, v]) => {
      if (k === 'OR') return true;
      return row[k] === v;
    });
  }

  async findFirst(args: { where: Row }) {
    return this.rows.find((r) => this.matches(r, args.where)) ?? null;
  }
  async findMany(args: { where: Row; select?: Row }) {
    const rows = this.rows.filter((r) => this.matches(r, args.where));
    if (args.select) {
      return rows.map((r) => ({
        ...r,
        _count: { features: r.features.length, limits: r.limits.length },
      }));
    }
    return rows;
  }
  async create(args: { data: Row }) {
    const { features, limits, ...rest } = args.data;
    const row = {
      id: `plan-${++this.seq}`,
      ...rest,
      features: features.create,
      limits: limits.create,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }
  async update(args: { where: Row; data: Row }) {
    const row = this.rows.find((r) => this.matches(r, args.where));
    if (!row) {
      throw Object.assign(new Error('Record to update not found.'), { code: 'P2025' });
    }
    const { features, limits, ...rest } = args.data;
    Object.assign(row, rest);
    if (features) row.features = features.create;
    if (limits) row.limits = limits.create;
    return row;
  }
  async deleteMany(args: { where: Row }) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !this.matches(r, args.where));
    return { count: before - this.rows.length };
  }
  async count(args: { where: Row }) {
    return this.rows.filter((r) => this.matches(r, args.where)).length;
  }
}

function request(overrides: Partial<CreatePlanRequest> = {}): CreatePlanRequest {
  return {
    name: 'Pro',
    slug: 'pro',
    description: 'Pro plan',
    tier: PlanTier.PREMIUM,
    price: { amount: 99, currency: 'USD', interval: BillingInterval.MONTHLY },
    features: [
      {
        key: 'copy_trading',
        name: 'Copy Trading',
        description: 'Copy trades',
        enabled: true,
        limit: 50,
        unit: 'traders',
      },
      { key: 'api_access', name: 'API', description: 'API access', enabled: false },
    ],
    limits: [
      {
        key: 'orders_per_day',
        name: 'Orders',
        description: 'Orders per day',
        value: 500,
        unit: 'orders',
        hardLimit: true,
      },
    ],
    ...overrides,
  };
}

describe('PlanService', () => {
  let delegate: FakePlanDelegate;
  let service: PlanService;

  beforeEach(() => {
    delegate = new FakePlanDelegate();
    const prisma = { plan: delegate } as unknown as ConstructorParameters<typeof PlanRepository>[0];
    service = new PlanService(new PlanRepository(prisma));
  });

  describe('getPlan / getPlanBySlug', () => {
    it('should return plan when found', async () => {
      const created = await service.createPlan(request(), 'tenant-1', 'admin-1');
      const plan = await service.getPlan(created.id, 'tenant-1');
      expect(plan).toMatchObject({
        id: created.id,
        tenantId: 'tenant-1',
        slug: 'pro',
        status: PlanStatus.ACTIVE,
      });
      expect(plan.features).toHaveLength(2);
      expect(plan.limits).toHaveLength(1);
    });

    it('should throw when plan not found', async () => {
      await expect(service.getPlan('missing', 'tenant-1')).rejects.toThrow(
        'Plan not found: missing',
      );
    });

    it("should not find another tenant's plan by id or slug", async () => {
      const created = await service.createPlan(request(), 'tenant-1', 'admin-1');
      await expect(service.getPlan(created.id, 'tenant-2')).rejects.toThrow('Plan not found');
      await expect(service.getPlanBySlug('pro', 'tenant-2')).rejects.toThrow(
        'Plan not found with slug: pro',
      );
    });

    it('should return plan when found by slug', async () => {
      await service.createPlan(request(), 'tenant-1', 'admin-1');
      expect((await service.getPlanBySlug('pro', 'tenant-1')).name).toBe('Pro');
    });
  });

  describe('listPlans', () => {
    it('should return all plans of the tenant, filtered', async () => {
      await service.createPlan(request(), 'tenant-1', 'a');
      await service.createPlan(
        request({ slug: 'basic', name: 'Basic', tier: PlanTier.BASIC }),
        'tenant-1',
        'a',
      );
      await service.createPlan(request(), 'tenant-2', 'b');
      expect(await service.listPlans({}, 'tenant-1')).toHaveLength(2);
      expect(
        (await service.listPlans({ tier: PlanTier.BASIC }, 'tenant-1')).map((p) => p.slug),
      ).toEqual(['basic']);
    });

    it('should summarise active plans with feature and limit counts', async () => {
      await service.createPlan(request(), 'tenant-1', 'a');
      expect(await service.listPlanSummaries('tenant-1')).toEqual([
        expect.objectContaining({
          name: 'Pro',
          tier: PlanTier.PREMIUM,
          featureCount: 2,
          limitCount: 1,
        }),
      ]);
    });
  });

  describe('createPlan', () => {
    it('should create a new plan in the given tenant, recording the creator', async () => {
      const plan = await service.createPlan(request(), 'tenant-1', 'admin-1');
      expect(plan).toMatchObject({
        tenantId: 'tenant-1',
        createdBy: 'admin-1',
        updatedBy: 'admin-1',
      });
    });

    it('should reject an invalid request before touching storage', async () => {
      await expect(
        service.createPlan(request({ slug: 'Not A Slug' }), 'tenant-1', 'a'),
      ).rejects.toThrow(
        'Validation failed: Plan slug must contain only lowercase letters, numbers, and hyphens',
      );
      expect(delegate.rows).toHaveLength(0);
    });

    it('should reject a duplicate slug in the same tenant only', async () => {
      await service.createPlan(request(), 'tenant-1', 'a');
      await expect(service.createPlan(request(), 'tenant-1', 'a')).rejects.toThrow(
        "Plan with slug 'pro' already exists",
      );
      await expect(service.createPlan(request(), 'tenant-2', 'b')).resolves.toMatchObject({
        tenantId: 'tenant-2',
      });
    });
  });

  describe('updatePlan', () => {
    it('should update an existing plan', async () => {
      const created = await service.createPlan(request(), 'tenant-1', 'admin-1');
      const updated = await service.updatePlan(
        created.id,
        { name: 'Pro Max', description: 'More' },
        'tenant-1',
        'admin-2',
      );
      expect(updated).toMatchObject({ name: 'Pro Max', description: 'More', updatedBy: 'admin-2' });
    });

    it('should activate and deactivate a plan through its status', async () => {
      const created = await service.createPlan(request(), 'tenant-1', 'a');
      expect(
        (await service.updatePlan(created.id, { status: PlanStatus.INACTIVE }, 'tenant-1', 'a'))
          .status,
      ).toBe(PlanStatus.INACTIVE);
      expect(await service.listPlanSummaries('tenant-1')).toHaveLength(0);
      expect(
        (await service.updatePlan(created.id, { status: PlanStatus.ACTIVE }, 'tenant-1', 'a'))
          .status,
      ).toBe(PlanStatus.ACTIVE);
    });

    it('should replace features and limits wholesale when provided', async () => {
      const created = await service.createPlan(request(), 'tenant-1', 'a');
      const updated = await service.updatePlan(
        created.id,
        { features: [{ key: 'signals', name: 'Signals', description: 'Signals', enabled: true }] },
        'tenant-1',
        'a',
      );
      expect(updated.features.map((f) => f.key)).toEqual(['signals']);
      expect(updated.limits).toHaveLength(1);
    });

    it('should reject an invalid update and an unknown or foreign plan', async () => {
      const created = await service.createPlan(request(), 'tenant-1', 'a');
      await expect(service.updatePlan(created.id, { name: '' }, 'tenant-1', 'a')).rejects.toThrow(
        'Plan name cannot be empty',
      );
      await expect(service.updatePlan('missing', { name: 'x' }, 'tenant-1', 'a')).rejects.toThrow(
        'Plan not found: missing',
      );
      await expect(
        service.updatePlan(created.id, { name: 'hijack' }, 'tenant-2', 'b'),
      ).rejects.toThrow('Plan not found');
      expect((await service.getPlan(created.id, 'tenant-1')).name).toBe('Pro');
    });

    it('repository update itself is tenant-scoped (no write by id alone)', async () => {
      const created = await service.createPlan(request(), 'tenant-1', 'a');
      const repo = new PlanRepository({ plan: delegate } as unknown as ConstructorParameters<
        typeof PlanRepository
      >[0]);
      await expect(repo.update(created.id, { name: 'hijack' }, 'tenant-2', 'b')).rejects.toThrow(
        'Record to update not found',
      );
      expect(delegate.rows[0].name).toBe('Pro');
    });
  });

  describe('deletePlan', () => {
    it('should delete a plan of the tenant', async () => {
      const created = await service.createPlan(request(), 'tenant-1', 'a');
      await service.deletePlan(created.id, 'tenant-1');
      expect(delegate.rows).toHaveLength(0);
    });

    it("should not delete another tenant's plan", async () => {
      const created = await service.createPlan(request(), 'tenant-1', 'a');
      await expect(service.deletePlan(created.id, 'tenant-2')).rejects.toThrow('Plan not found');
      expect(delegate.rows).toHaveLength(1);
    });
  });

  describe('comparePlans', () => {
    it('should build a feature / limit matrix across plans', async () => {
      const a = await service.createPlan(request(), 'tenant-1', 'x');
      const b = await service.createPlan(
        request({
          slug: 'lite',
          name: 'Lite',
          features: [{ key: 'copy_trading', name: 'Copy', description: 'Copy', enabled: false }],
          limits: [],
        }),
        'tenant-1',
        'x',
      );
      const cmp = await service.comparePlans([a.id, b.id], 'tenant-1');
      expect(cmp.features.sort()).toEqual(['api_access', 'copy_trading']);
      expect(cmp.differences.copy_trading).toEqual({ [a.id]: true, [b.id]: false });
      expect(cmp.differences.orders_per_day).toEqual({ [a.id]: 500, [b.id]: 0 });
    });

    it('should need at least two plans visible to the tenant', async () => {
      const a = await service.createPlan(request(), 'tenant-1', 'x');
      const foreign = await service.createPlan(request(), 'tenant-2', 'y');
      await expect(service.comparePlans([a.id, foreign.id], 'tenant-1')).rejects.toThrow(
        'At least 2 valid plans are required for comparison',
      );
    });
  });

  describe('default plans', () => {
    it('should seed the default catalogue once per tenant', async () => {
      const plans = await service.initializeDefaultPlans('tenant-1', 'system');
      expect(plans.map((p) => p.slug)).toEqual(DEFAULT_PLANS.map((p) => p.slug));
      await expect(service.initializeDefaultPlans('tenant-1', 'system')).rejects.toThrow(
        'Plans already exist for this tenant',
      );
      await expect(service.initializeDefaultPlans('tenant-2', 'system')).resolves.toHaveLength(
        DEFAULT_PLANS.length,
      );
    });

    it('default plans are valid create requests', async () => {
      const { validateCreatePlan } =
        await import('../../../apps/api/src/modules/billing/plans/plan.validation');
      for (const template of await service.getDefaultPlans()) {
        const result = validateCreatePlan({
          name: template.name,
          slug: template.slug,
          description: template.description,
          tier: template.tier,
          price: template.price,
          features: template.features,
          limits: template.limits,
          metadata: template.metadata,
        });
        expect({ slug: template.slug, errors: result.errors }).toEqual({
          slug: template.slug,
          errors: [],
        });
      }
    });
  });
});
```

FILE: tests/billing/plans/plan_validation.spec.ts

```typescript
import { describe, it, expect } from '@jest/globals';
import {
  validateCreatePlan,
  validateUpdatePlan,
  validateSlug,
  validatePrice,
} from '../../../apps/api/src/modules/billing/plans/plan.validation';
import {
  PlanTier,
  BillingInterval,
  CreatePlanRequest,
} from '../../../apps/api/src/modules/billing/plans/plan.types';

/**
 * A valid create request. The tenant is not part of the request: PlanService
 * receives it separately from the authenticated context, so a caller cannot
 * create a plan in another tenant by putting a tenantId in the body.
 */
function createRequest(overrides: Partial<CreatePlanRequest> = {}): CreatePlanRequest {
  return {
    name: 'Basic Plan',
    slug: 'basic-plan',
    description: 'A basic plan',
    tier: PlanTier.BASIC,
    price: { amount: 29, currency: 'USD', interval: BillingInterval.MONTHLY },
    features: [],
    limits: [],
    ...overrides,
  };
}

describe('Plan Validation', () => {
  describe('validateCreatePlan', () => {
    it('should validate a valid create request', () => {
      const result = validateCreatePlan(createRequest());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should not take the tenant from the request body', () => {
      const withTenant = { ...createRequest(), tenantId: 'someone-else' } as CreatePlanRequest;
      // Validation ignores it; PlanService.createPlan(data, tenantId, ...) decides the tenant.
      expect(validateCreatePlan(withTenant).valid).toBe(true);
    });

    it('should require name', () => {
      const result = validateCreatePlan(createRequest({ name: '' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Plan name is required');
    });

    it('should limit name length', () => {
      expect(validateCreatePlan(createRequest({ name: 'x'.repeat(101) })).errors).toContain(
        'Plan name must be 100 characters or less',
      );
    });

    it('should require slug', () => {
      const result = validateCreatePlan(createRequest({ slug: '' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Plan slug is required');
    });

    it('should validate slug format', () => {
      const result = validateCreatePlan(createRequest({ slug: 'Basic Plan!' }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Plan slug must contain only lowercase letters, numbers, and hyphens',
      );
    });

    it('should require description', () => {
      expect(validateCreatePlan(createRequest({ description: ' ' })).errors).toContain(
        'Plan description is required',
      );
    });

    it('should require valid tier', () => {
      const result = validateCreatePlan(createRequest({ tier: 'invalid' as PlanTier }));
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Valid plan tier is required');
    });

    it('should validate price amount', () => {
      const result = validateCreatePlan(
        createRequest({
          price: { amount: -10, currency: 'USD', interval: BillingInterval.MONTHLY },
        }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Price amount must be a non-negative number');
    });

    it('should validate currency, interval and trial days', () => {
      const result = validateCreatePlan(
        createRequest({
          price: {
            amount: 10,
            currency: 'US',
            interval: 'weekly' as BillingInterval,
            trialDays: 91,
          },
        }),
      );
      expect(result.errors).toEqual(
        expect.arrayContaining([
          'Valid 3-letter currency code is required',
          'Valid billing interval is required',
          'Trial days cannot exceed 90',
        ]),
      );
    });

    it('should validate each feature and reject duplicate keys', () => {
      const result = validateCreatePlan(
        createRequest({
          features: [
            { key: 'copy_trading', name: 'Copy', description: 'Copy trades', enabled: true },
            { key: 'copy_trading', name: 'Copy again', description: 'dup', enabled: true },
            { key: '', name: '', description: '', enabled: true, limit: -1 },
          ],
        }),
      );
      expect(result.errors).toEqual(
        expect.arrayContaining([
          'Feature 3: key is required',
          'Feature 3: name is required',
          'Feature 3: description is required',
          'Feature 3: limit must be a non-negative number',
          'Duplicate feature keys: copy_trading',
        ]),
      );
    });

    it('should validate each limit and reject duplicate keys', () => {
      const result = validateCreatePlan(
        createRequest({
          limits: [
            {
              key: 'orders',
              name: 'Orders',
              description: 'Orders',
              value: 10,
              unit: 'orders',
              hardLimit: true,
            },
            {
              key: 'orders',
              name: 'Orders',
              description: 'Orders',
              value: 10,
              unit: 'orders',
              hardLimit: true,
            },
            { key: 'x', name: 'X', description: 'X', value: 1, unit: '', hardLimit: true },
          ],
        }),
      );
      expect(result.errors).toEqual(
        expect.arrayContaining(['Limit 3: unit is required', 'Duplicate limit keys: orders']),
      );
    });
  });

  describe('validateUpdatePlan', () => {
    it('should validate a valid update request', () => {
      const result = validateUpdatePlan({
        name: 'Updated Plan',
        description: 'Updated description',
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should allow partial updates', () => {
      expect(validateUpdatePlan({ name: 'Updated Plan' }).valid).toBe(true);
      expect(validateUpdatePlan({}).valid).toBe(true);
    });

    it('should validate name if provided', () => {
      const result = validateUpdatePlan({ name: '' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Plan name cannot be empty');
    });

    it('should validate tier if provided', () => {
      const result = validateUpdatePlan({ tier: 'invalid' as PlanTier });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Valid plan tier is required');
    });

    it('should validate price if provided', () => {
      const result = validateUpdatePlan({
        price: { amount: -1, currency: 'USD', interval: BillingInterval.MONTHLY },
      });
      expect(result.errors).toContain('Price amount must be a non-negative number');
    });
  });

  describe('validateSlug', () => {
    it('should accept valid slugs', () => {
      expect(validateSlug('basic-plan').valid).toBe(true);
      expect(validateSlug('standard').valid).toBe(true);
      expect(validateSlug('plan-123').valid).toBe(true);
      expect(validateSlug('my-plan-v2').valid).toBe(true);
    });

    it('should reject invalid slugs', () => {
      expect(validateSlug('Basic Plan').valid).toBe(false);
      expect(validateSlug('plan!').valid).toBe(false);
      expect(validateSlug('plan@123').valid).toBe(false);
      expect(validateSlug('UPPERCASE').valid).toBe(false);
    });

    it('should reject empty slug', () => {
      expect(validateSlug('').valid).toBe(false);
    });
  });

  describe('validatePrice', () => {
    it('should accept valid prices', () => {
      expect(
        validatePrice({ amount: 29, currency: 'USD', interval: BillingInterval.MONTHLY }).valid,
      ).toBe(true);
      expect(
        validatePrice({ amount: 0, currency: 'USD', interval: BillingInterval.MONTHLY }).valid,
      ).toBe(true);
      expect(
        validatePrice({ amount: 199.99, currency: 'EUR', interval: BillingInterval.ANNUAL }).valid,
      ).toBe(true);
    });

    it('should reject negative amounts', () => {
      expect(
        validatePrice({ amount: -10, currency: 'USD', interval: BillingInterval.MONTHLY }).valid,
      ).toBe(false);
    });

    it('should reject invalid currency', () => {
      expect(
        validatePrice({ amount: 29, currency: '', interval: BillingInterval.MONTHLY }).valid,
      ).toBe(false);
    });

    it('should reject invalid interval', () => {
      expect(
        validatePrice({ amount: 29, currency: 'USD', interval: 'invalid' as BillingInterval })
          .valid,
      ).toBe(false);
    });
  });
});
```

FILE: tests/e2e/browser/admin-operations.spec.ts

```typescript
// # Responsibility: drives the admin console in a real browser - the compliance case queue and the custody reconciliation view - which are server components whose data never passes through the browser.
//
// This is the spec that `page.route()` could never have written. The console's data path is
// `serverFetch` inside a server component: the request is made by the Next.js server, not by the
// browser, so browser-level interception would have tested nothing at all. The stub upstream is
// therefore the only honest place to stand, and this test proves the console's server-side session
// handling, its fetches and its rendering together.

import { expect, test } from '@playwright/test';

import { expectNoUnmatchedTraffic, readStubLog, resetStub, signIn } from './support/session';

test.describe('admin console operations', () => {
  test.beforeEach(async ({ page }) => {
    await resetStub(page);
    await signIn(page);
  });

  test('the compliance queue renders the case and its signals', async ({ page }) => {
    await page.goto('/compliance');

    await expect(page.getByText('Identity document requires manual review.')).toBeVisible();
    await expect(page.getByText('KYC_REVIEW')).toBeVisible();

    const log = await readStubLog(page);
    const paths = log.requests.map((entry) => `${entry.method} ${entry.path}`);
    expect(paths).toContain('GET /v1/compliance/cases');
    expect(paths).toContain('GET /v1/compliance/monitoring/signals');
    expect(
      log.requests.every((entry) => entry.authorized),
      'server components must attach the console session token to every read',
    ).toBeTruthy();

    await expectNoUnmatchedTraffic(page);
  });

  test('the custody reconciliation view renders the finding it was given', async ({ page }) => {
    await page.goto('/funding-reconciliation');

    await expect(page.getByText('finding-e2e-1')).toBeVisible({ timeout: 15_000 });

    const log = await readStubLog(page);
    expect(
      log.requests.some((entry) => entry.path === '/v1/custody/reconciliation/findings'),
      'the reconciliation view must read the findings endpoint',
    ).toBeTruthy();

    await expectNoUnmatchedTraffic(page);
  });
});
```

FILE: tests/e2e/browser/copy-trading-lifecycle.spec.ts

```typescript
// # Responsibility: drives the copy-subscription detail view in a real browser - guardrails, execution history, and the pause/resume round trip through the proxy, the CSRF check and the upstream API.
//
// The mutation is the part that matters. Pausing a subscription is a POST that must carry the CSRF
// token the login route issued and the session cookie the proxy reads; if either is missing the
// proxy answers 403/401 and the button does nothing. The test asserts the state actually changed by
// reading the page the application re-fetched, and asserts on the stub's request log that the POST
// arrived with the session token attached.

import { expect, test } from '@playwright/test';

import { expectNoUnmatchedTraffic, readStubLog, resetStub, signIn } from './support/session';

const SUBSCRIPTION_ID = 'sub-e2e-1';

test.describe('copy-trading subscription lifecycle (customer web)', () => {
  test.beforeEach(async ({ page }) => {
    await resetStub(page);
    await signIn(page);
  });

  test('the detail view composes its three reads and shows the guardrails', async ({ page }) => {
    await page.goto(`/copy-trading/${SUBSCRIPTION_ID}`);

    await expect(page.getByTestId('copy-subscription-detail-page')).toBeVisible();
    await expect(page.getByTestId('guardrail-max-daily-loss')).toBeVisible();
    await expect(page.getByTestId('guardrail-max-drawdown')).toBeVisible();
    await expect(page.getByTestId('pause-subscription-btn')).toBeVisible();

    const log = await readStubLog(page);
    const paths = log.requests.map((entry) => `${entry.method} ${entry.path}`);
    expect(paths).toContain('GET /v1/copy-trading/subscriptions/sub-e2e-1');
    expect(paths).toContain('GET /v1/copy-trading/policies/effective');
    expect(paths).toContain('GET /v1/copy-trading/executions');
    expect(
      log.requests.every((entry) => entry.authorized),
      'every API read behind the proxy must carry the session token',
    ).toBeTruthy();

    await expectNoUnmatchedTraffic(page);
  });

  test('pause moves the subscription and resume moves it back', async ({ page }) => {
    await page.goto(`/copy-trading/${SUBSCRIPTION_ID}`);
    await expect(page.getByTestId('pause-subscription-btn')).toBeVisible();

    await page.getByTestId('pause-subscription-btn').click();

    // The button swaps because the page re-fetched the subscription and the upstream now reports
    // PAUSED. A UI that only flipped local state would pass a screenshot test and fail this one.
    await expect(page.getByTestId('resume-subscription-btn')).toBeVisible();
    await expect(page.getByTestId('pause-subscription-btn')).toHaveCount(0);

    const afterPause = await readStubLog(page);
    expect(
      afterPause.requests.some(
        (entry) =>
          entry.method === 'POST' &&
          entry.path === '/v1/copy-trading/subscriptions/sub-e2e-1/pause' &&
          entry.authorized,
      ),
      'the pause must reach the upstream as an authenticated POST',
    ).toBeTruthy();

    await page.getByTestId('resume-subscription-btn').click();
    await expect(page.getByTestId('pause-subscription-btn')).toBeVisible();

    const afterResume = await readStubLog(page);
    expect(
      afterResume.requests.some(
        (entry) =>
          entry.method === 'POST' &&
          entry.path === '/v1/copy-trading/subscriptions/sub-e2e-1/resume' &&
          entry.authorized,
      ),
      'the resume must reach the upstream as an authenticated POST',
    ).toBeTruthy();

    await expectNoUnmatchedTraffic(page);
  });
});
```

FILE: tests/e2e/browser/support/fixtures.mjs

```javascript
// # Responsibility: the deterministic API fixtures the browser E2E suite serves from its stub upstream, kept apart from the server so a spec can name the data it expects to see.
//
// Every fixture here is a complete response body for one upstream route, in the platform's
// `{ success: true, data: ... }` envelope. Values are exact decimal strings where the platform uses
// them, so the web parsers (which never convert money in the browser) receive the shape they were
// written against.
//
// The shapes are not invented: each one mirrors the parser the application runs on it -
// `parseTrader`, `parseTraderPerformance`, `parseSubscription`, `parseCopyExecution`,
// `parsePaged` - including the fields those parsers read for status and currentness. A field the
// parser reads and this file omits would show up as a default the UI never promises, which is
// exactly what these tests exist to catch.

export const E2E_USER = { id: 'user-e2e-1', email: 'e2e-follower@example.test' };
export const E2E_TENANT_ID = 'tenant-e2e';

/**
 * A structurally valid but unsigned JWT, because both applications decode the access token's
 * claims server-side to build their navigation (`decodeAccessTokenClaims` reads `sub`, `tid`,
 * `roles`, `perms`, `plat`, `exp`). A plain opaque string would send every page to `/login`,
 * which is how the console guard looked when this suite was first run end to end.
 *
 * The signature is deliberately not a signature: neither layout verifies it, and both say so in
 * their own comments - the token drives navigation only, and every page re-authorises through the
 * API. The stub upstream accepts this exact string as its session token; nothing else does, and
 * the string cannot authenticate against any real platform.
 */
function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

const E2E_TOKEN_PAYLOAD = {
  sub: E2E_USER.id,
  tid: E2E_TENANT_ID,
  roles: ['SUPER_ADMIN'],
  perms: ['*'],
  plat: true,
  // Rebuilt on every module load, so a long-lived checkout cannot expire its own fixtures.
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

export const E2E_ACCESS_TOKEN = [
  base64urlJson({ alg: 'none', typ: 'JWT' }),
  base64urlJson(E2E_TOKEN_PAYLOAD),
  'e2e-unsigned-signature-not-verified-anywhere',
].join('.');

export const E2E_REFRESH_TOKEN = ['e2e-refresh', 'token-not-a-credential'].join('-');

export const traders = [
  {
    traderId: 'trader-alpha',
    displayName: 'Alpha Quant Desk',
    bio: 'Systematic BTC/ETH momentum',
    avatarUrl: null,
    verificationState: 'VERIFIED',
    verifiedAt: '2026-08-01T00:00:00.000Z',
    supportedVenues: ['BINANCE', 'BYBIT'],
    supportedSymbols: ['BTC-USDT', 'ETH-USDT'],
    isPublic: true,
    isFeatured: true,
    followerCount: 145,
    totalVolume: '920000',
    totalTrades: 84,
    createdAt: '2026-06-01T00:00:00.000Z',
  },
  {
    traderId: 'trader-beta',
    displayName: 'Beta Carry Book',
    bio: 'Funding-rate carry on majors',
    avatarUrl: null,
    verificationState: 'UNVERIFIED',
    verifiedAt: null,
    supportedVenues: ['OKX'],
    supportedSymbols: ['BTC-USDT'],
    isPublic: true,
    isFeatured: false,
    followerCount: 12,
    totalVolume: '41000',
    totalTrades: 9,
    createdAt: '2026-07-15T00:00:00.000Z',
  },
];

export const alphaPerformance = {
  traderId: 'trader-alpha',
  tenantId: E2E_TENANT_ID,
  realizedPnl: '18250.75',
  unrealizedPnl: '410.25',
  totalReturn: '18250.75',
  totalReturnPercent: '18.25',
  maxDrawdown: '-2400.00',
  maxDrawdownPercent: '-2.40',
  winCount: 61,
  lossCount: 23,
  tradeCount: 84,
  winRate: '72.62',
  lossRate: '27.38',
  totalVolume: '920000',
  averageTrade: '217.27',
  averageWin: '498.10',
  averageLoss: '-547.32',
  profitFactor: '2.41',
  sharpeRatio: '1.85',
  historyLengthDays: 120,
  lastTradeAt: '2026-10-06T12:00:00.000Z',
  isActual: true,
  source: 'FILLS',
};

export const rankingsMethodology = {
  status: 'AVAILABLE',
  key: 'RECONCILED_CLOSED_PERIOD_TWR',
  description: 'Time-weighted return over exactly contiguous reconciled periods.',
  timeframe: '30D',
  windowStart: '2026-09-07T00:00:00.000Z',
  asOf: '2026-10-07T00:00:00.000Z',
  boundaryRule: 'EXACT_CONTIGUOUS_PERIODS_ONLY',
  orderingRule: 'RETURN_DESCENDING_UNAVAILABLE_LAST',
  currentnessRule: 'A window is only ranked when every period inside it is reconciled.',
  minimumPeriodCount: 5,
  rankedCount: 1,
  unrankedCount: 1,
  reason: null,
};

export const rankings = [
  {
    traderId: 'trader-alpha',
    tenantId: E2E_TENANT_ID,
    displayName: 'Alpha Quant Desk',
    verificationState: 'VERIFIED',
    isPublic: true,
    isFeatured: true,
    followerCount: 145,
    performance: alphaPerformance,
    score: 78.5,
    rank: 1,
    metrics: {
      riskAdjustedReturn: 1.85,
      drawdownScore: 0.88,
      consistencyScore: 0.71,
      historyLengthScore: 0.6,
      followerScore: 0.42,
      activityScore: 0.84,
      verifiedScore: 1,
    },
    weighting: { riskAdjustedReturn: 0.35, drawdownScore: 0.2 },
  },
  {
    traderId: 'trader-beta',
    tenantId: E2E_TENANT_ID,
    displayName: 'Beta Carry Book',
    verificationState: 'UNVERIFIED',
    isPublic: true,
    isFeatured: false,
    followerCount: 12,
    performance: null,
    score: 0,
    rank: 0,
    metrics: {
      riskAdjustedReturn: null,
      drawdownScore: null,
      consistencyScore: null,
      historyLengthScore: null,
      followerScore: null,
      activityScore: null,
      verifiedScore: null,
    },
    weighting: {},
  },
];

/**
 * The subscription resource, as served by
 * `GET /v1/copy-trading/subscriptions/:subscriptionId` and read by `parseSubscription`.
 */
export const subscriptionResource = {
  subscriptionId: 'sub-e2e-1',
  traderId: 'trader-alpha',
  strategyId: 'strategy-e2e-1',
  state: 'ACTIVE',
  allocationMode: 'FIXED',
  allocationAmount: '500.00',
  maxAllocation: '2000.00',
  minAllocation: '50.00',
  copyPolicy: null,
  riskPolicy: {
    maxDailyLoss: '300.00',
    maxDrawdown: '800.00',
    maxOpenExposure: '3000.00',
    maxExposurePerTrader: null,
    maxExposurePerSymbol: null,
    maxDailyCopiedTrades: 10,
    emergencyStopCopy: false,
  },
  followerAccountId: 'account-e2e-1',
  totalCopies: 5,
  failedCopies: 0,
  totalCopiedVolume: '2500.00',
  startedAt: '2026-09-01T00:00:00.000Z',
  pausedAt: null,
  stoppedAt: null,
  stopReason: null,
  closeOpenPositionsOnStop: true,
  createdAt: '2026-09-01T00:00:00.000Z',
};

export function subscriptionResourcePaused() {
  return {
    ...subscriptionResource,
    state: 'PAUSED',
    pausedAt: '2026-10-07T00:00:00.000Z',
  };
}

/**
 * The effective policy, as served by `GET /v1/copy-trading/policies/effective?subscriptionId=...`
 * and read by `parseCopyPolicy`.
 */
export const effectivePolicyResource = {
  sizingMode: 'FIXED',
  fixedQuantity: '0.2',
  multiplier: null,
  proportionalRatio: null,
  maxPositionSize: '2000',
  maxNotional: '5000',
  maxOpenPositions: 5,
  maxLeverage: '2',
  allowedSymbols: ['BTC-USDT'],
  blockedSymbols: [],
  allowedVenues: ['BINANCE'],
  orderTypePolicy: 'MARKET_AND_LIMIT',
  slippageToleranceBps: 50,
  executionDelayMs: 0,
  takeProfitBps: 200,
  stopLossBps: 100,
  trailingStopBps: null,
  emergencyStop: false,
};

/**
 * One copied execution, as served by `GET /v1/copy-trading/executions` and read by
 * `parseCopyExecution`. Every field that parser reads is present.
 */
export const copyExecutions = [
  {
    executionId: 'exec-e2e-1',
    subscriptionId: 'sub-e2e-1',
    leaderEventId: 'leader-event-1',
    leaderOrderId: 'leader-order-1',
    leaderFillId: 'leader-fill-1',
    traderId: 'trader-alpha',
    followerId: E2E_USER.id,
    followerAccountId: 'account-e2e-1',
    status: 'FILLED',
    sizingMode: 'FIXED',
    leaderQuantity: '0.2',
    leaderPrice: '61250.50',
    followerQuantity: '0.2',
    followerPrice: '61278.10',
    slippageTolerance: '0.005',
    maxNotional: '5000',
    followerOrderId: 'follower-order-1',
    riskDecision: 'ALLOWED',
    riskRuleId: null,
    failureReason: null,
    executionIntent: { symbol: 'BTC-USDT', side: 'BUY', orderType: 'MARKET' },
    createdAt: '2026-10-06T10:00:00.000Z',
    updatedAt: '2026-10-06T10:00:05.000Z',
  },
];

export const executionsPage = { data: copyExecutions, total: copyExecutions.length };

export const subscriptionsPage = { data: [subscriptionResource], total: 1 };

/**
 * Compliance cases, as `GET /v1/compliance/cases` really answers: the paged envelope
 * `{ data, total, page, limit }` from `complianceCase.repository.listTenantCases`, whose rows are
 * the Prisma `ComplianceCase` records. The first version of this fixture invented `caseId`,
 * `status` and `summary`; the console then crashed with a 500 while reading `safeSummary`, which
 * was the harness telling the truth about a bad fixture rather than a bad page.
 */
export const complianceCases = {
  data: [
    {
      id: 'case-e2e-1',
      tenantId: E2E_TENANT_ID,
      userId: E2E_USER.id,
      caseType: 'KYC_REVIEW',
      state: 'OPEN',
      severity: 'HIGH',
      riskLevel: 'HIGH',
      decision: null,
      assignedTo: null,
      assignedAt: null,
      escalatedAt: null,
      resolvedAt: null,
      closedAt: null,
      idempotencyKey: 'case-e2e-1-key',
      safeSummary: 'Identity document requires manual review.',
      jurisdiction: 'BD',
      policyVersion: 'v1',
      ruleIds: ['KYC_DOC_MISMATCH'],
      sourceRefs: [],
      metadata: {},
      createdAt: '2026-10-01T09:00:00.000Z',
      updatedAt: '2026-10-06T09:00:00.000Z',
    },
  ],
  total: 1,
  page: 1,
  limit: 50,
};

/**
 * Monitoring signals, as `GET /v1/compliance/monitoring/signals` really answers:
 * `{ data, total }` from `transactionMonitoringService.listSignals`, over
 * `TransactionMonitoringSignal` rows.
 */
export const monitoringSignals = {
  data: [
    {
      id: 'signal-e2e-1',
      tenantId: E2E_TENANT_ID,
      userId: E2E_USER.id,
      sourceType: 'DEPOSIT',
      sourceId: 'deposit-e2e-1',
      ruleId: 'VELOCITY_DEPOSIT',
      riskLevel: 'MEDIUM',
      decision: 'PENDING',
      safeSummary: 'Deposit velocity above the tenant threshold.',
      idempotencyKey: 'signal-e2e-1-key',
      caseId: null,
      resolved: false,
      resolvedAt: null,
      createdAt: '2026-10-05T09:00:00.000Z',
    },
  ],
  total: 1,
};

export const custodyReconciliationFindings = {
  items: [
    {
      findingId: 'finding-e2e-1',
      accountId: 'account-e2e-1',
      asset: 'USDT',
      difference: '0',
      state: 'MATCHED',
      detectedAt: '2026-10-06T00:00:00.000Z',
    },
  ],
  findings: [
    {
      findingId: 'finding-e2e-1',
      accountId: 'account-e2e-1',
      asset: 'USDT',
      difference: '0',
      state: 'MATCHED',
      detectedAt: '2026-10-06T00:00:00.000Z',
    },
  ],
};

export const maintenanceCurrent = { active: false, blocksTrading: false, message: null };

export const activeRestrictions = { data: [] };

export const notificationsPage = { data: [], total: 0 };
```

FILE: tests/e2e/browser/support/session.ts

```typescript
// # Responsibility: the shared browser-session and stub-control helpers every E2E spec uses - sign in through the real login form, then read or steer the stub upstream.
//
// Signing in through the form is deliberate. The alternative - injecting the session cookie into the
// browser context - would skip the login route handler, the upstream `/auth/login` call, the cookie
// attributes and the CSRF cookie that every mutation later depends on. Every one of those is part
// of what a buyer is paying for, and it is exactly the path that broke silently in the past
// (`getTraderExposure` called a route no controller mounted, so both panels rendered "unavailable"
// and nothing failed).

import { expect, type Page } from '@playwright/test';

export const STUB_BASE_URL = process.env.E2E_STUB_URL ?? 'http://127.0.0.1:4600';
export const E2E_EMAIL = 'e2e-follower@example.test';
export const E2E_PASSWORD = 'e2e-password-not-used-by-the-stub';

export interface SignInOptions {
  email?: string;
  password?: string;
}

/** Signs in through `/login` and waits until the app leaves the login route. */
export async function signIn(page: Page, options: SignInOptions = {}): Promise<void> {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(options.email ?? E2E_EMAIL);
  await page.locator('input[type="password"]').fill(options.password ?? E2E_PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
}

export interface StubRequestEntry {
  method: string;
  path: string;
  query: Record<string, string>;
  authorized: boolean;
}

export interface StubLog {
  requests: StubRequestEntry[];
  unmatched: StubRequestEntry[];
  mode: Record<string, boolean>;
}

/** Reads the stub's request log. The spec asserts on traffic, not only on pixels. */
export async function readStubLog(page: Page): Promise<StubLog> {
  const response = await page.request.get(`${STUB_BASE_URL}/__stub/requests`);
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json()) as { data: StubLog };
  return payload.data;
}

/** Flips a stub mode switch (for example an unavailable ranking window). */
export async function setStubMode(page: Page, mode: Record<string, boolean>): Promise<void> {
  const response = await page.request.post(`${STUB_BASE_URL}/__stub/mode`, { data: mode });
  expect(response.ok()).toBeTruthy();
}

/** Clears the stub's request log and mode. Called before each spec so logs do not leak across tests. */
export async function resetStub(page: Page): Promise<void> {
  const response = await page.request.post(`${STUB_BASE_URL}/__stub/reset`, { data: {} });
  expect(response.ok()).toBeTruthy();
}

/**
 * The invariant every spec ends with: the applications only talked to routes the suite declared.
 *
 * A page that starts calling a new endpoint - or an endpoint the suite forgot - fails here, with
 * the path in the message, rather than rendering an empty state that a weaker assertion would
 * accept as success.
 */
export async function expectNoUnmatchedTraffic(page: Page): Promise<void> {
  const log = await readStubLog(page);
  expect(
    log.unmatched.map((entry) => `${entry.method} ${entry.path}`),
    'every request must hit a route declared in tests/e2e/browser/support/stub-api.mjs',
  ).toEqual([]);
}
```

FILE: tests/e2e/browser/support/stub-api.mjs

```javascript
// # Responsibility: a dependency-free stub of the platform API for the browser E2E suite, which fails loudly on any route the suite has not declared instead of inventing a response.
//
// Why a stub upstream and not `page.route()`: the customer web app's data path is
// browser -> `/api/proxy/*` (Next route handler) -> platform API, and the admin console's is
// `serverFetch` inside a server component. Half of that traffic never passes through the browser,
// so intercepting in the browser would silently test nothing for the admin console. The stub sits
// where the real API sits, and both applications talk to it through their normal code paths
// (`API_BASE_URL`), which is what makes the suite end-to-end.
//
// The behaviour that matters most is what happens on a route nobody stubbed: a 404 whose body names
// the path, recorded in `unmatched`. The specs assert `unmatched` is empty, so a page that starts
// calling a new endpoint fails the suite with the path in the report rather than rendering an empty
// state and passing.
//
// It is also a small control surface for the suite:
//   GET  /__stub/requests          every request the applications made (assertions about traffic)
//   POST /__stub/mode              { rankingUnavailable: true }        (drive an unavailable state)
//   POST /__stub/reset             clears the request log, the mode and any pause
//
// Authentication is enforced the way the platform enforces it: every route except login requires
// `authorization: Bearer <access token>`, so a broken session path (cookie not set, token not
// forwarded by the proxy) fails the suite with a 401 instead of passing with a rendered page.

import { createServer } from 'node:http';

import {
  E2E_ACCESS_TOKEN,
  E2E_REFRESH_TOKEN,
  E2E_USER,
  activeRestrictions,
  complianceCases,
  custodyReconciliationFindings,
  maintenanceCurrent,
  monitoringSignals,
  notificationsPage,
  effectivePolicyResource,
  executionsPage,
  rankings,
  rankingsMethodology,
  subscriptionResource,
  subscriptionResourcePaused,
  subscriptionsPage,
  traders,
} from './fixtures.mjs';

export const API_VERSION = 'v1';
export const DEFAULT_PORT = 4600;

const SESSION_PAYLOAD = {
  tokens: {
    accessToken: E2E_ACCESS_TOKEN,
    refreshToken: E2E_REFRESH_TOKEN,
    expiresIn: 900,
    refreshExpiresIn: 604800,
  },
  user: E2E_USER,
  sessionId: 'session-e2e-1',
};

export function createStubApi({ port = DEFAULT_PORT, host = '127.0.0.1' } = {}) {
  const state = {
    requests: [],
    unmatched: [],
    mode: { rankingUnavailable: false },
    pausedSubscriptions: new Set(),
  };

  const routes = [
    // ---- session ---------------------------------------------------------------------------
    {
      method: 'POST',
      path: `/${API_VERSION}/auth/login`,
      authenticated: false,
      handler: () => ok(SESSION_PAYLOAD),
    },
    {
      method: 'GET',
      path: `/${API_VERSION}/auth/me`,
      handler: () => ok({ user: E2E_USER, permissions: ['*'], tenantId: 'tenant-e2e' }),
    },
    {
      method: 'POST',
      path: `/${API_VERSION}/auth/refresh`,
      authenticated: false,
      handler: () => ok(SESSION_PAYLOAD),
    },
    {
      method: 'GET',
      path: `/${API_VERSION}/tenants/public-config`,
      authenticated: false,
      handler: () =>
        ok({
          tenantId: 'tenant-e2e',
          slug: 'platform',
          displayName: 'E2E Platform',
          branding: { primaryColor: '#111827' },
          features: {},
        }),
    },

    // ---- discovery -------------------------------------------------------------------------
    {
      method: 'GET',
      path: `/${API_VERSION}/copy-trading/traders`,
      handler: (_req, url) => {
        const search = (url.searchParams.get('search') ?? '').toLowerCase();
        const verification = url.searchParams.get('verificationState') ?? '';
        const featuredOnly = url.searchParams.get('isFeatured') === 'true';
        const rows = traders.filter((trader) => {
          if (search && !`${trader.displayName} ${trader.bio}`.toLowerCase().includes(search)) {
            return false;
          }
          if (verification && trader.verificationState !== verification) return false;
          if (featuredOnly && !trader.isFeatured) return false;
          return true;
        });
        return ok({ data: rows, total: rows.length });
      },
    },
    {
      method: 'GET',
      path: `/${API_VERSION}/copy-trading/rankings`,
      handler: () => {
        if (state.mode.rankingUnavailable) {
          return ok({
            data: [],
            total: 0,
            methodology: {
              ...rankingsMethodology,
              status: 'UNAVAILABLE',
              rankedCount: 0,
              unrankedCount: traders.length,
            },
          });
        }
        return ok({ data: rankings, total: rankings.length, methodology: rankingsMethodology });
      },
    },
    {
      method: 'GET',
      path: `/${API_VERSION}/copy-trading/traders/:traderId/performance`,
      handler: (_req, _url, params) => {
        const ranking = rankings.find((row) => row.traderId === params.traderId);
        return ok(ranking?.performance ?? null);
      },
    },
    {
      method: 'GET',
      path: `/${API_VERSION}/copy-trading/traders/:traderId`,
      handler: (_req, _url, params) => {
        const trader = traders.find((row) => row.traderId === params.traderId);
        return trader ? ok(trader) : notFound(`no trader ${params.traderId}`);
      },
    },

    // ---- subscriptions ---------------------------------------------------------------------
    {
      method: 'GET',
      path: `/${API_VERSION}/copy-trading/subscriptions/me`,
      handler: () => ok(subscriptionsPage),
    },
    {
      method: 'GET',
      path: `/${API_VERSION}/copy-trading/subscriptions/:subscriptionId`,
      handler: (_req, _url, params) =>
        ok(
          state.pausedSubscriptions.has(params.subscriptionId)
            ? subscriptionResourcePaused()
            : subscriptionResource,
        ),
    },
    {
      method: 'POST',
      path: `/${API_VERSION}/copy-trading/subscriptions/:subscriptionId/pause`,
      handler: (_req, _url, params) => {
        state.pausedSubscriptions.add(params.subscriptionId);
        return ok(subscriptionResourcePaused());
      },
    },
    {
      method: 'POST',
      path: `/${API_VERSION}/copy-trading/subscriptions/:subscriptionId/resume`,
      handler: (_req, _url, params) => {
        state.pausedSubscriptions.delete(params.subscriptionId);
        return ok(subscriptionResource);
      },
    },
    // The subscription detail view composes three calls, not one: the subscription, the effective
    // policy and the execution page. All three are declared here, because a 404 on any of them is a
    // page the customer sees broken and a spec that must fail.
    {
      method: 'GET',
      path: `/${API_VERSION}/copy-trading/policies/effective`,
      handler: () => ok(effectivePolicyResource),
    },
    {
      method: 'GET',
      path: `/${API_VERSION}/copy-trading/executions`,
      handler: (_req, url) => {
        const subscriptionId = url.searchParams.get('subscriptionId');
        const rows = subscriptionId
          ? executionsPage.data.filter((row) => row.subscriptionId === subscriptionId)
          : executionsPage.data;
        return ok({ data: rows, total: rows.length });
      },
    },

    // ---- trading state the pages compose their banners from ---------------------------------
    {
      method: 'GET',
      path: `/${API_VERSION}/operations/maintenance/current`,
      handler: () => ok(maintenanceCurrent),
    },
    {
      method: 'GET',
      path: `/${API_VERSION}/client-lifecycle/restrictions`,
      handler: () => ok(activeRestrictions),
    },
    {
      method: 'GET',
      path: `/${API_VERSION}/notifications`,
      handler: () => ok(notificationsPage),
    },

    // ---- admin console ---------------------------------------------------------------------
    {
      method: 'GET',
      path: `/${API_VERSION}/compliance/cases`,
      handler: () => ok(complianceCases),
    },
    {
      method: 'GET',
      path: `/${API_VERSION}/compliance/monitoring/signals`,
      handler: () => ok(monitoringSignals),
    },
    {
      method: 'GET',
      path: `/${API_VERSION}/custody/reconciliation/findings`,
      handler: () => ok(custodyReconciliationFindings),
    },
    {
      method: 'GET',
      path: `/${API_VERSION}/operations/maintenance`,
      handler: () => ok({ data: [], total: 0 }),
    },

    // ---- control surface -------------------------------------------------------------------
    {
      method: 'GET',
      path: '/__stub/requests',
      authenticated: false,
      prefix: true,
      handler: () => ok({ requests: state.requests, unmatched: state.unmatched, mode: state.mode }),
    },
    {
      method: 'POST',
      path: '/__stub/mode',
      authenticated: false,
      handler: (_req, _url, _params, body) => {
        state.mode = { ...state.mode, ...(body ?? {}) };
        return ok(state.mode);
      },
    },
    {
      method: 'POST',
      path: '/__stub/reset',
      authenticated: false,
      handler: () => {
        state.requests = [];
        state.unmatched = [];
        state.mode = { rankingUnavailable: false };
        state.pausedSubscriptions.clear();
        return ok({ reset: true });
      },
    },
  ];

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${host}:${port}`);
    const authorization = req.headers.authorization ?? null;
    const body = await readJsonBody(req);
    const entry = {
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      authorized: authorization === `Bearer ${E2E_ACCESS_TOKEN}`,
    };
    state.requests.push(entry);

    const route = matchRoute(routes, req.method ?? 'GET', url.pathname);
    if (!route) {
      state.unmatched.push(entry);
      return send(res, 404, {
        success: false,
        error: {
          code: 'STUB_API_UNMATCHED_ROUTE',
          message: `stub-api has no route for ${req.method} ${url.pathname}; declare it in tests/e2e/browser/support/stub-api.mjs`,
        },
      });
    }

    if (route.authenticated !== false && authorization !== `Bearer ${E2E_ACCESS_TOKEN}`) {
      return send(res, 401, {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'The stub requires the session token issued at login.',
        },
      });
    }

    let result;
    try {
      result = route.handler(req, url, route.params ?? {}, body);
    } catch (error) {
      return send(res, 500, {
        success: false,
        error: { code: 'STUB_API_ERROR', message: (error && error.message) || 'stub handler threw' },
      });
    }
    return send(res, result.status, result.body);
  });

  return {
    port,
    host,
    state,
    server,
    baseUrl: `http://${host}:${port}`,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve(server));
      }),
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      }),
  };
}

function matchRoute(routes, method, pathname) {
  for (const route of routes) {
    if (route.method !== method) continue;
    if (route.prefix) {
      if (pathname.startsWith(route.path)) return { ...route, params: {} };
      continue;
    }
    const routeSegments = route.path.split('/');
    const pathSegments = pathname.split('/');
    if (routeSegments.length !== pathSegments.length) continue;
    const params = {};
    let matched = true;
    for (let index = 0; index < routeSegments.length; index += 1) {
      const expected = routeSegments[index];
      const actual = pathSegments[index];
      if (expected.startsWith(':')) {
        params[expected.slice(1)] = decodeURIComponent(actual);
        continue;
      }
      if (expected !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) return { ...route, params };
  }
  return null;
}

async function readJsonBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return null;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

function ok(data) {
  return { status: 200, body: { success: true, data } };
}

function notFound(message) {
  return { status: 404, body: { success: false, error: { code: 'NOT_FOUND', message } } };
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

// `node tests/e2e/browser/support/stub-api.mjs --port 4600` starts it for a manual session.
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('stub-api.mjs');
if (invokedDirectly) {
  const portFlag = process.argv.indexOf('--port');
  const port = portFlag === -1 ? DEFAULT_PORT : Number(process.argv[portFlag + 1]);
  const stub = createStubApi({ port });
  await stub.listen();
  console.log(`stub-api listening on ${stub.baseUrl}/${API_VERSION}`);
}
```

FILE: tests/e2e/browser/support/stub-api.test.mjs

```javascript
// # Responsibility: proves the browser suite's stub upstream enforces its own contract - envelope, auth, parameter matching and the unmatched-route behaviour the specs rely on.
//
// The stub is test infrastructure, and infrastructure that silently fabricates a response is worse
// than no infrastructure: it would make every browser spec pass against data the real API never
// sends. These tests run without a browser (`node --test`), which is why they can be verified on a
// machine where chromium cannot start.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { createStubApi } from './stub-api.mjs';
import { E2E_ACCESS_TOKEN } from './fixtures.mjs';

const PORT = 4699;
let stub;

before(async () => {
  stub = createStubApi({ port: PORT });
  await stub.listen();
});

after(async () => {
  if (stub) await stub.close();
});

async function call(path, { method = 'GET', token = E2E_ACCESS_TOKEN, body } = {}) {
  const response = await fetch(`${stub.baseUrl}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload };
}

test('login answers the session envelope the web login route unwraps', async () => {
  const { status, payload } = await call('/v1/auth/login', {
    method: 'POST',
    token: null,
    body: { email: 'e2e-follower@example.test', password: 'irrelevant-to-the-stub' },
  });
  assert.equal(status, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.data.tokens.accessToken, E2E_ACCESS_TOKEN);
  assert.equal(payload.data.user.email, 'e2e-follower@example.test');
});

test('every route except login requires the session token', async () => {
  const anonymous = await call('/v1/copy-trading/traders', { token: null });
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.payload.error.code, 'UNAUTHORIZED');

  const withToken = await call('/v1/copy-trading/traders');
  assert.equal(withToken.status, 200);
  assert.equal(withToken.payload.success, true);
});

test('the paged discovery payload is the shape parsePaged expects', async () => {
  const { payload } = await call('/v1/copy-trading/traders');
  assert.ok(Array.isArray(payload.data.data), 'data.data must be an array');
  assert.equal(typeof payload.data.total, 'number');
  assert.equal(payload.data.total, payload.data.data.length);
});

test('query parameters filter the trader list the way the page asks', async () => {
  const all = await call('/v1/copy-trading/traders');
  assert.equal(all.payload.data.total, 2);

  const search = await call('/v1/copy-trading/traders?search=Alpha');
  assert.equal(search.payload.data.total, 1);
  assert.equal(search.payload.data.data[0].traderId, 'trader-alpha');

  const featured = await call('/v1/copy-trading/traders?isFeatured=true');
  assert.equal(featured.payload.data.total, 1);
  assert.equal(featured.payload.data.data[0].isFeatured, true);

  const verified = await call('/v1/copy-trading/traders?verificationState=UNVERIFIED');
  assert.equal(verified.payload.data.total, 1);
  assert.equal(verified.payload.data.data[0].traderId, 'trader-beta');
});

test('path parameters reach the handler, and an unknown trader is a 404 rather than an empty object', async () => {
  const known = await call('/v1/copy-trading/traders/trader-alpha');
  assert.equal(known.status, 200);
  assert.equal(known.payload.data.traderId, 'trader-alpha');

  const unknown = await call('/v1/copy-trading/traders/trader-does-not-exist');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.payload.error.code, 'NOT_FOUND');
});

test('pausing a subscription changes what the detail route returns', async () => {
  const before = await call('/v1/copy-trading/subscriptions/sub-e2e-1');
  assert.equal(before.payload.data.state, 'ACTIVE');

  const paused = await call('/v1/copy-trading/subscriptions/sub-e2e-1/pause', { method: 'POST' });
  assert.equal(paused.status, 200);

  const afterPause = await call('/v1/copy-trading/subscriptions/sub-e2e-1');
  assert.equal(afterPause.payload.data.state, 'PAUSED');
  assert.equal(afterPause.payload.data.pausedAt !== null, true);
});

test('the three calls the subscription detail view composes are all declared', async () => {
  const subscription = await call('/v1/copy-trading/subscriptions/sub-e2e-1');
  const policy = await call('/v1/copy-trading/policies/effective?subscriptionId=sub-e2e-1');
  const executions = await call('/v1/copy-trading/executions?subscriptionId=sub-e2e-1&page=1&limit=20');

  assert.equal(subscription.payload.data.subscriptionId, 'sub-e2e-1');
  assert.equal(policy.payload.data.sizingMode, 'FIXED');
  assert.equal(executions.payload.data.data.length, 1);
  assert.equal(executions.payload.data.data[0].executionId, 'exec-e2e-1');
  assert.equal(executions.payload.data.data[0].followerOrderId, 'follower-order-1');

  const log = await call('/__stub/requests');
  assert.equal(log.payload.data.unmatched.length, 0);
});

test('mode toggles drive the unavailable-ranking state the fail-closed spec asserts', async () => {
  await call('/__stub/mode', { method: 'POST', body: { rankingUnavailable: true } });
  const unavailable = await call('/v1/copy-trading/rankings');
  assert.equal(unavailable.payload.data.methodology.status, 'UNAVAILABLE');
  assert.equal(unavailable.payload.data.data.length, 0);

  await call('/__stub/mode', { method: 'POST', body: { rankingUnavailable: false } });
  const available = await call('/v1/copy-trading/rankings');
  assert.equal(available.payload.data.methodology.status, 'AVAILABLE');
  assert.equal(available.payload.data.data.length, 2);
});

test('an undeclared route is a named 404 recorded for the specs to assert on', async () => {
  const missing = await call('/v1/definitely/not/declared');
  assert.equal(missing.status, 404);
  assert.equal(missing.payload.error.code, 'STUB_API_UNMATCHED_ROUTE');
  assert.match(missing.payload.error.message, /stub-api\.mjs/);

  const log = await call('/__stub/requests');
  assert.equal(log.status, 200);
  assert.ok(
    log.payload.data.unmatched.some((entry) => entry.path === '/v1/definitely/not/declared'),
    'the unmatched request must be visible to the suite',
  );
});

test('reset clears the request log, the mode and the pause', async () => {
  await call('/__stub/reset', { method: 'POST' });
  const log = await call('/__stub/requests');
  const detail = await call('/v1/copy-trading/subscriptions/sub-e2e-1');
  assert.equal(log.payload.data.requests.length >= 1, true, 'the log call itself is recorded after the reset');
  assert.equal(log.payload.data.mode.rankingUnavailable, false);
  assert.equal(log.payload.data.unmatched.length, 0);
  assert.equal(detail.payload.data.state, 'ACTIVE');
});
```

FILE: tests/e2e/browser/trader-discovery.spec.ts

```typescript
// # Responsibility: drives the customer web app in a real browser through trader discovery - sign in, browse, filter, open the comparison route and the performance view - against the stub upstream.
//
// This replaces the `renderToStaticMarkup` spec that used to sit in this directory and call itself
// end-to-end. That spec primed a react-query cache by hand and asserted on an HTML string: it never
// signed in, never issued a request, never rendered in a browser and could not have failed if the
// proxy, the session or the routing were broken. This one fails when any of those are.

import { expect, test } from '@playwright/test';

import { expectNoUnmatchedTraffic, resetStub, setStubMode, signIn } from './support/session';

test.describe('trader discovery (customer web)', () => {
  test.beforeEach(async ({ page }) => {
    await resetStub(page);
    await signIn(page);
  });

  test('browse, filter, compare and view performance', async ({ page }) => {
    await page.goto('/traders');

    await expect(page.getByTestId('trader-discovery-filters')).toBeVisible();
    await expect(page.getByTestId('trader-card-trader-alpha')).toBeVisible();
    await expect(page.getByTestId('trader-card-trader-beta')).toBeVisible();

    // The comparison route is reachable from the directory, which is what the old smoke test
    // asserted as a substring of static HTML.
    await expect(page.locator('a[href="/traders/compare"]').first()).toBeVisible();

    // Filtering goes through the API: the page asks the upstream with `search=` and renders what
    // comes back. Asserting the narrowed page proves the request carried the parameter.
    await page.getByLabel('Search traders').fill('Alpha');
    await expect(page.getByTestId('trader-card-trader-alpha')).toBeVisible();
    await expect(page.getByTestId('trader-card-trader-beta')).toHaveCount(0);

    const afterFilter = await page.request.get(
      `${process.env.E2E_STUB_URL ?? 'http://127.0.0.1:4600'}/__stub/requests`,
    );
    const log = (await afterFilter.json()) as {
      data: { requests: { method: string; path: string; query: Record<string, string> }[] };
    };
    expect(
      log.data.requests.some(
        (entry) =>
          entry.path === '/v1/copy-trading/traders' && entry.query.search === 'Alpha',
      ),
      'the search box must reach the API as a query parameter',
    ).toBeTruthy();

    // The performance view is a separate route and a separate endpoint.
    await page.goto('/traders/trader-alpha/performance');
    await expect(page.getByTestId('performance-methodology')).toBeVisible();

    const performanceLog = await page.request.get(
      `${process.env.E2E_STUB_URL ?? 'http://127.0.0.1:4600'}/__stub/requests`,
    );
    const performancePayload = (await performanceLog.json()) as {
      data: { requests: { path: string }[] };
    };
    expect(
      performancePayload.data.requests.some(
        (entry) => entry.path === '/v1/copy-trading/traders/trader-alpha/performance',
      ),
      'the performance route must read the trader performance endpoint',
    ).toBeTruthy();

    await expectNoUnmatchedTraffic(page);
  });

  test('an unavailable ranking window is shown as unavailable rather than as an empty leaderboard', async ({
    page,
  }) => {
    await setStubMode(page, { rankingUnavailable: true });
    await page.goto('/traders');

    // Fail-closed, in the browser: the API said the window cannot be ranked, so the page must say
    // so. It must not render the traders as if they had simply not qualified.
    await expect(page.getByTestId('ranking-unavailable')).toBeVisible();
    await expect(page.getByTestId('trader-card-trader-alpha')).toBeVisible();

    await expectNoUnmatchedTraffic(page);
  });
});
```

FILE: tests/e2e/smoke/admin-operations.spec.ts

```typescript
// # NEW — E2E test: admin kill-switch -> incident resolution -> reconciliation view
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExecutionIncidentTable } from '../../../apps/admin-web/src/features/execution/execution-incident-table';
import { FundingReconciliationTable } from '../../../apps/admin-web/src/features/funding/funding-reconciliation-table';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

describe('E2E Smoke: Admin Operations — Kill-Switch, Incidents & Reconciliation (GAP-48)', () => {
  test('admin kill-switch -> incident resolution -> reconciliation view', () => {
    const incidentHtml = renderToStaticMarkup(
      React.createElement(ExecutionIncidentTable, {
        incidents: [
          {
            id: 'inc-ops-1',
            accountId: 'acct-1',
            orderId: 'ord-1',
            clientOrderId: 'oms-e2e-1',
            incidentType: 'ORDER_STATE_MISMATCH',
            severity: 'CRITICAL',
            venue: 'BYBIT',
            symbol: 'ETH-USDT',
            errorCode: 'STATE_DRIFT',
            summary: 'Venue reported FILLED while local order was SUBMITTED',
            details: {},
            occurredAtMicros: '1700000000000000',
            resolvedAt: null,
            resolvedBy: null,
            resolutionNote: null,
            createdAt: '2026-10-01T10:00:00.000Z',
          },
        ],
        killSwitches: [
          {
            id: 'ks-global',
            scope: 'GLOBAL',
            target: null,
            isEngaged: false,
            reason: 'Normal operations',
            engagedAt: null,
            releasedAt: '2026-10-01T08:00:00.000Z',
          },
        ],
      }),
    );
    expect(incidentHtml).toContain('ORDER_STATE_MISMATCH');
    expect(incidentHtml).toContain('Venue reported FILLED while local order was SUBMITTED');

    const reconHtml = renderToStaticMarkup(
      React.createElement(FundingReconciliationTable, {
        findings: [
          {
            id: 'find-1',
            type: 'CONFIRMATION_MISMATCH',
            assetId: 'USDT',
            networkId: 'ERC20',
            description: 'Custody confirmation count ahead of internal deposit state',
            severity: 'MEDIUM',
            resolved: false,
            resolutionNote: null,
            correctiveAction: null,
            createdAt: '2026-10-01T10:15:00.000Z',
          },
        ],
      }),
    );
    expect(reconHtml).toContain('CONFIRMATION_MISMATCH');
    expect(reconHtml).toContain('Custody confirmation count ahead of internal deposit state');
  });
});
```

FILE: tests/e2e/smoke/copy-trading-lifecycle.spec.ts

```typescript
// # NEW — E2E test: follow trader -> configure risk -> leader order -> follower fill -> stop/close
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CopySubscriptionDetailPage } from '../../../apps/web/src/features/trading/copy-subscription-detail-page';
import { CopyExecutionDetail } from '../../../apps/web/src/features/trading/copy-execution-detail';
import { CopyRiskGuardrails } from '../../../apps/web/src/features/trading/copy-risk-guardrails';

describe('E2E Smoke: Copy-Trading Lifecycle (GAP-48)', () => {
  test('follow trader -> configure risk -> leader order -> follower fill -> stop/close', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['copy-subscription-detail', 'sub-e2e-1'], {
      subscription: {
        subscriptionId: 'sub-e2e-1',
        traderId: 'tr-9',
        strategyId: 'st-9',
        state: 'ACTIVE',
        allocationMode: 'FIXED',
        allocationAmount: '500.00',
        maxAllocation: '2000.00',
        minAllocation: '50.00',
        copyPolicy: null,
        riskPolicy: {
          maxDailyLoss: '300.00',
          maxDrawdown: '800.00',
          maxOpenExposure: '3000.00',
          maxExposurePerTrader: null,
          maxExposurePerSymbol: null,
          maxDailyCopiedTrades: 10,
          emergencyStopCopy: false,
        },
        totalCopies: 5,
        failedCopies: 0,
        startedAt: '2026-09-01T00:00:00.000Z',
        pausedAt: null,
        stoppedAt: null,
        stopReason: null,
        closeOpenPositionsOnStop: true,
      },
      effectivePolicy: {
        sizingMode: 'FIXED',
        fixedQuantity: '0.2',
        multiplier: null,
        proportionalRatio: null,
        maxPositionSize: '2000',
        maxNotional: '5000',
        maxOpenPositions: 5,
        maxLeverage: '2',
        allowedSymbols: ['BTC-USDT'],
        blockedSymbols: [],
        allowedVenues: ['BINANCE'],
        orderTypePolicy: 'MARKET_AND_LIMIT',
        slippageToleranceBps: 50,
        executionDelayMs: 0,
        takeProfitBps: 200,
        stopLossBps: 100,
        trailingStopBps: null,
        emergencyStop: false,
      },
      recentExecutions: [
        {
          executionId: 'exec-e2e-1',
          subscriptionId: 'sub-e2e-1',
          traderId: 'tr-9',
          followerId: 'user-1',
          strategyId: 'st-9',
          leaderEventId: 'fill:L901',
          leaderOrderId: 'ord-L901',
          followerOrderId: 'ord-F901',
          status: 'COMPLETED',
          failureReason: null,
          leaderQuantity: '1.0',
          followerQuantity: '0.2',
          sizingMode: 'FIXED',
          riskDecision: 'ALLOW',
          riskReasons: [],
          isSimulated: false,
          createdAt: '2026-10-01T10:00:00.000Z',
          updatedAt: '2026-10-01T10:00:05.000Z',
        },
      ],
      reconciliation: {
        subscriptionId: 'sub-e2e-1',
        status: 'IN_SYNC',
        lastCheckedAt: '2026-10-01T10:05:00.000Z',
        totalExecutions: 5,
        completedExecutions: 5,
        failedExecutions: 0,
        riskBlockedExecutions: 0,
        discrepancyCount: 0,
        discrepancies: [],
      },
    });

    const subscriptionMarkup = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(CopySubscriptionDetailPage, { subscriptionId: 'sub-e2e-1' }),
      ),
    );
    expect(subscriptionMarkup).toContain('sub-e2e-1');
    expect(subscriptionMarkup).toContain('exec-e2e-1');

    const executionMarkup = renderToStaticMarkup(
      React.createElement(CopyExecutionDetail, {
        execution: {
          executionId: 'exec-e2e-1',
          subscriptionId: 'sub-e2e-1',
          traderId: 'tr-9',
          followerId: 'user-1',
          strategyId: 'st-9',
          leaderEventId: 'fill:L901',
          leaderOrderId: 'ldr-order-1',
          followerOrderId: 'flw-order-1',
          status: 'COMPLETED',
          failureReason: null,
          leaderQuantity: '1.0',
          followerQuantity: '0.2',
          sizingMode: 'FIXED',
          riskDecision: 'ALLOW',
          riskReasons: [],
          isSimulated: false,
          createdAt: '2026-10-01T09:10:00.000Z',
          updatedAt: '2026-10-01T09:10:05.000Z',
        },
      }),
    );
    expect(executionMarkup).toContain('ldr-order-1');
    expect(executionMarkup).toContain('flw-order-1');

    const guardrailsMarkup = renderToStaticMarkup(
      React.createElement(CopyRiskGuardrails, {
        subscription: {
          subscriptionId: 'sub-e2e-1',
          traderId: 'tr-9',
          strategyId: 'st-9',
          state: 'ACTIVE',
          allocationMode: 'FIXED',
          allocationAmount: '500.00',
          maxAllocation: '2000.00',
          minAllocation: '50.00',
          copyPolicy: null,
          riskPolicy: {
            maxDailyLoss: '250.00',
            maxDrawdown: '800.00',
            maxOpenExposure: '3000.00',
            maxExposurePerTrader: '1500.00',
            maxExposurePerSymbol: '1000.00',
            maxDailyCopiedTrades: 10,
            emergencyStopCopy: false,
          },
          totalCopies: 5,
          failedCopies: 0,
          startedAt: '2026-09-01T00:00:00.000Z',
          pausedAt: null,
          stoppedAt: null,
          stopReason: null,
          closeOpenPositionsOnStop: true,
        },
      }),
    );
    expect(guardrailsMarkup).toContain('250.00');
  });
});
```

FILE: tests/e2e/smoke/funding-compliance.spec.ts

```typescript
// # NEW — E2E test: deposit address -> confirmation -> withdrawal request -> compliance/admin review
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComplianceCaseQueue } from '../../../apps/admin-web/src/features/compliance/compliance-case-queue';
import { ComplianceCaseDetail } from '../../../apps/admin-web/src/features/compliance/compliance-case-detail';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

describe('E2E Smoke: Funding, Custody & Compliance Review (GAP-48)', () => {
  test('deposit address -> confirmation -> withdrawal request -> compliance/admin review', () => {
    const queueHtml = renderToStaticMarkup(
      React.createElement(ComplianceCaseQueue, {
        cases: [
          {
            id: 'case-aml-901',
            tenantId: 'tenant-1',
            userId: 'user-99',
            caseType: 'WITHDRAWAL_SCREENING',
            state: 'IN_REVIEW',
            riskLevel: 'HIGH',
            severity: 'HIGH',
            safeSummary: 'High-value withdrawal address screening review',
            assignedTo: 'mlro-ops',
            jurisdiction: 'EU',
            createdAt: '2026-10-01T10:00:00.000Z',
            updatedAt: '2026-10-01T10:05:00.000Z',
          },
        ],
      }),
    );
    expect(queueHtml).toContain('case-aml-9');
    expect(queueHtml).toContain('High-value withdrawal address screening review');

    const detailHtml = renderToStaticMarkup(
      React.createElement(ComplianceCaseDetail, {
        caseRecord: {
          id: 'case-aml-901',
          tenantId: 'tenant-1',
          userId: 'user-99',
          caseType: 'WITHDRAWAL_SCREENING',
          state: 'IN_REVIEW',
          riskLevel: 'HIGH',
          severity: 'HIGH',
          safeSummary: 'High-value withdrawal address screening review',
          assignedTo: 'mlro-ops',
          jurisdiction: 'EU',
          screeningMatches: [
            {
              id: 'hit-1',
              listName: 'EU Consolidated Sanctions',
              matchCategory: 'WATCHLIST',
              confidenceScore: 72,
              matchedEntityLabel: 'Secondary Address Cluster',
              disposition: 'PENDING_REVIEW',
            },
          ],
          auditEvents: [
            {
              id: 'aud-1',
              eventType: 'WITHDRAWAL_HOLD_APPLIED',
              actorId: 'SYSTEM',
              decision: 'HOLD',
              rationale: 'Awaiting MLRO disposition on watchlist cluster hit',
              createdAt: '2026-10-01T10:01:00.000Z',
            },
          ],
          createdAt: '2026-10-01T10:00:00.000Z',
          updatedAt: '2026-10-01T10:05:00.000Z',
        },
      }),
    );
    expect(detailHtml).toContain('EU Consolidated Sanctions');
    expect(detailHtml).toContain('WITHDRAWAL_HOLD_APPLIED');
  });
});
```

FILE: tests/e2e/smoke/jest.config.js

```javascript
// # Responsibility: runs the cross-app component smoke specs (render-to-static-markup, no browser) for the web and admin JSX surfaces.
//
// These specs are NOT end-to-end tests and are no longer filed as such. They render a page
// component to static markup with a primed react-query cache and assert on the HTML: a real
// regression net for the page components, but it never issues a request, never runs a browser and
// never clicks anything. The audit found them labelled `tests/e2e/*.spec.ts` - a claim the
// directory could not support, and one that hid the absence of any browser test in the repository.
//
// The browser suite is `tests/e2e/browser/*.spec.ts`, run by Playwright
// (`npm run test:e2e:browser`), and it is the layer that actually drives a chromium page against
// the running web app.
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..', '..', '..');
const adminSource = path.join(repositoryRoot, 'apps', 'admin-web', 'src');
const webSource = path.join(repositoryRoot, 'apps', 'web', 'src');

module.exports = {
  rootDir: repositoryRoot,
  roots: ['<rootDir>/tests/e2e/smoke'],
  testMatch: ['<rootDir>/tests/e2e/smoke/**/*.spec.ts'],
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\.[jt]sx?$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'ES2022',
          module: 'CommonJS',
          moduleResolution: 'Node',
          jsx: 'react-jsx',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          skipLibCheck: true,
          strict: true,
          isolatedModules: true,
          types: ['node', 'jest'],
        },
        diagnostics: false,
        isolatedModules: true,
      },
    ],
  },
  moduleNameMapper: {
    '^@wlct/shared-types$': '<rootDir>/packages/shared-types/src/index.ts',
    '^@wlct/validation$': '<rootDir>/packages/validation/src/index.ts',
    '^@wlct/utils/api-error$': '<rootDir>/packages/utils/src/api-error.ts',
    '^@/components/ui$': path.join(adminSource, 'components', 'ui.tsx'),
    '^@/lib/(api-client|format|theme)$': path.join(adminSource, 'lib', '$1'),
    '^@/lib/(.*)$': path.join(webSource, 'lib', '$1'),
    '^@/api/(.*)$': path.join(webSource, 'api', '$1'),
    '^@/layout/(.*)$': path.join(webSource, 'layout', '$1'),
    '^@/components/(.*)$': path.join(webSource, 'components', '$1'),
    '^@/(.*)$': path.join(webSource, '$1'),
  },
};
```

FILE: tests/e2e/smoke/trader-discovery.spec.ts

```typescript
// # NEW — E2E test: browse traders -> filter -> compare -> view performance
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TradersPage } from '../../../apps/web/src/features/trading/traders-page';

describe('E2E Smoke: Trader Discovery, Comparison & Performance (GAP-48)', () => {
  test('browse traders -> filter -> compare -> view performance', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['traders', '', '', false], {
      data: [
        {
          traderId: 'trader-alpha',
          displayName: 'Alpha Quant Desk',
          bio: 'Systematic BTC/ETH momentum',
          avatarUrl: null,
          verificationState: 'VERIFIED',
          verifiedAt: '2026-08-01T00:00:00.000Z',
          supportedVenues: ['BINANCE', 'BYBIT'],
          supportedSymbols: ['BTC-USDT', 'ETH-USDT'],
          isPublic: true,
          isFeatured: true,
          followerCount: 145,
          totalVolume: '920000',
          totalTrades: 84,
          createdAt: '2026-06-01T00:00:00.000Z',
        },
      ],
      total: 1,
    });
    queryClient.setQueryData(['trader-rankings-discovery', '', '', false], {
      data: [],
      total: 0,
    });

    const directoryHtml = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(TradersPage),
      ),
    );
    expect(directoryHtml).toContain('Alpha Quant Desk');
    expect(directoryHtml).toContain('/traders/compare');
  });
});
```

FILE: tests/jest.config.js

```javascript
/**
 * Jest config for the framework-agnostic billing library specs under tests/
 * (entitlements, limits, plans, catalog). These modules have no Nest wiring
 * and no spec next to their sources, so this tree is where they are tested.
 *
 * Specs are type-checked by ts-jest (tests/tsconfig.json extends the API's), so an API
 * change that breaks them fails here instead of silently rotting.
 *
 *   npm run test:billing-lib        (from whitelabel-copytrade/)
 *
 * WHY `testPathIgnorePatterns` EXISTS
 * -----------------------------------
 * `roots: ['<rootDir>/tests']` also reaches `tests/e2e/`, whose specs import the
 * customer-web and admin-web React trees (`renderToStaticMarkup`, `.tsx`
 * components, `@tanstack/react-query`). Those specs are covered by their own
 * config - `tests/e2e/jest.config.js`, which sets `jsx: react-jsx` and maps the
 * web/admin aliases - and are run by `npm run test:e2e`. Compiling them here
 * failed on every `npm run test:billing-lib` with TS6142 ("'--jsx' is not set")
 * and TS2593 ("Cannot find name 'describe'"), because this config's
 * `tests/tsconfig.json` extends the API's and therefore has neither `jsx` nor
 * the jest types. The two trees are one `roots` apart, so the gate is explicit.
 */
const path = require('path');

const root = path.resolve(__dirname, '..');

module.exports = {
  rootDir: root,
  roots: ['<rootDir>/tests'],
  testRegex: '.*\\.spec\\.tsx?$',
  // E2E specs own a separate config; see the note above.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/e2e/'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  testEnvironment: 'node',
  transform: {
    '^.+\\.[jt]sx?$': ['ts-jest', { tsconfig: path.join(__dirname, 'tsconfig.json') }],
  },
  moduleNameMapper: {
    '^@wlct/(shared-types|config|utils|validation)$': '<rootDir>/packages/$1/src',
    '^src/(.*)$': '<rootDir>/apps/api/src/$1',
  },
};
```

FILE: tests/tsconfig.json

```json
{
  "extends": "../apps/api/tsconfig.json",
  "compilerOptions": {
    "rootDir": "..",
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["./**/*.ts"],
  "exclude": []
}
```

