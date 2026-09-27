/**
 * Plan Limits - Limit definitions for all plans
 * 
 * This module defines all available limits and their configurations
 * across different plan tiers.
 */

import { PlanLimit } from '../plans/plan.types';

export interface LimitDefinition {
  key: string;
  name: string;
  description: string;
  category: string;
  unit: string;
  hardLimit: boolean;
  values: {
    basic: number;
    standard: number;
    premium: number;
    enterprise: number;
  };
}

export const LIMIT_DEFINITIONS: LimitDefinition[] = [
  // Portfolio Limits
  {
    key: 'max_portfolios',
    name: 'Maximum Portfolios',
    description: 'Number of portfolios you can create',
    category: 'portfolio',
    unit: 'portfolios',
    hardLimit: true,
    values: { basic: 3, standard: 10, premium: 100, enterprise: -1 },
  },
  {
    key: 'max_exchanges',
    name: 'Maximum Exchanges',
    description: 'Number of exchanges you can connect',
    category: 'portfolio',
    unit: 'exchanges',
    hardLimit: true,
    values: { basic: 2, standard: 5, premium: 20, enterprise: -1 },
  },

  // Order Limits
  {
    key: 'max_orders_per_day',
    name: 'Daily Order Limit',
    description: 'Maximum orders per day',
    category: 'orders',
    unit: 'orders',
    hardLimit: true,
    values: { basic: 50, standard: 200, premium: 1000, enterprise: -1 },
  },
  {
    key: 'max_orders_per_hour',
    name: 'Hourly Order Limit',
    description: 'Maximum orders per hour',
    category: 'orders',
    unit: 'orders',
    hardLimit: true,
    values: { basic: 10, standard: 50, premium: 200, enterprise: -1 },
  },
  {
    key: 'max_orders_per_minute',
    name: 'Minute Order Limit',
    description: 'Maximum orders per minute',
    category: 'orders',
    unit: 'orders',
    hardLimit: true,
    values: { basic: 2, standard: 10, premium: 50, enterprise: -1 },
  },

  // Position Limits
  {
    key: 'max_position_value',
    name: 'Position Value Limit',
    description: 'Maximum total position value',
    category: 'positions',
    unit: 'USD',
    hardLimit: true,
    values: { basic: 10000, standard: 100000, premium: 1000000, enterprise: -1 },
  },
  {
    key: 'max_order_value',
    name: 'Order Value Limit',
    description: 'Maximum single order value',
    category: 'positions',
    unit: 'USD',
    hardLimit: true,
    values: { basic: 5000, standard: 50000, premium: 500000, enterprise: -1 },
  },
  {
    key: 'max_open_positions',
    name: 'Open Positions',
    description: 'Maximum open positions',
    category: 'positions',
    unit: 'positions',
    hardLimit: true,
    values: { basic: 10, standard: 50, premium: 200, enterprise: -1 },
  },

  // Copy Trading Limits
  {
    key: 'max_copy_sources',
    name: 'Copy Sources',
    description: 'Maximum traders to copy from',
    category: 'copy_trading',
    unit: 'traders',
    hardLimit: true,
    values: { basic: 3, standard: 10, premium: 50, enterprise: -1 },
  },
  {
    key: 'max_copy_amount',
    name: 'Copy Amount',
    description: 'Maximum amount per copy trade',
    category: 'copy_trading',
    unit: 'USD',
    hardLimit: true,
    values: { basic: 1000, standard: 10000, premium: 100000, enterprise: -1 },
  },

  // Strategy Limits
  {
    key: 'max_strategies',
    name: 'Custom Strategies',
    description: 'Maximum custom strategies',
    category: 'strategies',
    unit: 'strategies',
    hardLimit: true,
    values: { basic: 0, standard: 5, premium: 20, enterprise: -1 },
  },
  {
    key: 'max_strategy_runs',
    name: 'Strategy Runs',
    description: 'Maximum strategy executions per day',
    category: 'strategies',
    unit: 'runs',
    hardLimit: true,
    values: { basic: 0, standard: 100, premium: 1000, enterprise: -1 },
  },
  {
    key: 'max_backtest_days',
    name: 'Backtest Days',
    description: 'Maximum days for backtesting',
    category: 'strategies',
    unit: 'days',
    hardLimit: true,
    values: { basic: 0, standard: 30, premium: 365, enterprise: -1 },
  },

  // API Limits
  {
    key: 'api_requests_per_minute',
    name: 'API Rate Limit',
    description: 'API requests per minute',
    category: 'api',
    unit: 'requests/min',
    hardLimit: true,
    values: { basic: 30, standard: 100, premium: 1000, enterprise: -1 },
  },
  {
    key: 'api_requests_per_day',
    name: 'Daily API Limit',
    description: 'API requests per day',
    category: 'api',
    unit: 'requests/day',
    hardLimit: true,
    values: { basic: 1000, standard: 10000, premium: 100000, enterprise: -1 },
  },
  {
    key: 'max_api_keys',
    name: 'API Keys',
    description: 'Number of API keys',
    category: 'api',
    unit: 'keys',
    hardLimit: true,
    values: { basic: 1, standard: 3, premium: 10, enterprise: -1 },
  },

  // Alert Limits
  {
    key: 'max_alerts',
    name: 'Maximum Alerts',
    description: 'Number of price alerts',
    category: 'alerts',
    unit: 'alerts',
    hardLimit: true,
    values: { basic: 10, standard: 50, premium: 200, enterprise: -1 },
  },
  {
    key: 'max_webhooks',
    name: 'Maximum Webhooks',
    description: 'Number of webhook endpoints',
    category: 'alerts',
    unit: 'webhooks',
    hardLimit: true,
    values: { basic: 0, standard: 5, premium: 20, enterprise: -1 },
  },

  // Data Limits
  {
    key: 'max_historical_days',
    name: 'Historical Data',
    description: 'Days of historical data access',
    category: 'data',
    unit: 'days',
    hardLimit: true,
    values: { basic: 30, standard: 90, premium: 365, enterprise: -1 },
  },
  {
    key: 'max_data_exports',
    name: 'Data Exports',
    description: 'Number of data exports per month',
    category: 'data',
    unit: 'exports',
    hardLimit: true,
    values: { basic: 5, standard: 20, premium: 100, enterprise: -1 },
  },

  // Storage Limits
  {
    key: 'max_storage_mb',
    name: 'Storage',
    description: 'Storage space for files',
    category: 'storage',
    unit: 'MB',
    hardLimit: true,
    values: { basic: 100, standard: 1000, premium: 5000, enterprise: -1 },
  },

  // User Limits
  {
    key: 'max_team_members',
    name: 'Team Members',
    description: 'Number of team members',
    category: 'users',
    unit: 'members',
    hardLimit: true,
    values: { basic: 1, standard: 3, premium: 20, enterprise: -1 },
  },
];

