// # Responsibility: typed client for every route portfolio-accounting.controller mounts, so the accounting screens never invent a path or a total.
//
// The controller's own list, read file by file:
//   POST /v1/portfolio-accounting/profiles            GET  /v1/portfolio-accounting/profiles
//   GET  /v1/portfolio-accounting/events              GET  /v1/portfolio-accounting/cash
//   GET  /v1/portfolio-accounting/cash/balance        GET  /v1/portfolio-accounting/positions
//   GET  /v1/portfolio-accounting/holdings            GET  /v1/portfolio-accounting/nav
//   GET  /v1/portfolio-accounting/pnl                 GET  /v1/portfolio-accounting/performance
//   GET  /v1/portfolio-accounting/attribution         POST /v1/portfolio-accounting/snapshots
//   GET  /v1/portfolio-accounting/snapshots           GET  /v1/portfolio-accounting/snapshots/:id
//   POST /v1/portfolio-accounting/periods             GET  /v1/portfolio-accounting/periods
//   POST /v1/portfolio-accounting/periods/close       POST /v1/portfolio-accounting/statements
//   GET  /v1/portfolio-accounting/statements          GET  /v1/portfolio-accounting/statements/:id
//   GET  /v1/portfolio-accounting/statements/:id/export
//   POST /v1/portfolio-accounting/adjustments         GET  /v1/portfolio-accounting/adjustments
//   POST /v1/portfolio-accounting/reconciliations     GET  /v1/portfolio-accounting/reconciliations
//
// Every figure is a decimal string computed by the accounting service. Nothing here sums, rounds or
// converts one: a client-side total would be a second, unpublished definition of net asset value.

import { apiClient } from './api-client';

const API_BASE = '/v1/portfolio-accounting';

