/**
 * Part 16 — Institutional Risk Management Canonical Types
 *
 * Single source of truth for risk state machine, decision, dimensions,
 * metric values, and auditable rule references.
 *
 * Disciplines:
 *  - Every automated decision includes ruleId, policyVersion, timestamp,
 *    current value, threshold, severity, reason — explainable by construction.
 *  - Decimal values are STRINGS, never floats. Arithmetic is Decimal-safe via
 *    canonical helpers (scaled BigInt). No fake values: UNKNOWN/STALE when
 *    source missing.
 *  - No executable expressions in policy, structured JSON only.
 *  - Fail-closed: missing/stale critical source → REVIEW_REQUIRED/BLOCK per policy.
 *  - VaR/stress labeled RISK_ESTIMATE, not guaranteed loss.
 */

export enum RiskState {
  NORMAL = 'NORMAL',
  WATCH = 'WATCH',
  ELEVATED = 'ELEVATED',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
  BLOCKED = 'BLOCKED',
  UNKNOWN = 'UNKNOWN',
  STALE = 'STALE',
}

export enum RiskDecision {
  ALLOW = 'ALLOW',
  REDUCE = 'REDUCE',
  REVIEW_REQUIRED = 'REVIEW_REQUIRED',
  BLOCK = 'BLOCK',
  PAUSE = 'PAUSE',
  STOP_COPY = 'STOP_COPY',
  KILL_SWITCH_REQUIRED = 'KILL_SWITCH_REQUIRED',
}

export enum RiskDimension {
  EXPOSURE = 'EXPOSURE',
  POSITION = 'POSITION',
  MARGIN = 'MARGIN',
  LEVERAGE = 'LEVERAGE',
  LIQUIDATION = 'LIQUIDATION',
  CONCENTRATION = 'CONCENTRATION',
  DRAWDOWN = 'DRAWDOWN',
  DAILY_LOSS = 'DAILY_LOSS',
  CORRELATION = 'CORRELATION',
  VAR = 'VAR',
  STRESS = 'STRESS',
  MARKET_DATA = 'MARKET_DATA',
  EXCHANGE_HEALTH = 'EXCHANGE_HEALTH',
  EXECUTION_HEALTH = 'EXECUTION_HEALTH',
  COMPLIANCE = 'COMPLIANCE',
  SECURITY = 'SECURITY',
}

export enum RiskSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
  EMERGENCY = 'EMERGENCY',
}

export enum CircuitBreakerScope {
  SYMBOL = 'SYMBOL',
  STRATEGY = 'STRATEGY',
  TRADER = 'TRADER',
  ACCOUNT = 'ACCOUNT',
  TENANT = 'TENANT',
  VENUE = 'VENUE',
  PLATFORM = 'PLATFORM',
}

export enum CircuitBreakerState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export enum RiskPolicyScope {
  PLATFORM = 'PLATFORM',
  TENANT = 'TENANT',
  TRADER = 'TRADER',
  STRATEGY = 'STRATEGY',
  FOLLOWER = 'FOLLOWER',
}

// ---------- Deterministic rule reference ----------

export interface RiskRuleReference {
  ruleId: string; // e.g. MAX_GROSS_EXPOSURE, MAX_LEVERAGE, MAX_DRAWDOWN_PCT, MAX_CONCENTRATION_SYMBOL_PCT, DAILY_LOSS_LIMIT, LIQUIDATION_DISTANCE, CORRELATION_LIMIT, VAR_LIMIT, STRESS_LOSS_LIMIT, MARKET_DATA_STALE, EXCHANGE_HEALTH_DEGRADED, EXECUTION_FAILURE_BURST, COMPLIANCE_BLOCK, SECURITY_BLOCK
  policyVersion: string; // sha256 digest or version string, never ambiguous
  timestamp: string; // ISO string, UTC
  current: string | null; // Decimal string or null when UNKNOWN
  threshold: string | null; // Decimal string or null when not applicable
  severity: RiskSeverity;
  reason: string; // human explainable, bounded
  dimension: RiskDimension;
  scope: RiskPolicyScope;
  scopeId: string | null;
}

// ---------- Generic metric ----------

export interface RiskMetricValue {
  value: string | null; // Decimal string, null = UNKNOWN/INSUFFICIENT
  valuePercent?: string | null;
  threshold: string | null;
  thresholdPercent?: string | null;
  status: RiskState;
  isStale: boolean;
  isUnknown: boolean;
  lastUpdatedAt: string | null; // ISO
  sourceTimestamp: string | null; // when underlying canonical source was observed
  ruleId: string;
  policyVersion: string;
  reason: string;
  severity: RiskSeverity;
}

