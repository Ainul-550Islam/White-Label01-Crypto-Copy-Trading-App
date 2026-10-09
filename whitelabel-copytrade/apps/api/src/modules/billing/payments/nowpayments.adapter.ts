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
import { Decimal } from '../../../common/decimal-string';
import { nowPaymentsInvoiceAmountToNumber, paymentAmountToMinorUnits } from '../../../common/payment-amount';
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
      // /invoice requires a JSON number. Convert only when the number's decimal round-trip is exact.
      let amount: number;
      try {
        amount = nowPaymentsInvoiceAmountToNumber(input.price);
      } catch {
        throw new AppException({
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Plan price cannot be represented losslessly as a NOWPayments invoice amount',
          context: { provider: PaymentProvider.NOWPAYMENTS, planId: input.planId },
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
    const ipnSecret = this.config.getNowPaymentsIpnSecret();
    if (!ipnSecret) {
      this.logger.warn('NOWPayments IPN secret is not configured; rejecting webhook');
      return { verified: false, failureReason: 'NOWPayments IPN secret is not configured' };
    }

    if (typeof input.signature !== 'string' || input.signature.trim() === '') {
      return { verified: false, failureReason: 'NOWPayments IPN signature is missing' };
    }

    const signature = input.signature.trim();
    if (!/^[0-9a-f]{128}$/i.test(signature)) {
      return { verified: false, failureReason: 'NOWPayments IPN signature has an invalid format' };
    }

    try {
      const rawBody = typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString('utf8');
      const payload: unknown = JSON.parse(rawBody);
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        return { verified: false, failureReason: 'NOWPayments IPN payload must be a JSON object' };
      }

      const crypto = await import('crypto');
      const canonicalPayload = JSON.stringify(sortNowPaymentsPayload(payload));
      const expectedSignature = crypto.createHmac('sha512', ipnSecret).update(canonicalPayload, 'utf8').digest();
      const suppliedSignature = Buffer.from(signature, 'hex');
      if (suppliedSignature.length !== expectedSignature.length || !crypto.timingSafeEqual(suppliedSignature, expectedSignature)) {
        this.logger.warn('NOWPayments IPN signature verification failed');
        return { verified: false, failureReason: 'Invalid NOWPayments IPN signature' };
      }

      const record = payload as Record<string, unknown>;
      const eventIdValue = record.payment_id ?? record.order_id;
      const eventId = typeof eventIdValue === 'string' && eventIdValue.trim() !== ''
        ? eventIdValue.trim()
        : typeof eventIdValue === 'number' && Number.isSafeInteger(eventIdValue) && eventIdValue > 0
          ? String(eventIdValue)
          : undefined;
      const eventType = typeof record.payment_status === 'string' && record.payment_status.trim() !== ''
        ? record.payment_status.trim()
        : undefined;
      if (!eventId || !eventType) {
        return { verified: false, failureReason: 'NOWPayments IPN event id or status is missing' };
      }

      return {
        verified: true,
        eventId,
        eventType,
        rawEvent: record,
      };
    } catch {
      this.logger.warn('NOWPayments webhook verification failed due to malformed payload');
      return { verified: false, failureReason: 'Malformed NOWPayments webhook payload' };
    }
  }

  async normalizeWebhookEvent(input: NormalizeEventInput): Promise<NormalizedWebhookEvent> {
    const rawEvent = input.rawEvent as any;

    if (
      !rawEvent ||
      !rawEvent.payment_id ||
      typeof rawEvent.payment_status !== 'string' ||
      rawEvent.payment_status.trim() === '' ||
      typeof rawEvent.price_amount !== 'string' ||
      rawEvent.price_amount.trim() === '' ||
      typeof rawEvent.price_currency !== 'string'
    ) {
      throw new AppException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Invalid NowPayments event structure or exact amount evidence',
      });
    }

    let amount: string;
    try {
      const exactAmount = Decimal.parse(rawEvent.price_amount.trim());
      if (exactAmount.isNegative()) throw new TypeError('Payment amount must not be negative');
      amount = exactAmount.toString();
    } catch {
      throw new AppException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'NowPayments price amount must be a non-negative exact decimal string',
      });
    }

    const currency = rawEvent.price_currency.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(currency)) {
      throw new AppException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'NowPayments price currency is invalid',
      });
    }

    const paymentStatus = this.mapProviderStatusToInternalStatus(rawEvent.payment_status);
    const eventCategory = this.mapNowPaymentsStatusToCategory(rawEvent.payment_status);

    return {
      provider: PaymentProvider.NOWPAYMENTS,
      providerEventId: rawEvent.payment_id.toString(),
      eventType: rawEvent.payment_status.trim(),
      eventCategory,
      paymentStatus,
      providerPaymentId: rawEvent.payment_id.toString(),
      providerInvoiceId: rawEvent.order_id?.toString(),
      providerCheckoutId: rawEvent.order_id?.toString(),
      amount: { amount, currency },
      metadata: {
        tenantId: rawEvent.order_id?.split('_')[0] || undefined,
        orderId: rawEvent.order_id,
        payCurrency: rawEvent.pay_currency,
        priceCurrency: currency,
      },
      rawEvent: this.sanitizeResponse(rawEvent),
      receivedAt: new Date(),
      providerCreatedAt: typeof rawEvent.created_at === 'string' && rawEvent.created_at.trim() !== ''
        ? new Date(rawEvent.created_at)
        : null,
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
    if (typeof paymentData.price_amount !== 'string' || typeof paymentData.price_currency !== 'string') {
      throw new TypeError('NowPayments payment response is missing exact amount or currency evidence');
    }

    const exactAmount = Decimal.parse(paymentData.price_amount);
    if (exactAmount.isNegative()) throw new TypeError('NowPayments payment amount must not be negative');
    const currency = paymentData.price_currency.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(currency)) throw new TypeError('NowPayments payment currency is invalid');

    const amount: PaymentAmount = {
      amount: exactAmount.toString(),
      currency,
      amountInSmallestUnit: paymentAmountToMinorUnits(exactAmount.toString(), currency),
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

function sortNowPaymentsPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortNowPaymentsPayload);
  if (typeof value !== 'object' || value === null) return value;

  const source = value as Record<string, unknown>;
  const sorted = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(source).sort()) {
    sorted[key] = sortNowPaymentsPayload(source[key]);
  }
  return sorted;
}
