// # Adds typed client methods and types for trader performance detail and trade history breakdown
// # Adds trader comparison query helper
// # Extends trader list and leaderboard filter parameters
// # Adds strategy analytics and trade breakdown client helpers
// # Adds subscription policy and risk settings update methods
// # Adds subscription detail and summary client methods
// # Adds subscription-scoped copied positions query helper
// # Adds subscription-scoped copied order and execution history helpers
// # Adds execution detail query helper with risk and OMS metadata
// # Adds follower risk policy read/update helpers
// # Adds customer-safe reconciliation status query helper
import { Permission } from "@wlct/shared-types";
import { compareDecimalStringsDescending } from "@/lib/decimal-compare";
import { apiClient } from "./api-client";
import { ApiError } from "./api-errors";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import { permissionsAllowAny } from "@/auth/permissions";

/**
 * Copy-trading client for /v1/copy-trading.
 *
 * Types mirror the API records; parsers tolerate missing fields so a partial
 * record never crashes a page. Financial amounts stay decimal strings.
 */

type Raw = Record<string, unknown>;

export type CopySizingMode = "PROPORTIONAL" | "FIXED" | "PERCENTAGE_BALANCE";
export type CopySubscriptionState = "PENDING" | "ACTIVE" | "PAUSED" | "STOPPED" | "CANCELLED" | "EXPIRED";
export type StrategyStatus =
  | "DRAFT"
  | "PENDING_VALIDATION"
  | "VALIDATED"
  | "PUBLISHED"
  | "PAUSED"
  | "ARCHIVED"
  | "REJECTED";
export type CopyExecutionStatus =
  | "PENDING"
  | "VALIDATED"
  | "MAPPED"
  | "RISK_CHECKED"
  | "ROUTED"
  | "SUBMITTED"
  | "FILLED"
  | "FAILED"
  | "REJECTED"
  | "SKIPPED"
  | "BLOCKED";
export type CopyRiskDecision = "ALLOW" | "REDUCE" | "BLOCK" | "PAUSE" | "STOP_COPY";

export interface TraderProfile {
  traderId: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  verificationState: string;
  verifiedAt: string | null;
  supportedVenues: string[];
  supportedSymbols: string[];
  isPublic: boolean;
  isFeatured: boolean;
  followerCount: number;
  totalVolume: string;
  totalTrades: number;
  createdAt: string;
  publicMetrics?: TraderProfilePublicMetrics | null;
  viewerIsOwner?: boolean;
}

export interface TraderPerformance {
  traderId: string;
  tenantId: string;
  realizedPnl: string;
  unrealizedPnl: string | null;
  totalReturn: string | null;
  totalReturnPercent: string | null;
  maxDrawdown: string | null;
  maxDrawdownPercent: string | null;
  winCount: number;
  lossCount: number;
  tradeCount: number;
  winRate: string | null;
  lossRate: string | null;
  totalVolume: string;
  averageTrade: string | null;
  averageWin: string | null;
  averageLoss: string | null;
  profitFactor: string | null;
  sharpeRatio: string | null;
  historyLengthDays: number;
  lastTradeAt: string | null;
  isActual: boolean;
  source: string;
}

export interface TraderPerformanceDetail {
  profile: TraderProfile;
  performance: TraderPerformance;
  strategies: Strategy[];
}

/**
 * Trader verification states, mirroring TraderVerificationState in the API. The page imported this
 * name before it existed here, so the traders page did not typecheck and its verification filter was
 * untyped.
 */
export type TraderVerificationState = "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED" | "SUSPENDED";

export const TRADER_VERIFICATION_STATES: readonly TraderVerificationState[] = [
  "UNVERIFIED",
  "PENDING",
  "VERIFIED",
  "REJECTED",
  "SUSPENDED",
];

/** The ranking windows the server accepts. Mirrors TraderRankingTimeframe in the API. */
export type TraderRankingTimeframe = "7D" | "30D" | "90D";

export const TRADER_RANKING_TIMEFRAMES: readonly TraderRankingTimeframe[] = ["7D", "30D", "90D"];

/**
 * How the ranking was produced, as reported by the server. `status` is UNAVAILABLE when no window
 * satisfied the admission rule, and `asOf` / `windowStart` are then null: the page must show that
 * the ranking is not available rather than an empty table that reads as "no traders".
 */
export interface TraderRankingMethodology {
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  key: "RECONCILED_CLOSED_PERIOD_TWR";
  description: string;
  timeframe: TraderRankingTimeframe;
  windowStart: string | null;
  asOf: string | null;
  boundaryRule: "EXACT_CONTIGUOUS_PERIODS_ONLY";
  orderingRule: "RETURN_DESCENDING_UNAVAILABLE_LAST";
  currentnessRule: string;
  minimumPeriodCount: number;
  rankedCount: number;
  unrankedCount: number;
  /** Why any row is unranked; null when every row was ranked. */
  reason: string | null;
}

export interface TraderRanking {
  traderId: string;
  tenantId: string;
  displayName: string;
  verificationState: string;
  isPublic: boolean;
  isFeatured: boolean;
  followerCount: number;
  performance: TraderPerformance | null;
  score: number | null;
  rank: number | null;
  timeframe?: "7D" | "30D" | "90D";
  periodStatus?: "AVAILABLE" | "UNAVAILABLE";
  periodReturnPercent?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  baseCurrency?: string | null;
  flowBoundary?: string | null;
  calculationVersion?: string | null;
  sourceCalculationVersion?: string | null;
  observationCount?: number | null;
  sourceReferences?: string[];
  unavailableReason?: string | null;
  rankingMethodology?: string;
  totalVolume?: string | null;
  metrics: {
    riskAdjustedReturn: number | null;
    drawdownScore: number | null;
    consistencyScore: number | null;
    historyLengthScore: number | null;
    followerScore: number | null;
    activityScore: number | null;
    verifiedScore: number | null;
  };
  weighting: Record<string, number>;
}

export interface TraderComparisonEntry {
  profile: TraderProfile;
  performance: TraderPerformance;
  strategies: Strategy[];
}

export interface TraderDiscoveryFilters {
  verificationState?: string;
  isFeatured?: boolean;
  search?: string;
  venue?: string;
  symbol?: string;
  minWinRate?: number;
  maxDrawdown?: number;
  minTrades?: number;
  minFollowers?: number;
  sortBy?: "score" | "performance" | "followers" | "volume" | "trades" | "pnl" | "winRate";
  page?: number;
  limit?: number;
}

export interface Strategy {
  strategyId: string;
  traderId: string;
  name: string;
  description: string | null;
  status: string;
  type: string;
  supportedSymbols: string[];
  supportedVenues: string[];
  followerCount: number;
  totalCopies: number;
  publishedAt: string | null;
  createdAt: string;
}

export type TraderStrategy = Strategy;

export interface CopyPolicy {
  sizingMode: CopySizingMode;
  proportionalRatio: string | null;
  fixedQuantity: string | null;
  fixedNotional: string | null;
  maxOrderNotional: string | null;
  maxPositionSize?: string | null;
  maxNotional?: string | null;
  allowedVenues?: string[] | null;
  orderTypePolicy?: string | null;
  emergencyStop?: boolean;
  maxDailyNotional: string | null;
  maxConcurrentCopies: number | null;
  slippageToleranceBps: number | null;
  executionDelayMs: number | null;
  allowedSymbols: string[] | null;
  blockedSymbols: string[] | null;
  allowedSides: string[] | null;
  leveragePolicy: string | null;
  maxLeverage?: string | null;
  marginMode?: "SPOT" | "ISOLATED" | "CROSS" | null;
  reduceOnly: boolean | null;
  takeProfitBps?: number | null;
  stopLossBps?: number | null;
  trailingStopBps?: number | null;
  stopCopyConditions: Record<string, unknown> | null;
}

