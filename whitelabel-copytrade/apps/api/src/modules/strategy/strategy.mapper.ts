import type { Prisma } from '@prisma/client';

import {
  SIMULATION_DISCLAIMER,
  type BacktestMetricView,
  type BacktestRunView,
  type BacktestTradeView,
  type PaperSessionView,
  type PaperSnapshotView,
  type StrategyDefinitionView,
  type StrategyIncidentView,
  type StrategyInstanceView,
  type StrategyRunView,
  type StrategyVersionView,
} from './strategy.types';

/**
 * Prisma row -> API view conversions for the strategy layer.
 *
 * Written to the same discipline as `execution.mapper.ts`:
 *
 *   - no `...row` spread anywhere, so a column added by a future migration
 *     cannot appear in a response without someone deciding it should;
 *   - Decimal and BigInt are stringified rather than cast to `number`;
 *   - every simulated payload gets `isSimulated: true` and the disclaimer,
 *     applied here rather than at each call site, because a label that depends
 *     on being remembered is a label that will eventually be forgotten.
 *
 * There is no credential risk in this module - no strategy object holds one -
 * but the field-by-field style is kept anyway. Uniformity is what makes the
 * absence of a spread meaningful when it matters.
 */

type DecimalLike = Prisma.Decimal | null | undefined;

function decimal(value: DecimalLike): string | null {
  return value === null || value === undefined ? null : value.toString();
}

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
  return value === null || value === undefined ? null : value.toISOString();
}

function requiredIso(value: Date): string {
  return value.toISOString();
}

function json(value: Prisma.JsonValue | null | undefined): unknown {
  return value === null || value === undefined ? {} : value;
}

// -----------------------------------------------------------------------------
// Catalogue
// -----------------------------------------------------------------------------

export interface StrategyVersionRow {
  id: string;
  definitionId: string;
  version: string;
  status: StrategyVersionView['status'];
  implementationId: string;
  parameterSchema: Prisma.JsonValue;
  defaultParameters: Prisma.JsonValue;
  behaviourHash: string;
  changeNote: string | null;
  publishedAt: Date | null;
  deprecatedAt: Date | null;
  createdAt: Date;
}

export function toStrategyVersionView(row: StrategyVersionRow): StrategyVersionView {
  return {
    id: row.id,
    definitionId: row.definitionId,
    version: row.version,
    status: row.status,
    implementationId: row.implementationId,
    parameterSchema: json(row.parameterSchema),
    defaultParameters: json(row.defaultParameters),
    behaviourHash: row.behaviourHash,
    changeNote: row.changeNote,
    publishedAt: iso(row.publishedAt),
    deprecatedAt: iso(row.deprecatedAt),
    createdAt: requiredIso(row.createdAt),
  };
}

export interface StrategyDefinitionRow {
  id: string;
  key: string;
  displayName: string;
  description: string;
  category: string | null;
  isImplemented: boolean;
  isReserved: boolean;
  riskNotes: string;
  createdAt: Date;
  updatedAt: Date;
  versions?: StrategyVersionRow[];
  _count?: { versions: number };
}

export function toStrategyDefinitionView(row: StrategyDefinitionRow): StrategyDefinitionView {
  return {
    id: row.id,
    key: row.key,
    displayName: row.displayName,
    description: row.description,
    category: row.category,
    isImplemented: row.isImplemented,
    isReserved: row.isReserved,
    riskNotes: row.riskNotes,
    versionCount: row._count?.versions ?? row.versions?.length ?? 0,
    ...(row.versions ? { versions: row.versions.map(toStrategyVersionView) } : {}),
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
  };
}

// -----------------------------------------------------------------------------
// Instances
// -----------------------------------------------------------------------------

