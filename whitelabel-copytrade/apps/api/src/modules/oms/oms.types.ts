/**
 * Part 17 — Institutional OMS Canonical Types
 *
 * OMS is operational source for order lifecycle orchestration.
 * Actual exchange/execution state remains authoritative for real execution facts.
 * Every transition must be valid, auditable, Decimal-safe, idempotent, out-of-order safe.
 */

export enum OrderIntentState {
  CREATED = 'CREATED',
  VALIDATING = 'VALIDATING',
  APPROVED = 'APPROVED',
  SUBMITTED = 'SUBMITTED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  FILLED = 'FILLED',
  CANCEL_REQUESTED = 'CANCEL_REQUESTED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  REPLACED = 'REPLACED',
  FAILED = 'FAILED',
  RECONCILIATION_REQUIRED = 'RECONCILIATION_REQUIRED',
}

export enum OmsFillState {
  RECEIVED = 'RECEIVED',
  VALIDATED = 'VALIDATED',
  APPLIED = 'APPLIED',
  REJECTED = 'REJECTED',
  DUPLICATE = 'DUPLICATE',
}

export enum TradeState {
  OPEN = 'OPEN',
  PARTIAL = 'PARTIAL',
  CLOSED = 'CLOSED',
  RECONCILIATION_REQUIRED = 'RECONCILIATION_REQUIRED',
}

export enum ExecutionAckType {
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}

export enum RejectionCategory {
  RISK_BLOCK = 'RISK_BLOCK',
  COMPLIANCE_BLOCK = 'COMPLIANCE_BLOCK',
  SECURITY_BLOCK = 'SECURITY_BLOCK',
  INVALID_SYMBOL = 'INVALID_SYMBOL',
  INVALID_PRECISION = 'INVALID_PRECISION',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  INSUFFICIENT_MARGIN = 'INSUFFICIENT_MARGIN',
  EXCHANGE_REJECT = 'EXCHANGE_REJECT',
  RATE_LIMITED = 'RATE_LIMITED',
  MARKET_DATA_STALE = 'MARKET_DATA_STALE',
  LIVE_GATE_BLOCK = 'LIVE_GATE_BLOCK',
  CREDENTIAL_FAILURE = 'CREDENTIAL_FAILURE',
  UNKNOWN = 'UNKNOWN',
}

export enum ReconciliationCategory {
  MISSING_EXCHANGE_ORDER = 'MISSING_EXCHANGE_ORDER',
  MISSING_ACK = 'MISSING_ACK',
  DUPLICATE_PROVIDER_ORDER = 'DUPLICATE_PROVIDER_ORDER',
  PROVIDER_STATUS_MISMATCH = 'PROVIDER_STATUS_MISMATCH',
  STALE_ORDER = 'STALE_ORDER',
  IMPOSSIBLE_LIFECYCLE_TRANSITION = 'IMPOSSIBLE_LIFECYCLE_TRANSITION',
  ORDER_QUANTITY_MISMATCH = 'ORDER_QUANTITY_MISMATCH',
  TERMINAL_STATE_MISMATCH = 'TERMINAL_STATE_MISMATCH',
  MISSING_FILL = 'MISSING_FILL',
  DUPLICATE_FILL = 'DUPLICATE_FILL',
  QUANTITY_DRIFT = 'QUANTITY_DRIFT',
  PRICE_DRIFT = 'PRICE_DRIFT',
  FEE_MISMATCH = 'FEE_MISMATCH',
  ORPHAN_FILL = 'ORPHAN_FILL',
  POSITION_WITHOUT_FILLS = 'POSITION_WITHOUT_FILLS',
  FILLS_WITHOUT_POSITION = 'FILLS_WITHOUT_POSITION',
  POSITION_QUANTITY_MISMATCH = 'POSITION_QUANTITY_MISMATCH',
  SIDE_MISMATCH = 'SIDE_MISMATCH',
  LEVERAGE_MISMATCH = 'LEVERAGE_MISMATCH',
  STALE_POSITION = 'STALE_POSITION',
}