// ---------- Exposure ----------

export interface SymbolExposure {
  symbol: string;
  venue: string | null;
  baseAsset: string | null;
  quoteAsset: string | null;
  longNotional: string; // Decimal string
  shortNotional: string;
  netNotional: string;
  grossNotional: string;
  openOrderNotional: string;
  totalExposure: string; // positions + open orders
  concentrationPercent: string | null; // vs total gross
  price: string | null; // mark price used
  priceTimestamp: string | null;
  isStale: boolean;
}

export interface VenueExposure {
  venue: string;
  grossNotional: string;
  netNotional: string;
  concentrationPercent: string | null;
  accountCount: number;
  symbolCount: number;
}

export interface AccountExposure {
  accountId: string;
  venue: string;
  grossNotional: string;
  netNotional: string;
  longNotional: string;
  shortNotional: string;
  openOrderNotional: string;
  totalExposure: string;
  symbolCount: number;
}

export interface PortfolioExposure {
  tenantId: string;
  asOf: string; // ISO
  policyVersion: string;
  grossExposure: string;
  netExposure: string;
  longExposure: string;
  shortExposure: string;
  openOrderExposure: string;
  totalExposure: string; // gross + open orders or policy defined
  notionalUtilizationPercent: string | null;
  symbolExposures: SymbolExposure[];
  venueExposures: VenueExposure[];
  accountExposures: AccountExposure[];
  strategyExposures: Array<{ strategyId: string; grossNotional: string; netNotional: string; traderId?: string | null }>;
  traderExposures: Array<{ traderId: string; grossNotional: string; netNotional: string }>;
  followerExposures: Array<{ followerId: string; grossNotional: string; netNotional: string }>;
  staleSymbols: string[];
  unknownPrices: string[];
  sourceTimestamps: Record<string, string>; // e.g. positions@2024, balances@...
  state: RiskState;
  warnings: string[];
}

// ---------- Position risk ----------

export interface PositionRiskResult {
  tenantId: string;
  accountId: string;
  symbol: string;
  venue: string;
  quantity: string; // signed
  side: string; // LONG/SHORT/FLAT
  entryPrice: string | null;
  markPrice: string | null;
  notional: string | null; // qty * mark or entry
  unrealizedPnl: string | null;
  realizedPnl: string;
  leverage: string | null;
  marginPressurePercent: string | null;
  liquidationDistancePercent: string | null; // null = UNKNOWN when venue does not provide authoritative
  liquidationPrice: string | null; // only when authoritative
  isLiquidationAuthoritative: boolean;
  concentrationPercent: string | null;
  state: RiskState;
  ruleId: string;
  policyVersion: string;
  reason: string;
  severity: RiskSeverity;
  sourceTimestamp: string | null;
  isStale: boolean;
  isUnknown: boolean;
}

// ---------- Margin risk ----------

export interface MarginRiskResult {
  tenantId: string;
  accountId: string;
  venue: string;
  walletBalance: string | null; // total
  availableBalance: string | null; // free
  lockedBalance: string | null;
  initialMargin: string | null;
  maintenanceMargin: string | null;
  marginUtilizationPercent: string | null; // used / wallet
  projectedMarginUtilizationPercent: string | null; // after order intent
  freeMargin: string | null;
  warnings: string[];
  state: RiskState;
  ruleId: string;
  policyVersion: string;
  reason: string;
  severity: RiskSeverity;
  sourceTimestamp: string | null;
  isStale: boolean;
}

// ---------- Leverage risk ----------

export interface LeverageRiskResult {
  tenantId: string;
  accountId: string;
  venue: string;
  symbol: string | null; // null = account level
  grossLeverage: string | null; // grossNotional / equity
  netLeverage: string | null;
  projectedGrossLeverage: string | null;
  projectedNetLeverage: string | null;
  exchangeMaxLeverage: string | null;
  policyMaxLeverage: string | null;
  isBreach: boolean;
  state: RiskState;
  ruleId: string;
  policyVersion: string;
  reason: string;
  severity: RiskSeverity;
}

// ---------- Liquidation risk ----------

export interface LiquidationRiskResult {
  tenantId: string;
  accountId: string;
  symbol: string | null;
  venue: string;
  markPrice: string | null;
  liquidationPrice: string | null; // authoritative only
  distancePercent: string | null; // (mark - liq)/mark * 100
  distanceAbs: string | null;
  pressure: RiskState; // WATCH/ELEVATED/HIGH/CRITICAL
  isWarning: boolean;
  isCritical: boolean;
  isAuthoritative: boolean;
  state: RiskState;
  ruleId: string;
  policyVersion: string;
  reason: string;
  severity: RiskSeverity;
  sourceTimestamp: string | null;
}

