// # Responsibility: typed admin client for exchange-user-stream-admin, venue-status-admin and the customer-facing venue-status / user-stream routes the console reads.
//
// `PUT admin/venues/:venue/status` and `DELETE admin/venues/:venue/status` are
// both step-up protected (`VENUE_STATUS_OVERRIDE`). The console mints the proof
// immediately before the call, because the API consumes it.
import { assertStepUpProof } from './step-up-proof';
import { apiClient } from '@/lib/api-client';

/* ------------------------------------------------------------------ models */

/** `GET admin/exchange-user-streams` rows: one private-stream session per account. */
export interface UserStreamSession {
  id: string;
  tenantId?: string;
  accountId: string;
  venue: string;
  status: string;
  listenKeyRef?: string | null;
  lastHeartbeatAt: string | null;
  expiresAt: string | null;
  reconnectCount?: number | null;
  lastError?: string | null;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/** `GET admin/venues` and `GET venues` rows: the operator-visible venue state. */
export interface VenueStatus {
  venue: string;
  status: string;
  reason?: string | null;
  overrideUntil?: string | null;
  overriddenBy?: string | null;
  updatedAt?: string | null;
  [key: string]: unknown;
}

/** `GET venues/:venue` detail. */
export interface VenueDetail extends VenueStatus {
  clockSkewMs?: number | null;
  lastHealthyAt?: string | null;
  notes?: string[];
}

/** `GET exchanges/stream-status`-style customer view of the caller's own accounts. */
export interface AccountStreamStatus {
  accountId: string;
  venue: string;
  streamStatus: string;
  lastEventAt?: string | null;
  gapDetected?: boolean;
  [key: string]: unknown;
}

/** `GET exchanges/registry/venues` rows: what each venue supports. */
export interface VenueRegistryEntry {
  venue: string;
  displayName: string;
  supportedEnvironments: string[];
  supportedCapabilities: string[];
  supportedOrderTypes: string[];
  apiVersion?: string;
  restAvailable?: boolean;
  websocketAvailable?: boolean;
  symbolFormat?: string;
  rateLimitModel?: string;
  authenticationModel?: string;
  requiresPassphrase?: boolean;
  isActive: boolean;
  [key: string]: unknown;
}

/** `POST exchanges/connectivity/check` and `connectivity` results. */
export interface ConnectivityCheck {
  connected: boolean;
  degraded: boolean;
  state: string;
  latencyMs: number | null;
  serverTimeMicros: string | null;
  clockDriftMs: number | null;
  capabilities: string[];
  failureCode: string | null;
  failureReason: string | null;
  isSimulated: boolean;
  environment: string;
  [key: string]: unknown;
}

/**
 * `GET exchanges/health` rows. Every field except `state` may be null, because
 * an unmeasured counter is not a zero counter.
 */
export interface ExchangeHealthRow {
  accountId: string;
  tenantId?: string;
  venue: string;
  environment: string;
  state: string;
  latencyMs: number | null;
  authFailures: number | null;
  apiErrors: number | null;
  rateLimitPressure: number | null;
  dataCompleteness: 'OBSERVED' | 'UNKNOWN';
  syncAgeMs: number | null;
  clockDriftMs: number | null;
  websocketConnected: boolean | null;
  providerAvailable: boolean;
  credentialExpired: boolean;
  credentialRevoked: boolean;
  lastCheckedAt: string;
  lastErrorCode: string | null;
  message: string | null;
  [key: string]: unknown;
}

/** `POST exchanges/routing/decide`. */
export interface RoutingDecision {
  selectedAccountId: string | null;
  selectedVenue: string | null;
  environment: string | null;
  eligibleAccounts: string[];
  routingReason: string;
  capabilities: string[];
  health: string | null;
  liveExecutionPermitted: boolean;
  liveGateBlockingReasons: string[];
  complianceAllowed: boolean;
  riskAllowed: boolean;
  [key: string]: unknown;
}

/** `GET exchanges/symbols` rows. */
export interface ExchangeSymbolRow {
  symbol: string;
  baseAsset?: string;
  quoteAsset?: string;
  venue?: string;
  isTradeable?: boolean;
  minNotional?: string | null;
  tickSize?: string | null;
  stepSize?: string | null;
  [key: string]: unknown;
}

export type ExchangeRows<T> = T[] | { data: T[]; total?: number };

/** Normalises a bare array or a `{ data }` envelope. */
export function exchangeRows<T>(payload: ExchangeRows<T> | null | undefined): T[] {
  if (!payload) return [];
  return Array.isArray(payload) ? payload : (payload.data ?? []);
}

/* ------------------------------------------------------------------ inputs */

/** The account summary the enable route returns. Secrets are never part of it. */
export interface ExchangeAccountSummary {
  accountId: string;
  venue: string;
  environment: string;
  status: string;
  liveTradingEnabled: boolean;
  [key: string]: unknown;
}

export interface ConnectivityCheckInput {
  /** When omitted, the API answers a provider-availability check only. */
  accountId?: string;
  venue?: string;
  environment?: string;
}

export interface AccountScopeInput {
  accountId: string;
  venue?: string;
  environment?: string;
}

export interface SyncOrdersInput extends AccountScopeInput {
  symbol?: string;
}

export interface RoutingDecisionInput {
  requiredCapability: string;
  environment: string;
  operation: 'READ' | 'MARKET_DATA' | 'TRADE' | 'WITHDRAWAL';
  venue?: string;
  symbol?: string;
  accountId?: string | null;
  complianceAllowed?: boolean;
  riskAllowed?: boolean;
}

export interface SymbolListQuery {
  baseAsset?: string;
  quoteAsset?: string;
  isTradeable?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}

export interface VenueOverrideInput {
  status: string;
  reason: string;
  durationMinutes?: number;
}

/* ---------------------------------------------------------------- client */

const API_BASE = '/v1/admin/venues';
const API_BASE_EXCHANGES = '/v1/exchanges';


function params(query: Record<string, string | number | boolean | undefined>): Record<string, string | number | boolean | undefined> {
  const cleaned: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') cleaned[key] = value;
  }
  return cleaned;
}

