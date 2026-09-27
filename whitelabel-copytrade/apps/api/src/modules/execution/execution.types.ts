import type {
  CredentialSource,
  ExecutionIncidentSeverity,
  ExecutionIncidentType,
  OrderReconciliationState,
  ReconciliationDiscrepancyType,
  ReconciliationRunStatus,
  StreamSessionStatus,
  TradingAccountStatus,
  TradingModeSetting,
  TradingVenue,
} from '@prisma/client';

/**
 * Outward-facing shapes for the execution API.
 *
 * These interfaces exist so that no Prisma row is ever returned directly from a
 * controller. A `TradingAccount` row carries `apiKeyCiphertext`,
 * `apiSecretCiphertext` and `encryptedDataKey`; returning it and trusting a
 * `select` clause to stay correct through future edits is exactly the kind of
 * arrangement that leaks a secret eighteen months later. Every response is
 * assembled field by field in `execution.mapper.ts`, and the compiler rejects
 * anything that is not declared here.
 *
 * Decimal and BigInt columns are serialised as strings. JSON cannot represent
 * either faithfully - a quantity of 0.000000000001 or a microsecond timestamp
 * both lose precision as an IEEE double - and silently rounding a quantity on
 * the way to a client is not acceptable on a trading surface.
 */

/** A venue credential, described without describing it. */
export interface CredentialSummaryView {
  source: CredentialSource;
  /** Last four characters of the public key. Never the key, never the secret. */
  apiKeyLastFour: string;
  /**
   * Location of the credential in an external store, when one is used. A path
   * or ARN: it names where the secret lives, it does not reveal it.
   */
  credentialRef: string | null;
  /** Permissions the venue reported at the last successful verification. */
  verifiedPermissions: string[];
  canTrade: boolean;
  canReadData: boolean;
  /** Always expected to be false. True means the account is refused. */
  canWithdraw: boolean;
  ipRestricted: boolean;
  lastVerifiedAt: string | null;
  lastFailureAt: string | null;
  /** Error class, never a venue response body. */
  lastFailureCode: string | null;
  consecutiveFailures: number;
  rotatedAt: string | null;
  expiresAt: string | null;
}

export interface ExchangeAccountView {
  id: string;
  tenantId: string;
  userId: string | null;
  label: string;
  venue: TradingVenue;
  status: TradingAccountStatus;
  marketType: string;
  tradingMode: TradingModeSetting;
  isSandbox: boolean;
  /** Per-account arming switch. Ineffective unless the deployment agrees. */
  liveTradingEnabled: boolean;
  privateStreamEnabled: boolean;
  credential: CredentialSummaryView;
  createdAt: string;
  updatedAt: string;
}

export interface BalanceView {
  asset: string;
  free: string;
  locked: string;
  total: string;
  /** Venue's own timestamp, in microseconds, when it reported one. */
  venueUpdatedAtMicros: string | null;
  observedAtMicros: string;
  /** True for a paper account. Never mixed with real balances unlabelled. */
  isSimulated: boolean;
}

export interface AccountConnectivityView {
  accountId: string;
  venue: TradingVenue;
  status: TradingAccountStatus;
  credentialsVerified: boolean;
  lastVerifiedAt: string | null;
  lastFailureCode: string | null;
  consecutiveFailures: number;
  privateStream: StreamSessionView | null;
  lastReconciliation: ReconciliationRunView | null;
  openIncidents: number;
  criticalIncidents: number;
  /** Orders whose local state is not trusted. Non-zero blocks new submissions. */
  unreconciledOrders: number;
}

export interface StreamSessionView {
  id: string;
  venue: TradingVenue;
  status: StreamSessionStatus;
  /** Masked listen key, e.g. "pqia...65a1". The real key is never stored. */
  listenKeyMasked: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  lastEventAt: string | null;
  reconnectCount: number;
  eventsReceived: number;
  executionReports: number;
  parseErrors: number;
  listenKeyRenewals: number;
  listenKeyRenewalFailures: number;
  lastReconciledAt: string | null;
  lastErrorCode: string | null;
  workerId: string;
}

export interface OrderView {
  id: string;
  clientOrderId: string;
  exchangeOrderId: string | null;
  accountId: string;
  strategyId: string | null;
  venue: TradingVenue;
  symbol: string;
  side: string;
  orderType: string;
  timeInForce: string;
  status: string;
  reconciliationState: OrderReconciliationState;
  reconciliationDetail: string | null;
  lastReconciledAt: string | null;
  quantity: string;
  price: string | null;
  stopPrice: string | null;
  reduceOnly: boolean;
  filledQuantity: string;
  averageFillPrice: string | null;
  cumulativeFee: string;
  feeCurrency: string | null;
  isSimulated: boolean;
  wasDryRun: boolean;
  rejectionCode: string | null;
  rejectionReason: string | null;
  metadata: Record<string, unknown>;
  submitLatencyMicros: number | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  terminalAt: string | null;
}

