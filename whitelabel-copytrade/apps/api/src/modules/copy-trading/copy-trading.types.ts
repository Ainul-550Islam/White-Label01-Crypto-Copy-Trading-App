/**
 * Canonical copy-trading domain types: trader profile, strategy, follower subscription, allocation, copy policy, risk settings, copier state, execution intent, and performance references.
 * Do not store raw secrets.
 */

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
  reduceOnly: boolean | null;
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
  emergencyStopCopy: boolean;
  dailyPauseEnabled: boolean;
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
  realizedPnl: string; // Decimal-safe
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
  isActual: boolean; // true=ACTUAL from fills, false=ESTIMATED
  source: string; // e.g. FILLS, ORDERS, SETTLEMENT
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
        // These are forbidden as client-provided authoritative values, but may be present as derived references - we allow if explicitly marked as derived?
        // For safety, we skip them unless they are in safePerformanceReferences
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
