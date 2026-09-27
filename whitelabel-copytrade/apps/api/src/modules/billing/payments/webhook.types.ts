import type { ISODateString, UUID } from '@wlct/shared-types';
import { PaymentProvider, PaymentStatus, PaymentCurrency } from './payment.types';

/**
 * Normalized webhook event models, event categories, provider event IDs,
 * payload metadata, processing state, and replay/idempotency information.
 */

export enum WebhookEventCategory {
  PAYMENT_CREATED = 'PAYMENT_CREATED',
  PAYMENT_PENDING = 'PAYMENT_PENDING',
  PAYMENT_SUCCEEDED = 'PAYMENT_SUCCEEDED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  PAYMENT_CANCELLED = 'PAYMENT_CANCELLED',
  PAYMENT_EXPIRED = 'PAYMENT_EXPIRED',
  PAYMENT_REFUNDED = 'PAYMENT_REFUNDED',
  CHECKOUT_CREATED = 'CHECKOUT_CREATED',
  CHECKOUT_COMPLETED = 'CHECKOUT_COMPLETED',
  CHECKOUT_EXPIRED = 'CHECKOUT_EXPIRED',
  SUBSCRIPTION_CREATED = 'SUBSCRIPTION_CREATED',
  SUBSCRIPTION_UPDATED = 'SUBSCRIPTION_UPDATED',
  SUBSCRIPTION_CANCELLED = 'SUBSCRIPTION_CANCELLED',
  UNKNOWN = 'UNKNOWN',
}

export enum WebhookProcessingStatus {
  RECEIVED = 'RECEIVED',
  VERIFIED = 'VERIFIED',
  PROCESSING = 'PROCESSING',
  PROCESSED = 'PROCESSED',
  FAILED = 'FAILED',
  DUPLICATE = 'DUPLICATE',
  REJECTED = 'REJECTED',
  SKIPPED = 'SKIPPED',
}

export interface NormalizedWebhookEvent {
  provider: PaymentProvider;
  providerEventId: string;
  eventType: string;
  eventCategory: WebhookEventCategory;
  paymentStatus: PaymentStatus;
  providerPaymentId?: string;
  providerCheckoutId?: string;
  providerSessionId?: string;
  providerInvoiceId?: string;
  providerCustomerId?: string;
  amount?: {
    amount: string;
    currency: string;
    amountInSmallestUnit?: number;
  };
  metadata?: {
    tenantId?: string;
    planId?: string;
    subscriptionId?: string;
    userId?: string;
    idempotencyKey?: string;
    orderId?: string;
    [key: string]: any;
  };
  rawEvent?: unknown;
  receivedAt: Date;
  providerCreatedAt: Date;
}

export interface WebhookEventRecord {
  id: UUID;
  provider: PaymentProvider;
  providerEventId: string;
  eventType: string;
  eventCategory: WebhookEventCategory;
  providerPaymentId: string | null;
  providerCheckoutId: string | null;
  eventHash: string;
  payload: Record<string, unknown> | null;
  signature: string | null;
  processingStatus: WebhookProcessingStatus;
  processingAttempts: number;
  lastProcessingError: string | null;
  processedAt: Date | null;
  paymentId: UUID | null;
  tenantId: UUID | null;
  receivedAt: Date;
  firstSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookVerificationResult {
  verified: boolean;
  provider: PaymentProvider;
  providerEventId?: string;
  eventType?: string;
  failureReason?: string;
  rawEvent?: unknown;
}

export interface WebhookProcessingResult {
  success: boolean;
  eventId: string;
  providerEventId: string;
  processingStatus: WebhookProcessingStatus;
  paymentId?: UUID;
  tenantId?: UUID;
  newPaymentStatus?: PaymentStatus;
  error?: string;
  isDuplicate?: boolean;
  isReplay?: boolean;
}

export interface WebhookReplayCheck {
  isDuplicate: boolean;
  isReplay: boolean;
  existingRecord?: WebhookEventRecord;
  shouldProcess: boolean;
  reason?: string;
}

export interface WebhookPayload {
  provider: PaymentProvider;
  rawBody: Buffer | string;
  signature: string;
  timestamp?: string;
  headers?: Record<string, string>;
}

export interface WebhookEventFilter {
  provider?: PaymentProvider;
  eventType?: string;
  processingStatus?: WebhookProcessingStatus;
  tenantId?: UUID;
  paymentId?: UUID;
  fromDate?: Date;
  toDate?: Date;
  providerEventId?: string;
}

export interface WebhookMetrics {
  totalReceived: number;
  totalVerified: number;
  totalProcessed: number;
  totalFailed: number;
  totalDuplicates: number;
  totalRejected: number;
  byProvider: Record<PaymentProvider, number>;
  byCategory: Record<WebhookEventCategory, number>;
  byStatus: Record<WebhookProcessingStatus, number>;
}