export interface OrderEventView {
  id: string;
  orderId: string;
  previousStatus: string | null;
  status: string;
  reason: string | null;
  /**
   * Structured context recorded with the transition. Re-scrubbed on read even
   * though the writer scrubs it: two cheap passes, one irreversible mistake.
   */
  payload: Record<string, unknown>;
  occurredAtMicros: string;
  createdAt: string;
}

export interface FillView {
  id: string;
  orderId: string;
  venueTradeId: string;
  exchangeOrderId: string | null;
  symbol: string | null;
  side: string | null;
  venue: TradingVenue | null;
  price: string;
  quantity: string;
  quoteQuantity: string | null;
  fee: string;
  feeCurrency: string;
  isMaker: boolean;
  /** How this fill reached us: stream, order response, or reconciliation. */
  source: string;
  /** True only for a paper fill. Always surfaced, never inferred. */
  isSimulated: boolean;
  exchangeTimestampMicros: string;
  receivedTimestampMicros: string;
}

export interface PositionView {
  id: string;
  accountId: string;
  venue: TradingVenue;
  symbol: string;
  side: string;
  quantity: string;
  averageEntryPrice: string | null;
  realisedPnl: string;
  unrealisedPnl: string | null;
  /**
   * Mark price the unrealised figure was computed against. An unrealised PnL
   * without the price it was struck at is a number nobody can check, so both
   * travel together or neither is shown.
   */
  markPrice: string | null;
  cumulativeFee: string;
  feeCurrency: string | null;
  /**
   * True when any fill contributing to this position was simulated. Sticky on
   * purpose: a position built partly from paper fills is not a real position,
   * and one real fill afterwards must not launder it.
   */
  containsSimulatedFills: boolean;
  fillCount: number;
  openedAt: string | null;
  closedAt: string | null;
  lastFillAt: string | null;
  updatedAt: string;
}

export interface ReconciliationRunView {
  id: string;
  accountId: string;
  venue: TradingVenue;
  status: ReconciliationRunStatus;
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  durationMicros: string | null;
  ordersChecked: number;
  fillsRecovered: number;
  discrepanciesFound: number;
  discrepanciesRepaired: number;
  error: string | null;
  workerId: string;
}

export interface ReconciliationDiscrepancyView {
  id: string;
  runId: string;
  orderId: string | null;
  clientOrderId: string | null;
  symbol: string | null;
  discrepancyType: ReconciliationDiscrepancyType;
  localValue: string | null;
  venueValue: string | null;
  summary: string;
  repaired: boolean;
  detectedAtMicros: string;
  createdAt: string;
}

export interface ExecutionIncidentView {
  id: string;
  accountId: string | null;
  orderId: string | null;
  clientOrderId: string | null;
  incidentType: ExecutionIncidentType;
  severity: ExecutionIncidentSeverity;
  venue: TradingVenue | null;
  symbol: string | null;
  errorCode: string | null;
  summary: string;
  /** Scrubbed at write time by the trading worker. Re-scrubbed on read. */
  details: Record<string, unknown>;
  occurredAtMicros: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  notifiedAt: string | null;
  createdAt: string;
}

export interface KillSwitchView {
  id: string;
  scope: string;
  target: string | null;
  isEngaged: boolean;
  reason: string | null;
  engagedByUserId: string | null;
  engagedAt: string | null;
  releasedByUserId: string | null;
  releasedAt: string | null;
  updatedAt: string;
}

/**
 * The deployment-level answer to "would a live order be transmitted right now,
 * and if not, why not".
 *
 * `wouldTransmit` is computed rather than stored so it cannot drift from the
 * switches it summarises, and `blockingReasons` lists every reason at once -
 * an operator who fixes one blocker and finds another is an operator who ends
 * up disabling things at random.
 */
export interface ExecutionSafetyView {
  executionEnabled: boolean;
  tradingMode: 'DISABLED' | 'DRY_RUN' | 'PAPER' | 'LIVE';
  liveTradingEnabled: boolean;
  dryRun: boolean;
  paperTrading: boolean;
  sandboxMode: boolean;
  platformCredentialsConfigured: boolean;
  orderRequestTimeoutMs: number;
  orderReconciliationIntervalMs: number;
  orderUnknownReconciliationDelayMs: number;
  exchangeTimeSyncIntervalMs: number;
  executionIdempotencyTtlSeconds: number;
  privateStreamReconnectEnabled: boolean;
  killSwitches: KillSwitchView[];
  wouldTransmitLiveOrder: boolean;
  blockingReasons: string[];
}

/** Acknowledgement returned when work is handed to the trading worker. */
export interface CommandAcceptedView {
  accepted: true;
  jobId: string;
  command: string;
  accountId: string;
  /**
   * Explicit, because "accepted" is not "done". The caller polls the
   * corresponding read endpoint to observe the result.
   */
  note: string;
}
