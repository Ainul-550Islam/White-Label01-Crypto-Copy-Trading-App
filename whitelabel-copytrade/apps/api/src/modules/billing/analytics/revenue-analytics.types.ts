/**
 * Canonical SaaS analytics types: MRR, ARR, revenue, recognized revenue, collected cash, refunds, fees, taxes, churn, retention, ARPU, customer counts, period snapshots.
 * All financial amounts are currency-aware and Decimal-safe (string representation, never float).
 */

export enum BillingInterval {
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  YEARLY = 'YEARLY',
  LIFETIME = 'LIFETIME',
}

export enum SubscriptionStatus {
  TRIALING = 'TRIALING',
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  CANCELED = 'CANCELED',
  EXPIRED = 'EXPIRED',
  PAUSED = 'PAUSED',
}

export enum ReportingPeriodType {
  DAY = 'DAY',
  WEEK = 'WEEK',
  MONTH = 'MONTH',
  QUARTER = 'QUARTER',
  YEAR = 'YEAR',
  CUSTOM = 'CUSTOM',
  ALL_TIME = 'ALL_TIME',
}

export enum ChurnType {
  VOLUNTARY = 'VOLUNTARY',
  FAILED_PAYMENT = 'FAILED_PAYMENT',
  EXPIRATION = 'EXPIRATION',
  DOWNGRADE = 'DOWNGRADE',
  UNKNOWN = 'UNKNOWN',
}

export enum RevenueType {
  RECURRING = 'RECURRING',
  ONE_TIME = 'ONE_TIME',
  USAGE = 'USAGE',
  FEE = 'FEE',
  ALL = 'ALL',
}

export enum CohortDefinition {
  SIGNUP_MONTH = 'SIGNUP_MONTH',
  FIRST_SUBSCRIPTION_MONTH = 'FIRST_SUBSCRIPTION_MONTH',
  FIRST_PAID_MONTH = 'FIRST_PAID_MONTH',
}

export enum ValueEstimationType {
  ACTUAL = 'ACTUAL',
  ESTIMATED = 'ESTIMATED',
}

export interface MoneyAmount {
  amount: string; // Decimal-safe string, never float
  currency: string; // ISO 4217 or crypto code
  minorUnit: number; // e.g. 2 for USD, 8 for BTC
}

export interface CurrencyBucket {
  currency: string;
  amounts: MoneyAmount[];
  total: MoneyAmount;
}

export interface ReportingPeriod {
  type: ReportingPeriodType;
  startDate: string; // ISO
  endDate: string; // ISO
  timezone: string; // e.g. UTC
  label: string;
}

export interface ComparisonPeriod {
  current: ReportingPeriod;
  previous?: ReportingPeriod;
}

export interface MrrBreakdown {
  totalMrr: MoneyAmount;
  newMrr: MoneyAmount;
  expansionMrr: MoneyAmount;
  contractionMrr: MoneyAmount;
  churnedMrr: MoneyAmount;
  netNewMrr: MoneyAmount;
  currency: string;
  activeSubscriptions: number;
  calculationDate: string;
  methodology: string;
  byPlan: { planId: string; planCode: string; planName: string; mrr: MoneyAmount; count: number }[];
  byInterval: { interval: BillingInterval; mrr: MoneyAmount; count: number }[];
}

export interface ArrBreakdown {
  totalArr: MoneyAmount;
  currency: string;
  activeSubscriptions: number;
  calculationDate: string;
  methodology: string;
  byPlan: { planId: string; planCode: string; planName: string; arr: MoneyAmount; count: number }[];
  byInterval: { interval: BillingInterval; arr: MoneyAmount; count: number }[];
}

export interface RevenueSnapshot {
  period: ReportingPeriod;
  currency: string;
  grossRevenue: MoneyAmount;
  netRevenue: MoneyAmount;
  recurringRevenue: MoneyAmount;
  oneTimeRevenue: MoneyAmount;
  recognizedRevenue: MoneyAmount;
  deferredRevenue: MoneyAmount;
  cashCollected: MoneyAmount;
  refunds: MoneyAmount;
  taxes: MoneyAmount;
  fees: MoneyAmount;
  platformFees: MoneyAmount;
  performanceFees: MoneyAmount;
  receivables: MoneyAmount;
  outstandingAmount: MoneyAmount;
  mrr: MoneyAmount;
  arr: MoneyAmount;
  arpu: MoneyAmount;
  customerCount: number;
  activeSubscriptionCount: number;
  newCustomerCount: number;
  churnedCustomerCount: number;
  source: {
    invoiceCount: number;
    paymentCount: number;
    refundCount: number;
    subscriptionCount: number;
    ledgerEntryCount: number;
  };
  calculatedAt: string;
}