export enum OmsAuditEventType {
  ORDER_INTENT_CREATED = 'ORDER_INTENT_CREATED',
  ORDER_APPROVED = 'ORDER_APPROVED',
  ORDER_SUBMITTED = 'ORDER_SUBMITTED',
  ORDER_ACKNOWLEDGED = 'ORDER_ACKNOWLEDGED',
  ORDER_PARTIALLY_FILLED = 'ORDER_PARTIALLY_FILLED',
  ORDER_FILLED = 'ORDER_FILLED',
  ORDER_CANCEL_REQUESTED = 'ORDER_CANCEL_REQUESTED',
  ORDER_CANCELLED = 'ORDER_CANCELLED',
  ORDER_REPLACED = 'ORDER_REPLACED',
  ORDER_REJECTED = 'ORDER_REJECTED',
  FILL_RECEIVED = 'FILL_RECEIVED',
  FILL_APPLIED = 'FILL_APPLIED',
  TRADE_OPENED = 'TRADE_OPENED',
  TRADE_CLOSED = 'TRADE_CLOSED',
  RECONCILIATION_DETECTED = 'RECONCILIATION_DETECTED',
  RECOVERY_REQUESTED = 'RECOVERY_REQUESTED',
  EXECUTION_QUALITY_CALCULATED = 'EXECUTION_QUALITY_CALCULATED',
  OPERATOR_ACTION = 'OPERATOR_ACTION',
}

export interface OmsStateTransition {
  eventId: string;
  fromState: OrderIntentState | string;
  toState: OrderIntentState | string;
  timestamp: string; // ISO
  timestampMicros: string; // micros as string for precision
  source: string; // e.g. EXECUTION_ENGINE, PROVIDER, OMS, OPERATOR
  reason: string;
  correlationId: string | null;
  policyVersion: string | null;
  riskRuleId: string | null;
  actorId: string | null;
  actorType: string; // USER, SYSTEM, SERVICE
  metadata: Record<string, unknown> | null;
}

export interface OrderIntent {
  id: string;
  tenantId: string;
  accountId: string;
  strategyId: string | null;
  traderId: string | null;
  followerId: string | null;
  subscriptionId: string | null;
  symbol: string;
  venue: string | null;
  side: string; // BUY/SELL
  orderType: string; // MARKET/LIMIT/STOP/STOP_LIMIT
  timeInForce: string | null;
  quantity: string; // Decimal string
  price: string | null;
  stopPrice: string | null;
  reduceOnly: boolean;
  environment: string; // PAPER/LIVE
  state: OrderIntentState;
  clientOrderId: string;
  exchangeOrderId: string | null;
  providerOrderId: string | null;
  signalId: string | null;
  riskDecisionId: string | null;
  complianceDecisionId: string | null;
  riskPolicyVersion: string | null;
  compliancePolicyVersion: string | null;
  rejectionCategory: RejectionCategory | null;
  rejectionReason: string | null;
  executionLatency: Record<string, string> | null;
  filledQuantity: string;
  averageFillPrice: string | null;
  cumulativeFee: string;
  feeCurrency: string | null;
  correlationId: string | null;
  requestId: string | null;
  source: string; // STRATEGY, COPY_TRADING, MANUAL, RESEARCH_PROMOTION
  metadata: Record<string, unknown> | null;
  transitions: OmsStateTransition[];
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  acknowledgedAt: string | null;
  terminalAt: string | null;
  isSimulated: boolean;
  wasDryRun: boolean;
}

export interface ExecutionAck {
  id: string;
  tenantId: string;
  orderIntentId: string;
  internalOrderId: string | null;
  clientOrderId: string;
  providerOrderId: string | null;
  exchangeOrderId: string | null;
  venue: string;
  ackType: ExecutionAckType;
  timestamp: string;
  timestampMicros: string;
  latencyMicros: string | null;
  providerErrorCode: string | null;
  providerErrorMessage: string | null;
  rawAckRef: string | null; // reference to execution engine event, not raw body
  correlationId: string | null;
  source: string;
}

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
  liquidity: string | null; // MAKER/TAKER
  state: OmsFillState;
  timestamp: string;
  timestampMicros: string;
  exchangeTimestampMicros: string | null;
  receivedTimestampMicros: string;
  cumulativeQuantity: string | null;
  averagePrice: string | null;
  correlationId: string | null;
  source: string; // PRIVATE_STREAM, ORDER_RESPONSE, RECONCILIATION, SIMULATOR
  isSimulated: boolean;
  metadata: Record<string, unknown> | null;
}

