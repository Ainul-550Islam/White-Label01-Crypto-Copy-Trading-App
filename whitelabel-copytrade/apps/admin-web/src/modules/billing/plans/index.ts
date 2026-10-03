/**
 * Plans Module - Admin Web Public API
 *
 * Types, API calls and formatters for the plan catalogue. Every call maps to
 * a route of /v1/billing/plans (see plan-api.ts).
 */

// Runtime values (value re-exports under isolatedModules)
export { PlanStatus, BILLING_INTERVALS, PLAN_AUDIENCES, PLAN_CURRENCIES, planStatus } from './plan-types';

// Types
export type {
  Plan,
  PlanLimits,
  BillingInterval,
  PlanAudience,
  PlanCurrency,
  PlanFilter,
  PlanPage,
  CreatePlanRequest,
  UpdatePlanRequest,
  ArchivePlanResult,
} from './plan-types';

// API
export {
  getPlans,
  getPlan,
  createPlan,
  updatePlan,
  activatePlan,
  deactivatePlan,
  archivePlan,
} from './plan-api';

// Formatters
export {
  LIMIT_LABELS,
  formatPrice,
  formatInterval,
  formatAudience,
  formatStatus,
  getStatusColor,
  formatBps,
  formatLimit,
  formatPlanSummary,
  formatPlanComparison,
} from './plan-formatters';
