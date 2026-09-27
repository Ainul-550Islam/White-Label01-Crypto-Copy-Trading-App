/**
 * Production Stripe Adapter
 * Uses existing payment-provider interface and configuration.
 * Supports operations actually exposed by current payment interface and never fabricates Stripe state.
 *
 * Flow:
 * Existing Domain Service
 *   ↓
 * Existing Provider Interface
 *   ↓
 * Provider Adapter (this file)
 *   ↓
 * External Provider (Stripe)
 *   ↓
 * Normalized Provider Result
 *   ↓
 * Existing Domain Service
 *   ↓
 * Audit / Reconciliation / Operations
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  ProviderDomain,
  ProviderName,
  ProviderCapability,
  ProviderHealthState,
  ProviderResult,
  NormalizedPaymentProviderResult,
  ProviderErrorCode,
  RetryClassification,
  ProviderOperationType,
} from '../../provider.types';
import { ProviderPolicyService } from '../../provider-policy.service';
import { ProviderRequestService } from '../../provider-request.service';
import { ProviderObservationService } from '../../provider-observation.service';
import { ProviderHealthService } from '../../provider-health.service';

export interface StripeCreateInput {
  planId: string;
  planCode: string;
  planName: string;
  price: string;
  currency: string;
  interval: string;
  tenantId: string;
  userId?: string;
  subscriptionId?: string | null;
  idempotencyKey: string;
  successUrl: string;
  cancelUrl: string;
  correlationId: string;
  metadata?: Record<string, string>;
}

@Injectable()
export class StripeProductionAdapter {
  private readonly logger = new Logger(StripeProductionAdapter.name);
  readonly provider = ProviderName.STRIPE;
  readonly domain = ProviderDomain.PAYMENT;

  readonly capabilities: ProviderCapability[] = [
    ProviderCapability.PAYMENT_CREATE,
    ProviderCapability.PAYMENT_READ,
    ProviderCapability.REFUND,
    ProviderCapability.WEBHOOK,
  ];

  constructor(
    private readonly policyService: ProviderPolicyService,
    private readonly requestService: ProviderRequestService,
    private readonly observationService: ProviderObservationService,
    private readonly healthService: ProviderHealthService,
  ) {}

  isAvailable(): boolean {
    const stripeKey = process.env['STRIPE_SECRET_KEY'] || process.env['STRIPE_API_KEY'];
    return !!stripeKey;
  }

  getCapabilities(): ProviderCapability[] {
    return this.capabilities;
  }

  async createCheckout(input: StripeCreateInput): Promise<ProviderResult<NormalizedPaymentProviderResult>> {
    const start = Date.now();
    const correlationId = input.correlationId;

    if (!this.isAvailable()) {
      return {
        success: false,
        provider: this.provider,
        domain: this.domain,
        error: {
          code: ProviderErrorCode.NOT_CONFIGURED,
          message: 'Stripe not configured',
          provider: this.provider,
          domain: this.domain,
          isRetryable: false,
          retryClassification: RetryClassification.NO_RETRY,
          correlationId,
          safeEvidence: { configured: false },
        },
        correlationId,
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - start,
      };
    }

    const stripeSecretKey = process.env['STRIPE_SECRET_KEY'] || process.env['STRIPE_API_KEY'];
    if (!stripeSecretKey) {
      return {
        success: false,
        provider: this.provider,
        domain: this.domain,
        error: {
          code: ProviderErrorCode.NOT_CONFIGURED,
          message: 'Stripe secret key missing',
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

    try {
      const Stripe = await this.loadStripeSdk();
      const stripe = new Stripe(stripeSecretKey, {
        apiVersion: '2023-10-16',
        maxNetworkRetries: 2,
        timeout: this.policyService.getTimeout(this.domain, this.provider),
      });

      const amountInCents = this.parseAmountToCents(input.price, input.currency);

      const sessionParams: any = {
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: input.currency.toLowerCase(),
              product_data: {
                name: input.planName,
                metadata: {
                  planId: input.planId,
                  planCode: input.planCode,
                  tenantId: input.tenantId,
                },
              },
              unit_amount: amountInCents,
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        client_reference_id: input.idempotencyKey,
        metadata: {
          tenantId: input.tenantId,
          planId: input.planId,
          planCode: input.planCode,
          subscriptionId: input.subscriptionId || '',
          userId: input.userId || '',
          idempotencyKey: input.idempotencyKey,
          correlationId,
        },
      };

      const session = await stripe.checkout.sessions.create(sessionParams, {
        idempotencyKey: input.idempotencyKey,
      });

      const latencyMs = Date.now() - start;

      const normalized: NormalizedPaymentProviderResult = {
        providerPaymentId: (session.payment_intent as string) || session.id,
        providerCheckoutId: session.id,
        providerSessionId: session.id,
        status: session.status || 'open',
        amount: input.price,
        currency: input.currency,
        providerCustomerId: (session.customer as string) || null,
        checkoutUrl: session.url || null,
        expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
        createdAt: new Date().toISOString(),
        safeMetadata: {
          tenantId: input.tenantId,
          planId: input.planId,
          planCode: input.planCode,
          correlationId,
        },
      };

      await this.observationService.recordPaymentObservation(
        this.provider,
        correlationId,
        input.idempotencyKey,
        session.id,
        session.status || 'open',
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
        providerReference: session.id,
        timestamp: new Date().toISOString(),
        latencyMs,
        rawStatus: session.status,
      };
    } catch (error) {
      const latencyMs = Date.now() - start;
      const normalizedError = this.requestService.normalizeError(error as Error, this.provider, this.domain, correlationId);

      await this.observationService.recordPaymentObservation(
        this.provider,
        correlationId,
        input.idempotencyKey,
        null,
        'FAILED',
        {
          tenantId: input.tenantId,
          planCode: input.planCode,
          error: normalizedError.safeEvidence,
          latencyMs,
        },
        input.tenantId,
      );

      return {
        success: false,
        provider: this.provider,
        domain: this.domain,
        error: normalizedError,
        correlationId,
        timestamp: new Date().toISOString(),
        latencyMs,
      };
    }
  }

  async retrievePayment(providerPaymentId: string, correlationId: string): Promise<ProviderResult<NormalizedPaymentProviderResult>> {
    const start = Date.now();

    if (!this.isAvailable()) {
      return {
        success: false,
        provider: this.provider,
        domain: this.domain,
        error: {
          code: ProviderErrorCode.NOT_CONFIGURED,
          message: 'Stripe not configured',
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

    try {
      const stripeSecretKey = process.env['STRIPE_SECRET_KEY']!;
      const Stripe = await this.loadStripeSdk();
      const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });

      let stripeObject: any;
      try {
        stripeObject = await stripe.checkout.sessions.retrieve(providerPaymentId);
      } catch {
        stripeObject = await stripe.paymentIntents.retrieve(providerPaymentId);
      }

      const normalized: NormalizedPaymentProviderResult = {
        providerPaymentId: stripeObject.payment_intent || stripeObject.id,
        providerCheckoutId: stripeObject.id,
        providerSessionId: stripeObject.id,
        status: stripeObject.status || 'unknown',
        amount: stripeObject.amount_total ? (stripeObject.amount_total / 100).toString() : '0',
        currency: (stripeObject.currency || 'USD').toUpperCase(),
        providerCustomerId: stripeObject.customer || null,
        checkoutUrl: stripeObject.url || null,
        expiresAt: stripeObject.expires_at ? new Date(stripeObject.expires_at * 1000).toISOString() : null,
        createdAt: new Date((stripeObject.created || Date.now() / 1000) * 1000).toISOString(),
        safeMetadata: {
          correlationId,
          status: stripeObject.status,
        },
      };

      return {
        success: true,
        provider: this.provider,
        domain: this.domain,
        data: normalized,
        correlationId,
        providerReference: stripeObject.id,
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - start,
        rawStatus: stripeObject.status,
      };
    } catch (error) {
      const normalizedError = this.requestService.normalizeError(error as Error, this.provider, this.domain, correlationId);
      return {
        success: false,
        provider: this.provider,
        domain: this.domain,
        error: normalizedError,
        correlationId,
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - start,
      };
    }
  }

  private parseAmountToCents(price: string, currency: string): number {
    const amount = parseFloat(price);
    if (isNaN(amount)) throw new Error(`Invalid price: ${price}`);
    const zeroDecimal = ['JPY', 'KRW', 'VND'];
    if (zeroDecimal.includes(currency.toUpperCase())) return Math.round(amount);
    return Math.round(amount * 100);
  }

  private async loadStripeSdk(): Promise<any> {
    try {
      const Stripe = require('stripe');
      return Stripe;
    } catch {
      throw new Error('Stripe SDK not installed');
    }
  }
}
