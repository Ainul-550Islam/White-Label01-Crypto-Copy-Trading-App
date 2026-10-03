import { apiClient } from './api-client';
import { newIdempotencyKey } from '@/lib/idempotency-key';

/**
 * Exchange accounts of the signed-in user.
 *
 * Account lifecycle - ExchangesController (/v1/exchanges/accounts):
 *   GET  /accounts                 exchange_account:read   -> { data, total } (own accounts)
 *   GET  /accounts/:id             exchange_account:read   (404 for someone else's account)
 *   POST /accounts                 exchange_account:manage CreateExchangeAccountDto
 *   POST /accounts/:id/disable     exchange_account:manage { reason }
 *   POST /accounts/:id/revoke      exchange_account:manage { reason, confirmation? }
 *   PUT  /accounts/:id             tenant operators only   { label?, privateStreamEnabled?, ipAllowlist? }
 * Runtime checks - ExchangeAccountsController (/v1/execution/accounts):
 *   POST /:id/verify               exchange_account:verify -> queued job (202)
 *   GET  /:id/connectivity         exchange_account:read
 * Credentials are sent once, over the session-bound proxy, and are never
 * returned: responses carry only the masked key (last four characters).
 */

export interface ExchangeAccount {
  id: string;
  exchange: string;
  environment: string;
  label?: string;
  maskedApiKey?: string;
  status: string;
  connectionState?: string;
  health: string;
  capabilities: string[];
  tradingEnabled: boolean;
  isSandbox: boolean;
  lastConnectedAt?: string;
  lastHealthCheckAt?: string;
  errorMessage?: string;
  permissions: string[];
  createdAt: string;
}

export interface Exchange {
  id: string;
  name: string;
  slug: string;
  status: string;
  supportedMarketTypes: string[];
}

export interface ExchangeConnectivity {
  health: string;
  lastCheckAt: string;
  issues: string[];
  credentialsVerified: boolean;
  consecutiveFailures: number;
}

/** ExchangeVenue values the backend accepts. */
export const EXCHANGE_VENUES = ['BINANCE', 'BYBIT', 'OKX', 'KRAKEN', 'COINBASE'] as const;
export const EXCHANGE_ENVIRONMENTS = ['LIVE', 'TESTNET', 'SANDBOX'] as const;
/** Venues whose API keys come with a passphrase. */
export const PASSPHRASE_VENUES: readonly string[] = ['OKX', 'COINBASE'];

/** ExchangeSafeReference. */
interface BackendExchangeAccount {
  accountId: string;
  venue: string;
  environment: string;
  label: string;
  maskedApiKey: string;
  status: string;
  connectionState: string;
  healthState: string;
  capabilities: string[];
  isSandbox: boolean;
  liveTradingEnabled: boolean;
  lastVerifiedAt: string | null;
  lastSyncAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
}

/** AccountConnectivityView. */
interface BackendConnectivity {
  status: string;
  credentialsVerified: boolean;
  lastVerifiedAt: string | null;
  lastFailureCode: string | null;
  consecutiveFailures: number;
  openIncidents: number;
  criticalIncidents: number;
  unreconciledOrders: number;
}

const FAILURE_MESSAGES: Record<string, string> = {
  AUTH_FAILED: 'The exchange rejected the API key. Check the key and secret.',
  INVALID_CREDENTIALS: 'The exchange rejected the API key. Check the key and secret.',
  PERMISSION_DENIED: 'The API key is missing a permission the platform needs (read and trade).',
  WITHDRAWAL_NOT_ALLOWED: 'The API key allows withdrawals. Create a key with withdrawals disabled.',
  ENVIRONMENT_MISMATCH: 'The key belongs to a different environment (live vs. testnet).',
  RATE_LIMITED: 'The exchange is rate limiting requests. Try again shortly.',
  PROVIDER_UNAVAILABLE: 'The exchange could not be reached. Try again shortly.',
};

export function describeFailure(code: string | null | undefined): string | undefined {
  if (!code) return undefined;
  return FAILURE_MESSAGES[code] ?? `Last check failed (${code}).`;
}

export function toExchangeAccount(raw: BackendExchangeAccount): ExchangeAccount {
  return {
    id: raw.accountId,
    exchange: raw.venue,
    environment: raw.environment,
    label: raw.label || undefined,
    maskedApiKey: raw.maskedApiKey,
    status: raw.status,
    connectionState: raw.connectionState,
    health: raw.healthState,
    capabilities: raw.capabilities ?? [],
    tradingEnabled: raw.liveTradingEnabled === true,
    isSandbox: raw.isSandbox === true,
    lastConnectedAt: raw.lastVerifiedAt ?? undefined,
    lastHealthCheckAt: raw.lastSyncAt ?? undefined,
    errorMessage: describeFailure(raw.lastErrorCode),
    permissions: raw.capabilities ?? [],
    createdAt: raw.createdAt,
  };
}

