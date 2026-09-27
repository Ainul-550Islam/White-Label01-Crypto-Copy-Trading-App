import { describe, it, expect, beforeEach } from 'vitest';
import { EntitlementGuard } from '../../../apps/api/src/modules/billing/entitlements/entitlement.guard';
import { EntitlementStatus } from '../../../apps/api/src/modules/billing/entitlements/entitlement.types';

describe('EntitlementGuard', () => {
  let guard: EntitlementGuard;

  beforeEach(() => {
    guard = new EntitlementGuard();
  });

  describe('hasFeatureAccess', () => {
    it('should return true when feature is enabled', () => {
      const entitlement = {
        id: 'ent-1',
        status: EntitlementStatus.ACTIVE,
        features: [{ key: 'basic_trading', enabled: true }],
        limits: [],
      };

      const result = guard.hasFeatureAccess(entitlement as any, 'basic_trading');
      expect(result).toBe(true);
    });

    it('should return false when feature is disabled', () => {
      const entitlement = {
        id: 'ent-1',
        status: EntitlementStatus.ACTIVE,
        features: [{ key: 'margin_trading', enabled: false }],
        limits: [],
      };

      const result = guard.hasFeatureAccess(entitlement as any, 'margin_trading');
      expect(result).toBe(false);
    });

    it('should return false when entitlement is suspended', () => {
      const entitlement = {
        id: 'ent-1',
        status: EntitlementStatus.SUSPENDED,
        features: [{ key: 'basic_trading', enabled: true }],
        limits: [],
      };

      const result = guard.hasFeatureAccess(entitlement as any, 'basic_trading');
      expect(result).toBe(false);
    });

    it('should return false when feature not found', () => {
      const entitlement = {
        id: 'ent-1',
        status: EntitlementStatus.ACTIVE,
        features: [],
        limits: [],
      };

      const result = guard.hasFeatureAccess(entitlement as any, 'unknown');
      expect(result).toBe(false);
    });
  });

  describe('hasAllFeatures', () => {
    it('should return true when all features are enabled', () => {
      const entitlement = {
        id: 'ent-1',
        status: EntitlementStatus.ACTIVE,
        features: [
          { key: 'basic_trading', enabled: true },
          { key: 'copy_trading', enabled: true },
        ],
        limits: [],
      };

      const result = guard.hasAllFeatures(entitlement as any, ['basic_trading', 'copy_trading']);
      expect(result).toBe(true);
    });

    it('should return false when any feature is missing', () => {
      const entitlement = {
        id: 'ent-1',
        status: EntitlementStatus.ACTIVE,
        features: [{ key: 'basic_trading', enabled: true }],
        limits: [],
      };

      const result = guard.hasAllFeatures(entitlement as any, ['basic_trading', 'margin_trading']);
      expect(result).toBe(false);
    });
  });

  describe('hasAnyFeature', () => {
    it('should return true when at least one feature is enabled', () => {
      const entitlement = {
        id: 'ent-1',
        status: EntitlementStatus.ACTIVE,
        features: [
          { key: 'basic_trading', enabled: true },
          { key: 'margin_trading', enabled: false },
        ],
        limits: [],
      };

      const result = guard.hasAnyFeature(entitlement as any, ['basic_trading', 'margin_trading']);
      expect(result).toBe(true);
    });

    it('should return false when no features are enabled', () => {
      const entitlement = {
        id: 'ent-1',
        status: EntitlementStatus.ACTIVE,
        features: [
          { key: 'basic_trading', enabled: false },
          { key: 'margin_trading', enabled: false },
        ],
        limits: [],
      };

      const result = guard.hasAnyFeature(entitlement as any, ['basic_trading', 'margin_trading']);
      expect(result).toBe(false);
    });
  });

  describe('checkAndRecordUsage', () => {
    it('should allow action when within limits', () => {
      const entitlement = {
        id: 'ent-1',
        status: EntitlementStatus.ACTIVE,
        features: [{ key: 'api_access', enabled: true }],
        limits: [{ key: 'api_requests_per_minute', value: 100, usage: 50, unit: 'req/min', hardLimit: true }],
      };

      const result = guard.checkAndRecordUsage(entitlement as any, 'api_requests_per_minute', 1);
      expect(result.allowed).toBe(true);
    });

    it('should deny action when limit exceeded', () => {
      const entitlement = {
        id: 'ent-1',
        status: EntitlementStatus.ACTIVE,
        features: [{ key: 'api_access', enabled: true }],
        limits: [{ key: 'api_requests_per_minute', value: 100, usage: 100, unit: 'req/min', hardLimit: true }],
      };

      const result = guard.checkAndRecordUsage(entitlement as any, 'api_requests_per_minute', 1);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('exceeded');
    });
  });

  describe('canUpgradePlan', () => {
    it('should allow upgrade from basic', () => {
      const entitlement = {
        id: 'ent-1',
        status: EntitlementStatus.ACTIVE,
        planTier: 'basic',
      };

      const result = guard.canUpgradePlan(entitlement as any);
      expect(result).toBe(true);
    });

    it('should not allow upgrade from enterprise', () => {
      const entitlement = {
        id: 'ent-1',
        status: EntitlementStatus.ACTIVE,
        planTier: 'enterprise',
      };

      const result = guard.canUpgradePlan(entitlement as any);
      expect(result).toBe(false);
    });
  });

  describe('canDowngradePlan', () => {
    it('should allow downgrade from premium', () => {
      const entitlement = {
        id: 'ent-1',
        status: EntitlementStatus.ACTIVE,
        planTier: 'premium',
      };

      const result = guard.canDowngradePlan(entitlement as any);
      expect(result).toBe(true);
    });

    it('should not allow downgrade from free', () => {
      const entitlement = {
        id: 'ent-1',
        status: EntitlementStatus.ACTIVE,
        planTier: 'free',
      };

      const result = guard.canDowngradePlan(entitlement as any);
      expect(result).toBe(false);
    });
  });
});