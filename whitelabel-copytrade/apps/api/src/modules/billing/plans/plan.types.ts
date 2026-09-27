/**
 * Plan Types - Type definitions for billing plans
 * 
 * These types define the structure of billing plans, their features,
 * limits, and pricing tiers in the platform.
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
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
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

export interface PlanFilter {
  tier?: PlanTier;
  status?: PlanStatus;
  minPrice?: number;
  maxPrice?: number;
  currency?: string;
  interval?: BillingInterval;
  search?: string;
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

export interface PlanComparison {
  plans: Plan[];
  features: string[];
  limits: string[];
  differences: Record<string, Record<string, unknown>>;
}