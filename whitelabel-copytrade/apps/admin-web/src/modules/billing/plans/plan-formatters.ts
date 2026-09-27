/**
 * Plan Formatters for Admin Web
 * 
 * Utility functions for formatting plan data for display.
 */

import {
  Plan,
  PlanSummary,
  PlanTier,
  PlanStatus,
  BillingInterval,
  PlanPrice,
  PlanFeature,
  PlanLimit,
} from './plan-types';

export function formatPrice(price: PlanPrice): string {
  if (price.amount === 0) return 'Free';
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: price.currency || 'USD',
  }).format(price.amount);

  switch (price.interval) {
    case BillingInterval.MONTHLY:
      return `${formatted}/mo`;
    case BillingInterval.QUARTERLY:
      return `${formatted}/qtr`;
    case BillingInterval.ANNUAL:
      return `${formatted}/yr`;
    case BillingInterval.LIFETIME:
      return `${formatted} one-time`;
    default:
      return formatted;
  }
}

export function formatTier(tier: PlanTier): string {
  const labels: Record<PlanTier, string> = {
    [PlanTier.FREE]: 'Free',
    [PlanTier.BASIC]: 'Basic',
    [PlanTier.STANDARD]: 'Standard',
    [PlanTier.PREMIUM]: 'Premium',
    [PlanTier.ENTERPRISE]: 'Enterprise',
  };
  return labels[tier] || tier;
}

export function formatStatus(status: PlanStatus): string {
  const labels: Record<PlanStatus, string> = {
    [PlanStatus.ACTIVE]: 'Active',
    [PlanStatus.INACTIVE]: 'Inactive',
    [PlanStatus.DEPRECATED]: 'Deprecated',
    [PlanStatus.ARCHIVED]: 'Archived',
  };
  return labels[status] || status;
}

export function formatInterval(interval: BillingInterval): string {
  const labels: Record<BillingInterval, string> = {
    [BillingInterval.MONTHLY]: 'Monthly',
    [BillingInterval.QUARTERLY]: 'Quarterly',
    [BillingInterval.ANNUAL]: 'Annual',
    [BillingInterval.LIFETIME]: 'Lifetime',
  };
  return labels[interval] || interval;
}

export function formatFeature(feature: PlanFeature): string {
  if (!feature.enabled) return `${feature.name}: Disabled`;
  if (feature.limit !== undefined) {
    return `${feature.name}: ${feature.limit.toLocaleString()} ${feature.unit || ''}`.trim();
  }
  return `${feature.name}: Enabled`;
}

export function formatLimit(limit: PlanLimit): string {
  if (limit.value === -1) return `${limit.name}: Unlimited`;
  return `${limit.name}: ${limit.value.toLocaleString()} ${limit.unit}`;
}

export function formatAnnualSavings(price: PlanPrice): string {
  if (price.interval !== BillingInterval.MONTHLY) return '';
  const annualPrice = price.amount * 10;
  const savings = price.amount * 12 - annualPrice;
  const percentage = Math.round((savings / (price.amount * 12)) * 100);
  return `Save ${percentage}% ($${savings.toFixed(2)}/yr)`;
}

export function getTierColor(tier: PlanTier): string {
  const colors: Record<PlanTier, string> = {
    [PlanTier.FREE]: '#6B7280',
    [PlanTier.BASIC]: '#3B82F6',
    [PlanTier.STANDARD]: '#8B5CF6',
    [PlanTier.PREMIUM]: '#F59E0B',
    [PlanTier.ENTERPRISE]: '#10B981',
  };
  return colors[tier] || '#6B7280';
}

export function getStatusColor(status: PlanStatus): string {
  const colors: Record<PlanStatus, string> = {
    [PlanStatus.ACTIVE]: '#10B981',
    [PlanStatus.INACTIVE]: '#6B7280',
    [PlanStatus.DEPRECATED]: '#F59E0B',
    [PlanStatus.ARCHIVED]: '#EF4444',
  };
  return colors[status] || '#6B7280';
}

export function formatPlanSummary(summary: PlanSummary): string {
  return `${summary.name} (${formatTier(summary.tier)}) - ${formatPrice(summary.price)}`;
}

export function formatPlanComparison(plans: Plan[]): string[][] {
  const header = ['Feature', ...plans.map(p => p.name)];
  const rows: string[][] = [header];

  const allFeatures = new Set<string>();
  plans.forEach(p => p.features.forEach(f => allFeatures.add(f.key)));

  allFeatures.forEach(featureKey => {
    const row = [featureKey];
    plans.forEach(plan => {
      const feature = plan.features.find(f => f.key === featureKey);
      row.push(feature?.enabled ? '✓' : '✗');
    });
    rows.push(row);
  });

  return rows;
}