export function getLimitsForTier(tier: 'basic' | 'standard' | 'premium' | 'enterprise'): LimitDefinition[] {
  return LIMIT_DEFINITIONS.filter(limit => limit.values[tier] !== 0);
}

export function getLimitsByCategory(category: string): LimitDefinition[] {
  return LIMIT_DEFINITIONS.filter(limit => limit.category === category);
}

export function getLimitByKey(key: string): LimitDefinition | undefined {
  return LIMIT_DEFINITIONS.find(limit => limit.key === key);
}

export function getLimitCategories(): string[] {
  const categories = new Set(LIMIT_DEFINITIONS.map(l => l.category));
  return Array.from(categories).sort();
}

export function buildPlanLimits(tier: 'basic' | 'standard' | 'premium' | 'enterprise'): PlanLimit[] {
  return getLimitsForTier(tier).map(limit => ({
    key: limit.key,
    name: limit.name,
    description: limit.description,
    value: limit.values[tier],
    unit: limit.unit,
    hardLimit: limit.hardLimit,
  }));
}

export function formatLimitValue(value: number, unit: string): string {
  if (value === -1) return 'Unlimited';
  return `${value.toLocaleString()} ${unit}`;
}

export function compareLimits(
  tier1: 'basic' | 'standard' | 'premium' | 'enterprise',
  tier2: 'basic' | 'standard' | 'premium' | 'enterprise'
): { key: string; name: string; tier1Value: number; tier2Value: number; difference: number }[] {
  return LIMIT_DEFINITIONS.map(limit => ({
    key: limit.key,
    name: limit.name,
    tier1Value: limit.values[tier1],
    tier2Value: limit.values[tier2],
    difference: limit.values[tier2] - limit.values[tier1],
  }));
}