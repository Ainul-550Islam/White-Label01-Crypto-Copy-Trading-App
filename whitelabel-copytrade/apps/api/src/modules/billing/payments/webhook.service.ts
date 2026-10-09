import { Injectable, Logger } from '@nestjs/common';
import { WebhookSignatureService } from './webhook.signature';
import { WebhookReplayGuard } from './webhook.replay-guard';
import { PaymentService } from './payment.service';
import { PaymentProviderFactory } from './payment-provider.factory';
import { PaymentSubscriptionSyncService } from './payment-subscription-sync.service';
import { PaymentEventsAuditService } from './payment-events.audit';
import { PaymentProvider, PaymentStatus } from './payment.types';
import { stripeMinorUnitsToDecimalString } from './stripe.adapter';
import type { WebhookPayload, WebhookProcessingResult, NormalizedWebhookEvent } from './webhook.types';
import { WebhookEventCategory, WebhookProcessingStatus } from './webhook.types';
import { normalizePaymentWebhookPayload } from '../../providers/adapters/payment.adapter';
import type { NormalizedPaymentWebhookEvent } from '../../providers/adapters/payment.adapter';
import { Decimal } from '../../../common/decimal-string';
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
        providerCreatedAt: null,
      } as NormalizedWebhookEvent,
      rawEvent,
      payload.signature,
    );

    // Step 3: Normalize only after signature verification has succeeded.
    let normalizedEvent: NormalizedWebhookEvent;
    let canonicalPaymentEvent: NormalizedPaymentWebhookEvent | undefined;
    try {
      canonicalPaymentEvent = normalizeVerifiedPaymentEvent(provider, rawEvent);
      if (canonicalPaymentEvent && canonicalPaymentEvent.occurredAtIso === null) {
        throw new TypeError('Verified payment event is missing provider timestamp; state update withheld');
      }
      const providerAdapter = this.providerFactory.getProvider(provider);
      normalizedEvent = await providerAdapter.normalizeWebhookEvent({
        rawEvent,
        provider,
      });
      if (canonicalPaymentEvent) {
        normalizedEvent = applyCanonicalPaymentEvent(normalizedEvent, canonicalPaymentEvent);
      }

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
      if (canonicalPaymentEvent?.status === 'UNKNOWN') {
        throw new AppException({
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Unrecognized provider payment status; payment state update withheld',
          context: { provider, providerEventId },
        });
      }

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

      // A provider-confirmed checkout must match the canonical internal amount and currency exactly.
      // The provider amount is evidence only; the internal record remains the amount applied downstream.
      if (
        canonicalPaymentEvent?.status === 'CONFIRMED' &&
        !matchesExpectedPaymentAmount(payment.amount, payment.currency, canonicalPaymentEvent)
      ) {
        throw new AppException({
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Provider-confirmed payment amount or currency does not match the internal payment record',
          context: { provider, providerEventId, paymentId: payment.id },
        });
      }

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

const STRIPE_PAYMENT_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'checkout.session.expired',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'payment_intent.created',
  'payment_intent.processing',
  'payment_intent.requires_action',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'charge.succeeded',
  'charge.failed',
  'charge.refunded',
  'invoice.paid',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function requireExternalPaymentId(value: unknown): string {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  throw new TypeError('Verified payment event is missing a valid external payment id');
}

function readExternalReference(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    if (value.trim() === '') throw new TypeError('Stripe payment reference must not be empty');
    return value.trim();
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError('Stripe numeric payment reference must be a positive safe integer');
    }
    return String(value);
  }
  if (isRecord(value)) return requireExternalPaymentId(value.id);
  throw new TypeError('Stripe payment reference has an unsupported type');
}

function normalizeVerifiedPaymentEvent(
  provider: PaymentProvider,
  rawEvent: unknown,
): NormalizedPaymentWebhookEvent | undefined {
  if (provider === PaymentProvider.NOWPAYMENTS) {
    if (!isRecord(rawEvent)) throw new TypeError('Verified NOWPayments event must be an object');
    return normalizePaymentWebhookPayload({
      provider: 'NOWPAYMENTS',
      id: requireExternalPaymentId(rawEvent.payment_id ?? rawEvent.id),
      status: rawEvent.payment_status as string,
      amount: rawEvent.price_amount as string,
      currency: rawEvent.price_currency as string,
      confirmations: (rawEvent.confirmations ?? null) as number | null,
      timestamp: (rawEvent.created_at ?? rawEvent.timestamp ?? null) as string | null,
    });
  }

  if (provider !== PaymentProvider.STRIPE || !isRecord(rawEvent)) return undefined;
  const eventType = readNonEmptyString(rawEvent.type);
  if (!eventType || !STRIPE_PAYMENT_EVENT_TYPES.has(eventType)) return undefined;

  const data = isRecord(rawEvent.data) ? rawEvent.data : undefined;
  const object = data && isRecord(data.object) ? data.object : undefined;
  if (!object) throw new TypeError('Verified Stripe payment event is missing its data object');

  const paymentReference = readExternalReference(object.payment_intent) ?? readExternalReference(object.id);
  if (!paymentReference) throw new TypeError('Verified Stripe payment event is missing its payment reference');
  const currency = object.currency as string;
  const amount = stripeMinorUnitsToDecimalString(stripeMinorAmount(eventType, object), currency);
  const status = stripePaymentStatus(eventType, object);
  const timestamp = stripeTimestamp(rawEvent.created);
  const confirmations = object.confirmations ?? null;

  return normalizePaymentWebhookPayload({
    provider: 'STRIPE',
    id: paymentReference,
    status,
    amount,
    currency,
    confirmations: confirmations as number | null,
    timestamp,
  });
}

