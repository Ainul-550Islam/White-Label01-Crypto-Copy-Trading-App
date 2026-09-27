/**
 * Canonical durable metering types.
 * Durable usage history around Part 2 runtime enforcement.
 * No hardcoded plan limits, no invented pricing.
 */

export enum MeterKey {
  USERS = 'USERS',
  TRADERS = 'TRADERS',
  FOLLOWERS = 'FOLLOWERS',
  EXCHANGE_ACCOUNTS = 'EXCHANGE_ACCOUNTS',
  COPY_SUBSCRIPTIONS = 'COPY_SUBSCRIPTIONS',
  API_REQUESTS = 'API_REQUESTS',
  WEBSOCKET_CONNECTIONS = 'WEBSOCKET_CONNECTIONS',
  TRADING_VOLUME = 'TRADING_VOLUME',
  COPY_TRADING_VOLUME = 'COPY_TRADING_VOLUME',
  PLATFORM_FEE_VOLUME = 'PLATFORM_FEE_VOLUME',
  PERFORMANCE_FEE_VOLUME = 'PERFORMANCE_FEE_VOLUME',
  ORDERS = 'ORDERS',
  FILLS = 'FILLS',
}

export enum UsageScope {
  TENANT = 'TENANT',
  USER = 'USER',
  TRADER = 'TRADER',
  FOLLOWER = 'FOLLOWER',
  SUBSCRIPTION = 'SUBSCRIPTION',
  API_IDENTITY = 'API_IDENTITY',
  GLOBAL = 'GLOBAL',
}

export enum MeterUnit {
  COUNT = 'COUNT',
  REQUEST = 'REQUEST',
  CONNECTION = 'CONNECTION',
  VOLUME_USD = 'VOLUME_USD',
  VOLUME_BTC = 'VOLUME_BTC',
  VOLUME = 'VOLUME',
  SECOND = 'SECOND',
}

export enum AggregationWindow {
  MINUTE = 'MINUTE',
  HOURLY = 'HOURLY',
  DAILY = 'DAILY',
  MONTHLY = 'MONTHLY',
  BILLING_PERIOD = 'BILLING_PERIOD',
  ROLLING = 'ROLLING',
}

export enum ProcessingState {
  RECEIVED = 'RECEIVED',
  PROCESSED = 'PROCESSED',
  DUPLICATE = 'DUPLICATE',
  FAILED = 'FAILED',
  REPLAYED = 'REPLAYED',
}

export enum PeriodType {
  CALENDAR_DAY = 'CALENDAR_DAY',
  CALENDAR_MONTH = 'CALENDAR_MONTH',
  CALENDAR_HOUR = 'CALENDAR_HOUR',
  SUBSCRIPTION_PERIOD = 'SUBSCRIPTION_PERIOD',
  ROLLING_MINUTE = 'ROLLING_MINUTE',
  CUSTOM = 'CUSTOM',
}

export enum PeriodStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  CURRENT = 'CURRENT',
  FUTURE = 'FUTURE',
}

export interface MeterDefinition {
  key: MeterKey;
  name: string;
  description: string;
  unit: MeterUnit;
  scope: UsageScope[];
  isBillable: boolean;
  isEnforced: boolean;
  aggregation: AggregationWindow[];
  retentionDays: number;
}

export interface UsageDimension {
  tenantId: string;
  scope: UsageScope;
  subjectId?: string;
  resourceId?: string;
  apiIdentity?: string;
  endpoint?: string;
  traderId?: string;
  followerId?: string;
  userId?: string;
  subscriptionId?: string;
}

