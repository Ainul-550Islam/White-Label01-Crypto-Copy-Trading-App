import { Injectable, Logger } from '@nestjs/common';
import { PaymentService } from '../payments/payment.service';
import type { PortalPaymentSummary } from './billing-portal.types';

/**
 * Read-only tenant-scoped payment history and normalized payment status
 * using existing payment service/repository. No provider secrets.
 */
@Injectable()
export class BillingPaymentHistoryService {
  private readonly logger = new Logger(BillingPaymentHistoryService.name);

  constructor(private readonly paymentService: PaymentService) {}

  async listPayments(tenantId: string, filter?: { status?: string; provider?: string; fromDate?: Date; toDate?: Date; limit?: number }): Promise<PortalPaymentSummary[]> {
    const payments = await this.paymentService.listPaymentsByTenant(tenantId);

    let filtered = payments;

    if (filter?.status) {
      filtered = filtered.filter((p) => p.status === filter.status);
    }

    if (filter?.provider) {
      filtered = filtered.filter((p) => p.provider === filter.provider);
    }

    if (filter?.fromDate) {
      filtered = filtered.filter((p) => new Date(p.createdAt) >= filter.fromDate!);
    }

    if (filter?.toDate) {
      filtered = filtered.filter((p) => new Date(p.createdAt) <= filter.toDate!);
    }

    // Sort by created desc
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (filter?.limit) {
      filtered = filtered.slice(0, filter.limit);
    }

    return filtered.map((p) => this.mapToSummary(p));
  }

  async getPaymentDetail(tenantId: string, paymentId: string): Promise<PortalPaymentSummary & { safeMetadata?: any }> {
    const payment = await this.paymentService.getPaymentById(paymentId);

    // Tenant isolation
    if (payment.tenantId !== tenantId) {
      throw new Error('Payment not found');
    }

    const summary = this.mapToSummary(payment);

    // Safe metadata - exclude secrets
    const safeMetadata = this.extractSafeMetadata(payment);

    return {
      ...summary,
      safeMetadata,
    };
  }

  async getPaymentStatus(tenantId: string, paymentId: string): Promise<{ paymentId: string; status: string; provider: string; amount: string; currency: string; paidAt: string | null; verified: boolean }> {
    const payment = await this.paymentService.getPaymentById(paymentId);

    if (payment.tenantId !== tenantId) {
      throw new Error('Payment not found');
    }

    // Always verify from backend/provider state, never trust frontend
    let verifiedStatus = payment.status;
    let verified = false;

    try {
      const providerResult = await this.paymentService.retrieveProviderPayment(paymentId);
      verifiedStatus = providerResult.status;
      verified = true;
    } catch {
      // If provider retrieval fails, use internal state but mark unverified
      verified = false;
    }

    return {
      paymentId: payment.id,
      status: verifiedStatus,
      provider: payment.provider,
      amount: payment.amount,
      currency: payment.currency,
      paidAt: payment.paidAt ? payment.paidAt.toISOString() : null,
      verified,
    };
  }

  private mapToSummary(payment: any): PortalPaymentSummary {
    return {
      id: payment.id,
      provider: payment.provider,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      planId: payment.planId,
      planCode: payment.planCode || (payment.metadata as any)?.planCode || null,
      paidAt: payment.paidAt ? new Date(payment.paidAt).toISOString() : null,
      failedAt: payment.failedAt ? new Date(payment.failedAt).toISOString() : null,
      createdAt: new Date(payment.createdAt).toISOString(),
      checkoutUrl: payment.checkoutUrl || null,
      invoiceUrl: payment.invoiceUrl || null,
      hasInvoice: !!payment.invoiceId || !!(payment.metadata as any)?.invoiceId,
    };
  }

  private extractSafeMetadata(payment: any): any {
    // Only expose safe fields, never secrets
    const metadata = payment.metadata || {};
    const safeFields = ['planCode', 'planName', 'billingInterval', 'orderId', 'description', 'seats'];

    const safe: any = {};
    for (const field of safeFields) {
      if (metadata[field] !== undefined) {
        safe[field] = metadata[field];
      }
    }

    // Include safe references
    safe.orderId = payment.orderId || safe.orderId;
    safe.providerReference = payment.providerReference ? `${payment.providerReference.substring(0, 8)}...` : null;

    return safe;
  }
}
