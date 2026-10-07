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

export interface TraderRanking {
  traderId: string;
  tenantId: string;
  displayName: string;
  verificationState: string;
  isPublic: boolean;
  isFeatured: boolean;
  followerCount: number;
  performance: TraderPerformance | null;
  score: number;
  rank: number;
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
  sortBy?: "score" | "performance" | "followers" | "volume" | "trades";
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
  copyPolicy?: Partial<CopyPolicy>;
  riskPolicy?: Partial<FollowerRiskPolicy>;
  followerAccountId: string | null;
  totalCopies: number;
  failedCopies: number;
  totalCopiedVolume: string;
  startedAt: string | null;
  pausedAt?: string | null;
  stoppedAt?: string | null;
  stopReason?: string | null;
  closeOpenPositionsOnStop?: boolean;
  createdAt: string;
}

export interface CopyExecution {
  executionId: string;
  subscriptionId: string;
  leaderEventId: string;
  leaderOrderId: string | null;
  leaderFillId: string | null;
  traderId: string;
  followerId: string;
  followerAccountId: string | null;
  status: CopyExecutionStatus;
  sizingMode: string;
  leaderQuantity: string;
  leaderPrice: string | null;
  followerQuantity: string | null;
  followerPrice: string | null;
  slippageTolerance: string | null;
  maxNotional: string | null;
  followerOrderId: string | null;
  riskDecision: CopyRiskDecision | null;
  riskRuleId: string | null;
  failureReason: string | null;
  executionIntent: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionDetailSummary {
  subscription: CopySubscription;
  effectivePolicy: CopyPolicy;
  recentExecutions: CopyExecution[];
  totalExecutions: number;
}

export interface CopiedPositionItem {
  id: string;
  subscriptionId: string;
  traderId: string;
  strategyId: string;
  symbol: string;
  side: string;
  quantity: string;
  averageEntryPrice: string;
  markPrice: string | null;
  marketValue: string | null;
  unrealizedPnl: string;
  realizedPnl: string;
  isOpen: boolean;
  venue: string | null;
  updatedAt: string;
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
  execution: CopyExecution;
  order: ExecutionOrderSummary | null;
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

  if (filters.sortBy === "volume") {
    result.sort((a, b) => parseFloat(b.totalVolume || "0") - parseFloat(a.totalVolume || "0"));
  } else if (filters.sortBy === "trades") {
    result.sort((a, b) => (b.totalTrades || 0) - (a.totalTrades || 0));
  } else if (filters.sortBy === "performance" && performancesByTraderId) {
    result.sort((a, b) => {
      const aPnl = parseFloat(performancesByTraderId[a.traderId]?.realizedPnl || "0");
      const bPnl = parseFloat(performancesByTraderId[b.traderId]?.realizedPnl || "0");
      return bPnl - aPnl;
    });
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

export const tradingApi = {
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
  }): Promise<Paged<TraderRanking>> => {
    const raw = await apiClient.get<unknown>("/v1/copy-trading/rankings", {
      searchParams: {
        verificationState: params?.verificationState,
        isFeatured: params?.isFeatured,
        search: params?.search || undefined,
        page: params?.page,
        limit: params?.limit,
        sortBy: params?.sortBy,
      },
    });
    return parsePaged(raw, (entry) => {
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
      };
    });
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
  listStrategies: async (params?: { traderId?: string; status?: StrategyStatus; page?: number; limit?: number }) =>
    parsePaged(
      await apiClient.get<unknown>("/v1/copy-trading/strategies", {
        searchParams: { traderId: params?.traderId, status: params?.status, page: params?.page, limit: params?.limit },
      }),
      parseStrategy,
    ),

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
    const [subRaw, policyRaw, execsRaw] = await Promise.all([
      apiClient.get<unknown>(`/v1/copy-trading/subscriptions/${encodeURIComponent(subscriptionId)}`),
      apiClient.get<unknown>("/v1/copy-trading/policies/effective", { searchParams: { subscriptionId } }),
      apiClient.get<unknown>("/v1/copy-trading/executions", {
        searchParams: { subscriptionId, page: 1, limit: 20 },
      }),
    ]);
    const pagedExecs = parsePaged(execsRaw, parseCopyExecution);
    return {
      subscription: parseSubscription(subRaw),
      effectivePolicy: parseCopyPolicy(policyRaw),
      recentExecutions: pagedExecs.data,
      totalExecutions: pagedExecs.total,
    };
  },

