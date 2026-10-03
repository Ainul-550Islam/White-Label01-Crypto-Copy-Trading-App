/**
 * Plan Formatters for Admin Web
 *
 * Display helpers over the API's plan shape (`SubscriptionPlanDto`). Prices
 * are decimal strings and are never converted to floating point for
 * arithmetic; nothing here invents a price (the former "annual savings"
 * helper assumed a ten-month yearly price that no plan defines, and was
 * removed with the tier helpers in round 7).
 */

import {
  type BillingInterval,
  type Plan,
  type PlanAudience,
  type PlanLimits,
  PlanStatus,
  planStatus,
} from './plan-types';

const INTERVAL_SUFFIX: Record<BillingInterval, string> = {
  MONTHLY: '/mo',
  QUARTERLY: '/qtr',
  YEARLY: '/yr',
  LIFETIME: ' one-time',
};

const INTERVAL_LABEL: Record<BillingInterval, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  YEARLY: 'Yearly',
  LIFETIME: 'Lifetime',
};

const AUDIENCE_LABEL: Record<PlanAudience, string> = {
  TENANT: 'Organisations (B2B)',
  END_USER: 'End users (B2C)',
};

/** Human labels for the PlanLimits keys. */
export const LIMIT_LABELS: Record<keyof PlanLimits, string> = {
  maxUsers: 'Users',
  maxTraders: 'Traders',
  maxFollowersPerTrader: 'Followers per trader',
  maxExchangeAccountsPerUser: 'Exchange accounts per user',
  maxCopySubscriptionsPerFollower: 'Copy subscriptions per follower',
  maxApiRequestsPerMinute: 'API requests per minute',
  websocketConnections: 'WebSocket connections',
  customDomain: 'Custom domain',
  whiteLabelMobileApp: 'White-label mobile app',
  prioritySupport: 'Priority support',
};

/** "49.00 USD/mo"; a zero price is "Free". The decimal string is shown as stored. */
export function formatPrice(plan: Pick<Plan, 'price' | 'currency' | 'interval'>): string {
  const isZero = /^0+(\.0+)?$/.test(String(plan.price).trim());
  if (isZero) return 'Free';
  const suffix = INTERVAL_SUFFIX[plan.interval as BillingInterval] ?? '';
  return `${plan.price} ${plan.currency}${suffix}`;
}

export function formatInterval(interval: BillingInterval | string): string {
  return INTERVAL_LABEL[interval as BillingInterval] ?? interval;
}

export function formatAudience(audience: PlanAudience | string): string {
  return AUDIENCE_LABEL[audience as PlanAudience] ?? audience;
}

export function formatStatus(status: PlanStatus): string {
  return status === PlanStatus.ACTIVE ? 'Active' : 'Inactive';
}

export function getStatusColor(status: PlanStatus): string {
  return status === PlanStatus.ACTIVE ? '#10B981' : '#6B7280';
}

/** Basis points as a percentage: 250 -> "2.50%". */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/** A single limit: numbers (null = unlimited) or booleans (included / not included). */
export function formatLimit(key: keyof PlanLimits, value: PlanLimits[keyof PlanLimits]): string {
  const label = LIMIT_LABELS[key] ?? key;
  if (typeof value === 'boolean') return `${label}: ${value ? 'Included' : 'Not included'}`;
  if (value === null || value === undefined) return `${label}: Unlimited`;
  return `${label}: ${value.toLocaleString('en-US')}`;
}

export function formatPlanSummary(plan: Plan): string {
  return `${plan.name} (${plan.code}) - ${formatPrice(plan)} - ${formatStatus(planStatus(plan))}`;
}

/**
 * A comparison table: header row, one row per feature (from the plans'
 * `features` arrays) and one row per limit.
 */
export function formatPlanComparison(plans: Plan[]): string[][] {
  const rows: string[][] = [['Feature', ...plans.map((p) => p.name)]];

  const featureKeys = new Set<string>();
  plans.forEach((p) => (p.features ?? []).forEach((f) => featureKeys.add(f)));
  [...featureKeys].sort().forEach((featureKey) => {
    rows.push([featureKey, ...plans.map((plan) => ((plan.features ?? []).includes(featureKey) ? '✓' : '✗'))]);
  });

  (Object.keys(LIMIT_LABELS) as Array<keyof PlanLimits>).forEach((key) => {
    rows.push([
      LIMIT_LABELS[key],
      ...plans.map((plan) => {
        const value = plan.limits?.[key];
        if (typeof value === 'boolean') return value ? '✓' : '✗';
        if (value === null || value === undefined) return 'Unlimited';
        return value.toLocaleString('en-US');
      }),
    ]);
  });

  return rows;
}