// ---------- Concentration ----------

export interface ConcentrationResult {
  tenantId: string;
  dimension: 'ASSET' | 'SYMBOL' | 'VENUE' | 'ACCOUNT' | 'STRATEGY' | 'TRADER' | 'FOLLOWER';
  key: string; // e.g. BTC, BTC-USDT, BINANCE, accountId
  currentPercent: string; // 0-100
  currentNotional: string;
  thresholdPercent: string;
  isBreach: boolean;
  state: RiskState;
  ruleId: string;
  policyVersion: string;
  reason: string;
  severity: RiskSeverity;
}

// ---------- Drawdown ----------

export interface DrawdownResult {
  tenantId: string;
  scope: RiskPolicyScope;
  scopeId: string;
  highWaterMark: string | null; // equity HWM, decimal string
  currentEquity: string | null;
  drawdownAbs: string | null; // HWM - current
  drawdownPercent: string | null;
  intradayDrawdownPercent: string | null;
  rollingDrawdownPercent: string | null;
  thresholdPercent: string | null;
  isBreach: boolean;
  isRecovery: boolean;
  state: RiskState;
  ruleId: string;
  policyVersion: string;
  reason: string;
  severity: RiskSeverity;
  lastHighWaterMarkAt: string | null;
  sourceTimestamp: string | null;
}

// ---------- Daily loss ----------

export interface DailyLossResult {
  tenantId: string;
  scope: RiskPolicyScope;
  scopeId: string;
  tradingDay: string; // YYYY-MM-DD UTC
  startingEquity: string | null;
  currentEquity: string | null;
  realizedPnl: string | null;
  unrealizedPnl: string | null; // only if policy includes
  dailyPnl: string | null; // per policy (realized or realized+unrealized)
  threshold: string | null; // max daily loss allowed, positive number
  remainingBudget: string | null;
  isBreach: boolean;
  state: RiskState;
  ruleId: string;
  policyVersion: string;
  reason: string;
  severity: RiskSeverity;
  resetAt: string; // next UTC reset ISO
  sourceTimestamp: string | null;
}

// ---------- Correlation ----------

export interface CorrelationResult {
  tenantId: string;
  method: string; // e.g. PEARSON_30D
  methodVersion: string;
  lookbackDays: number;
  minObservations: number;
  observations: number;
  pairKey: string; // e.g. BTC-USDT:ETH-USDT or STRATEGY_A:STRATEGY_B
  correlation: string | null; // -1 to 1 decimal string, null = UNKNOWN
  threshold: string | null;
  isBreach: boolean;
  state: RiskState;
  ruleId: string;
  policyVersion: string;
  reason: string;
  severity: RiskSeverity;
  isUnknown: boolean;
}

// ---------- VaR ----------

export interface VarResult {
  tenantId: string;
  methodology: string; // HISTORICAL_SIMULATION
  confidence: string; // e.g. 95, 99
  horizonDays: number;
  windowDays: number;
  observations: number;
  minObservations: number;
  varValue: string | null; // decimal string, loss amount
  varPercent: string | null;
  varAmount: string | null;
  methodVersion: string;
  label: 'RISK_ESTIMATE'; // mandatory label, never guarantee
  isBreach: boolean;
  threshold: string | null;
  state: RiskState;
  ruleId: string;
  policyVersion: string;
  reason: string;
  severity: RiskSeverity;
  isUnknown: boolean;
  note: string; // e.g. "VaR is an estimate, not a guaranteed maximum loss"
}

// ---------- Stress test ----------

export type StressScenarioType =
  | 'MARKET_SHOCK'
  | 'GAP_MOVE'
  | 'VOL_EXPANSION'
  | 'SPREAD_WIDENING'
  | 'EXCHANGE_OUTAGE'
  | 'SLIPPAGE_EXPANSION'
  | 'LIQUIDITY_REDUCTION'
  | 'CORRELATED_SHOCK';

export interface StressScenario {
  scenarioId: string;
  type: StressScenarioType;
  name: string;
  description: string;
  parameters: Record<string, string>; // structured, decimal strings, no executable
  shockedAssets: string[]; // symbols/assets shocked
}

