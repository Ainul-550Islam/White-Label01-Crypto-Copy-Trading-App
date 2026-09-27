import { apiClient } from './api-client';

export interface ExchangeAccount {
  id: string;
  exchange: string;
  label?: string;
  status: string;
  health: string;
  capabilities: string[];
  tradingEnabled: boolean;
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

export const exchangeApi = {
  listExchanges: () => apiClient.get<Exchange[]>('/exchanges'),

  listAccounts: () =>
    apiClient.get<{ data: ExchangeAccount[]; total: number }>('/v1/execution/accounts'),

  getAccount: (id: string) => apiClient.get<ExchangeAccount>(`/v1/execution/accounts/${id}`),

  connectAccount: (data: {
    exchange: string;
    label?: string;
    apiKey: string;
    apiSecret: string;
    passphrase?: string;
    marketType?: string;
  }) => apiClient.post<ExchangeAccount>('/v1/execution/accounts', data),

  updateAccount: (id: string, data: { label?: string; marketType?: string }) =>
    apiClient.patch<ExchangeAccount>(`/v1/execution/accounts/${id}`, data),

  disconnectAccount: (id: string) => apiClient.delete<void>(`/v1/execution/accounts/${id}`),

  verifyAccount: (id: string) => apiClient.post<{ status: string; health: string; message?: string }>(`/v1/execution/accounts/${id}/verify`),

  getAccountHealth: (id: string) =>
    apiClient.get<{ health: string; lastCheckAt: string; issues: string[] }>(`/v1/execution/accounts/${id}/health`),
};