export function toConnectivity(raw: BackendConnectivity): ExchangeConnectivity {
  const issues: string[] = [];
  const failure = describeFailure(raw.lastFailureCode);
  if (failure) issues.push(failure);
  if (raw.criticalIncidents > 0) issues.push(`${raw.criticalIncidents} critical incident(s) open`);
  else if (raw.openIncidents > 0) issues.push(`${raw.openIncidents} incident(s) open`);
  if (raw.unreconciledOrders > 0) issues.push(`${raw.unreconciledOrders} order(s) awaiting reconciliation`);
  const health = raw.credentialsVerified && issues.length === 0 ? 'HEALTHY' : raw.credentialsVerified ? 'DEGRADED' : 'UNVERIFIED';
  return {
    health,
    lastCheckAt: raw.lastVerifiedAt ?? '',
    issues,
    credentialsVerified: raw.credentialsVerified,
    consecutiveFailures: raw.consecutiveFailures,
  };
}

export const exchangeApi = {
  listExchanges: async (): Promise<Exchange[]> =>
    EXCHANGE_VENUES.map((venue) => ({
      id: venue,
      name: venue.charAt(0) + venue.slice(1).toLowerCase(),
      slug: venue.toLowerCase(),
      status: 'AVAILABLE',
      supportedMarketTypes: [],
    })),

  listAccounts: async (): Promise<{ data: ExchangeAccount[]; total: number }> => {
    const page = await apiClient.get<{ data: BackendExchangeAccount[]; total: number }>('/v1/exchanges/accounts');
    const data = (page?.data ?? []).map(toExchangeAccount);
    return { data, total: page?.total ?? data.length };
  },

  getAccount: async (id: string): Promise<ExchangeAccount> =>
    toExchangeAccount(await apiClient.get<BackendExchangeAccount>(`/v1/exchanges/accounts/${encodeURIComponent(id)}`)),

  connectAccount: async (data: {
    exchange: string;
    environment?: string;
    label?: string;
    apiKey: string;
    apiSecret: string;
    passphrase?: string;
  }): Promise<ExchangeAccount> => {
    const label = data.label?.trim() || `${data.exchange.charAt(0)}${data.exchange.slice(1).toLowerCase()} account`;
    const raw = await apiClient.post<BackendExchangeAccount>('/v1/exchanges/accounts', {
      venue: data.exchange,
      environment: data.environment ?? 'LIVE',
      label: label.slice(0, 80),
      apiKey: data.apiKey.trim(),
      apiSecret: data.apiSecret.trim(),
      ...(data.passphrase ? { passphrase: data.passphrase } : {}),
      idempotencyKey: newIdempotencyKey('connect'),
    });
    return toExchangeAccount(raw);
  },

  /** Tenant operators only (exchange_account:manage + trading:write). */
  updateAccount: async (id: string, data: { label?: string }): Promise<ExchangeAccount> =>
    toExchangeAccount(await apiClient.put<BackendExchangeAccount>(`/v1/exchanges/accounts/${encodeURIComponent(id)}`, { label: data.label })),

  disableAccount: async (id: string, reason: string): Promise<ExchangeAccount> =>
    toExchangeAccount(await apiClient.post<BackendExchangeAccount>(`/v1/exchanges/accounts/${encodeURIComponent(id)}/disable`, { reason })),

  /** Revokes the connection: credentials are wiped and the key can be connected again later. */
  disconnectAccount: async (id: string, reason = 'Disconnected by the account owner'): Promise<void> => {
    await apiClient.post<BackendExchangeAccount>(`/v1/exchanges/accounts/${encodeURIComponent(id)}/revoke`, { reason });
  },

  /** Queues a credential check; poll getAccountHealth for the outcome. */
  verifyAccount: async (id: string): Promise<{ status: string; health: string; message?: string }> => {
    const res = await apiClient.post<{ accepted: boolean; jobId: string; note: string }>(`/v1/execution/accounts/${encodeURIComponent(id)}/verify`);
    return { status: res?.accepted ? 'QUEUED' : 'REJECTED', health: 'PENDING', message: res?.note };
  },

  getAccountHealth: async (id: string): Promise<ExchangeConnectivity> =>
    toConnectivity(await apiClient.get<BackendConnectivity>(`/v1/execution/accounts/${encodeURIComponent(id)}/connectivity`)),
};
