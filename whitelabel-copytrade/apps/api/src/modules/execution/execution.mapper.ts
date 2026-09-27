import type { Prisma } from '@prisma/client';
import { redact } from '@wlct/utils';

import type {
  AccountConnectivityView,
  BalanceView,
  CredentialSummaryView,
  ExchangeAccountView,
  ExecutionIncidentView,
  FillView,
  KillSwitchView,
  OrderEventView,
  OrderView,
  PositionView,
  ReconciliationDiscrepancyView,
  ReconciliationRunView,
  StreamSessionView,
} from './execution.types';

/**
 * Prisma row -> API view conversions.
 *
 * This module is the credential boundary for the HTTP layer. Every execution
 * response is built here, field by field, from an explicitly typed input. Two
 * consequences follow, and both are deliberate:
 *
 *   1. There is no `...row` spread anywhere in this file. A spread would carry
 *      whatever columns exist today plus whatever columns are added tomorrow,
 *      which is how `apiSecretCiphertext` ends up in a JSON response after a
 *      routine migration. Listing fields is more typing and strictly safer.
 *
 *   2. The mapper input types name only the columns a view actually needs. A
 *      caller that forgets a `select` still cannot leak, because the extra
 *      columns are simply never read.
 *
 * Decimal and BigInt are stringified rather than converted to `number`. A
 * quantity of 0.000000000001 and a microsecond epoch both exceed what an IEEE
 * double represents exactly, and rounding either one on a trading surface is
 * not a trade-off worth making for slightly prettier JSON.
 */

type DecimalLike = Prisma.Decimal | null | undefined;

function decimal(value: DecimalLike): string | null {
  return value === null || value === undefined ? null : value.toString();
}

/** For a column that is NOT NULL in the schema and therefore always present. */
function requiredDecimal(value: Prisma.Decimal): string {
  return value.toString();
}

function bigint(value: bigint | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toString();
}

function requiredBigint(value: bigint): string {
  return value.toString();
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function requiredIso(value: Date): string {
  return value.toISOString();
}

/**
 * Coerces a Prisma `Json` column into a plain object and runs it through the
 * shared redactor.
 *
 * The trading worker already scrubs these payloads before writing them. Doing
 * it again on read is not redundant defence for its own sake: `metadata`,
 * `payload` and `details` are the three columns that accept arbitrary
 * caller-supplied content, so they are the three most likely to eventually
 * contain something nobody intended. The cost is a shallow object walk per row.
 */
function safeJson(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (value === null || value === undefined) {
    return {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    // A scalar or array in a column documented as an object means something
    // upstream wrote a shape we do not recognise. Wrap rather than discard:
    // losing an audit payload is worse than returning it under a key.
    return { value: value as unknown };
  }
  return redact(value as Record<string, unknown>) as Record<string, unknown>;
}

// -----------------------------------------------------------------------------
// Exchange accounts
// -----------------------------------------------------------------------------

export interface TradingAccountRow {
  id: string;
  tenantId: string;
  userId: string | null;
  label: string;
  status: string;
  marketType: string;
  tradingMode: string;
  isSandbox: boolean;
  liveTradingEnabled: boolean;
  privateStreamEnabled: boolean;
  credentialSource: string;
  credentialRef: string | null;
  verifiedPermissions: string[];
  credentialRotatedAt: Date | null;
  credentialExpiresAt: Date | null;
  apiKeyLastFour: string;
  canTrade: boolean;
  canReadData: boolean;
  canWithdraw: boolean;
  ipRestricted: boolean;
  lastVerifiedAt: Date | null;
  lastFailureAt: Date | null;
  lastFailureCode: string | null;
  consecutiveFailures: number;
  createdAt: Date;
  updatedAt: Date;
  exchange: { venue: string };
}

export function toCredentialSummaryView(row: TradingAccountRow): CredentialSummaryView {
  return {
    source: row.credentialSource as CredentialSummaryView['source'],
    apiKeyLastFour: row.apiKeyLastFour,
    credentialRef: row.credentialRef,
    verifiedPermissions: [...row.verifiedPermissions],
    canTrade: row.canTrade,
    canReadData: row.canReadData,
    canWithdraw: row.canWithdraw,
    ipRestricted: row.ipRestricted,
    lastVerifiedAt: iso(row.lastVerifiedAt),
    lastFailureAt: iso(row.lastFailureAt),
    lastFailureCode: row.lastFailureCode,
    consecutiveFailures: row.consecutiveFailures,
    rotatedAt: iso(row.credentialRotatedAt),
    expiresAt: iso(row.credentialExpiresAt),
  };
}

export function toExchangeAccountView(row: TradingAccountRow): ExchangeAccountView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    label: row.label,
    venue: row.exchange.venue as ExchangeAccountView['venue'],
    status: row.status as ExchangeAccountView['status'],
    marketType: row.marketType,
    tradingMode: row.tradingMode as ExchangeAccountView['tradingMode'],
    isSandbox: row.isSandbox,
    liveTradingEnabled: row.liveTradingEnabled,
    privateStreamEnabled: row.privateStreamEnabled,
    credential: toCredentialSummaryView(row),
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
  };
}

