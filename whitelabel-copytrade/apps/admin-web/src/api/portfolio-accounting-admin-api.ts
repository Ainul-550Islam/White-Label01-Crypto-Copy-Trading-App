// # Responsibility: typed admin client for portfolio-accounting.controller - the ledger side the customer app does not touch.
//
// The web app already reads NAV, P&L, holdings, performance, attribution and
// statements for one investor. This client covers what only an accountant or an
// operator does: open a profile, post a time-stamped snapshot, define and close
// a period, record an adjustment with a written reason, and run or review a
// reconciliation. Every amount is a decimal string on the wire and stays a
// string here - nothing in this file parses a money value into a number.
import { apiClient } from '@/lib/api-client';

/* ------------------------------------------------------------------ models */

export interface AccountingProfile {
  id: string;
  scope: string;
  scopeId: string;
  portfolioType?: string;
  baseCurrency?: string;
  returnMethodology?: string;
  costBasisMethod?: string | null;
  createdAt?: string;
  [key: string]: unknown;
}

export interface AccountingEventRow {
  id: string;
  profileId?: string;
  eventType?: string;
  sourceType?: string;
  sourceId?: string;
  asset?: string | null;
  quantity?: string | null;
  amount?: string | null;
  occurredAt?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface CashLedgerRow {
  id?: string;
  profileId?: string;
  asset: string;
  balance: string | null;
  available?: string | null;
  reserved?: string | null;
  asOf?: string;
  [key: string]: unknown;
}

export interface CashBalance {
  profileId?: string;
  asset: string;
  balance: string | null;
  asOf?: string;
  [key: string]: unknown;
}

export interface PositionAccountingRow {
  profileId?: string;
  symbol: string;
  quantity: string;
  averageCost: string | null;
  marketValue: string | null;
  unrealizedPnl: string | null;
  asOf?: string;
  [key: string]: unknown;
}

export interface AccountingSnapshot {
  id: string;
  profileId: string;
  timestamp?: string;
  scope?: string;
  scopeId?: string;
  nav?: string | null;
  baseCurrency?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface AccountingPeriod {
  id: string;
  profileId: string;
  periodStart: string;
  periodEnd: string;
  state: string;
  periodType?: string;
  baseCurrency?: string;
  closedAt?: string | null;
  [key: string]: unknown;
}

export interface AccountingStatement {
  id: string;
  profileId: string;
  periodId: string;
  state?: string;
  generatedAt?: string;
  [key: string]: unknown;
}

export interface AccountingAdjustment {
  id: string;
  profileId: string;
  adjustmentType: string;
  reason: string;
  adjustedAmount?: string | null;
  adjustedQuantity?: string | null;
  asset?: string | null;
  originalEventId?: string | null;
  createdAt?: string;
  [key: string]: unknown;
}

export interface AccountingReconciliation {
  id: string;
  profileId?: string;
  periodId?: string | null;
  state: string;
  scope?: string;
  trigger?: string | null;
  differences?: number | null;
  createdAt?: string;
  [key: string]: unknown;
}

export type AccountingRows<T> = T[] | { data: T[]; total?: number; page?: number; limit?: number };

/** Normalises a bare array or a page envelope. */
export function accountingRows<T>(payload: AccountingRows<T> | null | undefined): T[] {
  if (!payload) return [];
  return Array.isArray(payload) ? payload : (payload.data ?? []);
}

/* ------------------------------------------------------------------ inputs */

export interface PortfolioQuery {
  profileId?: string;
  scope?: string;
  scopeId?: string;
  symbol?: string;
  asset?: string;
  from?: string;
  to?: string;
  at?: string;
  baseCurrency?: string;
  page?: number;
  limit?: number;
}

export interface CreateProfileInput {
  scope: string;
  scopeId: string;
  portfolioType?: string;
  baseCurrency?: string;
  returnMethodology?: string;
  costBasisMethod?: string;
}

export interface CreateSnapshotInput {
  profileId: string;
  scope: string;
  scopeId: string;
  timestamp?: string;
  baseCurrency?: string;
}

export interface CreatePeriodInput {
  profileId: string;
  periodStart: string;
  periodEnd: string;
  periodType?: string;
  baseCurrency?: string;
}

export interface CreateAdjustmentInput {
  profileId: string;
  adjustmentType: string;
  /** `CreateAdjustmentDto` enforces at least five characters. */
  reason: string;
  originalEventId?: string;
  adjustedAmount?: string;
  adjustedQuantity?: string;
  asset?: string;
}

export interface RunReconciliationInput {
  profileId: string;
  scope: string;
  periodId?: string;
  trigger?: string;
}

export interface GenerateStatementInput {
  profileId: string;
  periodId: string;
}

/* ---------------------------------------------------------------- helpers */

const API_BASE = '/v1/portfolio-accounting';

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

export const portfolioAccountingAdminApi = {
  /* profiles */
  createProfile: (input: CreateProfileInput, idempotencyKey: string) =>
    apiClient.post<AccountingProfile>(`${API_BASE}/profiles`, input, { idempotencyKey }),
  listProfiles: (query: PortfolioQuery = {}) =>
    apiClient.get<AccountingRows<AccountingProfile>>(`${API_BASE}/profiles`, { searchParams: params({ ...query }) }),

  /* ledger reads */
  listEvents: (query: PortfolioQuery = {}) =>
    apiClient.get<AccountingRows<AccountingEventRow>>(`${API_BASE}/events`, { searchParams: params({ ...query }) }),
  listCash: (query: PortfolioQuery = {}) =>
    apiClient.get<AccountingRows<CashLedgerRow>>(`${API_BASE}/cash`, { searchParams: params({ ...query }) }),
  getCashBalance: (query: PortfolioQuery = {}) =>
    apiClient.get<CashBalance>(`${API_BASE}/cash/balance`, { searchParams: params({ ...query }) }),
  listPositions: (query: PortfolioQuery = {}) =>
    apiClient.get<AccountingRows<PositionAccountingRow>>(`${API_BASE}/positions`, { searchParams: params({ ...query }) }),

  /* snapshots */
  createSnapshot: (input: CreateSnapshotInput, idempotencyKey: string) =>
    apiClient.post<AccountingSnapshot>(`${API_BASE}/snapshots`, input, { idempotencyKey }),
  getSnapshot: (snapshotId: string) =>
    apiClient.get<AccountingSnapshot>(`${API_BASE}/snapshots/${segment(snapshotId)}`),

  /* periods */
  createPeriod: (input: CreatePeriodInput, idempotencyKey: string) =>
    apiClient.post<AccountingPeriod>(`${API_BASE}/periods`, input, { idempotencyKey }),
  listPeriods: (query: PortfolioQuery & { state?: string } = {}) =>
    apiClient.get<AccountingRows<AccountingPeriod>>(`${API_BASE}/periods`, { searchParams: params({ ...query }) }),
  /** Closing a period freezes every figure inside it. There is no reopen route. */
  closePeriod: (periodId: string, idempotencyKey: string) =>
    apiClient.post<AccountingPeriod>(`${API_BASE}/periods/close`, { periodId }, { idempotencyKey }),

  /* statements */
  generateStatement: (input: GenerateStatementInput, idempotencyKey: string) =>
    apiClient.post<AccountingStatement>(`${API_BASE}/statements`, input, { idempotencyKey }),

  /* adjustments */
  createAdjustment: (input: CreateAdjustmentInput, idempotencyKey: string) =>
    apiClient.post<AccountingAdjustment>(`${API_BASE}/adjustments`, input, { idempotencyKey }),
  listAdjustments: (query: PortfolioQuery = {}) =>
    apiClient.get<AccountingRows<AccountingAdjustment>>(`${API_BASE}/adjustments`, { searchParams: params({ ...query }) }),

  /* reconciliations */
  runReconciliation: (input: RunReconciliationInput, idempotencyKey: string) =>
    apiClient.post<AccountingReconciliation>(`${API_BASE}/reconciliations`, input, { idempotencyKey }),
  listReconciliations: (query: PortfolioQuery & { periodId?: string; state?: string } = {}) =>
    apiClient.get<AccountingRows<AccountingReconciliation>>(`${API_BASE}/reconciliations`, { searchParams: params({ ...query }) }),
};

/** The adjustment types `PortfolioAdjustmentType` accepts. */
export const ADJUSTMENT_TYPES = [
  'CORRECTION',
  'REVERSAL',
  'MANUAL_ADJUSTMENT',
  'FEE_CORRECTION',
  'CASH_CORRECTION',
  'POSITION_CORRECTION',
] as const;

/** The scopes `PortfolioAccountingScope` accepts. */
export const ACCOUNTING_SCOPES = ['TENANT', 'TRADER', 'FOLLOWER', 'STRATEGY', 'MANAGED_ACCOUNT'] as const;
