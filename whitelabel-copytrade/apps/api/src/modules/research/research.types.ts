/**
 * Canonical research domain types: dataset, strategy version, backtest run, paper session, signal, metric, equity curve, benchmark, validation state, and promotion state.
 */

export enum ResearchStatus {
  DRAFT = 'DRAFT',
  VALIDATING = 'VALIDATING',
  VALID = 'VALID',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  INVALIDATED = 'INVALIDATED',
  ARCHIVED = 'ARCHIVED',
  PROMOTED = 'PROMOTED',
}

export enum ResearchDatasetStatus {
  DRAFT = 'DRAFT',
  VALIDATING = 'VALIDATING',
  VALID = 'VALID',
  INVALID = 'INVALID',
  ARCHIVED = 'ARCHIVED',
}

export enum ResearchStrategyVersionStatus {
  DRAFT = 'DRAFT',
  VALIDATING = 'VALIDATING',
  VALID = 'VALID',
  FROZEN = 'FROZEN',
  PUBLISHED = 'PUBLISHED',
  DEPRECATED = 'DEPRECATED',
  ARCHIVED = 'ARCHIVED',
}

export enum ResearchBacktestStatus {
  QUEUED = 'QUEUED',
  VALIDATING = 'VALIDATING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum ResearchPaperSessionStatus {
  CREATED = 'CREATED',
  STARTING = 'STARTING',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  STOPPED = 'STOPPED',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
}

