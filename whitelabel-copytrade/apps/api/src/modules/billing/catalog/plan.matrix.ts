/**
 * Plan Matrix - Comparison matrix for all plans
 * 
 * This module provides a comprehensive comparison matrix
 * for all plan tiers.
 */

import { PlanTier, BillingInterval } from '../plans/plan.types';
import { FEATURE_DEFINITIONS, getFeaturesForTier } from './plan.features';
import { LIMIT_DEFINITIONS, getLimitsForTier, formatLimitValue } from './plan.limits';

export interface PlanMatrixEntry {
  tier: PlanTier;
  name: string;
  price: {
    monthly: number;
    annual: number;
    annualSavings: number;
  };
  features: {
    key: string;
    name: string;
    enabled: boolean;
    limit?: number;
    unit?: string;
  }[];
  limits: {
    key: string;
    name: string;
    value: number;
    unit: string;
    formatted: string;
  }[];
}

export const PLAN_MATRIX: PlanMatrixEntry[] = [
  {
    tier: PlanTier.FREE,
    name: 'Free',
    price: { monthly: 0, annual: 0, annualSavings: 0 },
    features: [
      { key: 'basic_trading', name: 'Basic Trading', enabled: true },
      { key: 'portfolio_view', name: 'Portfolio View', enabled: true },
      { key: 'market_data', name: 'Market Data', enabled: true },
      { key: 'stop_loss', name: 'Stop Loss', enabled: true },
      { key: 'take_profit', name: 'Take Profit', enabled: true },
      { key: 'two_factor_auth', name: 'Two-Factor Auth', enabled: true },
    ],
    limits: [
      { key: 'max_portfolios', name: 'Portfolios', value: 1, unit: 'portfolios', formatted: '1 portfolio' },
      { key: 'max_orders_per_day', name: 'Daily Orders', value: 10, unit: 'orders', formatted: '10 orders' },
      { key: 'max_position_value', name: 'Position Value', value: 1000, unit: 'USD', formatted: '$1,000' },
    ],
  },
  {
    tier: PlanTier.BASIC,
    name: 'Basic',
    price: { monthly: 29, annual: 290, annualSavings: 58 },
    features: [
      { key: 'basic_trading', name: 'Basic Trading', enabled: true },
      { key: 'portfolio_view', name: 'Portfolio View', enabled: true },
      { key: 'real_time_data', name: 'Real-time Data', enabled: true },
      { key: 'copy_trading', name: 'Copy Trading', enabled: true, limit: 3, unit: 'traders' },
      { key: 'basic_analytics', name: 'Basic Analytics', enabled: true },
      { key: 'email_alerts', name: 'Email Alerts', enabled: true },
      { key: 'stop_loss', name: 'Stop Loss', enabled: true },
      { key: 'take_profit', name: 'Take Profit', enabled: true },
      { key: 'two_factor_auth', name: 'Two-Factor Auth', enabled: true },
    ],
    limits: [
      { key: 'max_portfolios', name: 'Portfolios', value: 3, unit: 'portfolios', formatted: '3 portfolios' },
      { key: 'max_orders_per_day', name: 'Daily Orders', value: 50, unit: 'orders', formatted: '50 orders' },
      { key: 'max_position_value', name: 'Position Value', value: 10000, unit: 'USD', formatted: '$10,000' },
      { key: 'max_copy_sources', name: 'Copy Sources', value: 3, unit: 'traders', formatted: '3 traders' },
      { key: 'max_exchanges', name: 'Exchanges', value: 2, unit: 'exchanges', formatted: '2 exchanges' },
    ],
  },
  {
    tier: PlanTier.STANDARD,
    name: 'Standard',
    price: { monthly: 79, annual: 790, annualSavings: 158 },
    features: [
      { key: 'basic_trading', name: 'Basic Trading', enabled: true },
      { key: 'portfolio_view', name: 'Portfolio View', enabled: true },
      { key: 'real_time_data', name: 'Real-time Data', enabled: true },
      { key: 'copy_trading', name: 'Copy Trading', enabled: true, limit: 10, unit: 'traders' },
      { key: 'advanced_analytics', name: 'Advanced Analytics', enabled: true },
      { key: 'risk_management', name: 'Risk Management', enabled: true },
      { key: 'api_access', name: 'API Access', enabled: true },
      { key: 'email_alerts', name: 'Email Alerts', enabled: true },
      { key: 'push_notifications', name: 'Push Notifications', enabled: true },
      { key: 'stop_loss', name: 'Stop Loss', enabled: true },
      { key: 'take_profit', name: 'Take Profit', enabled: true },
      { key: 'position_sizing', name: 'Position Sizing', enabled: true },
      { key: 'custom_reports', name: 'Custom Reports', enabled: true },
      { key: 'webhook_support', name: 'Webhook Support', enabled: true },
      { key: 'two_factor_auth', name: 'Two-Factor Auth', enabled: true },
    ],
    limits: [
      { key: 'max_portfolios', name: 'Portfolios', value: 10, unit: 'portfolios', formatted: '10 portfolios' },
      { key: 'max_orders_per_day', name: 'Daily Orders', value: 200, unit: 'orders', formatted: '200 orders' },
      { key: 'max_position_value', name: 'Position Value', value: 100000, unit: 'USD', formatted: '$100,000' },
      { key: 'max_copy_sources', name: 'Copy Sources', value: 10, unit: 'traders', formatted: '10 traders' },
      { key: 'max_exchanges', name: 'Exchanges', value: 5, unit: 'exchanges', formatted: '5 exchanges' },
      { key: 'max_strategies', name: 'Strategies', value: 5, unit: 'strategies', formatted: '5 strategies' },
      { key: 'api_requests_per_minute', name: 'API Rate', value: 100, unit: 'req/min', formatted: '100 req/min' },
    ],
  },
  {
    tier: PlanTier.PREMIUM,
    name: 'Premium',
    price: { monthly: 199, annual: 1990, annualSavings: 398 },
    features: [
      { key: 'basic_trading', name: 'Basic Trading', enabled: true },
      { key: 'advanced_trading', name: 'Advanced Trading', enabled: true },
      { key: 'margin_trading', name: 'Margin Trading', enabled: true },
      { key: 'portfolio_view', name: 'Portfolio View', enabled: true },
      { key: 'real_time_data', name: 'Real-time Data', enabled: true },
      { key: 'historical_data', name: 'Historical Data', enabled: true },
      { key: 'advanced_charts', name: 'Advanced Charts', enabled: true },
      { key: 'copy_trading', name: 'Copy Trading', enabled: true, limit: 50, unit: 'traders' },
      { key: 'copy_trading_premium', name: 'Premium Copy Trading', enabled: true },
      { key: 'social_trading', name: 'Social Trading', enabled: true },
      { key: 'advanced_analytics', name: 'Advanced Analytics', enabled: true },
      { key: 'custom_reports', name: 'Custom Reports', enabled: true },
      { key: 'portfolio_analytics', name: 'Portfolio Analytics', enabled: true },
      { key: 'risk_management', name: 'Risk Management', enabled: true },
      { key: 'position_sizing', name: 'Position Sizing', enabled: true },
      { key: 'api_access', name: 'API Access', enabled: true },
      { key: 'websocket_streaming', name: 'WebSocket Streaming', enabled: true },
      { key: 'webhook_support', name: 'Webhook Support', enabled: true },
      { key: 'email_alerts', name: 'Email Alerts', enabled: true },
      { key: 'push_notifications', name: 'Push Notifications', enabled: true },
      { key: 'sms_alerts', name: 'SMS Alerts', enabled: true },
      { key: 'priority_support', name: 'Priority Support', enabled: true },
      { key: 'custom_strategies', name: 'Custom Strategies', enabled: true },
      { key: 'backtesting', name: 'Backtesting', enabled: true },
      { key: 'stop_loss', name: 'Stop Loss', enabled: true },
      { key: 'take_profit', name: 'Take Profit', enabled: true },
      { key: 'two_factor_auth', name: 'Two-Factor Auth', enabled: true },
      { key: 'ip_whitelist', name: 'IP Whitelist', enabled: true },
      { key: 'tax_reporting', name: 'Tax Reporting', enabled: true },
    ],
    limits: [
      { key: 'max_portfolios', name: 'Portfolios', value: 100, unit: 'portfolios', formatted: '100 portfolios' },
      { key: 'max_orders_per_day', name: 'Daily Orders', value: 1000, unit: 'orders', formatted: '1,000 orders' },
      { key: 'max_position_value', name: 'Position Value', value: 1000000, unit: 'USD', formatted: '$1,000,000' },
      { key: 'max_copy_sources', name: 'Copy Sources', value: 50, unit: 'traders', formatted: '50 traders' },
      { key: 'max_exchanges', name: 'Exchanges', value: 20, unit: 'exchanges', formatted: '20 exchanges' },
      { key: 'max_strategies', name: 'Strategies', value: 20, unit: 'strategies', formatted: '20 strategies' },
      { key: 'api_requests_per_minute', name: 'API Rate', value: 1000, unit: 'req/min', formatted: '1,000 req/min' },
      { key: 'max_storage_mb', name: 'Storage', value: 5000, unit: 'MB', formatted: '5 GB' },
    ],
  },
  {
    tier: PlanTier.ENTERPRISE,
    name: 'Enterprise',
    price: { monthly: 0, annual: 0, annualSavings: 0 },
    features: FEATURE_DEFINITIONS.map(f => ({
      key: f.key,
      name: f.name,
      enabled: true,
      limit: f.limits?.enterprise,
      unit: f.unit,
    })),
    limits: LIMIT_DEFINITIONS.map(l => ({
      key: l.key,
      name: l.name,
      value: -1,
      unit: l.unit,
      formatted: 'Unlimited',
    })),
  },
];

