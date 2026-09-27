/**
 * Entitlement Keys - Standard feature and limit keys
 * 
 * This module defines the standard keys used for features and limits
 * across the billing system.
 */

// Feature Keys
export const FEATURE_KEYS = {
  // Trading Features
  BASIC_TRADING: 'basic_trading',
  ADVANCED_TRADING: 'advanced_trading',
  MARGIN_TRADING: 'margin_trading',
  FUTURES_TRADING: 'futures_trading',
  OPTIONS_TRADING: 'options_trading',
  
  // Copy Trading Features
  COPY_TRADING: 'copy_trading',
  COPY_TRADING_PREMIUM: 'copy_trading_premium',
  SOCIAL_TRADING: 'social_trading',
  
  // Data Features
  MARKET_DATA: 'market_data',
  REAL_TIME_DATA: 'real_time_data',
  HISTORICAL_DATA: 'historical_data',
  ADVANCED_CHARTS: 'advanced_charts',
  
  // Analytics Features
  BASIC_ANALYTICS: 'basic_analytics',
  ADVANCED_ANALYTICS: 'advanced_analytics',
  CUSTOM_REPORTS: 'custom_reports',
  PORTFOLIO_ANALYTICS: 'portfolio_analytics',
  
  // Risk Management
  RISK_MANAGEMENT: 'risk_management',
  STOP_LOSS: 'stop_loss',
  TAKE_PROFIT: 'take_profit',
  POSITION_SIZING: 'position_sizing',
  
  // API Features
  API_ACCESS: 'api_access',
  WEBHOOK_SUPPORT: 'webhook_support',
  WEBSOCKET_STREAMING: 'websocket_streaming',
  
  // Support Features
  PRIORITY_SUPPORT: 'priority_support',
  DEDICATED_SUPPORT: 'dedicated_support',
  PHONE_SUPPORT: 'phone_support',
  
  // White Label
  WHITE_LABEL: 'white_label',
  CUSTOM_BRANDING: 'custom_branding',
  CUSTOM_DOMAIN: 'custom_domain',
  
  // Strategy Features
  CUSTOM_STRATEGIES: 'custom_strategies',
  STRATEGY_MARKETPLACE: 'strategy_marketplace',
  BACKTESTING: 'backtesting',
  
  // Portfolio Features
  PORTFOLIO_VIEW: 'portfolio_view',
  MULTI_EXCHANGE: 'multi_exchange',
  TAX_REPORTING: 'tax_reporting',
  
  // Notification Features
  EMAIL_ALERTS: 'email_alerts',
  PUSH_NOTIFICATIONS: 'push_notifications',
  SMS_ALERTS: 'sms_alerts',
  
  // Security Features
  TWO_FACTOR_AUTH: 'two_factor_auth',
  IP_WHITELIST: 'ip_whitelist',
  API_KEY_MANAGEMENT: 'api_key_management',
} as const;

