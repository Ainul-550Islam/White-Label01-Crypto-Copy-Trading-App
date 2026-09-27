import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { randomUUID } from 'crypto';

/**
 * Structured, immutable financial audit trail.
 *
 * Events:
 *  - INVOICE_CREATED / FINALIZED / PAID / VOIDED
 *  - TAX_CALCULATED
 *  - LEDGER_ENTRY_CREATED
 *  - REFUND_REQUESTED / SUCCEEDED / FAILED
 *  - DUNNING_CREATED / RETRY_SCHEDULED / RECOVERED / SUSPENDED
 *  - BILLING_CUSTOMER_UPDATED
 *  - RECONCILIATION_DETECTED / RESOLVED
 *
 * Fields: tenantId, operation, reference ID, status, timestamp, safe metadata.
 * Must never log card numbers, CVV, provider secrets, exchange credentials,
 * private keys, or access tokens.
 */

export enum FinanceAuditOperation {
  INVOICE_CREATED = 'INVOICE_CREATED',
  INVOICE_FINALIZED = 'INVOICE_FINALIZED',
  INVOICE_PAID = 'INVOICE_PAID',
  INVOICE_VOIDED = 'INVOICE_VOIDED',
  TAX_CALCULATED = 'TAX_CALCULATED',
  LEDGER_ENTRY_CREATED = 'LEDGER_ENTRY_CREATED',
  REFUND_REQUESTED = 'REFUND_REQUESTED',
  REFUND_SUCCEEDED = 'REFUND_SUCCEEDED',
  REFUND_FAILED = 'REFUND_FAILED',
  DUNNING_CREATED = 'DUNNING_CREATED',
  DUNNING_RETRY_SCHEDULED = 'DUNNING_RETRY_SCHEDULED',
  DUNNING_RECOVERED = 'DUNNING_RECOVERED',
  DUNNING_SUSPENDED = 'DUNNING_SUSPENDED',
  DUNNING_FAILED = 'DUNNING_FAILED',
  BILLING_CUSTOMER_UPDATED = 'BILLING_CUSTOMER_UPDATED',
  RECONCILIATION_DETECTED = 'RECONCILIATION_DETECTED',
  RECONCILIATION_RESOLVED = 'RECONCILIATION_RESOLVED',
  INVOICE_NUMBER_GENERATED = 'INVOICE_NUMBER_GENERATED',
}

export interface FinanceAuditRecord {
  id: string;
  tenantId: string;
  operation: FinanceAuditOperation;
  referenceId: string;
  referenceType: string;
  status: string;
  amount: string | null;
  currency: string | null;
  metadata: Record<string, unknown> | null;
  actorId: string | null;
  actorType: string | null;
  timestamp: Date;
  createdAt: Date;
}

export interface CreateFinanceAuditInput {
  tenantId: string;
  operation: FinanceAuditOperation;
  referenceId: string;
  referenceType: string;
  status: string;
  amount?: string;
  currency?: string;
  metadata?: Record<string, unknown>;
  actorId?: string;
  actorType?: string;
}

@Injectable()
export class FinanceAuditService {
  private readonly logger = new Logger(FinanceAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(input: CreateFinanceAuditInput): Promise<void> {
    // Sanitize metadata to ensure no secrets are logged
    const sanitizedMetadata = this.sanitizeMetadata(input.metadata);

    const record: FinanceAuditRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      operation: input.operation,
      referenceId: input.referenceId,
      referenceType: input.referenceType,
      status: input.status,
      amount: input.amount || null,
      currency: input.currency || null,
      metadata: sanitizedMetadata,
      actorId: input.actorId || null,
      actorType: input.actorType || null,
      timestamp: new Date(),
      createdAt: new Date(),
    };

    try {
      await (this.prisma as any).financeAuditLog?.create({
        data: {
          id: record.id,
          tenantId: record.tenantId,
          operation: record.operation,
          referenceId: record.referenceId,
          referenceType: record.referenceType,
          status: record.status,
          amount: record.amount,
          currency: record.currency,
          metadata: record.metadata ? JSON.parse(JSON.stringify(record.metadata)) : null,
          actorId: record.actorId,
          actorType: record.actorType,
          timestamp: record.timestamp,
          createdAt: record.createdAt,
        },
      });
    } catch (error: any) {
      if (error.code === 'P2021' || error.message?.includes('does not exist')) {
        // Fallback: log to application audit or console
        this.logger.log(`[FINANCE_AUDIT] ${record.operation} tenant=${record.tenantId} ref=${record.referenceId} status=${record.status} amount=${record.amount} ${record.currency || ''}`);

        // Also try to write to general audit log if available
        try {
          await (this.prisma as any).auditLog?.create({
            data: {
              id: record.id,
              tenantId: record.tenantId,
              action: record.operation,
              resource: record.referenceType,
              resourceId: record.referenceId,
              metadata: record.metadata ? JSON.parse(JSON.stringify(record.metadata)) : null,
              createdAt: record.createdAt,
            },
          });
        } catch {
          // Ignore - audit log model may also not exist
        }
        return;
      }
      this.logger.warn(`Failed to create finance audit log: ${(error as Error).message}`);
    }
  }

