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
