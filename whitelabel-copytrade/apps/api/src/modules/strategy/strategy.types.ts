import type {
  BacktestRunStatus,
  ExecutionIncidentSeverity,
  PaperSessionStatus,
  PositionSideEnum,
  StrategyFailurePolicy,
  StrategyHealth,
  StrategyIncidentType,
  StrategyRunStatus,
  StrategyStatus,
  StrategyVersionStatus,
  TradingMarketType,
  TradingModeSetting,
  TradingVenue,
} from '@prisma/client';

/**
 * Outward-facing shapes for the strategy API.
 *
 * Same two rules as `execution.types.ts`, for the same reasons.
 *
 * No Prisma row is returned directly. Every response is assembled field by
 * field in `strategy.mapper.ts` from an explicitly declared input type, so a
 * column added by a future migration cannot appear in a JSON body by accident.
 *
 * Decimal and BigInt are serialised as strings. A quantity of 0.000000000001
 * and a microsecond epoch both lose precision as an IEEE double, and rounding
 * either on a trading surface is not a trade-off worth making.
 *
 * One rule is specific to this module: every simulated result carries an
 * explicit `isSimulated: true` and a `disclaimer`. A client that renders a
 * backtest equity curve next to a live one must not have to infer which is
 * which from the endpoint it happened to call.
 */

/** Repeated verbatim on every simulated payload. */
export const SIMULATION_DISCLAIMER =
  'Simulated result. Backtest performance is not indicative of future performance; ' +
  'paper performance is not indicative of live performance; simulation does not ' +
  'guarantee real execution quality.';

// -----------------------------------------------------------------------------
// Catalogue
// -----------------------------------------------------------------------------

export interface StrategyVersionView {
  id: string;
  definitionId: string;
  version: string;
  status: StrategyVersionStatus;
  implementationId: string;
  /** Declared parameter schema. Never contains a credential-shaped field. */
  parameterSchema: unknown;
  defaultParameters: unknown;
  behaviourHash: string;
  changeNote: string | null;
  publishedAt: string | null;
  deprecatedAt: string | null;
  createdAt: string;
}

export interface StrategyDefinitionView {
  id: string;
  key: string;
  displayName: string;
  description: string;
  category: string | null;
  isImplemented: boolean;
  isReserved: boolean;
  /** Rendered verbatim by every client. Never rewritten into a claim. */
  riskNotes: string;
  versionCount: number;
  versions?: StrategyVersionView[];
  createdAt: string;
  updatedAt: string;
}

// -----------------------------------------------------------------------------
// Instances
// -----------------------------------------------------------------------------

export interface StrategyRiskProfileView {
  maxOrderQuantity: string;
  maxPositionQuantity: string;
  maxOrderNotional: string;
  maxDailyLoss: string;
  maxOpenOrders: number;
  maxOrdersPerMinute: number;
}