export interface FollowerRiskPolicy {
  maxDailyLoss: string | null;
  maxTotalLoss: string | null;
  maxDrawdown: string | null;
  maxExposure: string | null;
  maxOpenExposure?: string | null;
  maxExposurePerTrader?: string | null;
  maxExposurePerSymbol?: string | null;
  maxDailyCopiedTrades?: number | null;
  maxPositionSize: string | null;
  maxSymbolExposure: string | null;
  maxCopyCount: number | null;
  maxLeverage?: string | null;
  minMarginRatio?: string | null;
  allowedMarginModes?: string[] | null;
  emergencyStopCopy: boolean;
  dailyPauseEnabled: boolean;
}

export interface StrategyAnalyticsView {
  strategy: Strategy;
  trader: TraderProfile | null;
  performance: TraderPerformance | null;
  traderPerformance?: TraderPerformance | null;
  effectivePolicy: CopyPolicy | null;
}

export interface CopySubscription {
  subscriptionId: string;
  traderId: string;
  strategyId: string;
  state: string;
  allocationMode: string;
  allocationAmount: string;
  maxAllocation: string | null;
  minAllocation?: string | null;
  copyPolicy?: Partial<CopyPolicy> | null;
  riskPolicy?: Partial<FollowerRiskPolicy>;
  followerAccountId?: string | null;
  totalCopies: number;
  failedCopies: number;
  totalCopiedVolume?: string;
  startedAt: string | null;
  pausedAt?: string | null;
  stoppedAt?: string | null;
  stopReason?: string | null;
  closeOpenPositionsOnStop?: boolean;
  createdAt?: string;
}

export interface CopyExecution {
  executionId: string;
  subscriptionId: string;
  strategyId?: string;
  leaderEventId: string;
  leaderOrderId: string | null;
  leaderFillId?: string | null;
  traderId: string;
  followerId: string;
  followerAccountId?: string | null;
  status: CopyExecutionStatus;
  sizingMode: string;
  leaderQuantity: string;
  leaderPrice?: string | null;
  followerQuantity: string | null;
  followerPrice?: string | null;
  slippageTolerance?: string | null;
  maxNotional?: string | null;
  followerOrderId: string | null;
  riskDecision: CopyRiskDecision | null;
  riskRuleId?: string | null;
  failureReason: string | null;
  executionIntent?: Record<string, unknown>;
  riskReasons?: string[];
  isSimulated?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CopyExecutionDisplayItem = Omit<CopyExecution, 'status'> & {
  /** Legacy history rows use RISK_BLOCKED; current server writes BLOCKED. */
  status: CopyExecutionStatus | 'RISK_BLOCKED';
};

export interface SubscriptionDetailSummary {
  subscription: CopySubscription;
  effectivePolicy: CopyPolicy;
  recentExecutions: CopyExecution[];
  reconciliation?: CustomerReconciliationStatus;
  totalExecutions: number;
}

export interface CopiedPositionItem {
  id: string; positionId: string; accountId: string; symbol: string; side: string; quantity: string;
  averageEntryPrice: string | null; markPrice: string | null; unrealizedPnl: string | null; realizedPnl: string | null;
  cumulativeFee: string | null; feeCurrency: string | null; containsSimulatedFills: boolean; fillCount: number;
  isOpen: boolean; venue: string | null; updatedAt: string;
}

export interface ExecutionOrderSummary {
  id: string;
  clientOrderId: string;
  exchangeOrderId: string | null;
  venue: string;
  symbol: string;
  side: string;
  type: string;
  status: string;
  quantity: string;
  filledQuantity: string;
  remainingQuantity: string;
  price: string | null;
  averageFillPrice: string | null;
  cumulativeFee: string;
  feeCurrency: string | null;
  isSimulated: boolean;
  rejectionCode: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

export interface CopiedOrderHistoryItem {
  executionId: string; followerOrderId: string | null; symbol: string; side: string; orderType: string;
  status: CopyExecutionStatus; orderStatus: string; filledQuantity: string | null; followerQuantity: string | null;
  averageFillPrice: string | null; fee: string | null; feeAsset: string | null; failureReason: string | null; riskReasons: string[];
  execution: CopyExecution; order: ExecutionOrderSummary | null;
}

export interface CustomerReconciliationItem {
  id: string;
  category: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  resolved: boolean;
  createdAt: string;
  leaderEventId: string;
  executionId: string | null;
  customerMessage: string;
}

export interface CustomerReconciliationStatus {
  subscriptionId: string;
  status: "SYNCED" | "PENDING_REVIEW" | "ATTENTION_REQUIRED";
  unresolvedCount: number;
  resolvedCount: number;
  lastCheckedAt: string;
  items: CustomerReconciliationItem[];
}

export interface Paged<T> {
  data: T[];
  total: number;
}

export interface TradingRestriction {
  type: string;
  reason: string;
}

export interface TradingStatus {
  /** ELIGIBLE, RESTRICTED, MAINTENANCE or NOT_PERMITTED (the role cannot copy). */
  eligibility: "ELIGIBLE" | "RESTRICTED" | "MAINTENANCE" | "NOT_PERMITTED";
  canCopy: boolean;
  restrictions: TradingRestriction[];
  maintenance: {
    active: boolean;
    message: string;
    scope: string | null;
    endsAt: string | null;
    isEmergency: boolean;
    blocksTrading: boolean;
  } | null;
}

export interface CopyEligibility {
  canCopy: boolean;
  reasons: string[];
}

const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback;
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});

export function parseTrader(input: unknown): TraderProfile {
  const r = obj(input);
  return {
    traderId: str(r.traderId ?? r.id),
    displayName: str(r.displayName, "Unnamed trader"),
    bio: strOrNull(r.bio),
    avatarUrl: strOrNull(r.avatarUrl),
    verificationState: str(r.verificationState, "UNVERIFIED"),
    verifiedAt: strOrNull(r.verifiedAt),
    supportedVenues: strList(r.supportedVenues),
    supportedSymbols: strList(r.supportedSymbols),
    isPublic: r.isPublic === true,
    isFeatured: r.isFeatured === true,
    followerCount: num(r.followerCount),
    totalVolume: str(r.totalVolume, "0"),
    totalTrades: num(r.totalTrades),
    createdAt: str(r.createdAt),
    publicMetrics: r.publicMetrics && typeof r.publicMetrics === "object" ? r.publicMetrics as TraderProfilePublicMetrics : null,
    viewerIsOwner: r.viewerIsOwner === true,
  };
}

export function parseTraderPerformance(input: unknown): TraderPerformance {
  const r = obj(input);
  return {
    traderId: str(r.traderId),
    tenantId: str(r.tenantId),
    realizedPnl: str(r.realizedPnl, "0"),
    unrealizedPnl: strOrNull(r.unrealizedPnl),
    totalReturn: strOrNull(r.totalReturn),
    totalReturnPercent: strOrNull(r.totalReturnPercent),
    maxDrawdown: strOrNull(r.maxDrawdown),
    maxDrawdownPercent: strOrNull(r.maxDrawdownPercent),
    winCount: num(r.winCount),
    lossCount: num(r.lossCount),
    tradeCount: num(r.tradeCount),
    winRate: strOrNull(r.winRate),
    lossRate: strOrNull(r.lossRate),
    totalVolume: str(r.totalVolume, "0"),
    averageTrade: strOrNull(r.averageTrade),
    averageWin: strOrNull(r.averageWin),
    averageLoss: strOrNull(r.averageLoss),
    profitFactor: strOrNull(r.profitFactor),
    sharpeRatio: strOrNull(r.sharpeRatio),
    historyLengthDays: num(r.historyLengthDays),
    lastTradeAt: strOrNull(r.lastTradeAt),
    isActual: r.isActual !== false,
    source: str(r.source, "FILLS"),
  };
}