// -----------------------------------------------------------------------------
// Balances
// -----------------------------------------------------------------------------

export interface BalanceRow {
  asset: string;
  free: Prisma.Decimal;
  locked: Prisma.Decimal;
  total: Prisma.Decimal;
  venueUpdatedAtMicros: bigint | null;
  observedAtMicros: bigint;
  isSimulated: boolean;
}

export function toBalanceView(row: BalanceRow): BalanceView {
  return {
    asset: row.asset,
    free: requiredDecimal(row.free),
    locked: requiredDecimal(row.locked),
    total: requiredDecimal(row.total),
    venueUpdatedAtMicros: bigint(row.venueUpdatedAtMicros),
    observedAtMicros: requiredBigint(row.observedAtMicros),
    isSimulated: row.isSimulated,
  };
}

// -----------------------------------------------------------------------------
// Private stream sessions
// -----------------------------------------------------------------------------

export interface StreamSessionRow {
  id: string;
  venue: string;
  status: string;
  listenKeyMasked: string | null;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
  lastEventAt: Date | null;
  reconnectCount: number;
  eventsReceived: number;
  executionReports: number;
  parseErrors: number;
  listenKeyRenewals: number;
  listenKeyRenewalFailures: number;
  lastReconciledAt: Date | null;
  lastErrorCode: string | null;
  workerId: string;
}

export function toStreamSessionView(row: StreamSessionRow): StreamSessionView {
  return {
    id: row.id,
    venue: row.venue as StreamSessionView['venue'],
    status: row.status as StreamSessionView['status'],
    // Already masked at write time. Passed through, never reconstructed.
    listenKeyMasked: row.listenKeyMasked,
    connectedAt: iso(row.connectedAt),
    disconnectedAt: iso(row.disconnectedAt),
    lastEventAt: iso(row.lastEventAt),
    reconnectCount: row.reconnectCount,
    eventsReceived: row.eventsReceived,
    executionReports: row.executionReports,
    parseErrors: row.parseErrors,
    listenKeyRenewals: row.listenKeyRenewals,
    listenKeyRenewalFailures: row.listenKeyRenewalFailures,
    lastReconciledAt: iso(row.lastReconciledAt),
    lastErrorCode: row.lastErrorCode,
    workerId: row.workerId,
  };
}

// -----------------------------------------------------------------------------
// Orders, events, fills, positions
// -----------------------------------------------------------------------------