  // Specific audit methods

  async logInvoiceCreated(tenantId: string, invoiceId: string, invoiceNumber: string, amount: string, currency: string, paymentId?: string): Promise<void> {
    await this.log({
      tenantId,
      operation: FinanceAuditOperation.INVOICE_CREATED,
      referenceId: invoiceId,
      referenceType: 'INVOICE',
      status: 'CREATED',
      amount,
      currency,
      metadata: { invoiceNumber, paymentId },
    });
  }

  async logInvoiceFinalized(tenantId: string, invoiceId: string, invoiceNumber: string): Promise<void> {
    await this.log({
      tenantId,
      operation: FinanceAuditOperation.INVOICE_FINALIZED,
      referenceId: invoiceId,
      referenceType: 'INVOICE',
      status: 'FINALIZED',
      metadata: { invoiceNumber },
    });
  }

  async logInvoicePaid(tenantId: string, invoiceId: string, invoiceNumber: string, amount: string, currency: string): Promise<void> {
    await this.log({
      tenantId,
      operation: FinanceAuditOperation.INVOICE_PAID,
      referenceId: invoiceId,
      referenceType: 'INVOICE',
      status: 'PAID',
      amount,
      currency,
      metadata: { invoiceNumber },
    });
  }

  async logInvoiceVoided(tenantId: string, invoiceId: string, invoiceNumber: string, reason?: string): Promise<void> {
    await this.log({
      tenantId,
      operation: FinanceAuditOperation.INVOICE_VOIDED,
      referenceId: invoiceId,
      referenceType: 'INVOICE',
      status: 'VOIDED',
      metadata: { invoiceNumber, reason },
    });
  }

  async logTaxCalculated(tenantId: string, invoiceId: string, taxAmount: string, currency: string, jurisdiction: string, taxRate: number): Promise<void> {
    await this.log({
      tenantId,
      operation: FinanceAuditOperation.TAX_CALCULATED,
      referenceId: invoiceId,
      referenceType: 'INVOICE',
      status: 'CALCULATED',
      amount: taxAmount,
      currency,
      metadata: { jurisdiction, taxRate },
    });
  }

  async logLedgerEntryCreated(tenantId: string, referenceId: string, referenceType: string, amount: string, currency: string): Promise<void> {
    await this.log({
      tenantId,
      operation: FinanceAuditOperation.LEDGER_ENTRY_CREATED,
      referenceId,
      referenceType: 'LEDGER',
      status: 'POSTED',
      amount,
      currency,
      metadata: { sourceType: referenceType, sourceId: referenceId },
    });
  }

  async logRefundRequested(tenantId: string, refundId: string, paymentId: string, amount: string, currency: string, reason: string): Promise<void> {
    await this.log({
      tenantId,
      operation: FinanceAuditOperation.REFUND_REQUESTED,
      referenceId: refundId,
      referenceType: 'REFUND',
      status: 'REQUESTED',
      amount,
      currency,
      metadata: { paymentId, reason },
    });
  }

  async logRefundSucceeded(tenantId: string, refundId: string, paymentId: string, amount: string, currency: string): Promise<void> {
    await this.log({
      tenantId,
      operation: FinanceAuditOperation.REFUND_SUCCEEDED,
      referenceId: refundId,
      referenceType: 'REFUND',
      status: 'SUCCEEDED',
      amount,
      currency,
      metadata: { paymentId },
    });
  }

