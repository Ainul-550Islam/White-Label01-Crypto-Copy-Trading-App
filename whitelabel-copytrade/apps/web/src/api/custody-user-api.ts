// # Responsibility: typed client for the custody routes a customer drives - their own wallets, deposit addresses, deposits, transactions, confirmations, fee quotes and the custody policy that governs them.
//
// Read from custody.controller.ts (all routes under /v1/custody). The operator-only flows in the same
// controller (reserves, sweeps, internal transfers, settlement finalisation, reconciliation runs and
// audit export) are served by admin-web's custody client, because a follower has no permission to
// drive them; leaving them out here is a decision about authority, not an omission.
//
//   GET  /v1/custody/wallets                       GET  /v1/custody/wallets/:walletId
//   GET  /v1/custody/addresses                     POST /v1/custody/deposit-addresses/get-or-create
//   POST /v1/custody/deposits/observe              GET  /v1/custody/transactions
//   GET  /v1/custody/transactions/:transactionId   POST /v1/custody/transactions/:transactionId/poll
//   GET  /v1/custody/confirmations/:transactionId  POST /v1/custody/fees/estimate
//   GET  /v1/custody/fees/:transactionId           GET  /v1/custody/balances/wallet/:walletId
//   GET  /v1/custody/policy                        GET  /v1/custody/assets
//   GET  /v1/custody/networks                      GET  /v1/custody/providers/health

import { apiClient } from './api-client';

const API_BASE = '/v1/custody';

function params(query: Record<string, string | number | boolean | undefined>): Record<string, string | number | boolean | undefined> {
  return query;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

export interface CustodyWallet {
  id: string;
  assetId: string;
  networkId: string;
  kind?: string;
  state: string;
  address?: string | null;
  createdAt?: string;
}

export interface CustodyTransaction {
  id: string;
  walletId: string;
  assetId: string;
  networkId: string;
  direction: string;
  state: string;
  amount: string;
  feeAmount?: string | null;
  txHash?: string | null;
  confirmations?: number | null;
  createdAt: string;
  updatedAt?: string;
}

export interface CustodyAsset {
  id: string;
  symbol: string;
  decimals?: number;
  isActive?: boolean;
}

export interface CustodyNetwork {
  id: string;
  name: string;
  chainId?: string | null;
  isActive?: boolean;
}

export interface DepositObservation {
  transactionId: string;
  state: string;
  confirmations?: number | null;
  requiredConfirmations?: number | null;
}

export interface FeeEstimate {
  assetId: string;
  networkId: string;
  feeAmount: string;
  feeAsset?: string;
  expiresAt?: string | null;
}

export interface TransactionQuery {
  walletId?: string;
  assetId?: string;
  networkId?: string;
  status?: string;
  direction?: string;
  page?: number;
  limit?: number;
}

export const custodyUserApi = {
  listWallets: (query: { page?: number; limit?: number } = {}) =>
    apiClient.get<{ data: CustodyWallet[]; total?: number }>(`${API_BASE}/wallets`, { searchParams: params({ ...query }) }),
  getWallet: (walletId: string) => apiClient.get<CustodyWallet>(`${API_BASE}/wallets/${segment(walletId)}`),
  getWalletBalance: (walletId: string) =>
    apiClient.get<{ walletId: string; assetId: string; available: string; pending?: string }>(
      `${API_BASE}/balances/wallet/${segment(walletId)}`,
    ),

  listAddresses: (query: { walletId?: string; page?: number; limit?: number } = {}) =>
    apiClient.get<{ data: Array<{ id: string; walletId: string; address: string; memo?: string | null }>; total?: number }>(
      `${API_BASE}/addresses`,
      { searchParams: params({ ...query }) },
    ),

  /** Creating a deposit address is a POST, so it carries the caller's idempotency key. */
  getOrCreateDepositAddress: (input: { walletId: string; assetId?: string; networkId?: string }, idempotencyKey: string) =>
    apiClient.post<{ id: string; address: string; memo?: string | null; walletId: string }>(
      `${API_BASE}/deposit-addresses/get-or-create`,
      input,
      { idempotencyKey },
    ),

  observeDeposit: (input: { walletId: string; txHash: string; amount: string; assetId: string; networkId: string }, idempotencyKey: string) =>
    apiClient.post<DepositObservation>(`${API_BASE}/deposits/observe`, input, { idempotencyKey }),

  listTransactions: (query: TransactionQuery = {}) =>
    apiClient.get<{ data: CustodyTransaction[]; total?: number }>(`${API_BASE}/transactions`, { searchParams: params({ ...query }) }),
  getTransaction: (transactionId: string) => apiClient.get<CustodyTransaction>(`${API_BASE}/transactions/${segment(transactionId)}`),
  pollTransaction: (transactionId: string, idempotencyKey: string) =>
    apiClient.post<CustodyTransaction>(`${API_BASE}/transactions/${segment(transactionId)}/poll`, undefined, { idempotencyKey }),

  getConfirmations: (transactionId: string) =>
    apiClient.get<{ transactionId: string; confirmations: number; required?: number; state: string }>(
      `${API_BASE}/confirmations/${segment(transactionId)}`,
    ),

  estimateFee: (input: { assetId: string; networkId: string; amount?: string }, idempotencyKey: string) =>
    apiClient.post<FeeEstimate>(`${API_BASE}/fees/estimate`, input, { idempotencyKey }),
  getActualFee: (transactionId: string) =>
    apiClient.get<{ transactionId: string; feeAmount: string; feeAsset?: string }>(`${API_BASE}/fees/${segment(transactionId)}`),

  getPolicy: () => apiClient.get<{ confirmationThresholds?: Record<string, number>; withdrawalEnabled?: boolean }>(`${API_BASE}/policy`),
  listAssets: () => apiClient.get<{ data: CustodyAsset[] }>(`${API_BASE}/assets`),
  listNetworks: () => apiClient.get<{ data: CustodyNetwork[] }>(`${API_BASE}/networks`),
  getProviderHealth: () => apiClient.get<{ providers: Array<{ name: string; state: string; checkedAt?: string }> }>(`${API_BASE}/providers/health`),
};
