// # Responsibility: typed admin client for risk-management/risk.controller, liquidation-alert.controller, user-position-limit.controller and risk/risk.controller.
//
// Every function maps to a route that exists at this commit. Two of these
// surfaces need a step-up proof - `POST risk-management/policy` and
// `PUT risk-management/my-position-limits` - and the risk kill-switch clear
// route additionally requires a typed confirmation phrase, which is enforced by
// the API's DTO rather than by the decorator.
import { assertStepUpProof } from './step-up-proof';
import { apiClient } from '@/lib/api-client';

/* ------------------------------------------------------------------ models */

/** The shape shared by most risk-management reads: figures plus their provenance. */
export interface RiskDashboard {
  accountId?: string | null;
  traderId?: string | null;
  strategyId?: string | null;
  followerId?: string | null;
  asOf: string;
  dataCompleteness?: string;
  exposure?: Record<string, string | null>;
  margin?: Record<string, string | null>;
  leverage?: Record<string, string | null>;
  concentration?: Record<string, string | null>;
  drawdown?: Record<string, string | null>;
  dailyLoss?: Record<string, string | null>;
  notes?: string[];
  [key: string]: unknown;
}

export interface ExposureView {
  accountId?: string | null;
  totalExposure: string | null;
  netExposure: string | null;
  longExposure: string | null;
  shortExposure: string | null;
  positions: Array<Record<string, unknown>>;
  asOf?: string;
  [key: string]: unknown;
}

export interface MarginView {
  accountId: string;
  marginUsed: string | null;
  marginAvailable: string | null;
  maintenanceMargin: string | null;
  marginRatio: string | null;
  asOf?: string;
  [key: string]: unknown;
}

export interface LeverageView {
  accountId: string;
  symbol?: string | null;
  effectiveLeverage: string | null;
  maxLeverage: string | null;
  marginMode?: string | null;
  allowed?: boolean;
  reason?: string | null;
  [key: string]: unknown;
}

export interface LiquidationView {
  accountId: string;
  positions: Array<{ symbol: string; liquidationPrice: string | null; distancePercent: string | null; side?: string }>;
  asOf?: string;
  [key: string]: unknown;
}

export interface ConcentrationView {
  accountId?: string | null;
  bySymbol: Array<{ symbol: string; exposure: string | null; shareBps: number | null }>;
  byVenue?: Array<{ venue: string; exposure: string | null; shareBps: number | null }>;
  breaches?: string[];
  [key: string]: unknown;
}

export interface DrawdownView {
  currentDrawdown: string | null;
  maxDrawdown: string | null;
  peakEquity: string | null;
  currentEquity: string | null;
  limitBreached: boolean;
  [key: string]: unknown;
}

export interface DailyLossView {
  accountId?: string | null;
  day: string;
  realizedLoss: string | null;
  unrealizedLoss: string | null;
  limitAmount: string | null;
  remaining: string | null;
  breached: boolean;
  [key: string]: unknown;
}

export interface CorrelationView {
  symbols: string[];
  matrix: Array<Array<string | null>>;
  note?: string;
  [key: string]: unknown;
}

export interface VarView {
  accountId?: string | null;
  confidence: string | null;
  horizon: string | null;
  var: string | null;
  expectedShortfall: string | null;
  methodology?: string;
  observationCount?: number;
  [key: string]: unknown;
}

export interface StressView {
  accountId?: string | null;
  scenarios: Array<{ name: string; loss: string | null; description?: string }>;
  worstCase: string | null;
  [key: string]: unknown;
}

export interface RiskPolicy {
  scope: string;
  scopeId: string | null;
  tenantId?: string | null;
  version: number;
  thresholds: Record<string, unknown>;
  changeReason?: string | null;
  createdAt?: string;
  [key: string]: unknown;
}

export interface RiskEvent {
  id: string;
  accountId?: string | null;
  severity: string;
  ruleId?: string | null;
  eventType?: string;
  summary?: string | null;
  createdAt: string;
  [key: string]: unknown;
}

