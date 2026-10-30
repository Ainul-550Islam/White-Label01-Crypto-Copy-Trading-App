// # Responsibility: typed admin client for oms.controller and oms-recovery-admin.controller - one function per route.
//
// Paths, verbs and body keys are copied from the two controllers at this
// commit. Quantities, prices and fees stay decimal strings in both directions;
// nothing here calls Number() on money.
//
// Step-up: `POST admin/oms/orders/:orderId/recover` is decorated
// `@RequireStepUp('ORDER_RECOVERY')`. The caller mints a proof with
// `requestRecoveryProof` immediately before it and passes the proof id, because
// the API consumes the proof on that one request.
import { assertStepUpProof } from './step-up-proof';
import { apiClient } from '@/lib/api-client';

/* ------------------------------------------------------------------ models */

export type OrderIntentState = string;

/** `GET oms/orders`, `oms/intents` rows. Mirrors `OrderIntent` in oms.types.ts. */
export interface OmsOrderIntent {
  id: string;
  tenantId: string;
  accountId: string;
  strategyId: string | null;
  traderId: string | null;
  followerId: string | null;
  subscriptionId: string | null;
  symbol: string;
  venue: string | null;
  side: string;
  orderType: string;
  timeInForce: string | null;
  quantity: string;
  price: string | null;
  stopPrice: string | null;
  reduceOnly: boolean;
  environment: string;
  state: OrderIntentState;
  clientOrderId: string;
  exchangeOrderId: string | null;
  providerOrderId: string | null;
  signalId: string | null;
  riskDecisionId: string | null;
  complianceDecisionId: string | null;
  rejectionCategory: string | null;
  rejectionReason: string | null;
  filledQuantity: string;
  averageFillPrice: string | null;
  cumulativeFee: string;
  feeCurrency: string | null;
  correlationId: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  acknowledgedAt: string | null;
  terminalAt: string | null;
  isSimulated: boolean;
}

export interface OmsStateTransition {
  state: string;
  at?: string;
  timestamp?: string;
  actor?: string;
  reason?: string;
  venueOrderId?: string | null;
}

/** `GET oms/intents/:id/lifecycle`. */
export interface OmsLifecycle {
  intentId: string;
  currentState: string;
  transitions: OmsStateTransition[];
}

/** `GET oms/fills` rows. */
export interface OmsFill {
  id: string;
  tenantId: string;
  orderIntentId: string;
  internalOrderId: string | null;
  providerFillId: string;
  providerOrderId: string | null;
  exchangeOrderId: string | null;
  symbol: string;
  venue: string | null;
  side: string;
  quantity: string;
  price: string;
  fee: string;
  feeCurrency: string;
  quoteQuantity: string | null;
  liquidity: string | null;
  state: string;
  timestamp: string;
  correlationId: string | null;
  source: string;
  isSimulated: boolean;
  metadata: Record<string, unknown> | null;
}

/** `GET oms/trades` rows. */
export interface OmsTrade {
  id: string;
  tenantId: string;
  orderIntentId: string | null;
  accountId: string;
  symbol: string;
  venue: string | null;
  state: string;
  totalFilledQuantity: string;
  averageFillPrice: string | null;
  totalFees: string;
  feeCurrency: string | null;
  openedAt: string;
  closedAt: string | null;
  realizedPnl: string | null;
  [key: string]: unknown;
}

/** `GET oms/execution-quality`. */
export interface ExecutionQuality {
  accountId?: string | null;
  symbol?: string | null;
  venue?: string | null;
  totalOrders: number;
  filledOrders: number;
  rejectedOrders: number;
  averageLatencyMs: string | null;
  medianLatencyMs: string | null;
  p95LatencyMs: string | null;
  fillRatio: string | null;
  rejectionRate: string | null;
  averageSlippage: string | null;
  methodology?: string;
  observationCount?: number;
  note?: string;
  [key: string]: unknown;
}

