/**
 * Normalised usage models consumed by the enforcement layer.
 *
 * Each model represents the current utilisation of a single quota dimension,
 * scoped to the appropriate entity (tenant, user, trader, follower).
 */

/** Scope at which a usage counter is tracked. */
export enum UsageScope {
  TENANT = 'TENANT',
  USER = 'USER',
  TRADER = 'TRADER',
  FOLLOWER = 'FOLLOWER',
}

/** Usage for the maxUsers limit, scoped to the tenant. */
export interface UserUsage {
  tenantId: string;
  current: number;
  maximum: number | null;
  remaining: number | null;
  updatedAt: Date;
}

/** Usage for the maxTraders limit, scoped to the tenant. */
export interface TraderUsage {
  tenantId: string;
  current: number;
  maximum: number | null;
  remaining: number | null;
  updatedAt: Date;
}

/** Usage for the maxFollowersPerTrader limit, scoped to one trader. */
export interface FollowerUsage {
  tenantId: string;
  traderId: string;
  current: number;
  maximum: number | null;
  remaining: number | null;
  updatedAt: Date;
}

/** Usage for the maxExchangeAccountsPerUser limit, scoped to one user. */
export interface ExchangeAccountUsage {
  tenantId: string;
  userId: string;
  current: number;
  maximum: number | null;
  remaining: number | null;
  updatedAt: Date;
}

/** Usage for the maxCopySubscriptionsPerFollower limit, scoped to one follower. */
export interface CopySubscriptionUsage {
  tenantId: string;
  followerId: string;
  current: number;
  maximum: number | null;
  remaining: number | null;
  updatedAt: Date;
}

/**
 * Usage for the maxApiRequestsPerMinute limit.
 *
 * The `windowStart` and `windowEnd` delimit the current sliding/fixed window.
 * The `remaining` value is clamped to >= 0.
 */
export interface ApiRequestUsage {
  tenantId: string;
  userId?: string;
  current: number;
  maximum: number | null;
  remaining: number | null;
  windowStart: Date;
  windowEnd: Date;
  updatedAt: Date;
}

/**
 * Usage for the websocketConnections limit, scoped to the tenant.
 *
 * The `reserved` count includes both confirmed connections and in-flight
 * connection handshakes that have reserved a slot but not yet completed.
 */
export interface WebsocketUsage {
  tenantId: string;
  current: number;
  reserved: number;
  maximum: number | null;
  remaining: number | null;
  updatedAt: Date;
}

/** A generic usage record for persistence. */
export interface UsageRecord {
  id: string;
  tenantId: string;
  limitKey: string;
  scope: UsageScope;
  scopeId: string;
  current: number;
  windowStart?: Date;
  windowEnd?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** Input for incrementing a usage counter. */
export interface IncrementUsageInput {
  tenantId: string;
  limitKey: string;
  scope: UsageScope;
  scopeId: string;
  amount?: number;
}

/** Input for decrementing a usage counter. */
export interface DecrementUsageInput {
  tenantId: string;
  limitKey: string;
  scope: UsageScope;
  scopeId: string;
  amount?: number;
}

/** Input for reserving a quota slot. */
export interface ReserveUsageInput {
  tenantId: string;
  limitKey: string;
  scope: UsageScope;
  scopeId: string;
  maximum: number;
  amount?: number;
}

/** Result of a quota reservation. */
export interface ReserveUsageResult {
  reserved: boolean;
  currentAfter: number;
  maximum: number;
  remaining: number;
}
