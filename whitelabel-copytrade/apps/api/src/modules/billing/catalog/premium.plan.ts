/**
 * Premium Plan - Premium tier plan configuration
 * 
 * This module defines the Premium plan features, limits, and pricing.
 */

import { PlanTier, BillingInterval, PlanFeature, PlanLimit } from '../plans/plan.types';

export const PREMIUM_PLAN = {
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
  metadata: {
    displayOrder: '4',
    popular: 'false',
    recommended: 'false',
    color: '#F59E0B',
    icon: 'diamond',
  },
};

export const PREMIUM_FEATURES: PlanFeature[] = [
  {
    key: 'basic_trading',
    name: 'Basic Trading',
    description: 'Execute basic buy/sell orders',
    enabled: true,
  },
  {
    key: 'advanced_trading',
    name: 'Advanced Trading',
    description: 'Advanced order types and execution',
    enabled: true,
  },
  {
    key: 'margin_trading',
    name: 'Margin Trading',
    description: 'Trade with leverage',
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
    key: 'historical_data',
    name: 'Historical Data',
    description: 'Access to historical market data',
    enabled: true,
  },
  {
    key: 'advanced_charts',
    name: 'Advanced Charts',
    description: 'Advanced charting tools',
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
    key: 'copy_trading_premium',
    name: 'Premium Copy Trading',
    description: 'Access to premium traders',
    enabled: true,
  },
  {
    key: 'social_trading',
    name: 'Social Trading',
    description: 'Social trading features',
    enabled: true,
  },
  {
    key: 'advanced_analytics',
    name: 'Advanced Analytics',
    description: 'Advanced performance analytics and reports',
    enabled: true,
  },
  {
    key: 'custom_reports',
    name: 'Custom Reports',
    description: 'Create custom reports',
    enabled: true,
  },
  {
    key: 'portfolio_analytics',
    name: 'Portfolio Analytics',
    description: 'Advanced portfolio analytics',
    enabled: true,
  },
  {
    key: 'risk_management',
    name: 'Risk Management',
    description: 'Advanced risk management tools',
    enabled: true,
  },
  {
    key: 'position_sizing',
    name: 'Position Sizing',
    description: 'Automatic position sizing',
    enabled: true,
  },
  {
    key: 'api_access',
    name: 'API Access',
    description: 'Access to trading API',
    enabled: true,
  },
  {
    key: 'websocket_streaming',
    name: 'WebSocket Streaming',
    description: 'Real-time WebSocket streaming',
    enabled: true,
  },
  {
    key: 'webhook_support',
    name: 'Webhook Support',
    description: 'Receive webhook notifications',
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
    key: 'sms_alerts',
    name: 'SMS Alerts',
    description: 'Receive SMS notifications',
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
    key: 'backtesting',
    name: 'Backtesting',
    description: 'Backtest trading strategies',
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
    key: 'two_factor_auth',
    name: 'Two-Factor Auth',
    description: 'Enhanced security with 2FA',
    enabled: true,
  },
  {
    key: 'ip_whitelist',
    name: 'IP Whitelist',
    description: 'Whitelist IP addresses',
    enabled: true,
  },
  {
    key: 'tax_reporting',
    name: 'Tax Reporting',
    description: 'Generate tax reports',
    enabled: true,
  },
];

export const PREMIUM_LIMITS: PlanLimit[] = [
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
    key: 'max_exchanges',
    name: 'Maximum Exchanges',
    description: 'Number of exchanges you can connect',
    value: 20,
    unit: 'exchanges',
    hardLimit: true,
  },
  {
    key: 'max_alerts',
    name: 'Maximum Alerts',
    description: 'Number of price alerts you can set',
    value: 200,
    unit: 'alerts',
    hardLimit: true,
  },
  {
    key: 'api_requests_per_minute',
    name: 'API Rate Limit',
    description: 'API requests per minute',
    value: 1000,
    unit: 'requests/min',
    hardLimit: true,
  },
  {
    key: 'max_historical_days',
    name: 'Historical Data',
    description: 'Days of historical data access',
    value: 365,
    unit: 'days',
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
  {
    key: 'max_webhooks',
    name: 'Maximum Webhooks',
    description: 'Number of webhook endpoints',
    value: 20,
    unit: 'webhooks',
    hardLimit: true,
  },
  {
    key: 'max_api_keys',
    name: 'API Keys',
    description: 'Number of API keys',
    value: 10,
    unit: 'keys',
    hardLimit: true,
  },
  {
    key: 'max_team_members',
    name: 'Team Members',
    description: 'Number of team members',
    value: 20,
    unit: 'members',
    hardLimit: true,
  },
  {
    key: 'max_storage_mb',
    name: 'Storage',
    description: 'Storage space for files and exports',
    value: 5000,
    unit: 'MB',
    hardLimit: true,
  },
];

export function getPremiumPlan() {
  return {
    ...PREMIUM_PLAN,
    features: PREMIUM_FEATURES,
    limits: PREMIUM_LIMITS,
  };
}