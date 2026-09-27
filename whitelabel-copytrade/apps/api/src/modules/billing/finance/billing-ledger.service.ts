import { Injectable, Logger } from '@nestjs/common';
import { BillingLedgerRepository } from './billing-ledger.repository';
import type { LedgerEntry, CreateLedgerEntryInput, CreateLedgerTransactionInput, LedgerFilter, LedgerBalance, LedgerAccountSummary } from './billing-ledger.types';
import { LedgerEntryType, LedgerAccountCategory, LedgerSourceType, LedgerEntryStatus } from './billing-ledger.types';
import { validateBalancedTransaction } from './billing-ledger.types';
import type { Money } from './money.types';
import { createMoney, parseToMinorUnits, isMoneyZero } from './money.types';
import { FinanceAuditService } from './finance.audit';
import { randomUUID } from 'crypto';

/**
 * Creates atomic double-entry billing ledger entries from domain events
 * such as payment received, invoice created, refund processed, tax calculated,
 * platform fee, performance fee, credit, and adjustment.
 *
 * Requirements:
 *  - each business operation results in balanced debit/credit entries
 *  - preserve immutable history (append-only, never update posted entry)
 *  - idempotency per source event (payment id / refund id / invoice id)
 *  - concurrency-safe creation
 *  - never produce an inconsistent ledger (total debits == total credits per transaction)
 *  - do not treat ledger as a single balance increment - track structured entries
 */

@Injectable()
export class BillingLedgerService {
  private readonly logger = new Logger(BillingLedgerService.name);

  constructor(
    private readonly ledgerRepository: BillingLedgerRepository,
    private readonly auditService: FinanceAuditService,
  ) {}