export interface StrategyInstanceRow {
  id: string;
  tenantId: string;
  accountId: string | null;
  name: string;
  kind: string;
  version: string;
  definitionId: string | null;
  versionId: string | null;
  instanceKey: string | null;
  configVersion: number;
  status: StrategyInstanceView['status'];
  enabled: boolean;
  health: StrategyInstanceView['health'];
  failurePolicy: StrategyInstanceView['failurePolicy'];
  venue: StrategyInstanceView['venue'];
  symbols: string[];
  marketType: StrategyInstanceView['marketType'];
  description: string | null;
  maxOrderQuantity: Prisma.Decimal;
  maxPositionQuantity: Prisma.Decimal;
  maxOrderNotional: Prisma.Decimal;
  maxDailyLoss: Prisma.Decimal;
  maxOpenOrders: number;
  maxOrdersPerMinute: number;
  consecutiveErrors: number;
  lastHeartbeatAt: Date | null;
  lastStartedAt: Date | null;
  lastStoppedAt: Date | null;
  lastErrorCode: string | null;
  quarantinedAt: Date | null;
  quarantineReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toStrategyInstanceView(row: StrategyInstanceRow): StrategyInstanceView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    accountId: row.accountId,
    name: row.name,
    kind: row.kind,
    version: row.version,
    definitionId: row.definitionId,
    versionId: row.versionId,
    instanceKey: row.instanceKey,
    configVersion: row.configVersion,
    status: row.status,
    enabled: row.enabled,
    health: row.health,
    failurePolicy: row.failurePolicy,
    venue: row.venue,
    symbols: row.symbols,
    marketType: row.marketType,
    description: row.description,
    riskProfile: {
      maxOrderQuantity: requiredDecimal(row.maxOrderQuantity),
      maxPositionQuantity: requiredDecimal(row.maxPositionQuantity),
      maxOrderNotional: requiredDecimal(row.maxOrderNotional),
      maxDailyLoss: requiredDecimal(row.maxDailyLoss),
      maxOpenOrders: row.maxOpenOrders,
      maxOrdersPerMinute: row.maxOrdersPerMinute,
    },
    consecutiveErrors: row.consecutiveErrors,
    lastHeartbeatAt: iso(row.lastHeartbeatAt),
    lastStartedAt: iso(row.lastStartedAt),
    lastStoppedAt: iso(row.lastStoppedAt),
    lastErrorCode: row.lastErrorCode,
    quarantinedAt: iso(row.quarantinedAt),
    quarantineReason: row.quarantineReason,
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
  };
}

export interface StrategyRunRow {
  id: string;
  strategyId: string;
  runMode: StrategyRunView['runMode'];
  status: StrategyRunView['status'];
  instanceKey: string;
  configVersion: number;
  strategyKey: string;
  strategyVersion: string;
  venue: StrategyRunView['venue'];
  symbols: string[];
  marketType: StrategyRunView['marketType'];
  startedAt: Date;
  stoppedAt: Date | null;
  stopReason: string | null;
  errorCode: string | null;
  counters: Prisma.JsonValue;
  lastEventAtMicros: bigint | null;
}

export function toStrategyRunView(row: StrategyRunRow): StrategyRunView {
  return {
    id: row.id,
    strategyId: row.strategyId,
    runMode: row.runMode,
    status: row.status,
    instanceKey: row.instanceKey,
    configVersion: row.configVersion,
    strategyKey: row.strategyKey,
    strategyVersion: row.strategyVersion,
    venue: row.venue,
    symbols: row.symbols,
    marketType: row.marketType,
    startedAt: requiredIso(row.startedAt),
    stoppedAt: iso(row.stoppedAt),
    stopReason: row.stopReason,
    errorCode: row.errorCode,
    counters: json(row.counters),
    lastEventAtMicros: bigint(row.lastEventAtMicros),
  };
}

export interface StrategyIncidentRow {
  id: string;
  strategyId: string | null;
  runId: string | null;
  incidentType: StrategyIncidentView['incidentType'];
  severity: StrategyIncidentView['severity'];
  venue: StrategyIncidentView['venue'];
  symbol: string | null;
  errorCode: string | null;
  summary: string;
  details: Prisma.JsonValue;
  occurredAtMicros: bigint;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  createdAt: Date;
}

export function toStrategyIncidentView(row: StrategyIncidentRow): StrategyIncidentView {
  return {
    id: row.id,
    strategyId: row.strategyId,
    runId: row.runId,
    incidentType: row.incidentType,
    severity: row.severity,
    venue: row.venue,
    symbol: row.symbol,
    errorCode: row.errorCode,
    summary: row.summary,
    details: json(row.details),
    occurredAtMicros: requiredBigint(row.occurredAtMicros),
    resolvedAt: iso(row.resolvedAt),
    resolvedBy: row.resolvedBy,
    resolutionNote: row.resolutionNote,
    createdAt: requiredIso(row.createdAt),
  };
}

// -----------------------------------------------------------------------------
// Backtesting
// -----------------------------------------------------------------------------

