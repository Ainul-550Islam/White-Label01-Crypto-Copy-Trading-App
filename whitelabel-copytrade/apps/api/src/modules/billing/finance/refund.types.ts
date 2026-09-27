import type { UUID } from '@wlct/shared-types';
import type { Money } from './money.types';
import { PaymentProvider } from '../payments/payment.types';

/**
 * Refund types: full/partial refund, reason, provider refund reference,
 * refund status, and timestamps.
 */

export enum RefundType {
  FULL = 'FULL',
  PARTIAL = 'PARTIAL',
}

export enum RefundReason {
  DUPLICATE = 'DUPLICATE',
  FRAUDULENT = 'FRAUDULENT',
  REQUESTED_BY_CUSTOMER = 'REQUESTED_BY_CUSTOMER',
  SERVICE_ISSUE = 'SERVICE_ISSUE',
  BILLING_ERROR = 'BILLING_ERROR',
  CANCELLATION = 'CANCELLATION',
  DOWNGRADE = 'DOWNGRADE',
  GOODWILL = 'GOODWILL',
  CHARGEBACK = 'CHARGEBACK',
  OTHER = 'OTHER',
}

export enum RefundStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  CANCELED = 'CANCELED',
  REQUIRES_ACTION = 'REQUIRES_ACTION',
}

export interface RefundRecord {
  id: UUID;
  tenantId: UUID;
  paymentId: UUID;
  invoiceId: UUID | null;
  refundType: RefundType;
  reason: RefundReason;
  reasonDetails: string | null;
  amount: string;
  currency: string;
  status: RefundStatus;
  provider: PaymentProvider;
  providerRefundId: string | null;
  providerStatus: string | null;
  idempotencyKey: string;
  failureReason: string | null;
  failureCode: string | null;
  requestedBy: UUID | null;
  requestedAt: Date;
  processedAt: Date | null;
  succeededAt: Date | null;
  failedAt: Date | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRefundInput {
  tenantId: UUID;
  paymentId: UUID;
  invoiceId?: UUID | null;
  amount?: Money;
  refundType: RefundType;
  reason: RefundReason;
  reasonDetails?: string;
  idempotencyKey: string;
  requestedBy?: UUID;
  metadata?: Record<string, unknown>;
}

export interface RefundFilter {
  tenantId?: UUID;
  paymentId?: UUID;
  invoiceId?: UUID;
  status?: RefundStatus;
  refundType?: RefundType;
  reason?: RefundReason;
  provider?: PaymentProvider;
  currency?: string;
  fromDate?: Date;
  toDate?: Date;
  idempotencyKey?: string;
}

export interface RefundableAmount {
  paymentId: UUID;
  tenantId: UUID;
  originalAmount: Money;
  refundedAmount: Money;
  refundableAmount: Money;
  currency: string;
  isFullyRefunded: boolean;
  isPartiallyRefunded: boolean;
}

export interface ProviderRefundResult {
  providerRefundId: string;
  status: RefundStatus;
  providerStatus: string;
  amount: Money;
  currency: string;
  failureReason?: string;
  failureCode?: string;
  metadata?: Record<string, unknown>;
}

export const VALID_REFUND_TRANSITIONS: Record<RefundStatus, RefundStatus[]> = {
  [RefundStatus.PENDING]: [RefundStatus.PROCESSING, RefundStatus.CANCELED, RefundStatus.FAILED],
  [RefundStatus.PROCESSING]: [RefundStatus.SUCCEEDED, RefundStatus.FAILED, RefundStatus.REQUIRES_ACTION],
  [RefundStatus.REQUIRES_ACTION]: [RefundStatus.PROCESSING, RefundStatus.FAILED, RefundStatus.CANCELED],
  [RefundStatus.SUCCEEDED]: [],
  [RefundStatus.FAILED]: [RefundStatus.PENDING],
  [RefundStatus.CANCELED]: [],
};

export function isValidRefundTransition(from: RefundStatus, to: RefundStatus): boolean {
  const allowed = VALID_REFUND_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}
