/**
 * Entitlements Module - Admin Web Public API
 *
 * This module exports all public interfaces, types, and functions
 * for the billing entitlements feature in the admin interface.
 */

// Enums (runtime values - must be value re-exports under isolatedModules)
export { EntitlementStatus, UsagePeriod } from './entitlement-types';

// Types
export type {
  EntitlementFeature,
  EntitlementLimit,
  Entitlement,
  EntitlementSummary,
  EntitlementFilter,
  CreateEntitlementRequest,
  UpdateEntitlementRequest,
  UsageRecord,
} from './entitlement-types';

// API
export {
  getEntitlements,
  getEntitlement,
  createEntitlement,
  updateEntitlement,
  deleteEntitlement,
  suspendEntitlement,
  reactivateEntitlement,
  cancelEntitlement,
  changePlan,
  getUsageHistory,
  resetUsage,
  getEntitlementStats,
  checkFeatureAccess,
} from './entitlement-api';
