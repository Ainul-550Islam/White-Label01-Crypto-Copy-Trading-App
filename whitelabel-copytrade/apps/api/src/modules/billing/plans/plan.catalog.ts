/**
 * Plan Catalog - Default plan configurations
 * 
 * This module defines the default billing plans available in the system.
 * These are used during initial setup and as templates for custom plans.
 */

import { PlanTier, BillingInterval, PlanFeature, PlanLimit } from './plan.types';

export interface PlanTemplate {
  name: string;
  slug: string;
  description: string;
  tier: PlanTier;
  price: {
    amount: number;
    currency: string;
    interval: BillingInterval;
    trialDays?: number;
  };
  features: PlanFeature[];
  limits: PlanLimit[];
  metadata: Record<string, string>;
}

export const DEFAULT_PLANS: PlanTemplate[] = [
  {
    name: 'Free',
    slug: 'free',
    description: 'Perfect for getting started with copy trading',
    tier: PlanTier.FREE,
    price: {
      amount: 0,
      currency: 'USD',
      interval: BillingInterval.MONTHLY,
    },
    features: [
      {
        key: 'basic_trading',
        name: 'Basic Trading',
        description: 'Execute basic buy/sell orders',
        enabled: true,
      },
      {
        key: 'portfolio_view',
        name: 'Portfolio View',
        description: 'View your portfolio and holdings',
        enabled: true,
      },
      {
        key: 'market_data',
        name: 'Market Data',
        description: 'Access to delayed market data',
        enabled: true,
      },
    ],
    limits: [
      {
        key: 'max_portfolios',
        name: 'Maximum Portfolios',
        description: 'Number of portfolios you can create',
        value: 1,
        unit: 'portfolios',
        hardLimit: true,
      },
      {
        key: 'max_orders_per_day',
        name: 'Daily Order Limit',
        description: 'Maximum orders per day',
        value: 10,
        unit: 'orders',
        hardLimit: true,
      },
      {
        key: 'max_position_value',
        name: 'Position Value Limit',
        description: 'Maximum total position value',
        value: 1000,
        unit: 'USD',
        hardLimit: true,
      },
    ],
    metadata: {
      displayOrder: '1',
      popular: 'false',
      recommended: 'false',
    },
  },
  {
    name: 'Basic',
    slug: 'basic',
    description: 'For active traders who want more features',
    tier: PlanTier.BASIC,
    price: {
      amount: 29,
      currency: 'USD',
      interval: BillingInterval.MONTHLY,
      trialDays: 7,
    },
    features: [
      {
        key: 'basic_trading',
        name: 'Basic Trading',
        description: 'Execute basic buy/sell orders',
        enabled: true,
      },
      {
        key: 'portfolio_view',
        name: 'Portfolio View',
        description: 'View your portfolio and holdings',
        enabled: true,
      },
      {
        key: 'real_time_data',
        name: 'Real-time Data',
        description: 'Access to real-time market data',
        enabled: true,
      },
      {
        key: 'copy_trading',
        name: 'Copy Trading',
        description: 'Copy trades from other traders',
        enabled: true,
        limit: 3,
        unit: 'traders',
      },
      {
        key: 'basic_analytics',
        name: 'Basic Analytics',
        description: 'Basic performance analytics',
        enabled: true,
      },
    ],
    limits: [
      {
        key: 'max_portfolios',
        name: 'Maximum Portfolios',
        description: 'Number of portfolios you can create',
        value: 3,
        unit: 'portfolios',
        hardLimit: true,
      },
      {
        key: 'max_orders_per_day',
        name: 'Daily Order Limit',
        description: 'Maximum orders per day',
        value: 50,
        unit: 'orders',
        hardLimit: true,
      },
      {
        key: 'max_position_value',
        name: 'Position Value Limit',
        description: 'Maximum total position value',
        value: 10000,
        unit: 'USD',
        hardLimit: true,
      },
      {
        key: 'max_copy_sources',
        name: 'Copy Sources',
        description: 'Maximum traders to copy from',
        value: 3,
        unit: 'traders',
        hardLimit: true,
      },
    ],
    metadata: {
      displayOrder: '2',
      popular: 'false',
      recommended: 'false',
    },
  },
  {
    name: 'Standard',
    slug: 'standard',
    description: 'Most popular plan for serious traders',
    tier: PlanTier.STANDARD,
    price: {
      amount: 79,
      currency: 'USD',
      interval: BillingInterval.MONTHLY,
      trialDays: 14,
    },
    features: [
      {
        key: 'basic_trading',
        name: 'Basic Trading',
        description: 'Execute basic buy/sell orders',
        enabled: true,
      },
      {
        key: 'portfolio_view',
        name: 'Portfolio View',
        description: 'View your portfolio and holdings',
        enabled: true,
      },
      {
        key: 'real_time_data',
        name: 'Real-time Data',
        description: 'Access to real-time market data',
        enabled: true,
      },
      {
        key: 'copy_trading',
        name: 'Copy Trading',
        description: 'Copy trades from other traders',
        enabled: true,
        limit: 10,
        unit: 'traders',
      },
      {
        key: 'advanced_analytics',
        name: 'Advanced Analytics',
        description: 'Advanced performance analytics and reports',
        enabled: true,
      },
      {
        key: 'risk_management',
        name: 'Risk Management',
        description: 'Advanced risk management tools',
        enabled: true,
      },
      {
        key: 'api_access',
        name: 'API Access',
        description: 'Access to trading API',
        enabled: true,
      },
    ],
    limits: [
      {
        key: 'max_portfolios',
        name: 'Maximum Portfolios',
        description: 'Number of portfolios you can create',
        value: 10,
        unit: 'portfolios',
        hardLimit: true,
      },
      {
        key: 'max_orders_per_day',
        name: 'Daily Order Limit',
        description: 'Maximum orders per day',
        value: 200,
        unit: 'orders',
        hardLimit: true,
      },
      {
        key: 'max_position_value',
        name: 'Position Value Limit',
        description: 'Maximum total position value',
        value: 100000,
        unit: 'USD',
        hardLimit: true,
      },
      {
        key: 'max_copy_sources',
        name: 'Copy Sources',
        description: 'Maximum traders to copy from',
        value: 10,
        unit: 'traders',
        hardLimit: true,
      },
      {
        key: 'api_rate_limit',
        name: 'API Rate Limit',
        description: 'API requests per minute',
        value: 100,
        unit: 'requests/min',
        hardLimit: true,
      },
    ],
    metadata: {
      displayOrder: '3',
      popular: 'true',
      recommended: 'true',
    },
  },
  {
    name: 'Premium',
    slug: 'premium',
    description: 'For professional traders and institutions',
    tier: PlanTier.PREMIUM,
    price: {
      amount: 199,
      currency: 'USD',
      interval: BillingInterval.MONTHLY,
      trialDays: 30,
    },
    features: [
      {
        key: 'basic_trading',
        name: 'Basic Trading',
        description: 'Execute basic buy/sell orders',
        enabled: true,
      },
      {
        key: 'portfolio_view',
        name: 'Portfolio View',
        description: 'View your portfolio and holdings',
        enabled: true,
      },
      {
        key: 'real_time_data',
        name: 'Real-time Data',
        description: 'Access to real-time market data',
        enabled: true,
      },
      {
        key: 'copy_trading',
        name: 'Copy Trading',
        description: 'Copy trades from other traders',
        enabled: true,
        limit: 50,
        unit: 'traders',
      },
      {
        key: 'advanced_analytics',
        name: 'Advanced Analytics',
        description: 'Advanced performance analytics and reports',
        enabled: true,
      },
      {
        key: 'risk_management',
        name: 'Risk Management',
        description: 'Advanced risk management tools',
        enabled: true,
      },
      {
        key: 'api_access',
        name: 'API Access',
        description: 'Access to trading API',
        enabled: true,
      },
      {
        key: 'priority_support',
        name: 'Priority Support',
        description: '24/7 priority customer support',
        enabled: true,
      },
      {
        key: 'custom_strategies',
        name: 'Custom Strategies',
        description: 'Create and deploy custom trading strategies',
        enabled: true,
      },
      {
        key: 'white_label',
        name: 'White Label',
        description: 'White label solutions for businesses',
        enabled: true,
      },
    ],
    limits: [
      {
        key: 'max_portfolios',
        name: 'Maximum Portfolios',
        description: 'Number of portfolios you can create',
        value: 100,
        unit: 'portfolios',
        hardLimit: true,
      },
      {
        key: 'max_orders_per_day',
        name: 'Daily Order Limit',
        description: 'Maximum orders per day',
        value: 1000,
        unit: 'orders',
        hardLimit: true,
      },
      {
        key: 'max_position_value',
        name: 'Position Value Limit',
        description: 'Maximum total position value',
        value: 1000000,
        unit: 'USD',
        hardLimit: true,
      },
      {
        key: 'max_copy_sources',
        name: 'Copy Sources',
        description: 'Maximum traders to copy from',
        value: 50,
        unit: 'traders',
        hardLimit: true,
      },
      {
        key: 'api_rate_limit',
        name: 'API Rate Limit',
        description: 'API requests per minute',
        value: 1000,
        unit: 'requests/min',
        hardLimit: true,
      },
      {
        key: 'max_strategies',
        name: 'Custom Strategies',
        description: 'Maximum custom strategies',
        value: 20,
        unit: 'strategies',
        hardLimit: true,
      },
    ],
    metadata: {
      displayOrder: '4',
      popular: 'false',
      recommended: 'false',
    },
  },
  {
    name: 'Enterprise',
    slug: 'enterprise',
    description: 'Custom solutions for large organizations',
    tier: PlanTier.ENTERPRISE,
    price: {
      amount: 0,
      currency: 'USD',
      interval: BillingInterval.LIFETIME,
    },
    features: [
      {
        key: 'all_features',
        name: 'All Features',
        description: 'Access to all platform features',
        enabled: true,
      },
      {
        key: 'dedicated_support',
        name: 'Dedicated Support',
        description: 'Dedicated account manager and support team',
        enabled: true,
      },
      {
        key: 'custom_development',
        name: 'Custom Development',
        description: 'Custom feature development',
        enabled: true,
      },
      {
        key: 'sla',
        name: 'SLA',
        description: 'Service Level Agreement',
        enabled: true,
      },
      {
        key: 'on_premise',
        name: 'On-Premise',
        description: 'On-premise deployment option',
        enabled: true,
      },
    ],
    limits: [
      {
        key: 'max_portfolios',
        name: 'Maximum Portfolios',
        description: 'Number of portfolios you can create',
        value: -1,
        unit: 'portfolios',
        hardLimit: false,
      },
      {
        key: 'max_orders_per_day',
        name: 'Daily Order Limit',
        description: 'Maximum orders per day',
        value: -1,
        unit: 'orders',
        hardLimit: false,
      },
      {
        key: 'max_position_value',
        name: 'Position Value Limit',
        description: 'Maximum total position value',
        value: -1,
        unit: 'USD',
        hardLimit: false,
      },
      {
        key: 'max_copy_sources',
        name: 'Copy Sources',
        description: 'Maximum traders to copy from',
        value: -1,
        unit: 'traders',
        hardLimit: false,
      },
      {
        key: 'api_rate_limit',
        name: 'API Rate Limit',
        description: 'API requests per minute',
        value: -1,
        unit: 'requests/min',
        hardLimit: false,
      },
      {
        key: 'max_strategies',
        name: 'Custom Strategies',
        description: 'Maximum custom strategies',
        value: -1,
        unit: 'strategies',
        hardLimit: false,
      },
    ],
    metadata: {
      displayOrder: '5',
      popular: 'false',
      recommended: 'false',
      customPricing: 'true',
    },
  },
];

export function getPlanBySlug(slug: string): PlanTemplate | undefined {
  return DEFAULT_PLANS.find(plan => plan.slug === slug);
}

export function getPlanByTier(tier: PlanTier): PlanTemplate | undefined {
  return DEFAULT_PLANS.find(plan => plan.tier === tier);
}

export function getPlansByTier(tier: PlanTier): PlanTemplate[] {
  return DEFAULT_PLANS.filter(plan => plan.tier === tier);
}

export function getActivePlans(): PlanTemplate[] {
  return DEFAULT_PLANS.filter(plan => plan.tier !== PlanTier.ENTERPRISE);
}

export function getPopularPlans(): PlanTemplate[] {
  return DEFAULT_PLANS.filter(plan => plan.metadata.popular === 'true');
}

export function getRecommendedPlans(): PlanTemplate[] {
  return DEFAULT_PLANS.filter(plan => plan.metadata.recommended === 'true');
}