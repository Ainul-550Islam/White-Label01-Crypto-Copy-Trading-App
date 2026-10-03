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
