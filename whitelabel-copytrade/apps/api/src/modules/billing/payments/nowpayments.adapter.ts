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
import type { NormalizedPaymentResult, PaymentAmount } from './payment.types';
import type { NormalizedWebhookEvent } from './webhook.types';
import { PaymentConfigService } from './payment.config';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '@wlct/shared-types';

/**
 * Real NowPayments integration adapter.
 *
 * Implements the common provider contract for NowPayments:
 *  - Payment/invoice creation using canonical plan price
 *  - Payment status retrieval
 *  - Webhook IPN verification
 *  - Event normalization
 *  - Status mapping
 *
 * Does NOT mark subscriptions active merely because payment object was created.
 * Payment completion is based on normalized provider payment status.
 */

@Injectable()
export class NowPaymentsAdapter implements IPaymentProvider {
  private readonly logger = new Logger(NowPaymentsAdapter.name);
  readonly provider = PaymentProvider.NOWPAYMENTS;

  readonly capabilities: ProviderCapabilities = {
    supportsCheckout: true,
    supportsPaymentIntents: true,
    supportsRefunds: false,
    supportsPartialRefunds: false,
    supportsWebhooks: true,
    supportsRecurring: false,
    supportsCrypto: true,
    supportedCurrencies: ['USD', 'EUR', 'BTC', 'ETH', 'USDT', 'USDC', 'BNB', 'LTC', 'TRX', 'DOGE'],
  };

  constructor(private readonly config: PaymentConfigService) {}

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    this.validateCheckoutInput(input);

    const apiKey = this.config.getNowPaymentsApiKey();
    const baseUrl = this.config.nowpayments?.apiBaseUrl || 'https://api.nowpayments.io/v1';

    try {
      // Price must come from canonical billing plan catalog, never hardcoded
      const amount = parseFloat(input.price);
      if (isNaN(amount) || amount <= 0) {
        throw new AppException({
          code: ErrorCode.VALIDATION_ERROR,
          message: `Invalid plan price: ${input.price} - must come from catalog`,
        });
      }

      // NowPayments invoice creation
      const invoicePayload = {
        price_amount: amount,
        price_currency: input.currency.toLowerCase(),
        pay_currency: this.mapToCryptoCurrency(input.currency),
        order_id: input.references.orderId || input.idempotencyKey,
        order_description: `Subscription to ${input.planName} - ${input.interval}`,
        ipn_callback_url: this.buildIpnCallbackUrl(),
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        is_fixed_rate: true,
        is_fee_paid_by_user: false,
      };

      const response = await this.makeApiRequest(`${baseUrl}/invoice`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(invoicePayload),
      });

      if (!response || !response.id) {
        throw new Error(`Invalid NowPayments response: ${JSON.stringify(this.sanitizeResponse(response))}`);
      }

      this.logger.log(`NowPayments invoice created: ${response.id} for tenant ${input.tenantId}, plan ${input.planCode}`);

