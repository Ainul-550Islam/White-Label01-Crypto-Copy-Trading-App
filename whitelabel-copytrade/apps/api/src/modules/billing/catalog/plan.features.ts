/**
 * Plan Features - Feature definitions for all plans
 * 
 * This module defines all available features and their configurations
 * across different plan tiers.
 */

import { PlanFeature } from '../plans/plan.types';

export interface FeatureDefinition {
  key: string;
  name: string;
  description: string;
  category: string;
  tiers: {
    basic: boolean;
    standard: boolean;
    premium: boolean;
    enterprise: boolean;
  };
  limits?: {
    basic?: number;
    standard?: number;
    premium?: number;
    enterprise?: number;
  };
  unit?: string;
}

export const FEATURE_DEFINITIONS: FeatureDefinition[] = [
  // Trading Features
  {
    key: 'basic_trading',
    name: 'Basic Trading',
    description: 'Execute basic buy/sell orders',
    category: 'trading',
    tiers: { basic: true, standard: true, premium: true, enterprise: true },
  },
  {
    key: 'advanced_trading',
    name: 'Advanced Trading',
    description: 'Advanced order types (limit, stop, trailing stop)',
    category: 'trading',
    tiers: { basic: false, standard: false, premium: true, enterprise: true },
  },
  {
    key: 'margin_trading',
    name: 'Margin Trading',
    description: 'Trade with leverage',
    category: 'trading',
    tiers: { basic: false, standard: false, premium: true, enterprise: true },
  },
  {
    key: 'futures_trading',
    name: 'Futures Trading',
    description: 'Trade futures contracts',
    category: 'trading',
    tiers: { basic: false, standard: false, premium: false, enterprise: true },
  },

  // Copy Trading Features
  {
    key: 'copy_trading',
    name: 'Copy Trading',
    description: 'Copy trades from other traders',
    category: 'copy_trading',
    tiers: { basic: true, standard: true, premium: true, enterprise: true },
    limits: { basic: 3, standard: 10, premium: 50, enterprise: -1 },
    unit: 'traders',
  },
  {
    key: 'copy_trading_premium',
    name: 'Premium Copy Trading',
    description: 'Access to premium and verified traders',
    category: 'copy_trading',
    tiers: { basic: false, standard: false, premium: true, enterprise: true },
  },
  {
    key: 'social_trading',
    name: 'Social Trading',
    description: 'Social trading features and community',
    category: 'copy_trading',
    tiers: { basic: false, standard: false, premium: true, enterprise: true },
  },

  // Data Features
  {
    key: 'market_data',
    name: 'Market Data',
    description: 'Access to market data',
    category: 'data',
    tiers: { basic: true, standard: true, premium: true, enterprise: true },
  },
  {
    key: 'real_time_data',
    name: 'Real-time Data',
    description: 'Access to real-time market data',
    category: 'data',
    tiers: { basic: false, standard: true, premium: true, enterprise: true },
  },
  {
    key: 'historical_data',
    name: 'Historical Data',
    description: 'Access to historical market data',
    category: 'data',
    tiers: { basic: false, standard: false, premium: true, enterprise: true },
  },
  {
    key: 'advanced_charts',
    name: 'Advanced Charts',
    description: 'Advanced charting tools and indicators',
    category: 'data',
    tiers: { basic: false, standard: false, premium: true, enterprise: true },
  },

  // Analytics Features
  {
    key: 'basic_analytics',
    name: 'Basic Analytics',
    description: 'Basic performance analytics',
    category: 'analytics',
    tiers: { basic: true, standard: true, premium: true, enterprise: true },
  },
  {
    key: 'advanced_analytics',
    name: 'Advanced Analytics',
    description: 'Advanced performance analytics and reports',
    category: 'analytics',
    tiers: { basic: false, standard: true, premium: true, enterprise: true },
  },
  {
    key: 'custom_reports',
    name: 'Custom Reports',
    description: 'Create custom reports',
    category: 'analytics',
    tiers: { basic: false, standard: true, premium: true, enterprise: true },
  },
  {
    key: 'portfolio_analytics',
    name: 'Portfolio Analytics',
    description: 'Advanced portfolio analytics',
    category: 'analytics',
    tiers: { basic: false, standard: false, premium: true, enterprise: true },
  },

  // Risk Management Features
  {
    key: 'risk_management',
    name: 'Risk Management',
    description: 'Advanced risk management tools',
    category: 'risk_management',
    tiers: { basic: false, standard: true, premium: true, enterprise: true },
  },
  {
    key: 'stop_loss',
    name: 'Stop Loss',
    description: 'Set stop loss orders',
    category: 'risk_management',
    tiers: { basic: true, standard: true, premium: true, enterprise: true },
  },
  {
    key: 'take_profit',
    name: 'Take Profit',
    description: 'Set take profit orders',
    category: 'risk_management',
    tiers: { basic: true, standard: true, premium: true, enterprise: true },
  },
  {
    key: 'position_sizing',
    name: 'Position Sizing',
    description: 'Automatic position sizing',
    category: 'risk_management',
    tiers: { basic: false, standard: true, premium: true, enterprise: true },
  },

  // API Features
  {
    key: 'api_access',
    name: 'API Access',
    description: 'Access to trading API',
    category: 'api',
    tiers: { basic: false, standard: true, premium: true, enterprise: true },
  },
  {
    key: 'websocket_streaming',
    name: 'WebSocket Streaming',
    description: 'Real-time WebSocket streaming',
    category: 'api',
    tiers: { basic: false, standard: false, premium: true, enterprise: true },
  },
  {
    key: 'webhook_support',
    name: 'Webhook Support',
    description: 'Receive webhook notifications',
    category: 'api',
    tiers: { basic: false, standard: true, premium: true, enterprise: true },
  },

  // Support Features
  {
    key: 'email_alerts',
    name: 'Email Alerts',
    description: 'Receive email notifications',
    category: 'notifications',
    tiers: { basic: true, standard: true, premium: true, enterprise: true },
  },
  {
    key: 'push_notifications',
    name: 'Push Notifications',
    description: 'Receive push notifications',
    category: 'notifications',
    tiers: { basic: false, standard: true, premium: true, enterprise: true },
  },
  {
    key: 'sms_alerts',
    name: 'SMS Alerts',
    description: 'Receive SMS notifications',
    category: 'notifications',
    tiers: { basic: false, standard: false, premium: true, enterprise: true },
  },
  {
    key: 'priority_support',
    name: 'Priority Support',
    description: '24/7 priority customer support',
    category: 'support',
    tiers: { basic: false, standard: false, premium: true, enterprise: true },
  },
  {
    key: 'dedicated_support',
    name: 'Dedicated Support',
    description: 'Dedicated account manager',
    category: 'support',
    tiers: { basic: false, standard: false, premium: false, enterprise: true },
  },

  // Strategy Features
  {
    key: 'custom_strategies',
    name: 'Custom Strategies',
    description: 'Create and deploy custom trading strategies',
    category: 'strategy',
    tiers: { basic: false, standard: false, premium: true, enterprise: true },
  },
  {
    key: 'backtesting',
    name: 'Backtesting',
    description: 'Backtest trading strategies',
    category: 'strategy',
    tiers: { basic: false, standard: false, premium: true, enterprise: true },
  },

  // Security Features
  {
    key: 'two_factor_auth',
    name: 'Two-Factor Auth',
    description: 'Enhanced security with 2FA',
    category: 'security',
    tiers: { basic: true, standard: true, premium: true, enterprise: true },
  },
  {
    key: 'ip_whitelist',
    name: 'IP Whitelist',
    description: 'Whitelist IP addresses',
    category: 'security',
    tiers: { basic: false, standard: false, premium: true, enterprise: true },
  },

  // Portfolio Features
  {
    key: 'portfolio_view',
    name: 'Portfolio View',
    description: 'View your portfolio and holdings',
    category: 'portfolio',
    tiers: { basic: true, standard: true, premium: true, enterprise: true },
  },
  {
    key: 'multi_exchange',
    name: 'Multi-Exchange',
    description: 'Connect multiple exchanges',
    category: 'portfolio',
    tiers: { basic: false, standard: false, premium: true, enterprise: true },
  },
  {
    key: 'tax_reporting',
    name: 'Tax Reporting',
    description: 'Generate tax reports',
    category: 'portfolio',
    tiers: { basic: false, standard: false, premium: true, enterprise: true },
  },
];

export function getFeaturesForTier(tier: 'basic' | 'standard' | 'premium' | 'enterprise'): FeatureDefinition[] {
  return FEATURE_DEFINITIONS.filter(feature => feature.tiers[tier]);
}

export function getFeaturesByCategory(category: string): FeatureDefinition[] {
  return FEATURE_DEFINITIONS.filter(feature => feature.category === category);
}

export function getFeatureByKey(key: string): FeatureDefinition | undefined {
  return FEATURE_DEFINITIONS.find(feature => feature.key === key);
}

export function getCategories(): string[] {
  const categories = new Set(FEATURE_DEFINITIONS.map(f => f.category));
  return Array.from(categories).sort();
}

export function buildPlanFeatures(tier: 'basic' | 'standard' | 'premium' | 'enterprise'): PlanFeature[] {
  return getFeaturesForTier(tier).map(feature => ({
    key: feature.key,
    name: feature.name,
    description: feature.description,
    enabled: true,
    limit: feature.limits?.[tier],
    unit: feature.unit,
  }));
}