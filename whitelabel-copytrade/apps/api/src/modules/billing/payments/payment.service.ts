import { Injectable, Logger, Optional, Inject, forwardRef } from '@nestjs/common';
import { PaymentRepository } from './payment.repository';
import { PaymentProviderFactory } from './payment-provider.factory';
import { PaymentEventsAuditService } from './payment-events.audit';
import {
  PaymentStatus,
  TransactionState,
  PaymentProvider,
  type PaymentRecord,
  type PaymentCreationInput,
  type PaymentUpdateInput,
  type NormalizedPaymentResult,
  isValidPaymentTransition,
} from './payment.types';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '@wlct/shared-types';
import { BillingEventService } from '../notifications/billing-event.service';

/**
 * Main payment orchestration service.
 *
 * Responsibilities:
 *  - Create checkout and attach payment to tenant/subscription
 *  - Retrieve payment status
 *  - Apply normalized payment state with valid state transition enforcement
 *  - Enforce valid state transitions (reject SUCCEEDED → CREATED etc)
 *  - Idempotent operations via idempotency keys
 *
 * Never stores raw card numbers, CVV, private keys, or payment secrets in logs.
 */

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly repository: PaymentRepository,
    private readonly providerFactory: PaymentProviderFactory,
    private readonly audit: PaymentEventsAuditService,
    @Optional()
    @Inject(forwardRef(() => BillingEventService))
    private readonly billingEventService?: BillingEventService,
  ) {}

  async createPayment(input: PaymentCreationInput): Promise<PaymentRecord> {
    // Idempotency check: if payment with same idempotency key exists, return it
    const existing = await this.repository.findByIdempotencyKey(input.idempotencyKey, input.tenantId);
    if (existing) {
      this.logger.log(`Idempotent payment creation: returning existing payment ${existing.id} for key ${input.idempotencyKey}`);
      await this.audit.logPaymentEvent({
        tenantId: input.tenantId,
        paymentId: existing.id,
        provider: existing.provider,
        action: 'PAYMENT_DUPLICATE',
        status: existing.status,
        planId: existing.planId,
        metadata: { idempotencyKey: input.idempotencyKey, existing: true },
      });
      return existing;
    }

    // Validate provider
    this.providerFactory.validateProvider(input.provider);

    // Create internal payment record
    const payment = await this.repository.create(input);

    await this.audit.logPaymentEvent({
      tenantId: payment.tenantId,
      paymentId: payment.id,
      provider: payment.provider,
      action: 'PAYMENT_CREATED',
      status: payment.status,
      planId: payment.planId,
      amount: payment.amount,
      currency: payment.currency,
      metadata: { idempotencyKey: payment.idempotencyKey, orderId: payment.orderId },
    });

    this.logger.log(`Payment created: ${payment.id} for tenant ${payment.tenantId}, plan ${payment.planId}, provider ${payment.provider}`);

    return payment;
  }

  async getPaymentById(paymentId: string): Promise<PaymentRecord> {
    const payment = await this.repository.findById(paymentId);
    if (!payment) {
      throw new AppException({
        code: ErrorCode.NOT_FOUND,
        message: 'Payment not found',
        context: { paymentId },
      });
    }
    return payment;
  }

  async getPaymentByIdempotencyKey(idempotencyKey: string, tenantId: string): Promise<PaymentRecord | null> {
    return this.repository.findByIdempotencyKey(idempotencyKey, tenantId);
  }

  async getPaymentByProviderId(providerPaymentId: string, provider: PaymentProvider): Promise<PaymentRecord | null> {
    return this.repository.findByProviderPaymentId(providerPaymentId, provider);
  }

  async getPaymentByCheckoutId(providerCheckoutId: string, provider: PaymentProvider): Promise<PaymentRecord | null> {
    return this.repository.findByProviderCheckoutId(providerCheckoutId, provider);
  }

  async getPaymentByOrderId(orderId: string): Promise<PaymentRecord | null> {
    return this.repository.findByOrderId(orderId);
  }

  async listPaymentsByTenant(tenantId: string): Promise<PaymentRecord[]> {
    return this.repository.list({ tenantId });
  }

  async retrieveProviderPayment(paymentId: string): Promise<NormalizedPaymentResult> {
    const internalPayment = await this.getPaymentById(paymentId);
    const provider = this.providerFactory.getProvider(internalPayment.provider);

    const providerResult = await provider.retrievePayment({
      providerPaymentId: internalPayment.providerPaymentId || undefined,
      providerCheckoutId: internalPayment.providerCheckoutId || undefined,
      providerSessionId: internalPayment.providerSessionId || undefined,
      providerInvoiceId: internalPayment.providerInvoiceId || undefined,
    });

    return providerResult;
  }

  async updatePaymentStatus(paymentId: string, newStatus: PaymentStatus, additionalData?: Partial<PaymentUpdateInput>): Promise<PaymentRecord> {
    const currentPayment = await this.getPaymentById(paymentId);

    // Validate state transition
    if (!isValidPaymentTransition(currentPayment.status, newStatus)) {
      this.logger.warn(`Invalid payment state transition rejected: ${currentPayment.status} → ${newStatus} for payment ${paymentId}`);
      await this.audit.logPaymentEvent({
        tenantId: currentPayment.tenantId,
        paymentId: currentPayment.id,
        provider: currentPayment.provider,
        action: 'PAYMENT_TRANSITION_REJECTED',
        status: currentPayment.status,
        planId: currentPayment.planId,
        metadata: { attemptedStatus: newStatus, currentStatus: currentPayment.status },
      });
      throw new AppException({
        code: ErrorCode.VALIDATION_ERROR,
        message: `Invalid payment state transition: ${currentPayment.status} → ${newStatus}`,
        context: { paymentId, from: currentPayment.status, to: newStatus },
      });
    }

    const updated = await this.repository.updateStatus(paymentId, newStatus, additionalData);

    await this.audit.logPaymentEvent({
      tenantId: updated.tenantId,
      paymentId: updated.id,
      provider: updated.provider,
      action: this.mapStatusToAuditAction(newStatus),
      status: updated.status,
      planId: updated.planId,
      amount: updated.amount,
      currency: updated.currency,
      metadata: { previousStatus: currentPayment.status, newStatus },
    });

    this.logger.log(`Payment ${paymentId} status updated: ${currentPayment.status} → ${newStatus}`);

    // Trigger billing notification (non-blocking, never fails business operation)
    this.triggerBillingEvent(updated, newStatus).catch((e) => this.logger.warn(`Failed to trigger billing notification for payment ${paymentId}: ${e.message}`));

    return updated;
  }

  private async triggerBillingEvent(payment: PaymentRecord, status: PaymentStatus): Promise<void> {
    if (!this.billingEventService) return;
    try {
      const baseParams = {
        tenantId: payment.tenantId,
        paymentId: payment.id,
        amount: payment.amount?.toString() || '0',
        currency: payment.currency || 'USD',
        paymentStatus: status,
        supportEmail: process.env.SUPPORT_EMAIL || 'support@example.com',
        appName: process.env.APP_NAME || 'WLCT',
      };

      switch (status) {
        case PaymentStatus.SUCCEEDED:
          await this.billingEventService.onPaymentSucceeded({ ...baseParams, planName: (payment as any).planName, planCode: (payment as any).planCode });
          break;
        case PaymentStatus.FAILED:
          await this.billingEventService.onPaymentFailed({ ...baseParams, planName: (payment as any).planName });
          break;
        case PaymentStatus.PENDING:
        case PaymentStatus.PROCESSING:
          await this.billingEventService.onPaymentPending({ ...baseParams, planName: (payment as any).planName });
          break;
        default:
          break;
      }
    } catch (e) {
      // Never throw - notification failure must not affect payment
      this.logger.warn(`Billing event trigger failed for payment ${payment.id}: ${(e as Error).message}`);
    }
  }

  async applyProviderResult(paymentId: string, providerResult: NormalizedPaymentResult): Promise<PaymentRecord> {
    const currentPayment = await this.getPaymentById(paymentId);

    // Validate transition from provider result
    if (!isValidPaymentTransition(currentPayment.status, providerResult.status)) {
      this.logger.warn(`Provider result transition rejected: ${currentPayment.status} → ${providerResult.status} for payment ${paymentId}`);
      // Do not apply invalid transition, but log and return current
      await this.audit.logPaymentEvent({
        tenantId: currentPayment.tenantId,
        paymentId: currentPayment.id,
        provider: currentPayment.provider,
        action: 'PAYMENT_TRANSITION_REJECTED',
        status: currentPayment.status,
        planId: currentPayment.planId,
        metadata: {
          attemptedStatus: providerResult.status,
          currentStatus: currentPayment.status,
          providerStatus: providerResult.rawProviderStatus,
        },
      });
      return currentPayment;
    }

    const updateInput: PaymentUpdateInput = {
      status: providerResult.status,
      transactionState: providerResult.transactionState,
      providerReference: providerResult.providerReference,
      rawProviderStatus: providerResult.rawProviderStatus,
      failureReason: providerResult.failureReason || undefined,
      failureCode: providerResult.failureCode || undefined,
    };

    if (providerResult.paidAt) {
      updateInput.paidAt = new Date(providerResult.paidAt);
    }
    if (providerResult.failedAt) {
      updateInput.failedAt = new Date(providerResult.failedAt);
    }

    const updated = await this.repository.update(paymentId, updateInput);

    await this.audit.logPaymentEvent({
      tenantId: updated.tenantId,
      paymentId: updated.id,
      provider: updated.provider,
      action: this.mapStatusToAuditAction(providerResult.status),
      status: updated.status,
      planId: updated.planId,
      amount: updated.amount,
      currency: updated.currency,
      metadata: {
        previousStatus: currentPayment.status,
        newStatus: providerResult.status,
        providerStatus: providerResult.rawProviderStatus,
      },
    });

    this.triggerBillingEvent(updated, providerResult.status as any).catch((e) => this.logger.warn(`Failed to trigger billing notification for provider result payment ${paymentId}: ${e.message}`));

    return updated;
  }

  async markPaymentSucceeded(paymentId: string, providerReference?: any): Promise<PaymentRecord> {
    return this.updatePaymentStatus(paymentId, PaymentStatus.SUCCEEDED, {
      providerReference,
      paidAt: new Date(),
    });
  }

  async markPaymentFailed(paymentId: string, reason?: string, code?: string): Promise<PaymentRecord> {
    return this.updatePaymentStatus(paymentId, PaymentStatus.FAILED, {
      failureReason: reason,
      failureCode: code,
      failedAt: new Date(),
    });
  }

  async markPaymentCancelled(paymentId: string, reason?: string): Promise<PaymentRecord> {
    return this.updatePaymentStatus(paymentId, PaymentStatus.CANCELLED, {
      failureReason: reason,
      cancelledAt: new Date(),
    });
  }

  async markPaymentExpired(paymentId: string): Promise<PaymentRecord> {
    return this.updatePaymentStatus(paymentId, PaymentStatus.EXPIRED);
  }

  async markPaymentRefunded(paymentId: string, isPartial = false): Promise<PaymentRecord> {
    const status = isPartial ? PaymentStatus.PARTIALLY_REFUNDED : PaymentStatus.REFUNDED;
    return this.updatePaymentStatus(paymentId, status, {
      refundedAt: new Date(),
    });
  }

  private mapStatusToAuditAction(status: PaymentStatus): any {
    switch (status) {
      case PaymentStatus.CREATED:
        return 'PAYMENT_CREATED';
      case PaymentStatus.PENDING:
        return 'PAYMENT_PENDING';
      case PaymentStatus.PROCESSING:
        return 'PAYMENT_PENDING';
      case PaymentStatus.SUCCEEDED:
        return 'PAYMENT_SUCCEEDED';
      case PaymentStatus.FAILED:
        return 'PAYMENT_FAILED';
      case PaymentStatus.CANCELLED:
        return 'PAYMENT_CANCELLED';
      case PaymentStatus.EXPIRED:
        return 'PAYMENT_EXPIRED';
      case PaymentStatus.REFUNDED:
      case PaymentStatus.PARTIALLY_REFUNDED:
        return 'PAYMENT_REFUNDED';
      default:
        return 'PAYMENT_PENDING';
    }
  }
}