export function parseStrategy(input: unknown): Strategy {
  const r = obj(input);
  return {
    strategyId: str(r.strategyId ?? r.id),
    traderId: str(r.traderId),
    name: str(r.name, "Unnamed strategy"),
    description: strOrNull(r.description),
    status: str(r.status, "DRAFT"),
    type: str(r.type, "MANUAL"),
    supportedSymbols: strList(r.supportedSymbols),
    supportedVenues: strList(r.supportedVenues),
    followerCount: num(r.followerCount),
    totalCopies: num(r.totalCopies),
    publishedAt: strOrNull(r.publishedAt),
    createdAt: str(r.createdAt),
  };
}

export function parseCopyPolicy(input: unknown): CopyPolicy {
  const r = obj(input);
  const sizingModeRaw = str(r.sizingMode, "PROPORTIONAL");
  const sizingMode: CopySizingMode =
    sizingModeRaw === "FIXED" || sizingModeRaw === "PERCENTAGE_BALANCE" ? sizingModeRaw : "PROPORTIONAL";
  const marginModeRaw = strOrNull(r.marginMode);
  const marginMode =
    marginModeRaw === "SPOT" || marginModeRaw === "ISOLATED" || marginModeRaw === "CROSS" ? marginModeRaw : null;
  return {
    sizingMode,
    proportionalRatio: strOrNull(r.proportionalRatio),
    fixedQuantity: strOrNull(r.fixedQuantity),
    fixedNotional: strOrNull(r.fixedNotional),
    maxOrderNotional: strOrNull(r.maxOrderNotional),
    maxPositionSize: strOrNull(r.maxPositionSize),
    maxNotional: strOrNull(r.maxNotional ?? r.maxOrderNotional),
    allowedVenues: Array.isArray(r.allowedVenues) ? strList(r.allowedVenues) : null,
    orderTypePolicy: strOrNull(r.orderTypePolicy),
    maxDailyNotional: strOrNull(r.maxDailyNotional),
    maxConcurrentCopies: numOrNull(r.maxConcurrentCopies),
    slippageToleranceBps: numOrNull(r.slippageToleranceBps),
    executionDelayMs: numOrNull(r.executionDelayMs),
    allowedSymbols: Array.isArray(r.allowedSymbols) ? strList(r.allowedSymbols) : null,
    blockedSymbols: Array.isArray(r.blockedSymbols) ? strList(r.blockedSymbols) : null,
    allowedSides: Array.isArray(r.allowedSides) ? strList(r.allowedSides) : null,
    leveragePolicy: strOrNull(r.leveragePolicy),
    maxLeverage: strOrNull(r.maxLeverage),
    marginMode,
    reduceOnly: typeof r.reduceOnly === "boolean" ? r.reduceOnly : null,
    takeProfitBps: numOrNull(r.takeProfitBps),
    stopLossBps: numOrNull(r.stopLossBps),
    trailingStopBps: numOrNull(r.trailingStopBps),
    stopCopyConditions: r.stopCopyConditions && typeof r.stopCopyConditions === "object" ? obj(r.stopCopyConditions) : null,
  };
}

export function parseFollowerRiskPolicy(input: unknown): FollowerRiskPolicy {
  const r = obj(input);
  return {
    maxDailyLoss: strOrNull(r.maxDailyLoss),
    maxTotalLoss: strOrNull(r.maxTotalLoss),
    maxDrawdown: strOrNull(r.maxDrawdown),
    maxExposure: strOrNull(r.maxExposure),
    maxOpenExposure: strOrNull(r.maxOpenExposure ?? r.maxExposure),
    maxDailyCopiedTrades: numOrNull(r.maxDailyCopiedTrades),
    maxPositionSize: strOrNull(r.maxPositionSize),
    maxSymbolExposure: strOrNull(r.maxSymbolExposure),
    maxCopyCount: numOrNull(r.maxCopyCount),
    maxLeverage: strOrNull(r.maxLeverage),
    minMarginRatio: strOrNull(r.minMarginRatio),
    allowedMarginModes: Array.isArray(r.allowedMarginModes) ? strList(r.allowedMarginModes) : null,
    emergencyStopCopy: r.emergencyStopCopy === true,
    dailyPauseEnabled: r.dailyPauseEnabled === true,
  };
}

export function parseSubscription(input: unknown): CopySubscription {
  const r = obj(input);
  return {
    subscriptionId: str(r.subscriptionId ?? r.id),
    traderId: str(r.traderId),
    strategyId: str(r.strategyId),
    state: str(r.state, "PENDING"),
    allocationMode: str(r.allocationMode, "FIXED"),
    allocationAmount: str(r.allocationAmount, "0"),
    maxAllocation: strOrNull(r.maxAllocation),
    minAllocation: strOrNull(r.minAllocation),
    copyPolicy: r.copyPolicy ? parseCopyPolicy(r.copyPolicy) : undefined,
    riskPolicy: r.riskPolicy ? parseFollowerRiskPolicy(r.riskPolicy) : undefined,
    followerAccountId: strOrNull(r.followerAccountId),
    totalCopies: num(r.totalCopies),
    failedCopies: num(r.failedCopies),
    totalCopiedVolume: str(r.totalCopiedVolume, "0"),
    startedAt: strOrNull(r.startedAt),
    pausedAt: strOrNull(r.pausedAt),
    stoppedAt: strOrNull(r.stoppedAt),
    stopReason: strOrNull(r.stopReason),
    closeOpenPositionsOnStop: r.closeOpenPositionsOnStop === true || r.closeOpenPositions === true,
    createdAt: str(r.createdAt),
  };
}

export function parseCopyExecution(input: unknown): CopyExecution {
  const r = obj(input);
  return {
    executionId: str(r.executionId ?? r.id),
    subscriptionId: str(r.subscriptionId),
    leaderEventId: str(r.leaderEventId),
    leaderOrderId: strOrNull(r.leaderOrderId),
    leaderFillId: strOrNull(r.leaderFillId),
    traderId: str(r.traderId),
    followerId: str(r.followerId),
    followerAccountId: strOrNull(r.followerAccountId),
    status: str(r.status, "PENDING") as CopyExecutionStatus,
    sizingMode: str(r.sizingMode, "FIXED"),
    leaderQuantity: str(r.leaderQuantity, "0"),
    leaderPrice: strOrNull(r.leaderPrice),
    followerQuantity: strOrNull(r.followerQuantity),
    followerPrice: strOrNull(r.followerPrice),
    slippageTolerance: strOrNull(r.slippageTolerance),
    maxNotional: strOrNull(r.maxNotional),
    followerOrderId: strOrNull(r.followerOrderId),
    riskDecision: (strOrNull(r.riskDecision) as CopyRiskDecision | null) ?? null,
    riskRuleId: strOrNull(r.riskRuleId),
    failureReason: strOrNull(r.failureReason),
    executionIntent: obj(r.executionIntent),
    riskReasons: strList(r.riskReasons),
    isSimulated: typeof r.isSimulated === "boolean" ? r.isSimulated : undefined,
    createdAt: str(r.createdAt),
    updatedAt: str(r.updatedAt),
  };
}

