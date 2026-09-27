import { describe, it, expect } from 'vitest';
import {
  validateCreatePlan,
  validateUpdatePlan,
  validateSlug,
  validatePrice,
} from '../../../apps/api/src/modules/billing/plans/plan.validation';
import { PlanTier, BillingInterval } from '../../../apps/api/src/modules/billing/plans/plan.types';

describe('Plan Validation', () => {
  describe('validateCreatePlan', () => {
    it('should validate a valid create request', () => {
      const request = {
        tenantId: 'tenant-1',
        name: 'Basic Plan',
        slug: 'basic-plan',
        description: 'A basic plan',
        tier: PlanTier.BASIC,
        price: { amount: 29, currency: 'USD', interval: BillingInterval.MONTHLY },
        features: [],
        limits: [],
      };
      const result = validateCreatePlan(request);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should require tenant ID', () => {
      const request = {
        tenantId: '',
        name: 'Basic Plan',
        slug: 'basic-plan',
        description: 'A basic plan',
        tier: PlanTier.BASIC,
        price: { amount: 29, currency: 'USD', interval: BillingInterval.MONTHLY },
      };
      const result = validateCreatePlan(request);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Tenant ID is required');
    });

    it('should require name', () => {
      const request = {
        tenantId: 'tenant-1',
        name: '',
        slug: 'basic-plan',
        description: 'A basic plan',
        tier: PlanTier.BASIC,
        price: { amount: 29, currency: 'USD', interval: BillingInterval.MONTHLY },
      };
      const result = validateCreatePlan(request);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Plan name is required');
    });

    it('should require slug', () => {
      const request = {
        tenantId: 'tenant-1',
        name: 'Basic Plan',
        slug: '',
        description: 'A basic plan',
        tier: PlanTier.BASIC,
        price: { amount: 29, currency: 'USD', interval: BillingInterval.MONTHLY },
      };
      const result = validateCreatePlan(request);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Plan slug is required');
    });

    it('should validate slug format', () => {
      const request = {
        tenantId: 'tenant-1',
        name: 'Basic Plan',
        slug: 'Basic Plan!',
        description: 'A basic plan',
        tier: PlanTier.BASIC,
        price: { amount: 29, currency: 'USD', interval: BillingInterval.MONTHLY },
      };
      const result = validateCreatePlan(request);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Slug must contain only lowercase letters, numbers, and hyphens');
    });

    it('should require valid tier', () => {
      const request = {
        tenantId: 'tenant-1',
        name: 'Basic Plan',
        slug: 'basic-plan',
        description: 'A basic plan',
        tier: 'invalid' as PlanTier,
        price: { amount: 29, currency: 'USD', interval: BillingInterval.MONTHLY },
      };
      const result = validateCreatePlan(request);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid plan tier');
    });

    it('should validate price amount', () => {
      const request = {
        tenantId: 'tenant-1',
        name: 'Basic Plan',
        slug: 'basic-plan',
        description: 'A basic plan',
        tier: PlanTier.BASIC,
        price: { amount: -10, currency: 'USD', interval: BillingInterval.MONTHLY },
      };
      const result = validateCreatePlan(request);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Price amount must be non-negative');
    });
  });

  describe('validateUpdatePlan', () => {
    it('should validate a valid update request', () => {
      const request = {
        name: 'Updated Plan',
        description: 'Updated description',
      };
      const result = validateUpdatePlan(request);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should allow partial updates', () => {
      const request = {
        name: 'Updated Plan',
      };
      const result = validateUpdatePlan(request);
      expect(result.valid).toBe(true);
    });

    it('should validate name if provided', () => {
      const request = {
        name: '',
      };
      const result = validateUpdatePlan(request);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Plan name cannot be empty');
    });

    it('should validate tier if provided', () => {
      const request = {
        tier: 'invalid' as PlanTier,
      };
      const result = validateUpdatePlan(request);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid plan tier');
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
      expect(validatePrice({ amount: 29, currency: 'USD', interval: BillingInterval.MONTHLY }).valid).toBe(true);
      expect(validatePrice({ amount: 0, currency: 'USD', interval: BillingInterval.MONTHLY }).valid).toBe(true);
      expect(validatePrice({ amount: 199.99, currency: 'EUR', interval: BillingInterval.ANNUAL }).valid).toBe(true);
    });

    it('should reject negative amounts', () => {
      expect(validatePrice({ amount: -10, currency: 'USD', interval: BillingInterval.MONTHLY }).valid).toBe(false);
    });

    it('should reject invalid currency', () => {
      expect(validatePrice({ amount: 29, currency: '', interval: BillingInterval.MONTHLY }).valid).toBe(false);
    });

    it('should reject invalid interval', () => {
      expect(validatePrice({ amount: 29, currency: 'USD', interval: 'invalid' as BillingInterval }).valid).toBe(false);
    });
  });
});