// Limit Keys
export const LIMIT_KEYS = {
  // Portfolio Limits
  MAX_PORTFOLIOS: 'max_portfolios',
  MAX_ACCOUNTS: 'max_accounts',
  MAX_EXCHANGES: 'max_exchanges',
  
  // Order Limits
  MAX_ORDERS_PER_DAY: 'max_orders_per_day',
  MAX_ORDERS_PER_HOUR: 'max_orders_per_hour',
  MAX_ORDERS_PER_MINUTE: 'max_orders_per_minute',
  
  // Position Limits
  MAX_POSITION_VALUE: 'max_position_value',
  MAX_POSITION_SIZE: 'max_position_size',
  MAX_OPEN_POSITIONS: 'max_open_positions',
  
  // Copy Trading Limits
  MAX_COPY_SOURCES: 'max_copy_sources',
  MAX_COPY_AMOUNT: 'max_copy_amount',
  MAX_COPY_TRADES_PER_DAY: 'max_copy_trades_per_day',
  
  // Strategy Limits
  MAX_STRATEGIES: 'max_strategies',
  MAX_STRATEGY_RUNS: 'max_strategy_runs',
  MAX_BACKTEST_DAYS: 'max_backtest_days',
  
  // API Limits
  API_RATE_LIMIT: 'api_rate_limit',
  API_BURST_LIMIT: 'api_burst_limit',
  MAX_API_KEYS: 'max_api_keys',
  
  // Data Limits
  MAX_HISTORICAL_DAYS: 'max_historical_days',
  MAX_DATA_EXPORTS: 'max_data_exports',
  MAX_REPORTS: 'max_reports',
  
  // Alert Limits
  MAX_ALERTS: 'max_alerts',
  MAX_WEBHOOKS: 'max_webhooks',
  MAX_NOTIFICATION_CHANNELS: 'max_notification_channels',
  
  // Storage Limits
  MAX_STORAGE_MB: 'max_storage_mb',
  MAX_FILE_UPLOADS: 'max_file_uploads',
  MAX_EXPORT_SIZE_MB: 'max_export_size_mb',
  
  // User Limits
  MAX_TEAM_MEMBERS: 'max_team_members',
  MAX_SUB_ACCOUNTS: 'max_sub_accounts',
  MAX_API_CALLS_PER_MONTH: 'max_api_calls_per_month',
} as const;

// Feature Categories
export const FEATURE_CATEGORIES = {
  TRADING: 'trading',
  COPY_TRADING: 'copy_trading',
  DATA: 'data',
  ANALYTICS: 'analytics',
  RISK_MANAGEMENT: 'risk_management',
  API: 'api',
  SUPPORT: 'support',
  WHITE_LABEL: 'white_label',
  STRATEGY: 'strategy',
  PORTFOLIO: 'portfolio',
  NOTIFICATIONS: 'notifications',
  SECURITY: 'security',
} as const;

// Limit Categories
export const LIMIT_CATEGORIES = {
  PORTFOLIO: 'portfolio',
  ORDERS: 'orders',
  POSITIONS: 'positions',
  COPY_TRADING: 'copy_trading',
  STRATEGIES: 'strategies',
  API: 'api',
  DATA: 'data',
  ALERTS: 'alerts',
  STORAGE: 'storage',
  USERS: 'users',
} as const;

export type FeatureKey = typeof FEATURE_KEYS[keyof typeof FEATURE_KEYS];
export type LimitKey = typeof LIMIT_KEYS[keyof typeof LIMIT_KEYS];
export type FeatureCategory = typeof FEATURE_CATEGORIES[keyof typeof FEATURE_CATEGORIES];
export type LimitCategory = typeof LIMIT_CATEGORIES[keyof typeof LIMIT_CATEGORIES];

export function isFeatureKey(key: string): key is FeatureKey {
  return Object.values(FEATURE_KEYS).includes(key as FeatureKey);
}

export function isLimitKey(key: string): key is LimitKey {
  return Object.values(LIMIT_KEYS).includes(key as LimitKey);
}

