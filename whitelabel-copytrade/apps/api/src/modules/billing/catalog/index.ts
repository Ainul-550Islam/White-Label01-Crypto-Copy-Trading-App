/**
 * Catalog Module - Public API
 * 
 * This module exports all public interfaces, types, and configurations
 * for the billing catalog feature.
 */

// Basic Plan
export {
  BASIC_PLAN,
  BASIC_FEATURES,
  BASIC_LIMITS,
  getBasicPlan,
} from './basic.plan';

// Standard Plan
export {
  STANDARD_PLAN,
  STANDARD_FEATURES,
  STANDARD_LIMITS,
  getStandardPlan,
} from './standard.plan';

// Premium Plan
export {
  PREMIUM_PLAN,
  PREMIUM_FEATURES,
  PREMIUM_LIMITS,
  getPremiumPlan,
} from './premium.plan';

// Features
export {
  FeatureDefinition,
  FEATURE_DEFINITIONS,
  getFeaturesForTier,
  getFeaturesByCategory,
  getFeatureByKey,
  getCategories,
  buildPlanFeatures,
} from './plan.features';

// Limits
export {
  LimitDefinition,
  LIMIT_DEFINITIONS,
  getLimitsForTier,
  getLimitsByCategory,
  getLimitByKey,
  getLimitCategories,
  buildPlanLimits,
  formatLimitValue,
  compareLimits,
} from './plan.limits';

// Matrix
export {
  PlanMatrixEntry,
  PLAN_MATRIX,
  getPlanMatrix,
  getPlanByTier,
  compareFeatures,
  compareLimits as compareLimitsMatrix,
} from './plan.matrix';