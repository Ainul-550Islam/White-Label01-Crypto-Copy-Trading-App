/**
 * Entitlement Types for Admin Web
 * 
 * Type definitions for billing entitlements in the admin interface.
 */

export enum EntitlementStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
  TRIAL = 'trial',
}

export enum UsagePeriod {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
  LIFETIME = 'lifetime',
}

export interface EntitlementFeature {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  limit?: number;
  unit?: string;
  usage?: number;
  usagePercentage?: number;
}

export interface EntitlementLimit {
  key: string;
  name: string;
  description: string;
  value: number;
  unit: string;
  usage: number;
  usagePercentage: number;
  hardLimit: boolean;
  resetAt?: string;
}

export interface Entitlement {
  id: string;
  tenantId: string;
  userId: string;
  planId: string;
  planName: string;
  planTier: string;
  status: EntitlementStatus;
  features: EntitlementFeature[];
  limits: EntitlementLimit[];
  startsAt: string;
  expiresAt?: string;
  trialEndsAt?: string;
  cancelledAt?: string;
  metadata: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface EntitlementSummary {
  id: string;
  userId: string;
  planName: string;
  planTier: string;
  status: EntitlementStatus;
  featureCount: number;
  limitCount: number;
  startsAt: string;
  expiresAt?: string;
}

export interface EntitlementFilter {
  tenantId?: string;
  userId?: string;
  planId?: string;
  status?: EntitlementStatus;
  search?: string;
}

export interface CreateEntitlementRequest {
  tenantId: string;
  userId: string;
  planId: string;
  startsAt?: string;
  expiresAt?: string;
  metadata?: Record<string, string>;
}

export interface UpdateEntitlementRequest {
  planId?: string;
  status?: EntitlementStatus;
  expiresAt?: string;
  metadata?: Record<string, string>;
}

export interface UsageRecord {
  id: string;
  entitlementId: string;
  featureKey: string;
  usage: number;
  period: UsagePeriod;
  recordedAt: string;
  metadata?: Record<string, string>;
}