export interface DurableUsageEvent {
  id: string;
  tenantId: string;
  meterKey: MeterKey;
  scope: UsageScope;
  subjectId?: string;
  resourceId?: string;
  quantity: number;
  unit: MeterUnit;
  sourceType: string;
  sourceId: string;
  sourceEventId?: string;
  periodId: string;
  periodType: PeriodType;
  periodStart: string;
  periodEnd: string;
  timestamp: string;
  idempotencyKey: string;
  processingState: ProcessingState;
  dimensions: UsageDimension;
  safeMetadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface UsageBucket {
  id: string;
  tenantId: string;
  meterKey: MeterKey;
  scope: UsageScope;
  subjectId?: string;
  window: AggregationWindow;
  periodId: string;
  periodStart: string;
  periodEnd: string;
  totalQuantity: number;
  eventCount: number;
  unit: MeterUnit;
  lastEventAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuotaSnapshot {
  tenantId: string;
  meterKey: MeterKey;
  limitKey: string;
  scope: UsageScope;
  subjectId?: string;
  maximum: number | null;
  current: number;
  remaining: number | null;
  utilizationPercent: number | null;
  status: 'OK' | 'APPROACHING' | 'AT_LIMIT' | 'OVER_LIMIT' | 'UNLIMITED';
  periodId: string;
  periodStart: string;
  periodEnd: string;
  fetchedAt: string;
  planCode?: string | null;
  isEnforced: boolean;
}

export interface OverageState {
  meterKey: MeterKey;
  tenantId: string;
  periodId: string;
  allowedQuantity: number;
  actualQuantity: number;
  excessQuantity: number;
  unit: MeterUnit;
  policyReference?: string | null;
  rateReference?: string | null;
  estimatedAmount?: string | null;
  currency?: string | null;
  status: 'DETECTED' | 'CALCULATED' | 'REVIEW_REQUIRED' | 'BILLABLE' | 'INVOICED' | 'WAIVED' | 'REVERSED' | 'NOT_CONFIGURED';
  calculatedAt: string;
}

export interface UsagePeriod {
  id: string;
  tenantId: string;
  type: PeriodType;
  status: PeriodStatus;
  start: string;
  end: string;
  timezone: string;
  isCurrent: boolean;
  subscriptionId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export const METER_DEFINITIONS: Record<MeterKey, MeterDefinition> = {
  [MeterKey.USERS]: {
    key: MeterKey.USERS,
    name: 'Users',
    description: 'Tenant user count',
    unit: MeterUnit.COUNT,
    scope: [UsageScope.TENANT],
    isBillable: false,
    isEnforced: true,
    aggregation: [AggregationWindow.DAILY, AggregationWindow.MONTHLY, AggregationWindow.BILLING_PERIOD],
    retentionDays: 365,
  },
  [MeterKey.TRADERS]: {
    key: MeterKey.TRADERS,
    name: 'Traders',
    description: 'Tenant trader count',
    unit: MeterUnit.COUNT,
    scope: [UsageScope.TENANT],
    isBillable: false,
    isEnforced: true,
    aggregation: [AggregationWindow.DAILY, AggregationWindow.MONTHLY, AggregationWindow.BILLING_PERIOD],
    retentionDays: 365,
  },
  [MeterKey.FOLLOWERS]: {
    key: MeterKey.FOLLOWERS,
    name: 'Followers',
    description: 'Followers per trader',
    unit: MeterUnit.COUNT,
    scope: [UsageScope.TENANT, UsageScope.TRADER],
    isBillable: false,
    isEnforced: true,
    aggregation: [AggregationWindow.DAILY, AggregationWindow.MONTHLY],
    retentionDays: 365,
  },
  [MeterKey.EXCHANGE_ACCOUNTS]: {
    key: MeterKey.EXCHANGE_ACCOUNTS,
    name: 'Exchange Accounts',
    description: 'Exchange accounts per user',
    unit: MeterUnit.COUNT,
    scope: [UsageScope.TENANT, UsageScope.USER],
    isBillable: false,
    isEnforced: true,
    aggregation: [AggregationWindow.DAILY, AggregationWindow.MONTHLY],
    retentionDays: 365,
  },
  [MeterKey.COPY_SUBSCRIPTIONS]: {
    key: MeterKey.COPY_SUBSCRIPTIONS,
    name: 'Copy Subscriptions',
    description: 'Copy subscriptions per follower',
    unit: MeterUnit.COUNT,
    scope: [UsageScope.TENANT, UsageScope.FOLLOWER],
    isBillable: false,
    isEnforced: true,
    aggregation: [AggregationWindow.DAILY, AggregationWindow.MONTHLY],
    retentionDays: 365,
  },
  [MeterKey.API_REQUESTS]: {
    key: MeterKey.API_REQUESTS,
    name: 'API Requests',
    description: 'API requests per minute and period totals',
    unit: MeterUnit.REQUEST,
    scope: [UsageScope.TENANT, UsageScope.API_IDENTITY, UsageScope.USER],
    isBillable: false,
    isEnforced: true,
    aggregation: [AggregationWindow.MINUTE, AggregationWindow.HOURLY, AggregationWindow.DAILY, AggregationWindow.MONTHLY],
    retentionDays: 90,
  },
  [MeterKey.WEBSOCKET_CONNECTIONS]: {
    key: MeterKey.WEBSOCKET_CONNECTIONS,
    name: 'WebSocket Connections',
    description: 'Active WebSocket connections',
    unit: MeterUnit.CONNECTION,
    scope: [UsageScope.TENANT],
    isBillable: false,
    isEnforced: true,
    aggregation: [AggregationWindow.HOURLY, AggregationWindow.DAILY, AggregationWindow.MONTHLY],
    retentionDays: 90,
  },
  [MeterKey.TRADING_VOLUME]: {
    key: MeterKey.TRADING_VOLUME,
    name: 'Trading Volume',
    description: 'Validated trading volume',
    unit: MeterUnit.VOLUME_USD,
    scope: [UsageScope.TENANT, UsageScope.USER, UsageScope.TRADER],
    isBillable: false,
    isEnforced: false,
    aggregation: [AggregationWindow.HOURLY, AggregationWindow.DAILY, AggregationWindow.MONTHLY, AggregationWindow.BILLING_PERIOD],
    retentionDays: 365,
  },
  [MeterKey.COPY_TRADING_VOLUME]: {
    key: MeterKey.COPY_TRADING_VOLUME,
    name: 'Copy Trading Volume',
    description: 'Copy trading settlement volume',
    unit: MeterUnit.VOLUME_USD,
    scope: [UsageScope.TENANT, UsageScope.TRADER, UsageScope.FOLLOWER],
    isBillable: false,
    isEnforced: false,
    aggregation: [AggregationWindow.HOURLY, AggregationWindow.DAILY, AggregationWindow.MONTHLY, AggregationWindow.BILLING_PERIOD],
    retentionDays: 365,
  },
  [MeterKey.PLATFORM_FEE_VOLUME]: {
    key: MeterKey.PLATFORM_FEE_VOLUME,
    name: 'Platform Fee Volume',
    description: 'Volume subject to platform fees',
    unit: MeterUnit.VOLUME_USD,
    scope: [UsageScope.TENANT],
    isBillable: true,
    isEnforced: false,
    aggregation: [AggregationWindow.DAILY, AggregationWindow.MONTHLY, AggregationWindow.BILLING_PERIOD],
    retentionDays: 365,
  },
  [MeterKey.PERFORMANCE_FEE_VOLUME]: {
    key: MeterKey.PERFORMANCE_FEE_VOLUME,
    name: 'Performance Fee Volume',
    description: 'Volume subject to performance fees',
    unit: MeterUnit.VOLUME_USD,
    scope: [UsageScope.TENANT, UsageScope.TRADER],
    isBillable: true,
    isEnforced: false,
    aggregation: [AggregationWindow.DAILY, AggregationWindow.MONTHLY, AggregationWindow.BILLING_PERIOD],
    retentionDays: 365,
  },
  [MeterKey.ORDERS]: {
    key: MeterKey.ORDERS,
    name: 'Orders',
    description: 'Order count',
    unit: MeterUnit.COUNT,
    scope: [UsageScope.TENANT, UsageScope.USER],
    isBillable: false,
    isEnforced: false,
    aggregation: [AggregationWindow.HOURLY, AggregationWindow.DAILY, AggregationWindow.MONTHLY],
    retentionDays: 90,
  },
  [MeterKey.FILLS]: {
    key: MeterKey.FILLS,
    name: 'Fills',
    description: 'Fill count',
    unit: MeterUnit.COUNT,
    scope: [UsageScope.TENANT, UsageScope.USER],
    isBillable: false,
    isEnforced: false,
    aggregation: [AggregationWindow.HOURLY, AggregationWindow.DAILY, AggregationWindow.MONTHLY],
    retentionDays: 90,
  },
};

export const ENFORCED_METER_TO_LIMIT_KEY: Record<string, string> = {
  [MeterKey.USERS]: 'maxUsers',
  [MeterKey.TRADERS]: 'maxTraders',
  [MeterKey.FOLLOWERS]: 'maxFollowersPerTrader',
  [MeterKey.EXCHANGE_ACCOUNTS]: 'maxExchangeAccountsPerUser',
  [MeterKey.COPY_SUBSCRIPTIONS]: 'maxCopySubscriptionsPerFollower',
  [MeterKey.API_REQUESTS]: 'maxApiRequestsPerMinute',
  [MeterKey.WEBSOCKET_CONNECTIONS]: 'websocketConnections',
};
