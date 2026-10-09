// # Defines canonical copy-trading policy, risk, subscription, execution, and reconciliation domain types
/**
 * Canonical copy-trading domain types: trader profile, strategy, follower subscription, allocation, copy policy, risk settings, copier state, execution intent, and performance references.
 * Do not store raw secrets.
 */

import type { TraderRiskFactorResult } from '../risk/trader-risk-score.service';

export enum TraderVerificationState {
  UNVERIFIED = 'UNVERIFIED',
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
  SUSPENDED = 'SUSPENDED',
}

export enum TraderStrategyStatus {
  DRAFT = 'DRAFT',
  PENDING_VALIDATION = 'PENDING_VALIDATION',
  VALIDATED = 'VALIDATED',
  PUBLISHED = 'PUBLISHED',
  PAUSED = 'PAUSED',
  ARCHIVED = 'ARCHIVED',
  REJECTED = 'REJECTED',
}

export enum TraderStrategyType {
  MANUAL = 'MANUAL',
  ALGORITHMIC = 'ALGORITHMIC',
  COPY = 'COPY',
  HYBRID = 'HYBRID',
}

export enum CopySubscriptionState {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  STOPPED = 'STOPPED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export enum CopyExecutionStatus {
  PENDING = 'PENDING',
  VALIDATED = 'VALIDATED',
  MAPPED = 'MAPPED',
  RISK_CHECKED = 'RISK_CHECKED',
  ROUTED = 'ROUTED',
  SUBMITTED = 'SUBMITTED',
  FILLED = 'FILLED',
  FAILED = 'FAILED',
  REJECTED = 'REJECTED',
  SKIPPED = 'SKIPPED',
  BLOCKED = 'BLOCKED',
}

export enum CopySizingMode {
  PROPORTIONAL = 'PROPORTIONAL',
  FIXED = 'FIXED',
  PERCENTAGE_BALANCE = 'PERCENTAGE_BALANCE',
}

export enum CopyRiskDecision {
  ALLOW = 'ALLOW',
  REDUCE = 'REDUCE',
  BLOCK = 'BLOCK',
  PAUSE = 'PAUSE',
  STOP_COPY = 'STOP_COPY',
}

export enum CopyReconciliationSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum CopyReconciliationCategory {
  MISSING_COPY = 'MISSING_COPY',
  DUPLICATE_COPY = 'DUPLICATE_COPY',
  STALE_INTENT = 'STALE_INTENT',
  ORDER_MISMATCH = 'ORDER_MISMATCH',
  QUANTITY_MISMATCH = 'QUANTITY_MISMATCH',
  PRICE_MISMATCH = 'PRICE_MISMATCH',
  STATUS_MISMATCH = 'STATUS_MISMATCH',
  UNSUPPORTED_SYMBOL = 'UNSUPPORTED_SYMBOL',
  EXECUTION_AFTER_STOP = 'EXECUTION_AFTER_STOP',
  EXECUTION_AFTER_RISK_BLOCK = 'EXECUTION_AFTER_RISK_BLOCK',
  SLIPPAGE_EXCEEDED = 'SLIPPAGE_EXCEEDED',
}

export interface TraderProfile {
  traderId: string;
  tenantId: string;
  userId: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  verificationState: TraderVerificationState;
  verifiedAt: string | null;
  supportedVenues: string[];
  supportedSymbols: string[];
  riskProfile: Record<string, any>;
  isPublic: boolean;
  isFeatured: boolean;
  followerCount: number;
  totalVolume: string; // Decimal-safe
  totalTrades: number;
  createdAt: string;
  updatedAt: string;
}

export interface TraderStrategy {
  strategyId: string;
  tenantId: string;
  traderId: string;
  userId: string;
  name: string;
  description: string | null;
  status: TraderStrategyStatus;
  type: TraderStrategyType;
  supportedSymbols: string[];
  supportedVenues: string[];
  riskProfile: Record<string, any>;
  feePolicy: Record<string, any>;
  strategyConfig: Record<string, any>;
  publishedAt: string | null;
  pausedAt: string | null;
  archivedAt: string | null;
  followerCount: number;
  totalCopies: number;
  createdAt: string;
  updatedAt: string;
}

export interface FollowerSubscription {
  subscriptionId: string;
  tenantId: string;
  followerId: string;
  traderId: string;
  strategyId: string;
  state: CopySubscriptionState;
  allocationMode: CopySizingMode;
  allocationAmount: string; // Decimal-safe
  maxAllocation: string | null;
  minAllocation: string | null;
  copyPolicy: CopyPolicy;
  riskPolicy: FollowerRiskPolicy;
  followerAccountId: string | null;
  startedAt: string | null;
  pausedAt: string | null;
  stoppedAt: string | null;
  totalCopiedVolume: string;
  totalCopies: number;
  failedCopies: number;
  createdAt: string;
  updatedAt: string;
}