function parsePaged<T>(input: unknown, parse: (x: unknown) => T): Paged<T> {
  const r = obj(input);
  const rows = Array.isArray(r.data) ? r.data : Array.isArray(input) ? (input as unknown[]) : [];
  return { data: rows.map(parse), total: typeof r.total === "number" ? r.total : rows.length };
}

/** Copying requires copy_subscription:manage (FOLLOWER and super admins in the role matrix). */
export function permissionsAllowCopy(permissions: readonly string[]): boolean {
  return permissionsAllowAny(permissions, [Permission.COPY_SUBSCRIPTION_MANAGE]);
}

/**
 * Display-side eligibility for one strategy, mirroring the API's subscribe()
 * preconditions (strategy PUBLISHED, account not restricted, no maintenance,
 * role allowed to copy).
 */
export function copyEligibility(strategy: Pick<Strategy, "status">, status: TradingStatus | undefined): CopyEligibility {
  const reasons: string[] = [];
  if (strategy.status !== "PUBLISHED") reasons.push(`Strategy is ${strategy.status.toLowerCase().replace(/_/g, " ")}`);
  if (status) {
    if (status.eligibility === "NOT_PERMITTED") reasons.push("Your role cannot open copy subscriptions");
    if (status.eligibility === "MAINTENANCE") reasons.push(status.maintenance?.message || "Maintenance in progress");
    if (status.eligibility === "RESTRICTED") reasons.push("Your account has active restrictions");
  }
  return { canCopy: reasons.length === 0 && status !== undefined, reasons };
}

export function composeTradingStatus(
  permissions: readonly string[],
  maintenanceRaw: unknown,
  restrictionsRaw: unknown,
): TradingStatus {
  const m = obj(maintenanceRaw);
  const maintenance =
    m.active === true
      ? {
          active: true,
          message: str(m.message ?? m.title, "Scheduled maintenance"),
          scope: strOrNull(m.scope),
          endsAt: strOrNull(m.endsAt),
          isEmergency: m.isEmergency === true,
          blocksTrading: typeof m.blocksTrading === "boolean" ? m.blocksTrading : true,
        }
      : null;
  const rows = Array.isArray(obj(restrictionsRaw).data) ? (obj(restrictionsRaw).data as unknown[]) : [];
  const restrictions = rows
    .map(obj)
    .filter((r) => str(r.status, "ACTIVE") === "ACTIVE")
    .map((r) => ({ type: str(r.restrictionType ?? r.type, "RESTRICTION"), reason: str(r.reason) }));
  const permitted = permissionsAllowCopy(permissions);
  const eligibility: TradingStatus["eligibility"] = !permitted
    ? "NOT_PERMITTED"
    : maintenance?.blocksTrading
      ? "MAINTENANCE"
      : restrictions.length > 0
        ? "RESTRICTED"
        : "ELIGIBLE";
  return { eligibility, canCopy: eligibility === "ELIGIBLE", restrictions, maintenance };
}

/** Filter and sort traders on client-side discovery criteria. */
export function filterTradersByDiscovery(
  traders: TraderProfile[],
  filters: TraderDiscoveryFilters,
  performancesByTraderId?: Record<string, TraderPerformance | null>,
): TraderProfile[] {
  let result = [...traders];

  if (filters.verificationState) {
    result = result.filter((t) => t.verificationState === filters.verificationState);
  }
  if (filters.isFeatured !== undefined) {
    result = result.filter((t) => Boolean(t.isFeatured) === filters.isFeatured);
  }
  if (filters.search && filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    result = result.filter(
      (t) =>
        t.displayName.toLowerCase().includes(q) ||
        (t.bio ?? "").toLowerCase().includes(q) ||
        t.supportedSymbols.some((s) => s.toLowerCase().includes(q)) ||
        t.supportedVenues.some((v) => v.toLowerCase().includes(q)),
    );
  }
  if (filters.venue && filters.venue.trim()) {
    const venueUpper = filters.venue.trim().toUpperCase();
    result = result.filter((t) => t.supportedVenues.some((v) => v.toUpperCase() === venueUpper));
  }
  if (filters.symbol && filters.symbol.trim()) {
    const symUpper = filters.symbol.trim().toUpperCase();
    result = result.filter((t) => t.supportedSymbols.some((s) => s.toUpperCase().includes(symUpper)));
  }
  if (filters.minTrades !== undefined && filters.minTrades > 0) {
    result = result.filter((t) => (t.totalTrades ?? 0) >= filters.minTrades!);
  }
  if (filters.minFollowers !== undefined && filters.minFollowers > 0) {
    result = result.filter((t) => (t.followerCount ?? 0) >= filters.minFollowers!);
  }
  if (performancesByTraderId) {
    if (filters.minWinRate !== undefined && filters.minWinRate > 0) {
      result = result.filter((t) => {
        const perf = performancesByTraderId[t.traderId];
        if (!perf?.winRate) return false;
        const wr = parseFloat(perf.winRate);
        const normalizedPct = wr <= 1 ? wr * 100 : wr;
        return !Number.isNaN(normalizedPct) && normalizedPct >= filters.minWinRate!;
      });
    }
    if (filters.maxDrawdown !== undefined && filters.maxDrawdown >= 0) {
      result = result.filter((t) => {
        const perf = performancesByTraderId[t.traderId];
        if (!perf?.maxDrawdown) return true;
        const dd = parseFloat(perf.maxDrawdown);
        return !Number.isNaN(dd) && dd <= filters.maxDrawdown!;
      });
    }
  }

  if (filters.sortBy === "pnl" && performancesByTraderId) {
    // The page has always offered "Sort by Realized PnL"; this branch is what makes the option mean
    // anything. Unknown performances sort last, not as zero.
    result.sort((a, b) =>
      compareDecimalStringsDescending(
        performancesByTraderId[a.traderId]?.realizedPnl,
        performancesByTraderId[b.traderId]?.realizedPnl,
      ),
    );
  } else if (filters.sortBy === "winRate" && performancesByTraderId) {
    result.sort((a, b) =>
      compareDecimalStringsDescending(
        performancesByTraderId[a.traderId]?.winRate,
        performancesByTraderId[b.traderId]?.winRate,
      ),
    );
  } else if (filters.sortBy === "volume") {
    result.sort((a, b) => compareDecimalStringsDescending(a.totalVolume, b.totalVolume));
  } else if (filters.sortBy === "trades") {
    result.sort((a, b) => (b.totalTrades || 0) - (a.totalTrades || 0));
  } else if (filters.sortBy === "performance" && performancesByTraderId) {
    result.sort((a, b) =>
      compareDecimalStringsDescending(
        performancesByTraderId[a.traderId]?.realizedPnl,
        performancesByTraderId[b.traderId]?.realizedPnl,
      ),
    );
  } else {
    result.sort((a, b) => (b.followerCount || 0) - (a.followerCount || 0));
  }

  return result;
}

/** A customer without a client profile has no restrictions record (403/404): that is "none", not an error. */
async function ownRestrictions(): Promise<unknown> {
  try {
    return await apiClient.get<unknown>("/v1/client-lifecycle/restrictions", { searchParams: { status: "ACTIVE" } });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) return { data: [] };
    throw err;
  }
}

export interface CreateCopySubscriptionInput {
  traderId: string;
  strategyId: string;
  allocationMode: CopySizingMode;
  allocationAmount: string;
  maxAllocation?: string;
  followerAccountId?: string;
}

