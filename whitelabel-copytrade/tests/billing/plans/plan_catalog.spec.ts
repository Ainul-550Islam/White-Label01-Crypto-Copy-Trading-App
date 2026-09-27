import { describe, it, expect } from 'vitest';
import {
  BASIC_PLAN,
  STANDARD_PLAN,
  PREMIUM_PLAN,
  getBasicPlan,
  getStandardPlan,
  getPremiumPlan,
} from '../../../apps/api/src/modules/billing/catalog/basic.plan';
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
      const feature = plan.features.find(f => f.key === 'basic_trading');
      expect(feature).toBeDefined();
      expect(feature!.enabled).toBe(true);
    });

    it('should include copy trading with limit', () => {
      const plan = getBasicPlan();
      const feature = plan.features.find(f => f.key === 'copy_trading');
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

    it('should have 28 features', () => {
      const plan = getPremiumPlan();
      expect(plan.features).toHaveLength(28);
    });

    it('should have 13 limits', () => {
      const plan = getPremiumPlan();
      expect(plan.limits).toHaveLength(13);
    });

    it('should include margin trading', () => {
      const plan = getPremiumPlan();
      const feature = plan.features.find(f => f.key === 'margin_trading');
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
      features.forEach(f => {
        expect(f.supportedTiers).toContain('basic');
      });
    });

    it('should get features by category', () => {
      const tradingFeatures = getFeaturesByCategory('trading');
      expect(tradingFeatures.length).toBeGreaterThan(0);
      tradingFeatures.forEach(f => {
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
      features.forEach(f => {
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
      limits.forEach(l => {
        expect(l.values.basic).not.toBe(0);
      });
    });

    it('should get limits by category', () => {
      const portfolioLimits = getLimitsByCategory('portfolio');
      expect(portfolioLimits.length).toBeGreaterThan(0);
      portfolioLimits.forEach(l => {
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
      limits.forEach(l => {
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
});