export interface StressTestResult {
  tenantId: string;
  scenario: StressScenario;
  asOf: string;
  policyVersion: string;
  shockedAssumptions: Record<string, string>;
  estimatedPnlImpact: string | null; // decimal string, can be negative
  estimatedExposureImpact: string | null;
  estimatedMarginImpact: string | null;
  riskLevel: RiskState;
  isBreach: boolean;
  threshold: string | null;
  ruleId: string;
  reason: string;
  severity: RiskSeverity;
  note: string; // "Stress test is a control signal, not a prediction"
}

// ---------- Risk snapshot ----------

export interface RiskSnapshot {
  id: string;
  tenantId: string;
  userId: string | null;
  traderId: string | null;
  followerId: string | null;
  accountId: string | null;
  strategyId: string | null;
  timestamp: string;
  policyVersion: string;
  policyDigest: string | null;
  state: RiskState;
  exposure: PortfolioExposure | null;
  margin: MarginRiskResult[]; // per account
  leverage: LeverageRiskResult[];
  drawdown: DrawdownResult[];
  concentration: ConcentrationResult[];
  liquidation: LiquidationRiskResult[];
  dailyLoss: DailyLossResult[];
  var: VarResult[];
  stress: StressTestResult[];
  correlation: CorrelationResult[];
  circuitBreakers: CircuitBreakerStatus[];
  killSwitch: { isEngaged: boolean; scope: string | null; reason: string | null } | null;
  metricValues: Record<string, string | null>; // canonical metric values
  sourceTimestamps: Record<string, string>;
}

// ---------- Circuit breaker ----------

export interface CircuitBreakerStatus {
  id: string;
  tenantId: string | null;
  scope: CircuitBreakerScope;
  scopeId: string;
  state: CircuitBreakerState;
  triggerType: string;
  triggerRuleId: string | null;
  reason: string;
  policyVersion: string;
  triggeredAt: string | null;
  clearedAt: string | null;
  halfOpenAt: string | null;
  triggeredByUserId: string | null;
  clearedByUserId: string | null;
}

// ---------- Unified decision ----------

export interface RiskDecisionDetail {
  dimension: RiskDimension;
  decision: RiskDecision;
  state: RiskState;
  ruleId: string;
  policyVersion: string;
  current: string | null;
  threshold: string | null;
  severity: RiskSeverity;
  reason: string;
  timestamp: string;
  scope: RiskPolicyScope;
  scopeId: string | null;
  isBlocking: boolean;
  isWarning: boolean;
}

export interface UnifiedRiskDecision {
  id: string;
  tenantId: string;
  userId: string | null;
  accountId: string | null;
  symbol: string | null;
  venue: string | null;
  traderId: string | null;
  followerId: string | null;
  strategyId: string | null;
  orderIntentId: string | null;
  decision: RiskDecision; // final
  state: RiskState; // final overall
  blockingReasons: string[];
  warnings: string[];
  details: RiskDecisionDetail[]; // per dimension
  policies: Array<{ scope: RiskPolicyScope; scopeId: string | null; version: string; digest: string | null }>;
  ruleIds: string[];
  policyVersion: string; // effective version
  timestamp: string;
  requestId: string | null;
  environment: string; // PAPER/LIVE
  complianceDecision: string | null;
  securityDecision: string | null;
  exchangeHealth: string | null;
  circuitBreaker: CircuitBreakerStatus[] | null;
  killSwitch: { isEngaged: boolean; scope: string | null } | null;
}

// ---------- Risk events ----------

export enum RiskEventType {
  RISK_THRESHOLD_BREACHED = 'RISK_THRESHOLD_BREACHED',
  EXPOSURE_LIMIT_BREACHED = 'EXPOSURE_LIMIT_BREACHED',
  MARGIN_WARNING = 'MARGIN_WARNING',
  LIQUIDATION_WARNING = 'LIQUIDATION_WARNING',
  LEVERAGE_LIMIT_BREACHED = 'LEVERAGE_LIMIT_BREACHED',
  CONCENTRATION_BREACH = 'CONCENTRATION_BREACH',
  DRAWDOWN_BREACH = 'DRAWDOWN_BREACH',
  DAILY_LOSS_BREACH = 'DAILY_LOSS_BREACH',
  CORRELATION_WARNING = 'CORRELATION_WARNING',
  VAR_BREACH = 'VAR_BREACH',
  STRESS_BREACH = 'STRESS_BREACH',
  MARKET_DATA_STALE = 'MARKET_DATA_STALE',
  EXCHANGE_HEALTH_DEGRADED = 'EXCHANGE_HEALTH_DEGRADED',
  EXECUTION_FAILURE_BURST = 'EXECUTION_FAILURE_BURST',
  CIRCUIT_BREAKER_TRIGGERED = 'CIRCUIT_BREAKER_TRIGGERED',
  KILL_SWITCH_REQUESTED = 'KILL_SWITCH_REQUESTED',
}

