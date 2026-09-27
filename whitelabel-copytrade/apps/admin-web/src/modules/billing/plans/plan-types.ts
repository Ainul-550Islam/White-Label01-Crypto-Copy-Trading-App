/**
 * Plan Types for Admin Web
 * 
 * Type definitions for billing plans in the admin interface.
 */

export enum PlanTier {
  FREE = 'free',
  BASIC = 'basic',
  STANDARD = 'standard',
  PREMIUM = 'premium',
  ENTERPRISE = 'enterprise',
}

export enum PlanStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  DEPRECATED = 'deprecated',
  ARCHIVED = 'archived',
}

export enum BillingInterval {
  MONTHLY = 'monthly',
  QUARTERLY = 'quarterly',
  ANNUAL = 'annual',
  LIFETIME = 'lifetime',
}

export interface PlanPrice {
  amount: number;
  currency: string;
  interval: BillingInterval;
  trialDays?: number;
}

export interface PlanFeature {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  limit?: number;
  unit?: string;
}

export interface PlanLimit {
  key: string;
  name: string;
  description: string;
  value: number;
  unit: string;
  hardLimit: boolean;
}

export interface Plan {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  description: string;
  tier: PlanTier;
  status: PlanStatus;
  price: PlanPrice;
  features: PlanFeature[];
  limits: PlanLimit[];
  metadata: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

export interface PlanSummary {
  id: string;
  name: string;
  tier: PlanTier;
  status: PlanStatus;
  price: PlanPrice;
  featureCount: number;
  limitCount: number;
}

export interface PlanFilter {
  tier?: PlanTier;
  status?: PlanStatus;
  search?: string;
}

export interface CreatePlanRequest {
  name: string;
  slug: string;
  description: string;
  tier: PlanTier;
  price: PlanPrice;
  features: PlanFeature[];
  limits: PlanLimit[];
  metadata?: Record<string, string>;
}

export interface UpdatePlanRequest {
  name?: string;
  description?: string;
  tier?: PlanTier;
  status?: PlanStatus;
  price?: PlanPrice;
  features?: PlanFeature[];
  limits?: PlanLimit[];
  metadata?: Record<string, string>;
}