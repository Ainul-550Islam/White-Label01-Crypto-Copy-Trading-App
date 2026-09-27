/**
 * Canonical fee domain types.
 * Supports platform fee and performance fee using existing plan configuration.
 * No hardcoded commercial rates - all resolved from canonical policy.
 */

export enum FeeType {
  PLATFORM_FEE = 'PLATFORM_FEE',
  PERFORMANCE_FEE = 'PERFORMANCE_FEE',
}

export enum FeeSourceType {
  PAYMENT = 'PAYMENT',
  SUBSCRIPTION = 'SUBSCRIPTION',
  INVOICE = 'INVOICE',
  TRADING_PERFORMANCE = 'TRADING_PERFORMANCE',
  COPY_TRADING_SETTLEMENT = 'COPY_TRADING_SETTLEMENT',
  TRADER_PNL = 'TRADER_PNL',
  MANUAL = 'MANUAL',
  REVENUE_EVENT = 'REVENUE_EVENT',
}

export enum RateBasis {
  BPS = 'BPS',
  PERCENTAGE = 'PERCENTAGE',
}

export enum FeeAccrualStatus {
  PENDING = 'PENDING',
  CALCULATED = 'CALCULATED',
  ACCRUED = 'ACCRUED',
  SETTLED = 'SETTLED',
  REVERSED = 'REVERSED',
  FAILED = 'FAILED',
}

export enum SettlementState {
  DRAFT = 'DRAFT',
  CALCULATED = 'CALCULATED',
  APPROVED = 'APPROVED',
  FINALIZED = 'FINALIZED',
  PAID = 'PAID',
  FAILED = 'FAILED',
  REVERSED = 'REVERSED',
}

export enum PayoutState {
  CREATED = 'CREATED',
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  REVERSED = 'REVERSED',
}

export enum AccrualPeriod {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  CUSTOM = 'CUSTOM',
  INSTANT = 'INSTANT',
}

export interface FeeRate {
  basisPoints: number;
  basis: RateBasis;
  effectivePercent: string;
  source: 'plan' | 'tenant_override' | 'global_policy';
  planId?: string;
  planCode?: string;
}

export interface FeePolicySnapshot {
  tenantId: string;
  planId: string | null;
  planCode: string | null;
  platformFeeBps: number;
  performanceFeeBps: number;
  currency: string;
  effectiveAt: string;
  source: 'plan' | 'tenant_override' | 'global_policy';
  minimumFee?: string | null;
  maximumCap?: string | null;
  metadata?: Record<string, unknown>;
}

export interface FeeCalculationInput {
  tenantId: string;
  sourceType: FeeSourceType;
  sourceId: string;
  feeType: FeeType;
  grossAmount: string;
  currency: string;
  feeRateBps: number;
  minimumFee?: string | null;
  maximumCap?: string | null;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface FeeCalculationResult {
  tenantId: string;
  sourceType: FeeSourceType;
  sourceId: string;
  feeType: FeeType;
  grossAmount: string;
  feeAmount: string;
  netAmount: string;
  currency: string;
  feeRateBps: number;
  rateBasis: RateBasis;
  calculatedAt: string;
  minimumApplied: boolean;
  capApplied: boolean;
  metadata?: Record<string, unknown>;
}

export interface FeeAccrual {
  id: string;
  tenantId: string;
  sourceType: FeeSourceType;
  sourceId: string;
  feeType: FeeType;
  feeRateBps: number;
  rateBasis: RateBasis;
  grossAmount: string;
  feeAmount: string;
  netAmount: string;
  currency: string;
  status: FeeAccrualStatus;
  settlementState: SettlementState;
  payoutState: PayoutState | null;
  settlementId: string | null;
  payoutId: string | null;
  ledgerTransactionId: string | null;
  idempotencyKey: string;
  policySnapshot: FeePolicySnapshot;
  calculationTimestamp: string;
  settlementTimestamp: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown> | null;
  safeMetadata: Record<string, unknown> | null;
}

export interface SettlementBatch {
  id: string;
  tenantId: string;
  currency: string;
  grossFeeAmount: string;
  adjustments: string;
  finalSettlementAmount: string;
  numberOfAccruals: number;
  feeType: FeeType | 'MIXED';
  status: SettlementState;
  idempotencyKey: string;
  accrualIds: string[];
  createdAt: string;
  calculatedAt: string | null;
  approvedAt: string | null;
  finalizedAt: string | null;
  paidAt: string | null;
  metadata: Record<string, unknown> | null;
}

export interface SettlementItem {
  id: string;
  settlementId: string;
  accrualId: string;
  tenantId: string;
  feeType: FeeType;
  feeAmount: string;
  currency: string;
  status: SettlementState;
}

export interface FeeSummary {
  tenantId: string;
  periodStart: string | null;
  periodEnd: string | null;
  currency: string;
  feeType: FeeType | 'ALL';
  grossAmount: string;
  feeAmount: string;
  netAmount: string;
  accruedCount: number;
  settledCount: number;
  paidCount: number;
  pendingCount: number;
  accruedTotal: string;
  settledTotal: string;
  paidTotal: string;
  pendingTotal: string;
  effectiveRateBps: number | null;
}

export interface ReconciliationIssue {
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  category:
    | 'MISSING_ACCRUAL'
    | 'MISSING_LEDGER'
    | 'MISSING_SETTLEMENT'
    | 'MISSING_PAYOUT'
    | 'AMOUNT_MISMATCH'
    | 'CURRENCY_MISMATCH'
    | 'DUPLICATE_FEE'
    | 'DUPLICATE_PAYOUT'
    | 'MISSING_PROVIDER_CONFIRMATION'
    | 'REVERSAL_MISMATCH'
    | 'ORPHAN_LEDGER';
  sourceType: FeeSourceType;
  sourceId: string;
  accrualId?: string;
  settlementId?: string;
  payoutId?: string;
  detectedAmount?: string;
  expectedAmount?: string;
  currency?: string;
  description: string;
  detectedAt: string;
}

export interface FeeAnalytics {
  tenantId: string | null;
  period: string;
  currency: string;
  platformFeeTotal: string;
  performanceFeeTotal: string;
  totalFees: string;
  accruedTotal: string;
  settledTotal: string;
  paidTotal: string;
  pendingTotal: string;
  reversedTotal: string;
  failedCount: number;
  breakdownBySource: Record<string, string>;
  breakdownByCurrency: Record<string, string>;
  breakdownByFeeType: Record<string, string>;
}
