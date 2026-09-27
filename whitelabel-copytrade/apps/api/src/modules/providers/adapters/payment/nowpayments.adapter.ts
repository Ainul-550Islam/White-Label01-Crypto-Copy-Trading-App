/**
 * Production NOWPayments Adapter
 * Uses existing payment-provider interface and configuration.
 * Preserves actual provider status and confirmations, never fabricates.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  ProviderDomain,
  ProviderName,
  ProviderCapability,
  ProviderResult,
  NormalizedPaymentProviderResult,
  ProviderErrorCode,
  RetryClassification,
  ProviderOperationType,
} from '../../provider.types';
import { ProviderPolicyService } from '../../provider-policy.service';
import { ProviderRequestService } from '../../provider-request.service';
import { ProviderObservationService } from '../../provider-observation.service';

export interface NowPaymentsCreateInput {
  planId: string;
  planCode: string;
  planName: string;
  price: string;
  currency: string;
  tenantId: string;
  userId?: string;
  idempotencyKey: string;
  successUrl: string;
  cancelUrl: string;
  correlationId: string;
  payCurrency?: string;
}

@Injectable()
export class NowPaymentsProductionAdapter {
  private readonly logger = new Logger(NowPaymentsProductionAdapter.name);
  readonly provider = ProviderName.NOWPAYMENTS;
  readonly domain = ProviderDomain.PAYMENT;

  readonly capabilities: ProviderCapability[] = [
    ProviderCapability.PAYMENT_CREATE,
    ProviderCapability.PAYMENT_READ,
    ProviderCapability.WEBHOOK,
  ];

  constructor(
    private readonly policyService: ProviderPolicyService,
    private readonly requestService: ProviderRequestService,
    private readonly observationService: ProviderObservationService,
  ) {}

  isAvailable(): boolean {
    return !!process.env['NOWPAYMENTS_API_KEY'];
  }

  getCapabilities(): ProviderCapability[] {
    return this.capabilities;
  }

  async createPayment(input: NowPaymentsCreateInput): Promise<ProviderResult<NormalizedPaymentProviderResult>> {
    const start = Date.now();
    const correlationId = input.correlationId;

    if (!this.isAvailable()) {
      return {
        success: false,
        provider: this.provider,
        domain: this.domain,
        error: {
          code: ProviderErrorCode.NOT_CONFIGURED,
          message: 'NOWPayments not configured',
          provider: this.provider,
          domain: this.domain,
          isRetryable: false,
          retryClassification: RetryClassification.NO_RETRY,
          correlationId,
          safeEvidence: {},
        },
        correlationId,
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - start,
      };
    }

    const apiKey = process.env['NOWPAYMENTS_API_KEY']!;
    const baseUrl = this.policyService.getPolicy(this.domain, this.provider)?.baseUrl || 'https://api.nowpayments.io';

    try {
      const payload = {
        price_amount: parseFloat(input.price),
        price_currency: input.currency.toLowerCase(),
        pay_currency: (input.payCurrency || 'btc').toLowerCase(),
        order_id: input.idempotencyKey,
        order_description: `${input.planName} - ${input.planCode}`,
        ipn_callback_url: process.env['NOWPAYMENTS_IPN_CALLBACK_URL'] || `${process.env['API_BASE_URL']}/v1/billing/payments/webhook/nowpayments`,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        is_fixed_rate: false,
        is_fee_paid_by_user: false,
      };

      const response = await this.requestService.requestWithRetry<any>({
        method: 'POST',
        url: `${baseUrl}/v1/invoice`,
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: payload,
        correlationId,
        domain: this.domain,
        provider: this.provider,
        operation: ProviderOperationType.CREATE,
        tenantId: input.tenantId,
        isIdempotent: true,
        idempotencyKey: input.idempotencyKey,
      });

      const data = response.data as any;
      const latencyMs = response.latencyMs;

      const normalized: NormalizedPaymentProviderResult = {
        providerPaymentId: data.payment_id || data.id || data.invoice_id || input.idempotencyKey,
        providerCheckoutId: data.id || data.invoice_id || null,
        providerSessionId: data.id || null,
        status: data.payment_status || data.status || 'waiting',
        amount: input.price,
        currency: input.currency,
        providerCustomerId: null,
        checkoutUrl: data.invoice_url || data.payment_url || null,
        expiresAt: data.expiration_estimate_date || null,
        createdAt: new Date().toISOString(),
        safeMetadata: {
          tenantId: input.tenantId,
          planCode: input.planCode,
          payCurrency: payload.pay_currency,
          correlationId,
        },
      };

      await this.observationService.recordPaymentObservation(
        this.provider,
        correlationId,
        input.idempotencyKey,
        normalized.providerPaymentId,
        normalized.status,
        {
          tenantId: input.tenantId,
          planCode: input.planCode,
          amount: input.price,
          currency: input.currency,
          latencyMs,
        },
        input.tenantId,
      );

      return {
        success: true,
        provider: this.provider,
        domain: this.domain,
        data: normalized,
        correlationId,
        providerReference: normalized.providerPaymentId,
        timestamp: new Date().toISOString(),
        latencyMs,
        rawStatus: normalized.status,
      };
    } catch (error) {
      const latencyMs = Date.now() - start;
      const normalizedError = error as any;
      const err = normalizedError.code ? normalizedError : this.requestService.normalizeError(error as Error, this.provider, this.domain, correlationId);

      await this.observationService.recordPaymentObservation(
        this.provider,
        correlationId,
        input.idempotencyKey,
        null,
        'FAILED',
        {
          tenantId: input.tenantId,
          planCode: input.planCode,
          error: err.safeEvidence,
          latencyMs,
        },
        input.tenantId,
      );

      return {
        success: false,
        provider: this.provider,
        domain: this.domain,
        error: err,
        correlationId,
        timestamp: new Date().toISOString(),
        latencyMs,
      };
    }
  }

  async getPaymentStatus(providerPaymentId: string, correlationId: string, tenantId?: string): Promise<ProviderResult<NormalizedPaymentProviderResult>> {
    const start = Date.now();

    if (!this.isAvailable()) {
      return {
        success: false,
        provider: this.provider,
        domain: this.domain,
        error: {
          code: ProviderErrorCode.NOT_CONFIGURED,
          message: 'NOWPayments not configured',
          provider: this.provider,
          domain: this.domain,
          isRetryable: false,
          retryClassification: RetryClassification.NO_RETRY,
          correlationId,
          safeEvidence: {},
        },
        correlationId,
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - start,
      };
    }

    const apiKey = process.env['NOWPAYMENTS_API_KEY']!;
    const baseUrl = this.policyService.getPolicy(this.domain, this.provider)?.baseUrl || 'https://api.nowpayments.io';

    try {
      const response = await this.requestService.requestWithRetry<any>({
        method: 'GET',
        url: `${baseUrl}/v1/payment/${providerPaymentId}`,
        headers: {
          'x-api-key': apiKey,
        },
        correlationId,
        domain: this.domain,
        provider: this.provider,
        operation: ProviderOperationType.READ,
        tenantId,
        isIdempotent: true,
      });

      const data = response.data as any;

      const normalized: NormalizedPaymentProviderResult = {
        providerPaymentId: data.payment_id || providerPaymentId,
        providerCheckoutId: data.invoice_id || null,
        providerSessionId: null,
        status: data.payment_status || data.status || 'unknown',
        amount: data.price_amount?.toString() || '0',
        currency: (data.price_currency || 'USD').toUpperCase(),
        providerCustomerId: null,
        checkoutUrl: null,
        expiresAt: null,
        createdAt: data.created_at || new Date().toISOString(),
        safeMetadata: {
          correlationId,
          payAmount: data.pay_amount,
          payCurrency: data.pay_currency,
          status: data.payment_status,
        },
      };

      return {
        success: true,
        provider: this.provider,
        domain: this.domain,
        data: normalized,
        correlationId,
        providerReference: providerPaymentId,
        timestamp: new Date().toISOString(),
        latencyMs: response.latencyMs,
        rawStatus: normalized.status,
      };
    } catch (error) {
      const err = (error as any).code ? error : this.requestService.normalizeError(error as Error, this.provider, this.domain, correlationId);
      return {
        success: false,
        provider: this.provider,
        domain: this.domain,
        error: err as any,
        correlationId,
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - start,
      };
    }
  }
}