/** `GET oms/venue-scores` rows (mirrors `VenueExecutionScore`). */
export interface VenueExecutionScore {
  venue: string;
  periodStart: string;
  periodEnd: string;
  totalOrders: number;
  filledOrders: number;
  rejectedOrders: number;
  averageLatencyMs: string | null;
  medianLatencyMs: string | null;
  p95LatencyMs: string | null;
  fillRatio: string | null;
  rejectionRate: string | null;
  averageSlippage: string | null;
  providerErrorCount: number;
  rateLimitCount: number;
  staleDataCount: number;
  methodology: string;
  observationCount: number;
  note: string;
  calculatedAt: string;
}

/** `GET oms/intents/:id/latency`. */
export interface ExecutionLatency {
  intentId: string;
  stages: Array<{ stage: string; millis: string | null }>;
  totalMillis: string | null;
  note?: string;
  [key: string]: unknown;
}

/** `GET oms/rejections` rows. */
export interface OrderRejection {
  id: string;
  orderIntentId: string;
  category: string;
  reason: string;
  providerCode: string | null;
  providerMessage: string | null;
  venue: string | null;
  symbol: string | null;
  accountId: string | null;
  timestamp: string;
  isRetriable: boolean;
}

/** `GET oms/rejections/stats`. */
export interface RejectionStats {
  from: string;
  to: string;
  total: number;
  byCategory: Array<{ category: string; count: number }>;
  [key: string]: unknown;
}

/** `GET oms/reconciliation/*` results. Nulls mean "not compared", never "matched". */
export interface ReconciliationResult {
  matched: boolean | null;
  findings: ReconciliationFinding[];
  checked: number;
  note?: string;
  [key: string]: unknown;
}

export interface ReconciliationFinding {
  id: string;
  orderIntentId: string | null;
  internalOrderId: string | null;
  providerOrderId: string | null;
  providerFillId: string | null;
  category: string;
  severity: string;
  expected: Record<string, string | null> | null;
  actual: Record<string, string | null> | null;
  summary: string;
  resolved: boolean;
  resolvedAt: string | null;
  resolutionNote: string | null;
  timestamp: string;
}

/** An operational record: stale order, rejected order, exception or queue entry. */
export interface OmsOperationalRecord {
  id: string;
  type: string;
  orderIntentId?: string | null;
  accountId?: string | null;
  symbol?: string | null;
  state?: string | null;
  summary?: string | null;
  createdAt?: string;
  acknowledgedAt?: string | null;
  note?: string | null;
  [key: string]: unknown;
}

/** `GET oms/allocations` rows. */
export interface OmsAllocation {
  id: string;
  orderIntentId?: string | null;
  tradeId?: string | null;
  accountId?: string | null;
  strategyId?: string | null;
  traderId?: string | null;
  followerId?: string | null;
  symbol?: string | null;
  quantity: string;
  price?: string | null;
  notional?: string | null;
  fee?: string | null;
  createdAt?: string;
  [key: string]: unknown;
}

/** `GET oms/allocations/summary`. */
export interface AllocationSummary {
  totalAllocations: number;
  totalNotional: string | null;
  bySymbol: Array<{ symbol: string; count: number; notional: string | null }>;
  [key: string]: unknown;
}

/** `GET oms/audit/:intentId` and `oms/audit`. */
export interface OmsAuditEntry {
  id: string;
  intentId?: string | null;
  eventType: string;
  actor?: string | null;
  detail?: unknown;
  createdAt: string;
  [key: string]: unknown;
}

/** `POST oms/post-trade/:intentId`. */
export interface PostTradeResult {
  orderIntentId: string;
  totalFilledQuantity: string;
  averageFillPrice: string | null;
  totalFees: string;
  feeCurrency: string | null;
  reconciliationTriggered: boolean;
  completedAt: string;
  [key: string]: unknown;
}

