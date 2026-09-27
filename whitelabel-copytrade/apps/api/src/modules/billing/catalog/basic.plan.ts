/**
 * Basic Plan - Basic tier plan configuration
 * 
 * This module defines the Basic plan features, limits, and pricing.
 */

import { PlanTier, BillingInterval, PlanFeature, PlanLimit } from '../plans/plan.types';

export const BASIC_PLAN = {
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
  metadata: {
    displayOrder: '2',
    popular: 'false',
    recommended: 'false',
    color: '#4F46E5',
    icon: 'star',
  },
};

export const BASIC_FEATURES: PlanFeature[] = [
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
  {
    key: 'email_alerts',
    name: 'Email Alerts',
    description: 'Receive email notifications',
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
];

export const BASIC_LIMITS: PlanLimit[] = [
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
  {
    key: 'max_exchanges',
    name: 'Maximum Exchanges',
    description: 'Number of exchanges you can connect',
    value: 2,
    unit: 'exchanges',
    hardLimit: true,
  },
  {
    key: 'max_alerts',
    name: 'Maximum Alerts',
    description: 'Number of price alerts you can set',
    value: 10,
    unit: 'alerts',
    hardLimit: true,
  },
  {
    key: 'api_requests_per_minute',
    name: 'API Rate Limit',
    description: 'API requests per minute',
    value: 30,
    unit: 'requests/min',
    hardLimit: true,
  },
  {
    key: 'max_historical_days',
    name: 'Historical Data',
    description: 'Days of historical data access',
    value: 30,
    unit: 'days',
    hardLimit: true,
  },
];

export function getBasicPlan() {
  return {
    ...BASIC_PLAN,
    features: BASIC_FEATURES,
    limits: BASIC_LIMITS,
  };
}