  listSubscriptionPositions: async (
    subscriptionId: string,
    params?: { symbol?: string; onlyOpen?: boolean },
  ): Promise<CopiedPositionItem[]> => {
    const [subRaw, positionsRaw] = await Promise.all([
      apiClient.get<unknown>(`/v1/copy-trading/subscriptions/${encodeURIComponent(subscriptionId)}`),
      apiClient.get<unknown>("/v1/portfolio-accounting/positions", {
        searchParams: {
          symbol: params?.symbol,
          limit: 100,
        },
      }),
    ]);
    const sub = parseSubscription(subRaw);
    const rows = Array.isArray(positionsRaw)
      ? positionsRaw
      : Array.isArray(obj(positionsRaw).data)
        ? (obj(positionsRaw).data as unknown[])
        : [];
    const allowedSymbols = sub.copyPolicy?.allowedSymbols ?? null;
    const onlyOpen = params?.onlyOpen ?? true;

    return rows
      .map(obj)
      .filter((pos) => {
        if (onlyOpen && pos.isOpen === false) return false;
        const sym = str(pos.symbol);
        if (params?.symbol && sym.toUpperCase() !== params.symbol.toUpperCase()) return false;
        if (allowedSymbols && allowedSymbols.length > 0) {
          return allowedSymbols.includes(sym);
        }
        return true;
      })
      .map((pos) => ({
        id: str(pos.id),
        subscriptionId: sub.subscriptionId,
        traderId: sub.traderId,
        strategyId: sub.strategyId,
        symbol: str(pos.symbol),
        side: str(pos.side, "LONG"),
        quantity: str(pos.quantity, "0"),
        averageEntryPrice: str(pos.averageEntryPrice, "0"),
        markPrice: strOrNull(pos.markPrice),
        marketValue: strOrNull(pos.marketValue),
        unrealizedPnl: str(pos.unrealizedPnl, "0"),
        realizedPnl: str(pos.realizedPnl, "0"),
        isOpen: pos.isOpen !== false,
        venue: strOrNull(pos.venue),
        updatedAt: str(pos.updatedAt),
      }));
  },

  listSubscriptionOrders: async (
    subscriptionId: string,
    params?: { status?: CopyExecutionStatus; symbol?: string; page?: number; limit?: number },
  ): Promise<{ items: CopiedOrderHistoryItem[]; total: number }> => {
    const [execsRaw, ordersRaw] = await Promise.all([
      apiClient.get<unknown>("/v1/copy-trading/executions", {
        searchParams: {
          subscriptionId,
          status: params?.status,
          page: params?.page ?? 1,
          limit: params?.limit ?? 20,
        },
      }),
      apiClient
        .get<unknown>("/v1/execution/orders", {
          searchParams: {
            symbol: params?.symbol,
            limit: 50,
          },
        })
        .catch(() => ({ items: [] })),
    ]);

    const pagedExecs = parsePaged(execsRaw, parseCopyExecution);
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
        const intentSym = str(exec.executionIntent.symbol);
        const orderSym = exec.followerOrderId ? ordersById.get(exec.followerOrderId)?.symbol ?? "" : "";
        const target = params.symbol.toUpperCase();
        return intentSym.toUpperCase().includes(target) || orderSym.toUpperCase().includes(target);
      })
      .map((exec) => ({
        execution: exec,
        order: exec.followerOrderId ? ordersById.get(exec.followerOrderId) ?? null : null,
      }));

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
