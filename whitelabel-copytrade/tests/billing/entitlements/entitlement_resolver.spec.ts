import { describe, it, expect, beforeEach } from 'vitest';
import { EntitlementResolver } from '../../../apps/api/src/modules/billing/entitlements/entitlement.resolver';
import { EntitlementStatus } from '../../../apps/api/src/modules/billing/entitlements/entitlement.types';

describe('EntitlementResolver', () => {
  let resolver: EntitlementResolver;

  beforeEach(() => {
    resolver = new EntitlementResolver();
  });

  describe('entitlement', () => {
    it('should resolve entitlement by ID', async () => {
      const mockEntitlement = {
        id: 'ent-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
        planId: 'plan-basic',
        planName: 'Basic',
        planTier: 'basic',
        status: EntitlementStatus.ACTIVE,
        features: [],
        limits: [],
        startsAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Mock the service dependency
      (resolver as any).entitlementService = {
        getEntitlement: async () => mockEntitlement,
      };

      const result = await resolver.entitlement({ id: 'ent-1' });
      expect(result).toEqual(mockEntitlement);
    });
  });

  describe('userEntitlements', () => {
    it('should resolve user entitlements', async () => {
      const mockEntitlements = [
        { id: 'ent-1', userId: 'user-1', status: EntitlementStatus.ACTIVE },
        { id: 'ent-2', userId: 'user-1', status: EntitlementStatus.EXPIRED },
      ];

      (resolver as any).entitlementService = {
        getUserEntitlements: async () => mockEntitlements,
      };

      const result = await resolver.userEntitlements({ userId: 'user-1' });
      expect(result).toHaveLength(2);
    });
  });

  describe('createEntitlement', () => {
    it('should create a new entitlement', async () => {
      const input = {
        tenantId: 'tenant-1',
        userId: 'user-1',
        planId: 'plan-basic',
      };

      const mockCreated = {
        id: 'ent-new',
        ...input,
        status: EntitlementStatus.ACTIVE,
        features: [],
        limits: [],
        startsAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (resolver as any).entitlementService = {
        createEntitlement: async () => mockCreated,
      };

      const result = await resolver.createEntitlement({ input });
      expect(result.id).toBe('ent-new');
      expect(result.status).toBe(EntitlementStatus.ACTIVE);
    });
  });

  describe('updateEntitlement', () => {
    it('should update an existing entitlement', async () => {
      const input = {
        status: EntitlementStatus.SUSPENDED,
      };

      const mockUpdated = {
        id: 'ent-1',
        status: EntitlementStatus.SUSPENDED,
      };

      (resolver as any).entitlementService = {
        updateEntitlement: async () => mockUpdated,
      };

      const result = await resolver.updateEntitlement({ id: 'ent-1', input });
      expect(result.status).toBe(EntitlementStatus.SUSPENDED);
    });
  });

  describe('checkFeatureAccess', () => {
    it('should check feature access', async () => {
      const mockResult = {
        allowed: true,
        featureEnabled: true,
        limitCheck: null,
      };

      (resolver as any).entitlementService = {
        checkFeatureAccess: async () => mockResult,
      };

      const result = await resolver.checkFeatureAccess({
        entitlementId: 'ent-1',
        featureKey: 'basic_trading',
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('field resolvers', () => {
    it('should resolve features field', async () => {
      const entitlement = {
        id: 'ent-1',
        features: [
          { key: 'basic_trading', enabled: true },
          { key: 'copy_trading', enabled: true },
        ],
      };

      const result = await resolver.features(entitlement as any);
      expect(result).toHaveLength(2);
    });

    it('should resolve limits field', async () => {
      const entitlement = {
        id: 'ent-1',
        limits: [
          { key: 'max_portfolios', value: 3, usage: 1 },
        ],
      };

      const result = await resolver.limits(entitlement as any);
      expect(result).toHaveLength(1);
    });

    it('should resolve isActive field', async () => {
      const entitlement = {
        id: 'ent-1',
        status: EntitlementStatus.ACTIVE,
      };

      const result = await resolver.isActive(entitlement as any);
      expect(result).toBe(true);
    });

    it('should resolve isTrial field', async () => {
      const entitlement = {
        id: 'ent-1',
        status: EntitlementStatus.TRIAL,
      };

      const result = await resolver.isTrial(entitlement as any);
      expect(result).toBe(true);
    });
  });
});