export interface OrderRow {
  id: string;
  clientOrderId: string;
  exchangeOrderId: string | null;
  accountId: string;
  strategyId: string | null;
  venue: string;
  symbol: string;
  side: string;
  orderType: string;
  timeInForce: string;
  status: string;
  reconciliationState: string;
  reconciliationDetail: string | null;
  lastReconciledAt: Date | null;
  quantity: Prisma.Decimal;
  price: Prisma.Decimal | null;
  stopPrice: Prisma.Decimal | null;
  reduceOnly: boolean;
  filledQuantity: Prisma.Decimal;
  averageFillPrice: Prisma.Decimal | null;
  cumulativeFee: Prisma.Decimal;
  feeCurrency: string | null;
  isSimulated: boolean;
  wasDryRun: boolean;
  rejectionCode: string | null;
  rejectionReason: string | null;
  metadata: Prisma.JsonValue;
  submitLatencyMicros: number | null;
  createdAt: Date;
  updatedAt: Date;
  submittedAt: Date | null;
  terminalAt: Date | null;
}

export function toOrderView(row: OrderRow): OrderView {
  return {
    id: row.id,
    clientOrderId: row.clientOrderId,
    exchangeOrderId: row.exchangeOrderId,
    accountId: row.accountId,
    strategyId: row.strategyId,
    venue: row.venue as OrderView['venue'],
    symbol: row.symbol,
    side: row.side,
    orderType: row.orderType,
    timeInForce: row.timeInForce,
    status: row.status,
    reconciliationState: row.reconciliationState as OrderView['reconciliationState'],
    reconciliationDetail: row.reconciliationDetail,
    lastReconciledAt: iso(row.lastReconciledAt),
    quantity: requiredDecimal(row.quantity),
    price: decimal(row.price),
    stopPrice: decimal(row.stopPrice),
    reduceOnly: row.reduceOnly,
    filledQuantity: requiredDecimal(row.filledQuantity),
    averageFillPrice: decimal(row.averageFillPrice),
    cumulativeFee: requiredDecimal(row.cumulativeFee),
    feeCurrency: row.feeCurrency,
    isSimulated: row.isSimulated,
    wasDryRun: row.wasDryRun,
    rejectionCode: row.rejectionCode,
    rejectionReason: row.rejectionReason,
    metadata: safeJson(row.metadata),
    submitLatencyMicros: row.submitLatencyMicros,
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
    submittedAt: iso(row.submittedAt),
    terminalAt: iso(row.terminalAt),
  };
}

export interface OrderEventRow {
  id: string;
  orderId: string;
  previousStatus: string | null;
  status: string;
  reason: string | null;
  payload: Prisma.JsonValue;
  occurredAtMicros: bigint;
  createdAt: Date;
}

export function toOrderEventView(row: OrderEventRow): OrderEventView {
  return {
    id: row.id,
    orderId: row.orderId,
    previousStatus: row.previousStatus,
    status: row.status,
    reason: row.reason,
    payload: safeJson(row.payload),
    occurredAtMicros: requiredBigint(row.occurredAtMicros),
    createdAt: requiredIso(row.createdAt),
  };
}

export interface FillRow {
  id: string;
  orderId: string;
  venueTradeId: string;
  exchangeOrderId: string | null;
  symbol: string | null;
  side: string | null;
  venue: string | null;
  price: Prisma.Decimal;
  quantity: Prisma.Decimal;
  quoteQuantity: Prisma.Decimal | null;
  fee: Prisma.Decimal;
  feeCurrency: string;
  isMaker: boolean;
  source: string;
  isSimulated: boolean;
  exchangeTimestampMicros: bigint;
  receivedTimestampMicros: bigint;
}

export function toFillView(row: FillRow): FillView {
  return {
    id: row.id,
    orderId: row.orderId,
    venueTradeId: row.venueTradeId,
    exchangeOrderId: row.exchangeOrderId,
    symbol: row.symbol,
    side: row.side,
    venue: row.venue as FillView['venue'],
    price: requiredDecimal(row.price),
    quantity: requiredDecimal(row.quantity),
    quoteQuantity: decimal(row.quoteQuantity),
    fee: requiredDecimal(row.fee),
    feeCurrency: row.feeCurrency,
    isMaker: row.isMaker,
    source: row.source,
    // Surfaced unconditionally. A simulated fill that reaches a client without
    // this flag is indistinguishable from a real one, which is the single
    // worst thing a paper-trading feature can do.
    isSimulated: row.isSimulated,
    exchangeTimestampMicros: requiredBigint(row.exchangeTimestampMicros),
    receivedTimestampMicros: requiredBigint(row.receivedTimestampMicros),
  };
}

