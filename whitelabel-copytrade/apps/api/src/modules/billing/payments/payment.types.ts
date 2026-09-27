import type { ISODateString, UUID } from '@wlct/shared-types';
import { BillingInterval, SubscriptionStatus } from '@wlct/shared-types';

/**
 * Payment domain types - shared across all payment adapters and services.
 *
 * This module defines the canonical internal payment state machine and all
 * related domain types. No provider-specific logic lives here; adapters map
 * their external states into these internal states.
 */

export enum PaymentProvider {
  NONE = 'none',
  STRIPE = 'stripe',
  NOWPAYMENTS = 'nowpayments',
}

export enum PaymentCurrency {
  USD = 'USD',
  EUR = 'EUR',
  BTC = 'BTC',
  ETH = 'ETH',
  USDT = 'USDT',
  USDC = 'USDC',
}

export enum CheckoutStatus {
  CREATED = 'CREATED',
  PENDING = 'PENDING',
  REDIRECTED = 'REDIRECTED',
  COMPLETED = 'COMPLETED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}

export enum PaymentStatus {
  CREATED = 'CREATED',
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
  REFUNDED = 'REFUNDED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
  DISPUTED = 'DISPUTED',
  UNKNOWN = 'UNKNOWN',
}

export enum TransactionState {
  INITIALIZED = 'INITIALIZED',
  AUTHORIZED = 'AUTHORIZED',
  CAPTURED = 'CAPTURED',
  SETTLED = 'SETTLED',
  VOIDED = 'VOIDED',
  REFUNDED = 'REFUNDED',
  CHARGEBACK = 'CHARGEBACK',
  FAILED = 'FAILED',
}

export enum PaymentMethodType {
  CARD = 'card',
  BANK_TRANSFER = 'bank_transfer',
  CRYPTO = 'crypto',
  WALLET = 'wallet',
  UNKNOWN = 'unknown',
}

export interface PaymentAmount {
  amount: string;
  currency: PaymentCurrency | string;
  amountInSmallestUnit: number;
}

export interface PaymentReferences {
  tenantId: UUID;
  planId: UUID;
  subscriptionId?: UUID | null;
  userId?: UUID | null;
  orderId?: string | null;
  idempotencyKey: string;
  externalCustomerId?: string | null;
  externalSubscriptionId?: string | null;
}

export interface PaymentMetadata {
  planCode?: string;
  planName?: string;
  billingInterval?: BillingInterval;
  seats?: number;
  trialDays?: number;
  successUrl?: string;
  cancelUrl?: string;
  description?: string;
  customFields?: Record<string, string>;
}

export interface ProviderReference {
  provider: PaymentProvider;
  providerPaymentId: string;
  providerCheckoutId?: string | null;
  providerSessionId?: string | null;
  providerInvoiceId?: string | null;
  providerCustomerId?: string | null;
  checkoutUrl?: string | null;
  invoiceUrl?: string | null;
}

export interface NormalizedPaymentResult {
  internalPaymentId: UUID;
  provider: PaymentProvider;
  status: PaymentStatus;
  transactionState: TransactionState;
  amount: PaymentAmount;
  providerReference: ProviderReference;
  references: PaymentReferences;
  metadata: PaymentMetadata;
  paymentMethod?: PaymentMethodType;
  paidAt?: ISODateString | null;
  failedAt?: ISODateString | null;
  cancelledAt?: ISODateString | null;
  refundedAt?: ISODateString | null;
  expiresAt?: ISODateString | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  rawProviderStatus?: string;
  failureReason?: string | null;
  failureCode?: string | null;
}

export interface PaymentCreationInput {
  tenantId: UUID;
  planId: UUID;
  subscriptionId?: UUID | null;
  userId?: UUID;
  currency: PaymentCurrency | string;
  provider: PaymentProvider;
  amount: PaymentAmount;
  references: PaymentReferences;
  metadata: PaymentMetadata;
  providerReference?: Partial<ProviderReference>;
  idempotencyKey: string;
  expiresAt?: Date;
}

export interface PaymentUpdateInput {
  status?: PaymentStatus;
  transactionState?: TransactionState;
  providerReference?: Partial<ProviderReference>;
  paidAt?: Date | null;
  failedAt?: Date | null;
  cancelledAt?: Date | null;
  refundedAt?: Date | null;
  failureReason?: string | null;
  failureCode?: string | null;
  rawProviderStatus?: string;
  metadata?: Partial<PaymentMetadata>;
}

export interface PaymentRecord {
  id: UUID;
  tenantId: UUID;
  planId: UUID;
  subscriptionId: UUID | null;
  userId: UUID | null;
  provider: PaymentProvider;
  status: PaymentStatus;
  transactionState: TransactionState;
  currency: string;
  amount: string;
  amountInSmallestUnit: number;
  providerPaymentId: string | null;
  providerCheckoutId: string | null;
  providerSessionId: string | null;
  providerInvoiceId: string | null;
  providerCustomerId: string | null;
  checkoutUrl: string | null;
  invoiceUrl: string | null;
  idempotencyKey: string;
  orderId: string | null;
  externalCustomerId: string | null;
  externalSubscriptionId: string | null;
  paymentMethod: PaymentMethodType | null;
  planCode: string | null;
  planName: string | null;
  billingInterval: BillingInterval | null;
  seats: number | null;
  failureReason: string | null;
  failureCode: string | null;
  rawProviderStatus: string | null;
  metadata: Record<string, unknown> | null;
  paidAt: Date | null;
  failedAt: Date | null;
  cancelledAt: Date | null;
  refundedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const VALID_PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  [PaymentStatus.CREATED]: [
    PaymentStatus.PENDING,
    PaymentStatus.PROCESSING,
    PaymentStatus.SUCCEEDED,
    PaymentStatus.FAILED,
    PaymentStatus.CANCELLED,
    PaymentStatus.EXPIRED,
  ],
  [PaymentStatus.PENDING]: [
    PaymentStatus.PROCESSING,
    PaymentStatus.SUCCEEDED,
    PaymentStatus.FAILED,
    PaymentStatus.CANCELLED,
    PaymentStatus.EXPIRED,
  ],
  [PaymentStatus.PROCESSING]: [
    PaymentStatus.SUCCEEDED,
    PaymentStatus.FAILED,
    PaymentStatus.CANCELLED,
    PaymentStatus.EXPIRED,
  ],
  [PaymentStatus.SUCCEEDED]: [
    PaymentStatus.REFUNDED,
    PaymentStatus.PARTIALLY_REFUNDED,
    PaymentStatus.DISPUTED,
  ],
  [PaymentStatus.FAILED]: [PaymentStatus.PENDING, PaymentStatus.PROCESSING],
  [PaymentStatus.CANCELLED]: [],
  [PaymentStatus.EXPIRED]: [PaymentStatus.PENDING],
  [PaymentStatus.REFUNDED]: [PaymentStatus.DISPUTED],
  [PaymentStatus.PARTIALLY_REFUNDED]: [PaymentStatus.REFUNDED, PaymentStatus.DISPUTED],
  [PaymentStatus.DISPUTED]: [PaymentStatus.REFUNDED],
  [PaymentStatus.UNKNOWN]: [
    PaymentStatus.CREATED,
    PaymentStatus.PENDING,
    PaymentStatus.PROCESSING,
    PaymentStatus.SUCCEEDED,
    PaymentStatus.FAILED,
    PaymentStatus.CANCELLED,
    PaymentStatus.EXPIRED,
  ],
};

export function isValidPaymentTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  if (from === to) {
    return true;
  }
  const allowed = VALID_PAYMENT_TRANSITIONS[from];
  if (!allowed) {
    return false;
  }
  return allowed.includes(to);
}

export interface PaymentFilter {
  tenantId?: UUID;
  planId?: UUID;
  subscriptionId?: UUID;
  provider?: PaymentProvider;
  status?: PaymentStatus;
  currency?: string;
  fromDate?: Date;
  toDate?: Date;
  orderId?: string;
  idempotencyKey?: string;
  providerPaymentId?: string;
}
