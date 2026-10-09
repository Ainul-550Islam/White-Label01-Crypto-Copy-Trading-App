// # Normalizes payment/deposit webhook events
import { Decimal } from '../../../common/decimal-string';
import { NowPaymentsProductionAdapter } from './payment/nowpayments.adapter';
import { StripeProductionAdapter } from './payment/stripe.adapter';

export { StripeProductionAdapter, NowPaymentsProductionAdapter };

export type PaymentWebhookProvider = 'STRIPE' | 'NOWPAYMENTS' | 'CUSTODY_WEBHOOK';

export type NormalizedPaymentWebhookStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'FAILED'
  | 'REFUNDED'
  | 'UNKNOWN';

export interface NormalizedPaymentWebhookEvent {
  provider: PaymentWebhookProvider;
  externalPaymentId: string;
  status: NormalizedPaymentWebhookStatus;
  amount: string;
  currency: string;
  confirmations: number | null;
  occurredAtIso: string | null;
}

export interface PaymentWebhookPayloadInput {
  provider: PaymentWebhookProvider;
  id: string;
  status: string;
  amount: string;
  currency: string;
  confirmations?: number | null;
  timestamp?: string | null;
}

const CONFIRMED_STATUSES = new Set([
  'COMPLETE',
  'COMPLETED',
  'FINISHED',
  'NO_PAYMENT_REQUIRED',
  'PAID',
  'SUCCEEDED',
]);

const FAILED_STATUSES = new Set([
  'CANCELED',
  'CANCELLED',
  'DECLINED',
  'EXPIRED',
  'FAILED',
  'UNCOLLECTIBLE',
  'VOID',
  'VOIDED',
]);

const REFUNDED_STATUSES = new Set(['PARTIALLY_REFUNDED', 'REFUNDED', 'REVERSED']);

const PENDING_STATUSES = new Set([
  'AUTHORIZED',
  'CONFIRMED',
  'CONFIRMING',
  'DRAFT',
  'IN_PROGRESS',
  'OPEN',
  'PARTIALLY_PAID',
  'PENDING',
  'PROCESSING',
  'REQUIRES_ACTION',
  'REQUIRES_CAPTURE',
  'REQUIRES_CONFIRMATION',
  'REQUIRES_PAYMENT_METHOD',
  'SENDING',
  'UNPAID',
  'WAITING',
]);

function normalizeStatus(value: string): NormalizedPaymentWebhookStatus {
  const status = value.trim().toUpperCase();
  if (CONFIRMED_STATUSES.has(status)) return 'CONFIRMED';
  if (FAILED_STATUSES.has(status)) return 'FAILED';
  if (REFUNDED_STATUSES.has(status)) return 'REFUNDED';
  if (PENDING_STATUSES.has(status)) return 'PENDING';
  return 'UNKNOWN';
}

function normalizeTimestamp(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('Payment event timestamp must be a non-empty ISO-8601 string when present');
  }
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(trimmed)) {
    throw new TypeError('Payment event timestamp must be ISO-8601 with an explicit timezone');
  }
  const milliseconds = Date.parse(trimmed);
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError('Payment event timestamp is invalid');
  }
  return new Date(milliseconds).toISOString();
}

function normalizeConfirmations(value: number | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Payment confirmations must be a non-negative safe integer when present');
  }
  return value;
}

/**
 * Convert an already signature-verified provider event into the shared payment shape.
 *
 * This function does not verify signatures or establish that an amount is authoritative. The
 * provider webhook pipeline owns signature verification; the authoritative payment domain owns
 * reconciliation. Unknown provider statuses, absent confirmation counts, and absent event times
 * stay visibly unknown instead of being turned into optimistic defaults.
 */
export function normalizePaymentWebhookPayload(
  raw: PaymentWebhookPayloadInput,
): NormalizedPaymentWebhookEvent {
  if (!raw || typeof raw !== 'object') {
    throw new TypeError('Payment event payload must be an object');
  }
  if (typeof raw.id !== 'string' || raw.id.trim() === '' || raw.id.length > 256) {
    throw new TypeError('Payment event id must be a non-empty string of at most 256 characters');
  }
  if (typeof raw.status !== 'string' || raw.status.trim() === '') {
    throw new TypeError('Payment event status must be a non-empty string');
  }
  if (typeof raw.amount !== 'string' || raw.amount.trim() === '') {
    throw new TypeError('Payment event amount must be an exact decimal string');
  }
  if (typeof raw.currency !== 'string') {
    throw new TypeError('Payment event currency must be a string');
  }

  const amount = Decimal.parse(raw.amount.trim());
  if (amount.isNegative()) {
    throw new TypeError('Payment event amount must not be negative');
  }

  const currency = raw.currency.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(currency)) {
    throw new TypeError('Payment event currency must be a 2-to-12 character alphanumeric code');
  }

  return {
    provider: raw.provider,
    externalPaymentId: raw.id.trim(),
    status: normalizeStatus(raw.status),
    amount: amount.toString(),
    currency,
    confirmations: normalizeConfirmations(raw.confirmations),
    occurredAtIso: normalizeTimestamp(raw.timestamp),
  };
}
