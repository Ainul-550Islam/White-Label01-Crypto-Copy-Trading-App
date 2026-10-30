// # Responsibility: typed operator client for execution-orders.controller and exchange-accounts.controller (execution module).
//
// Both controllers are versioned at the controller level
// (`@Controller({ path: 'execution', version: '1' })`), so every path here is
// under `/v1/execution`. No route on either controller is step-up protected; the
// live-trading and enabled toggles are protected by a separate permission and,
// for live trading, by a typed confirmation phrase in the DTO.
import { apiClient } from '@/lib/api-client';

/* ------------------------------------------------------------------ models */

/** `GET execution/orders` rows. */
export interface ExecutionOrder {
  id: string;
  tenantId?: string;
  accountId: string;
  strategyId?: string | null;
  symbol: string;
  side: string;
  orderType: string;
  quantity: string;
  price?: string | null;
  stopPrice?: string | null;
  status: string;
  filledQuantity?: string | null;
  averageFillPrice?: string | null;
  venue?: string | null;
  venueOrderId?: string | null;
  reconciliationState?: string | null;
  createdAt: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/** `GET execution/orders/:id/events` rows. */
export interface ExecutionOrderEvent {
  id: string;
  orderId?: string;
  type: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  actor?: string | null;
  detail?: unknown;
  occurredAt: string;
  [key: string]: unknown;
}

/** `GET execution/orders/:id/fills` and `GET execution/fills` rows. */
export interface ExecutionFill {
  id: string;
  orderId?: string | null;
  accountId?: string | null;
  symbol: string;
  side: string;
  quantity: string;
  price: string;
  fee?: string | null;
  feeCurrency?: string | null;
  liquidity?: string | null;
  executedAt: string;
  [key: string]: unknown;
}

/** `GET execution/positions` rows. */
export interface ExecutionPosition {
  id?: string;
  accountId: string;
  symbol: string;
  side: string;
  quantity: string;
  entryPrice: string | null;
  markPrice: string | null;
  unrealizedPnl: string | null;
  liquidationPrice?: string | null;
  updatedAt?: string;
  [key: string]: unknown;
}

/** `GET execution/accounts` rows. Secrets and fingerprints are never returned by the API. */
export interface ExchangeAccount {
  id: string;
  tenantId?: string;
  userId?: string | null;
  venue: string;
  environment: string;
  label?: string | null;
  status: string;
  enabled: boolean;
  liveTradingEnabled: boolean;
  privateStreamEnabled?: boolean;
  permissionsVerifiedAt?: string | null;
  lastVerifiedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/** `GET execution/accounts/:id/connectivity`. */
export interface AccountConnectivity {
  accountId: string;
  reachable: boolean;
  latencyMs: number | null;
  checkedAt: string;
  reason?: string | null;
  [key: string]: unknown;
}

/** `GET execution/accounts/:id/balances` rows. Null means "not measured". */
export interface AccountBalance {
  asset: string;
  available: string | null;
  locked?: string | null;
  total?: string | null;
  observedAt?: string;
  [key: string]: unknown;
}

/** `GET execution/accounts/:id/stream-sessions` rows. */
export interface StreamSession {
  id: string;
  accountId: string;
  status: string;
  lastHeartbeatAt: string | null;
  expiresAt: string | null;
  [key: string]: unknown;
}

/** `GET execution/kill-switches` rows. */
export interface ExecutionKillSwitch {
  id: string;
  scope: string;
  target: string | null;
  isEngaged: boolean;
  status?: string;
  reason: string | null;
  engagedAt?: string | null;
  releasedAt?: string | null;
  updatedAt?: string;
  [key: string]: unknown;
}

/** `GET execution/reconciliation/runs` rows. A gap in this list is the signal. */
export interface ReconciliationRun {
  id: string;
  accountId?: string | null;
  status: string;
  startedAt?: string;
  completedAt?: string | null;
  ordersChecked?: number | null;
  discrepanciesFound?: number | null;
  trigger?: string;
  errorCode?: string | null;
  [key: string]: unknown;
}

/** `GET execution/reconciliation/discrepancies` rows. */
export interface ReconciliationDiscrepancy {
  id: string;
  runId?: string | null;
  accountId?: string | null;
  orderId?: string | null;
  discrepancyType: string;
  expected: Record<string, unknown> | null;
  actual: Record<string, unknown> | null;
  reviewed?: boolean;
  resolvedAt?: string | null;
  resolutionNote?: string | null;
  createdAt?: string;
  [key: string]: unknown;
}

export type ExecutionRows<T> = T[] | { data: T[]; total?: number; page?: number; limit?: number };

/** Normalises a bare array or a page envelope. */
export function executionRows<T>(payload: ExecutionRows<T> | null | undefined): { rows: T[]; total: number } {
  if (!payload) return { rows: [], total: 0 };
  if (Array.isArray(payload)) return { rows: payload, total: payload.length };
  return { rows: payload.data ?? [], total: payload.total ?? payload.data?.length ?? 0 };
}

/* ------------------------------------------------------------------ inputs */

export interface OrderListQuery {
  accountId?: string;
  strategyId?: string;
  symbol?: string;
  status?: string;
  reconciliationState?: string;
  unreconciledOnly?: boolean;
  from?: string;
  to?: string;
}

export interface FillListQuery {
  accountId?: string;
  symbol?: string;
}

export interface PositionListQuery {
  accountId?: string;
  symbol?: string;
  includeFlat?: boolean;
}

export interface KillSwitchInput {
  scope: 'GLOBAL' | 'EXCHANGE' | 'STRATEGY' | 'SYMBOL';
  target?: string;
  engaged: boolean;
  /** Required by `SetKillSwitchDto`, which extends `ReasonDto`. */
  reason: string;
}

export interface RunListQuery {
  accountId?: string;
  status?: string;
  page?: number;
  limit?: number;
}

export interface DiscrepancyListQuery {
  runId?: string;
  accountId?: string;
  orderId?: string;
  discrepancyType?: string;
  includeRepaired?: boolean;
  page?: number;
  limit?: number;
}

export interface AccountListQuery {
  userId?: string;
  venue?: string;
  environment?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

/**
 * Every mutation DTO on this controller extends `ReasonDto`, so a reason of at
 * least five characters is part of the contract - not an optional nicety. The
 * type says so, and the forms enforce it.
 */
export interface CancelExecutionOrderInput {
  reason: string;
}

export interface EnabledInput {
  enabled: boolean;
  reason: string;
}

export interface LiveTradingInput {
  enabled: boolean;
  reason: string;
  /** Required by the API when enabling; must be exactly `ENABLE LIVE TRADING`. */
  confirmation?: string;
}

/* ---------------------------------------------------------------- helpers */

const API_BASE = '/v1/execution';

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

export const executionOrdersAdminApi = {
  /* orders */
  listOrders: (query: OrderListQuery = {}) =>
    apiClient.get<ExecutionRows<ExecutionOrder>>(`${API_BASE}/orders`, { searchParams: params({ ...query }) }),
  getOrder: (id: string) => apiClient.get<ExecutionOrder>(`${API_BASE}/orders/${segment(id)}`),
  listOrderEvents: (id: string) => apiClient.get<ExecutionRows<ExecutionOrderEvent>>(`${API_BASE}/orders/${segment(id)}/events`),
  listOrderFills: (id: string) => apiClient.get<ExecutionRows<ExecutionFill>>(`${API_BASE}/orders/${segment(id)}/fills`),
  cancelOrder: (id: string, input: CancelExecutionOrderInput, idempotencyKey: string) =>
    apiClient.post<ExecutionOrder>(`${API_BASE}/orders/${segment(id)}/cancel`, input, { idempotencyKey }),

  /* fills and positions */
  listFills: (query: FillListQuery = {}) =>
    apiClient.get<ExecutionRows<ExecutionFill>>(`${API_BASE}/fills`, { searchParams: params({ ...query }) }),
  listPositions: (query: PositionListQuery = {}) =>
    apiClient.get<ExecutionRows<ExecutionPosition>>(`${API_BASE}/positions`, { searchParams: params({ ...query }) }),

  /* safety and reconciliation (execution-admin.controller) */
  listKillSwitches: () => apiClient.get<ExecutionKillSwitch[]>(`${API_BASE}/kill-switches`),
  setKillSwitch: (input: KillSwitchInput, idempotencyKey: string) =>
    apiClient.post<ExecutionKillSwitch>(`${API_BASE}/kill-switches`, input, { idempotencyKey }),

  listReconciliationRuns: (query: RunListQuery = {}) =>
    apiClient.get<ExecutionRows<ReconciliationRun>>(`${API_BASE}/reconciliation/runs`, { searchParams: params({ ...query }) }),
  getReconciliationRun: (id: string) =>
    apiClient.get<ReconciliationRun>(`${API_BASE}/reconciliation/runs/${segment(id)}`),
  listDiscrepancies: (query: DiscrepancyListQuery = {}) =>
    apiClient.get<ExecutionRows<ReconciliationDiscrepancy>>(`${API_BASE}/reconciliation/discrepancies`, { searchParams: params({ ...query }) }),
  /** Closes a discrepancy after review. It never edits the underlying order. */
  resolveDiscrepancy: (id: string, note: string, idempotencyKey: string) =>
    apiClient.post<ReconciliationDiscrepancy>(`${API_BASE}/reconciliation/discrepancies/${segment(id)}/resolve`, { note }, { idempotencyKey }),
  /** Queues an out-of-band pass. The API answers 202 with the accepted job. */
  reconcileAccount: (accountId: string, idempotencyKey: string) =>
    apiClient.post<{ jobId: string; acceptedAt?: string }>(`${API_BASE}/accounts/${segment(accountId)}/reconcile`, undefined, { idempotencyKey }),

  /* exchange accounts */
  listAccounts: (query: AccountListQuery = {}) =>
    apiClient.get<ExecutionRows<ExchangeAccount>>(`${API_BASE}/accounts`, { searchParams: params({ ...query }) }),
  getAccount: (id: string) => apiClient.get<ExchangeAccount>(`${API_BASE}/accounts/${segment(id)}`),
  getConnectivity: (id: string) => apiClient.get<AccountConnectivity>(`${API_BASE}/accounts/${segment(id)}/connectivity`),
  listBalances: (id: string, includeZero?: boolean) =>
    apiClient.get<ExecutionRows<AccountBalance>>(`${API_BASE}/accounts/${segment(id)}/balances`, { searchParams: params({ includeZero }) }),
  listStreamSessions: (id: string) =>
    apiClient.get<ExecutionRows<StreamSession>>(`${API_BASE}/accounts/${segment(id)}/stream-sessions`),
  verifyAccount: (id: string, idempotencyKey: string) =>
    apiClient.post<ExchangeAccount>(`${API_BASE}/accounts/${segment(id)}/verify`, undefined, { idempotencyKey }),
  refreshBalances: (id: string, idempotencyKey: string) =>
    apiClient.post<ExecutionRows<AccountBalance>>(`${API_BASE}/accounts/${segment(id)}/balances/refresh`, undefined, { idempotencyKey }),
  resyncStream: (id: string, idempotencyKey: string) =>
    apiClient.post<StreamSession>(`${API_BASE}/accounts/${segment(id)}/stream/resync`, undefined, { idempotencyKey }),
  setEnabled: (id: string, input: EnabledInput, idempotencyKey: string) =>
    apiClient.post<ExchangeAccount>(`${API_BASE}/accounts/${segment(id)}/enabled`, input, { idempotencyKey }),
  setLiveTrading: (id: string, input: LiveTradingInput, idempotencyKey: string) =>
    apiClient.post<ExchangeAccount>(`${API_BASE}/accounts/${segment(id)}/live-trading`, input, { idempotencyKey }),
  setPrivateStream: (id: string, input: EnabledInput, idempotencyKey: string) =>
    apiClient.post<ExchangeAccount>(`${API_BASE}/accounts/${segment(id)}/private-stream`, input, { idempotencyKey }),
};

/** The phrase the API's `SetLiveTradingDto` expects when enabling live trading. */
export const LIVE_TRADING_CONFIRMATION = 'ENABLE LIVE TRADING';
