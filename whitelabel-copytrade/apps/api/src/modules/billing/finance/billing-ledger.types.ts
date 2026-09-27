import type { UUID } from '@wlct/shared-types';
import type { Money } from './money.types';
import { PaymentProvider } from '../payments/payment.types';

/**
 * Double-entry-style commercial billing ledger types: debit/credit,
 * account category, source reference, amount, currency, entry status,
 * and immutable event metadata.
 */

export enum LedgerEntryType {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

export enum LedgerAccountCategory {
  CUSTOMER_RECEIVABLE = 'CUSTOMER_RECEIVABLE',
  CASH_RECEIVED = 'CASH_RECEIVED',
  PAYMENT_PROCESSOR_CLEARING = 'PAYMENT_PROCESSOR_CLEARING',
  REVENUE = 'REVENUE',
  TAX_PAYABLE = 'TAX_PAYABLE',
  REFUND_LIABILITY = 'REFUND_LIABILITY',
  PLATFORM_FEE_REVENUE = 'PLATFORM_FEE_REVENUE',
  PERFORMANCE_FEE_REVENUE = 'PERFORMANCE_FEE_REVENUE',
  CUSTOMER_CREDIT = 'CUSTOMER_CREDIT',
  DISCOUNT = 'DISCOUNT',
  ADJUSTMENT = 'ADJUSTMENT',
  CHARGEBACK = 'CHARGEBACK',
  WRITE_OFF = 'WRITE_OFF',
}

export enum LedgerSourceType {
  PAYMENT = 'PAYMENT',
  INVOICE = 'INVOICE',
  REFUND = 'REFUND',
  TAX = 'TAX',
  FEE = 'FEE',
  CREDIT = 'CREDIT',
  ADJUSTMENT = 'ADJUSTMENT',
  DUNNING = 'DUNNING',
  RECONCILIATION = 'RECONCILIATION',
}

export enum LedgerEntryStatus {
  PENDING = 'PENDING',
  POSTED = 'POSTED',
  VOIDED = 'VOIDED',
  REVERSED = 'REVERSED',
}

export interface LedgerEntry {
  id: UUID;
  tenantId: UUID;
  accountCategory: LedgerAccountCategory;
  entryType: LedgerEntryType;
  amount: Money;
  currency: string;
  sourceType: LedgerSourceType;
  sourceId: UUID;
  invoiceId: UUID | null;
  paymentId: UUID | null;
  refundId: UUID | null;
  taxId: UUID | null;
  feeReference: string | null;
  idempotencyKey: string;
  effectiveAt: Date;
  description: string;
  metadata: Record<string, unknown> | null;
  status: LedgerEntryStatus;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
}

export interface LedgerTransaction {
  id: UUID;
  tenantId: UUID;
  description: string;
  entries: LedgerEntry[];
  sourceType: LedgerSourceType;
  sourceId: UUID;
  idempotencyKey: string;
  effectiveAt: Date;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface CreateLedgerEntryInput {
  tenantId: UUID;
  accountCategory: LedgerAccountCategory;
  entryType: LedgerEntryType;
  amount: Money;
  sourceType: LedgerSourceType;
  sourceId: UUID;
  invoiceId?: UUID | null;
  paymentId?: UUID | null;
  refundId?: UUID | null;
  taxId?: UUID | null;
  feeReference?: string | null;
  idempotencyKey: string;
  effectiveAt?: Date;
  description: string;
  metadata?: Record<string, unknown>;
  createdBy?: string;
}

export interface CreateLedgerTransactionInput {
  tenantId: UUID;
  description: string;
  entries: CreateLedgerEntryInput[];
  sourceType: LedgerSourceType;
  sourceId: UUID;
  idempotencyKey: string;
  effectiveAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface LedgerFilter {
  tenantId?: UUID;
  accountCategory?: LedgerAccountCategory;
  entryType?: LedgerEntryType;
  sourceType?: LedgerSourceType;
  sourceId?: UUID;
  invoiceId?: UUID;
  paymentId?: UUID;
  refundId?: UUID;
  currency?: string;
  status?: LedgerEntryStatus;
  fromDate?: Date;
  toDate?: Date;
  idempotencyKey?: string;
}

export interface LedgerBalance {
  tenantId: UUID;
  accountCategory: LedgerAccountCategory;
  currency: string;
  debitTotal: Money;
  creditTotal: Money;
  balance: Money;
  entryCount: number;
  lastEntryAt: Date | null;
}

export interface LedgerAccountSummary {
  tenantId: UUID;
  currency: string;
  balances: LedgerBalance[];
  totalDebit: Money;
  totalCredit: Money;
  netBalance: Money;
}

export const BALANCED_TRANSACTION_RULES: Record<string, { debit: LedgerAccountCategory[]; credit: LedgerAccountCategory[] }> = {
  PAYMENT_SUCCEEDED: {
    debit: [LedgerAccountCategory.CASH_RECEIVED, LedgerAccountCategory.PAYMENT_PROCESSOR_CLEARING],
    credit: [LedgerAccountCategory.CUSTOMER_RECEIVABLE],
  },
  INVOICE_CREATED: {
    debit: [LedgerAccountCategory.CUSTOMER_RECEIVABLE],
    credit: [LedgerAccountCategory.REVENUE, LedgerAccountCategory.TAX_PAYABLE],
  },
  REFUND_PROCESSED: {
    debit: [LedgerAccountCategory.REFUND_LIABILITY, LedgerAccountCategory.REVENUE],
    credit: [LedgerAccountCategory.CASH_RECEIVED],
  },
  TAX_COLLECTED: {
    debit: [LedgerAccountCategory.CUSTOMER_RECEIVABLE],
    credit: [LedgerAccountCategory.TAX_PAYABLE],
  },
};

export function validateBalancedTransaction(entries: CreateLedgerEntryInput[]): { balanced: boolean; debitTotal: number; creditTotal: number; error?: string } {
  let debitTotal = 0;
  let creditTotal = 0;

  for (const entry of entries) {
    const minorUnits = Math.round(parseFloat(entry.amount.amount) * Math.pow(10, entry.amount.minorUnit));
    if (entry.entryType === LedgerEntryType.DEBIT) {
      debitTotal += minorUnits;
    } else {
      creditTotal += minorUnits;
    }
  }

  const balanced = debitTotal === creditTotal;

  return {
    balanced,
    debitTotal,
    creditTotal,
    error: balanced ? undefined : `Unbalanced transaction: debit ${debitTotal} != credit ${creditTotal}`,
  };
}
