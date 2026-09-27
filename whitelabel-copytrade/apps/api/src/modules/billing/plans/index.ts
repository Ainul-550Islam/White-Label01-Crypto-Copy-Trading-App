/**
 * Plans Module - Public API
 * 
 * This module exports all public interfaces, types, and services
 * for the billing plans feature.
 */

// Types
export {
  PlanTier,
  PlanStatus,
  BillingInterval,
  PlanPrice,
  PlanFeature,
  PlanLimit,
  Plan,
  CreatePlanRequest,
  UpdatePlanRequest,
  PlanFilter,
  PlanSummary,
  PlanComparison,
} from './plan.types';

// Catalog
export {
  PlanTemplate,
  DEFAULT_PLANS,
  getPlanBySlug,
  getPlanByTier,
  getPlansByTier,
  getActivePlans,
  getPopularPlans,
  getRecommendedPlans,
} from './plan.catalog';

// Repository
export { PlanRepository } from './plan.repository';

// Service
export { PlanService } from './plan.service';

// Mapper
export {
  PlanDTO,
  PlanFeatureDTO,
  PlanLimitDTO,
  PlanSummaryDTO,
  toPlanDTO,
  toPlanFeatureDTO,
  toPlanLimitDTO,
  toPlanSummaryDTO,
  toPlanListDTO,
  toPlanSummaryListDTO,
  calculatePlanValue,
  formatPlanPrice,
  getPlanDisplayOrder,
  sortPlansByTier,
} from './plan.mapper';

// Validation
export {
  ValidationResult,
  validateCreatePlan,
  validateUpdatePlan,
  validatePlanSlug,
  validatePlanPrice,
} from './plan.validation';