  async recordPaymentSucceeded(params: {
    tenantId: string;
    paymentId: string;
    invoiceId?: string;
    amount: Money;
    currency: string;
    provider?: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<LedgerEntry[]> {
    const idempotencyKey = params.idempotencyKey || `payment_succeeded_${params.paymentId}`;

    // Check idempotency
    const existing = await this.ledgerRepository.findBySource(LedgerSourceType.PAYMENT, params.paymentId);
    if (existing.length > 0 && existing.some((e) => e.idempotencyKey.includes(idempotencyKey) || e.idempotencyKey === idempotencyKey)) {
      this.logger.log(`Idempotent payment ledger return: ${params.paymentId}`);
      return existing.filter((e) => e.idempotencyKey.includes(idempotencyKey) || e.sourceId === params.paymentId);
    }

    // Double-entry: Debit CASH_RECEIVED, Credit CUSTOMER_RECEIVABLE
    const entries: CreateLedgerEntryInput[] = [
      {
        tenantId: params.tenantId,
        accountCategory: LedgerAccountCategory.CASH_RECEIVED,
        entryType: LedgerEntryType.DEBIT,
        amount: params.amount,
        sourceType: LedgerSourceType.PAYMENT,
        sourceId: params.paymentId,
        invoiceId: params.invoiceId || null,
        paymentId: params.paymentId,
        idempotencyKey: `${idempotencyKey}_debit_cash`,
        description: `Payment received: ${params.paymentId}`,
        metadata: { provider: params.provider, ...params.metadata },
      },
      {
        tenantId: params.tenantId,
        accountCategory: LedgerAccountCategory.CUSTOMER_RECEIVABLE,
        entryType: LedgerEntryType.CREDIT,
        amount: params.amount,
        sourceType: LedgerSourceType.PAYMENT,
        sourceId: params.paymentId,
        invoiceId: params.invoiceId || null,
        paymentId: params.paymentId,
        idempotencyKey: `${idempotencyKey}_credit_receivable`,
        description: `Customer receivable cleared: ${params.paymentId}`,
        metadata: { provider: params.provider, ...params.metadata },
      },
    ];

    this.validateBalanced(entries);

    const result = await this.ledgerRepository.createTransaction({
      tenantId: params.tenantId,
      description: `Payment succeeded: ${params.paymentId}`,
      entries,
      sourceType: LedgerSourceType.PAYMENT,
      sourceId: params.paymentId,
      idempotencyKey,
      metadata: params.metadata,
    });

    await this.auditService.logLedgerEntryCreated(params.tenantId, params.paymentId, 'PAYMENT', params.amount.amount, params.currency);

    return result;
  }

  async recordInvoiceCreated(params: {
    tenantId: string;
    invoiceId: string;
    paymentId?: string;
    subtotal: Money;
    taxAmount: Money;
    total: Money;
    currency: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<LedgerEntry[]> {
    const idempotencyKey = params.idempotencyKey || `invoice_created_${params.invoiceId}`;

    const existing = await this.ledgerRepository.findBySource(LedgerSourceType.INVOICE, params.invoiceId);
    if (existing.length > 0) {
      this.logger.log(`Idempotent invoice ledger return: ${params.invoiceId}`);
      return existing;
    }

    const entries: CreateLedgerEntryInput[] = [];

    // Debit CUSTOMER_RECEIVABLE for total
    entries.push({
      tenantId: params.tenantId,
      accountCategory: LedgerAccountCategory.CUSTOMER_RECEIVABLE,
      entryType: LedgerEntryType.DEBIT,
      amount: params.total,
      sourceType: LedgerSourceType.INVOICE,
      sourceId: params.invoiceId,
      invoiceId: params.invoiceId,
      paymentId: params.paymentId || null,
      idempotencyKey: `${idempotencyKey}_debit_receivable`,
      description: `Invoice receivable: ${params.invoiceId}`,
      metadata: params.metadata,
    });

    // Credit REVENUE for subtotal
    if (!isMoneyZero(params.subtotal)) {
      entries.push({
        tenantId: params.tenantId,
        accountCategory: LedgerAccountCategory.REVENUE,
        entryType: LedgerEntryType.CREDIT,
        amount: params.subtotal,
        sourceType: LedgerSourceType.INVOICE,
        sourceId: params.invoiceId,
        invoiceId: params.invoiceId,
        paymentId: params.paymentId || null,
        idempotencyKey: `${idempotencyKey}_credit_revenue`,
        description: `Revenue recognized: ${params.invoiceId}`,
        metadata: params.metadata,
      });
    }

    // Credit TAX_PAYABLE for tax
    if (!isMoneyZero(params.taxAmount)) {
      entries.push({
        tenantId: params.tenantId,
        accountCategory: LedgerAccountCategory.TAX_PAYABLE,
        entryType: LedgerEntryType.CREDIT,
        amount: params.taxAmount,
        sourceType: LedgerSourceType.INVOICE,
        sourceId: params.invoiceId,
        invoiceId: params.invoiceId,
        paymentId: params.paymentId || null,
        idempotencyKey: `${idempotencyKey}_credit_tax`,
        description: `Tax payable: ${params.invoiceId}`,
        metadata: params.metadata,
      });
    }

    this.validateBalanced(entries);

    const result = await this.ledgerRepository.createTransaction({
      tenantId: params.tenantId,
      description: `Invoice created: ${params.invoiceId}`,
      entries,
      sourceType: LedgerSourceType.INVOICE,
      sourceId: params.invoiceId,
      idempotencyKey,
      metadata: params.metadata,
    });

    await this.auditService.logLedgerEntryCreated(params.tenantId, params.invoiceId, 'INVOICE', params.total.amount, params.currency);

    return result;
  }

  async recordRefund(params: {
    tenantId: string;
    refundId: string;
    paymentId: string;
    invoiceId?: string;
    amount: Money;
    currency: string;
    reason?: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<LedgerEntry[]> {
    const idempotencyKey = params.idempotencyKey || `refund_${params.refundId}`;

    const existing = await this.ledgerRepository.findBySource(LedgerSourceType.REFUND, params.refundId);
    if (existing.length > 0) {
      this.logger.log(`Idempotent refund ledger return: ${params.refundId}`);
      return existing;
    }

    // Double-entry: Debit REFUND_LIABILITY, Credit CASH_RECEIVED (reversal)
    const entries: CreateLedgerEntryInput[] = [
      {
        tenantId: params.tenantId,
        accountCategory: LedgerAccountCategory.REFUND_LIABILITY,
        entryType: LedgerEntryType.DEBIT,
        amount: params.amount,
        sourceType: LedgerSourceType.REFUND,
        sourceId: params.refundId,
        invoiceId: params.invoiceId || null,
        paymentId: params.paymentId,
        refundId: params.refundId,
        idempotencyKey: `${idempotencyKey}_debit_refund`,
        description: `Refund liability: ${params.refundId} reason: ${params.reason || 'N/A'}`,
        metadata: { reason: params.reason, ...params.metadata },
      },
      {
        tenantId: params.tenantId,
        accountCategory: LedgerAccountCategory.CASH_RECEIVED,
        entryType: LedgerEntryType.CREDIT,
        amount: params.amount,
        sourceType: LedgerSourceType.REFUND,
        sourceId: params.refundId,
        invoiceId: params.invoiceId || null,
        paymentId: params.paymentId,
        refundId: params.refundId,
        idempotencyKey: `${idempotencyKey}_credit_cash`,
        description: `Refund cash out: ${params.refundId}`,
        metadata: { reason: params.reason, ...params.metadata },
      },
    ];

    this.validateBalanced(entries);

    const result = await this.ledgerRepository.createTransaction({
      tenantId: params.tenantId,
      description: `Refund processed: ${params.refundId}`,
      entries,
      sourceType: LedgerSourceType.REFUND,
      sourceId: params.refundId,
      idempotencyKey,
      metadata: params.metadata,
    });

    await this.auditService.logLedgerEntryCreated(params.tenantId, params.refundId, 'REFUND', params.amount.amount, params.currency);

    return result;
  }

  async recordTaxCollected(params: {
    tenantId: string;
    invoiceId: string;
    taxId?: string;
    amount: Money;
    currency: string;
    jurisdiction: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<LedgerEntry[]> {
    const idempotencyKey = params.idempotencyKey || `tax_${params.invoiceId}_${params.jurisdiction}`;

    const existing = await this.ledgerRepository.findBySource(LedgerSourceType.TAX, params.invoiceId);
    if (existing.length > 0 && existing.some((e) => e.idempotencyKey === idempotencyKey)) {
      return existing.filter((e) => e.idempotencyKey === idempotencyKey);
    }

    const entries: CreateLedgerEntryInput[] = [
      {
        tenantId: params.tenantId,
        accountCategory: LedgerAccountCategory.CUSTOMER_RECEIVABLE,
        entryType: LedgerEntryType.DEBIT,
        amount: params.amount,
        sourceType: LedgerSourceType.TAX,
        sourceId: params.invoiceId,
        invoiceId: params.invoiceId,
        taxId: params.taxId || null,
        idempotencyKey: `${idempotencyKey}_debit`,
        description: `Tax receivable: ${params.jurisdiction}`,
        metadata: { jurisdiction: params.jurisdiction, ...params.metadata },
      },
      {
        tenantId: params.tenantId,
        accountCategory: LedgerAccountCategory.TAX_PAYABLE,
        entryType: LedgerEntryType.CREDIT,
        amount: params.amount,
        sourceType: LedgerSourceType.TAX,
        sourceId: params.invoiceId,
        invoiceId: params.invoiceId,
        taxId: params.taxId || null,
        idempotencyKey: `${idempotencyKey}_credit`,
        description: `Tax payable: ${params.jurisdiction}`,
        metadata: { jurisdiction: params.jurisdiction, ...params.metadata },
      },
    ];

    this.validateBalanced(entries);

    return this.ledgerRepository.createTransaction({
      tenantId: params.tenantId,
      description: `Tax collected: ${params.jurisdiction}`,
      entries,
      sourceType: LedgerSourceType.TAX,
      sourceId: params.invoiceId,
      idempotencyKey,
      metadata: params.metadata,
    });
  }

  async recordFee(params: {
    tenantId: string;
    sourceId: string;
    sourceType: LedgerSourceType;
    amount: Money;
    currency: string;
    feeType: LedgerAccountCategory;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<LedgerEntry[]> {
    const idempotencyKey = params.idempotencyKey || `fee_${params.sourceId}_${params.feeType}`;

    const existing = await this.ledgerRepository.findBySource(params.sourceType, params.sourceId);
    if (existing.some((e) => e.idempotencyKey === idempotencyKey || e.idempotencyKey.includes(params.feeType))) {
      return existing.filter((e) => e.idempotencyKey.includes(idempotencyKey) || e.idempotencyKey.includes(params.feeType));
    }

    const entries: CreateLedgerEntryInput[] = [
      {
        tenantId: params.tenantId,
        accountCategory: LedgerAccountCategory.CUSTOMER_RECEIVABLE,
        entryType: LedgerEntryType.DEBIT,
        amount: params.amount,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        idempotencyKey: `${idempotencyKey}_debit`,
        description: `Fee: ${params.feeType}`,
        metadata: params.metadata,
      },
      {
        tenantId: params.tenantId,
        accountCategory: params.feeType,
        entryType: LedgerEntryType.CREDIT,
        amount: params.amount,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        idempotencyKey: `${idempotencyKey}_credit`,
        description: `Fee revenue: ${params.feeType}`,
        metadata: params.metadata,
      },
    ];

    this.validateBalanced(entries);

    return this.ledgerRepository.createTransaction({
      tenantId: params.tenantId,
      description: `Fee recorded: ${params.feeType}`,
      entries,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      idempotencyKey,
      metadata: params.metadata,
    });
  }

  async recordCredit(params: {
    tenantId: string;
    amount: Money;
    currency: string;
    reason: string;
    sourceId?: string;
    invoiceId?: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<LedgerEntry[]> {
    const idempotencyKey = params.idempotencyKey;

    const existing = await this.ledgerRepository.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      const all = await this.ledgerRepository.findBySource(LedgerSourceType.CREDIT, params.sourceId || idempotencyKey);
      return all.length > 0 ? all : [existing];
    }

    const sourceId = params.sourceId || randomUUID();

    const entries: CreateLedgerEntryInput[] = [
      {
        tenantId: params.tenantId,
        accountCategory: LedgerAccountCategory.DISCOUNT,
        entryType: LedgerEntryType.DEBIT,
        amount: params.amount,
        sourceType: LedgerSourceType.CREDIT,
        sourceId,
        invoiceId: params.invoiceId || null,
        idempotencyKey: `${idempotencyKey}_debit`,
        description: `Credit issued: ${params.reason}`,
        metadata: params.metadata,
      },
      {
        tenantId: params.tenantId,
        accountCategory: LedgerAccountCategory.CUSTOMER_CREDIT,
        entryType: LedgerEntryType.CREDIT,
        amount: params.amount,
        sourceType: LedgerSourceType.CREDIT,
        sourceId,
        invoiceId: params.invoiceId || null,
        idempotencyKey: `${idempotencyKey}_credit`,
        description: `Customer credit: ${params.reason}`,
        metadata: params.metadata,
      },
    ];

    this.validateBalanced(entries);

    return this.ledgerRepository.createTransaction({
      tenantId: params.tenantId,
      description: `Credit: ${params.reason}`,
      entries,
      sourceType: LedgerSourceType.CREDIT,
      sourceId,
      idempotencyKey,
      metadata: params.metadata,
    });
  }

  async getBalance(tenantId: string, accountCategory: LedgerAccountCategory, currency: string): Promise<LedgerBalance> {
    return this.ledgerRepository.getBalance(tenantId, accountCategory, currency);
  }

  async getAccountSummary(tenantId: string, currency: string): Promise<LedgerAccountSummary> {
    return this.ledgerRepository.getAccountSummary(tenantId, currency);
  }

  async findByTenant(tenantId: string, filter?: LedgerFilter): Promise<LedgerEntry[]> {
    return this.ledgerRepository.findByTenant(tenantId, filter);
  }

  async findBySource(sourceType: LedgerSourceType, sourceId: string): Promise<LedgerEntry[]> {
    return this.ledgerRepository.findBySource(sourceType, sourceId);
  }

  async list(filter: LedgerFilter): Promise<LedgerEntry[]> {
    return this.ledgerRepository.list(filter);
  }

  private validateBalanced(entries: CreateLedgerEntryInput[]): void {
    const result = validateBalancedTransaction(entries);
    if (!result.balanced) {
      throw new Error(`Ledger transaction unbalanced: ${result.error} (debit=${result.debitTotal}, credit=${result.creditTotal})`);
    }
  }
}
