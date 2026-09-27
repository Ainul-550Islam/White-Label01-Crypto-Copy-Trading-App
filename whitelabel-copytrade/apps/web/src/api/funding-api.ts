import { apiClient } from './api-client';

export interface FundingRequest {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAWAL';
  asset: string;
  network?: string;
  amount: string;
  status: string;
  state: string;
  address?: string;
  transactionHash?: string;
  confirmationCount?: number;
  requiredConfirmations?: number;
  providerReference?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
}

export interface DepositAddress {
  address: string;
  asset: string;
  network: string;
  provider?: string;
  isActive: boolean;
  createdAt: string;
}

export const fundingApi = {
  listFundingRequests: (params?: { type?: string; state?: string; page?: number; limit?: number }) =>
    apiClient.get<{ data: FundingRequest[]; total: number }>('/client-lifecycle/funding-requests', {
      searchParams: params as Record<string, string | number | boolean | undefined>,
    }),

  getFundingRequest: (id: string) => apiClient.get<FundingRequest>(`/client-lifecycle/funding-requests/${id}`),

  createDepositRequest: (data: { asset: string; network: string; amount: string }) =>
    apiClient.post<FundingRequest>('/client-lifecycle/funding-requests', { ...data, type: 'DEPOSIT' }),

  createWithdrawalRequest: (data: { asset: string; network: string; amount: string; destinationAddress: string }) =>
    apiClient.post<FundingRequest>('/client-lifecycle/withdrawal-requests', data),

  listWithdrawalRequests: (params?: { state?: string; page?: number; limit?: number }) =>
    apiClient.get<{ data: FundingRequest[]; total: number }>('/client-lifecycle/withdrawal-requests', {
      searchParams: params as Record<string, string | number | boolean | undefined>,
    }),

  getWithdrawalRequest: (id: string) => apiClient.get<FundingRequest>(`/client-lifecycle/withdrawal-requests/${id}`),

  getDepositAddresses: (params?: { asset?: string; network?: string }) =>
    apiClient.get<DepositAddress[]>('/custody/addresses', {
      searchParams: params as Record<string, string | number | boolean | undefined>,
    }),

  getOrCreateDepositAddress: (data: { assetId: string; networkId: string }) =>
    apiClient.post<DepositAddress>('/custody/deposit-addresses/get-or-create', data),

  listTransactions: (params?: { assetId?: string; networkId?: string; status?: string; page?: number; limit?: number }) =>
    apiClient.get<{ data: FundingRequest[]; total: number }>('/custody/transactions', {
      searchParams: params as Record<string, string | number | boolean | undefined>,
    }),
};