export interface UpdateSubscriptionSettingsInput {
  allocationMode?: CopySizingMode;
  allocationAmount?: string;
  maxAllocation?: string | null;
  minAllocation?: string | null;
  copyPolicy?: Partial<CopyPolicy> | Record<string, unknown>;
  riskPolicy?: Partial<FollowerRiskPolicy> | Record<string, unknown>;
  followerAccountId?: string | null;
}


export type AllocationMode = CopySizingMode;
export type CopyExecutionItem = CopyExecution;
export type CopySubscriptionItem = CopySubscription;
export type LeadTraderApplicationStatus = "SUBMITTED" | "IN_REVIEW" | "APPROVED" | "REJECTED";

export interface LeadTraderApplication {
  id: string;
  traderId: string;
  status: LeadTraderApplicationStatus;
  version: number;
  declaration: { yearsExperience: number; markets: string[]; strategySummary: string; evidenceReferences: string[]; riskAcknowledged: true };
  submittedAt: string;
  reviewedAt: string | null;
  decisionReason: string | null;
}

export interface SubmitLeadTraderApplicationInput {
  idempotencyKey: string;
  yearsExperience: number;
  markets: string[];
  strategySummary: string;
  evidenceReferences?: string[];
  riskAcknowledged: boolean;
}

export interface RebalancePreviewRequest {
  totalValue: string;
  allocations: Array<{ traderId: string; currentValue: string; targetWeightBps: number; priceAvailable: boolean }>;
}
export interface RebalancePreviewLine {
  traderId: string; currentValue: string; targetValue: string | null; deltaValue: string | null; targetWeightBps: number; status: "PREVIEW" | "UNAVAILABLE";
}

export interface PerformanceBenchmarkSeries {
  status: "AVAILABLE" | "UNAVAILABLE"; traderId: string; benchmarkKey: string | null; baseCurrency: string | null;
  methodology: string | null; flowBoundary: string | null; calculationVersion: string | null;
  dataCompleteness: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
  observations: Array<{ periodStart: string; periodEnd: string; traderPeriodReturnPercent: string; benchmarkPeriodReturnPercent: string; traderCumulativeReturnPercent: string; benchmarkCumulativeReturnPercent: string }>;
  sourceReferences: string[]; asOf: string | null; currentnessRule: "AS_OF_DISPLAYED_CURRENTNESS_NOT_ASSERTED"; reason?: string;
}

export interface PublicLeaderFeePolicy {
  traderId: string; currency: string; status: "AVAILABLE" | "UNCONFIGURED";
  policy: null | { id?: string; traderId?: string; currency?: string; createdAt?: string; profitShareBps: number; highWaterMarkScope: "PER_FOLLOWER_CURRENCY" | "PER_TRADER_CURRENCY"; version: number; effectiveFrom: string; effectiveTo: string | null };
  feeCalculation: { status: "UNAVAILABLE"; reason: string };
}

export interface TraderLeaderboard {
  page: number; limit: number; total: number; methodology: TraderRankingMethodology; data: TraderRanking[];
}

export interface TraderProfilePublicMetrics {
  traderId?: string;
  activeFollowers: { status: string; value: number | null; source: string | null; asOf: string | null; reason: string | null };
  aum: { status: string; value: null; currency: null; source: null; asOf: null; reason: string };
  activity: { status: string; source: string | null; asOf: string | null; latestRecordedFillAt: string | null; sampledFillCount: number | null; sampleLimit: number; hasMore: boolean | null; volumeByQuoteAsset: Array<{ asset: string; amount: string }>; calculationMethod: string | null; reason: string | null };
  riskScore: TraderRiskScore;
}
export interface TraderRiskScore {
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE"; score: number | null; band: "LOW" | "MODERATE" | "HIGH" | "CRITICAL" | "UNAVAILABLE";
  confidence: "COMPLETE" | "PARTIAL" | "UNAVAILABLE"; methodology?: string; asOf: string | null;
  factors: Array<{ key: string; value: string | number | null; status: string; source: string | null; score?: number | null; weightBps?: number | null; reason?: string | null }> ;
}

export interface CopyReconciliationSummary {
  subscriptionId: string; status: "IN_SYNC" | "DEGRADED" | "DISCREPANCY_DETECTED"; lastCheckedAt: string; totalExecutions: number; completedExecutions: number;
  riskBlockedExecutions: number; failedExecutions: number; discrepancyCount: number; discrepancies: Array<{ executionId: string; category: string; severity: string; message: string }> ;
}