function params(query: Record<string, string | number | boolean | undefined>): Record<string, string | number | boolean | undefined> {
  return query;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

export type AccountingScope = 'TENANT' | 'USER' | 'ACCOUNT';
export type ReturnMethodology = 'TWR' | 'MWR';
export type AttributionDimension = 'ASSET' | 'SYMBOL' | 'STRATEGY';

export interface AccountingProfile {
  id: string;
  scope: string;
  scopeId: string;
  portfolioType?: string;
  baseCurrency: string;
  returnMethodology?: string;
}

export interface PortfolioQuery {
  profileId?: string;
  scope?: AccountingScope;
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

export interface PagedRows<T> {
  data: T[];
  total: number;
  page?: number;
  limit?: number;
}

export interface NavView {
  nav: string;
  cash: string;
  baseCurrency: string;
  valuationTimestamp: string | null;
  dataCompleteness: string;
  canPublish: boolean;
  valuationState?: string;
}

export interface PnlView {
  realized: string;
  unrealized: string;
  gross: string;
  net: string;
  baseCurrency?: string;
  dataCompleteness?: string;
}

export interface HoldingRow {
  symbol: string;
  asset: string;
  quantity: string;
  classification?: string;
  costBasis: string | null;
  marketValue?: string | null;
}

export interface PositionRow {
  symbol: string;
  asset?: string;
  quantity: string;
  costBasis: string | null;
  marketValue?: string | null;
}

export interface StatementRow {
  id: string;
  periodId?: string;
  kind?: string;
  generatedAt: string;
  state?: string;
}

export interface AdjustmentRow {
  id: string;
  kind?: string;
  amount: string;
  reason?: string;
  createdAt: string;
}

export interface ReconciliationRow {
  id: string;
  state: string;
  runAt?: string;
  findings?: number;
}

export interface CreateProfileInput {
  scope: AccountingScope;
  scopeId: string;
  baseCurrency: string;
  portfolioType?: string;
}

export const portfolioAccountingApi = {
  createProfile: (input: CreateProfileInput, idempotencyKey: string) =>
    apiClient.post<AccountingProfile>(`${API_BASE}/profiles`, input, { idempotencyKey }),
  listProfiles: (query: PortfolioQuery = {}) =>
    apiClient.get<PagedRows<AccountingProfile>>(`${API_BASE}/profiles`, { searchParams: params({ ...query }) }),

  listEvents: (query: PortfolioQuery = {}) =>
    apiClient.get<PagedRows<Record<string, unknown>>>(`${API_BASE}/events`, { searchParams: params({ ...query }) }),
  listCash: (query: PortfolioQuery = {}) =>
    apiClient.get<PagedRows<Record<string, string>>>(`${API_BASE}/cash`, { searchParams: params({ ...query }) }),
  getCashBalance: (query: PortfolioQuery = {}) =>
    apiClient.get<{ balance: string; baseCurrency: string }>(`${API_BASE}/cash/balance`, { searchParams: params({ ...query }) }),

  listPositions: (query: PortfolioQuery = {}) =>
    apiClient.get<PagedRows<PositionRow>>(`${API_BASE}/positions`, { searchParams: params({ ...query }) }),
  getHoldings: (query: PortfolioQuery = {}) =>
    apiClient.get<PagedRows<HoldingRow>>(`${API_BASE}/holdings`, { searchParams: params({ ...query }) }),

  getNav: (query: PortfolioQuery = {}) =>
    apiClient.get<NavView>(`${API_BASE}/nav`, { searchParams: params({ ...query }) }),
  getPnl: (query: PortfolioQuery = {}) =>
    apiClient.get<PnlView>(`${API_BASE}/pnl`, { searchParams: params({ ...query }) }),
  getPerformance: (query: PortfolioQuery & { periodStart?: string; periodEnd?: string; methodology?: ReturnMethodology } = {}) =>
    apiClient.get<{ returnPercent: string | null; canCalculate: boolean; reason?: string }>(`${API_BASE}/performance`, {
      searchParams: params({ ...query }),
    }),
  getAttribution: (query: PortfolioQuery & { periodStart?: string; periodEnd?: string; dimension?: AttributionDimension } = {}) =>
    apiClient.get<{ attributions: Array<{ key: string; contribution: string }>; totalAttributed: string; unattributed: string }>(
      `${API_BASE}/attribution`,
      { searchParams: params({ ...query }) },
    ),

  createSnapshot: (input: { profileId: string; asOf?: string }, idempotencyKey: string) =>
    apiClient.post<{ id: string }>(`${API_BASE}/snapshots`, input, { idempotencyKey }),
  listSnapshots: (query: PortfolioQuery = {}) =>
    apiClient.get<PagedRows<Record<string, string>>>(`${API_BASE}/snapshots`, { searchParams: params({ ...query }) }),
  getSnapshot: (snapshotId: string) => apiClient.get<Record<string, string>>(`${API_BASE}/snapshots/${segment(snapshotId)}`),

  createPeriod: (input: { profileId: string; startsAt: string; endsAt: string }, idempotencyKey: string) =>
    apiClient.post<{ id: string; state: string }>(`${API_BASE}/periods`, input, { idempotencyKey }),
  listPeriods: (query: PortfolioQuery & { state?: string } = {}) =>
    apiClient.get<PagedRows<{ id: string; state: string; startsAt: string; endsAt: string }>>(`${API_BASE}/periods`, {
      searchParams: params({ ...query }),
    }),
  /** Closing a period is one-way: the controller publishes no reopen route. */
  closePeriod: (input: { periodId: string }, idempotencyKey: string) =>
    apiClient.post<{ id: string; state: string }>(`${API_BASE}/periods/close`, input, { idempotencyKey }),

  generateStatement: (input: { profileId: string; periodId: string; kind?: string }, idempotencyKey: string) =>
    apiClient.post<StatementRow>(`${API_BASE}/statements`, input, { idempotencyKey }),
  listStatements: (query: { profileId?: string; periodId?: string; page?: number; limit?: number } = {}) =>
    apiClient.get<PagedRows<StatementRow>>(`${API_BASE}/statements`, { searchParams: params({ ...query }) }),
  getStatement: (statementId: string) => apiClient.get<StatementRow>(`${API_BASE}/statements/${segment(statementId)}`),
  exportStatement: (statementId: string, format: 'JSON' | 'CSV' = 'JSON') =>
    apiClient.get<Record<string, unknown>>(`${API_BASE}/statements/${segment(statementId)}/export`, {
      searchParams: params({ format }),
    }),

  createAdjustment: (input: { profileId: string; kind: string; amount: string; reason: string }, idempotencyKey: string) =>
    apiClient.post<AdjustmentRow>(`${API_BASE}/adjustments`, input, { idempotencyKey }),
  listAdjustments: (query: PortfolioQuery = {}) =>
    apiClient.get<PagedRows<AdjustmentRow>>(`${API_BASE}/adjustments`, { searchParams: params({ ...query }) }),

  runReconciliation: (input: { profileId: string; periodId?: string }, idempotencyKey: string) =>
    apiClient.post<ReconciliationRow>(`${API_BASE}/reconciliations`, input, { idempotencyKey }),
  listReconciliations: (query: PortfolioQuery & { periodId?: string; state?: string } = {}) =>
    apiClient.get<PagedRows<ReconciliationRow>>(`${API_BASE}/reconciliations`, { searchParams: params({ ...query }) }),
};