export function getFeatureCategory(key: string): FeatureCategory | null {
  // Map feature keys to categories
  const categoryMap: Record<string, FeatureCategory> = {
    [FEATURE_KEYS.BASIC_TRADING]: FEATURE_CATEGORIES.TRADING,
    [FEATURE_KEYS.ADVANCED_TRADING]: FEATURE_CATEGORIES.TRADING,
    [FEATURE_KEYS.MARGIN_TRADING]: FEATURE_CATEGORIES.TRADING,
    [FEATURE_KEYS.FUTURES_TRADING]: FEATURE_CATEGORIES.TRADING,
    [FEATURE_KEYS.OPTIONS_TRADING]: FEATURE_CATEGORIES.TRADING,
    [FEATURE_KEYS.COPY_TRADING]: FEATURE_CATEGORIES.COPY_TRADING,
    [FEATURE_KEYS.COPY_TRADING_PREMIUM]: FEATURE_CATEGORIES.COPY_TRADING,
    [FEATURE_KEYS.SOCIAL_TRADING]: FEATURE_CATEGORIES.COPY_TRADING,
    [FEATURE_KEYS.MARKET_DATA]: FEATURE_CATEGORIES.DATA,
    [FEATURE_KEYS.REAL_TIME_DATA]: FEATURE_CATEGORIES.DATA,
    [FEATURE_KEYS.HISTORICAL_DATA]: FEATURE_CATEGORIES.DATA,
    [FEATURE_KEYS.ADVANCED_CHARTS]: FEATURE_CATEGORIES.DATA,
    [FEATURE_KEYS.BASIC_ANALYTICS]: FEATURE_CATEGORIES.ANALYTICS,
    [FEATURE_KEYS.ADVANCED_ANALYTICS]: FEATURE_CATEGORIES.ANALYTICS,
    [FEATURE_KEYS.CUSTOM_REPORTS]: FEATURE_CATEGORIES.ANALYTICS,
    [FEATURE_KEYS.PORTFOLIO_ANALYTICS]: FEATURE_CATEGORIES.ANALYTICS,
    [FEATURE_KEYS.RISK_MANAGEMENT]: FEATURE_CATEGORIES.RISK_MANAGEMENT,
    [FEATURE_KEYS.STOP_LOSS]: FEATURE_CATEGORIES.RISK_MANAGEMENT,
    [FEATURE_KEYS.TAKE_PROFIT]: FEATURE_CATEGORIES.RISK_MANAGEMENT,
    [FEATURE_KEYS.POSITION_SIZING]: FEATURE_CATEGORIES.RISK_MANAGEMENT,
    [FEATURE_KEYS.API_ACCESS]: FEATURE_CATEGORIES.API,
    [FEATURE_KEYS.WEBHOOK_SUPPORT]: FEATURE_CATEGORIES.API,
    [FEATURE_KEYS.WEBSOCKET_STREAMING]: FEATURE_CATEGORIES.API,
    [FEATURE_KEYS.PRIORITY_SUPPORT]: FEATURE_CATEGORIES.SUPPORT,
    [FEATURE_KEYS.DEDICATED_SUPPORT]: FEATURE_CATEGORIES.SUPPORT,
    [FEATURE_KEYS.PHONE_SUPPORT]: FEATURE_CATEGORIES.SUPPORT,
    [FEATURE_KEYS.WHITE_LABEL]: FEATURE_CATEGORIES.WHITE_LABEL,
    [FEATURE_KEYS.CUSTOM_BRANDING]: FEATURE_CATEGORIES.WHITE_LABEL,
    [FEATURE_KEYS.CUSTOM_DOMAIN]: FEATURE_CATEGORIES.WHITE_LABEL,
    [FEATURE_KEYS.CUSTOM_STRATEGIES]: FEATURE_CATEGORIES.STRATEGY,
    [FEATURE_KEYS.STRATEGY_MARKETPLACE]: FEATURE_CATEGORIES.STRATEGY,
    [FEATURE_KEYS.BACKTESTING]: FEATURE_CATEGORIES.STRATEGY,
    [FEATURE_KEYS.PORTFOLIO_VIEW]: FEATURE_CATEGORIES.PORTFOLIO,
    [FEATURE_KEYS.MULTI_EXCHANGE]: FEATURE_CATEGORIES.PORTFOLIO,
    [FEATURE_KEYS.TAX_REPORTING]: FEATURE_CATEGORIES.PORTFOLIO,
    [FEATURE_KEYS.EMAIL_ALERTS]: FEATURE_CATEGORIES.NOTIFICATIONS,
    [FEATURE_KEYS.PUSH_NOTIFICATIONS]: FEATURE_CATEGORIES.NOTIFICATIONS,
    [FEATURE_KEYS.SMS_ALERTS]: FEATURE_CATEGORIES.NOTIFICATIONS,
    [FEATURE_KEYS.TWO_FACTOR_AUTH]: FEATURE_CATEGORIES.SECURITY,
    [FEATURE_KEYS.IP_WHITELIST]: FEATURE_CATEGORIES.SECURITY,
    [FEATURE_KEYS.API_KEY_MANAGEMENT]: FEATURE_CATEGORIES.SECURITY,
  };

  return categoryMap[key] || null;
}