export const tradingApi = {

  listMyLeadTraderApplications: async (): Promise<LeadTraderApplication[]> => {
    const raw = obj(await apiClient.get<unknown>("/v1/copy-trading/lead-trader-applications/mine"));
    const rows = Array.isArray(raw.data) ? raw.data : [];
    return rows.map((value) => { const row = obj(value); return {
      id: str(row.id), traderId: str(row.traderId), status: str(row.status, "SUBMITTED") as LeadTraderApplicationStatus,
      version: num(row.version), declaration: obj(row.declaration) as LeadTraderApplication["declaration"],
      submittedAt: str(row.submittedAt), reviewedAt: strOrNull(row.reviewedAt), decisionReason: strOrNull(row.decisionReason),
    }; });
  },

  submitLeadTraderApplication: async (input: SubmitLeadTraderApplicationInput): Promise<LeadTraderApplication> => {
    const row = obj(await apiClient.post<unknown>("/v1/copy-trading/lead-trader-applications", input));
    return { id: str(row.id), traderId: str(row.traderId), status: str(row.status, "SUBMITTED") as LeadTraderApplicationStatus,
      version: num(row.version), declaration: obj(row.declaration) as LeadTraderApplication["declaration"],
      submittedAt: str(row.submittedAt), reviewedAt: strOrNull(row.reviewedAt), decisionReason: strOrNull(row.decisionReason) };
  },

  previewAllocationRebalance: async (input: RebalancePreviewRequest, idempotencyKey?: string): Promise<RebalancePreviewLine[]> => {
    // A preview creates nothing, but it is still a POST: when the caller supplies a key the retry is
    // recognisable as the same request. Without one the call is unchanged, which is what every existing
    // caller (and their tests) already rely on.
    const raw = idempotencyKey
      ? await apiClient.post<unknown>("/v1/copy-trading/allocation-rebalance/preview", input, { idempotencyKey })
      : await apiClient.post<unknown>("/v1/copy-trading/allocation-rebalance/preview", input);
    const response = obj(raw);
    if (response.executable !== false || response.inputProvenance !== "CLIENT_SUPPLIED_UNVERIFIED" || !Array.isArray(response.lines)) {
      throw new Error("Allocation preview response violates the non-executable, unverified-input contract.");
    }
    return response.lines.map((value) => { const line = obj(value); return {
      traderId: str(line.traderId), currentValue: str(line.currentValue), targetValue: strOrNull(line.targetValue),
      deltaValue: strOrNull(line.deltaValue), targetWeightBps: num(line.targetWeightBps), status: str(line.status, "UNAVAILABLE") as RebalancePreviewLine["status"],
    }; });
  },

  getTraderBenchmark: async (traderId: string, benchmarkKey?: string): Promise<PerformanceBenchmarkSeries> =>
    await apiClient.get<PerformanceBenchmarkSeries>(`/v1/copy-trading/traders/${encodeURIComponent(traderId)}/benchmark`, { searchParams: { benchmarkKey } }),

  getLeaderFeePolicy: async (traderId: string, currency = "USD"): Promise<PublicLeaderFeePolicy> =>
    await apiClient.get<PublicLeaderFeePolicy>(`/v1/copy-trading/leader-fees/traders/${encodeURIComponent(traderId)}`, { searchParams: { currency } }),
  listTraders: async (params?: {
    search?: string;
    verificationState?: string;
    isFeatured?: boolean;
    page?: number;
    limit?: number;
  }) =>
    parsePaged(
      await apiClient.get<unknown>("/v1/copy-trading/traders", {
        searchParams: {
          search: params?.search || undefined,
          verificationState: params?.verificationState,
          isFeatured: params?.isFeatured,
          page: params?.page,
          limit: params?.limit,
        },
      }),
      parseTrader,
    ),

  getLeaderboard: async (params?: {
    verificationState?: string;
    isFeatured?: boolean;
    search?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    timeframe?: TraderRankingTimeframe;
  }): Promise<TraderLeaderboard> => {
    const raw = await apiClient.get<unknown>("/v1/copy-trading/rankings", {
      searchParams: {
        verificationState: params?.verificationState,
        isFeatured: params?.isFeatured,
        search: params?.search || undefined,
        page: params?.page,
        limit: params?.limit,
        sortBy: params?.sortBy,
        timeframe: params?.timeframe,
      },
    });
    const parsed = parsePaged(raw, (entry) => {
      const r = obj(entry);
      const m = obj(r.metrics);
      return {
        traderId: str(r.traderId ?? r.id),
        tenantId: str(r.tenantId),
        displayName: str(r.displayName, "Unnamed trader"),
        verificationState: str(r.verificationState, "UNVERIFIED"),
        isPublic: r.isPublic !== false,
        isFeatured: r.isFeatured === true,
        followerCount: num(r.followerCount),
        performance: r.performance ? parseTraderPerformance(r.performance) : null,
        score: num(r.score),
        rank: num(r.rank),
        metrics: {
          riskAdjustedReturn: numOrNull(m.riskAdjustedReturn),
          drawdownScore: numOrNull(m.drawdownScore),
          consistencyScore: numOrNull(m.consistencyScore),
          historyLengthScore: numOrNull(m.historyLengthScore),
          followerScore: numOrNull(m.followerScore),
          activityScore: numOrNull(m.activityScore),
          verifiedScore: numOrNull(m.verifiedScore),
        },
        weighting: (obj(r.weighting) as Record<string, number>) ?? {},
        timeframe: str(r.timeframe, params?.timeframe ?? "30D") as TraderRanking["timeframe"],
        periodStatus: str(r.periodStatus, r.status === "AVAILABLE" ? "AVAILABLE" : "UNAVAILABLE") as TraderRanking["periodStatus"],
        periodReturnPercent: strOrNull(r.periodReturnPercent), periodStart: strOrNull(r.periodStart), periodEnd: strOrNull(r.periodEnd),
        baseCurrency: strOrNull(r.baseCurrency), flowBoundary: strOrNull(r.flowBoundary), calculationVersion: strOrNull(r.calculationVersion),
        sourceCalculationVersion: strOrNull(r.sourceCalculationVersion), observationCount: numOrNull(r.observationCount),
        sourceReferences: strList(r.sourceReferences), unavailableReason: strOrNull(r.unavailableReason),
        rankingMethodology: str(r.rankingMethodology, "RECONCILED_CLOSED_PERIOD_TWR"), totalVolume: strOrNull(r.totalVolume),
      };
    });
    const root = obj(raw);
    const m = obj(root.methodology);
    return {
      page: num(root.page ?? 1), limit: num(root.limit ?? params?.limit ?? 25), total: num(root.total ?? parsed.total), data: parsed.data,
      methodology: { status: str(m.status, "UNAVAILABLE") as TraderRankingMethodology["status"], key: "RECONCILED_CLOSED_PERIOD_TWR",
        description: str(m.description), timeframe: str(m.timeframe, params?.timeframe ?? "30D") as TraderRankingMethodology["timeframe"],
        windowStart: strOrNull(m.windowStart), asOf: strOrNull(m.asOf), boundaryRule: str(m.boundaryRule, "EXACT_CONTIGUOUS_PERIODS_ONLY") as TraderRankingMethodology["boundaryRule"], orderingRule: str(m.orderingRule, "RETURN_DESCENDING_UNAVAILABLE_LAST") as TraderRankingMethodology["orderingRule"],
        currentnessRule: str(m.currentnessRule), minimumPeriodCount: num(m.minimumPeriodCount), rankedCount: num(m.rankedCount),
        unrankedCount: num(m.unrankedCount), reason: strOrNull(m.reason) },
    };
  },

  getTrader: async (traderId: string) =>
    parseTrader(await apiClient.get<unknown>(`/v1/copy-trading/traders/${encodeURIComponent(traderId)}/profile`)),

  getTraderPerformance: async (traderId: string): Promise<TraderPerformance> =>
    parseTraderPerformance(
      await apiClient.get<unknown>(`/v1/copy-trading/traders/${encodeURIComponent(traderId)}/performance`),
    ),

  getTraderPerformanceDetail: async (traderId: string): Promise<TraderPerformanceDetail> => {
    const [profileRaw, perfRaw, strategiesRaw] = await Promise.all([
      apiClient.get<unknown>(`/v1/copy-trading/traders/${encodeURIComponent(traderId)}/profile`),
      apiClient.get<unknown>(`/v1/copy-trading/traders/${encodeURIComponent(traderId)}/performance`),
      apiClient.get<unknown>(`/v1/copy-trading/traders/${encodeURIComponent(traderId)}/strategies`, {
        searchParams: { page: 1, limit: 20 },
      }),
    ]);
    return {
      profile: parseTrader(profileRaw),
      performance: parseTraderPerformance(perfRaw),
      strategies: parsePaged(strategiesRaw, parseStrategy).data,
    };
  },

  compareTraders: async (traderIds: string[]): Promise<TraderComparisonEntry[]> => {
    const uniqueIds = Array.from(new Set(traderIds.map((id) => id.trim()).filter(Boolean))).slice(0, 4);
    return Promise.all(
      uniqueIds.map(async (id) => {
        const [profileRaw, perfRaw, strategiesRaw] = await Promise.all([
          apiClient.get<unknown>(`/v1/copy-trading/traders/${encodeURIComponent(id)}/profile`),
          apiClient.get<unknown>(`/v1/copy-trading/traders/${encodeURIComponent(id)}/performance`),
          apiClient.get<unknown>(`/v1/copy-trading/traders/${encodeURIComponent(id)}/strategies`, {
            searchParams: { page: 1, limit: 10 },
          }),
        ]);
        return {
          profile: parseTrader(profileRaw),
          performance: parseTraderPerformance(perfRaw),
          strategies: parsePaged(strategiesRaw, parseStrategy).data,
        };
      }),
    );
  },

  listTraderStrategies: async (traderId: string, params?: { page?: number; limit?: number }) =>
    parsePaged(
      await apiClient.get<unknown>(`/v1/copy-trading/traders/${encodeURIComponent(traderId)}/strategies`, {
        searchParams: { page: params?.page, limit: params?.limit },
      }),
      parseStrategy,
    ),

  /** The API filter accepts status, traderId, page and limit only (extra fields are rejected with 422). */
  listStrategies: async (params?: { traderId?: string; status?: StrategyStatus; search?: string; type?: string; page?: number; limit?: number }) => {
    const page = parsePaged(
      await apiClient.get<unknown>("/v1/copy-trading/strategies", {
        searchParams: { traderId: params?.traderId, status: params?.status, page: params?.page, limit: params?.limit },
      }),
      parseStrategy,
    );
    const search = params?.search?.trim().toLowerCase();
    const data = page.data.filter((strategy) =>
      (!search || strategy.name.toLowerCase().includes(search) || (strategy.description ?? "").toLowerCase().includes(search))
      && (!params?.type || strategy.type === params.type),
    );
    return { ...page, data, total: data.length };
  },

  getStrategy: async (strategyId: string) =>
    parseStrategy(await apiClient.get<unknown>(`/v1/copy-trading/strategies/${encodeURIComponent(strategyId)}`)),

  getStrategyAnalytics: async (strategyId: string): Promise<StrategyAnalyticsView> => {
    const strategy = parseStrategy(
      await apiClient.get<unknown>(`/v1/copy-trading/strategies/${encodeURIComponent(strategyId)}`),
    );
    const [traderRaw, perfRaw, policyRaw] = await Promise.all([
      apiClient
        .get<unknown>(`/v1/copy-trading/traders/${encodeURIComponent(strategy.traderId)}/profile`)
        .catch(() => null),
      apiClient
        .get<unknown>(`/v1/copy-trading/traders/${encodeURIComponent(strategy.traderId)}/performance`)
        .catch(() => null),
      apiClient
        .get<unknown>("/v1/copy-trading/policies/effective", { searchParams: { strategyId: strategy.strategyId } })
        .catch(() => null),
    ]);
    return {
      strategy,
      trader: traderRaw ? parseTrader(traderRaw) : null,
      performance: perfRaw ? parseTraderPerformance(perfRaw) : null,
      traderPerformance: perfRaw ? parseTraderPerformance(perfRaw) : null,
      effectivePolicy: policyRaw ? parseCopyPolicy(policyRaw) : null,
    };
  },

  listCopySubscriptions: async (params?: { state?: CopySubscriptionState; page?: number; limit?: number }) =>
    parsePaged(
      await apiClient.get<unknown>("/v1/copy-trading/subscriptions/me", {
        searchParams: { state: params?.state, page: params?.page, limit: params?.limit },
      }),
      parseSubscription,
    ),

  getCopySubscription: async (subscriptionId: string): Promise<CopySubscription> =>
    parseSubscription(
      await apiClient.get<unknown>(`/v1/copy-trading/subscriptions/${encodeURIComponent(subscriptionId)}`),
    ),

  updateCopySubscriptionSettings: async (
    subscriptionId: string,
    input: UpdateSubscriptionSettingsInput,
  ): Promise<CopySubscription> =>
    parseSubscription(
      await apiClient.put<unknown>(`/v1/copy-trading/subscriptions/${encodeURIComponent(subscriptionId)}`, input),
    ),

  getEffectivePolicy: async (params: { strategyId?: string; subscriptionId?: string }): Promise<CopyPolicy> =>
    parseCopyPolicy(
      await apiClient.get<unknown>("/v1/copy-trading/policies/effective", {
        searchParams: { strategyId: params.strategyId, subscriptionId: params.subscriptionId },
      }),
    ),

  getSubscriptionDetail: async (subscriptionId: string): Promise<SubscriptionDetailSummary> => {
    const [subRaw, policyRaw, execsRaw, reconciliation] = await Promise.all([
      apiClient.get<unknown>(`/v1/copy-trading/subscriptions/${encodeURIComponent(subscriptionId)}`),
      apiClient.get<unknown>("/v1/copy-trading/policies/effective", { searchParams: { subscriptionId } }),
      apiClient.get<unknown>("/v1/copy-trading/executions", {
        searchParams: { subscriptionId, page: 1, limit: 20 },
      }),
      tradingApi.getSubscriptionReconciliationStatus(subscriptionId),
    ]);
    const pagedExecs = parsePaged(execsRaw, parseCopyExecution);
    return {
      subscription: parseSubscription(subRaw),
      effectivePolicy: parseCopyPolicy(policyRaw),
      recentExecutions: pagedExecs.data,
      totalExecutions: pagedExecs.total,
      reconciliation,
    };
  },

  listSubscriptionPositions: async (
    subscriptionId: string,
    params?: { symbol?: string; onlyOpen?: boolean },
  ): Promise<CopiedPositionItem[]> => {
    const subscription = obj(await apiClient.get<unknown>(`/v1/copy-trading/subscriptions/${encodeURIComponent(subscriptionId)}`));
    const accountId = strOrNull(subscription.followerAccountId);
    if (!accountId) return [];
    const raw = await apiClient.get<unknown>("/v1/execution/positions", {
      searchParams: { accountId, symbol: params?.symbol, includeFlat: params?.onlyOpen === false },
    });
    const root = obj(raw);
    const rows: unknown[] = Array.isArray(raw) ? raw : Array.isArray(root.items) ? root.items as unknown[] : Array.isArray(root.data) ? root.data as unknown[] : [];
    return rows.map((input) => {
      const row = obj(input);
      const quantity = str(row.quantity);
      const isFlat = /^0(?:\.0+)?$/.test(quantity);
      const side = str(row.side, "UNKNOWN");
      return {
        id: str(row.id), positionId: str(row.id), accountId: str(row.accountId), symbol: str(row.symbol), side, quantity,
        averageEntryPrice: strOrNull(row.averageEntryPrice), markPrice: strOrNull(row.markPrice),
        unrealizedPnl: strOrNull(row.unrealizedPnl ?? row.unrealisedPnl), realizedPnl: strOrNull(row.realizedPnl ?? row.realisedPnl),
        cumulativeFee: strOrNull(row.cumulativeFee), feeCurrency: strOrNull(row.feeCurrency),
        containsSimulatedFills: row.containsSimulatedFills === true, fillCount: num(row.fillCount),
        isOpen: !isFlat && side !== "FLAT", venue: strOrNull(row.venue), updatedAt: str(row.updatedAt),
      };
    }).filter((position) => params?.onlyOpen !== true || position.isOpen);
  },

  listSubscriptionOrders: async (
    subscriptionId: string,
    params?: { status?: CopyExecutionStatus; symbol?: string; page?: number; limit?: number },
  ): Promise<{ items: CopiedOrderHistoryItem[]; total: number }> => {
    const execsRaw = await apiClient.get<unknown>(`/v1/copy-trading/subscriptions/${encodeURIComponent(subscriptionId)}/executions`, {
      searchParams: { status: params?.status, page: params?.page ?? 1, limit: params?.limit ?? 20 },
    });
    const pagedExecs = parsePaged(execsRaw, parseCopyExecution);
    const accountIds = Array.from(new Set(pagedExecs.data.map((execution) => execution.followerAccountId).filter((value): value is string => Boolean(value))));
    const accountId = accountIds.length === 1 ? accountIds[0] : undefined;
    const ordersRaw = accountId ? await apiClient.get<unknown>("/v1/execution/orders", {
      searchParams: { accountId, symbol: params?.symbol, limit: 50 },
    }) : { items: [] };
    const rawOrderItems = Array.isArray(obj(ordersRaw).items)
      ? (obj(ordersRaw).items as unknown[])
      : Array.isArray(obj(ordersRaw).data)
        ? (obj(ordersRaw).data as unknown[])
        : [];
    const ordersById = new Map<string, ExecutionOrderSummary>();
    for (const item of rawOrderItems) {
      const o = obj(item);
      const id = str(o.id);
      if (!id) continue;
      ordersById.set(id, {
        id,
        clientOrderId: str(o.clientOrderId),
        exchangeOrderId: strOrNull(o.exchangeOrderId),
        venue: str(o.venue),
        symbol: str(o.symbol),
        side: str(o.side, "BUY"),
        type: str(o.type, "MARKET"),
        status: str(o.status, "SUBMITTED"),
        quantity: str(o.quantity, "0"),
        filledQuantity: str(o.filledQuantity, "0"),
        remainingQuantity: str(o.remainingQuantity, "0"),
        price: strOrNull(o.price),
        averageFillPrice: strOrNull(o.averageFillPrice),
        cumulativeFee: str(o.cumulativeFee, "0"),
        feeCurrency: strOrNull(o.feeCurrency),
        isSimulated: o.isSimulated === true,
        rejectionCode: strOrNull(o.rejectionCode),
        rejectionReason: strOrNull(o.rejectionReason),
        createdAt: str(o.createdAt),
      });
    }

    const items = pagedExecs.data
      .filter((exec) => {
        if (!params?.symbol) return true;
        const intentSym = str(exec.executionIntent?.symbol);
        const orderSym = exec.followerOrderId ? ordersById.get(exec.followerOrderId)?.symbol ?? "" : "";
        const target = params.symbol.toUpperCase();
        return intentSym.toUpperCase().includes(target) || orderSym.toUpperCase().includes(target);
      })
      .map((exec) => {
        const order = exec.followerOrderId ? ordersById.get(exec.followerOrderId) ?? null : null;
        return {
          executionId: exec.executionId, followerOrderId: exec.followerOrderId,
          symbol: str(exec.executionIntent?.symbol, order?.symbol ?? "Unavailable"),
          side: str(exec.executionIntent?.side, "Unavailable"), orderType: str(exec.executionIntent?.type, "Unavailable"),
          status: exec.status, orderStatus: order?.status ?? "UNAVAILABLE",
          filledQuantity: order?.filledQuantity ?? null, followerQuantity: exec.followerQuantity,
          averageFillPrice: order?.averageFillPrice ?? null, fee: order?.cumulativeFee ?? null,
          feeAsset: order?.feeCurrency ?? null, failureReason: exec.failureReason, riskReasons: exec.riskReasons ?? [],
          execution: exec, order,
        };
      });

    return { items, total: pagedExecs.total };
  },

  listExecutions: async (params?: {
    status?: CopyExecutionStatus;
    subscriptionId?: string;
    page?: number;
    limit?: number;
  }): Promise<Paged<CopyExecution>> =>
    parsePaged(
      await apiClient.get<unknown>("/v1/copy-trading/executions", {
        searchParams: {
          status: params?.status,
          subscriptionId: params?.subscriptionId,
          page: params?.page,
          limit: params?.limit,
        },
      }),
      parseCopyExecution,
    ),

  getExecution: async (executionId: string): Promise<CopyExecution> =>
    parseCopyExecution(
      await apiClient.get<unknown>(`/v1/copy-trading/executions/${encodeURIComponent(executionId)}`),
    ),

  getSubscriptionReconciliationStatus: async (
    subscriptionId: string,
  ): Promise<CustomerReconciliationStatus> => {
    const raw = obj(
      await apiClient.get<unknown>(
        `/v1/copy-trading/subscriptions/${encodeURIComponent(subscriptionId)}/reconciliation-status`,
      ),
    );
    const rawStatus = str(raw.status, "SYNCED");
    const status: CustomerReconciliationStatus["status"] =
      rawStatus === "ATTENTION_REQUIRED" || rawStatus === "PENDING_REVIEW" ? rawStatus : "SYNCED";
    const items = Array.isArray(raw.items)
      ? raw.items.map((item) => {
          const r = obj(item);
          const sev = str(r.severity, "LOW");
          return {
            id: str(r.id),
            category: str(r.category, "ORDER_MISMATCH"),
            severity: (sev === "CRITICAL" || sev === "HIGH" || sev === "MEDIUM" ? sev : "LOW") as
              | "LOW"
              | "MEDIUM"
              | "HIGH"
              | "CRITICAL",
            resolved: r.resolved === true,
            createdAt: str(r.createdAt),
            leaderEventId: str(r.leaderEventId),
            executionId: strOrNull(r.executionId),
            customerMessage: str(r.customerMessage, "Reconciliation check recorded."),
          };
        })
      : [];
    return {
      subscriptionId: str(raw.subscriptionId, subscriptionId),
      status,
      unresolvedCount: num(raw.unresolvedCount),
      resolvedCount: num(raw.resolvedCount),
      lastCheckedAt: str(raw.lastCheckedAt),
      items,
    };
  },

  createCopySubscription: async (input: CreateCopySubscriptionInput) =>
    parseSubscription(
      await apiClient.post<unknown>("/v1/copy-trading/subscriptions", {
        traderId: input.traderId,
        strategyId: input.strategyId,
        allocationMode: input.allocationMode,
        allocationAmount: input.allocationAmount,
        ...(input.maxAllocation ? { maxAllocation: input.maxAllocation } : {}),
        ...(input.followerAccountId ? { followerAccountId: input.followerAccountId } : {}),
        idempotencyKey: newIdempotencyKey("copy-sub"),
      }),
    ),

  createSubscription: async (input: CreateCopySubscriptionInput & { minAllocation?: string; copyPolicy?: Partial<CopyPolicy> }) =>
    parseSubscription(
      await apiClient.post<unknown>("/v1/copy-trading/subscriptions", {
        traderId: input.traderId,
        strategyId: input.strategyId,
        allocationMode: input.allocationMode,
        allocationAmount: input.allocationAmount,
        ...(input.maxAllocation ? { maxAllocation: input.maxAllocation } : {}),
        ...(input.minAllocation ? { minAllocation: input.minAllocation } : {}),
        ...(input.copyPolicy ? { copyPolicy: input.copyPolicy } : {}),
        ...(input.followerAccountId ? { followerAccountId: input.followerAccountId } : {}),
        idempotencyKey: newIdempotencyKey("copy-sub"),
      }),
    ),

  pauseCopySubscription: async (subscriptionId: string) =>
    parseSubscription(
      await apiClient.post<unknown>(`/v1/copy-trading/subscriptions/${encodeURIComponent(subscriptionId)}/pause`),
    ),

  pauseSubscription: async (subscriptionId: string) =>
    parseSubscription(
      await apiClient.post<unknown>(`/v1/copy-trading/subscriptions/${encodeURIComponent(subscriptionId)}/pause`),
    ),

  resumeCopySubscription: async (subscriptionId: string) =>
    parseSubscription(
      await apiClient.post<unknown>(`/v1/copy-trading/subscriptions/${encodeURIComponent(subscriptionId)}/resume`),
    ),

  resumeSubscription: async (subscriptionId: string) =>
    parseSubscription(
      await apiClient.post<unknown>(`/v1/copy-trading/subscriptions/${encodeURIComponent(subscriptionId)}/resume`),
    ),

  stopCopySubscription: async (subscriptionId: string) =>
    parseSubscription(
      await apiClient.post<unknown>(`/v1/copy-trading/subscriptions/${encodeURIComponent(subscriptionId)}/stop`),
    ),

  stopSubscription: async (subscriptionId: string, reason?: string, closeOpenPositions = false) =>
    parseSubscription(
      await apiClient.post<unknown>(`/v1/copy-trading/subscriptions/${encodeURIComponent(subscriptionId)}/stop`, {
        reason,
        closeOpenPositions,
      }),
    ),

  cancelCopySubscription: async (subscriptionId: string) =>
    parseSubscription(
      await apiClient.delete<unknown>(`/v1/copy-trading/subscriptions/${encodeURIComponent(subscriptionId)}`),
    ),

  getTradingStatus: async (permissions: readonly string[] = ["*"]): Promise<TradingStatus> => {
    const [maintenance, restrictions] = await Promise.all([
      apiClient.get<unknown>("/v1/operations/maintenance/current"),
      ownRestrictions(),
    ]);
    return composeTradingStatus(permissions, maintenance, restrictions);
  },
};
