import type { ISODateString, UUID } from '@wlct/shared-types';
import { BillingInterval } from '@wlct/shared-types';
import { PaymentProvider, PaymentCurrency, CheckoutStatus, PaymentStatus } from './payment.types';

/**
 * Checkout-specific request/response models.
 *
 * Checkout is the user-facing flow that creates a provider checkout/invoice
 * from the canonical billing plan/catalog.
 */

export enum CheckoutMode {
  SUBSCRIPTION = 'subscription',
  PAYMENT = 'payment',
  SETUP = 'setup',
}

export interface CheckoutRequest {
  planId: UUID;
  billingInterval?: BillingInterval;
  currency?: PaymentCurrency | string;
  provider?: PaymentProvider;
  successUrl?: string;
  cancelUrl?: string;
  seats?: number;
  idempotencyKey?: string;
  metadata?: Record<string, string>;
}

export interface CheckoutResponse {
  checkoutId: UUID;
  paymentId: UUID;
  provider: PaymentProvider;
  status: CheckoutStatus;
  paymentStatus: PaymentStatus;
  checkoutUrl: string;
  invoiceUrl?: string | null;
  providerCheckoutId: string;
  providerSessionId?: string | null;
  amount: string;
  currency: string;
  planId: UUID;
  planCode: string;
  planName: string;
  billingInterval: BillingInterval;
  expiresAt?: ISODateString | null;
  createdAt: ISODateString;
}

export interface CheckoutStatusResponse {
  checkoutId: UUID;
  paymentId: UUID;
  provider: PaymentProvider;
  status: CheckoutStatus;
  paymentStatus: PaymentStatus;
  amount: string;
  currency: string;
  planId: UUID;
  planCode: string;
  planName: string;
  checkoutUrl?: string | null;
  invoiceUrl?: string | null;
  providerCheckoutId: string;
  paidAt?: ISODateString | null;
  failedAt?: ISODateString | null;
  cancelledAt?: ISODateString | null;
  expiresAt?: ISODateString | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface CreateCheckoutSessionInput {
  tenantId: UUID;
  userId: UUID;
  planId: UUID;
  billingInterval: BillingInterval;
  currency: PaymentCurrency | string;
  provider: PaymentProvider;
  successUrl?: string;
  cancelUrl?: string;
  seats?: number;
  idempotencyKey: string;
  ipHash?: string;
  requestId?: string;
  metadata?: Record<string, string>;
}

export interface CheckoutRecord {
  id: UUID;
  paymentId: UUID;
  tenantId: UUID;
  userId: UUID;
  planId: UUID;
  provider: PaymentProvider;
  status: CheckoutStatus;
  paymentStatus: PaymentStatus;
  amount: string;
  currency: string;
  planCode: string;
  planName: string;
  billingInterval: BillingInterval;
  providerCheckoutId: string;
  providerSessionId: string | null;
  checkoutUrl: string;
  invoiceUrl: string | null;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
  orderId: string;
  seats: number;
  metadata: Record<string, unknown> | null;
  expiresAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CheckoutFilter {
  tenantId?: UUID;
  userId?: UUID;
  planId?: UUID;
  provider?: PaymentProvider;
  status?: CheckoutStatus;
  fromDate?: Date;
  toDate?: Date;
}

export interface ValidatedCheckoutContext {
  tenantId: UUID;
  userId: UUID;
  plan: {
    id: UUID;
    code: string;
    name: string;
    price: string;
    currency: string;
    interval: BillingInterval;
    isActive: boolean;
    limits: any;
    features: string[];
  };
  billingInterval: BillingInterval;
  currency: string;
  provider: PaymentProvider;
  amount: string;
  amountInSmallestUnit: number;
  idempotencyKey: string;
  orderId: string;
  successUrl: string;
  cancelUrl: string;
  seats: number;
}