export interface RiskEvent {
  id: string;
  tenantId: string;
  type: RiskEventType;
  ruleId: string;
  policyVersion: string;
  scope: RiskPolicyScope;
  scopeId: string | null;
  accountId: string | null;
  strategyId: string | null;
  traderId: string | null;
  followerId: string | null;
  symbol: string | null;
  venue: string | null;
  severity: RiskSeverity;
  message: string;
  current: string | null;
  threshold: string | null;
  sourceRefs: Record<string, string>;
  timestamp: string;
  requestId: string | null;
}

// ---------- Effective policy ----------

export interface RiskPolicyThresholds {
  maxGrossExposure: string | null;
  maxNetExposure: string | null;
  maxSymbolExposure: string | null;
  maxVenueExposure: string | null;
  maxAccountExposure: string | null;
  maxStrategyExposure: string | null;
  maxTraderExposure: string | null;
  maxFollowerExposure: string | null;
  maxPositionNotional: string | null;
  maxOrderNotional: string | null;
  maxOpenOrders: number | null;
  maxLeverageGross: string | null;
  maxLeverageNet: string | null;
  maxLeverageSymbol: string | null;
  maxLeverageAccount: string | null;
  marginWarningUtilization: string | null; // 0-100
  marginCriticalUtilization: string | null;
  liquidationWarningDistance: string | null; // %
  liquidationCriticalDistance: string | null;
  maxConcentrationAssetPercent: string | null;
  maxConcentrationSymbolPercent: string | null;
  maxConcentrationVenuePercent: string | null;
  maxConcentrationAccountPercent: string | null;
  maxConcentrationStrategyPercent: string | null;
  maxConcentrationTraderPercent: string | null;
  maxConcentrationFollowerPercent: string | null;
  maxDrawdownPercent: string | null;
  maxIntradayDrawdownPercent: string | null;
  maxDailyLoss: string | null;
  dailyLossIncludesUnrealized: boolean;
  maxCorrelation: string | null;
  correlationLookbackDays: number;
  correlationMinObservations: number;
  varConfidence: string | null; // 95, 99
  varHorizonDays: number;
  varWindowDays: number;
  varMinObservations: number;
  varThreshold: string | null;
  stressLossThreshold: string | null;
  marketDataMaxAgeMs: number;
  exchangeHealthMaxAgeMs: number;
  executionFailureBurstThreshold: number;
  executionFailureWindowMs: number;
  circuitBreakerLossThreshold: string | null;
  circuitBreakerDrawdownThreshold: string | null;
  circuitBreakerEnabled: boolean;
  killSwitchEnabled: boolean;
  allowRiskReducingOrders: boolean;
}

export interface EffectiveRiskPolicy {
  tenantId: string | null; // null = platform
  scopeChain: Array<{ scope: RiskPolicyScope; scopeId: string | null; version: number; digest: string }>;
  effectiveVersion: string; // sha256 over chain
  effectiveDigest: string;
  thresholds: RiskPolicyThresholds;
  ruleIds: string[];
  precedence: RiskPolicyScope[]; // PLATFORM -> TENANT -> TRADER -> STRATEGY -> FOLLOWER
  resolvedAt: string;
  sourcePolicies: Array<{ scope: RiskPolicyScope; scopeId: string | null; version: number; digest: string; thresholds: Partial<RiskPolicyThresholds> }>;
}

// ---------- Reconciliation ----------

export interface ReconciliationFinding {
  id: string;
  tenantId: string;
  accountId: string | null;
  category: string;
  severity: string;
  expected: Record<string, string | null> | null;
  actual: Record<string, string | null> | null;
  summary: string;
  policyVersion: string | null;
  timestamp: string;
  resolved: boolean;
}

// ---------- Decimal-safe helpers types ----------

export interface DecimalSafe {
  isValidDecimalString(value: string): boolean;
  parseDecimal(value: string): bigint; // scaled by 1e12
  formatDecimal(scaled: bigint): string;
  add(a: string, b: string): string;
  sub(a: string, b: string): string;
  mul(a: string, b: string): string;
  div(a: string, b: string): string;
  cmp(a: string, b: string): number; // -1,0,1
  abs(a: string): string;
  isZero(a: string): boolean;
  isNegative(a: string): boolean;
  min(a: string, b: string): string;
  max(a: string, b: string): string;
  toPercent(part: string, whole: string): string | null;
}
