// # Responsibility: the one place the copy-trading screens reach for a copy route, so a page cannot invent a path that the other copy clients already own.
//
// Six of the nine routes this batch needed already had a wrapper with a stricter response check than a
// fresh one-liner would carry:
//   POST /v1/copy-trading/allocation-rebalance/preview   tradingApi.previewAllocationRebalance
//   GET  /v1/copy-trading/traders/:id/benchmark          tradingApi.getTraderBenchmark
//   GET  /v1/copy-trading/leader-fees/traders/:id        tradingApi.getLeaderFeePolicy
//   GET  /v1/copy-trading/budget                         copyOpsApi.getBudget
//   POST /v1/copy-trading/budget/reduce                  copyOpsApi.reduceBudget   (tighten-only, re-checked)
//   GET  /v1/copy-trading/executions/:id/timeline        copyOpsApi.getExecutionTimeline
//
// Re-implementing them here would mean two definitions of "the preview is not executable" and two
// places to fix when the contract moves, so this module delegates to those and adds only the four
// routes no client had:
//   GET  /v1/copy-trading/portfolio-valuation            persisted valuation (GAP-60), always executable:false
//   PUT  /v1/copy-trading/budget                         the follower's own limit (UpsertCopyBudgetDto)
//   GET  /v1/copy-trading/leader-fees/traders/:id/history operator-only policy history
//   POST /v1/copy-trading/leader-fees/traders/:id        operator-only policy change; the DTO carries its own idempotencyKey
//
// Money is a decimal string everywhere. Nothing in this file parses one into a number.

import { apiClient } from './api-client';
import { copyOpsApi, type CopyBudget, type CopyBudgetReduction, type CopyExecutionTimeline } from './copy-ops-api';
import {
  tradingApi,
  type PerformanceBenchmarkSeries,
  type PublicLeaderFeePolicy,
  type RebalancePreviewLine,
  type RebalancePreviewRequest,
} from './trading-api';

export type {
  CopyBudget,
  CopyBudgetReduction,
  CopyExecutionTimeline,
  PerformanceBenchmarkSeries,
  PublicLeaderFeePolicy,
  RebalancePreviewLine,
  RebalancePreviewRequest,
};

/** The API's own DECIMAL(28,12) format for every money and quantity field on these routes. */
export const DECIMAL_STRING = /^\d{1,16}(?:\.\d{1,12})?$/;

/** UpsertCopyBudgetDto: maxActiveExposure is required, the other two are optional. */
export interface UpsertCopyBudgetInput {
  maxActiveExposure: string;
  perTraderCap?: string | null;
  currency?: string | null;
}

/** PersistedPortfolioValuation, as allocation-valuation.repository returns it. */
export interface QuoteAssetValuation {
  quoteAsset: string;
  totalValue: string | null;
  state: 'AVAILABLE' | 'UNAVAILABLE';
  positionCount: number;
  pricedPositionCount: number;
  symbolsWithoutMarkPrice: string[];
  reason: string | null;
}

export interface PersistedPortfolioValuation {
  provenance: 'PERSISTED_PORTFOLIO_VALUATION';
  state: 'AVAILABLE' | 'UNAVAILABLE';
  requestedQuoteAsset: string | null;
  quoteAssets: QuoteAssetValuation[];
  asOf: string | null;
  excluded: { simulatedPositions: number; positionsWithoutMarkPrice: number };
  /** The route is a valuation, never an execution. */
  executable: false;
  reason: string | null;
}

/** One entry of the operator-only policy history. */
export interface LeaderFeePolicyVersion {
  id: string;
  traderId: string;
  currency: string;
  profitShareBps: number;
  highWaterMarkScope: 'PER_FOLLOWER_CURRENCY' | 'PER_TRADER_CURRENCY';
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
}

/** SetLeaderFeePolicyDto: the idempotency key is part of the body, not only a header. */
export interface SetLeaderFeePolicyInput {
  idempotencyKey: string;
  currency: string;
  profitShareBps: number;
  highWaterMarkScope: 'PER_FOLLOWER_CURRENCY' | 'PER_TRADER_CURRENCY';
  effectiveFrom?: string;
}

export interface LeaderFeePolicySetResult {
  traderId: string;
  currency: string;
  profitShareBps: number;
  highWaterMarkScope: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

const SEG = (value: string) => encodeURIComponent(value);

export const copyTradingExtendedApi = {
  /** Preview-only arithmetic on figures the caller supplied; `executable: false` is checked by the delegate. */
  previewAllocationRebalance: (input: RebalancePreviewRequest, idempotencyKey?: string) =>
    tradingApi.previewAllocationRebalance(input, idempotencyKey),
  getTraderBenchmark: tradingApi.getTraderBenchmark,
  getLeaderFeePolicy: tradingApi.getLeaderFeePolicy,
  getBudget: copyOpsApi.getBudget,
  reduceBudget: copyOpsApi.reduceBudget,
  getExecutionTimeline: copyOpsApi.getExecutionTimeline,

  /**
   * The persisted valuation the preview would rather start from.
   *
   * `quoteAsset` is required by the route: two quote-asset groups are two totals and there is no FX
   * rate here to join them, so asking for "the portfolio total" is not a question the API answers.
   */
  getPortfolioValuation: (query: { quoteAsset: string; accountId?: string; includeSimulated?: 'true' | 'false' }) =>
    apiClient.get<PersistedPortfolioValuation>('/v1/copy-trading/portfolio-valuation', { searchParams: query }),

  /** The follower's own ceiling. A PUT, so it is retried with the same Idempotency-Key. */
  putBudget: (input: UpsertCopyBudgetInput, idempotencyKey: string) =>
    apiClient.put<CopyBudget>('/v1/copy-trading/budget', input, { idempotencyKey }),

  /** Operator-only: tenant:update or platform:manage, checked again by the API. */
  getLeaderFeeHistory: (traderId: string, currency?: string) =>
    apiClient.get<{ data: LeaderFeePolicyVersion[] }>(`/v1/copy-trading/leader-fees/traders/${SEG(traderId)}/history`, {
      searchParams: { currency },
    }),

  /** Operator-only policy change; effective-dated, so a past period is never rewritten silently. */
  setLeaderFeePolicy: (traderId: string, input: SetLeaderFeePolicyInput) =>
    apiClient.post<LeaderFeePolicySetResult>(`/v1/copy-trading/leader-fees/traders/${SEG(traderId)}`, input, {
      idempotencyKey: input.idempotencyKey,
    }),
};

/** Convenience re-exports so a screen imports its types from the module it calls. */
export type { RebalancePreviewLine as RebalanceLine };