export interface BacktestRunRow {
  id: string;
  runIdentifier: string;
  status: BacktestRunView['status'];
  strategyId: string | null;
  definitionId: string | null;
  versionId: string | null;
  strategyKey: string;
  strategyVersion: string;
  implementationId: string;
  venue: BacktestRunView['venue'];
  symbol: string;
  marketType: BacktestRunView['marketType'];
  datasetId: string;
  datasetVersionId: string | null;
  datasetSource: string;
  datasetChecksum: string | null;
  granularity: string | null;
  windowStartMicros: bigint;
  windowEndMicros: bigint;
  eventCount: number;
  walkForwardSegment: string | null;
  initialCapital: Prisma.Decimal;
  makerFeeRate: Prisma.Decimal;
  takerFeeRate: Prisma.Decimal;
  slippageBps: Prisma.Decimal;
  latencyMicros: bigint;
  parameters: Prisma.JsonValue;
  assumptions: Prisma.JsonValue;
  finalEquity: Prisma.Decimal | null;
  netPnl: Prisma.Decimal | null;
  grossProfit: Prisma.Decimal | null;
  grossLoss: Prisma.Decimal | null;
  feesPaid: Prisma.Decimal | null;
  slippageCost: Prisma.Decimal | null;
  totalReturnPercent: Prisma.Decimal | null;
  maxDrawdown: Prisma.Decimal | null;
  maxDrawdownPercent: Prisma.Decimal | null;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: Prisma.Decimal | null;
  averageTrade: Prisma.Decimal | null;
  largestWin: Prisma.Decimal | null;
  largestLoss: Prisma.Decimal | null;
  profitFactor: Prisma.Decimal | null;
  sharpeRatio: Prisma.Decimal | null;
  sortinoRatio: Prisma.Decimal | null;
  hasSufficientObservations: boolean;
  exposurePercent: Prisma.Decimal | null;
  turnover: Prisma.Decimal | null;
  configurationHash: string;
  engineVersion: string;
  isReproducible: boolean;
  jobId: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  errorCode: string | null;
  errorSummary: string | null;
}

export function toBacktestRunView(row: BacktestRunRow): BacktestRunView {
  return {
    id: row.id,
    runIdentifier: row.runIdentifier,
    status: row.status,
    strategyId: row.strategyId,
    definitionId: row.definitionId,
    versionId: row.versionId,
    strategyKey: row.strategyKey,
    strategyVersion: row.strategyVersion,
    implementationId: row.implementationId,
    venue: row.venue,
    symbol: row.symbol,
    marketType: row.marketType,
    dataset: {
      datasetId: row.datasetId,
      versionId: row.datasetVersionId,
      source: row.datasetSource,
      checksum: row.datasetChecksum,
      granularity: row.granularity,
      windowStartMicros: requiredBigint(row.windowStartMicros),
      windowEndMicros: requiredBigint(row.windowEndMicros),
      eventCount: row.eventCount,
      walkForwardSegment: row.walkForwardSegment,
    },
    assumptions: {
      initialCapital: requiredDecimal(row.initialCapital),
      makerFeeRate: requiredDecimal(row.makerFeeRate),
      takerFeeRate: requiredDecimal(row.takerFeeRate),
      slippageBps: requiredDecimal(row.slippageBps),
      latencyMicros: requiredBigint(row.latencyMicros),
      extra: json(row.assumptions),
    },
    parameters: json(row.parameters),
    result: {
      finalEquity: decimal(row.finalEquity),
      netPnl: decimal(row.netPnl),
      grossProfit: decimal(row.grossProfit),
      grossLoss: decimal(row.grossLoss),
      feesPaid: decimal(row.feesPaid),
      slippageCost: decimal(row.slippageCost),
      totalReturnPercent: decimal(row.totalReturnPercent),
      maxDrawdown: decimal(row.maxDrawdown),
      maxDrawdownPercent: decimal(row.maxDrawdownPercent),
      totalTrades: row.totalTrades,
      winningTrades: row.winningTrades,
      losingTrades: row.losingTrades,
      winRate: decimal(row.winRate),
      averageTrade: decimal(row.averageTrade),
      largestWin: decimal(row.largestWin),
      largestLoss: decimal(row.largestLoss),
      profitFactor: decimal(row.profitFactor),
      sharpeRatio: decimal(row.sharpeRatio),
      sortinoRatio: decimal(row.sortinoRatio),
      hasSufficientObservations: row.hasSufficientObservations,
      exposurePercent: decimal(row.exposurePercent),
      turnover: decimal(row.turnover),
    },
    configurationHash: row.configurationHash,
    engineVersion: row.engineVersion,
    isReproducible: row.isReproducible,
    isSimulated: true,
    disclaimer: SIMULATION_DISCLAIMER,
    jobId: row.jobId,
    queuedAt: requiredIso(row.queuedAt),
    startedAt: iso(row.startedAt),
    completedAt: iso(row.completedAt),
    durationMs: row.durationMs,
    errorCode: row.errorCode,
    errorSummary: row.errorSummary,
  };
}

export interface BacktestMetricRow {
  name: string;
  value: Prisma.Decimal | null;
  unit: string;
  observationCount: number;
  isSufficient: boolean;
  note: string | null;
}

export function toBacktestMetricView(row: BacktestMetricRow): BacktestMetricView {
  return {
    name: row.name,
    value: decimal(row.value),
    unit: row.unit,
    observationCount: row.observationCount,
    isSufficient: row.isSufficient,
    note: row.note,
  };
}

