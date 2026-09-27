/**
 * Plans Module - Admin Web Public API
 *
 * This module exports all public interfaces, types, and functions
 * for the billing plans feature in the admin interface.
 */

// Enums (runtime values - must be value re-exports under isolatedModules)
export { PlanTier, PlanStatus, BillingInterval } from './plan-types';

// Types
export type {
  PlanPrice,
  PlanFeature,
  PlanLimit,
  Plan,
  PlanSummary,
  PlanFilter,
  CreatePlanRequest,
  UpdatePlanRequest,
} from './plan-types';

// API
export {
  getPlans,
  getPlan,
  createPlan,
  updatePlan,
  deletePlan,
  activatePlan,
  deactivatePlan,
  archivePlan,
  duplicatePlan,
  getPlanStats,
  getPlanHistory,
} from './plan-api';

// Formatters
export {
  formatPrice,
  formatTier,
  formatStatus,
  formatInterval,
  formatFeature,
  formatLimit,
  formatAnnualSavings,
  getTierColor,
  getStatusColor,
  formatPlanSummary,
  formatPlanComparison,
} from './plan-formatters';
