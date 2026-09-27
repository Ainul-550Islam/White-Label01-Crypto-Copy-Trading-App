/**
 * Standard Plan - Standard tier plan configuration
 * 
 * This module defines the Standard plan features, limits, and pricing.
 */

import { PlanTier, BillingInterval, PlanFeature, PlanLimit } from '../plans/plan.types';

export const STANDARD_PLAN = {
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
  metadata: {
    displayOrder: '3',
    popular: 'true',
    recommended: 'true',
    color: '#7C3AED',
    icon: 'crown',
  },
};

export const STANDARD_FEATURES: PlanFeature[] = [
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
  {
    key: 'email_alerts',
    name: 'Email Alerts',
    description: 'Receive email notifications',
    enabled: true,
  },
  {
    key: 'push_notifications',
    name: 'Push Notifications',
    description: 'Receive push notifications',
    enabled: true,
  },
  {
    key: 'stop_loss',
    name: 'Stop Loss',
    description: 'Set stop loss orders',
    enabled: true,
  },
  {
    key: 'take_profit',
    name: 'Take Profit',
    description: 'Set take profit orders',
    enabled: true,
  },
  {
    key: 'position_sizing',
    name: 'Position Sizing',
    description: 'Automatic position sizing',
    enabled: true,
  },
  {
    key: 'custom_reports',
    name: 'Custom Reports',
    description: 'Create custom reports',
    enabled: true,
  },
  {
    key: 'webhook_support',
    name: 'Webhook Support',
    description: 'Receive webhook notifications',
    enabled: true,
  },
];

export const STANDARD_LIMITS: PlanLimit[] = [
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
    key: 'max_exchanges',
    name: 'Maximum Exchanges',
    description: 'Number of exchanges you can connect',
    value: 5,
    unit: 'exchanges',
    hardLimit: true,
  },
  {
    key: 'max_alerts',
    name: 'Maximum Alerts',
    description: 'Number of price alerts you can set',
    value: 50,
    unit: 'alerts',
    hardLimit: true,
  },
  {
    key: 'api_requests_per_minute',
    name: 'API Rate Limit',
    description: 'API requests per minute',
    value: 100,
    unit: 'requests/min',
    hardLimit: true,
  },
  {
    key: 'max_historical_days',
    name: 'Historical Data',
    description: 'Days of historical data access',
    value: 90,
    unit: 'days',
    hardLimit: true,
  },
  {
    key: 'max_strategies',
    name: 'Custom Strategies',
    description: 'Maximum custom strategies',
    value: 5,
    unit: 'strategies',
    hardLimit: true,
  },
  {
    key: 'max_webhooks',
    name: 'Maximum Webhooks',
    description: 'Number of webhook endpoints',
    value: 5,
    unit: 'webhooks',
    hardLimit: true,
  },
  {
    key: 'max_api_keys',
    name: 'API Keys',
    description: 'Number of API keys',
    value: 3,
    unit: 'keys',
    hardLimit: true,
  },
  {
    key: 'max_team_members',
    name: 'Team Members',
    description: 'Number of team members',
    value: 3,
    unit: 'members',
    hardLimit: true,
  },
];

export function getStandardPlan() {
  return {
    ...STANDARD_PLAN,
    features: STANDARD_FEATURES,
    limits: STANDARD_LIMITS,
  };
}