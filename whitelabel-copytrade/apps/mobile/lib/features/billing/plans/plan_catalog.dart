/// Plan Catalog
/// 
/// Contains the predefined plan catalog with all available plans.

import 'plan.dart';

class PlanCatalog {
  static const Plan freePlan = Plan(
    id: 'plan-free',
    tenantId: 'system',
    name: 'Free',
    slug: 'free',
    description: 'Get started with basic trading features',
    tier: PlanTier.free,
    status: PlanStatus.active,
    price: PlanPrice(amount: 0, interval: BillingInterval.monthly),
    features: [
      PlanFeature(
        key: 'basic_trading',
        name: 'Basic Trading',
        description: 'Execute basic buy/sell orders',
      ),
      PlanFeature(
        key: 'portfolio_view',
        name: 'Portfolio View',
        description: 'View your portfolio overview',
      ),
      PlanFeature(
        key: 'market_data',
        name: 'Market Data',
        description: 'Access to market data',
      ),
      PlanFeature(
        key: 'stop_loss',
        name: 'Stop Loss',
        description: 'Set stop loss orders',
      ),
      PlanFeature(
        key: 'take_profit',
        name: 'Take Profit',
        description: 'Set take profit orders',
      ),
      PlanFeature(
        key: 'two_factor_auth',
        name: 'Two-Factor Auth',
        description: 'Secure your account with 2FA',
      ),
    ],
    limits: [
      PlanLimit(
        key: 'max_portfolios',
        name: 'Portfolios',
        description: 'Maximum portfolios',
        value: 1,
        unit: 'portfolios',
      ),
      PlanLimit(
        key: 'max_orders_per_day',
        name: 'Daily Orders',
        description: 'Maximum orders per day',
        value: 10,
        unit: 'orders',
      ),
      PlanLimit(
        key: 'max_position_value',
        name: 'Position Value',
        description: 'Maximum position value',
        value: 1000,
        unit: 'USD',
      ),
    ],
    createdAt: DateTime(2024, 1, 1),
    updatedAt: DateTime(2024, 1, 1),
  );

  static const Plan basicPlan = Plan(
    id: 'plan-basic',
    tenantId: 'system',
    name: 'Basic',
    slug: 'basic',
    description: 'Perfect for individual traders getting started',
    tier: PlanTier.basic,
    status: PlanStatus.active,
    price: PlanPrice(
      amount: 29,
      interval: BillingInterval.monthly,
      trialDays: 7,
    ),
    features: [
      PlanFeature(
        key: 'basic_trading',
        name: 'Basic Trading',
        description: 'Execute basic buy/sell orders',
      ),
      PlanFeature(
        key: 'portfolio_view',
        name: 'Portfolio View',
        description: 'View your portfolio overview',
      ),
      PlanFeature(
        key: 'real_time_data',
        name: 'Real-time Data',
        description: 'Access to real-time market data',
      ),
      PlanFeature(
        key: 'copy_trading',
        name: 'Copy Trading',
        description: 'Copy trades from other traders',
        limit: 3,
        unit: 'traders',
      ),
      PlanFeature(
        key: 'basic_analytics',
        name: 'Basic Analytics',
        description: 'Basic trading analytics',
      ),
      PlanFeature(
        key: 'email_alerts',
        name: 'Email Alerts',
        description: 'Receive email notifications',
      ),
      PlanFeature(
        key: 'stop_loss',
        name: 'Stop Loss',
        description: 'Set stop loss orders',
      ),
      PlanFeature(
        key: 'take_profit',
        name: 'Take Profit',
        description: 'Set take profit orders',
      ),
      PlanFeature(
        key: 'two_factor_auth',
        name: 'Two-Factor Auth',
        description: 'Secure your account with 2FA',
      ),
    ],
    limits: [
      PlanLimit(
        key: 'max_portfolios',
        name: 'Portfolios',
        description: 'Maximum portfolios',
        value: 3,
        unit: 'portfolios',
      ),
      PlanLimit(
        key: 'max_exchanges',
        name: 'Exchanges',
        description: 'Connected exchanges',
        value: 2,
        unit: 'exchanges',
      ),
      PlanLimit(
        key: 'max_orders_per_day',
        name: 'Daily Orders',
        description: 'Maximum orders per day',
        value: 50,
        unit: 'orders',
      ),
      PlanLimit(
        key: 'max_position_value',
        name: 'Position Value',
        description: 'Maximum position value',
        value: 10000,
        unit: 'USD',
      ),
      PlanLimit(
        key: 'max_copy_sources',
        name: 'Copy Sources',
        description: 'Traders to copy from',
        value: 3,
        unit: 'traders',
      ),
    ],
    createdAt: DateTime(2024, 1, 1),
    updatedAt: DateTime(2024, 1, 1),
  );