export interface TradeLifecycle {
  id: string;
  tenantId: string;
  accountId: string;
  symbol: string;
  venue: string | null;
  strategyId: string | null;
  traderId: string | null;
  followerId: string | null;
  state: TradeState;
  side: string; // LONG/SHORT
  openQuantity: string;
  closedQuantity: string;
  remainingQuantity: string;
  averageEntryPrice: string | null;
  averageExitPrice: string | null;
  realizedPnlRef: string | null; // reference, not calculated here
  feeRef: string;
  totalFee: string;
  orderIds: string[];
  fillIds: string[];
  positionRef: string | null;
  openedAt: string | null;
  closedAt: string | null;
  durationMs: string | null;
  correlationId: string | null;
  isSimulated: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface AllocationRecord {
  id: string;
  tenantId: string;
  strategyId: string | null;
  traderId: string | null;
  followerId: string | null;
  subscriptionId: string | null;
  accountId: string;
  orderIntentId: string | null;
  symbol: string;
  side: string;
  intendedQuantity: string;
  intendedNotional: string | null;
  executedQuantity: string;
  executedNotional: string | null;
  remainingQuantity: string;
  remainingNotional: string | null;
  allocationMode: string | null;
  correlationId: string | null;
  timestamp: string;
}

export interface ExecutionQualityMetrics {
  id: string;
  tenantId: string;
  accountId: string | null;
  symbol: string | null;
  venue: string | null;
  strategyId: string | null;
  traderId: string | null;
  periodStart: string;
  periodEnd: string;
  totalOrders: number;
  filledOrders: number;
  partiallyFilledOrders: number;
  cancelledOrders: number;
  rejectedOrders: number;
  fillRatio: string | null; // Decimal string
  rejectionRate: string | null;
  completionRate: string | null;
  averageSlippage: string | null;
  medianSlippage: string | null;
  p95Slippage: string | null;
  implementationShortfall: string | null;
  priceImprovement: string | null;
  averageFillLatencyMs: string | null;
  medianFillLatencyMs: string | null;
  p95FillLatencyMs: string | null;
  feeImpact: string | null;
  totalFees: string | null;
  benchmarkMethod: string;
  observationCount: number;
  note: string; // ACTUAL_EXECUTION_METRIC, not estimate
  calculatedAt: string;
  metadata: Record<string, unknown> | null;
}

export interface ExecutionLatencyMetrics {
  id: string;
  tenantId: string;
  orderIntentId: string;
  signalTimestamp: string | null;
  intentTimestamp: string;
  submitTimestamp: string | null;
  ackTimestamp: string | null;
  firstFillTimestamp: string | null;
  completeFillTimestamp: string | null;
  signalToIntentMs: string | null;
  intentToSubmitMs: string | null;
  submitToAckMs: string | null;
  ackToFirstFillMs: string | null;
  firstFillToCompleteMs: string | null;
  totalLatencyMs: string | null;
  clockSkewDetected: boolean;
  missingTimestamps: string[];
  calculatedAt: string;
}

export interface VenueExecutionScore {
  id: string;
  tenantId: string;
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
  scoreComponents: Record<string, string | null>;
  note: string;
  calculatedAt: string;
}

export interface OrderRejectionRecord {
  id: string;
  tenantId: string;
  orderIntentId: string;
  category: RejectionCategory;
  reason: string;
  providerCode: string | null;
  providerMessage: string | null;
  riskRuleId: string | null;
  complianceRuleId: string | null;
  venue: string | null;
  symbol: string | null;
  accountId: string | null;
  strategyId: string | null;
  timestamp: string;
  correlationId: string | null;
  isRetriable: boolean;
  metadata: Record<string, unknown> | null;
}

export interface ReconciliationFinding {
  id: string;
  tenantId: string;
  orderIntentId: string | null;
  internalOrderId: string | null;
  providerOrderId: string | null;
  providerFillId: string | null;
  category: ReconciliationCategory;
  severity: string;
  expected: Record<string, string | null> | null;
  actual: Record<string, string | null> | null;
  summary: string;
  resolved: boolean;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  correlationId: string | null;
  timestamp: string;
}

export interface PostTradeResult {
  id: string;
  tenantId: string;
  orderIntentId: string;
  tradeId: string | null;
  accountId: string;
  symbol: string;
  venue: string | null;
  totalFilledQuantity: string;
  averageFillPrice: string | null;
  totalFees: string;
  feeCurrency: string | null;
  settlementRef: string | null;
  feeAccrualRef: string | null;
  usageEventRef: string | null;
  notificationRef: string | null;
  tradeLifecycleRef: string | null;
  reconciliationTriggered: boolean;
  completedAt: string;
  metadata: Record<string, unknown> | null;
}

export interface OmsOperationalRecord {
  id: string;
  tenantId: string;
  type: string; // STALE_ORDER, RECONCILIATION_QUEUE, REJECTED_ORDER, EXCEPTION
  state: string; // PENDING, ACKNOWLEDGED, RETRY_REQUESTED, RECOVERY_REQUESTED, RESOLVED
  orderIntentId: string | null;
  internalOrderId: string | null;
  symbol: string | null;
  venue: string | null;
  accountId: string | null;
  summary: string;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  retryCount: number;
  lastRetryAt: string | null;
  operatorNotes: string[];
  correlationId: string | null;
  createdAt: string;
  updatedAt: string;
}

// Decimal-safe helpers (same pattern as risk-management)
export const OMS_SCALE = 1_000_000_000_000n; // 1e12

export function isValidDecimal(v: unknown): boolean {
  return typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v);
}

