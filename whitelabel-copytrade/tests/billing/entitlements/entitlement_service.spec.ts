import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EntitlementService } from '../../../apps/api/src/modules/billing/entitlements/entitlement.service';
import { EntitlementStatus } from '../../../apps/api/src/modules/billing/entitlements/entitlement.types';

describe('EntitlementService', () => {
  let service: EntitlementService;

  beforeEach(() => {
    service = new EntitlementService();
  });

  describe('checkFeatureAccess', () => {
    it('should allow access when feature is enabled', async () => {
      const entitlement = {
        id: 'ent-1',
        status: EntitlementStatus.ACTIVE,
        features: [{ key: 'basic_trading', enabled: true }],
        limits: [],
      };

      const result = await service.checkFeatureAccess(entitlement as any, 'basic_trading');
      expect(result.allowed).toBe(true);
    });

    it('should deny access when feature is disabled', async () => {
      const entitlement = {
        id: 'ent-1',
        status: EntitlementStatus.ACTIVE,
        features: [{ key: 'margin_trading', enabled: false }],
        limits: [],
      };

      const result = await service.checkFeatureAccess(entitlement as any, 'margin_trading');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not enabled');
    });

    it('should deny access when entitlement is not active', async () => {
      const entitlement = {
        id: 'ent-1',
        status: EntitlementStatus.SUSPENDED,
        features: [{ key: 'basic_trading', enabled: true }],
        limits: [],
      };

      const result = await service.checkFeatureAccess(entitlement as any, 'basic_trading');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not active');
    });

    it('should deny access when feature not found', async () => {
      const entitlement = {
        id: 'ent-1',
        status: EntitlementStatus.ACTIVE,
        features: [],
        limits: [],
      };

      const result = await service.checkFeatureAccess(entitlement as any, 'unknown_feature');
      expect(result.allowed).toBe(false);
    });
  });

  describe('recordUsage', () => {
    it('should record usage for a feature', async () => {
      const entitlement = {
        id: 'ent-1',
        status: EntitlementStatus.ACTIVE,
        features: [{ key: 'api_access', enabled: true }],
        limits: [{ key: 'api_requests_per_minute', value: 100, usage: 50, unit: 'req/min' }],
      };

      const result = await service.recordUsage(entitlement as any, 'api_requests_per_minute', 1);
      expect(result.success).toBe(true);
    });

    it('should reject usage when limit exceeded', async () => {
      const entitlement = {
        id: 'ent-1',
        status: EntitlementStatus.ACTIVE,
        features: [{ key: 'api_access', enabled: true }],
        limits: [{ key: 'api_requests_per_minute', value: 100, usage: 100, unit: 'req/min', hardLimit: true }],
      };

      const result = await service.recordUsage(entitlement as any, 'api_requests_per_minute', 1);
      expect(result.success).toBe(false);
      expect(result.reason).toContain('exceeded');
    });
  });

  describe('getEntitlementSummary', () => {
    it('should return summary for active entitlement', async () => {
      const entitlement = {
        id: 'ent-1',
        status: EntitlementStatus.ACTIVE,
        planName: 'Basic',
        planTier: 'basic',
        features: [
          { key: 'basic_trading', enabled: true },
          { key: 'margin_trading', enabled: false },
        ],
        limits: [
          { key: 'max_portfolios', value: 3, usage: 1 },
          { key: 'max_orders_per_day', value: 50, usage: 45 },
        ],
        startsAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };

      const summary = await service.getEntitlementSummary(entitlement as any);
      expect(summary.planName).toBe('Basic');
      expect(summary.featureCount).toBe(2);
      expect(summary.enabledFeatureCount).toBe(1);
      expect(summary.limitCount).toBe(2);
    });
  });

  describe('resetUsage', () => {
    it('should reset usage for a specific limit', async () => {
      const entitlement = {
        id: 'ent-1',
        status: EntitlementStatus.ACTIVE,
        limits: [
          { key: 'max_orders_per_day', value: 50, usage: 45, unit: 'orders' },
        ],
      };

      const result = await service.resetUsage(entitlement as any, 'max_orders_per_day');
      expect(result.success).toBe(true);
      expect(result.resetValue).toBe(0);
    });
  });
});