  static const Plan standardPlan = Plan(
    id: 'plan-standard',
    tenantId: 'system',
    name: 'Standard',
    slug: 'standard',
    description: 'For serious traders who need more power',
    tier: PlanTier.standard,
    status: PlanStatus.active,
    price: PlanPrice(
      amount: 79,
      interval: BillingInterval.monthly,
      trialDays: 14,
    ),
    features: [
      PlanFeature(
        key: 'basic_trading',
        name: 'Basic Trading',
        description: 'Execute basic buy/sell orders',
      ),
      PlanFeature(
        key: 'portfolio_view',
        name: 'Portfolio View',
        description: 'View your portfolio overview',
      ),
      PlanFeature(
        key: 'real_time_data',
        name: 'Real-time Data',
        description: 'Access to real-time market data',
      ),
      PlanFeature(
        key: 'copy_trading',
        name: 'Copy Trading',
        description: 'Copy trades from other traders',
        limit: 10,
        unit: 'traders',
      ),
      PlanFeature(
        key: 'advanced_analytics',
        name: 'Advanced Analytics',
        description: 'Advanced trading analytics',
      ),
      PlanFeature(
        key: 'risk_management',
        name: 'Risk Management',
        description: 'Risk management tools',
      ),
      PlanFeature(
        key: 'api_access',
        name: 'API Access',
        description: 'Access to trading API',
      ),
      PlanFeature(
        key: 'email_alerts',
        name: 'Email Alerts',
        description: 'Receive email notifications',
      ),
      PlanFeature(
        key: 'push_notifications',
        name: 'Push Notifications',
        description: 'Mobile push notifications',
      ),
      PlanFeature(
        key: 'stop_loss',
        name: 'Stop Loss',
        description: 'Set stop loss orders',
      ),
      PlanFeature(
        key: 'take_profit',
        name: 'Take Profit',
        description: 'Set take profit orders',
      ),
      PlanFeature(
        key: 'position_sizing',
        name: 'Position Sizing',
        description: 'Automatic position sizing',
      ),
      PlanFeature(
        key: 'custom_reports',
        name: 'Custom Reports',
        description: 'Generate custom reports',
      ),
      PlanFeature(
        key: 'webhook_support',
        name: 'Webhook Support',
        description: 'Webhook integrations',
      ),
      PlanFeature(
        key: 'two_factor_auth',
        name: 'Two-Factor Auth',
        description: 'Secure your account with 2FA',
      ),
    ],
    limits: [
      PlanLimit(
        key: 'max_portfolios',
        name: 'Portfolios',
        description: 'Maximum portfolios',
        value: 10,
        unit: 'portfolios',
      ),
      PlanLimit(
        key: 'max_exchanges',
        name: 'Exchanges',
        description: 'Connected exchanges',
        value: 5,
        unit: 'exchanges',
      ),
      PlanLimit(
        key: 'max_orders_per_day',
        name: 'Daily Orders',
        description: 'Maximum orders per day',
        value: 200,
        unit: 'orders',
      ),
      PlanLimit(
        key: 'max_position_value',
        name: 'Position Value',
        description: 'Maximum position value',
        value: 100000,
        unit: 'USD',
      ),
      PlanLimit(
        key: 'max_copy_sources',
        name: 'Copy Sources',
        description: 'Traders to copy from',
        value: 10,
        unit: 'traders',
      ),
      PlanLimit(
        key: 'max_strategies',
        name: 'Strategies',
        description: 'Custom strategies',
        value: 5,
        unit: 'strategies',
      ),
      PlanLimit(
        key: 'api_requests_per_minute',
        name: 'API Rate',
        description: 'API requests per minute',
        value: 100,
        unit: 'req/min',
      ),
    ],
    createdAt: DateTime(2024, 1, 1),
    updatedAt: DateTime(2024, 1, 1),
  );

