/**
 * Entitlement Errors - Error types for entitlement operations
 * 
 * This module defines custom error types for entitlement-related
 * operations to provide better error handling and messaging.
 */

export class EntitlementError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'EntitlementError';
  }
}

export class EntitlementNotFoundError extends EntitlementError {
  constructor(entitlementId: string) {
    super(
      `Entitlement not found: ${entitlementId}`,
      'ENTITLEMENT_NOT_FOUND',
      404,
      { entitlementId }
    );
    this.name = 'EntitlementNotFoundError';
  }
}

export class EntitlementAlreadyExistsError extends EntitlementError {
  constructor(userId: string, tenantId: string) {
    super(
      `User already has an active entitlement`,
      'ENTITLEMENT_ALREADY_EXISTS',
      409,
      { userId, tenantId }
    );
    this.name = 'EntitlementAlreadyExistsError';
  }
}

export class EntitlementNotActiveError extends EntitlementError {
  constructor(entitlementId: string, status: string) {
    super(
      `Entitlement is not active: ${status}`,
      'ENTITLEMENT_NOT_ACTIVE',
      403,
      { entitlementId, status }
    );
    this.name = 'EntitlementNotActiveError';
  }
}

export class EntitlementExpiredError extends EntitlementError {
  constructor(entitlementId: string, expiresAt: Date) {
    super(
      `Entitlement has expired`,
      'ENTITLEMENT_EXPIRED',
      403,
      { entitlementId, expiresAt: expiresAt.toISOString() }
    );
    this.name = 'EntitlementExpiredError';
  }
}

export class FeatureNotEnabledError extends EntitlementError {
  constructor(featureKey: string) {
    super(
      `Feature not enabled: ${featureKey}`,
      'FEATURE_NOT_ENABLED',
      403,
      { featureKey }
    );
    this.name = 'FeatureNotEnabledError';
  }
}

export class FeatureLimitExceededError extends EntitlementError {
  constructor(featureKey: string, limit: number, used: number) {
    super(
      `Feature limit exceeded: ${featureKey}`,
      'FEATURE_LIMIT_EXCEEDED',
      429,
      { featureKey, limit, used }
    );
    this.name = 'FeatureLimitExceededError';
  }
}

export class LimitExceededError extends EntitlementError {
  constructor(limitKey: string, limit: number, used: number) {
    super(
      `Limit exceeded: ${limitKey}`,
      'LIMIT_EXCEEDED',
      429,
      { limitKey, limit, used }
    );
    this.name = 'LimitExceededError';
  }
}

export class HardLimitExceededError extends EntitlementError {
  constructor(limitKey: string, limit: number, used: number) {
    super(
      `Hard limit exceeded: ${limitKey}`,
      'HARD_LIMIT_EXCEEDED',
      429,
      { limitKey, limit, used }
    );
    this.name = 'HardLimitExceededError';
  }
}

export class EntitlementSuspendedError extends EntitlementError {
  constructor(entitlementId: string) {
    super(
      `Entitlement is suspended`,
      'ENTITLEMENT_SUSPENDED',
      403,
      { entitlementId }
    );
    this.name = 'EntitlementSuspendedError';
  }
}

export class EntitlementCancelledError extends EntitlementError {
  constructor(entitlementId: string) {
    super(
      `Entitlement is cancelled`,
      'ENTITLEMENT_CANCELLED',
      403,
      { entitlementId }
    );
    this.name = 'EntitlementCancelledError';
  }
}

export class InvalidEntitlementError extends EntitlementError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(
      message,
      'INVALID_ENTITLEMENT',
      400,
      details
    );
    this.name = 'InvalidEntitlementError';
  }
}

export class EntitlementAccessDeniedError extends EntitlementError {
  constructor(userId: string, resource: string) {
    super(
      `Access denied to resource: ${resource}`,
      'ENTITLEMENT_ACCESS_DENIED',
      403,
      { userId, resource }
    );
    this.name = 'EntitlementAccessDeniedError';
  }
}

export function isEntitlementError(error: unknown): error is EntitlementError {
  return error instanceof EntitlementError;
}

export function getErrorCode(error: unknown): string {
  if (isEntitlementError(error)) {
    return error.code;
  }
  return 'UNKNOWN_ERROR';
}

export function getStatusCode(error: unknown): number {
  if (isEntitlementError(error)) {
    return error.statusCode;
  }
  return 500;
}