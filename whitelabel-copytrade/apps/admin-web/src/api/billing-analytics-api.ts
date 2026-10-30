// # Responsibility: typed admin client covering ALL 25 routes of billing/analytics/analytics.controller.
//
// Every money figure in these responses is a decimal string (or null when the
// metric is not computable). Nothing here parses one.
//
// Query DTOs differ per route and the API forbids unknown query keys (422), so
// the input types below are deliberately narrow and per-route rather than one
// permissive bag: a caller cannot smuggle `planId` into an endpoint whose DTO
// does not declare it.
import { apiClient } from '@/lib/api-client';

/* ------------------------------------------------------------------ models */

/** Figures plus the provenance the analytics services attach to them. */
export interface MetricEnvelope {
  currency?: string;
  computedAt?: string;
  dataCompleteness?: string;
  sampleSize?: number;
  methodology?: string;
  [key: string]: unknown;
}

/** `GET billing/analytics/mrr` and `mrr/tenant`. */
export interface MrrResult extends MetricEnvelope {
  mrr: string | null;
  mrrFormatted?: string;
  activeSubscriptions?: number;
  arpa?: string | null;
}

/** `GET billing/analytics/arr`. */
export interface ArrResult extends MetricEnvelope {
  arr: string | null;
  arrFormatted?: string;
}

/** `GET billing/analytics/revenue/overview` and `revenue/snapshot`. */
export interface RevenueOverview extends MetricEnvelope {
  totalRevenue: string | null;
  recurringRevenue?: string | null;
  oneTimeRevenue?: string | null;
  refunds?: string | null;
  netRevenue?: string | null;
  growthRate?: string | null;
  previousPeriod?: { totalRevenue: string | null } | null;
}

/** `GET billing/analytics/subscriptions/kpis`. */
export interface SubscriptionKpis extends MetricEnvelope {
  activeSubscriptions: number;
  trialingSubscriptions?: number;
  cancelledSubscriptions?: number;
  newSubscriptions?: number;
  churnedSubscriptions?: number;
  conversionRate?: string | null;
}

/** One slice of a distribution response. */
export interface DistributionSlice {
  key: string;
  label?: string;
  count: number;
  sharePercent?: string | null;
  mrr?: string | null;
}

/** `GET billing/analytics/subscriptions/plan-distribution` and `interval-distribution`. */
export interface DistributionResult extends MetricEnvelope {
  total: number;
  slices: DistributionSlice[];
}

/** `GET billing/analytics/churn`. */
export interface ChurnResult extends MetricEnvelope {
  churnRate: string | null;
  churnedSubscriptions: number;
  activeAtStart: number;
  revenueChurnRate?: string | null;
}

/** `GET billing/analytics/retention`. */
export interface RetentionResult extends MetricEnvelope {
  retentionRate: string | null;
  retainedSubscriptions: number;
  cohortSize: number;
}

/** `GET billing/analytics/plans/performance` and `plans/top` rows. */
export interface PlanPerformanceRow {
  planId: string;
  planCode?: string;
  planName?: string;
  activeSubscriptions: number;
  mrr: string | null;
  arr?: string | null;
  churnRate?: string | null;
  arpu?: string | null;
  [key: string]: unknown;
}

/** `GET billing/analytics/cohorts`. */
export interface CohortCell {
  period: number;
  retained: number;
  retentionRate: string | null;
}

export interface CohortRow {
  cohort: string;
  size: number;
  cells: CohortCell[];
  [key: string]: unknown;
}

export interface CohortResult extends MetricEnvelope {
  cohorts: CohortRow[];
}

/** `GET billing/analytics/cashflow`. */
export interface CashflowResult extends MetricEnvelope {
  inflow: string | null;
  outflow: string | null;
  netCashflow: string | null;
  series?: Array<{ period: string; inflow: string | null; outflow: string | null; net: string | null }>;
}

/** `GET billing/analytics/cashflow/outstanding`. */
export interface OutstandingResult extends MetricEnvelope {
  totalOutstanding: string | null;
  invoiceCount: number;
  overdueAmount?: string | null;
  overdueCount?: number;
}

/** `GET billing/analytics/customers/value`. */
export interface CustomerValueResult extends MetricEnvelope {
  averageLifetimeValue: string | null;
  averageRevenuePerCustomer?: string | null;
  customerCount?: number;
}

/** `GET billing/analytics/customers/arpu`. */
export interface ArpuResult extends MetricEnvelope {
  arpu: string | null;
  activeCustomers: number;
}

/** `GET billing/analytics/customers/top` rows. */
export interface TopCustomerRow {
  customerId: string;
  revenue: string | null;
  subscriptionCount?: number;
  [key: string]: unknown;
}