export interface RevenueOverview {
  current: RevenueSnapshot;
  previous?: RevenueSnapshot;
  comparison?: {
    grossRevenueChange: string; // percent as string Decimal-safe
    netRevenueChange: string;
    mrrChange: string;
    arrChange: string;
    customerCountChange: string;
  };
  currencyBuckets?: CurrencyBucket[];
  multiCurrencyWarning?: string;
}

export interface ChurnMetrics {
  period: ReportingPeriod;
  currency: string;
  customerChurnCount: number;
  customerChurnRate: string; // percent Decimal-safe
  subscriptionChurnCount: number;
  subscriptionChurnRate: string;
  voluntaryChurnCount: number;
  failedPaymentChurnCount: number;
  expirationChurnCount: number;
  logoChurnCount: number;
  logoChurnRate: string;
  revenueChurnAmount: MoneyAmount;
  revenueChurnRate: string;
  netRevenueRetention: string;
  grossRevenueRetention: string;
  totalCustomersStart: number;
  totalCustomersEnd: number;
  totalSubscriptionsStart: number;
  totalSubscriptionsEnd: number;
  methodology: string;
  calculatedAt: string;
}

export interface RetentionMetrics {
  period: ReportingPeriod;
  retentionRate: string;
  churnRate: string;
  retainedCount: number;
  churnedCount: number;
  startCount: number;
  endCount: number;
  methodology: string;
}

export interface SubscriptionKpis {
  period: ReportingPeriod;
  activeSubscriptions: number;
  trialSubscriptions: number;
  cancelledSubscriptions: number;
  expiredSubscriptions: number;
  scheduledCancellations: number;
  newSubscriptions: number;
  renewedSubscriptions: number;
  churnedSubscriptions: number;
  upgradedSubscriptions: number;
  downgradedSubscriptions: number;
  averageTenureDays: number;
  averageSeats: string;
  planDistribution: { planId: string; planCode: string; planName: string; count: number; percentage: string }[];
  intervalDistribution: { interval: BillingInterval; count: number; percentage: string }[];
  statusDistribution: { status: SubscriptionStatus; count: number; percentage: string }[];
  calculatedAt: string;
}

export interface PlanPerformanceMetrics {
  planId: string;
  planCode: string;
  planName: string;
  currency: string;
  period: ReportingPeriod;
  subscribers: number;
  activeSubscribers: number;
  trialSubscribers: number;
  cancelledSubscribers: number;
  newSubscribers: number;
  churnedSubscribers: number;
  mrr: MoneyAmount;
  arr: MoneyAmount;
  grossRevenue: MoneyAmount;
  netRevenue: MoneyAmount;
  refunds: MoneyAmount;
  churnRate: string;
  upgradeCount: number;
  downgradeCount: number;
  averageTenureDays: number;
  utilizationRate?: string;
  calculatedAt: string;
}

export interface CustomerValueMetrics {
  tenantId: string;
  customerId?: string;
  period: ReportingPeriod;
  currency: string;
  currentMrr: MoneyAmount;
  currentArr: MoneyAmount;
  totalPaid: MoneyAmount;
  totalRefunded: MoneyAmount;
  netPaid: MoneyAmount;
  recurringValue: MoneyAmount;
  averageMonthlyValue: MoneyAmount;
  tenureDays: number;
  subscriptionCount: number;
  activeSubscription: boolean;
  currentPlanId?: string;
  currentPlanCode?: string;
  planHistory: { planId: string; planCode: string; from: string; to?: string }[];
  estimationType: ValueEstimationType;
  lifetimeValueInput: MoneyAmount;
  segment?: string;
  calculatedAt: string;
}