export interface BacktestTradeRow {
  sequence: number;
  symbol: string;
  direction: BacktestTradeView['direction'];
  quantity: Prisma.Decimal;
  entryPrice: Prisma.Decimal;
  exitPrice: Prisma.Decimal;
  grossPnl: Prisma.Decimal;
  fees: Prisma.Decimal;
  netPnl: Prisma.Decimal;
  isWin: boolean;
  openedAtMicros: bigint;
  closedAtMicros: bigint;
  holdingMicros: bigint;
}

export function toBacktestTradeView(row: BacktestTradeRow): BacktestTradeView {
  return {
    sequence: row.sequence,
    symbol: row.symbol,
    direction: row.direction,
    quantity: requiredDecimal(row.quantity),
    entryPrice: requiredDecimal(row.entryPrice),
    exitPrice: requiredDecimal(row.exitPrice),
    grossPnl: requiredDecimal(row.grossPnl),
    fees: requiredDecimal(row.fees),
    netPnl: requiredDecimal(row.netPnl),
    isWin: row.isWin,
    openedAtMicros: requiredBigint(row.openedAtMicros),
    closedAtMicros: requiredBigint(row.closedAtMicros),
    holdingMicros: requiredBigint(row.holdingMicros),
    isSimulated: true,
  };
}

// -----------------------------------------------------------------------------
// Paper trading
// -----------------------------------------------------------------------------

export interface PaperSessionRow {
  id: string;
  sessionIdentifier: string;
  status: PaperSessionView['status'];
  strategyId: string | null;
  strategyKey: string;
  strategyVersion: string;
  venue: PaperSessionView['venue'];
  symbol: string;
  marketType: PaperSessionView['marketType'];
  initialCapital: Prisma.Decimal;
  currentEquity: Prisma.Decimal | null;
  realisedPnl: Prisma.Decimal;
  unrealisedPnl: Prisma.Decimal | null;
  feesPaid: Prisma.Decimal;
  maxDrawdown: Prisma.Decimal | null;
  signalsGenerated: number;
  signalsAccepted: number;
  signalsRejected: number;
  riskRejections: number;
  simulatedOrders: number;
  simulatedFills: number;
  strategyErrors: number;
  startedAt: Date;
  stoppedAt: Date | null;
  stopReason: string | null;
  errorCode: string | null;
}

export function toPaperSessionView(row: PaperSessionRow): PaperSessionView {
  return {
    id: row.id,
    sessionIdentifier: row.sessionIdentifier,
    status: row.status,
    strategyId: row.strategyId,
    strategyKey: row.strategyKey,
    strategyVersion: row.strategyVersion,
    venue: row.venue,
    symbol: row.symbol,
    marketType: row.marketType,
    initialCapital: requiredDecimal(row.initialCapital),
    currentEquity: decimal(row.currentEquity),
    realisedPnl: requiredDecimal(row.realisedPnl),
    unrealisedPnl: decimal(row.unrealisedPnl),
    feesPaid: requiredDecimal(row.feesPaid),
    maxDrawdown: decimal(row.maxDrawdown),
    signalsGenerated: row.signalsGenerated,
    signalsAccepted: row.signalsAccepted,
    signalsRejected: row.signalsRejected,
    riskRejections: row.riskRejections,
    simulatedOrders: row.simulatedOrders,
    simulatedFills: row.simulatedFills,
    strategyErrors: row.strategyErrors,
    isSimulated: true,
    disclaimer: SIMULATION_DISCLAIMER,
    startedAt: requiredIso(row.startedAt),
    stoppedAt: iso(row.stoppedAt),
    stopReason: row.stopReason,
    errorCode: row.errorCode,
  };
}

export interface PaperSnapshotRow {
  sequence: number;
  capturedAtMicros: bigint;
  cash: Prisma.Decimal;
  positionQuantity: Prisma.Decimal;
  positionValue: Prisma.Decimal | null;
  equity: Prisma.Decimal;
  realisedPnl: Prisma.Decimal;
  unrealisedPnl: Prisma.Decimal | null;
  feesPaid: Prisma.Decimal;
  drawdown: Prisma.Decimal;
}

export function toPaperSnapshotView(row: PaperSnapshotRow): PaperSnapshotView {
  return {
    sequence: row.sequence,
    capturedAtMicros: requiredBigint(row.capturedAtMicros),
    cash: requiredDecimal(row.cash),
    positionQuantity: requiredDecimal(row.positionQuantity),
    positionValue: decimal(row.positionValue),
    equity: requiredDecimal(row.equity),
    realisedPnl: requiredDecimal(row.realisedPnl),
    unrealisedPnl: decimal(row.unrealisedPnl),
    feesPaid: requiredDecimal(row.feesPaid),
    drawdown: requiredDecimal(row.drawdown),
    isSimulated: true,
  };
}