  async logRefundFailed(tenantId: string, refundId: string, paymentId: string, failureReason: string): Promise<void> {
    await this.log({
      tenantId,
      operation: FinanceAuditOperation.REFUND_FAILED,
      referenceId: refundId,
      referenceType: 'REFUND',
      status: 'FAILED',
      metadata: { paymentId, failureReason: this.truncateReason(failureReason) },
    });
  }

  async logDunningCreated(tenantId: string, dunningId: string, paymentId: string, trigger: string): Promise<void> {
    await this.log({
      tenantId,
      operation: FinanceAuditOperation.DUNNING_CREATED,
      referenceId: dunningId,
      referenceType: 'DUNNING',
      status: 'ACTIVE',
      metadata: { paymentId, trigger },
    });
  }

  async logDunningRetryScheduled(tenantId: string, dunningId: string, attempt: number, nextRetryAt: Date): Promise<void> {
    await this.log({
      tenantId,
      operation: FinanceAuditOperation.DUNNING_RETRY_SCHEDULED,
      referenceId: dunningId,
      referenceType: 'DUNNING',
      status: 'RETRY_SCHEDULED',
      metadata: { attempt, nextRetryAt: nextRetryAt.toISOString() },
    });
  }

  async logDunningRecovered(tenantId: string, dunningId: string, paymentId: string, attempt: number): Promise<void> {
    await this.log({
      tenantId,
      operation: FinanceAuditOperation.DUNNING_RECOVERED,
      referenceId: dunningId,
      referenceType: 'DUNNING',
      status: 'RECOVERED',
      metadata: { paymentId, attempt },
    });
  }

  async logDunningSuspended(tenantId: string, dunningId: string, paymentId: string, reason: string): Promise<void> {
    await this.log({
      tenantId,
      operation: FinanceAuditOperation.DUNNING_SUSPENDED,
      referenceId: dunningId,
      referenceType: 'DUNNING',
      status: 'SUSPENDED',
      metadata: { paymentId, reason: this.truncateReason(reason) },
    });
  }

  async logBillingCustomerUpdated(tenantId: string, customerId: string, action: string): Promise<void> {
    await this.log({
      tenantId,
      operation: FinanceAuditOperation.BILLING_CUSTOMER_UPDATED,
      referenceId: customerId,
      referenceType: 'BILLING_CUSTOMER',
      status: action,
      metadata: { action },
    });
  }

  async logReconciliationDetected(tenantId: string, reconciliationId: string, issuesFound: number, summary: Record<string, number>): Promise<void> {
    await this.log({
      tenantId,
      operation: FinanceAuditOperation.RECONCILIATION_DETECTED,
      referenceId: reconciliationId,
      referenceType: 'RECONCILIATION',
      status: 'DETECTED',
      metadata: { issuesFound, summary },
    });
  }

  async logReconciliationResolved(tenantId: string, reconciliationId: string, issueId: string, resolution: string): Promise<void> {
    await this.log({
      tenantId,
      operation: FinanceAuditOperation.RECONCILIATION_RESOLVED,
      referenceId: reconciliationId,
      referenceType: 'RECONCILIATION',
      status: 'RESOLVED',
      metadata: { issueId, resolution },
    });
  }

  async logInvoiceNumberGenerated(tenantId: string, invoiceId: string, invoiceNumber: string): Promise<void> {
    await this.log({
      tenantId,
      operation: FinanceAuditOperation.INVOICE_NUMBER_GENERATED,
      referenceId: invoiceId,
      referenceType: 'INVOICE',
      status: 'GENERATED',
      metadata: { invoiceNumber },
    });
  }

  private sanitizeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | null {
    if (!metadata) return null;

    const forbiddenKeys = [
      'cardNumber',
      'card_number',
      'cvv',
      'cvc',
      'secret',
      'apiKey',
      'api_key',
      'privateKey',
      'private_key',
      'accessToken',
      'access_token',
      'refreshToken',
      'refresh_token',
      'password',
      'exchangeKey',
      'exchangeSecret',
      'providerSecret',
      'stripeSecret',
      'webhookSecret',
      'credentials',
    ];

    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(metadata)) {
      const lowerKey = key.toLowerCase();
      const isForbidden = forbiddenKeys.some((forbidden) => lowerKey.includes(forbidden.toLowerCase()));

      if (isForbidden) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        sanitized[key] = this.sanitizeMetadata(value as Record<string, unknown>);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  private truncateReason(reason: string, maxLength = 500): string {
    if (reason.length <= maxLength) return reason;
    return reason.substring(0, maxLength) + '...';
  }
}