export enum ResearchPaperOrderStatus {
  PENDING = 'PENDING',
  OPEN = 'OPEN',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  FILLED = 'FILLED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

export enum ResearchSignalState {
  DRAFT = 'DRAFT',
  VALID = 'VALID',
  PUBLISHED = 'PUBLISHED',
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
  REJECTED = 'REJECTED',
  FILTERED = 'FILTERED',
}

export enum ResearchPromotionState {
  DRAFT = 'DRAFT',
  PENDING_BACKTEST_VALIDATION = 'PENDING_BACKTEST_VALIDATION',
  PENDING_OUT_OF_SAMPLE = 'PENDING_OUT_OF_SAMPLE',
  PENDING_PAPER_TRADING = 'PENDING_PAPER_TRADING',
  PENDING_RISK_REVIEW = 'PENDING_RISK_REVIEW',
  PENDING_COMPLIANCE_REVIEW = 'PENDING_COMPLIANCE_REVIEW',
  PENDING_PUBLICATION = 'PENDING_PUBLICATION',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  PROMOTED = 'PROMOTED',
  ARCHIVED = 'ARCHIVED',
}

export enum ResearchSignalSide {
  BUY = 'BUY',
  SELL = 'SELL',
  HOLD = 'HOLD',
  CLOSE_LONG = 'CLOSE_LONG',
  CLOSE_SHORT = 'CLOSE_SHORT',
}

export interface DatasetFingerprint {
  fingerprint: string;
  checksum: string | null;
  recordCount: number;
  startTime: string;
  endTime: string;
  venue: string;
  symbol: string;
  timeframe: string;
  timezone: string;
  source: string;
}

export interface ResearchDataset {
  datasetId: string;
  tenantId: string;
  name: string;
  description: string | null;
  venue: string;
  symbol: string;
  timeframe: string;
  timezone: string;
  source: string;
  sourceMetadata: Record<string, any>;
  startTime: string;
  endTime: string;
  fingerprint: string;
  checksum: string | null;
  status: ResearchDatasetStatus;
  recordCount: number;
  gapCount: number;
  duplicateCount: number;
  validationResult: Record<string, any> | null;
  qualityScore: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchStrategyVersion {
  versionId: string;
  tenantId: string;
  strategyId: string | null;
  traderStrategyId: string | null;
  definitionId: string | null;
  version: string;
  name: string;
  description: string | null;
  status: ResearchStrategyVersionStatus;
  logicHash: string;
  configHash: string;
  fingerprint: string;
  parameters: Record<string, any>;
  riskProfile: Record<string, any>;
  executionModel: Record<string, any>;
  frozenAt: string | null;
  publishedAt: string | null;
  deprecatedAt: string | null;
  parentVersionId: string | null;
  changeNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchBacktestRun {
  runId: string;
  tenantId: string;
  strategyVersionId: string;
  datasetId: string | null;
  datasetFingerprint: string | null;
  status: ResearchBacktestStatus;
  config: Record<string, any>;
  configFingerprint: string;
  timeframe: string;
  symbols: string[];
  startTime: string;
  endTime: string;
  initialCapital: string;
  quoteCurrency: string;
  feeAssumption: Record<string, any>;
  slippageAssumption: Record<string, any>;
  latencyAssumption: Record<string, any>;
  leverage: string | null;
  benchmark: string | null;
  executionModel: Record<string, any>;
  runIdentifier: string;
  resultSummary: Record<string, any> | null;
  metrics: Record<string, any> | null;
  equityCurve: EquityCurvePoint[] | null;
  errorCode: string | null;
  errorSummary: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  isSimulated: true;
  disclaimer: string;
}

export interface EquityCurvePoint {
  timestamp: string;
  sequence: number;
  equity: string;
  cash: string;
  exposure: string | null;
  realizedPnl: string;
  unrealizedPnl: string | null;
  drawdown: string | null;
  highWaterMark: string | null;
  isSimulated: true;
}

export interface ResearchMetric {
  name: string;
  value: string | null;
  unit: string;
  methodology: string;
  observationCount: number;
  isSufficient: boolean;
  note: string | null;
  isSimulated: true;
}

export interface BenchmarkResult {
  benchmarkSymbol: string;
  benchmarkReturn: string | null;
  strategyReturn: string | null;
  excessReturn: string | null;
  correlation: string | null;
  beta: string | null;
  alpha: string | null;
  periodStart: string;
  periodEnd: string;
  methodology: string;
  isSimulated: true;
}

export interface WalkForwardWindow {
  windowId: string;
  type: 'TRAINING' | 'VALIDATION' | 'TEST';
  startTime: string;
  endTime: string;
  trainingStart: string | null;
  trainingEnd: string | null;
  isOutOfSample: boolean;
}

export interface WalkForwardResult {
  runId: string;
  tenantId: string;
  strategyVersionId: string;
  mode: 'ROLLING' | 'EXPANDING';
  windows: WalkForwardWindow[];
  aggregatedMetrics: Record<string, any>;
  outOfSampleMetrics: Record<string, any>;
  leakageProtected: boolean;
  createdAt: string;
  isSimulated: true;
}

export interface MonteCarloResult {
  runId: string;
  tenantId: string;
  backtestRunId: string;
  iterations: number;
  seed: string | null;
  method: 'TRADE_ORDER_PERMUTATION' | 'RETURN_RESAMPLING' | 'DRAWDOWN_DISTRIBUTION';
  percentiles: Record<string, string>;
  distribution: string[];
  summary: Record<string, any>;
  createdAt: string;
  isSimulated: true;
  disclaimer: string;
}

export interface ParameterSweepResult {
  sweepId: string;
  tenantId: string;
  strategyVersionId: string;
  combinations: number;
  results: { parameters: Record<string, any>; metrics: Record<string, any>; fingerprint: string }[];
  bestResult: { parameters: Record<string, any>; metrics: Record<string, any>; fingerprint: string } | null;
  ranking: string[];
  overfittingRisk: string | null;
  createdAt: string;
  isSimulated: true;
}

export interface ResearchPaperSession {
  sessionId: string;
  tenantId: string;
  strategyVersionId: string;
  status: ResearchPaperSessionStatus;
  sessionIdentifier: string;
  config: Record<string, any>;
  initialCapital: string;
  currentEquity: string | null;
  symbols: string[];
  timeframe: string;
  realizedPnl: string;
  unrealizedPnl: string | null;
  maxDrawdown: string | null;
  feesPaid: string;
  isSimulated: true;
  disclaimer: string;
  startedAt: string | null;
  stoppedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchPaperOrder {
  orderId: string;
  tenantId: string;
  sessionId: string;
  clientOrderId: string;
  symbol: string;
  side: string;
  type: string;
  status: ResearchPaperOrderStatus;
  quantity: string;
  price: string | null;
  stopPrice: string | null;
  filledQuantity: string;
  averageFillPrice: string | null;
  fee: string;
  isSimulated: true;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchPaperFill {
  fillId: string;
  tenantId: string;
  sessionId: string;
  orderId: string;
  tradeId: string | null;
  symbol: string;
  side: string;
  quantity: string;
  price: string;
  fee: string;
  isMaker: boolean;
  isSimulated: true;
  timestamp: string;
  createdAt: string;
}

export interface ResearchPromotion {
  promotionId: string;
  tenantId: string;
  strategyVersionId: string;
  state: ResearchPromotionState;
  backtestRunId: string | null;
  paperSessionId: string | null;
  validationChecklist: Record<string, any>;
  riskReview: Record<string, any> | null;
  complianceReview: Record<string, any> | null;
  requestedBy: string | null;
  reviewedBy: string | null;
  requestedAt: string | null;
  reviewedAt: string | null;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export const RESEARCH_DISCLAIMER =
  'Simulated result. Backtest performance is not indicative of future performance; paper performance is not indicative of live performance; simulation does not guarantee real execution quality.';

export function isDecimalString(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value.trim());
}
