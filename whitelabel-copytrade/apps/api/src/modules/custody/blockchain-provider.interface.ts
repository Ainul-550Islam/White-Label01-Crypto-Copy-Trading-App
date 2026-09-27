/**
 * Provider-neutral interface for balance lookup, address observation, transaction submission where supported,
 * transaction lookup, receipt lookup, block lookup, fee estimation, confirmation observation, and capability discovery.
 * No provider-specific assumptions in callers. Must remain provider-neutral.
 */

import { BalanceObservation, TransactionObservation, FeeObservation } from './custody.types';

export interface BlockchainProviderCapabilities {
  canGetBalance: boolean;
  canObserveAddress: boolean;
  canSubmitTransaction: boolean;
  canGetTransaction: boolean;
  canGetReceipt: boolean;
  canGetBlock: boolean;
  canEstimateFee: boolean;
  canObserveConfirmations: boolean;
  supportedNetworks: string[];
  supportedAssets: string[];
}

export interface GetBalanceParams {
  assetId: string;
  networkId: string;
  address: string;
  walletId?: string;
}

export interface GetTransactionParams {
  transactionHash: string;
  networkId: string;
  assetId?: string;
}

export interface SubmitTransactionParams {
  assetId: string;
  networkId: string;
  fromAddress: string;
  toAddress: string;
  amount: string; // base-unit integer string
  fee?: string | null;
  memo?: string | null;
  walletId?: string;
  idempotencyKey?: string;
}

export interface EstimateFeeParams {
  assetId: string;
  networkId: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
}

export interface ObserveAddressParams {
  assetId: string;
  networkId: string;
  address: string;
  fromBlock?: string | null;
}

export interface BlockchainProvider {
  readonly providerId: string;
  readonly providerName: string;

  getCapabilities(): Promise<BlockchainProviderCapabilities>;

  getBalance(params: GetBalanceParams): Promise<BalanceObservation>;

  getTransaction(params: GetTransactionParams): Promise<TransactionObservation | null>;

  getTransactionReceipt?(params: GetTransactionParams): Promise<{ status: string; blockHash?: string | null; blockNumber?: string | null; gasUsed?: string | null; actualFee?: string | null } | null>;

  getBlock?(params: { networkId: string; blockHash?: string | null; blockNumber?: string | null }): Promise<{ blockHash: string; blockNumber: string; timestamp: string; transactions: string[] } | null>;

  submitTransaction?(params: SubmitTransactionParams): Promise<{ transactionHash: string; providerReference: string; estimatedFee?: string | null }>;

  estimateFee?(params: EstimateFeeParams): Promise<FeeObservation>;

  observeAddressTransactions?(params: ObserveAddressParams): Promise<TransactionObservation[]>;

  getConfirmations?(params: GetTransactionParams): Promise<{ confirmationCount: number; blockNumber?: string | null; blockHash?: string | null; isFinal: boolean }>;

  isHealthy?(): Promise<{ healthy: boolean; reason?: string }>;
}

export interface ProviderResult<T> {
  success: boolean;
  data?: T | null;
  error?: string | null;
  providerId: string;
  observedAt: string;
  rawProviderData?: any;
}
