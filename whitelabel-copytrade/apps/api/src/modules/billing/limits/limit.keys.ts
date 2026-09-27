/**
 * Limit Keys - Standard limit keys for the billing system
 * 
 * This module defines the standard keys used for limits
 * across the platform.
 */

// Rate Limit Keys
export const RATE_LIMIT_KEYS = {
  API_REQUESTS_PER_MINUTE: 'api_requests_per_minute',
  API_REQUESTS_PER_HOUR: 'api_requests_per_hour',
  API_REQUESTS_PER_DAY: 'api_requests_per_day',
  ORDERS_PER_MINUTE: 'orders_per_minute',
  ORDERS_PER_HOUR: 'orders_per_hour',
  ORDERS_PER_DAY: 'orders_per_day',
  LOGIN_ATTEMPTS_PER_HOUR: 'login_attempts_per_hour',
  PASSWORD_RESET_PER_DAY: 'password_reset_per_day',
} as const;

// Resource Limit Keys
export const RESOURCE_LIMIT_KEYS = {
  MAX_PORTFOLIOS: 'max_portfolios',
  MAX_ACCOUNTS: 'max_accounts',
  MAX_EXCHANGES: 'max_exchanges',
  MAX_POSITIONS: 'max_positions',
  MAX_OPEN_ORDERS: 'max_open_orders',
  MAX_STRATEGIES: 'max_strategies',
  MAX_ALERTS: 'max_alerts',
  MAX_WEBHOOKS: 'max_webhooks',
  MAX_API_KEYS: 'max_api_keys',
  MAX_TEAM_MEMBERS: 'max_team_members',
} as const;

// Value Limit Keys
export const VALUE_LIMIT_KEYS = {
  MAX_POSITION_VALUE: 'max_position_value',
  MAX_ORDER_VALUE: 'max_order_value',
  MAX_DAILY_VOLUME: 'max_daily_volume',
  MAX_MONTHLY_VOLUME: 'max_monthly_volume',
  MAX_COPY_AMOUNT: 'max_copy_amount',
  MAX_DEPOSIT_AMOUNT: 'max_deposit_amount',
  MAX_WITHDRAWAL_AMOUNT: 'max_withdrawal_amount',
} as const;

// Storage Limit Keys
export const STORAGE_LIMIT_KEYS = {
  MAX_STORAGE_MB: 'max_storage_mb',
  MAX_FILE_SIZE_MB: 'max_file_size_mb',
  MAX_EXPORT_SIZE_MB: 'max_export_size_mb',
  MAX_HISTORY_DAYS: 'max_history_days',
} as const;

// All Limit Keys
export const ALL_LIMIT_KEYS = {
  ...RATE_LIMIT_KEYS,
  ...RESOURCE_LIMIT_KEYS,
  ...VALUE_LIMIT_KEYS,
  ...STORAGE_LIMIT_KEYS,
} as const;

export type RateLimitKey = typeof RATE_LIMIT_KEYS[keyof typeof RATE_LIMIT_KEYS];
export type ResourceLimitKey = typeof RESOURCE_LIMIT_KEYS[keyof typeof RESOURCE_LIMIT_KEYS];
export type ValueLimitKey = typeof VALUE_LIMIT_KEYS[keyof typeof VALUE_LIMIT_KEYS];
export type StorageLimitKey = typeof STORAGE_LIMIT_KEYS[keyof typeof STORAGE_LIMIT_KEYS];
export type LimitKey = typeof ALL_LIMIT_KEYS[keyof typeof ALL_LIMIT_KEYS];

export function isRateLimitKey(key: string): key is RateLimitKey {
  return Object.values(RATE_LIMIT_KEYS).includes(key as RateLimitKey);
}

export function isResourceLimitKey(key: string): key is ResourceLimitKey {
  return Object.values(RESOURCE_LIMIT_KEYS).includes(key as ResourceLimitKey);
}

export function isValueLimitKey(key: string): key is ValueLimitKey {
  return Object.values(VALUE_LIMIT_KEYS).includes(key as ValueLimitKey);
}