export interface CopyPolicy {
  sizingMode: CopySizingMode;
  proportionalRatio: string | null; // e.g. 0.1 for 10%
  fixedQuantity: string | null;
  fixedNotional: string | null;
  maxOrderNotional: string | null;
  maxDailyNotional: string | null;
  maxConcurrentCopies: number | null;
  slippageToleranceBps: number | null; // basis points
  executionDelayMs: number | null;
  allowedSymbols: string[] | null;
  blockedSymbols: string[] | null;
  allowedSides: string[] | null; // BUY, SELL
  leveragePolicy: string | null;
  maxLeverage?: string | null;
  marginMode?: 'SPOT' | 'ISOLATED' | 'CROSS' | null;
  reduceOnly: boolean | null;
  takeProfitBps?: number | null;
  stopLossBps?: number | null;
  trailingStopBps?: number | null;
  stopCopyConditions: Record<string, any> | null;
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

export interface CopyStopExecutionPlan {
  takeProfitPrice: string | null;
  stopLossPrice: string | null;
  trailingStopBps: number | null;
  trailingStopDistance: string | null;
  trailingActivationPrice: string | null;
  stopCopyTriggered: boolean;
  stopCopyReason: string | null;
}

export interface CopyExecutionIntent {
  executionId: string;
  tenantId: string;
  leaderEventId: string;
  leaderOrderId: string | null;
  leaderFillId: string | null;
  subscriptionId: string;
  followerId: string;
  traderId: string;
  followerAccountId: string | null;
  status: CopyExecutionStatus;
  sizingMode: CopySizingMode;
  leaderQuantity: string;
  leaderPrice: string | null;
  followerQuantity: string | null;
  followerPrice: string | null;
  slippageTolerance: string | null;
  maxNotional: string | null;
  executionIntent: Record<string, any>;
  followerOrderId: string | null;
  riskDecision: CopyRiskDecision | null;
  riskRuleId: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface TraderPerformance {
  traderId: string;
  tenantId: string;
  /**
   * Fill-derived figures.
   *
   * Every one of these is nullable because the service that publishes this shape reads reconciled
   * closed accounting periods and consults no fills at all. A fill-derived PnL is not a return: it
   * ignores deposits and withdrawals, so the same trading result reads as profit after a deposit and
   * as loss after a withdrawal. The fields are kept in the shape because consumers and stored
   * clients still name them, but `null` is the only value this shape can honestly carry, and a
   * consumer must render "unavailable" rather than zero.
   */
  realizedPnl: string | null;
  unrealizedPnl: string | null;
  totalReturn: string | null;
  totalReturnPercent: string | null;
  maxDrawdown: string | null;
  maxDrawdownPercent: string | null;
  winCount: number | null;
  lossCount: number | null;
  tradeCount: number | null;
  winRate: string | null;
  lossRate: string | null;
  totalVolume: string | null;
  averageTrade: string | null;
  averageWin: string | null;
  averageLoss: string | null;
  profitFactor: string | null;
  sharpeRatio: string | null;
  historyLengthDays: number;
  lastTradeAt: string | null;
  isActual: boolean; // true only when the reconciled window was proven COMPLETE
  source: string; // e.g. RECONCILED_CLOSED_PERIOD_RECORDS, FILLS, ORDERS, SETTLEMENT
  /**
   * TIME_WEIGHTED_RETURN provenance. These are the fields that distinguish a reconciled, linked
   * closed-period return from a raw NAV comparison, and the schema stores each of them
   * (`data_completeness`, `calculation_version`, `flow_boundary`) on the period records. Optional
   * because a record produced before the TWR path existed cannot claim them, and a consumer that
   * needs a proven return must treat their absence as "not proven" rather than as a default.
   */
  methodology?: string | null;
  flowBoundary?: string | null;
  dataCompleteness?: string | null;
  sourceReferences?: string[] | null;
  /** When the figures were observed. Absent means the freshness of the value cannot be shown. */
  asOf?: string | null;
  /**
   * The calculation version applied to the published figures, and the version of the persisted
   * source records they were derived from. When the two are shown together a reader can tell whether
   * the number was recomputed under the current methodology or carried forward from an older one.
   */
  calculationVersion?: string | null;
  sourceCalculationVersion?: string | null;
  /** The accounting base currency of the window. Absent means no window was proven. */
  baseCurrency?: string | null;
  /**
   * How many closed periods the window contained. Present even when the window failed, so a consumer
   * can distinguish "no evidence at all" from "evidence that was rejected", which is the difference
   * between an administration problem and a data-integrity one.
   */
  observationCount?: number | null;
  /** Names what `asOf` is. See `TraderPerformanceService.CURRENTNESS_RULE`. */
  currentnessRule?: string | null;
  /** Why no return is published. Absent only when the window was proven COMPLETE. */
  unavailableReason?: string;
}

/** One quote-asset bucket of traded volume, as an exact decimal string. */
export interface TraderQuoteAssetVolume {
  asset: string;
  amount: string;
}

/**
 * What a public trader profile may publish about a metric: the value, the canonical source it came
 * from, when it was read, and - when there is no value - why there is none. `value: null` with
 * `status: 'UNAVAILABLE'` is the only way to say "not known"; a zero is a measurement.
 */
export interface TraderActiveFollowersMetric {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  value: number | null;
  source: string | null;
  asOf: string | null;
  reason: string | null;
}

/**
 * Assets under management, withheld rather than estimated. There is no canonical follower-portfolio
 * valuation in this platform, and a published AUM would be a number nobody can reconcile.
 */
export interface TraderAumMetric {
  status: 'UNAVAILABLE';
  value: null;
  currency: null;
  source: null;
  asOf: null;
  reason: 'NO_AUTHORITATIVE_FOLLOWER_PORTFOLIO_VALUATION';
}

export interface TraderActivityMetric {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  source: string | null;
  latestRecordedFillAt: string | null;
  sampledFillCount: number | null;
  sampleLimit: number;
  hasMore: boolean;
  /**
   * How the published volume was derived: from the venue's own quote quantity, from quantity x
   * price, or from both across the sample. `NONE` means there were no fills to measure.
   */
  calculationMethod: 'NONE' | 'QUOTE_QUANTITY' | 'PRICE_TIMES_QUANTITY' | 'MIXED';
  volumeByQuoteAsset: TraderQuoteAssetVolume[];
  asOf: string;
  reason: string | null;
}

export interface TraderRiskScoreView {
  status: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';
  score: number | null;
  band: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' | 'UNAVAILABLE';
  confidence: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
  methodology: 'risk-score-v1';
  asOf: string;
  factors: TraderRiskFactorResult[];
}

/** The complete published statistics for one trader profile. */
export interface TraderSafePublicStatistics {
  traderId: string;
  activeFollowers: TraderActiveFollowersMetric;
  aum: TraderAumMetric;
  activity: TraderActivityMetric;
  riskScore: TraderRiskScoreView;
}

/** The windows a ranking may be asked for. Only these three, so a window is never invented. */
export type TraderRankingTimeframe = '7D' | '30D' | '90D';

export const TRADER_RANKING_TIMEFRAMES: readonly TraderRankingTimeframe[] = ['7D', '30D', '90D'];

export const TRADER_RANKING_WINDOW_DAYS: Record<TraderRankingTimeframe, number> = {
  '7D': 7,
  '30D': 30,
  '90D': 90,
};

export type TraderRankingPeriodStatus = 'AVAILABLE' | 'UNAVAILABLE';

export interface TraderRankingMethodology {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  key: 'RECONCILED_CLOSED_PERIOD_TWR';
  /** The method in words, so a reader learns how the number was produced and what it excludes. */
  description: string;
  timeframe: TraderRankingTimeframe;
  /** The exact instant the window opens, or null when no persisted period established an as-of. */
  windowStart: string | null;
  asOf: string | null;
  /** Names the admission test: a window is used only if its periods tile it exactly. */
  boundaryRule: 'EXACT_CONTIGUOUS_PERIODS_ONLY';
  /** Names the ordering: ranked rows by window return descending, unranked rows after them. */
  orderingRule: 'RETURN_DESCENDING_UNAVAILABLE_LAST';
  currentnessRule: string;
  minimumPeriodCount: number;
  rankedCount: number;
  unrankedCount: number;
  /**
   * Why any row is unranked, taken from those rows' own reasons; null when every row was ranked.
   * Present even when `status` is AVAILABLE, because "four of five ranked" is exactly the case where
   * a reader needs to know why the fifth was not - and a bare count does not say.
   */
  reason: string | null;
}

export interface TraderRankingPage {
  data: TraderRanking[];
  total: number;
  timeframe: TraderRankingTimeframe;
  methodology: TraderRankingMethodology;
}

export interface TraderRanking {
  traderId: string;
  tenantId: string;
  displayName: string;
  verificationState: TraderVerificationState;
  isPublic: boolean;
  isFeatured: boolean;
  followerCount: number;
  performance: TraderPerformance | null;
  score: number;
  /**
   * The rank within the requested window, or null when the trader has no window that proves one.
   * Null is not "last place": an unranked trader is excluded from the ordering rather than sorted to
   * the bottom, because a number would imply the window was measured and simply came out worst.
   */
  rank: number | null;
  /**
   * The reconciled closed-period window. `periodReturnPercent` is the only figure here that comes
   * from the window itself; the `performance` object above is a separate, fill-derived view and is
   * not what the rank is computed from.
   */
  timeframe: TraderRankingTimeframe;
  periodStatus: TraderRankingPeriodStatus;
  periodReturnPercent: string | null;
  flowBoundary: string | null;
  sourceCalculationVersion: string | null;
  observationCount: number | null;
  /** Why no window return is published. Present only when `periodStatus` is UNAVAILABLE. */
  unavailableReason?: string;
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

export interface CopyReconciliationResult {
  id: string;
  tenantId: string;
  leaderEventId: string;
  subscriptionId: string | null;
  executionId: string | null;
  category: CopyReconciliationCategory;
  severity: CopyReconciliationSeverity;
  expected: Record<string, any> | null;
  actual: Record<string, any> | null;
  leaderReference: Record<string, any> | null;
  followerReference: Record<string, any> | null;
  resolved: boolean;
  createdAt: string;
}

export const FORBIDDEN_COPY_FIELDS = ['secret', 'apiKey', 'apiSecret', 'passphrase', 'privateKey', 'withdrawal', 'profit', 'roi', 'balance'] as const;

export function sanitizeCopyMetadata(metadata: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_COPY_FIELDS.some((f) => lower.includes(f.toLowerCase()))) {
      if (['profit', 'roi', 'balance'].includes(lower)) {
        continue;
      }
      if (['secret', 'apikey', 'apisecret', 'passphrase', 'privatekey', 'withdrawal'].some((s) => lower.includes(s))) {
        continue;
      }
    }
    if (typeof value === 'string' && value.length > 1000) {
      sanitized[key] = value.substring(0, 1000);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeCopyMetadata(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function isDecimalString(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value.trim());
}

/**
 * Whether one symbol rule matches a symbol.
 *
 * Rules are globs, not literals: the platform policy blocks `*WITHDRAWAL*` and a bare `*` means
 * every symbol. Enforcement compared with `Array.includes`, so that platform rule could never fire
 * - no symbol is equal to the eleven-character string `*WITHDRAWAL*` - and the guardrail that
 * exists to make withdrawal-like instruments uncopyable was inert. Matching is case-insensitive
 * because venues disagree on the case of the same instrument.
 *
 * A rule with no `*` still matches exactly, so every existing exact-symbol policy behaves as before.
 * This is the one matcher: the copy mapper, the follower risk check and symbol-rule validation all
 * call it, so a rule cannot mean one thing in one place and something else in another.
 */
export function matchesSymbolRule(rule: string, symbol: string): boolean {
  if (typeof rule !== 'string' || typeof symbol !== 'string') return false;
  const trimmed = rule.trim();
  if (trimmed.length === 0 || symbol.length === 0) return false;
  const upperSymbol = symbol.toUpperCase();
  if (!trimmed.includes('*')) return trimmed.toUpperCase() === upperSymbol;
  const pattern = trimmed
    .toUpperCase()
    .replace(/[\\^$.*+?()[\]{}|]/g, (character) => (character === '*' ? '.*' : `\\${character}`));
  return new RegExp(`^${pattern}$`).test(upperSymbol);
}

/** Whether any rule in the list matches the symbol. Absent or empty lists match nothing. */
export function matchesAnySymbolRule(rules: string[] | null | undefined, symbol: string): boolean {
  if (!Array.isArray(rules) || rules.length === 0) return false;
  return rules.some((rule) => matchesSymbolRule(rule, symbol));
}

export function compareDecimalStrings(a: string, b: string): number {
  // Returns -1 if a<b, 0 if equal, 1 if a>b, without float
  const [aInt, aDec = ''] = a.split('.');
  const [bInt, bDec = ''] = b.split('.');
  const aNeg = aInt.startsWith('-');
  const bNeg = bInt.startsWith('-');
  if (aNeg && !bNeg) return -1;
  if (!aNeg && bNeg) return 1;
  const maxDec = Math.max(aDec.length, bDec.length);
  const aPadded = (aInt.replace('-', '') + aDec.padEnd(maxDec, '0')).padStart(20, '0');
  const bPadded = (bInt.replace('-', '') + bDec.padEnd(maxDec, '0')).padStart(20, '0');
  const aBig = BigInt(aPadded);
  const bBig = BigInt(bPadded);
  if (aNeg) {
    if (aBig < bBig) return 1;
    if (aBig > bBig) return -1;
    return 0;
  } else {
    if (aBig < bBig) return -1;
    if (aBig > bBig) return 1;
    return 0;
  }
}