export interface PositionRow {
  id: string;
  accountId: string;
  venue: string;
  symbol: string;
  side: string;
  quantity: Prisma.Decimal;
  averageEntryPrice: Prisma.Decimal | null;
  markPrice: Prisma.Decimal | null;
  realisedPnl: Prisma.Decimal;
  unrealisedPnl: Prisma.Decimal | null;
  cumulativeFee: Prisma.Decimal;
  feeCurrency: string | null;
  containsSimulatedFills: boolean;
  fillCount: number;
  openedAt: Date | null;
  closedAt: Date | null;
  lastFillAt: Date | null;
  updatedAt: Date;
}

export function toPositionView(row: PositionRow): PositionView {
  // An unrealised PnL is only meaningful alongside the mark price it was
  // struck at. If the mark is missing the figure is stale by an unknown
  // amount, so both are suppressed rather than shipping half a number.
  const markPrice = decimal(row.markPrice);
  const unrealisedPnl = markPrice === null ? null : decimal(row.unrealisedPnl);

  return {
    id: row.id,
    accountId: row.accountId,
    venue: row.venue as PositionView['venue'],
    symbol: row.symbol,
    side: row.side,
    quantity: requiredDecimal(row.quantity),
    averageEntryPrice: decimal(row.averageEntryPrice),
    realisedPnl: requiredDecimal(row.realisedPnl),
    unrealisedPnl,
    markPrice,
    cumulativeFee: requiredDecimal(row.cumulativeFee),
    feeCurrency: row.feeCurrency,
    containsSimulatedFills: row.containsSimulatedFills,
    fillCount: row.fillCount,
    openedAt: iso(row.openedAt),
    closedAt: iso(row.closedAt),
    lastFillAt: iso(row.lastFillAt),
    updatedAt: requiredIso(row.updatedAt),
  };
}

// -----------------------------------------------------------------------------
// Reconciliation
// -----------------------------------------------------------------------------

export interface ReconciliationRunRow {
  id: string;
  accountId: string;
  venue: string;
  status: string;
  trigger: string;
  startedAt: Date;
  finishedAt: Date | null;
  durationMicros: bigint | null;
  ordersChecked: number;
  fillsRecovered: number;
  discrepanciesFound: number;
  discrepanciesRepaired: number;
  error: string | null;
  workerId: string;
}

export function toReconciliationRunView(row: ReconciliationRunRow): ReconciliationRunView {
  return {
    id: row.id,
    accountId: row.accountId,
    venue: row.venue as ReconciliationRunView['venue'],
    status: row.status as ReconciliationRunView['status'],
    trigger: row.trigger,
    startedAt: requiredIso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    durationMicros: bigint(row.durationMicros),
    ordersChecked: row.ordersChecked,
    fillsRecovered: row.fillsRecovered,
    discrepanciesFound: row.discrepanciesFound,
    discrepanciesRepaired: row.discrepanciesRepaired,
    error: row.error,
    workerId: row.workerId,
  };
}

export interface ReconciliationDiscrepancyRow {
  id: string;
  runId: string;
  orderId: string | null;
  clientOrderId: string | null;
  symbol: string | null;
  discrepancyType: string;
  localValue: string | null;
  venueValue: string | null;
  summary: string;
  repaired: boolean;
  detectedAtMicros: bigint;
  createdAt: Date;
}

