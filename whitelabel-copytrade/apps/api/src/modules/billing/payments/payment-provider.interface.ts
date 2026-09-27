import type { PaymentAmount, PaymentMetadata, PaymentReferences, PaymentStatus, NormalizedPaymentResult, ProviderReference, PaymentProvider, TransactionState } from './payment.types';
import type { CheckoutRequest, CheckoutResponse } from './checkout.types';
import type { NormalizedWebhookEvent } from './webhook.types';

/**
 * Common provider contract implemented by Stripe and NowPayments.
 *
 * All payment providers must implement this interface to ensure consistent
 * behavior behind the factory abstraction. No provider-specific types leak
 * outside the adapter implementation.
 */

export interface CreateCheckoutInput {
  planId: string;
  planCode: string;
  planName: string;
  price: string;
  currency: string;
  interval: string;
  tenantId: string;
  userId?: string;
  subscriptionId?: string | null;
  idempotencyKey: string;
  successUrl: string;
  cancelUrl: string;
  metadata: PaymentMetadata;
  references: PaymentReferences;
  amount: PaymentAmount;
}

export interface CreateCheckoutResult {
  providerCheckoutId: string;
  providerSessionId?: string;
  providerPaymentId?: string;
  providerInvoiceId?: string;
  providerCustomerId?: string;
  checkoutUrl: string;
  invoiceUrl?: string;
  expiresAt?: Date;
  rawResponse?: unknown;
}

export interface RetrievePaymentInput {
  providerPaymentId?: string;
  providerCheckoutId?: string;
  providerSessionId?: string;
  providerInvoiceId?: string;
}

export interface RefundInput {
  providerPaymentId: string;
  amount?: PaymentAmount;
  reason?: string;
  idempotencyKey: string;
}

export interface RefundResult {
  providerRefundId: string;
  status: PaymentStatus;
  amount: PaymentAmount;
  rawResponse?: unknown;
}

export interface VerifyWebhookInput {
  rawBody: Buffer | string;
  signature: string;
  secret?: string;
  timestamp?: string;
}

export interface VerifyWebhookResult {
  verified: boolean;
  eventId?: string;
  eventType?: string;
  rawEvent?: unknown;
  failureReason?: string;
}

export interface NormalizeEventInput {
  rawEvent: unknown;
  provider: PaymentProvider;
}

export interface ProviderCapabilities {
  supportsCheckout: boolean;
  supportsPaymentIntents: boolean;
  supportsRefunds: boolean;
  supportsPartialRefunds: boolean;
  supportsWebhooks: boolean;
  supportsRecurring: boolean;
  supportsCrypto: boolean;
  supportedCurrencies: string[];
}

export interface IPaymentProvider {
  readonly provider: PaymentProvider;
  readonly capabilities: ProviderCapabilities;

  /**
   * Create a checkout session / payment / invoice with the provider.
   * Must use the canonical plan price from the billing catalog, never hardcoded.
   */
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;

  /**
   * Retrieve current payment state from provider.
   */
  retrievePayment(input: RetrievePaymentInput): Promise<NormalizedPaymentResult>;

  /**
   * Refund a payment where supported.
   */
  refund?(input: RefundInput): Promise<RefundResult>;

  /**
   * Verify webhook signature/authenticity.
   * Must never log raw secrets.
   */
  verifyWebhookSignature(input: VerifyWebhookInput): Promise<VerifyWebhookResult>;

  /**
   * Normalize provider-specific webhook event into internal normalized event.
   */
  normalizeWebhookEvent(input: NormalizeEventInput): Promise<NormalizedWebhookEvent>;

  /**
   * Map provider-specific status into internal PaymentStatus.
   */
  mapProviderStatusToInternalStatus(providerStatus: string): PaymentStatus;

  /**
   * Map provider-specific status into internal TransactionState.
   */
  mapProviderStatusToTransactionState(providerStatus: string): TransactionState;
}

export interface ProviderCheckoutSession {
  id: string;
  url: string;
  status: string;
  provider: PaymentProvider;
  amount: PaymentAmount;
  currency: string;
  expiresAt?: Date;
  metadata?: Record<string, string>;
}