export const exchangeAdminApi = {
  /* venue status - operator */
  listVenues: () => apiClient.get<ExchangeRows<VenueStatus>>(API_BASE),

  /** Step-up protected: `VENUE_STATUS_OVERRIDE`. */
  setVenueStatus: (venue: string, input: VenueOverrideInput, idempotencyKey: string) =>
    apiClient.put<VenueStatus>(`${API_BASE}/${encodeURIComponent(venue)}/status`, input, { idempotencyKey }),

  /** Step-up protected: `VENUE_STATUS_OVERRIDE`. */
  clearVenueStatus: (venue: string, idempotencyKey: string) =>
    apiClient.delete<VenueStatus>(`${API_BASE}/${encodeURIComponent(venue)}/status`, { idempotencyKey }),

  /* user streams - operator */
  listUserStreams: (limit?: number) =>
    apiClient.get<ExchangeRows<UserStreamSession>>('/v1/admin/exchange-user-streams', { searchParams: params({ limit }) }),

  /* customer-facing venue status and user stream (venue-status.controller / exchange-user-stream.controller) */
  listVenueStatus: (venues?: string[]) =>
    apiClient.get<ExchangeRows<VenueStatus>>('/v1/venues/status', { searchParams: params({ venues: venues?.join(',') }) }),
  getVenueStatus: (venue: string) => apiClient.get<VenueDetail>(`/v1/venues/${encodeURIComponent(venue)}/status`),
  getUserStream: (accountId: string) =>
    apiClient.get<UserStreamSession>(`/v1/exchanges/${encodeURIComponent(accountId)}/user-stream`),

  /* exchange registry, connectivity, health, sync and routing (exchanges.controller) */
  listRegistryVenues: () =>
    apiClient.get<VenueRegistryEntry[]>(`${API_BASE_EXCHANGES}/registry/venues`),
  listRegistryProviders: () => apiClient.get<string[]>(`${API_BASE_EXCHANGES}/registry/providers`),

  /** Arms an account. `liveTradingRequested` is the only path the service implements. */
  enableAccount: (accountId: string, input: { liveTradingRequested?: boolean; reason?: string }, idempotencyKey: string) =>
    apiClient.post<ExchangeAccountSummary>(`${API_BASE_EXCHANGES}/accounts/${encodeURIComponent(accountId)}/enable`, input, { idempotencyKey }),
  refreshCapabilities: (accountId: string, idempotencyKey: string) =>
    apiClient.post<ConnectivityCheck>(`${API_BASE_EXCHANGES}/accounts/${encodeURIComponent(accountId)}/refresh-capabilities`, undefined, { idempotencyKey }),

  checkConnectivity: (input: ConnectivityCheckInput, idempotencyKey: string) =>
    apiClient.post<ConnectivityCheck>(`${API_BASE_EXCHANGES}/connectivity/check`, input, { idempotencyKey }),
  discoverCapabilities: (accountId: string, idempotencyKey: string) =>
    apiClient.post<ConnectivityCheck>(`${API_BASE_EXCHANGES}/capabilities/discover`, { accountId }, { idempotencyKey }),

  listHealth: () => apiClient.get<ExchangeHealthRow[]>(`${API_BASE_EXCHANGES}/health`),
  getHealth: (accountId: string) =>
    apiClient.get<ExchangeHealthRow>(`${API_BASE_EXCHANGES}/health/${encodeURIComponent(accountId)}`),
  checkHealth: (accountId: string, idempotencyKey: string) =>
    apiClient.post<ExchangeHealthRow>(`${API_BASE_EXCHANGES}/health/${encodeURIComponent(accountId)}/check`, undefined, { idempotencyKey }),

  syncBalances: (input: AccountScopeInput, idempotencyKey: string) =>
    apiClient.post<unknown>(`${API_BASE_EXCHANGES}/sync/balances`, input, { idempotencyKey }),
  syncPositions: (input: AccountScopeInput, idempotencyKey: string) =>
    apiClient.post<unknown>(`${API_BASE_EXCHANGES}/sync/positions`, input, { idempotencyKey }),
  syncOrders: (input: SyncOrdersInput, idempotencyKey: string) =>
    apiClient.post<unknown>(`${API_BASE_EXCHANGES}/sync/orders`, input, { idempotencyKey }),

  decideRouting: (input: RoutingDecisionInput, idempotencyKey: string) =>
    apiClient.post<RoutingDecision>(`${API_BASE_EXCHANGES}/routing/decide`, input, { idempotencyKey }),

  listSymbols: (query: SymbolListQuery = {}) =>
    apiClient.get<ExchangeRows<ExchangeSymbolRow>>(`${API_BASE_EXCHANGES}/symbols`, { searchParams: params({ ...query }) }),
  getSymbol: (symbol: string) =>
    apiClient.get<ExchangeSymbolRow>(`${API_BASE_EXCHANGES}/symbols/${encodeURIComponent(symbol)}`),
  syncSymbols: (accountId: string, idempotencyKey: string) =>
    apiClient.post<unknown>(`${API_BASE_EXCHANGES}/symbols/${encodeURIComponent(accountId)}/sync`, undefined, { idempotencyKey }),

  /* step-up for the override routes */
  requestVenueOverrideProof: async (method: 'TOTP' | 'PASSWORD' | 'RECOVERY_CODE', value: string, idempotencyKey: string) => {
    const action = 'VENUE_STATUS_OVERRIDE' as const;
    const payload =
      method === 'TOTP' ? { action, method, code: value } : method === 'PASSWORD' ? { action, method, password: value } : { action, method, recoveryCode: value };
    const proof = await apiClient.post<unknown>('/v1/auth/step-up/verify', payload, { idempotencyKey });
    assertStepUpProof(proof, action, method);
  },
};