export interface BillingHealthMetrics {
  period: ReportingPeriod;
  currency: string;
  totalPayments: number;
  successfulPayments: number;
  failedPayments: number;
  pendingPayments: number;
  paymentSuccessRate: string;
  paymentFailureRate: string;
  pendingRate: string;
  totalInvoices: number;
  paidInvoices: number;
  overdueInvoices: number;
  outstandingInvoices: number;
  overdueRate: string;
  totalRefunds: number;
  refundRate: string;
  refundAmount: MoneyAmount;
  openDunningCases: number;
  recoveredDunningCases: number;
  failedDunningCases: number;
  dunningRecoveryRate: string;
  averagePaymentProcessingDurationMs?: number;
  checkoutConversionRate?: string;
  calculatedAt: string;
}

export interface CashflowSnapshot {
  period: ReportingPeriod;
  currency: string;
  collectedCash: MoneyAmount;
  successfulPaymentAmount: MoneyAmount;
  failedPaymentAmount: MoneyAmount;
  pendingPaymentAmount: MoneyAmount;
  refunds: MoneyAmount;
  netCash: MoneyAmount;
  outstandingInvoicesAmount: MoneyAmount;
  dunningExposure: MoneyAmount;
  feePayouts: MoneyAmount;
  taxCollected: MoneyAmount;
  grossCashIn: MoneyAmount;
  grossCashOut: MoneyAmount;
  source: {
    paymentCount: number;
    invoiceCount: number;
    refundCount: number;
  };
  calculatedAt: string;
}

export interface CohortMetrics {
  cohortDefinition: CohortDefinition;
  cohortPeriod: string; // e.g. 2024-01
  period: ReportingPeriod;
  currency: string;
  cohortSize: number;
  retainedCount: number;
  retentionRate: string;
  churnedCount: number;
  churnRate: string;
  recurringRevenue: MoneyAmount;
  cumulativeRevenue: MoneyAmount;
  averageRevenuePerCustomer: MoneyAmount;
  calculatedAt: string;
}

export interface CohortAnalysis {
  definition: CohortDefinition;
  currency: string;
  cohorts: CohortMetrics[];
  retentionMatrix: { cohortPeriod: string; periods: { period: string; retained: number; rate: string }[] }[];
  calculatedAt: string;
}

export interface FinancialReport {
  period: ReportingPeriod;
  currency: string;
  grossRevenue: MoneyAmount;
  netRevenue: MoneyAmount;
  recurringRevenue: MoneyAmount;
  oneTimeRevenue: MoneyAmount;
  cashCollected: MoneyAmount;
  refunds: MoneyAmount;
  taxes: MoneyAmount;
  fees: MoneyAmount;
  platformFees: MoneyAmount;
  performanceFees: MoneyAmount;
  receivables: MoneyAmount;
  outstanding: MoneyAmount;
  mrr: MoneyAmount;
  arr: MoneyAmount;
  arpu: MoneyAmount;
  customerCount: number;
  activeSubscriptions: number;
  sourceReferences: {
    invoiceIds: string[];
    paymentIds: string[];
    refundIds: string[];
    subscriptionIds: string[];
  };
  methodology: string;
  calculatedAt: string;
  comparison?: {
    previousPeriod: ReportingPeriod;
    grossRevenueChange: string;
    netRevenueChange: string;
    mrrChange: string;
  };
}

export interface ReconciliationIssue {
  id: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  category: 'MRR_MISMATCH' | 'ARR_MISMATCH' | 'INVOICE_MISMATCH' | 'PAYMENT_MISMATCH' | 'REFUND_MISMATCH' | 'FEE_MISMATCH' | 'CURRENCY_MISMATCH' | 'MISSING_SOURCE' | 'DUPLICATE_SOURCE' | 'IMPOSSIBLE_STATE';
  period?: ReportingPeriod;
  tenantId?: string;
  currency?: string;
  expected: string;
  detected: string;
  difference: string;
  sourceReference: string;
  sourceType: 'SUBSCRIPTION' | 'INVOICE' | 'PAYMENT' | 'REFUND' | 'LEDGER' | 'FEE' | 'ANALYTICS';
  description: string;
  detectedAt: string;
}

export interface ReconciliationResult {
  period: ReportingPeriod;
  currency: string;
  checkedAt: string;
  totalChecked: number;
  issuesFound: number;
  issues: ReconciliationIssue[];
  summary: {
    mrrMatched: boolean;
    arrMatched: boolean;
    invoiceMatched: boolean;
    paymentMatched: boolean;
    refundMatched: boolean;
    feeMatched: boolean;
    ledgerMatched: boolean;
  };
}

