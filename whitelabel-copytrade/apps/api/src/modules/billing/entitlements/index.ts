/**
 * Entitlements Module - Public API
 * 
 * This module exports all public interfaces, types, and services
 * for the billing entitlements feature.
 */

// Types
export {
  EntitlementStatus,
  EntitlementSource,
  Entitlement,
  EntitlementFeature,
  EntitlementLimit,
  CreateEntitlementRequest,
  UpdateEntitlementRequest,
  EntitlementFilter,
  EntitlementSummary,
  FeatureAccess,
  UsageRecord,
  EntitlementCheckResult,
} from './entitlement.types';

// Keys
export {
  FEATURE_KEYS,
  LIMIT_KEYS,
  FEATURE_CATEGORIES,
  LIMIT_CATEGORIES,
  FeatureKey,
  LimitKey,
  FeatureCategory,
  LimitCategory,
  isFeatureKey,
  isLimitKey,
  getFeatureCategory,
  getLimitCategory,
} from './entitlement.keys';

// Policy
export {
  EntitlementPolicyConfig,
  DEFAULT_POLICY_CONFIG,
  EntitlementPolicy,
} from './entitlement.policy';

// Service
export {
  EntitlementRepository,
  EntitlementService,
} from './entitlement.service';

// Resolver
export { EntitlementResolver } from './entitlement.resolver';

// Guard
export {
  GuardContext,
  GuardResult,
  EntitlementGuard,
} from './entitlement.guard';

// Errors
export {
  EntitlementError,
  EntitlementNotFoundError,
  EntitlementAlreadyExistsError,
  EntitlementNotActiveError,
  EntitlementExpiredError,
  FeatureNotEnabledError,
  FeatureLimitExceededError,
  LimitExceededError,
  HardLimitExceededError,
  EntitlementSuspendedError,
  EntitlementCancelledError,
  InvalidEntitlementError,
  EntitlementAccessDeniedError,
  isEntitlementError,
  getErrorCode,
  getStatusCode,
} from './entitlement.errors';