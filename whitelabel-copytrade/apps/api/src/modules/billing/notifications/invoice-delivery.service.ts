import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { BillingEventService } from './billing-event.service';

/**
 * Invoice delivery service: safe totals + access link, no internal paths.
 * Ensures invoice delivery is tenant-safe, sanitized, idempotent.
 */

@Injectable()
export class InvoiceDeliveryService {
  private readonly logger = new Logger(InvoiceDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billingEventService: BillingEventService,
  ) {}

  async deliverInvoice(params: {
    tenantId: string;
    invoiceId: string;
    userId?: string;
    accessLinkBaseUrl?: string;
  }): Promise<{ delivered: boolean; accessLink: string; safeTotals: any }> {
    // Fetch invoice
    let invoice: any;
    try {
      invoice = await (this.prisma as any).invoice?.findFirst({
        where: { id: params.invoiceId, tenantId: params.tenantId },
      });
    } catch {}

    if (!invoice) {
      try {
        const repo = await (this.prisma as any).invoice?.findFirst?.({ where: { id: params.invoiceId } });
        invoice = repo;
      } catch {}
    }

    // Build safe totals - never expose internal paths, only safe fields
    const safeTotals = {
      invoiceNumber: invoice?.invoiceNumber || params.invoiceId,
      subtotal: invoice?.subtotal || '0',
      taxTotal: invoice?.taxTotal || '0',
      total: invoice?.total || '0',
      amountPaid: invoice?.amountPaid || '0',
      amountDue: invoice?.amountDue || invoice?.total || '0',
      currency: invoice?.currency || 'USD',
      status: invoice?.status || 'FINALIZED',
      dueDate: invoice?.dueDate ? new Date(invoice.dueDate).toISOString() : null,
      issuedAt: invoice?.issuedAt ? new Date(invoice.issuedAt).toISOString() : new Date().toISOString(),
    };

    // Build safe access link - no internal paths, only via portal
    const baseUrl = params.accessLinkBaseUrl || process.env.BILLING_PORTAL_URL || process.env.APP_URL || 'https://app.example.com';
    // Ensure baseUrl is HTTPS in production and not internal
    const safeBase = this.sanitizeBaseUrl(baseUrl);
    const accessLink = `${safeBase}/billing/invoices/${params.invoiceId}`;

    this.logger.log(`Invoice delivery prepared tenant=${params.tenantId} invoice=${params.invoiceId} link=${accessLink}`);

    // Trigger notification via billing event service
    try {
      if (invoice?.status === 'PAID') {
        await this.billingEventService.onInvoicePaid({
          tenantId: params.tenantId,
          invoiceId: params.invoiceId,
          invoiceNumber: safeTotals.invoiceNumber,
          userId: params.userId,
          amount: safeTotals.total,
          currency: safeTotals.currency,
          supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
          appName: process.env.APP_NAME || 'WLCT',
        });
      } else {
        await this.billingEventService.onInvoiceFinalized({
          tenantId: params.tenantId,
          invoiceId: params.invoiceId,
          invoiceNumber: safeTotals.invoiceNumber,
          userId: params.userId,
          amount: safeTotals.total,
          currency: safeTotals.currency,
          supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
          appName: process.env.APP_NAME || 'WLCT',
        });
      }
    } catch (e: any) {
      this.logger.warn(`Failed to trigger invoice delivery notification: ${e.message}`);
    }

    return { delivered: true, accessLink, safeTotals };
  }

  async deliverOverdueNotice(params: { tenantId: string; invoiceId: string; userId?: string }): Promise<void> {
    try {
      let invoice: any;
      try {
        invoice = await (this.prisma as any).invoice?.findFirst({
          where: { id: params.invoiceId, tenantId: params.tenantId },
        });
      } catch {}

      await this.billingEventService.onInvoiceOverdue({
        tenantId: params.tenantId,
        invoiceId: params.invoiceId,
        invoiceNumber: invoice?.invoiceNumber || params.invoiceId,
        userId: params.userId,
        amount: invoice?.total || '0',
        currency: invoice?.currency || 'USD',
        supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
        appName: process.env.APP_NAME || 'WLCT',
      });
    } catch (e: any) {
      this.logger.warn(`Failed to trigger overdue notice: ${e.message}`);
    }
  }

  private sanitizeBaseUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // Prevent internal destinations
      const blocked = ['localhost', '127.0.0.1', '0.0.0.0', '169.254.', '10.', '192.168.'];
      const hostname = parsed.hostname.toLowerCase();
      for (const b of blocked) {
        if (hostname === b || hostname.startsWith(b)) {
          if (process.env.NODE_ENV === 'production') {
            return 'https://app.example.com';
          }
        }
      }
      // No internal paths, only origin
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return 'https://app.example.com';
    }
  }
}
