/**
 * Limits Module - Public API
 * 
 * This module exports all public interfaces, types, and services
 * for the billing limits feature.
 */

// Types
export {
  LimitType,
  LimitScope,
  LimitPeriod,
  LimitStatus,
  Limit,
  LimitUsage,
  CreateLimitRequest,
  UpdateLimitRequest,
  LimitFilter,
  LimitCheckResult,
  LimitUsageSummary,
  RateLimitConfig,
  LimitResetResult,
} from './limit.types';

// Keys
export {
  RATE_LIMIT_KEYS,
  RESOURCE_LIMIT_KEYS,
  VALUE_LIMIT_KEYS,
  STORAGE_LIMIT_KEYS,
  ALL_LIMIT_KEYS,
  RateLimitKey,
  ResourceLimitKey,
  ValueLimitKey,
  StorageLimitKey,
  LimitKey,
  isRateLimitKey,
  isResourceLimitKey,
  isValueLimitKey,
  isStorageLimitKey,
  isLimitKey,
  getLimitCategory,
  getLimitDisplayName,
} from './limit.keys';

// Policy
export {
  LimitPolicyConfig,
  DEFAULT_LIMIT_POLICY_CONFIG,
  LimitPolicy,
} from './limit.policy';

// Service
export {
  LimitRepository,
  LimitService,
} from './limit.service';

// Resolver
export { LimitResolver } from './limit.resolver';

// Guard
export {
  LimitGuardContext,
  LimitGuardResult,
  LimitGuard,
} from './limit.guard';