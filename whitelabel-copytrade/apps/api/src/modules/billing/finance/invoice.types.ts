import type { ISODateString, UUID } from '@wlct/shared-types';
import { BillingInterval } from '@wlct/shared-types';
import type { Money } from './money.types';
import { PaymentProvider } from '../payments/payment.types';

/**
 * Invoice domain models: invoice status, line items, totals, billing period,
 * customer/tenant references, tax summary, payment references, and invoice lifecycle state.
 */

export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  OPEN = 'OPEN',
  FINALIZED = 'FINALIZED',
  PAID = 'PAID',
  VOID = 'VOID',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  REFUNDED = 'REFUNDED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
  UNCOLLECTIBLE = 'UNCOLLECTIBLE',
}

export enum InvoiceLineType {
  SUBSCRIPTION = 'SUBSCRIPTION',
  PLAN_FEE = 'PLAN_FEE',
  USAGE = 'USAGE',
  DISCOUNT = 'DISCOUNT',
  TAX = 'TAX',
  FEE = 'FEE',
  CREDIT = 'CREDIT',
  ADJUSTMENT = 'ADJUSTMENT',
  REFUND = 'REFUND',
}

export enum DiscountType {
  PERCENTAGE = 'PERCENTAGE',
  FIXED_AMOUNT = 'FIXED_AMOUNT',
  NONE = 'NONE',
}

export interface InvoiceLineItem {
  id: UUID;
  invoiceId: UUID;
  type: InvoiceLineType;
  description: string;
  quantity: number;
  unitPrice: Money;
  amount: Money;
  discountType?: DiscountType;
  discountValue?: string;
  discountAmount?: Money;
  taxRate?: number;
  taxAmount?: Money;
  metadata?: Record<string, unknown>;
  planId?: UUID;
  subscriptionId?: UUID;
  billingPeriodStart?: ISODateString;
  billingPeriodEnd?: ISODateString;
}

export interface InvoiceTaxSummary {
  taxRate: number;
  taxableAmount: Money;
  taxAmount: Money;
  jurisdiction?: string;
  taxCategory?: string;
  exemptionReason?: string;
  reverseCharge?: boolean;
}

export interface InvoiceTotals {
  subtotal: Money;
  discountTotal: Money;
  taxTotal: Money;
  total: Money;
  amountPaid: Money;
  amountDue: Money;
  amountRefunded: Money;
  amountCredited: Money;
}

export interface InvoiceBillingPeriod {
  start: ISODateString;
  end: ISODateString;
  interval: BillingInterval;
}

export interface InvoiceCustomer {
  tenantId: UUID;
  customerId?: UUID;
  billingName: string;
  legalName?: string;
  billingEmail: string;
  billingAddress?: {
    line1: string;
    line2?: string;
    city: string;
    region?: string;
    postalCode?: string;
    country: string;
  };
  taxId?: string;
  vatNumber?: string;
}

export interface InvoicePaymentReference {
  paymentId: UUID;
  provider: PaymentProvider;
  providerPaymentId?: string;
  providerInvoiceId?: string;
  paymentMethod?: string;
  paidAt?: ISODateString;
}

export interface InvoiceRecord {
  id: UUID;
  invoiceNumber: string;
  tenantId: UUID;
  customerId: UUID | null;
  subscriptionId: UUID | null;
  paymentId: UUID | null;
  currency: string;
  status: InvoiceStatus;
  issueDate: Date;
  dueDate: Date | null;
  billingPeriodStart: Date | null;
  billingPeriodEnd: Date | null;
  billingInterval: BillingInterval | null;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  amountPaid: string;
  amountDue: string;
  amountRefunded: string;
  amountCredited: string;
  provider: PaymentProvider | null;
  providerInvoiceId: string | null;
  planId: UUID | null;
  planCode: string | null;
  planName: string | null;
  idempotencyKey: string;
  metadata: Record<string, unknown> | null;
  finalizedAt: Date | null;
  paidAt: Date | null;
  voidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvoiceWithLines extends InvoiceRecord {
  lines: InvoiceLineItem[];
  taxSummary: InvoiceTaxSummary[];
  customer: InvoiceCustomer;
  paymentReference?: InvoicePaymentReference;
}

export interface CreateInvoiceInput {
  tenantId: UUID;
  customerId?: UUID;
  subscriptionId?: UUID;
  paymentId?: UUID;
  currency: string;
  issueDate?: Date;
  dueDate?: Date;
  billingPeriod?: {
    start: Date;
    end: Date;
    interval: BillingInterval;
  };
  planId?: UUID;
  planCode?: string;
  planName?: string;
  provider?: PaymentProvider;
  providerInvoiceId?: string;
  idempotencyKey: string;
  lines: Omit<InvoiceLineItem, 'id' | 'invoiceId'>[];
  taxSummary?: InvoiceTaxSummary[];
  customer: InvoiceCustomer;
  paymentReference?: InvoicePaymentReference;
  metadata?: Record<string, unknown>;
}

export interface UpdateInvoiceInput {
  status?: InvoiceStatus;
  dueDate?: Date | null;
  amountPaid?: string;
  amountDue?: string;
  amountRefunded?: string;
  amountCredited?: string;
  providerInvoiceId?: string;
  metadata?: Record<string, unknown>;
  finalizedAt?: Date | null;
  paidAt?: Date | null;
  voidedAt?: Date | null;
}

export interface InvoiceFilter {
  tenantId?: UUID;
  customerId?: UUID;
  subscriptionId?: UUID;
  paymentId?: UUID;
  status?: InvoiceStatus;
  currency?: string;
  planId?: UUID;
  invoiceNumber?: string;
  fromDate?: Date;
  toDate?: Date;
  billingInterval?: BillingInterval;
}

export const VALID_INVOICE_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  [InvoiceStatus.DRAFT]: [InvoiceStatus.OPEN, InvoiceStatus.FINALIZED, InvoiceStatus.VOID],
  [InvoiceStatus.OPEN]: [InvoiceStatus.FINALIZED, InvoiceStatus.PAID, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.VOID, InvoiceStatus.UNCOLLECTIBLE],
  [InvoiceStatus.FINALIZED]: [InvoiceStatus.PAID, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.VOID, InvoiceStatus.UNCOLLECTIBLE],
  [InvoiceStatus.PAID]: [InvoiceStatus.REFUNDED, InvoiceStatus.PARTIALLY_REFUNDED],
  [InvoiceStatus.PARTIALLY_PAID]: [InvoiceStatus.PAID, InvoiceStatus.REFUNDED, InvoiceStatus.PARTIALLY_REFUNDED, InvoiceStatus.VOID, InvoiceStatus.UNCOLLECTIBLE],
  [InvoiceStatus.VOID]: [],
  [InvoiceStatus.REFUNDED]: [],
  [InvoiceStatus.PARTIALLY_REFUNDED]: [InvoiceStatus.REFUNDED],
  [InvoiceStatus.UNCOLLECTIBLE]: [InvoiceStatus.VOID],
};

export function isValidInvoiceTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  if (from === to) return true;
  const allowed = VALID_INVOICE_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}
