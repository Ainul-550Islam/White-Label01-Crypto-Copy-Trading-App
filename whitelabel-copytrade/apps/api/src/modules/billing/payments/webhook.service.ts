import { Injectable, Logger } from '@nestjs/common';
import { WebhookSignatureService } from './webhook.signature';
import { WebhookReplayGuard } from './webhook.replay-guard';
import { PaymentService } from './payment.service';
import { PaymentProviderFactory } from './payment-provider.factory';
import { PaymentSubscriptionSyncService } from './payment-subscription-sync.service';
import { PaymentEventsAuditService } from './payment-events.audit';
import { PaymentProvider } from './payment.types';
import type { WebhookPayload, WebhookProcessingResult, NormalizedWebhookEvent } from './webhook.types';
import { WebhookProcessingStatus } from './webhook.types';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '@wlct/shared-types';

/**
 * Validates, normalizes, deduplicates, and dispatches provider webhooks
 * into payment/subscription state transitions.
 *
 * Flow:
 *  raw body → signature verification → event ID extraction
 *  → replay/idempotency check → event normalization
 *  → state validation → payment update → subscription synchronization
 *
 * Must be idempotent and replay-safe.
 */

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly signatureService: WebhookSignatureService,
    private readonly replayGuard: WebhookReplayGuard,
    private readonly paymentService: PaymentService,
    private readonly providerFactory: PaymentProviderFactory,
    private readonly subscriptionSync: PaymentSubscriptionSyncService,
    private readonly audit: PaymentEventsAuditService,
  ) {}

  async processWebhook(payload: WebhookPayload): Promise<WebhookProcessingResult> {
    const provider = payload.provider;
    const startTime = Date.now();

    this.logger.log(`Webhook received: provider=${provider}, signaturePresent=${!!payload.signature}`);

    // Step 1: Verify signature - DO NOT process unverified payloads
    const verificationResult = await this.signatureService.verifySignature(payload);

    if (!verificationResult.verified) {
      this.logger.warn(`Webhook signature verification failed for ${provider}: ${verificationResult.failureReason}`);

      await this.audit.logWebhookEvent({
        provider,
        providerEventId: verificationResult.providerEventId || 'unknown',
        action: 'WEBHOOK_REJECTED',
        result: 'REJECTED',
        error: verificationResult.failureReason,
        metadata: { reason: 'signature_verification_failed' },
      });

      await this.replayGuard.markEventRejected(provider, verificationResult.providerEventId || 'unknown', verificationResult.failureReason || 'Signature verification failed');

      throw new AppException({
        code: ErrorCode.UNAUTHORIZED,
        message: 'Webhook signature verification failed',
        context: { provider, reason: verificationResult.failureReason },
      });
    }

    const providerEventId = verificationResult.providerEventId!;
    const rawEvent = verificationResult.rawEvent;

    await this.audit.logWebhookEvent({
      provider,
      providerEventId,
      action: 'WEBHOOK_RECEIVED',
      result: 'RECEIVED',
      eventType: verificationResult.eventType,
    });

    // Step 2: Record event received
    const eventRecord = await this.replayGuard.recordEventReceived(
      {
        provider,
        providerEventId,
        eventType: verificationResult.eventType || 'unknown',
        eventCategory: 'UNKNOWN' as any,
        paymentStatus: 'UNKNOWN' as any,
        receivedAt: new Date(),
        providerCreatedAt: new Date(),
      } as NormalizedWebhookEvent,
      rawEvent,
      payload.signature,
    );

    // Step 3: Normalize event via provider adapter
    let normalizedEvent: NormalizedWebhookEvent;
    try {
      const providerAdapter = this.providerFactory.getProvider(provider);
      normalizedEvent = await providerAdapter.normalizeWebhookEvent({
        rawEvent,
        provider,
      });

      await this.replayGuard.markEventVerified(provider, providerEventId);
    } catch (error) {
      this.logger.error(`Webhook event normalization failed for ${provider}:${providerEventId}: ${(error as Error).message}`);

      await this.replayGuard.markEventFailed(provider, providerEventId, (error as Error).message);

      await this.audit.logWebhookEvent({
        provider,
        providerEventId,
        action: 'WEBHOOK_REJECTED',
        result: 'FAILED',
        error: (error as Error).message,
        metadata: { stage: 'normalization' },
      });

      throw new AppException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Failed to normalize webhook event',
        context: { provider, providerEventId },
      });
    }

    // Step 4: Replay/idempotency check - same event must not apply transition twice
    const replayCheck = await this.replayGuard.checkReplay(normalizedEvent);

    if (!replayCheck.shouldProcess) {
      if (replayCheck.isDuplicate || replayCheck.isReplay) {
        this.logger.log(`Webhook duplicate/replay rejected: ${provider}:${providerEventId} - ${replayCheck.reason}`);

        await this.replayGuard.markEventDuplicate(provider, providerEventId);

        await this.audit.logWebhookEvent({
          provider,
          providerEventId,
          action: 'WEBHOOK_DUPLICATE',
          result: 'DUPLICATE',
          eventType: normalizedEvent.eventType,
          metadata: { reason: replayCheck.reason },
        });

        return {
          success: true,
          eventId: eventRecord.id,
          providerEventId,
          processingStatus: WebhookProcessingStatus.DUPLICATE,
          isDuplicate: true,
          isReplay: replayCheck.isReplay,
        };
      }

      // Rejected for other reason (too old, etc)
      this.logger.warn(`Webhook rejected: ${provider}:${providerEventId} - ${replayCheck.reason}`);

      await this.audit.logWebhookEvent({
        provider,
        providerEventId,
        action: 'WEBHOOK_REJECTED',
        result: 'REJECTED',
        eventType: normalizedEvent.eventType,
        metadata: { reason: replayCheck.reason },
      });

      return {
        success: false,
        eventId: eventRecord.id,
        providerEventId,
        processingStatus: WebhookProcessingStatus.REJECTED,
        error: replayCheck.reason,
      };
    }

    // Step 5: Mark as processing
    await this.replayGuard.markEventProcessing(provider, providerEventId);

    // Step 6: Find internal payment record
    let internalPaymentId: string | undefined = undefined;
    let tenantId: string | undefined = undefined;

    try {
      const payment = await this.findInternalPayment(normalizedEvent);

      if (!payment) {
        this.logger.warn(`No internal payment found for webhook ${provider}:${providerEventId}, paymentId ${normalizedEvent.providerPaymentId}`);

        // For checkout.session.completed events, we might need to find by checkout ID
        // If still not found, we log and mark as processed but without sync
        await this.replayGuard.markEventProcessed(provider, providerEventId);

        await this.audit.logWebhookEvent({
          provider,
          providerEventId,
          action: 'WEBHOOK_PROCESSED',
          result: 'PROCESSED_NO_PAYMENT',
          eventType: normalizedEvent.eventType,
          metadata: { reason: 'no_internal_payment_found' },
        });

        return {
          success: true,
          eventId: eventRecord.id,
          providerEventId,
          processingStatus: WebhookProcessingStatus.PROCESSED,
        };
      }

      internalPaymentId = payment.id;
      tenantId = payment.tenantId;

      // Step 7: Apply normalized payment state with valid transition check
      const updatedPayment = await this.paymentService.applyProviderResult(payment.id, {
        internalPaymentId: payment.id,
        provider,
        status: normalizedEvent.paymentStatus,
        transactionState: this.mapPaymentStatusToTransactionState(normalizedEvent.paymentStatus),
        amount: payment.amount as any,
        providerReference: {
          provider,
          providerPaymentId: normalizedEvent.providerPaymentId || payment.providerPaymentId || '',
          providerCheckoutId: normalizedEvent.providerCheckoutId || payment.providerCheckoutId || undefined,
          providerSessionId: normalizedEvent.providerSessionId || payment.providerSessionId || undefined,
          providerInvoiceId: normalizedEvent.providerInvoiceId || payment.providerInvoiceId || undefined,
        },
        references: {
          tenantId: payment.tenantId,
          planId: payment.planId,
          subscriptionId: payment.subscriptionId || undefined,
          userId: payment.userId || undefined,
          idempotencyKey: payment.idempotencyKey,
          orderId: payment.orderId || undefined,
        },
        metadata: {
          planCode: payment.planCode || undefined,
          planName: payment.planName || undefined,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        rawProviderStatus: normalizedEvent.eventType,
      } as any);

      // Step 8: Synchronize into TenantSubscription lifecycle
      try {
        await this.subscriptionSync.syncPaymentToSubscription(updatedPayment);

        this.logger.log(`Payment ${payment.id} synced to subscription, new status ${updatedPayment.status}`);
      } catch (syncError) {
        this.logger.error(`Subscription sync failed for payment ${payment.id}: ${(syncError as Error).message}`);
        // Don't fail webhook processing if sync fails - payment is still updated
        // Sync can be retried via reconciliation
      }

      // Step 9: Mark as processed
      await this.replayGuard.markEventProcessed(provider, providerEventId, internalPaymentId, tenantId);

      await this.audit.logWebhookEvent({
        provider,
        providerEventId,
        action: 'WEBHOOK_PROCESSED',
        result: 'PROCESSED',
        eventType: normalizedEvent.eventType,
        paymentId: internalPaymentId,
        tenantId: tenantId,
        status: normalizedEvent.paymentStatus,
        metadata: {
          providerPaymentId: normalizedEvent.providerPaymentId,
          processingTimeMs: Date.now() - startTime,
        },
      });

      this.logger.log(`Webhook processed successfully: ${provider}:${providerEventId} → payment ${internalPaymentId} status ${normalizedEvent.paymentStatus}`);

      return {
        success: true,
        eventId: eventRecord.id,
        providerEventId,
        processingStatus: WebhookProcessingStatus.PROCESSED,
        paymentId: internalPaymentId,
        tenantId: tenantId,
        newPaymentStatus: normalizedEvent.paymentStatus,
      };
    } catch (error) {
      this.logger.error(`Webhook processing failed for ${provider}:${providerEventId}: ${(error as Error).message}`);

      await this.replayGuard.markEventFailed(provider, providerEventId, (error as Error).message);

      await this.audit.logWebhookEvent({
        provider,
        providerEventId,
        action: 'WEBHOOK_REJECTED',
        result: 'FAILED',
        eventType: normalizedEvent.eventType,
        paymentId: internalPaymentId,
        tenantId: tenantId,
        error: (error as Error).message,
        metadata: { stage: 'processing', processingTimeMs: Date.now() - startTime },
      });

      if (error instanceof AppException) {
        throw error;
      }

      throw new AppException({
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        message: 'Webhook processing failed',
        context: { provider, providerEventId },
      });
    }
  }

  private async findInternalPayment(event: NormalizedWebhookEvent): Promise<any | null> {
    // Try to find by provider payment ID
    if (event.providerPaymentId) {
      const byPaymentId = await this.paymentService.getPaymentByProviderId(event.providerPaymentId, event.provider);
      if (byPaymentId) return byPaymentId;
    }

    // Try by checkout ID
    if (event.providerCheckoutId) {
      const byCheckoutId = await this.paymentService.getPaymentByCheckoutId(event.providerCheckoutId, event.provider);
      if (byCheckoutId) return byCheckoutId;
    }

    // Try by order ID from metadata
    if (event.metadata?.orderId) {
      const byOrderId = await this.paymentService.getPaymentByOrderId(event.metadata.orderId);
      if (byOrderId) return byOrderId;
    }

    // Try by idempotency key from metadata
    if (event.metadata?.idempotencyKey && event.metadata?.tenantId) {
      const byIdempotency = await this.paymentService.getPaymentByIdempotencyKey(event.metadata.idempotencyKey, event.metadata.tenantId);
      if (byIdempotency) return byIdempotency;
    }

    return null;
  }

  private mapPaymentStatusToTransactionState(status: any): any {
    // Simplified mapping
    switch (status) {
      case 'SUCCEEDED':
        return 'CAPTURED';
      case 'PENDING':
      case 'PROCESSING':
        return 'AUTHORIZED';
      case 'FAILED':
      case 'EXPIRED':
        return 'FAILED';
      case 'CANCELLED':
        return 'VOIDED';
      case 'REFUNDED':
      case 'PARTIALLY_REFUNDED':
        return 'REFUNDED';
      default:
        return 'INITIALIZED';
    }
  }
}