export function getLimitCategory(key: string): LimitCategory | null {
  const categoryMap: Record<string, LimitCategory> = {
    [LIMIT_KEYS.MAX_PORTFOLIOS]: LIMIT_CATEGORIES.PORTFOLIO,
    [LIMIT_KEYS.MAX_ACCOUNTS]: LIMIT_CATEGORIES.PORTFOLIO,
    [LIMIT_KEYS.MAX_EXCHANGES]: LIMIT_CATEGORIES.PORTFOLIO,
    [LIMIT_KEYS.MAX_ORDERS_PER_DAY]: LIMIT_CATEGORIES.ORDERS,
    [LIMIT_KEYS.MAX_ORDERS_PER_HOUR]: LIMIT_CATEGORIES.ORDERS,
    [LIMIT_KEYS.MAX_ORDERS_PER_MINUTE]: LIMIT_CATEGORIES.ORDERS,
    [LIMIT_KEYS.MAX_POSITION_VALUE]: LIMIT_CATEGORIES.POSITIONS,
    [LIMIT_KEYS.MAX_POSITION_SIZE]: LIMIT_CATEGORIES.POSITIONS,
    [LIMIT_KEYS.MAX_OPEN_POSITIONS]: LIMIT_CATEGORIES.POSITIONS,
    [LIMIT_KEYS.MAX_COPY_SOURCES]: LIMIT_CATEGORIES.COPY_TRADING,
    [LIMIT_KEYS.MAX_COPY_AMOUNT]: LIMIT_CATEGORIES.COPY_TRADING,
    [LIMIT_KEYS.MAX_COPY_TRADES_PER_DAY]: LIMIT_CATEGORIES.COPY_TRADING,
    [LIMIT_KEYS.MAX_STRATEGIES]: LIMIT_CATEGORIES.STRATEGIES,
    [LIMIT_KEYS.MAX_STRATEGY_RUNS]: LIMIT_CATEGORIES.STRATEGIES,
    [LIMIT_KEYS.MAX_BACKTEST_DAYS]: LIMIT_CATEGORIES.STRATEGIES,
    [LIMIT_KEYS.API_RATE_LIMIT]: LIMIT_CATEGORIES.API,
    [LIMIT_KEYS.API_BURST_LIMIT]: LIMIT_CATEGORIES.API,
    [LIMIT_KEYS.MAX_API_KEYS]: LIMIT_CATEGORIES.API,
    [LIMIT_KEYS.MAX_HISTORICAL_DAYS]: LIMIT_CATEGORIES.DATA,
    [LIMIT_KEYS.MAX_DATA_EXPORTS]: LIMIT_CATEGORIES.DATA,
    [LIMIT_KEYS.MAX_REPORTS]: LIMIT_CATEGORIES.DATA,
    [LIMIT_KEYS.MAX_ALERTS]: LIMIT_CATEGORIES.ALERTS,
    [LIMIT_KEYS.MAX_WEBHOOKS]: LIMIT_CATEGORIES.ALERTS,
    [LIMIT_KEYS.MAX_NOTIFICATION_CHANNELS]: LIMIT_CATEGORIES.ALERTS,
    [LIMIT_KEYS.MAX_STORAGE_MB]: LIMIT_CATEGORIES.STORAGE,
    [LIMIT_KEYS.MAX_FILE_UPLOADS]: LIMIT_CATEGORIES.STORAGE,
    [LIMIT_KEYS.MAX_EXPORT_SIZE_MB]: LIMIT_CATEGORIES.STORAGE,
    [LIMIT_KEYS.MAX_TEAM_MEMBERS]: LIMIT_CATEGORIES.USERS,
    [LIMIT_KEYS.MAX_SUB_ACCOUNTS]: LIMIT_CATEGORIES.USERS,
    [LIMIT_KEYS.MAX_API_CALLS_PER_MONTH]: LIMIT_CATEGORIES.API,
  };

  return categoryMap[key] || null;
}