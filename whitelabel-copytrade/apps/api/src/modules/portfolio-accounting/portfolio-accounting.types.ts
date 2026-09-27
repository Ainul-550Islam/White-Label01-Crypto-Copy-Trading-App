/**
 * Part 19 — Portfolio Accounting, Performance & Investor Reporting
 * Canonical accounting scopes, portfolio types, position classifications, cash-flow types,
 * valuation states, period states, return methodologies, attribution dimensions, statement states,
 * reconciliation states, adjustment types, and calculation version identifiers.
 *
 * Rules:
 * - Never use float for financial calculations — Decimal/string/integer minor-unit arithmetic only.
 * - Every accounting event traceable to authoritative source reference.
 * - Historical closed periods immutable.
 * - Corrections are reversal/adjustment events, never destructive mutation.
 * - Multi-currency explicit, missing FX does not invent NAV.
 */

import { createHash } from 'crypto';

export enum PortfolioAccountingScope {
  TENANT = 'TENANT',
  TRADER = 'TRADER',
  FOLLOWER = 'FOLLOWER',
  STRATEGY = 'STRATEGY',
  MANAGED_ACCOUNT = 'MANAGED_ACCOUNT',
}

export enum PortfolioType {
  SPOT = 'SPOT',
  MARGIN = 'MARGIN',
  FUTURES = 'FUTURES',
  MANAGED = 'MANAGED',
  COPY_TRADING = 'COPY_TRADING',
  PAPER = 'PAPER',
}

export enum PortfolioPositionClassification {
  LONG = 'LONG',
  SHORT = 'SHORT',
  FLAT = 'FLAT',
  CASH = 'CASH',
}

export enum PortfolioCashFlowType {
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
  TRANSFER_IN = 'TRANSFER_IN',
  TRANSFER_OUT = 'TRANSFER_OUT',
  TRADE_SETTLEMENT_BUY = 'TRADE_SETTLEMENT_BUY',
  TRADE_SETTLEMENT_SELL = 'TRADE_SETTLEMENT_SELL',
  FEE = 'FEE',
  PLATFORM_FEE = 'PLATFORM_FEE',
  PERFORMANCE_FEE = 'PERFORMANCE_FEE',
  FUNDING = 'FUNDING',
  ADJUSTMENT = 'ADJUSTMENT',
  REVERSAL = 'REVERSAL',
  DIVIDEND = 'DIVIDEND',
  INTEREST = 'INTEREST',
}

export enum PortfolioValuationState {
  VALID = 'VALID',
  STALE = 'STALE',
  MISSING_PRICE = 'MISSING_PRICE',
  MISSING_FX = 'MISSING_FX',
  INCOMPLETE = 'INCOMPLETE',
  UNAVAILABLE = 'UNAVAILABLE',
}

export enum PortfolioPeriodState {
  OPEN = 'OPEN',
  CLOSING = 'CLOSING',
  CLOSED = 'CLOSED',
}

export enum PortfolioReturnMethodology {
  TIME_WEIGHTED_RETURN = 'TIME_WEIGHTED_RETURN',
  MONEY_WEIGHTED_RETURN = 'MONEY_WEIGHTED_RETURN',
}

export enum PortfolioAttributionDimension {
  STRATEGY = 'STRATEGY',
  TRADER = 'TRADER',
  FOLLOWER = 'FOLLOWER',
  SYMBOL = 'SYMBOL',
  ASSET = 'ASSET',
  VENUE = 'VENUE',
  COPY_ALLOCATION = 'COPY_ALLOCATION',
  FEE = 'FEE',
}

export enum PortfolioStatementState {
  DRAFT = 'DRAFT',
  FINALIZED = 'FINALIZED',
  SUPERSEDED = 'SUPERSEDED',
  VOID = 'VOID',
}

export enum PortfolioReconciliationState {
  PENDING = 'PENDING',
  MATCHED = 'MATCHED',
  MISMATCH = 'MISMATCH',
  RESOLVED = 'RESOLVED',
  FAILED = 'FAILED',
}

export enum PortfolioAdjustmentType {
  CORRECTION = 'CORRECTION',
  REVERSAL = 'REVERSAL',
  MANUAL_ADJUSTMENT = 'MANUAL_ADJUSTMENT',
  FEE_CORRECTION = 'FEE_CORRECTION',
  CASH_CORRECTION = 'CASH_CORRECTION',
  POSITION_CORRECTION = 'POSITION_CORRECTION',
}

export enum PortfolioPnLType {
  REALIZED = 'REALIZED',
  UNREALIZED = 'UNREALIZED',
  GROSS = 'GROSS',
  FEE_ADJUSTED = 'FEE_ADJUSTED',
  NET = 'NET',
}

export const PERIOD_VALID_TRANSITIONS: Record<PortfolioPeriodState, PortfolioPeriodState[]> = {
  [PortfolioPeriodState.OPEN]: [PortfolioPeriodState.CLOSING],
  [PortfolioPeriodState.CLOSING]: [PortfolioPeriodState.CLOSED, PortfolioPeriodState.OPEN],
  [PortfolioPeriodState.CLOSED]: [], // immutable, cannot be silently rewritten
};

// Calculation version identifiers — preserve methodology version for reproducibility
export const CALCULATION_VERSION = 'portfolio-acct-v1.0.0';
export const POLICY_VERSION_DEFAULT = 'portfolio-policy-v1.0.0';

// Decimal-safe arithmetic — SCALE 1e12 (same as OMS) or minor-unit string arithmetic
export const DECIMAL_SCALE = 12;
export const SCALE_FACTOR = BigInt(10 ** DECIMAL_SCALE); // 1_000_000_000_000

export function isValidDecimal(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value);
}