/** A kill switch or circuit breaker row. */
export interface RiskSwitch {
  id: string;
  scope: string;
  scopeId?: string | null;
  target?: string | null;
  status: string;
  engaged: boolean;
  reason?: string | null;
  triggerType?: string | null;
  triggeredByRule?: string | null;
  engagedAt?: string | null;
  acknowledgedAt?: string | null;
  clearedAt?: string | null;
  createdAt?: string;
  [key: string]: unknown;
}

export interface ProtectionRecord {
  id: string;
  accountId?: string | null;
  action: string;
  status: string;
  reason?: string | null;
  createdAt: string;
  clearedAt?: string | null;
  [key: string]: unknown;
}

export interface RiskSnapshot {
  id: string;
  accountId: string;
  capturedAt: string;
  equity?: string | null;
  exposure?: string | null;
  dataCompleteness?: string;
  [key: string]: unknown;
}

export interface DailyPnlPoint {
  at: string;
  equity: string | null;
  netPnl: string | null;
  [key: string]: unknown;
}

export interface RiskReconciliation {
  matched: boolean | null;
  findings: Array<Record<string, unknown>>;
  checkedAt?: string;
  [key: string]: unknown;
}

export interface RiskCheckResult {
  allowed: boolean;
  decision: string;
  ruleId?: string | null;
  reason?: string | null;
  evaluatedAt?: string;
  [key: string]: unknown;
}

/** `GET risk/liquidation-alerts` rows. */
export interface LiquidationAlert {
  id: string;
  accountId?: string | null;
  symbol?: string | null;
  severity: string;
  distancePercent?: string | null;
  liquidationPrice?: string | null;
  markPrice?: string | null;
  createdAt: string;
  acknowledgedAt?: string | null;
  [key: string]: unknown;
}

/** `GET risk-management/my-position-limits`. */
export interface UserPositionLimits {
  userId?: string;
  maxConcurrentPositions: number | null;
  maxOpenOrders: number | null;
  updatedAt: string | null;
  [key: string]: unknown;
}

export type RiskRows<T> = T[] | { data: T[]; total?: number };

/** Normalises a bare array or a `{ data }` envelope. */
export function riskRows<T>(payload: RiskRows<T> | null | undefined): T[] {
  if (!payload) return [];
  return Array.isArray(payload) ? payload : (payload.data ?? []);
}

/* ------------------------------------------------------------------ inputs */

export interface AccountScope {
  accountId?: string;
  traderId?: string;
  strategyId?: string;
  followerId?: string;
}

export interface UpsertPolicyInput {
  scope: string;
  scopeId?: string;
  thresholds: Record<string, unknown>;
  changeReason: string;
  expectedVersion?: number;
}

export interface UpdatePositionLimitsInput {
  maxConcurrentPositions?: number;
  maxOpenOrders?: number;
  expectedUpdatedAt?: string;
}

export interface EngageSwitchInput {
  scope: string;
  target?: string;
  reason: string;
  triggeredByRule?: string;
}

export interface ClearSwitchInput {
  confirm: string;
  reason: string;
}

export interface TriggerBreakerInput {
  scope: string;
  scopeId: string;
  triggerType: string;
  reason: string;
  triggerRuleId?: string;
}

/* ---------------------------------------------------------------- helpers */

const API_BASE_MANAGED = '/v1/risk-management';
const API_BASE_RISK = '/v1/risk';

function params(query: Record<string, string | number | boolean | undefined>): Record<string, string | number | boolean | undefined> {
  const cleaned: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') cleaned[key] = value;
  }
  return cleaned;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

/* ------------------------------------------------------------------ client */

