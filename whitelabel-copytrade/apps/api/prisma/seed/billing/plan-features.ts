/**
 * Plan Features Seed Data
 * 
 * This file contains seed data for plan features.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function seedPlanFeatures() {
  console.log('Seeding plan features...');

  const features = [
    // Free Plan Features
    { planId: 'plan-free', key: 'basic_trading', name: 'Basic Trading', description: 'Execute basic buy/sell orders', enabled: true },
    { planId: 'plan-free', key: 'portfolio_view', name: 'Portfolio View', description: 'View your portfolio overview', enabled: true },
    { planId: 'plan-free', key: 'market_data', name: 'Market Data', description: 'Access to market data', enabled: true },
    { planId: 'plan-free', key: 'stop_loss', name: 'Stop Loss', description: 'Set stop loss orders', enabled: true },
    { planId: 'plan-free', key: 'take_profit', name: 'Take Profit', description: 'Set take profit orders', enabled: true },
    { planId: 'plan-free', key: 'two_factor_auth', name: 'Two-Factor Auth', description: 'Secure your account with 2FA', enabled: true },

    // Basic Plan Features
    { planId: 'plan-basic', key: 'basic_trading', name: 'Basic Trading', description: 'Execute basic buy/sell orders', enabled: true },
    { planId: 'plan-basic', key: 'portfolio_view', name: 'Portfolio View', description: 'View your portfolio overview', enabled: true },
    { planId: 'plan-basic', key: 'real_time_data', name: 'Real-time Data', description: 'Access to real-time market data', enabled: true },
    { planId: 'plan-basic', key: 'copy_trading', name: 'Copy Trading', description: 'Copy trades from other traders', enabled: true, limit: 3, unit: 'traders' },
    { planId: 'plan-basic', key: 'basic_analytics', name: 'Basic Analytics', description: 'Basic trading analytics', enabled: true },
    { planId: 'plan-basic', key: 'email_alerts', name: 'Email Alerts', description: 'Receive email notifications', enabled: true },
    { planId: 'plan-basic', key: 'stop_loss', name: 'Stop Loss', description: 'Set stop loss orders', enabled: true },
    { planId: 'plan-basic', key: 'take_profit', name: 'Take Profit', description: 'Set take profit orders', enabled: true },
    { planId: 'plan-basic', key: 'two_factor_auth', name: 'Two-Factor Auth', description: 'Secure your account with 2FA', enabled: true },

    // Standard Plan Features
    { planId: 'plan-standard', key: 'basic_trading', name: 'Basic Trading', description: 'Execute basic buy/sell orders', enabled: true },
    { planId: 'plan-standard', key: 'portfolio_view', name: 'Portfolio View', description: 'View your portfolio overview', enabled: true },
    { planId: 'plan-standard', key: 'real_time_data', name: 'Real-time Data', description: 'Access to real-time market data', enabled: true },
    { planId: 'plan-standard', key: 'copy_trading', name: 'Copy Trading', description: 'Copy trades from other traders', enabled: true, limit: 10, unit: 'traders' },
    { planId: 'plan-standard', key: 'advanced_analytics', name: 'Advanced Analytics', description: 'Advanced trading analytics', enabled: true },
    { planId: 'plan-standard', key: 'risk_management', name: 'Risk Management', description: 'Risk management tools', enabled: true },
    { planId: 'plan-standard', key: 'api_access', name: 'API Access', description: 'Access to trading API', enabled: true },
    { planId: 'plan-standard', key: 'email_alerts', name: 'Email Alerts', description: 'Receive email notifications', enabled: true },
    { planId: 'plan-standard', key: 'push_notifications', name: 'Push Notifications', description: 'Mobile push notifications', enabled: true },
    { planId: 'plan-standard', key: 'stop_loss', name: 'Stop Loss', description: 'Set stop loss orders', enabled: true },
    { planId: 'plan-standard', key: 'take_profit', name: 'Take Profit', description: 'Set take profit orders', enabled: true },
    { planId: 'plan-standard', key: 'position_sizing', name: 'Position Sizing', description: 'Automatic position sizing', enabled: true },
    { planId: 'plan-standard', key: 'custom_reports', name: 'Custom Reports', description: 'Generate custom reports', enabled: true },
    { planId: 'plan-standard', key: 'webhook_support', name: 'Webhook Support', description: 'Webhook integrations', enabled: true },
    { planId: 'plan-standard', key: 'two_factor_auth', name: 'Two-Factor Auth', description: 'Secure your account with 2FA', enabled: true },

    // Premium Plan Features
    { planId: 'plan-premium', key: 'basic_trading', name: 'Basic Trading', description: 'Execute basic buy/sell orders', enabled: true },
    { planId: 'plan-premium', key: 'advanced_trading', name: 'Advanced Trading', description: 'Advanced order types', enabled: true },
    { planId: 'plan-premium', key: 'margin_trading', name: 'Margin Trading', description: 'Trade with leverage', enabled: true },
    { planId: 'plan-premium', key: 'portfolio_view', name: 'Portfolio View', description: 'View your portfolio overview', enabled: true },
    { planId: 'plan-premium', key: 'real_time_data', name: 'Real-time Data', description: 'Access to real-time market data', enabled: true },
    { planId: 'plan-premium', key: 'historical_data', name: 'Historical Data', description: 'Access to historical data', enabled: true },
    { planId: 'plan-premium', key: 'advanced_charts', name: 'Advanced Charts', description: 'Advanced charting tools', enabled: true },
    { planId: 'plan-premium', key: 'copy_trading', name: 'Copy Trading', description: 'Copy trades from other traders', enabled: true, limit: 50, unit: 'traders' },
    { planId: 'plan-premium', key: 'copy_trading_premium', name: 'Premium Copy Trading', description: 'Premium copy trading features', enabled: true },
    { planId: 'plan-premium', key: 'social_trading', name: 'Social Trading', description: 'Social trading features', enabled: true },
    { planId: 'plan-premium', key: 'advanced_analytics', name: 'Advanced Analytics', description: 'Advanced trading analytics', enabled: true },
    { planId: 'plan-premium', key: 'custom_reports', name: 'Custom Reports', description: 'Generate custom reports', enabled: true },
    { planId: 'plan-premium', key: 'portfolio_analytics', name: 'Portfolio Analytics', description: 'Portfolio analytics', enabled: true },
    { planId: 'plan-premium', key: 'risk_management', name: 'Risk Management', description: 'Risk management tools', enabled: true },
    { planId: 'plan-premium', key: 'position_sizing', name: 'Position Sizing', description: 'Automatic position sizing', enabled: true },
    { planId: 'plan-premium', key: 'api_access', name: 'API Access', description: 'Access to trading API', enabled: true },
    { planId: 'plan-premium', key: 'websocket_streaming', name: 'WebSocket Streaming', description: 'Real-time WebSocket streaming', enabled: true },
    { planId: 'plan-premium', key: 'webhook_support', name: 'Webhook Support', description: 'Webhook integrations', enabled: true },
    { planId: 'plan-premium', key: 'email_alerts', name: 'Email Alerts', description: 'Receive email notifications', enabled: true },
    { planId: 'plan-premium', key: 'push_notifications', name: 'Push Notifications', description: 'Mobile push notifications', enabled: true },
    { planId: 'plan-premium', key: 'sms_alerts', name: 'SMS Alerts', description: 'SMS notifications', enabled: true },
    { planId: 'plan-premium', key: 'priority_support', name: 'Priority Support', description: '24/7 priority support', enabled: true },
    { planId: 'plan-premium', key: 'custom_strategies', name: 'Custom Strategies', description: 'Create custom strategies', enabled: true },
    { planId: 'plan-premium', key: 'backtesting', name: 'Backtesting', description: 'Backtest strategies', enabled: true },
    { planId: 'plan-premium', key: 'stop_loss', name: 'Stop Loss', description: 'Set stop loss orders', enabled: true },
    { planId: 'plan-premium', key: 'take_profit', name: 'Take Profit', description: 'Set take profit orders', enabled: true },
    { planId: 'plan-premium', key: 'two_factor_auth', name: 'Two-Factor Auth', description: 'Secure your account with 2FA', enabled: true },
    { planId: 'plan-premium', key: 'ip_whitelist', name: 'IP Whitelist', description: 'IP whitelist security', enabled: true },
    { planId: 'plan-premium', key: 'tax_reporting', name: 'Tax Reporting', description: 'Tax reporting tools', enabled: true },

    // Enterprise Plan Features (all enabled)
    { planId: 'plan-enterprise', key: 'basic_trading', name: 'Basic Trading', description: 'Execute basic buy/sell orders', enabled: true },
    { planId: 'plan-enterprise', key: 'advanced_trading', name: 'Advanced Trading', description: 'Advanced order types', enabled: true },
    { planId: 'plan-enterprise', key: 'margin_trading', name: 'Margin Trading', description: 'Trade with leverage', enabled: true },
    { planId: 'plan-enterprise', key: 'portfolio_view', name: 'Portfolio View', description: 'View your portfolio overview', enabled: true },
    { planId: 'plan-enterprise', key: 'real_time_data', name: 'Real-time Data', description: 'Access to real-time market data', enabled: true },
    { planId: 'plan-enterprise', key: 'historical_data', name: 'Historical Data', description: 'Access to historical data', enabled: true },
    { planId: 'plan-enterprise', key: 'advanced_charts', name: 'Advanced Charts', description: 'Advanced charting tools', enabled: true },
    { planId: 'plan-enterprise', key: 'copy_trading', name: 'Copy Trading', description: 'Copy trades from other traders', enabled: true },
    { planId: 'plan-enterprise', key: 'copy_trading_premium', name: 'Premium Copy Trading', description: 'Premium copy trading features', enabled: true },
    { planId: 'plan-enterprise', key: 'social_trading', name: 'Social Trading', description: 'Social trading features', enabled: true },
    { planId: 'plan-enterprise', key: 'advanced_analytics', name: 'Advanced Analytics', description: 'Advanced trading analytics', enabled: true },
    { planId: 'plan-enterprise', key: 'custom_reports', name: 'Custom Reports', description: 'Generate custom reports', enabled: true },
    { planId: 'plan-enterprise', key: 'portfolio_analytics', name: 'Portfolio Analytics', description: 'Portfolio analytics', enabled: true },
    { planId: 'plan-enterprise', key: 'risk_management', name: 'Risk Management', description: 'Risk management tools', enabled: true },
    { planId: 'plan-enterprise', key: 'position_sizing', name: 'Position Sizing', description: 'Automatic position sizing', enabled: true },
    { planId: 'plan-enterprise', key: 'api_access', name: 'API Access', description: 'Access to trading API', enabled: true },
    { planId: 'plan-enterprise', key: 'websocket_streaming', name: 'WebSocket Streaming', description: 'Real-time WebSocket streaming', enabled: true },
    { planId: 'plan-enterprise', key: 'webhook_support', name: 'Webhook Support', description: 'Webhook integrations', enabled: true },
    { planId: 'plan-enterprise', key: 'email_alerts', name: 'Email Alerts', description: 'Receive email notifications', enabled: true },
    { planId: 'plan-enterprise', key: 'push_notifications', name: 'Push Notifications', description: 'Mobile push notifications', enabled: true },
    { planId: 'plan-enterprise', key: 'sms_alerts', name: 'SMS Alerts', description: 'SMS notifications', enabled: true },
    { planId: 'plan-enterprise', key: 'priority_support', name: 'Priority Support', description: '24/7 priority support', enabled: true },
    { planId: 'plan-enterprise', key: 'custom_strategies', name: 'Custom Strategies', description: 'Create custom strategies', enabled: true },
    { planId: 'plan-enterprise', key: 'backtesting', name: 'Backtesting', description: 'Backtest strategies', enabled: true },
    { planId: 'plan-enterprise', key: 'stop_loss', name: 'Stop Loss', description: 'Set stop loss orders', enabled: true },
    { planId: 'plan-enterprise', key: 'take_profit', name: 'Take Profit', description: 'Set take profit orders', enabled: true },
    { planId: 'plan-enterprise', key: 'two_factor_auth', name: 'Two-Factor Auth', description: 'Secure your account with 2FA', enabled: true },
    { planId: 'plan-enterprise', key: 'ip_whitelist', name: 'IP Whitelist', description: 'IP whitelist security', enabled: true },
    { planId: 'plan-enterprise', key: 'tax_reporting', name: 'Tax Reporting', description: 'Tax reporting tools', enabled: true },
    { planId: 'plan-enterprise', key: 'dedicated_support', name: 'Dedicated Support', description: 'Dedicated account manager', enabled: true },
    { planId: 'plan-enterprise', key: 'custom_integrations', name: 'Custom Integrations', description: 'Custom integrations', enabled: true },
    { planId: 'plan-enterprise', key: 'white_label', name: 'White Label', description: 'White label solutions', enabled: true },
    { planId: 'plan-enterprise', key: 'sla', name: 'SLA', description: 'Service level agreement', enabled: true },
  ];

  for (const feature of features) {
    await prisma.planFeature.upsert({
      where: {
        planId_key: {
          planId: feature.planId,
          key: feature.key,
        },
      },
      update: feature,
      create: feature,
    });
  }

  console.log(`Seeded ${features.length} plan features`);
}