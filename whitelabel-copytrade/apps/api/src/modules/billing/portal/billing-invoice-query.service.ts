import { Injectable, Logger } from '@nestjs/common';
import { InvoiceRepository } from '../finance/invoice.repository';
import { InvoicePdfService } from '../finance/invoice-pdf.service';
import type { PortalInvoiceSummary } from './billing-portal.types';

/**
 * Read-only customer-facing invoice history/details/download metadata
 * using existing finance invoice records. Tenant-scoped, no secrets.
 */
@Injectable()
export class BillingInvoiceQueryService {
  private readonly logger = new Logger(BillingInvoiceQueryService.name);

  constructor(
    private readonly invoiceRepository: InvoiceRepository,
    private readonly invoicePdfService: InvoicePdfService,
  ) {}

  async listInvoices(tenantId: string, filter?: { status?: string; fromDate?: Date; toDate?: Date; limit?: number }): Promise<PortalInvoiceSummary[]> {
    const invoices = await this.invoiceRepository.list({
      tenantId,
      status: filter?.status as any,
      fromDate: filter?.fromDate,
      toDate: filter?.toDate,
    } as any);

    const mapped = invoices.map((inv) => this.mapToSummary(inv));

    // Sort by issue date desc
    mapped.sort((a, b) => new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime());

    if (filter?.limit) {
      return mapped.slice(0, filter.limit);
    }

    return mapped;
  }

  async getInvoiceDetail(tenantId: string, invoiceId: string): Promise<PortalInvoiceSummary & { lines?: any[]; taxSummary?: any[]; paymentReference?: any }> {
    const invoice = await this.invoiceRepository.findById(invoiceId, tenantId);
    if (!invoice) {
      throw new Error('Invoice not found');
    }

    // Ensure tenant isolation
    if (invoice.tenantId !== tenantId) {
      throw new Error('Invoice not found');
    }

    const summary = this.mapToSummary(invoice);

    // Try to get detailed data via PDF service (which already handles tenant isolation)
    let lines: any[] | undefined;
    let taxSummary: any[] | undefined;
    let paymentReference: any | undefined;

    try {
      const pdfData = await this.invoicePdfService.generateInvoicePdfData(invoiceId, tenantId);
      lines = pdfData.lineItems as any;
      taxSummary = pdfData.taxSummary as any;
      paymentReference = pdfData.paymentReference;
    } catch {
      // Fallback: no detailed lines
    }

    return {
      ...summary,
      lines,
      taxSummary,
      paymentReference,
    };
  }

  async getInvoicePdfMetadata(tenantId: string, invoiceId: string): Promise<{ available: boolean; invoiceNumber: string; generatedAt?: string }> {
    const invoice = await this.invoiceRepository.findById(invoiceId, tenantId);
    if (!invoice) {
      throw new Error('Invoice not found');
    }

    if (invoice.tenantId !== tenantId) {
      throw new Error('Invoice not found');
    }

    // Check if invoice is finalized/paid - only those have PDF
    const pdfAvailableStatuses = ['FINALIZED', 'PAID', 'PARTIALLY_PAID', 'REFUNDED', 'PARTIALLY_REFUNDED', 'OPEN'];
    const available = pdfAvailableStatuses.includes(invoice.status);

    return {
      available,
      invoiceNumber: invoice.invoiceNumber,
      generatedAt: invoice.finalizedAt ? new Date(invoice.finalizedAt).toISOString() : undefined,
    };
  }

  private mapToSummary(invoice: any): PortalInvoiceSummary {
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      issueDate: invoice.issueDate ? new Date(invoice.issueDate).toISOString() : new Date().toISOString(),
      dueDate: invoice.dueDate ? new Date(invoice.dueDate).toISOString() : null,
      currency: invoice.currency,
      subtotal: invoice.subtotal,
      discountTotal: invoice.discountTotal,
      taxTotal: invoice.taxTotal,
      total: invoice.total,
      amountPaid: invoice.amountPaid,
      amountDue: invoice.amountDue,
      amountRefunded: invoice.amountRefunded,
      billingPeriodStart: invoice.billingPeriodStart ? new Date(invoice.billingPeriodStart).toISOString() : null,
      billingPeriodEnd: invoice.billingPeriodEnd ? new Date(invoice.billingPeriodEnd).toISOString() : null,
      planCode: invoice.planCode || null,
      planName: invoice.planName || null,
      pdfAvailable: ['FINALIZED', 'PAID', 'PARTIALLY_PAID', 'REFUNDED', 'PARTIALLY_REFUNDED', 'OPEN'].includes(invoice.status),
    };
  }
}