/** `GET billing/analytics/recognition` and `recognition/deferred`. */
export interface RecognitionResult extends MetricEnvelope {
  recognizedRevenue: string | null;
  deferredRevenue: string | null;
  periodStart?: string;
  periodEnd?: string;
  schedule?: Array<{ period: string; amount: string | null }>;
}

/** `GET billing/analytics/reports/financial`. */
export interface FinancialReport extends MetricEnvelope {
  periodStart: string;
  periodEnd: string;
  revenue: string | null;
  expenses?: string | null;
  netIncome?: string | null;
  deferredRevenue?: string | null;
  recognizedRevenue?: string | null;
  sections?: Array<{ title: string; lines: Array<{ label: string; amount: string | null }> }>;
  generatedAt?: string;
}

/** `GET billing/analytics/reconciliation`. */
export interface BillingReconciliation extends MetricEnvelope {
  matched: boolean | null;
  discrepancies: Array<{ type: string; expected: string | null; actual: string | null; reference?: string }>;
  checkedRecords?: number;
}

/** `GET billing/analytics/billing/health` and `health`. */
export interface BillingHealth extends MetricEnvelope {
  healthy: boolean;
  failedPayments?: number;
  dunningActive?: number;
  stuckNotifications?: number;
  issues?: string[];
}

/** `GET billing/analytics/cache/invalidate` (a GET that mutates the cache). */
export interface CacheInvalidationResult {
  invalidated: boolean;
  scope: string;
  metric?: string | null;
  invalidatedAt?: string;
}

/* ------------------------------------------------------------------ inputs */

/** The fields every revenue-style query DTO shares. */
export interface PeriodQuery {
  startDate?: string;
  endDate?: string;
  periodType?: 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';
  currency?: string;
  tenantId?: string;
  timezone?: string;
}

export interface RevenueQuery extends PeriodQuery {
  planId?: string;
  planCode?: string;
  billingInterval?: string;
  includeComparison?: boolean;
  comparisonStartDate?: string;
  comparisonEndDate?: string;
  cohortDefinition?: string;
  includeTrials?: boolean;
  multiCurrency?: boolean;
}

export interface SnapshotQuery extends PeriodQuery {
  tenantId?: string;
}

export interface PlanPerformanceQuery extends PeriodQuery {
  planId?: string;
  limit?: number;
}

export interface CohortQuery extends PeriodQuery {
  cohortDefinition?: string;
  retentionPeriods?: number;
}

export interface CustomerQuery extends PeriodQuery {
  limit?: number;
}

export interface ReconciliationAnalyticsQuery extends PeriodQuery {
  tenantId?: string;
}

/* ---------------------------------------------------------------- helpers */

const API_BASE = '/v1/billing/analytics';

type QueryValue = string | number | boolean | undefined;

function params(query: Record<string, QueryValue>): Record<string, QueryValue> {
  const cleaned: Record<string, QueryValue> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') cleaned[key] = value;
  }
  return cleaned;
}

/* ------------------------------------------------------------------ client */