/** `GET admin/oms/orders/:orderId/timeline`. */
export interface OrderTimeline {
  orderId: string;
  symbol: string;
  side: string;
  quantity: string;
  state: string;
  entries: Array<{ state: string; at: string; actor: string; reason: string; venueOrderId: string | null }>;
}

/** A list route that returns a bare array rather than a page envelope. */
export type OmsRows<T> = T[] | { data: T[]; total?: number; page?: number; limit?: number };

/* ------------------------------------------------------------------ inputs */

export interface OrderQuery {
  accountId?: string;
  strategyId?: string;
  traderId?: string;
  followerId?: string;
  subscriptionId?: string;
  symbol?: string;
  venue?: string;
  state?: string;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface PagedQuery {
  accountId?: string;
  symbol?: string;
  venue?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface FillQuery extends PagedQuery {
  orderIntentId?: string;
}

export interface TradeQuery extends PagedQuery {
  strategyId?: string;
  state?: string;
}

export interface RejectionQuery extends PagedQuery {
  category?: string;
}

export interface ReconciliationQuery extends PagedQuery {
  category?: string;
  state?: string;
}

export interface QualityQuery {
  accountId?: string;
  symbol?: string;
  venue?: string;
  strategyId?: string;
  traderId?: string;
  from?: string;
  to?: string;
}

export interface AuditQuery extends PagedQuery {
  eventType?: string;
}

export interface CreateOrderIntentInput {
  accountId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';
  quantity: string;
  environment: 'PAPER' | 'LIVE';
  price?: string;
  stopPrice?: string;
  timeInForce?: string;
  reduceOnly?: boolean;
  strategyId?: string;
  traderId?: string;
  followerId?: string;
  subscriptionId?: string;
  signalId?: string;
  venue?: string;
  source?: string;
  correlationId?: string;
  requestId?: string;
}

export interface CancelOrderInput {
  intentId: string;
  reason: string;
  correlationId?: string;
}

export interface ReplaceOrderInput {
  intentId: string;
  reason: string;
  newQuantity?: string;
  newPrice?: string;
  newStopPrice?: string;
  correlationId?: string;
  requestId?: string;
}

export interface RetryOrderInput {
  intentId: string;
  reason: string;
}

export interface RecoveryOrderInput {
  intentId: string;
  recoveryType: string;
  reason: string;
  correlationId?: string;
}

export interface AcknowledgeExceptionInput {
  operationalId: string;
  note: string;
}

export interface OperatorNoteInput {
  operationalId: string;
  note: string;
}

export interface AcknowledgeReconciliationInput {
  reconciliationId: string;
  resolutionNote: string;
  resolution?: string;
}

export interface RecoveryInput {
  targetState: string;
  reason: string;
}

/* ---------------------------------------------------------------- helpers */

const API_BASE = '/v1/oms';

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

/** Normalises a bare array or a page envelope into rows plus a total. */
export function toRows<T>(payload: OmsRows<T> | null | undefined): { rows: T[]; total: number } {
  if (!payload) return { rows: [], total: 0 };
  if (Array.isArray(payload)) return { rows: payload, total: payload.length };
  return { rows: payload.data ?? [], total: payload.total ?? payload.data?.length ?? 0 };
}

/* ------------------------------------------------------------------ client */

export const omsAdminApi = {
  /* order intents */
  createIntent: (input: CreateOrderIntentInput, idempotencyKey: string) =>
    apiClient.post<OmsOrderIntent>(`${API_BASE}/intents`, input, { idempotencyKey }),

  routeIntent: (id: string, idempotencyKey: string) =>
    apiClient.post<OmsOrderIntent>(`${API_BASE}/intents/${segment(id)}/route`, undefined, { idempotencyKey }),

  listIntents: (query: OrderQuery = {}) =>
    apiClient.get<OmsRows<OmsOrderIntent>>(`${API_BASE}/intents`, { searchParams: params({ ...query }) }),

  getIntent: (id: string) => apiClient.get<OmsOrderIntent>(`${API_BASE}/intents/${segment(id)}`),

  getLifecycle: (id: string) => apiClient.get<OmsLifecycle>(`${API_BASE}/intents/${segment(id)}/lifecycle`),

  getFillsForIntent: (id: string) => apiClient.get<OmsRows<OmsFill>>(`${API_BASE}/intents/${segment(id)}/fills`),

  getLatency: (id: string) => apiClient.get<ExecutionLatency>(`${API_BASE}/intents/${segment(id)}/latency`),

  /* order operations */
  cancelOrder: (input: CancelOrderInput, idempotencyKey: string) =>
    apiClient.post<OmsOrderIntent>(`${API_BASE}/orders/cancel`, input, { idempotencyKey }),

  replaceOrder: (input: ReplaceOrderInput, idempotencyKey: string) =>
    apiClient.post<OmsOrderIntent>(`${API_BASE}/orders/replace`, input, { idempotencyKey }),

  searchOrders: (query: OrderQuery = {}) =>
    apiClient.get<OmsRows<OmsOrderIntent>>(`${API_BASE}/orders`, { searchParams: params({ ...query }) }),

  /* fills and trades */
  listFills: (query: FillQuery = {}) => apiClient.get<OmsRows<OmsFill>>(`${API_BASE}/fills`, { searchParams: params({ ...query }) }),
  listTrades: (query: TradeQuery = {}) => apiClient.get<OmsRows<OmsTrade>>(`${API_BASE}/trades`, { searchParams: params({ ...query }) }),
  getTrade: (id: string) => apiClient.get<OmsTrade>(`${API_BASE}/trades/${segment(id)}`),

  /* execution quality */
  getExecutionQuality: (query: QualityQuery = {}) =>
    apiClient.get<ExecutionQuality>(`${API_BASE}/execution-quality`, { searchParams: params({ ...query }) }),
  getVenueScores: (query: QualityQuery = {}) =>
    apiClient.get<OmsRows<VenueExecutionScore>>(`${API_BASE}/venue-scores`, { searchParams: params({ ...query }) }),

  /* rejections */
  getRejections: (query: RejectionQuery = {}) =>
    apiClient.get<OmsRows<OrderRejection>>(`${API_BASE}/rejections`, { searchParams: params({ ...query }) }),
  getRejectionStats: (from: string, to: string) =>
    apiClient.get<RejectionStats>(`${API_BASE}/rejections/stats`, { searchParams: params({ from, to }) }),

  /* reconciliation */
  reconcileOrder: (id: string) => apiClient.get<ReconciliationResult>(`${API_BASE}/reconciliation/orders/${segment(id)}`),
  reconcileOrders: (input: { accountId?: string; limit?: number }, idempotencyKey: string) =>
    apiClient.post<ReconciliationResult>(`${API_BASE}/reconciliation/orders`, input, { idempotencyKey }),
  reconcileFills: (orderId: string, intentId: string) =>
    apiClient.get<ReconciliationResult>(`${API_BASE}/reconciliation/fills/${segment(orderId)}`, { searchParams: params({ intentId }) }),
  reconcilePosition: (accountId: string, symbol: string) =>
    apiClient.get<ReconciliationResult>(`${API_BASE}/reconciliation/positions/${segment(accountId)}/${segment(symbol)}`),
  reconcileAccountPositions: (accountId: string) =>
    apiClient.get<ReconciliationResult>(`${API_BASE}/reconciliation/positions/${segment(accountId)}`),
  getReconQueue: (query: ReconciliationQuery = {}) =>
    apiClient.get<OmsRows<ReconciliationFinding>>(`${API_BASE}/reconciliation/queue`, { searchParams: params({ ...query }) }),
  acknowledgeReconciliation: (input: AcknowledgeReconciliationInput, idempotencyKey: string) =>
    apiClient.post<ReconciliationFinding>(`${API_BASE}/reconciliation/acknowledge`, input, { idempotencyKey }),

  /* operations */
  getStaleOrders: (accountId: string) =>
    apiClient.get<OmsRows<OmsOperationalRecord>>(`${API_BASE}/operational/stale-orders`, { searchParams: params({ accountId }) }),
  getRejectedOperational: (accountId: string) =>
    apiClient.get<OmsRows<OmsOperationalRecord>>(`${API_BASE}/operational/rejected-orders`, { searchParams: params({ accountId }) }),
  requestRetry: (input: RetryOrderInput, idempotencyKey: string) =>
    apiClient.post<OmsOperationalRecord>(`${API_BASE}/operational/retry`, input, { idempotencyKey }),
  requestRecovery: (input: RecoveryOrderInput, idempotencyKey: string) =>
    apiClient.post<OmsOperationalRecord>(`${API_BASE}/operational/recovery`, input, { idempotencyKey }),
  acknowledgeException: (input: AcknowledgeExceptionInput, idempotencyKey: string) =>
    apiClient.post<OmsOperationalRecord>(`${API_BASE}/operational/acknowledge-exception`, input, { idempotencyKey }),
  addOperatorNote: (input: OperatorNoteInput, idempotencyKey: string) =>
    apiClient.post<OmsOperationalRecord>(`${API_BASE}/operational/note`, input, { idempotencyKey }),

  /* allocations */
  getAllocations: (query: { accountId?: string; strategyId?: string; traderId?: string; followerId?: string; symbol?: string } = {}) =>
    apiClient.get<OmsRows<OmsAllocation>>(`${API_BASE}/allocations`, { searchParams: params({ ...query }) }),
  getAllocationSummary: (query: { strategyId?: string; traderId?: string; followerId?: string } = {}) =>
    apiClient.get<AllocationSummary>(`${API_BASE}/allocations/summary`, { searchParams: params({ ...query }) }),

  /* post-trade and audit */
  processPostTrade: (intentId: string, idempotencyKey: string) =>
    apiClient.post<PostTradeResult>(`${API_BASE}/post-trade/${segment(intentId)}`, undefined, { idempotencyKey }),
  getAuditForIntent: (intentId: string) =>
    apiClient.get<OmsRows<OmsAuditEntry>>(`${API_BASE}/audit/${segment(intentId)}`),
  getAuditHistory: (query: AuditQuery = {}) =>
    apiClient.get<OmsRows<OmsAuditEntry>>(`${API_BASE}/audit`, { searchParams: params({ ...query }) }),

  /* recovery console (admin/oms/orders) */
  getOrderTimeline: (orderId: string) =>
    apiClient.get<OrderTimeline>(`/v1/admin/oms/orders/${segment(orderId)}/timeline`),

  /**
   * Recovers an order to a target state. The API requires a single-use
   * `ORDER_RECOVERY` proof for this call, so the operator verifies immediately
   * before it - a proof minted when the page loaded has already expired.
   */
  recoverOrder: (orderId: string, input: RecoveryInput, idempotencyKey: string) =>
    apiClient.post<OrderTimeline>(`/v1/admin/oms/orders/${segment(orderId)}/recover`, input, { idempotencyKey }),

  requestRecoveryProof: async (method: 'TOTP' | 'PASSWORD' | 'RECOVERY_CODE', value: string, idempotencyKey: string) => {
    const payload =
      method === 'TOTP'
        ? { action: 'ORDER_RECOVERY' as const, method, code: value }
        : method === 'PASSWORD'
          ? { action: 'ORDER_RECOVERY' as const, method, password: value }
          : { action: 'ORDER_RECOVERY' as const, method, recoveryCode: value };
    const proof = await apiClient.post<unknown>('/v1/auth/step-up/verify', payload, { idempotencyKey });
    assertStepUpProof(proof, 'ORDER_RECOVERY', method);
  },
};
