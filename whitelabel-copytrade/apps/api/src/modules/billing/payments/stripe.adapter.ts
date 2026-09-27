import { Injectable, Logger } from '@nestjs/common';
import { PaymentProvider, PaymentStatus, TransactionState, PaymentMethodType } from './payment.types';
import type {
  IPaymentProvider,
  CreateCheckoutInput,
  CreateCheckoutResult,
  RetrievePaymentInput,
  VerifyWebhookInput,
  VerifyWebhookResult,
  NormalizeEventInput,
  ProviderCapabilities,
} from './payment-provider.interface';
import type { NormalizedPaymentResult, PaymentAmount, PaymentMetadata, PaymentReferences } from './payment.types';
import type { NormalizedWebhookEvent, WebhookEventCategory } from './webhook.types';
import { PaymentConfigService } from './payment.config';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '@wlct/shared-types';

/**
 * Real Stripe integration adapter.
 *
 * Implements the common provider contract for Stripe:
 *  - Checkout/session creation using canonical plan price from billing catalog
 *  - Payment state retrieval
 *  - Webhook signature verification using Stripe's official method
 *  - Event normalization into internal payment states
 *  - Status mapping
 *
 * Never stores raw card numbers, CVV, or secrets in logs.
 * Never exposes provider secrets through API responses.
 */

@Injectable()
export class StripeAdapter implements IPaymentProvider {
  private readonly logger = new Logger(StripeAdapter.name);
  readonly provider = PaymentProvider.STRIPE;

  readonly capabilities: ProviderCapabilities = {
    supportsCheckout: true,
    supportsPaymentIntents: true,
    supportsRefunds: true,
    supportsPartialRefunds: true,
    supportsWebhooks: true,
    supportsRecurring: true,
    supportsCrypto: false,
    supportedCurrencies: ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'],
  };

  constructor(private readonly config: PaymentConfigService) {}

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    this.validateCheckoutInput(input);

    const stripeSecretKey = this.config.getStripeSecretKey();

    // Use dynamic import to avoid hard dependency if stripe not installed
    // In production, stripe SDK should be installed: npm install stripe
    let stripe: any;
    try {
      const Stripe = await this.loadStripeSdk();
      stripe = new Stripe(stripeSecretKey, {
        apiVersion: this.config.stripe?.apiVersion || '2023-10-16',
        maxNetworkRetries: this.config.stripe?.maxNetworkRetries || 2,
        timeout: this.config.stripe?.timeoutMs || 30000,
      });
    } catch (error) {
      this.logger.error(`Failed to load Stripe SDK: ${(error as Error).message}`);
      throw new AppException({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'Stripe SDK not available',
      });
    }