export interface StrategyInstanceView {
  id: string;
  tenantId: string;
  accountId: string | null;
  name: string;
  kind: string;
  version: string;
  definitionId: string | null;
  versionId: string | null;
  /** Deterministic engine fingerprint. Null until the engine reports one. */
  instanceKey: string | null;
  configVersion: number;
  status: StrategyStatus;
  enabled: boolean;
  health: StrategyHealth;
  failurePolicy: StrategyFailurePolicy;
  venue: TradingVenue;
  symbols: string[];
  marketType: TradingMarketType;
  description: string | null;
  riskProfile: StrategyRiskProfileView;
  consecutiveErrors: number;
  lastHeartbeatAt: string | null;
  lastStartedAt: string | null;
  lastStoppedAt: string | null;
  /** Exception class name only. Never a message. */
  lastErrorCode: string | null;
  quarantinedAt: string | null;
  quarantineReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StrategyRunView {
  id: string;
  strategyId: string;
  runMode: TradingModeSetting;
  status: StrategyRunStatus;
  instanceKey: string;
  configVersion: number;
  strategyKey: string;
  strategyVersion: string;
  venue: TradingVenue;
  symbols: string[];
  marketType: TradingMarketType;
  startedAt: string;
  stoppedAt: string | null;
  stopReason: string | null;
  errorCode: string | null;
  counters: unknown;
  lastEventAtMicros: string | null;
}

/**
 * What an operator needs in one glance.
 *
 * `liveExecutionReachable` is stated explicitly and separately from `enabled`.
 * A strategy being enabled does not mean it can place a live order, and a
 * status panel that does not say so invites the assumption that it does.
 */
export interface StrategyInstanceStatusView {
  instance: StrategyInstanceView;
  currentRun: StrategyRunView | null;
  openIncidents: number;
  criticalIncidents: number;
  lastCheckpointAt: string | null;
  engineEnabled: boolean;
  tradingMode: 'DISABLED' | 'DRY_RUN' | 'PAPER' | 'LIVE';
  liveExecutionReachable: boolean;
}

export interface StrategyIncidentView {
  id: string;
  strategyId: string | null;
  runId: string | null;
  incidentType: StrategyIncidentType;
  severity: ExecutionIncidentSeverity;
  venue: TradingVenue | null;
  symbol: string | null;
  errorCode: string | null;
  summary: string;
  details: unknown;
  occurredAtMicros: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  createdAt: string;
}

// -----------------------------------------------------------------------------
// Backtesting
// -----------------------------------------------------------------------------

export interface BacktestDatasetView {
  datasetId: string;
  /**
   * Part 7: the registered dataset version this run is pinned to, when the
   * submission cited one. Null marks a legacy (Part 6) run identified only
   * by its stored datasetId string. Where it is set, `datasetId` is the
   * canonical `hst-<key>@v<version>` derived from the version row, and the
   * checksum was verified against it - this field is the join an operator
   * follows to read the manifest, verdict and file receipts behind a result.
   */
  versionId: string | null;
  source: string;
  /** Null means the result cannot be proven to have come from that data. */
  checksum: string | null;
  granularity: string | null;
  windowStartMicros: string;
  windowEndMicros: string;
  eventCount: number;
  walkForwardSegment: string | null;
}

export interface BacktestAssumptionsView {
  initialCapital: string;
  makerFeeRate: string;
  takerFeeRate: string;
  slippageBps: string;
  latencyMicros: string;
  extra: unknown;
}

export interface BacktestResultView {
  finalEquity: string | null;
  netPnl: string | null;
  grossProfit: string | null;
  grossLoss: string | null;
  feesPaid: string | null;
  slippageCost: string | null;
  totalReturnPercent: string | null;
  maxDrawdown: string | null;
  maxDrawdownPercent: string | null;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  /** Null, never zero, when there were no trades to average. */
  winRate: string | null;
  averageTrade: string | null;
  largestWin: string | null;
  largestLoss: string | null;
  profitFactor: string | null;
  /** Withheld below the engine's minimum observation count. */
  sharpeRatio: string | null;
  sortinoRatio: string | null;
  hasSufficientObservations: boolean;
  exposurePercent: string | null;
  turnover: string | null;
}

export interface BacktestRunView {
  id: string;
  runIdentifier: string;
  status: BacktestRunStatus;
  strategyId: string | null;
  definitionId: string | null;
  versionId: string | null;
  strategyKey: string;
  strategyVersion: string;
  implementationId: string;
  venue: TradingVenue;
  symbol: string;
  marketType: TradingMarketType;
  dataset: BacktestDatasetView;
  assumptions: BacktestAssumptionsView;
  parameters: unknown;
  result: BacktestResultView;
  configurationHash: string;
  engineVersion: string;
  isReproducible: boolean;
  isSimulated: true;
  disclaimer: string;
  jobId: string | null;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  errorCode: string | null;
  errorSummary: string | null;
}

export interface BacktestMetricView {
  name: string;
  value: string | null;
  unit: string;
  observationCount: number;
  /** False means "not enough data to say", which is not the same as zero. */
  isSufficient: boolean;
  note: string | null;
}

export interface BacktestTradeView {
  sequence: number;
  symbol: string;
  direction: PositionSideEnum;
  quantity: string;
  entryPrice: string;
  exitPrice: string;
  grossPnl: string;
  fees: string;
  netPnl: string;
  /** Net of fees. A trade profitable before costs and not after is a loss. */
  isWin: boolean;
  openedAtMicros: string;
  closedAtMicros: string;
  holdingMicros: string;
  isSimulated: true;
}

// -----------------------------------------------------------------------------
// Paper trading
// -----------------------------------------------------------------------------

export interface PaperSessionView {
  id: string;
  sessionIdentifier: string;
  status: PaperSessionStatus;
  strategyId: string | null;
  strategyKey: string;
  strategyVersion: string;
  venue: TradingVenue;
  symbol: string;
  marketType: TradingMarketType;
  initialCapital: string;
  currentEquity: string | null;
  realisedPnl: string;
  /** Null when flat or unmarked. Never coerced to zero. */
  unrealisedPnl: string | null;
  feesPaid: string;
  maxDrawdown: string | null;
  signalsGenerated: number;
  signalsAccepted: number;
  signalsRejected: number;
  riskRejections: number;
  simulatedOrders: number;
  simulatedFills: number;
  strategyErrors: number;
  isSimulated: true;
  disclaimer: string;
  startedAt: string;
  stoppedAt: string | null;
  stopReason: string | null;
  errorCode: string | null;
}

export interface PaperSnapshotView {
  sequence: number;
  capturedAtMicros: string;
  cash: string;
  positionQuantity: string;
  positionValue: string | null;
  equity: string;
  realisedPnl: string;
  unrealisedPnl: string | null;
  feesPaid: string;
  drawdown: string;
  isSimulated: true;
}

// -----------------------------------------------------------------------------
// Metrics and commands
// -----------------------------------------------------------------------------

/**
 * Aggregate counters for the strategy layer.
 *
 * Every latency figure is an observation of a process including its own
 * scheduling delay. It is not a guarantee, and this platform makes no
 * "sub-millisecond" or HFT claim. `latencyNote` carries that statement to
 * every consumer so a dashboard cannot quietly turn it into a promise.
 */
export interface StrategyMetricsView {
  instances: {
    total: number;
    enabled: number;
    running: number;
    quarantined: number;
    unhealthy: number;
  };
  incidents: {
    open: number;
    critical: number;
    warning: number;
    info: number;
  };
  runs: {
    active: number;
    failedLast24h: number;
  };
  backtests: {
    queued: number;
    running: number;
    completedLast24h: number;
    failedLast24h: number;
  };
  paperSessions: {
    running: number;
    stoppedLast24h: number;
  };
  configuration: {
    strategyEngineEnabled: boolean;
    paperTradingEnabled: boolean;
    backtestEnabled: boolean;
    maxInstances: number;
    eventQueueSize: number;
    maxProcessingLatencyMs: number;
    signalMaxAgeMs: number;
    signalDedupTtlSeconds: number;
    tradingMode: 'DISABLED' | 'DRY_RUN' | 'PAPER' | 'LIVE';
    liveExecutionReachable: boolean;
  };
  latencyNote: string;
  disclaimer: string;
}

/** Acknowledgement for anything the strategy worker has to carry out. */
export interface StrategyCommandAcceptedView {
  accepted: true;
  command: string;
  jobId: string;
  requestedAt: string;
  /** What was queued, and what has explicitly NOT happened yet. */
  note: string;
}