function stripePaymentStatus(eventType: string, object: Record<string, unknown>): string {
  if (eventType === 'checkout.session.completed') {
    const paymentStatus = readNonEmptyString(object.payment_status);
    if (!paymentStatus) throw new TypeError('Completed Stripe checkout event is missing payment_status');
    return paymentStatus;
  }

  const eventStatuses: Record<string, string> = {
    'checkout.session.expired': 'expired',
    'checkout.session.async_payment_succeeded': 'succeeded',
    'checkout.session.async_payment_failed': 'failed',
    'payment_intent.succeeded': 'succeeded',
    'payment_intent.payment_failed': 'failed',
    'payment_intent.canceled': 'cancelled',
    'charge.succeeded': 'succeeded',
    'charge.failed': 'failed',
    'charge.refunded': 'refunded',
    'invoice.paid': 'paid',
    'invoice.payment_succeeded': 'paid',
    'invoice.payment_failed': 'failed',
  };
  const eventStatus = eventStatuses[eventType];
  if (eventStatus) return eventStatus;

  const objectStatus = readNonEmptyString(object.status) ?? readNonEmptyString(object.payment_status);
  if (!objectStatus) throw new TypeError(`Stripe ${eventType} event is missing a payment status`);
  return objectStatus;
}

function stripeMinorAmount(eventType: string, object: Record<string, unknown>): unknown {
  if (eventType.startsWith('checkout.session.')) return object.amount_total;
  if (eventType.startsWith('payment_intent.')) {
    if (eventType === 'payment_intent.succeeded') return object.amount_received ?? object.amount;
    return object.amount;
  }
  if (eventType === 'charge.refunded') return object.amount_refunded;
  if (eventType.startsWith('charge.')) return object.amount;
  if (eventType === 'invoice.paid' || eventType === 'invoice.payment_succeeded') {
    return object.amount_paid ?? object.total;
  }
  if (eventType === 'invoice.payment_failed') return object.amount_due ?? object.total;
  return undefined;
}

function stripeTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Stripe event timestamp must be a non-negative safe integer in Unix seconds');
  }
  const milliseconds = value * 1000;
  if (!Number.isSafeInteger(milliseconds)) throw new TypeError('Stripe event timestamp is outside the supported range');
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) throw new TypeError('Stripe event timestamp is invalid');
  return date.toISOString();
}

function applyCanonicalPaymentEvent(
  event: NormalizedWebhookEvent,
  canonical: NormalizedPaymentWebhookEvent,
): NormalizedWebhookEvent {
  const paymentStatus = mapCanonicalPaymentStatus(canonical.status, event.paymentStatus);
  const eventCategory = mapCanonicalEventCategory(canonical.status);
  return {
    ...event,
    eventCategory,
    paymentStatus,
    providerPaymentId: canonical.externalPaymentId || event.providerPaymentId,
    amount: { amount: canonical.amount, currency: canonical.currency },
    metadata: {
      ...event.metadata,
      canonicalPaymentStatus: canonical.status,
      paymentConfirmations: canonical.confirmations,
      paymentOccurredAtIso: canonical.occurredAtIso,
    },
    providerCreatedAt: canonical.occurredAtIso === null ? null : new Date(canonical.occurredAtIso),
  };
}

function mapCanonicalPaymentStatus(
  canonicalStatus: NormalizedPaymentWebhookEvent['status'],
  providerAdapterStatus: PaymentStatus,
): PaymentStatus {
  switch (canonicalStatus) {
    case 'CONFIRMED':
      return PaymentStatus.SUCCEEDED;
    case 'PENDING':
      return providerAdapterStatus === PaymentStatus.PROCESSING
        ? PaymentStatus.PROCESSING
        : PaymentStatus.PENDING;
    case 'FAILED':
      return providerAdapterStatus === PaymentStatus.CANCELLED || providerAdapterStatus === PaymentStatus.EXPIRED
        ? providerAdapterStatus
        : PaymentStatus.FAILED;
    case 'REFUNDED':
      return providerAdapterStatus === PaymentStatus.PARTIALLY_REFUNDED
        ? PaymentStatus.PARTIALLY_REFUNDED
        : PaymentStatus.REFUNDED;
    case 'UNKNOWN':
      return PaymentStatus.UNKNOWN;
  }
}

function mapCanonicalEventCategory(
  canonicalStatus: NormalizedPaymentWebhookEvent['status'],
): WebhookEventCategory {
  switch (canonicalStatus) {
    case 'CONFIRMED':
      return WebhookEventCategory.PAYMENT_SUCCEEDED;
    case 'PENDING':
      return WebhookEventCategory.PAYMENT_PENDING;
    case 'FAILED':
      return WebhookEventCategory.PAYMENT_FAILED;
    case 'REFUNDED':
      return WebhookEventCategory.PAYMENT_REFUNDED;
    case 'UNKNOWN':
      return WebhookEventCategory.UNKNOWN;
  }
}

function matchesExpectedPaymentAmount(
  expectedAmount: unknown,
  expectedCurrency: unknown,
  canonicalEvent: NormalizedPaymentWebhookEvent,
): boolean {
  if (typeof expectedAmount !== 'string' || typeof expectedCurrency !== 'string') return false;
  try {
    return Decimal.parse(expectedAmount).eq(Decimal.parse(canonicalEvent.amount)) &&
      expectedCurrency.trim().toUpperCase() === canonicalEvent.currency;
  } catch {
    return false;
  }
}