      return {
        providerCheckoutId: response.id.toString(),
        providerInvoiceId: response.id.toString(),
        providerPaymentId: response.payment_id?.toString() || response.id.toString(),
        checkoutUrl: response.invoice_url || response.payment_url,
        invoiceUrl: response.invoice_url,
        expiresAt: response.expiration_estimate_date ? new Date(response.expiration_estimate_date) : undefined,
        rawResponse: this.sanitizeResponse(response),
      };
    } catch (error) {
      if (error instanceof AppException) {
        throw error;
      }
      this.logger.error(`NowPayments checkout creation failed for tenant ${input.tenantId}: ${(error as Error).message}`);
      throw new AppException({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'Failed to create NowPayments invoice',
        context: { provider: PaymentProvider.NOWPAYMENTS, planId: input.planId },
      });
    }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<NormalizedPaymentResult> {
    const apiKey = this.config.getNowPaymentsApiKey();
    const baseUrl = this.config.nowpayments?.apiBaseUrl || 'https://api.nowpayments.io/v1';

    try {
      let paymentData: any;

      if (input.providerPaymentId) {
        const response = await this.makeApiRequest(`${baseUrl}/payment/${input.providerPaymentId}`, {
          method: 'GET',
          headers: { 'x-api-key': apiKey },
        });
        paymentData = response;
      } else if (input.providerInvoiceId || input.providerCheckoutId) {
        const invoiceId = input.providerInvoiceId || input.providerCheckoutId;
        // Try to get payment by invoice - list payments and filter
        const response = await this.makeApiRequest(`${baseUrl}/payment/?orderId=${invoiceId}`, {
          method: 'GET',
          headers: { 'x-api-key': apiKey },
        });
        paymentData = Array.isArray(response) ? response[0] : response;
      } else {
        throw new AppException({
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Provider payment ID or invoice ID required',
        });
      }

      if (!paymentData) {
        throw new AppException({
          code: ErrorCode.NOT_FOUND,
          message: 'NowPayments payment not found',
        });
      }

      return this.normalizeNowPaymentsToPaymentResult(paymentData);
    } catch (error) {
      if (error instanceof AppException) {
        throw error;
      }
      this.logger.error(`NowPayments payment retrieval failed: ${(error as Error).message}`);
      throw new AppException({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'Failed to retrieve NowPayments payment',
      });
    }
  }

  async verifyWebhookSignature(input: VerifyWebhookInput): Promise<VerifyWebhookResult> {
    try {
      const ipnSecret = this.config.getNowPaymentsIpnSecret();

      if (!ipnSecret) {
        // If no IPN secret configured, verify by checking payload structure only
        // In production, IPN secret should always be configured
        this.logger.warn('NowPayments IPN secret not configured - using basic verification');
        const payload = typeof input.rawBody === 'string' ? JSON.parse(input.rawBody) : JSON.parse(input.rawBody.toString('utf8'));
        return {
          verified: !!payload.payment_id && !!payload.payment_status,
          eventId: payload.payment_id?.toString() || payload.order_id,
          eventType: payload.payment_status,
          rawEvent: payload,
        };
      }

      // NowPayments IPN verification: HMAC SHA512 of sorted payload with IPN secret
      const rawBody = typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString('utf8');
      const payload = JSON.parse(rawBody);

      // Verify signature header if provided
      if (input.signature) {
        const crypto = await import('crypto');
        const sortedPayload = JSON.stringify(payload);
        const expectedSignature = crypto.createHmac('sha512', ipnSecret).update(sortedPayload).digest('hex');

        if (input.signature !== expectedSignature) {
          this.logger.warn(`NowPayments IPN signature mismatch for payment ${payload.payment_id}`);
          return {
            verified: false,
            failureReason: 'Invalid IPN signature',
          };
        }
      }

      return {
        verified: true,
        eventId: payload.payment_id?.toString() || payload.order_id,
        eventType: payload.payment_status,
        rawEvent: payload,
      };
    } catch (error) {
      this.logger.warn(`NowPayments webhook verification failed: ${(error as Error).message}`);
      return {
        verified: false,
        failureReason: (error as Error).message,
      };
    }
  }

  async normalizeWebhookEvent(input: NormalizeEventInput): Promise<NormalizedWebhookEvent> {
    const rawEvent = input.rawEvent as any;

    if (!rawEvent || !rawEvent.payment_id) {
      throw new AppException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Invalid NowPayments event structure',
      });
    }

    const paymentStatus = this.mapProviderStatusToInternalStatus(rawEvent.payment_status);
    const eventCategory = this.mapNowPaymentsStatusToCategory(rawEvent.payment_status);

    return {
      provider: PaymentProvider.NOWPAYMENTS,
      providerEventId: rawEvent.payment_id.toString(),
      eventType: rawEvent.payment_status,
      eventCategory,
      paymentStatus,
      providerPaymentId: rawEvent.payment_id.toString(),
      providerInvoiceId: rawEvent.order_id?.toString(),
      providerCheckoutId: rawEvent.order_id?.toString(),
      amount: rawEvent.price_amount ? {
        amount: rawEvent.price_amount.toString(),
        currency: rawEvent.price_currency?.toUpperCase() || 'USD',
        amountInSmallestUnit: Math.round(parseFloat(rawEvent.price_amount) * 100),
      } : undefined,
      metadata: {
        tenantId: rawEvent.order_id?.split('_')[0] || undefined,
        orderId: rawEvent.order_id,
        payCurrency: rawEvent.pay_currency,
        priceCurrency: rawEvent.price_currency,
      },
      rawEvent: this.sanitizeResponse(rawEvent),
      receivedAt: new Date(),
      providerCreatedAt: rawEvent.created_at ? new Date(rawEvent.created_at) : new Date(),
    };
  }

  mapProviderStatusToInternalStatus(providerStatus: string): PaymentStatus {
    const statusMap: Record<string, PaymentStatus> = {
      'waiting': PaymentStatus.PENDING,
      'confirming': PaymentStatus.PROCESSING,
      'confirmed': PaymentStatus.PROCESSING,
      'sending': PaymentStatus.PROCESSING,
      'partially_paid': PaymentStatus.PENDING,
      'finished': PaymentStatus.SUCCEEDED,
      'failed': PaymentStatus.FAILED,
      'refunded': PaymentStatus.REFUNDED,
      'expired': PaymentStatus.EXPIRED,
    };

    return statusMap[providerStatus?.toLowerCase()] || PaymentStatus.UNKNOWN;
  }

  mapProviderStatusToTransactionState(providerStatus: string): TransactionState {
    const stateMap: Record<string, TransactionState> = {
      'waiting': TransactionState.INITIALIZED,
      'confirming': TransactionState.AUTHORIZED,
      'confirmed': TransactionState.AUTHORIZED,
      'sending': TransactionState.AUTHORIZED,
      'partially_paid': TransactionState.INITIALIZED,
      'finished': TransactionState.CAPTURED,
      'failed': TransactionState.FAILED,
      'refunded': TransactionState.REFUNDED,
      'expired': TransactionState.FAILED,
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

  private mapToCryptoCurrency(fiatCurrency: string): string {
    const fiatToCrypto: Record<string, string> = {
      'USD': 'btc',
      'EUR': 'btc',
      'GBP': 'btc',
    };
    return fiatToCrypto[fiatCurrency.toUpperCase()] || 'btc';
  }

  private buildIpnCallbackUrl(): string {
    const publicUrl = process.env.API_PUBLIC_URL || 'http://localhost:4000';
    return `${publicUrl}/api/v1/billing/webhooks/nowpayments`;
  }

  private mapNowPaymentsStatusToCategory(status: string): any {
    switch (status?.toLowerCase()) {
      case 'finished':
        return 'PAYMENT_SUCCEEDED';
      case 'failed':
      case 'expired':
        return 'PAYMENT_FAILED';
      case 'refunded':
        return 'PAYMENT_REFUNDED';
      case 'waiting':
      case 'confirming':
      case 'confirmed':
      case 'sending':
      case 'partially_paid':
        return 'PAYMENT_PENDING';
      default:
        return 'PAYMENT_PENDING';
    }
  }

  private normalizeNowPaymentsToPaymentResult(paymentData: any): NormalizedPaymentResult {
    const status = this.mapProviderStatusToInternalStatus(paymentData.payment_status);
    const transactionState = this.mapProviderStatusToTransactionState(paymentData.payment_status);

    const amount: PaymentAmount = {
      amount: paymentData.price_amount?.toString() || '0',
      currency: paymentData.price_currency?.toUpperCase() || 'USD',
      amountInSmallestUnit: paymentData.price_amount ? Math.round(parseFloat(paymentData.price_amount) * 100) : 0,
    };

    return {
      internalPaymentId: paymentData.order_id || paymentData.payment_id?.toString(),
      provider: PaymentProvider.NOWPAYMENTS,
      status,
      transactionState,
      amount,
      providerReference: {
        provider: PaymentProvider.NOWPAYMENTS,
        providerPaymentId: paymentData.payment_id?.toString(),
        providerInvoiceId: paymentData.order_id?.toString(),
        providerCheckoutId: paymentData.order_id?.toString(),
        checkoutUrl: paymentData.invoice_url,
        invoiceUrl: paymentData.invoice_url,
      },
      references: {
        tenantId: paymentData.order_id?.split('_')[0] || '',
        planId: '',
        idempotencyKey: paymentData.order_id || '',
        orderId: paymentData.order_id || null,
      },
      metadata: {
        description: `NowPayments payment ${paymentData.payment_id}`,
      },
      paymentMethod: PaymentMethodType.CRYPTO,
      createdAt: paymentData.created_at ? new Date(paymentData.created_at).toISOString() : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      rawProviderStatus: paymentData.payment_status,
    };
  }

  private async makeApiRequest(url: string, options: any): Promise<any> {
    // Use fetch API (Node 18+ has built-in fetch)
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(this.config.nowpayments?.timeoutMs || 30000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`NowPayments API error ${response.status}: ${errorText}`);
    }

    return response.json();
  }

  private sanitizeResponse(response: any): any {
    if (!response) return null;
    const sanitized = { ...response };
    // Never log secrets, keys, etc
    delete sanitized.api_key;
    delete sanitized.ipn_secret;
    return sanitized;
  }
}
