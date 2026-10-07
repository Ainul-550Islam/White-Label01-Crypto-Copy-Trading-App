// # Normalizes payment/deposit webhook events
// # NEW or MODIFY — canonical funding/payment provider contract when missing
import { StripePaymentAdapter } from './stripe.adapter';
import { NowPaymentsAdapter } from './nowpayments.adapter';

export { StripePaymentAdapter, NowPaymentsAdapter };

export interface NormalizedPaymentWebhookEvent {
  provider: 'STRIPE' | 'NOWPAYMENTS' | 'CUSTODY_WEBHOOK';
  externalPaymentId: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED' | 'REFUNDED';
  amount: string;
  currency: string;
  confirmations: number;
  occurredAtIso: string;
}

export interface PaymentWebhookVerificationResult {
  verified: boolean;
  provider: 'STRIPE' | 'NOWPAYMENTS' | 'CUSTODY_WEBHOOK';
  errorReason?: string;
}

export function normalizePaymentWebhookPayload(raw: {
  provider: 'STRIPE' | 'NOWPAYMENTS' | 'CUSTODY_WEBHOOK';
  id: string;
  status: string;
  amount: string | number;
  currency: string;
  confirmations?: number;
  timestamp?: string;
}): NormalizedPaymentWebhookEvent {
  const upperStatus = String(raw.status).toUpperCase();
  let normalizedStatus: NormalizedPaymentWebhookEvent['status'] = 'PENDING';
  if (['CONFIRMED', 'COMPLETED', 'SUCCEEDED', 'FINISHED', 'PAID'].includes(upperStatus)) {
    normalizedStatus = 'CONFIRMED';
  } else if (['FAILED', 'EXPIRED', 'CANCELED', 'CANCELLED'].includes(upperStatus)) {
    normalizedStatus = 'FAILED';
  } else if (['REFUNDED', 'REVERSED'].includes(upperStatus)) {
    normalizedStatus = 'REFUNDED';
  }
  return {
    provider: raw.provider,
    externalPaymentId: String(raw.id),
    status: normalizedStatus,
    amount: String(raw.amount),
    currency: String(raw.currency).toUpperCase(),
    confirmations: Math.max(0, Number(raw.confirmations ?? 0)),
    occurredAtIso: raw.timestamp ?? new Date().toISOString(),
  };
}

export function verifyPaymentWebhookSignatureHeader(params: {
  provider: 'STRIPE' | 'NOWPAYMENTS' | 'CUSTODY_WEBHOOK';
  signatureHeader?: string | null;
  configuredSecret?: string | null;
}): PaymentWebhookVerificationResult {
  if (!params.configuredSecret || !params.configuredSecret.trim()) {
    return {
      verified: false,
      provider: params.provider,
      errorReason: 'Webhook signing secret is not configured; failing closed.',
    };
  }
  if (!params.signatureHeader || !params.signatureHeader.trim()) {
    return {
      verified: false,
      provider: params.provider,
      errorReason: 'Missing webhook signature header.',
    };
  }
  return {
    verified: true,
    provider: params.provider,
  };
}
