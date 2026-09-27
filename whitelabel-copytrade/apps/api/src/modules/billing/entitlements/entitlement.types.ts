/**
 * Entitlement Types - Type definitions for billing entitlements
 * 
 * These types define the structure of entitlements which represent
 * what features and capabilities a user/tenant has access to.
 */

export enum EntitlementStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
  PENDING = 'pending',
}

export enum EntitlementSource {
  PLAN = 'plan',
  ADDON = 'addon',
  PROMOTION = 'promotion',
  MANUAL = 'manual',
  TRIAL = 'trial',
}

export interface Entitlement {
  id: string;
  tenantId: string;
  userId: string;
  planId: string;
  status: EntitlementStatus;
  source: EntitlementSource;
  features: EntitlementFeature[];
  limits: EntitlementLimit[];
  startsAt: Date;
  expiresAt?: Date;
  cancelledAt?: Date;
  metadata: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
}

export interface EntitlementFeature {
  key: string;
  name: string;
  enabled: boolean;
  limit?: number;
  used?: number;
  unit?: string;
  expiresAt?: Date;
}

export interface EntitlementLimit {
  key: string;
  name: string;
  value: number;
  used: number;
  unit: string;
  hardLimit: boolean;
  resetAt?: Date;
}

export interface CreateEntitlementRequest {
  tenantId: string;
  userId: string;
  planId: string;
  source: EntitlementSource;
  startsAt?: Date;
  expiresAt?: Date;
  metadata?: Record<string, string>;
}

export interface UpdateEntitlementRequest {
  status?: EntitlementStatus;
  features?: EntitlementFeature[];
  limits?: EntitlementLimit[];
  expiresAt?: Date;
  metadata?: Record<string, string>;
}

export interface EntitlementFilter {
  tenantId?: string;
  userId?: string;
  planId?: string;
  status?: EntitlementStatus;
  source?: EntitlementSource;
  activeOnly?: boolean;
  expiringBefore?: Date;
}

export interface EntitlementSummary {
  id: string;
  tenantId: string;
  userId: string;
  planId: string;
  planName: string;
  status: EntitlementStatus;
  source: EntitlementSource;
  featureCount: number;
  limitCount: number;
  startsAt: Date;
  expiresAt?: Date;
}

export interface FeatureAccess {
  featureKey: string;
  allowed: boolean;
  reason?: string;
  limit?: number;
  used?: number;
  remaining?: number;
  resetsAt?: Date;
}

export interface UsageRecord {
  featureKey: string;
  amount: number;
  timestamp: Date;
  metadata?: Record<string, string>;
}

export interface EntitlementCheckResult {
  allowed: boolean;
  entitlement: Entitlement | null;
  feature?: EntitlementFeature;
  limit?: EntitlementLimit;
  reason?: string;
}