export const billingAnalyticsApi = {
  /* revenue */
  getRevenueOverview: (query: RevenueQuery = {}) =>
    apiClient.get<RevenueOverview>(`${API_BASE}/revenue/overview`, { searchParams: params({ ...query }) }),

  getRevenueSnapshot: (query: SnapshotQuery = {}) =>
    apiClient.get<RevenueOverview>(`${API_BASE}/revenue/snapshot`, { searchParams: params({ ...query }) }),

  /* recurring revenue */
  getMrr: (query: PeriodQuery & { includeLifetimeAsRecurring?: boolean; asOfDate?: string } = {}) =>
    apiClient.get<MrrResult>(`${API_BASE}/mrr`, { searchParams: params({ ...query }) }),

  getTenantMrr: (query: PeriodQuery & { includeLifetimeAsRecurring?: boolean; asOfDate?: string } = {}) =>
    apiClient.get<MrrResult>(`${API_BASE}/mrr/tenant`, { searchParams: params({ ...query }) }),

  getArr: (query: PeriodQuery & { includeLifetimeAsRecurring?: boolean; asOfDate?: string } = {}) =>
    apiClient.get<ArrResult>(`${API_BASE}/arr`, { searchParams: params({ ...query }) }),

  /* subscriptions */
  getSubscriptionKpis: (query: RevenueQuery = {}) =>
    apiClient.get<SubscriptionKpis>(`${API_BASE}/subscriptions/kpis`, { searchParams: params({ ...query }) }),

  getPlanDistribution: (query: PeriodQuery = {}) =>
    apiClient.get<DistributionResult>(`${API_BASE}/subscriptions/plan-distribution`, { searchParams: params({ ...query }) }),

  getIntervalDistribution: (query: PeriodQuery = {}) =>
    apiClient.get<DistributionResult>(`${API_BASE}/subscriptions/interval-distribution`, { searchParams: params({ ...query }) }),

  getChurn: (query: RevenueQuery = {}) =>
    apiClient.get<ChurnResult>(`${API_BASE}/churn`, { searchParams: params({ ...query }) }),

  getRetention: (query: RevenueQuery = {}) =>
    apiClient.get<RetentionResult>(`${API_BASE}/retention`, { searchParams: params({ ...query }) }),

  /* plans */
  getPlanPerformance: (query: PlanPerformanceQuery = {}) =>
    apiClient.get<{ plans?: PlanPerformanceRow[]; data?: PlanPerformanceRow[] }>(`${API_BASE}/plans/performance`, { searchParams: params({ ...query }) }),

  getTopPlans: (query: PlanPerformanceQuery = {}) =>
    apiClient.get<{ plans?: PlanPerformanceRow[]; data?: PlanPerformanceRow[] }>(`${API_BASE}/plans/top`, { searchParams: params({ ...query }) }),

  /* cohorts */
  getCohorts: (query: CohortQuery = {}) =>
    apiClient.get<CohortResult>(`${API_BASE}/cohorts`, { searchParams: params({ ...query }) }),

  /* health and cashflow */
  getBillingHealth: (query: PeriodQuery = {}) =>
    apiClient.get<BillingHealth>(`${API_BASE}/billing/health`, { searchParams: params({ ...query }) }),

  getCashflow: (query: PeriodQuery = {}) =>
    apiClient.get<CashflowResult>(`${API_BASE}/cashflow`, { searchParams: params({ ...query }) }),

  getOutstanding: (query: PeriodQuery = {}) =>
    apiClient.get<OutstandingResult>(`${API_BASE}/cashflow/outstanding`, { searchParams: params({ ...query }) }),

  /* customers */
  getCustomerValue: (query: CustomerQuery = {}) =>
    apiClient.get<CustomerValueResult>(`${API_BASE}/customers/value`, { searchParams: params({ ...query }) }),

  getArpu: (query: RevenueQuery = {}) =>
    apiClient.get<ArpuResult>(`${API_BASE}/customers/arpu`, { searchParams: params({ ...query }) }),

  getTopCustomers: (query: CustomerQuery = {}) =>
    apiClient.get<{ customers?: TopCustomerRow[]; data?: TopCustomerRow[] }>(`${API_BASE}/customers/top`, { searchParams: params({ ...query }) }),

  /* revenue recognition */
  getRecognition: (query: RevenueQuery = {}) =>
    apiClient.get<RecognitionResult>(`${API_BASE}/recognition`, { searchParams: params({ ...query }) }),

  getDeferred: (query: RevenueQuery = {}) =>
    apiClient.get<RecognitionResult>(`${API_BASE}/recognition/deferred`, { searchParams: params({ ...query }) }),

  /* reports, reconciliation, cache, health */
  getFinancialReport: (query: RevenueQuery = {}) =>
    apiClient.get<FinancialReport>(`${API_BASE}/reports/financial`, { searchParams: params({ ...query }) }),

  getReconciliation: (query: ReconciliationAnalyticsQuery = {}) =>
    apiClient.get<BillingReconciliation>(`${API_BASE}/reconciliation`, { searchParams: params({ ...query }) }),

  /** Declared as `@Get('cache/invalidate')` on the controller: it mutates the cache but is a GET. */
  invalidateCache: (scope: string, metric?: string) =>
    apiClient.get<CacheInvalidationResult>(`${API_BASE}/cache/invalidate`, { searchParams: params({ scope, metric }) }),

  getHealth: () => apiClient.get<BillingHealth>(`${API_BASE}/health`),
};

/** Rows from a `{ plans }` / `{ data }` shaped response, without guessing twice. */
export function planRows(payload: { plans?: PlanPerformanceRow[]; data?: PlanPerformanceRow[] } | null): PlanPerformanceRow[] {
  if (!payload) return [];
  return payload.plans ?? payload.data ?? [];
}

/** Rows from a `{ customers }` / `{ data }` shaped response. */
export function customerRows(payload: { customers?: TopCustomerRow[]; data?: TopCustomerRow[] } | null): TopCustomerRow[] {
  if (!payload) return [];
  return payload.customers ?? payload.data ?? [];
}
