// # Responsibility: typed operator client for the copy-trading surface the console needs (trader profiles, strategies, budget, valuation, reconciliation, leader fees).
//
// The customer-facing marketplace lives in the web app; this client exists for
// the operator actions: verifying a trader, publishing or pausing a strategy,
// resolving a copy reconciliation record, and setting a leader-fee policy.
//
// Two contracts are worth naming because they are easy to get wrong:
//   * `POST copy-trading/leader-fees/traders/:traderId` takes the idempotency
//     key in the BODY (`idempotencyKey`), validated by `@Matches`, as well as a
//     header; the console sends both so neither path can be skipped.
//   * The budget DTOs take exact decimal STRINGS. Nothing here parses money into
//     a number.
import { apiClient } from '@/lib/api-client';

/* ------------------------------------------------------------------ models */

export interface TraderProfile {
  traderId?: string;
  userId?: string | null;
  displayName: string;
  bio?: string | null;
  avatarUrl?: string | null;
  supportedVenues?: string[];
  supportedSymbols?: string[];
  verificationState?: string;
  followerCount?: number | null;
  isPublic?: boolean;
  createdAt?: string;
  [key: string]: unknown;
}

export interface TraderStrategy {
  strategyId?: string;
  id?: string;
  traderId: string;
  name: string;
  description?: string | null;
  status?: string;
  supportedSymbols: string[];
  supportedVenues: string[];
  subscriberCount?: number | null;
  publishedAt?: string | null;
  createdAt?: string;
  [key: string]: unknown;
}

export interface CopyBudgetView {
  maxActiveExposure: string | null;
  committedExposure?: string | null;
  remaining?: string | null;
  currency?: string | null;
  perTraderCap?: string | null;
  updatedAt?: string;
  [key: string]: unknown;
}

/** `GET copy-trading/portfolio-valuation`. Always `executable: false`. */
export interface PortfolioValuation {
  state: string;
  quoteAsset?: string;
  totalValue?: string | null;
  positions?: Array<Record<string, unknown>>;
  executable: false;
  reason: string;
  [key: string]: unknown;
}

export interface PlatformPolicy {
  [key: string]: unknown;
}

export interface CopyReconciliationRecord {
  id: string;
  category: string;
  severity: string;
  resolved: boolean;
  notes?: string | null;
  strategyId?: string | null;
  subscriptionId?: string | null;
  expected?: Record<string, unknown> | null;
  actual?: Record<string, unknown> | null;
  createdAt?: string;
  resolvedAt?: string | null;
  [key: string]: unknown;
}

export interface LeaderFeePolicy {
  traderId?: string;
  currency: string;
  profitShareBps: number;
  highWaterMarkScope: string;
  effectiveFrom?: string | null;
  createdAt?: string;
  [key: string]: unknown;
}

export type CopyRows<T> = T[] | { data: T[]; total?: number; page?: number; limit?: number };

/** Normalises a bare array or a `{ data }` envelope. */
export function copyRows<T>(payload: CopyRows<T> | null | undefined): T[] {
  if (!payload) return [];
  return Array.isArray(payload) ? payload : (payload.data ?? []);
}

/* ------------------------------------------------------------------ inputs */

export interface CreateTraderProfileInput {
  displayName: string;
  bio?: string;
  avatarUrl?: string;
  supportedVenues?: string[];
  supportedSymbols?: string[];
  riskProfile?: Record<string, unknown>;
  isPublic?: boolean;
}

export interface UpdateTraderProfileInput {
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  supportedVenues?: string[];
  supportedSymbols?: string[];
  riskProfile?: Record<string, unknown>;
  isPublic?: boolean;
}