export function getPlanMatrix(): PlanMatrixEntry[] {
  return PLAN_MATRIX;
}

export function getPlanByTier(tier: PlanTier): PlanMatrixEntry | undefined {
  return PLAN_MATRIX.find(p => p.tier === tier);
}

export function compareFeatures(
  tier1: PlanTier,
  tier2: PlanTier
): { key: string; name: string; tier1: boolean; tier2: boolean }[] {
  const plan1 = getPlanByTier(tier1);
  const plan2 = getPlanByTier(tier2);
  
  if (!plan1 || !plan2) return [];

  const allFeatures = new Set([
    ...plan1.features.map(f => f.key),
    ...plan2.features.map(f => f.key),
  ]);

  return Array.from(allFeatures).map(key => {
    const f1 = plan1.features.find(f => f.key === key);
    const f2 = plan2.features.find(f => f.key === key);
    return {
      key,
      name: f1?.name || f2?.name || key,
      tier1: f1?.enabled || false,
      tier2: f2?.enabled || false,
    };
  });
}

export function compareLimits(
  tier1: PlanTier,
  tier2: PlanTier
): { key: string; name: string; tier1: string; tier2: string }[] {
  const plan1 = getPlanByTier(tier1);
  const plan2 = getPlanByTier(tier2);
  
  if (!plan1 || !plan2) return [];

  const allLimits = new Set([
    ...plan1.limits.map(l => l.key),
    ...plan2.limits.map(l => l.key),
  ]);

  return Array.from(allLimits).map(key => {
    const l1 = plan1.limits.find(l => l.key === key);
    const l2 = plan2.limits.find(l => l.key === key);
    return {
      key,
      name: l1?.name || l2?.name || key,
      tier1: l1?.formatted || '-',
      tier2: l2?.formatted || '-',
    };
  });
}