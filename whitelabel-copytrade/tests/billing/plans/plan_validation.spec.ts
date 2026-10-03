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