export const riskAdminApi = {
  /* risk-management dashboard and analysis */
  getDashboard: (scope: AccountScope = {}) =>
    apiClient.get<RiskDashboard>(`${API_BASE_MANAGED}/dashboard`, { searchParams: params({ ...scope }) }),

  // A pre-trade check does not change state, but it is still a POST the operator may retry after a
  // timeout: the key makes the retry the same request rather than a second evaluation of a moving book.
  checkOrder: (input: Record<string, unknown>, idempotencyKey: string) =>
    apiClient.post<RiskCheckResult>(`${API_BASE_MANAGED}/check`, input, { idempotencyKey }),

  getLeveragePolicy: (query: { accountId?: string; requestedLeverage?: string; marginMode?: string } = {}) =>
    apiClient.get<LeverageView>(`${API_BASE_MANAGED}/leverage-policy`, { searchParams: params({ ...query }) }),

  getExposure: (accountId?: string) =>
    apiClient.get<ExposureView>(`${API_BASE_MANAGED}/exposure`, { searchParams: params({ accountId }) }),

  getAccountExposure: (accountId: string) =>
    apiClient.get<ExposureView>(`${API_BASE_MANAGED}/exposure/${segment(accountId)}`),

  getMyExposure: () => apiClient.get<ExposureView>(`${API_BASE_MANAGED}/my-exposure`),

  getMyRiskAnalysis: () => apiClient.get<RiskDashboard>(`${API_BASE_MANAGED}/my-risk-analysis`),

  getTraderExposure: (traderId: string) =>
    apiClient.get<ExposureView>(`${API_BASE_MANAGED}/trader-exposure/${segment(traderId)}`),

  getPositionRisk: (query: { accountId?: string; symbol?: string } = {}) =>
    apiClient.get<ExposureView>(`${API_BASE_MANAGED}/position-risk`, { searchParams: params({ ...query }) }),

  getMargin: (accountId: string) => apiClient.get<MarginView>(`${API_BASE_MANAGED}/margin/${segment(accountId)}`),

  getLeverage: (accountId: string, symbol?: string) =>
    apiClient.get<LeverageView>(`${API_BASE_MANAGED}/leverage/${segment(accountId)}`, { searchParams: params({ symbol }) }),

  getLiquidation: (accountId: string) =>
    apiClient.get<LiquidationView>(`${API_BASE_MANAGED}/liquidation/${segment(accountId)}`),

  getConcentration: (accountId?: string) =>
    apiClient.get<ConcentrationView>(`${API_BASE_MANAGED}/concentration`, { searchParams: params({ accountId }) }),

  getDrawdown: (scope: AccountScope = {}) =>
    apiClient.get<DrawdownView>(`${API_BASE_MANAGED}/drawdown`, { searchParams: params({ ...scope }) }),

  getDailyLoss: (accountId?: string) =>
    apiClient.get<DailyLossView>(`${API_BASE_MANAGED}/daily-loss`, { searchParams: params({ accountId }) }),

  getCorrelation: () => apiClient.get<CorrelationView>(`${API_BASE_MANAGED}/correlation`),

  getVar: (accountId?: string) => apiClient.get<VarView>(`${API_BASE_MANAGED}/var`, { searchParams: params({ accountId }) }),

  getStress: (accountId?: string) => apiClient.get<StressView>(`${API_BASE_MANAGED}/stress`, { searchParams: params({ accountId }) }),

  /* policy */
  getPolicy: (scope: { traderId?: string; strategyId?: string; followerId?: string } = {}) =>
    apiClient.get<RiskPolicy>(`${API_BASE_MANAGED}/policy`, { searchParams: params({ ...scope }) }),

  /** Step-up protected: `INSTITUTIONAL_RISK_POLICY_UPDATE`. */
  upsertPolicy: (input: UpsertPolicyInput, idempotencyKey: string) =>
    apiClient.post<RiskPolicy>(`${API_BASE_MANAGED}/policy`, input, { idempotencyKey }),

  getPolicyHistory: (query: { scope?: string; scopeId?: string } = {}) =>
    apiClient.get<RiskRows<RiskPolicy>>(`${API_BASE_MANAGED}/policy/history`, { searchParams: params({ ...query }) }),

  /* breakers and kill switches (risk-management) */
  listBreakers: () => apiClient.get<RiskRows<RiskSwitch>>(`${API_BASE_MANAGED}/breaker`),
  triggerBreaker: (input: TriggerBreakerInput, idempotencyKey: string) =>
    apiClient.post<RiskSwitch>(`${API_BASE_MANAGED}/breaker/trigger`, input, { idempotencyKey }),
  clearBreaker: (id: string, reason: string, idempotencyKey: string) =>
    apiClient.post<RiskSwitch>(`${API_BASE_MANAGED}/breaker/${segment(id)}/clear`, { reason }, { idempotencyKey }),
  acknowledgeBreaker: (id: string, reason: string, idempotencyKey: string) =>
    apiClient.post<RiskSwitch>(`${API_BASE_MANAGED}/breaker/${segment(id)}/acknowledge`, { reason }, { idempotencyKey }),

  listKillSwitches: () => apiClient.get<RiskRows<RiskSwitch>>(`${API_BASE_MANAGED}/kill-switch`),
  requestKillSwitch: (input: { scope: string; target?: string; reason: string; triggeredByRule?: string }, idempotencyKey: string) =>
    apiClient.post<RiskSwitch>(`${API_BASE_MANAGED}/kill-switch/request`, input, { idempotencyKey }),
  clearKillSwitch: (id: string, reason: string, idempotencyKey: string) =>
    apiClient.post<RiskSwitch>(`${API_BASE_MANAGED}/kill-switch/${segment(id)}/clear`, { reason }, { idempotencyKey }),
  acknowledgeKillSwitch: (id: string, reason: string, idempotencyKey: string) =>
    apiClient.post<RiskSwitch>(`${API_BASE_MANAGED}/kill-switch/${segment(id)}/acknowledge`, { reason }, { idempotencyKey }),

  /* reconciliation and snapshots */
  getReconciliation: (accountId?: string) =>
    apiClient.get<RiskReconciliation>(`${API_BASE_MANAGED}/reconciliation`, { searchParams: params({ accountId }) }),
  getReconciliationHistory: () => apiClient.get<RiskRows<RiskReconciliation>>(`${API_BASE_MANAGED}/reconciliation/history`),
  getSnapshots: (accountId?: string) =>
    apiClient.get<RiskRows<RiskSnapshot>>(`${API_BASE_MANAGED}/snapshots`, { searchParams: params({ accountId }) }),

  /* liquidation alerts (risk/liquidation-alerts) */
  listLiquidationAlerts: () => apiClient.get<RiskRows<LiquidationAlert>>('/v1/risk/liquidation-alerts'),

  /* the caller's own position limits */
  getMyPositionLimits: () => apiClient.get<UserPositionLimits>(`${API_BASE_MANAGED}/my-position-limits`),

  /** Step-up protected: `USER_POSITION_LIMIT_UPDATE`. */
  updateMyPositionLimits: (input: UpdatePositionLimitsInput, idempotencyKey: string) =>
    apiClient.put<UserPositionLimits>(`${API_BASE_MANAGED}/my-position-limits`, input, { idempotencyKey }),

  /* risk controller (risk/*) */
  getStatus: () => apiClient.get<RiskDashboard>(`${API_BASE_RISK}/status`),
  getAccountLimits: (accountId: string) =>
    apiClient.get<RiskPolicy>(`${API_BASE_RISK}/accounts/${segment(accountId)}/limits`),
  updateAccountLimits: (accountId: string, input: Record<string, unknown>, idempotencyKey: string) =>
    apiClient.post<RiskPolicy>(`${API_BASE_RISK}/accounts/${segment(accountId)}/limits`, input, { idempotencyKey }),
  rollbackAccountLimits: (accountId: string, input: { toVersion: number; changeReason: string; confirm: string }, idempotencyKey: string) =>
    apiClient.post<RiskPolicy>(`${API_BASE_RISK}/accounts/${segment(accountId)}/limits/rollback`, input, { idempotencyKey }),
  getEvents: (query: { accountId?: string; strategyId?: string; severity?: string; since?: string; until?: string } = {}) =>
    apiClient.get<RiskRows<RiskEvent>>(`${API_BASE_RISK}/events`, { searchParams: params({ ...query }) }),
  getAccountExposureProjection: (accountId: string) =>
    apiClient.get<ExposureView>(`${API_BASE_RISK}/accounts/${segment(accountId)}/exposure`),
  listAccountSnapshots: (accountId: string) =>
    apiClient.get<RiskRows<RiskSnapshot>>(`${API_BASE_RISK}/accounts/${segment(accountId)}/snapshots`),
  getDailyPnl: (accountId: string, day?: string) =>
    apiClient.get<RiskRows<DailyPnlPoint>>(`${API_BASE_RISK}/accounts/${segment(accountId)}/daily-pnl`, { searchParams: params({ day }) }),
  getAccountSummary: (accountId: string) =>
    apiClient.get<RiskDashboard>(`${API_BASE_RISK}/accounts/${segment(accountId)}/summary`),
  getStrategySummary: (strategyId: string) =>
    apiClient.get<RiskDashboard>(`${API_BASE_RISK}/strategies/${segment(strategyId)}/summary`),
  listSwitches: (query: { scope?: string; engagedOnly?: boolean } = {}) =>
    apiClient.get<RiskRows<RiskSwitch>>(`${API_BASE_RISK}/kill-switches`, { searchParams: params({ ...query }) }),
  engageSwitch: (input: EngageSwitchInput, idempotencyKey: string) =>
    apiClient.post<RiskSwitch>(`${API_BASE_RISK}/kill-switches/engage`, input, { idempotencyKey }),
  acknowledgeSwitch: (id: string, reason: string, idempotencyKey: string) =>
    apiClient.post<RiskSwitch>(`${API_BASE_RISK}/kill-switches/${segment(id)}/acknowledge`, { reason }, { idempotencyKey }),
  clearSwitch: (id: string, input: ClearSwitchInput, idempotencyKey: string) =>
    apiClient.post<RiskSwitch>(`${API_BASE_RISK}/kill-switches/${segment(id)}/clear`, input, { idempotencyKey }),
  listProtections: (query: { accountId?: string; includeCleared?: boolean } = {}) =>
    apiClient.get<RiskRows<ProtectionRecord>>(`${API_BASE_RISK}/protections`, { searchParams: params({ ...query }) }),

  /* step-up proofs */
  requestPolicyProof: async (method: 'TOTP' | 'PASSWORD' | 'RECOVERY_CODE', value: string, idempotencyKey: string) => {
    const action = 'INSTITUTIONAL_RISK_POLICY_UPDATE' as const;
    const payload =
      method === 'TOTP' ? { action, method, code: value } : method === 'PASSWORD' ? { action, method, password: value } : { action, method, recoveryCode: value };
    const proof = await apiClient.post<unknown>('/v1/auth/step-up/verify', payload, { idempotencyKey });
    assertStepUpProof(proof, action, method);
  },

  requestPositionLimitProof: async (method: 'TOTP' | 'PASSWORD' | 'RECOVERY_CODE', value: string, idempotencyKey: string) => {
    const action = 'USER_POSITION_LIMIT_UPDATE' as const;
    const payload =
      method === 'TOTP' ? { action, method, code: value } : method === 'PASSWORD' ? { action, method, password: value } : { action, method, recoveryCode: value };
    const proof = await apiClient.post<unknown>('/v1/auth/step-up/verify', payload, { idempotencyKey });
    assertStepUpProof(proof, action, method);
  },
};