export function isStorageLimitKey(key: string): key is StorageLimitKey {
  return Object.values(STORAGE_LIMIT_KEYS).includes(key as StorageLimitKey);
}

export function isLimitKey(key: string): key is LimitKey {
  return Object.values(ALL_LIMIT_KEYS).includes(key as LimitKey);
}

export function getLimitCategory(key: string): string | null {
  if (isRateLimitKey(key)) return 'rate';
  if (isResourceLimitKey(key)) return 'resource';
  if (isValueLimitKey(key)) return 'value';
  if (isStorageLimitKey(key)) return 'storage';
  return null;
}

export function getLimitDisplayName(key: string): string {
  const displayNames: Record<string, string> = {
    [RATE_LIMIT_KEYS.API_REQUESTS_PER_MINUTE]: 'API Requests per Minute',
    [RATE_LIMIT_KEYS.API_REQUESTS_PER_HOUR]: 'API Requests per Hour',
    [RATE_LIMIT_KEYS.API_REQUESTS_PER_DAY]: 'API Requests per Day',
    [RATE_LIMIT_KEYS.ORDERS_PER_MINUTE]: 'Orders per Minute',
    [RATE_LIMIT_KEYS.ORDERS_PER_HOUR]: 'Orders per Hour',
    [RATE_LIMIT_KEYS.ORDERS_PER_DAY]: 'Orders per Day',
    [RATE_LIMIT_KEYS.LOGIN_ATTEMPTS_PER_HOUR]: 'Login Attempts per Hour',
    [RATE_LIMIT_KEYS.PASSWORD_RESET_PER_DAY]: 'Password Resets per Day',
    [RESOURCE_LIMIT_KEYS.MAX_PORTFOLIOS]: 'Maximum Portfolios',
    [RESOURCE_LIMIT_KEYS.MAX_ACCOUNTS]: 'Maximum Accounts',
    [RESOURCE_LIMIT_KEYS.MAX_EXCHANGES]: 'Maximum Exchanges',
    [RESOURCE_LIMIT_KEYS.MAX_POSITIONS]: 'Maximum Positions',
    [RESOURCE_LIMIT_KEYS.MAX_OPEN_ORDERS]: 'Maximum Open Orders',
    [RESOURCE_LIMIT_KEYS.MAX_STRATEGIES]: 'Maximum Strategies',
    [RESOURCE_LIMIT_KEYS.MAX_ALERTS]: 'Maximum Alerts',
    [RESOURCE_LIMIT_KEYS.MAX_WEBHOOKS]: 'Maximum Webhooks',
    [RESOURCE_LIMIT_KEYS.MAX_API_KEYS]: 'Maximum API Keys',
    [RESOURCE_LIMIT_KEYS.MAX_TEAM_MEMBERS]: 'Maximum Team Members',
    [VALUE_LIMIT_KEYS.MAX_POSITION_VALUE]: 'Maximum Position Value',
    [VALUE_LIMIT_KEYS.MAX_ORDER_VALUE]: 'Maximum Order Value',
    [VALUE_LIMIT_KEYS.MAX_DAILY_VOLUME]: 'Maximum Daily Volume',
    [VALUE_LIMIT_KEYS.MAX_MONTHLY_VOLUME]: 'Maximum Monthly Volume',
    [VALUE_LIMIT_KEYS.MAX_COPY_AMOUNT]: 'Maximum Copy Amount',
    [VALUE_LIMIT_KEYS.MAX_DEPOSIT_AMOUNT]: 'Maximum Deposit Amount',
    [VALUE_LIMIT_KEYS.MAX_WITHDRAWAL_AMOUNT]: 'Maximum Withdrawal Amount',
    [STORAGE_LIMIT_KEYS.MAX_STORAGE_MB]: 'Maximum Storage',
    [STORAGE_LIMIT_KEYS.MAX_FILE_SIZE_MB]: 'Maximum File Size',
    [STORAGE_LIMIT_KEYS.MAX_EXPORT_SIZE_MB]: 'Maximum Export Size',
    [STORAGE_LIMIT_KEYS.MAX_HISTORY_DAYS]: 'Maximum History Days',
  };

  return displayNames[key] || key;
}