export function parseScaled(s: string): bigint {
  if (!isValidDecimal(s)) throw new Error(`Invalid decimal: ${s}`);
  const neg = s.startsWith('-');
  const clean = neg ? s.slice(1) : s;
  const [intP = '0', fracP = ''] = clean.split('.');
  const frac = (fracP + '0'.repeat(12)).slice(0, 12);
  const val = BigInt(intP) * OMS_SCALE + BigInt(frac || '0');
  return neg ? -val : val;
}

export function formatScaled(b: bigint): string {
  const neg = b < 0n;
  const abs = neg ? -b : b;
  const intP = abs / OMS_SCALE;
  const frac = abs % OMS_SCALE;
  const fracStr = frac.toString().padStart(12, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + (fracStr ? `${intP}.${fracStr}` : `${intP}`);
}

export function add(a: string, b: string): string {
  return formatScaled(parseScaled(a) + parseScaled(b));
}

export function sub(a: string, b: string): string {
  return formatScaled(parseScaled(a) - parseScaled(b));
}

export function mul(a: string, b: string): string {
  return formatScaled((parseScaled(a) * parseScaled(b)) / OMS_SCALE);
}

export function div(a: string, b: string): string {
  const bv = parseScaled(b);
  if (bv === 0n) throw new Error('Division by zero');
  return formatScaled((parseScaled(a) * OMS_SCALE) / bv);
}

export function cmp(a: string, b: string): number {
  const av = parseScaled(a);
  const bv = parseScaled(b);
  return av === bv ? 0 : av > bv ? 1 : -1;
}

export function abs(a: string): string {
  return a.startsWith('-') ? a.slice(1) : a;
}

export function isZero(a: string): boolean {
  return parseScaled(a) === 0n;
}

export function min(a: string, b: string): string {
  return cmp(a, b) <= 0 ? a : b;
}

export function max(a: string, b: string): string {
  return cmp(a, b) >= 0 ? a : b;
}

export const VALID_TRANSITIONS: Record<string, string[]> = {
  [OrderIntentState.CREATED]: [OrderIntentState.VALIDATING, OrderIntentState.REJECTED, OrderIntentState.FAILED],
  [OrderIntentState.VALIDATING]: [OrderIntentState.APPROVED, OrderIntentState.REJECTED, OrderIntentState.FAILED],
  [OrderIntentState.APPROVED]: [OrderIntentState.SUBMITTED, OrderIntentState.REJECTED, OrderIntentState.FAILED, OrderIntentState.EXPIRED],
  [OrderIntentState.SUBMITTED]: [OrderIntentState.ACKNOWLEDGED, OrderIntentState.REJECTED, OrderIntentState.FAILED, OrderIntentState.CANCEL_REQUESTED, OrderIntentState.EXPIRED],
  [OrderIntentState.ACKNOWLEDGED]: [OrderIntentState.PARTIALLY_FILLED, OrderIntentState.FILLED, OrderIntentState.CANCEL_REQUESTED, OrderIntentState.REJECTED, OrderIntentState.FAILED, OrderIntentState.EXPIRED],
  [OrderIntentState.PARTIALLY_FILLED]: [OrderIntentState.FILLED, OrderIntentState.CANCEL_REQUESTED, OrderIntentState.REJECTED, OrderIntentState.FAILED],
  [OrderIntentState.FILLED]: [], // terminal
  [OrderIntentState.CANCEL_REQUESTED]: [OrderIntentState.CANCELLED, OrderIntentState.PARTIALLY_FILLED, OrderIntentState.FILLED, OrderIntentState.FAILED, OrderIntentState.RECONCILIATION_REQUIRED],
  [OrderIntentState.CANCELLED]: [], // terminal
  [OrderIntentState.REJECTED]: [], // terminal
  [OrderIntentState.EXPIRED]: [], // terminal
  [OrderIntentState.REPLACED]: [], // terminal (new intent created)
  [OrderIntentState.FAILED]: [OrderIntentState.RECONCILIATION_REQUIRED],
  [OrderIntentState.RECONCILIATION_REQUIRED]: [OrderIntentState.VALIDATING, OrderIntentState.CANCELLED, OrderIntentState.FILLED, OrderIntentState.REJECTED, OrderIntentState.FAILED],
};

export const TERMINAL_STATES = new Set<string>([
  OrderIntentState.FILLED,
  OrderIntentState.CANCELLED,
  OrderIntentState.REJECTED,
  OrderIntentState.EXPIRED,
  OrderIntentState.REPLACED,
]);

export function isTerminalState(state: string): boolean {
  return TERMINAL_STATES.has(state);
}

export function isValidTransition(from: string, to: string): boolean {
  if (from === to) return true; // idempotent same-state
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}