export function parseScaled(value: string): bigint {
  if (!isValidDecimal(value)) throw new Error(`Invalid decimal: ${value}`);
  const [intPart, fracPart = ''] = value.replace('-', '').split('.');
  const isNeg = value.startsWith('-');
  const paddedFrac = (fracPart + '0'.repeat(DECIMAL_SCALE)).slice(0, DECIMAL_SCALE);
  const scaled = BigInt(intPart) * SCALE_FACTOR + BigInt(paddedFrac || '0');
  return isNeg ? -scaled : scaled;
}

export function formatScaled(scaled: bigint): string {
  const isNeg = scaled < 0n;
  const abs = isNeg ? -scaled : scaled;
  const intPart = abs / SCALE_FACTOR;
  const fracPart = abs % SCALE_FACTOR;
  let fracStr = fracPart.toString().padStart(DECIMAL_SCALE, '0').replace(/0+$/, '');
  const result = fracStr ? `${intPart.toString()}.${fracStr}` : intPart.toString();
  return isNeg ? `-${result}` : result;
}

export function add(a: string, b: string): string {
  return formatScaled(parseScaled(a) + parseScaled(b));
}

export function sub(a: string, b: string): string {
  return formatScaled(parseScaled(a) - parseScaled(b));
}

export function mul(a: string, b: string): string {
  const aScaled = parseScaled(a);
  const bScaled = parseScaled(b);
  return formatScaled((aScaled * bScaled) / SCALE_FACTOR);
}

export function div(a: string, b: string): string {
  if (b === '0' || b === '0.0') throw new Error('Division by zero');
  const aScaled = parseScaled(a);
  const bScaled = parseScaled(b);
  return formatScaled((aScaled * SCALE_FACTOR) / bScaled);
}

export function cmp(a: string, b: string): number {
  const aS = parseScaled(a);
  const bS = parseScaled(b);
  if (aS < bS) return -1;
  if (aS > bS) return 1;
  return 0;
}

export function absStr(a: string): string {
  return a.startsWith('-') ? a.slice(1) : a;
}

// Deterministic fingerprint and idempotency
export function deterministicAccountingFingerprint(params: {
  sourceType: string;
  sourceId: string;
  tenantId: string;
  profileId?: string;
  asset?: string;
  quantity?: string;
}): string {
  const normalized = [
    params.sourceType.trim().toLowerCase(),
    params.sourceId.trim(),
    params.tenantId.trim().toLowerCase(),
    (params.profileId ?? '').trim().toLowerCase(),
    (params.asset ?? '').trim().toLowerCase(),
    (params.quantity ?? '').trim(),
  ].join('|');
  return createHash('sha256').update(normalized).digest('hex');
}

export function deterministicIdempotencyKey(params: {
  type: string;
  tenantId: string;
  profileId?: string;
  sourceId?: string;
  timestampBucket?: string;
}): string {
  const bucket = params.timestampBucket ?? new Date().toISOString().slice(0, 10);
  const raw = [params.type, params.tenantId, params.profileId ?? '', params.sourceId ?? '', bucket].join('|');
  return createHash('sha256').update(raw).digest('hex');
}

// Secret redaction — never expose credentials, private keys, signatures, tokens, secrets
const SECRET_PATTERNS = [/api[_-]?key/i, /secret/i, /password/i, /private[_-]?key/i, /token/i, /signature/i, /credential/i, /passphrase/i, /auth/i, /bearer/i];

export function redactSecrets<T>(input: T): T {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    if (input.length > 20 && /[A-Za-z0-9+/=]{20,}/.test(input)) return '[REDACTED]' as unknown as T;
    return input;
  }
  if (Array.isArray(input)) return input.map((v) => redactSecrets(v)) as unknown as T;
  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const isSecret = SECRET_PATTERNS.some((p) => p.test(k.toLowerCase()));
      result[k] = isSecret ? '[REDACTED]' : redactSecrets(v);
    }
    return result as unknown as T;
  }
  return input;
}

export interface ValuationEvidence {
  symbol?: string;
  asset: string;
  quantity: string;
  marketPrice?: string | null;
  marketPriceSource?: string | null;
  marketPriceTimestamp?: string | null;
  valuationState: PortfolioValuationState;
  conversionRate?: string | null;
  conversionSource?: string | null;
  conversionTimestamp?: string | null;
  conversionStatus?: string | null;
  baseCurrency: string;
  valuationTimestamp: string;
  dataCompleteness: string;
  sourceReferences: string[];
}

export interface NavCalculationEvidence {
  cash: string;
  grossAssetValue: string;
  grossLiability: string;
  adjustments: string;
  nav: string;
  baseCurrency: string;
  valuationTimestamp: string;
  calculationVersion: string;
  policyVersion: string;
  sourceReferences: string[];
  methodology: string;
  dataCompleteness: string;
  conversionEvidences: ValuationEvidence[];
}

export interface PnLEvidence {
  type: PortfolioPnLType;
  amount: string;
  baseCurrency: string;
  costBasisRefs: string[];
  fillRefs: string[];
  valuationRefs: string[];
  feeRefs: string[];
  calculationVersion: string;
  policyVersion: string;
  valuationTimestamp: string;
  methodology: string;
  dataCompleteness: string;
}

export interface PerformanceEvidence {
  methodology: PortfolioReturnMethodology;
  periodStart: string;
  periodEnd: string;
  startingNav: string;
  endingNav: string;
  externalCashFlows: Array<{ date: string; amount: string; type: string }>;
  feesTreatment: string;
  returnPercent: string | null;
  calculationVersion: string;
  policyVersion: string;
  dataCompleteness: string;
  sourceReferences: string[];
}