  static const Plan premiumPlan = Plan(
    id: 'plan-premium',
    tenantId: 'system',
    name: 'Premium',
    slug: 'premium',
    description: 'Full access to all features for professional traders',
    tier: PlanTier.premium,
    status: PlanStatus.active,
    price: PlanPrice(
      amount: 199,
      interval: BillingInterval.monthly,
      trialDays: 30,
    ),
    features: [
      PlanFeature(key: 'basic_trading', name: 'Basic Trading', description: 'Execute basic buy/sell orders'),
      PlanFeature(key: 'advanced_trading', name: 'Advanced Trading', description: 'Advanced order types'),
      PlanFeature(key: 'margin_trading', name: 'Margin Trading', description: 'Trade with leverage'),
      PlanFeature(key: 'portfolio_view', name: 'Portfolio View', description: 'View your portfolio overview'),
      PlanFeature(key: 'real_time_data', name: 'Real-time Data', description: 'Access to real-time market data'),
      PlanFeature(key: 'historical_data', name: 'Historical Data', description: 'Access to historical data'),
      PlanFeature(key: 'advanced_charts', name: 'Advanced Charts', description: 'Advanced charting tools'),
      PlanFeature(key: 'copy_trading', name: 'Copy Trading', description: 'Copy trades from other traders', limit: 50, unit: 'traders'),
      PlanFeature(key: 'copy_trading_premium', name: 'Premium Copy Trading', description: 'Premium copy trading features'),
      PlanFeature(key: 'social_trading', name: 'Social Trading', description: 'Social trading features'),
      PlanFeature(key: 'advanced_analytics', name: 'Advanced Analytics', description: 'Advanced trading analytics'),
      PlanFeature(key: 'custom_reports', name: 'Custom Reports', description: 'Generate custom reports'),
      PlanFeature(key: 'portfolio_analytics', name: 'Portfolio Analytics', description: 'Portfolio analytics'),
      PlanFeature(key: 'risk_management', name: 'Risk Management', description: 'Risk management tools'),
      PlanFeature(key: 'position_sizing', name: 'Position Sizing', description: 'Automatic position sizing'),
      PlanFeature(key: 'api_access', name: 'API Access', description: 'Access to trading API'),
      PlanFeature(key: 'websocket_streaming', name: 'WebSocket Streaming', description: 'Real-time WebSocket streaming'),
      PlanFeature(key: 'webhook_support', name: 'Webhook Support', description: 'Webhook integrations'),
      PlanFeature(key: 'email_alerts', name: 'Email Alerts', description: 'Receive email notifications'),
      PlanFeature(key: 'push_notifications', name: 'Push Notifications', description: 'Mobile push notifications'),
      PlanFeature(key: 'sms_alerts', name: 'SMS Alerts', description: 'SMS notifications'),
      PlanFeature(key: 'priority_support', name: 'Priority Support', description: '24/7 priority support'),
      PlanFeature(key: 'custom_strategies', name: 'Custom Strategies', description: 'Create custom strategies'),
      PlanFeature(key: 'backtesting', name: 'Backtesting', description: 'Backtest strategies'),
      PlanFeature(key: 'stop_loss', name: 'Stop Loss', description: 'Set stop loss orders'),
      PlanFeature(key: 'take_profit', name: 'Take Profit', description: 'Set take profit orders'),
      PlanFeature(key: 'two_factor_auth', name: 'Two-Factor Auth', description: 'Secure your account with 2FA'),
      PlanFeature(key: 'ip_whitelist', name: 'IP Whitelist', description: 'IP whitelist security'),
      PlanFeature(key: 'tax_reporting', name: 'Tax Reporting', description: 'Tax reporting tools'),
    ],
    limits: [
      PlanLimit(key: 'max_portfolios', name: 'Portfolios', description: 'Maximum portfolios', value: 100, unit: 'portfolios'),
      PlanLimit(key: 'max_exchanges', name: 'Exchanges', description: 'Connected exchanges', value: 20, unit: 'exchanges'),
      PlanLimit(key: 'max_orders_per_day', name: 'Daily Orders', description: 'Maximum orders per day', value: 1000, unit: 'orders'),
      PlanLimit(key: 'max_position_value', name: 'Position Value', description: 'Maximum position value', value: 1000000, unit: 'USD'),
      PlanLimit(key: 'max_copy_sources', name: 'Copy Sources', description: 'Traders to copy from', value: 50, unit: 'traders'),
      PlanLimit(key: 'max_strategies', name: 'Strategies', description: 'Custom strategies', value: 20, unit: 'strategies'),
      PlanLimit(key: 'api_requests_per_minute', name: 'API Rate', description: 'API requests per minute', value: 1000, unit: 'req/min'),
      PlanLimit(key: 'max_storage_mb', name: 'Storage', description: 'Storage space', value: 5000, unit: 'MB'),
    ],
    createdAt: DateTime(2024, 1, 1),
    updatedAt: DateTime(2024, 1, 1),
  );

  static const List<Plan> allPlans = [
    freePlan,
    basicPlan,
    standardPlan,
    premiumPlan,
  ];

  static Plan? getPlanById(String id) {
    return allPlans.where((p) => p.id == id).firstOrNull;
  }

  static Plan? getPlanByTier(PlanTier tier) {
    return allPlans.where((p) => p.tier == tier).firstOrNull;
  }

  static List<Plan> getActivePlans() {
    return allPlans.where((p) => p.status == PlanStatus.active).toList();
  }

  static List<Plan> getPaidPlans() {
    return allPlans.where((p) => p.price.amount > 0).toList();
  }
}