    try {
      // Price must come from canonical billing plan catalog, never hardcoded
      // input.price is already resolved from SubscriptionPlan.price
      const amountInCents = this.parseAmountToCents(input.price, input.currency);

      const sessionParams: any = {
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: input.currency.toLowerCase(),
              product_data: {
                name: input.planName,
                description: `Subscription to ${input.planName} - ${input.interval}`,
                metadata: {
                  planId: input.planId,
                  planCode: input.planCode,
                  tenantId: input.tenantId,
                },
              },
              unit_amount: amountInCents,
              recurring: input.interval !== 'LIFETIME' ? {
                interval: this.mapIntervalToStripeInterval(input.interval),
              } : undefined,
            },
            quantity: 1,
          },
        ],
        mode: input.interval === 'LIFETIME' ? 'payment' : 'subscription',
        success_url: this.buildSuccessUrl(input.successUrl, '{CHECKOUT_SESSION_ID}'),
        cancel_url: input.cancelUrl,
        client_reference_id: input.references.orderId || input.idempotencyKey,
        metadata: {
          tenantId: input.tenantId,
          planId: input.planId,
          planCode: input.planCode,
          subscriptionId: input.subscriptionId || '',
          userId: input.userId || '',
          idempotencyKey: input.idempotencyKey,
          orderId: input.references.orderId || '',
        },
        customer_email: undefined,
        expires_at: Math.floor(Date.now() / 1000) + this.config.checkout.expirationMinutes * 60,
      };

      // Idempotency key passed via header
      const session = await stripe.checkout.sessions.create(sessionParams, {
        idempotencyKey: input.idempotencyKey,
      });

      this.logger.log(`Stripe checkout session created: ${session.id} for tenant ${input.tenantId}, plan ${input.planCode}`);

      return {
        providerCheckoutId: session.id,
        providerSessionId: session.id,
        providerPaymentId: session.payment_intent as string || session.id,
        providerCustomerId: (session.customer as string) || undefined,
        checkoutUrl: session.url,
        expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : undefined,
        rawResponse: this.sanitizeRawResponse(session),
      };
    } catch (error) {
      this.logger.error(`Stripe checkout creation failed for tenant ${input.tenantId}: ${(error as Error).message}`);
      throw new AppException({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'Failed to create Stripe checkout session',
        context: { provider: PaymentProvider.STRIPE, planId: input.planId },
      });
    }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<NormalizedPaymentResult> {
    const stripeSecretKey = this.config.getStripeSecretKey();
    let stripe: any;
    try {
      const Stripe = await this.loadStripeSdk();
      stripe = new Stripe(stripeSecretKey, {
        apiVersion: this.config.stripe?.apiVersion || '2023-10-16',
      });
    } catch (error) {
      throw new AppException({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'Stripe SDK not available',
      });
    }

    try {
      let stripeObject: any;
      let objectType: 'session' | 'payment_intent' | 'invoice' = 'session';

      if (input.providerSessionId || input.providerCheckoutId) {
        const sessionId = input.providerSessionId || input.providerCheckoutId!;
        stripeObject = await stripe.checkout.sessions.retrieve(sessionId);
        objectType = 'session';
      } else if (input.providerPaymentId) {
        try {
          stripeObject = await stripe.paymentIntents.retrieve(input.providerPaymentId);
          objectType = 'payment_intent';
        } catch {
          stripeObject = await stripe.checkout.sessions.retrieve(input.providerPaymentId);
          objectType = 'session';
        }
      } else {
        throw new AppException({
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Provider payment ID or checkout ID required',
        });
      }

      return this.normalizeStripeObjectToPaymentResult(stripeObject, objectType);
    } catch (error) {
      if (error instanceof AppException) {
        throw error;
      }
      this.logger.error(`Stripe payment retrieval failed: ${(error as Error).message}`);
      throw new AppException({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'Failed to retrieve Stripe payment',
      });
    }
  }

  async verifyWebhookSignature(input: VerifyWebhookInput): Promise<VerifyWebhookResult> {
    try {
      const webhookSecret = this.config.getStripeWebhookSecret();
      const rawBody = typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString('utf8');

      let stripe: any;
      try {
        const Stripe = await this.loadStripeSdk();
        stripe = new Stripe(this.config.getStripeSecretKey(), {
          apiVersion: this.config.stripe?.apiVersion || '2023-10-16',
        });
      } catch {
        return {
          verified: false,
          failureReason: 'Stripe SDK not available',
        };
      }

      const event = stripe.webhooks.constructEvent(rawBody, input.signature, webhookSecret);

      return {
        verified: true,
        eventId: event.id,
        eventType: event.type,
        rawEvent: event,
      };
    } catch (error) {
      this.logger.warn(`Stripe webhook signature verification failed: ${(error as Error).message}`);
      return {
        verified: false,
        failureReason: (error as Error).message,
      };
    }
  }

  async normalizeWebhookEvent(input: NormalizeEventInput): Promise<NormalizedWebhookEvent> {
    const rawEvent = input.rawEvent as any;

    if (!rawEvent || !rawEvent.id || !rawEvent.type) {
      throw new AppException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Invalid Stripe event structure',
      });
    }

    const eventCategory = this.mapStripeEventToCategory(rawEvent.type);
    const paymentStatus = this.mapStripeEventToPaymentStatus(rawEvent.type, rawEvent.data?.object);

    return {
      provider: PaymentProvider.STRIPE,
      providerEventId: rawEvent.id,
      eventType: rawEvent.type,
      eventCategory,
      paymentStatus,
      providerPaymentId: rawEvent.data?.object?.payment_intent || rawEvent.data?.object?.id,
      providerCheckoutId: rawEvent.data?.object?.id,
      providerSessionId: rawEvent.type.includes('checkout') ? rawEvent.data?.object?.id : undefined,
      amount: rawEvent.data?.object?.amount_total ? {
        amount: (rawEvent.data.object.amount_total / 100).toString(),
        currency: rawEvent.data.object.currency?.toUpperCase() || 'USD',
        amountInSmallestUnit: rawEvent.data.object.amount_total,
      } : undefined,
      metadata: {
        tenantId: rawEvent.data?.object?.metadata?.tenantId,
        planId: rawEvent.data?.object?.metadata?.planId,
        subscriptionId: rawEvent.data?.object?.metadata?.subscriptionId,
        idempotencyKey: rawEvent.data?.object?.metadata?.idempotencyKey,
      },
      rawEvent: this.sanitizeRawResponse(rawEvent),
      receivedAt: new Date(),
      providerCreatedAt: rawEvent.created ? new Date(rawEvent.created * 1000) : new Date(),
    };
  }

  mapProviderStatusToInternalStatus(providerStatus: string): PaymentStatus {
    const statusMap: Record<string, PaymentStatus> = {
      'open': PaymentStatus.PENDING,
      'complete': PaymentStatus.SUCCEEDED,
      'expired': PaymentStatus.EXPIRED,
      'requires_payment_method': PaymentStatus.PENDING,
      'requires_confirmation': PaymentStatus.PENDING,
      'requires_action': PaymentStatus.PENDING,
      'processing': PaymentStatus.PROCESSING,
      'requires_capture': PaymentStatus.PROCESSING,
      'canceled': PaymentStatus.CANCELLED,
      'succeeded': PaymentStatus.SUCCEEDED,
      'failed': PaymentStatus.FAILED,
      'refunded': PaymentStatus.REFUNDED,
      'partially_refunded': PaymentStatus.PARTIALLY_REFUNDED,
    };

    return statusMap[providerStatus?.toLowerCase()] || PaymentStatus.UNKNOWN;
  }

  mapProviderStatusToTransactionState(providerStatus: string): TransactionState {
    const stateMap: Record<string, TransactionState> = {
      'open': TransactionState.INITIALIZED,
      'complete': TransactionState.CAPTURED,
      'expired': TransactionState.FAILED,
      'requires_payment_method': TransactionState.INITIALIZED,
      'requires_confirmation': TransactionState.INITIALIZED,
      'requires_action': TransactionState.INITIALIZED,
      'processing': TransactionState.AUTHORIZED,
      'requires_capture': TransactionState.AUTHORIZED,
      'canceled': TransactionState.VOIDED,
      'succeeded': TransactionState.CAPTURED,
      'failed': TransactionState.FAILED,
      'refunded': TransactionState.REFUNDED,
      'partially_refunded': TransactionState.REFUNDED,
    };

    return stateMap[providerStatus?.toLowerCase()] || TransactionState.FAILED;
  }

  private validateCheckoutInput(input: CreateCheckoutInput): void {
    if (!input.planId) {
      throw new AppException({ code: ErrorCode.VALIDATION_ERROR, message: 'Plan ID required' });
    }
    if (!input.tenantId) {
      throw new AppException({ code: ErrorCode.VALIDATION_ERROR, message: 'Tenant ID required' });
    }
    if (!input.price) {
      throw new AppException({ code: ErrorCode.VALIDATION_ERROR, message: 'Plan price required - must come from catalog' });
    }
    if (!input.idempotencyKey) {
      throw new AppException({ code: ErrorCode.VALIDATION_ERROR, message: 'Idempotency key required' });
    }
  }

  private parseAmountToCents(price: string, currency: string): number {
    const amount = parseFloat(price);
    if (isNaN(amount)) {
      throw new AppException({ code: ErrorCode.VALIDATION_ERROR, message: `Invalid price: ${price}` });
    }
    // For most currencies, smallest unit is cent
    // For JPY, KRW, etc, smallest unit is the currency itself
    const zeroDecimalCurrencies = ['JPY', 'KRW', 'VND', 'CLP', 'PYG', 'RWF', 'UGX', 'VUV', 'XAF', 'XOF', 'XPF'];
    if (zeroDecimalCurrencies.includes(currency.toUpperCase())) {
      return Math.round(amount);
    }
    return Math.round(amount * 100);
  }

  private mapIntervalToStripeInterval(interval: string): 'day' | 'week' | 'month' | 'year' {
    switch (interval?.toUpperCase()) {
      case 'MONTHLY':
        return 'month';
      case 'QUARTERLY':
        return 'month';
      case 'YEARLY':
      case 'ANNUAL':
        return 'year';
      case 'LIFETIME':
        return 'year';
      default:
        return 'month';
    }
  }

  private buildSuccessUrl(baseUrl: string, sessionIdPlaceholder: string): string {
    if (baseUrl.includes('{CHECKOUT_SESSION_ID}')) {
      return baseUrl.replace('{CHECKOUT_SESSION_ID}', sessionIdPlaceholder);
    }
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}session_id=${sessionIdPlaceholder}`;
  }

  private mapStripeEventToCategory(eventType: string): WebhookEventCategory {
    if (eventType.includes('checkout.session.completed') || eventType.includes('payment_intent.succeeded')) {
      return 'PAYMENT_SUCCEEDED' as WebhookEventCategory;
    }
    if (eventType.includes('checkout.session.expired') || eventType.includes('payment_intent.payment_failed')) {
      return 'PAYMENT_FAILED' as WebhookEventCategory;
    }
    if (eventType.includes('charge.refunded')) {
      return 'PAYMENT_REFUNDED' as WebhookEventCategory;
    }
    if (eventType.includes('checkout.session.async_payment_succeeded')) {
      return 'PAYMENT_SUCCEEDED' as WebhookEventCategory;
    }
    if (eventType.includes('checkout.session.async_payment_failed')) {
      return 'PAYMENT_FAILED' as WebhookEventCategory;
    }
    return 'PAYMENT_PENDING' as WebhookEventCategory;
  }

  private mapStripeEventToPaymentStatus(eventType: string, object: any): PaymentStatus {
    if (eventType === 'checkout.session.completed') {
      const paymentStatus = object?.payment_status;
      if (paymentStatus === 'paid' || paymentStatus === 'no_payment_required') {
        return PaymentStatus.SUCCEEDED;
      }
      return PaymentStatus.PENDING;
    }
    if (eventType === 'checkout.session.expired') {
      return PaymentStatus.EXPIRED;
    }
    if (eventType === 'payment_intent.succeeded') {
      return PaymentStatus.SUCCEEDED;
    }
    if (eventType === 'payment_intent.payment_failed') {
      return PaymentStatus.FAILED;
    }
    if (eventType === 'payment_intent.canceled') {
      return PaymentStatus.CANCELLED;
    }
    if (eventType === 'charge.refunded') {
      return object?.refunded ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED;
    }
    return PaymentStatus.PENDING;
  }

  private normalizeStripeObjectToPaymentResult(stripeObject: any, objectType: string): NormalizedPaymentResult {
    const isSession = objectType === 'session';
    const amountTotal = isSession ? stripeObject.amount_total : stripeObject.amount;
    const currency = (isSession ? stripeObject.currency : stripeObject.currency)?.toUpperCase() || 'USD';

    const amount: PaymentAmount = {
      amount: amountTotal ? (amountTotal / 100).toString() : '0',
      currency,
      amountInSmallestUnit: amountTotal || 0,
    };

    const status = isSession
      ? this.mapProviderStatusToInternalStatus(stripeObject.status)
      : this.mapProviderStatusToInternalStatus(stripeObject.status);

    const transactionState = isSession
      ? this.mapProviderStatusToTransactionState(stripeObject.status)
      : this.mapProviderStatusToTransactionState(stripeObject.status);

    return {
      internalPaymentId: stripeObject.metadata?.internalPaymentId || stripeObject.id,
      provider: PaymentProvider.STRIPE,
      status,
      transactionState,
      amount,
      providerReference: {
        provider: PaymentProvider.STRIPE,
        providerPaymentId: isSession ? (stripeObject.payment_intent as string) || stripeObject.id : stripeObject.id,
        providerCheckoutId: isSession ? stripeObject.id : null,
        providerSessionId: isSession ? stripeObject.id : null,
        providerCustomerId: (stripeObject.customer as string) || undefined,
        checkoutUrl: isSession ? stripeObject.url : null,
      },
      references: {
        tenantId: stripeObject.metadata?.tenantId || '',
        planId: stripeObject.metadata?.planId || '',
        subscriptionId: stripeObject.metadata?.subscriptionId || null,
        userId: stripeObject.metadata?.userId || null,
        idempotencyKey: stripeObject.metadata?.idempotencyKey || '',
        orderId: stripeObject.metadata?.orderId || stripeObject.client_reference_id || null,
      },
      metadata: {
        planCode: stripeObject.metadata?.planCode,
        billingInterval: stripeObject.metadata?.billingInterval as any,
        successUrl: stripeObject.success_url,
        cancelUrl: stripeObject.cancel_url,
      },
      paymentMethod: PaymentMethodType.CARD,
      createdAt: new Date(stripeObject.created * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
      rawProviderStatus: stripeObject.status,
    };
  }

  private sanitizeRawResponse(response: any): any {
    if (!response) return null;
    // Never include secrets, card numbers, etc
    const sanitized = { ...response };
    delete sanitized.client_secret;
    delete sanitized.card;
    delete sanitized.source;
    delete sanitized.payment_method;
    return sanitized;
  }

  private async loadStripeSdk(): Promise<any> {
    // Stripe SDK is optional - if not installed, we throw SERVICE_UNAVAILABLE
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Stripe = require('stripe');
      return Stripe;
    } catch {
      throw new Error('Stripe SDK not installed. Run: npm install stripe');
    }
  }
}
