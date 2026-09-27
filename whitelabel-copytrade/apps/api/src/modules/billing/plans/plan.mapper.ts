/**
 * Plan Mapper - Maps between different plan representations
 * 
 * This module handles mapping between domain models, DTOs,
 * and external representations of plans.
 */

import { Plan, PlanSummary, PlanFeature, PlanLimit } from './plan.types';

export interface PlanDTO {
  id: string;
  name: string;
  slug: string;
  description: string;
  tier: string;
  status: string;
  price: {
    amount: number;
    currency: string;
    interval: string;
    trialDays?: number;
  };
  features: PlanFeatureDTO[];
  limits: PlanLimitDTO[];
  metadata: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface PlanFeatureDTO {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  limit?: number;
  unit?: string;
}

export interface PlanLimitDTO {
  key: string;
  name: string;
  description: string;
  value: number;
  unit: string;
  hardLimit: boolean;
}

export interface PlanSummaryDTO {
  id: string;
  name: string;
  tier: string;
  status: string;
  price: {
    amount: number;
    currency: string;
    interval: string;
  };
  featureCount: number;
  limitCount: number;
}

export function toPlanDTO(plan: Plan): PlanDTO {
  return {
    id: plan.id,
    name: plan.name,
    slug: plan.slug,
    description: plan.description,
    tier: plan.tier,
    status: plan.status,
    price: {
      amount: plan.price.amount,
      currency: plan.price.currency,
      interval: plan.price.interval,
      trialDays: plan.price.trialDays,
    },
    features: plan.features.map(toPlanFeatureDTO),
    limits: plan.limits.map(toPlanLimitDTO),
    metadata: plan.metadata,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

export function toPlanFeatureDTO(feature: PlanFeature): PlanFeatureDTO {
  return {
    key: feature.key,
    name: feature.name,
    description: feature.description,
    enabled: feature.enabled,
    limit: feature.limit,
    unit: feature.unit,
  };
}

export function toPlanLimitDTO(limit: PlanLimit): PlanLimitDTO {
  return {
    key: limit.key,
    name: limit.name,
    description: limit.description,
    value: limit.value,
    unit: limit.unit,
    hardLimit: limit.hardLimit,
  };
}

export function toPlanSummaryDTO(summary: PlanSummary): PlanSummaryDTO {
  return {
    id: summary.id,
    name: summary.name,
    tier: summary.tier,
    status: summary.status,
    price: {
      amount: summary.price.amount,
      currency: summary.price.currency,
      interval: summary.price.interval,
    },
    featureCount: summary.featureCount,
    limitCount: summary.limitCount,
  };
}

export function toPlanListDTO(plans: Plan[]): PlanDTO[] {
  return plans.map(toPlanDTO);
}

export function toPlanSummaryListDTO(summaries: PlanSummary[]): PlanSummaryDTO[] {
  return summaries.map(toPlanSummaryDTO);
}

export function calculatePlanValue(plan: Plan): number {
  const monthlyPrice = plan.price.interval === 'annual' 
    ? plan.price.amount / 12 
    : plan.price.amount;
  
  return monthlyPrice;
}

export function formatPlanPrice(plan: Plan): string {
  const { amount, currency, interval } = plan.price;
  
  if (amount === 0) {
    return 'Free';
  }

  const formattedAmount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
  }).format(amount);

  const intervalMap: Record<string, string> = {
    monthly: '/mo',
    quarterly: '/qtr',
    annual: '/yr',
    lifetime: '',
  };

  return `${formattedAmount}${intervalMap[interval] || ''}`;
}

export function getPlanDisplayOrder(plan: Plan): number {
  const tierOrder: Record<string, number> = {
    free: 0,
    basic: 1,
    standard: 2,
    premium: 3,
    enterprise: 4,
  };

  return tierOrder[plan.tier] ?? 999;
}

export function sortPlansByTier(plans: Plan[]): Plan[] {
  return [...plans].sort((a, b) => getPlanDisplayOrder(a) - getPlanDisplayOrder(b));
}