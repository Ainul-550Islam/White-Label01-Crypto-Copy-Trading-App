import { Payout, CreatePayoutInput, PayoutStatusResult, PayoutProviderResult } from './payout.types';

/**
 * Provider abstraction for payout execution.
 * Provider-neutral, no secrets outside adapter.
 * No fake success responses.
 */
export interface IPayoutProvider {
  readonly providerName: string;

  /**
   * Create payout with provider - must validate provider availability
   */
  createPayout(input: CreatePayoutInput): Promise<PayoutProviderResult>;

  /**
   * Retrieve payout status from provider - provider confirmation required
   */
  getPayoutStatus(providerPayoutId: string): Promise<PayoutStatusResult>;

  /**
   * Cancel payout where provider supports it
   */
  cancelPayout?(providerPayoutId: string): Promise<{ cancelled: boolean; reason?: string }>;

  /**
   * Verify provider response is valid
   */
  verifyProviderResponse?(response: unknown): boolean;

  /**
   * Normalize provider-specific status to internal PayoutStatus
   */
  normalizeStatus(providerStatus: string): import('./payout.types').PayoutStatus;

  /**
   * Check if provider is configured and available
   */
  isAvailable(): boolean;
}

export interface PayoutProviderCapabilities {
  supportsCancellation: boolean;
  supportsStatusCheck: boolean;
  supportsBatch: boolean;
  supportedCurrencies: string[];
  supportedDestinations: string[];
}