export interface CreateStrategyInput {
  traderId: string;
  name: string;
  description?: string;
  supportedSymbols: string[];
  supportedVenues: string[];
  riskProfile?: Record<string, unknown>;
  feePolicy?: Record<string, unknown>;
  strategyConfig?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface UpdateStrategyInput {
  name?: string;
  description?: string;
  supportedSymbols?: string[];
  supportedVenues?: string[];
  riskProfile?: Record<string, unknown>;
  feePolicy?: Record<string, unknown>;
  strategyConfig?: Record<string, unknown>;
}

export interface UpsertBudgetInput {
  /** Exact decimal string, at most 16 whole and 12 fractional digits. */
  maxActiveExposure: string;
  perTraderCap?: string;
  currency: string;
}

export interface LeaderEventInput {
  eventId: string;
  strategyId: string;
  traderId?: string;
  orderId?: string;
  fillId?: string;
  symbol: string;
  exchangeSymbol: string;
  side: string;
  type: string;
  quantity: string;
  price?: string;
  stopPrice?: string;
  venue: string;
  timestamp: string;
  isSimulated?: boolean;
}

export interface SetLeaderFeePolicyInput {
  idempotencyKey: string;
  currency: string;
  profitShareBps: number;
  highWaterMarkScope: string;
  effectiveFrom?: string;
}

/* ---------------------------------------------------------------- helpers */

const API_BASE = '/v1/copy-trading';
const API_BASE_LEADER_FEES = '/v1/copy-trading/leader-fees';

function params(query: Record<string, string | number | boolean | undefined>): Record<string, string | number | boolean | undefined> {
  const cleaned: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') cleaned[key] = value;
  }
  return cleaned;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

/* ------------------------------------------------------------------ client */

export const copyTradingAdminApi = {
  /* trader profiles */
  createTraderProfile: (input: CreateTraderProfileInput, idempotencyKey: string) =>
    apiClient.post<TraderProfile>(`${API_BASE}/traders/profile`, input, { idempotencyKey }),
  getMyTraderProfile: () => apiClient.get<TraderProfile>(`${API_BASE}/traders/profile/me`),
  updateTraderProfile: (traderId: string, input: UpdateTraderProfileInput, idempotencyKey: string) =>
    apiClient.put<TraderProfile>(`${API_BASE}/traders/${segment(traderId)}/profile`, input, { idempotencyKey }),
  verifyTrader: (traderId: string, idempotencyKey: string) =>
    apiClient.post<TraderProfile>(`${API_BASE}/traders/${segment(traderId)}/verify`, undefined, { idempotencyKey }),
  listTraderSubscriptions: (traderId: string, page = 1, limit = 20) =>
    apiClient.get<CopyRows<Record<string, unknown>>>(`${API_BASE}/traders/${segment(traderId)}/subscriptions`, { searchParams: params({ page, limit }) }),

  /* strategies */
  createStrategy: (input: CreateStrategyInput, idempotencyKey: string) =>
    apiClient.post<TraderStrategy>(`${API_BASE}/strategies`, input, { idempotencyKey }),
  updateStrategy: (strategyId: string, input: UpdateStrategyInput, idempotencyKey: string) =>
    apiClient.put<TraderStrategy>(`${API_BASE}/strategies/${segment(strategyId)}`, input, { idempotencyKey }),
  publishStrategy: (strategyId: string, idempotencyKey: string) =>
    apiClient.post<TraderStrategy>(`${API_BASE}/strategies/${segment(strategyId)}/publish`, undefined, { idempotencyKey }),
  pauseStrategy: (strategyId: string, idempotencyKey: string) =>
    apiClient.post<TraderStrategy>(`${API_BASE}/strategies/${segment(strategyId)}/pause`, undefined, { idempotencyKey }),
  resumeStrategy: (strategyId: string, idempotencyKey: string) =>
    apiClient.post<TraderStrategy>(`${API_BASE}/strategies/${segment(strategyId)}/resume`, undefined, { idempotencyKey }),
  archiveStrategy: (strategyId: string, idempotencyKey: string) =>
    apiClient.post<TraderStrategy>(`${API_BASE}/strategies/${segment(strategyId)}/archive`, undefined, { idempotencyKey }),

  /* executions and valuation */
  processLeaderEvent: (input: LeaderEventInput, idempotencyKey: string) =>
    apiClient.post<Record<string, unknown>>(`${API_BASE}/executions/leader-event`, input, { idempotencyKey }),
  /** `quoteAsset` is required by the API: a portfolio-wide figure would invite summing unlike groups. */
  getPortfolioValuation: (quoteAsset: string, accountId?: string, includeSimulated?: boolean) =>
    apiClient.get<PortfolioValuation>(`${API_BASE}/portfolio-valuation`, { searchParams: params({ quoteAsset, accountId, includeSimulated }) }),

  /* policy and rankings */
  getPlatformPolicy: () => apiClient.get<PlatformPolicy>(`${API_BASE}/policies/platform`),
  getFeaturedRankings: (limit = 10) =>
    apiClient.get<CopyRows<Record<string, unknown>>>(`${API_BASE}/rankings/featured`, { searchParams: params({ limit }) }),

  /* budget (the caller's own) */
  upsertBudget: (input: UpsertBudgetInput, idempotencyKey: string) =>
    apiClient.put<CopyBudgetView>(`${API_BASE}/budget`, input, { idempotencyKey }),

  /* reconciliation */
  runReconciliation: (input: { strategyId?: string; from?: string; to?: string; limit?: number }, idempotencyKey: string) =>
    apiClient.post<Record<string, unknown>>(`${API_BASE}/reconciliation/run`, input, { idempotencyKey }),
  listReconciliationRecords: (query: { resolved?: boolean; category?: string; severity?: string; page?: number; limit?: number } = {}) =>
    apiClient.get<CopyRows<CopyReconciliationRecord>>(`${API_BASE}/reconciliation/records`, { searchParams: params({ ...query }) }),
  resolveReconciliation: (recordId: string, notes: string, idempotencyKey: string) =>
    apiClient.post<CopyReconciliationRecord>(`${API_BASE}/reconciliation/${segment(recordId)}/resolve`, { notes }, { idempotencyKey }),

  /* leader fees */
  getLeaderFeePolicy: (traderId: string, currency = 'USD') =>
    apiClient.get<LeaderFeePolicy>(`${API_BASE_LEADER_FEES}/traders/${segment(traderId)}`, { searchParams: params({ currency }) }),
  getLeaderFeeHistory: (traderId: string, currency = 'USD') =>
    apiClient.get<CopyRows<LeaderFeePolicy>>(`${API_BASE_LEADER_FEES}/traders/${segment(traderId)}/history`, { searchParams: params({ currency }) }),
  setLeaderFeePolicy: (traderId: string, input: SetLeaderFeePolicyInput, idempotencyKey: string) =>
    apiClient.post<LeaderFeePolicy>(`${API_BASE_LEADER_FEES}/traders/${segment(traderId)}`, input, { idempotencyKey }),
};

/** The currencies `SetLeaderFeePolicyDto` accepts. */
export const LEADER_FEE_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'BTC', 'ETH', 'USDT', 'USDC'] as const;

/** The high-water-mark scopes the DTO accepts. */
export const HIGH_WATER_MARK_SCOPES = ['PER_TRADER', 'PER_SUBSCRIPTION', 'GLOBAL'] as const;

/** Exact-decimal check mirroring the DTO's `@Matches`, so a typo fails locally. */
export const DECIMAL_MONEY = /^\d{1,16}(?:\.\d{1,12})?$/;