// Decimal-safe helpers
export const CURRENCY_MINOR_UNITS: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
  CAD: 2,
  AUD: 2,
  BTC: 8,
  ETH: 18,
  USDT: 6,
  USDC: 6,
};

export function getMinorUnitForCurrency(currency: string): number {
  return CURRENCY_MINOR_UNITS[currency.toUpperCase()] ?? 2;
}

export function parseToMinorUnits(amount: string, currency: string): number {
  const minorUnit = getMinorUnitForCurrency(currency);
  const factor = Math.pow(10, minorUnit);
  const parsed = parseFloat(amount);
  if (isNaN(parsed)) throw new Error(`Invalid amount: ${amount}`);
  return Math.round(parsed * factor);
}

export function formatFromMinorUnits(minorUnits: number, currency: string): string {
  const minorUnit = getMinorUnitForCurrency(currency);
  const factor = Math.pow(10, minorUnit);
  return (minorUnits / factor).toFixed(minorUnit);
}

export function createMoneyAmount(amount: string, currency: string): MoneyAmount {
  const minorUnit = getMinorUnitForCurrency(currency);
  const normalized = formatFromMinorUnits(parseToMinorUnits(amount, currency), currency);
  return { amount: normalized, currency: currency.toUpperCase(), minorUnit };
}

export function zeroMoney(currency: string): MoneyAmount {
  return createMoneyAmount('0', currency);
}

export function addMoneyAmounts(a: MoneyAmount, b: MoneyAmount): MoneyAmount {
  if (a.currency !== b.currency) throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  const totalMinor = parseToMinorUnits(a.amount, a.currency) + parseToMinorUnits(b.amount, b.currency);
  return { amount: formatFromMinorUnits(totalMinor, a.currency), currency: a.currency, minorUnit: a.minorUnit };
}

export function subtractMoneyAmounts(a: MoneyAmount, b: MoneyAmount): MoneyAmount {
  if (a.currency !== b.currency) throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  const totalMinor = parseToMinorUnits(a.amount, a.currency) - parseToMinorUnits(b.amount, b.currency);
  return { amount: formatFromMinorUnits(totalMinor, a.currency), currency: a.currency, minorUnit: a.minorUnit };
}

export function sumMoneyAmounts(amounts: MoneyAmount[], currency: string): MoneyAmount {
  if (amounts.length === 0) return zeroMoney(currency);
  let totalMinor = 0;
  for (const m of amounts) {
    if (m.currency !== currency) throw new Error(`Currency mismatch in sum: expected ${currency} got ${m.currency}`);
    totalMinor += parseToMinorUnits(m.amount, m.currency);
  }
  return { amount: formatFromMinorUnits(totalMinor, currency), currency, minorUnit: getMinorUnitForCurrency(currency) };
}

export function divideMoneyAmount(money: MoneyAmount, divisor: number): MoneyAmount {
  if (divisor === 0) throw new Error('Division by zero');
  const minor = parseToMinorUnits(money.amount, money.currency);
  const resultMinor = Math.round(minor / divisor);
  return { amount: formatFromMinorUnits(resultMinor, money.currency), currency: money.currency, minorUnit: money.minorUnit };
}

export function multiplyMoneyAmount(money: MoneyAmount, multiplier: number): MoneyAmount {
  const minor = parseToMinorUnits(money.amount, money.currency);
  const resultMinor = Math.round(minor * multiplier);
  return { amount: formatFromMinorUnits(resultMinor, money.currency), currency: money.currency, minorUnit: money.minorUnit };
}

export function compareMoneyAmounts(a: MoneyAmount, b: MoneyAmount): number {
  if (a.currency !== b.currency) throw new Error(`Currency mismatch compare: ${a.currency} vs ${b.currency}`);
  const aMinor = parseToMinorUnits(a.amount, a.currency);
  const bMinor = parseToMinorUnits(b.amount, b.currency);
  if (aMinor < bMinor) return -1;
  if (aMinor > bMinor) return 1;
  return 0;
}

export function calculatePercentageChange(currentMinor: number, previousMinor: number): string {
  if (previousMinor === 0) return currentMinor === 0 ? '0.00' : '100.00';
  const change = ((currentMinor - previousMinor) / Math.abs(previousMinor)) * 100;
  return change.toFixed(2);
}

export function calculateRate(numerator: number, denominator: number): string {
  if (denominator === 0) return '0.00';
  return ((numerator / denominator) * 100).toFixed(2);
}