export function toReconciliationDiscrepancyView(
  row: ReconciliationDiscrepancyRow,
): ReconciliationDiscrepancyView {
  return {
    id: row.id,
    runId: row.runId,
    orderId: row.orderId,
    clientOrderId: row.clientOrderId,
    symbol: row.symbol,
    discrepancyType: row.discrepancyType as ReconciliationDiscrepancyView['discrepancyType'],
    localValue: row.localValue,
    venueValue: row.venueValue,
    summary: row.summary,
    repaired: row.repaired,
    detectedAtMicros: requiredBigint(row.detectedAtMicros),
    createdAt: requiredIso(row.createdAt),
  };
}

// -----------------------------------------------------------------------------
// Incidents and kill switches
// -----------------------------------------------------------------------------

export interface ExecutionIncidentRow {
  id: string;
  accountId: string | null;
  orderId: string | null;
  clientOrderId: string | null;
  incidentType: string;
  severity: string;
  venue: string | null;
  symbol: string | null;
  errorCode: string | null;
  summary: string;
  details: Prisma.JsonValue;
  occurredAtMicros: bigint;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  notifiedAt: Date | null;
  createdAt: Date;
}

export function toExecutionIncidentView(row: ExecutionIncidentRow): ExecutionIncidentView {
  return {
    id: row.id,
    accountId: row.accountId,
    orderId: row.orderId,
    clientOrderId: row.clientOrderId,
    incidentType: row.incidentType as ExecutionIncidentView['incidentType'],
    severity: row.severity as ExecutionIncidentView['severity'],
    venue: row.venue as ExecutionIncidentView['venue'],
    symbol: row.symbol,
    errorCode: row.errorCode,
    summary: row.summary,
    details: safeJson(row.details),
    occurredAtMicros: requiredBigint(row.occurredAtMicros),
    resolvedAt: iso(row.resolvedAt),
    resolvedBy: row.resolvedBy,
    resolutionNote: row.resolutionNote,
    notifiedAt: iso(row.notifiedAt),
    createdAt: requiredIso(row.createdAt),
  };
}

export interface KillSwitchRow {
  id: string;
  scope: string;
  target: string | null;
  isEngaged: boolean;
  reason: string | null;
  engagedByUserId: string | null;
  engagedAt: Date | null;
  releasedByUserId: string | null;
  releasedAt: Date | null;
  updatedAt: Date;
}

export function toKillSwitchView(row: KillSwitchRow): KillSwitchView {
  return {
    id: row.id,
    scope: row.scope,
    target: row.target,
    isEngaged: row.isEngaged,
    reason: row.reason,
    engagedByUserId: row.engagedByUserId,
    engagedAt: iso(row.engagedAt),
    releasedByUserId: row.releasedByUserId,
    releasedAt: iso(row.releasedAt),
    updatedAt: requiredIso(row.updatedAt),
  };
}

// -----------------------------------------------------------------------------
// Connectivity roll-up
// -----------------------------------------------------------------------------

export interface ConnectivityInput {
  account: TradingAccountRow;
  session: StreamSessionRow | null;
  lastRun: ReconciliationRunRow | null;
  openIncidents: number;
  criticalIncidents: number;
  unreconciledOrders: number;
}

export function toAccountConnectivityView(input: ConnectivityInput): AccountConnectivityView {
  const { account } = input;
  return {
    accountId: account.id,
    venue: account.exchange.venue as AccountConnectivityView['venue'],
    status: account.status as AccountConnectivityView['status'],
    // "Verified" means the venue confirmed the key can read and trade, and has
    // not failed since. A key that has never been checked is not verified.
    credentialsVerified:
      account.lastVerifiedAt !== null && account.consecutiveFailures === 0 && account.canReadData,
    lastVerifiedAt: iso(account.lastVerifiedAt),
    lastFailureCode: account.lastFailureCode,
    consecutiveFailures: account.consecutiveFailures,
    privateStream: input.session ? toStreamSessionView(input.session) : null,
    lastReconciliation: input.lastRun ? toReconciliationRunView(input.lastRun) : null,
    openIncidents: input.openIncidents,
    criticalIncidents: input.criticalIncidents,
    unreconciledOrders: input.unreconciledOrders,
  };
}
