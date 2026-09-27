import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';
import { PaymentProvider } from './payment.types';

/**
 * Validated runtime payment configuration.
 *
 * This service provides safe access to payment provider configuration without
 * exposing secrets through logs or API responses. Secrets are accessed only
 * when needed for provider SDK initialization or webhook verification.
 *
 * Configuration sources:
 *  - BILLING_PROVIDER: none | stripe | nowpayments
 *  - STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
 *  - NOWPAYMENTS_API_KEY, NOWPAYMENTS_IPN_SECRET
 *  - Public settings: success/cancel URLs, timeouts, currency defaults
 */

export interface PaymentProviderConfig {
  provider: PaymentProvider;
  enabled: boolean;
  stripe?: StripeConfig;
  nowpayments?: NowPaymentsConfig;
  checkout: CheckoutConfig;
  webhook: WebhookConfig;
  retry: RetryConfig;
}

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  apiVersion: string;
  maxNetworkRetries: number;
  timeoutMs: number;
}

export interface NowPaymentsConfig {
  apiKey: string;
  ipnSecret: string;
  apiBaseUrl: string;
  webhookBaseUrl?: string;
  timeoutMs: number;
}

export interface CheckoutConfig {
  successUrl: string;
  cancelUrl: string;
  defaultCurrency: string;
  expirationMinutes: number;
  idempotencyTtlSeconds: number;
}

export interface WebhookConfig {
  enabled: boolean;
  toleranceSeconds: number;
  replayWindowSeconds: number;
  maxRetries: number;
  retryDelayMs: number;
}

export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  timeoutMs: number;
}

@Injectable()
export class PaymentConfigService {
  private readonly config: PaymentProviderConfig;

  constructor(private readonly appConfig: AppConfigService) {
    this.config = this.buildConfig();
  }

  get provider(): PaymentProvider {
    return this.config.provider;
  }

  get isEnabled(): boolean {
    return this.config.enabled;
  }

  get checkout(): CheckoutConfig {
    return this.config.checkout;
  }

  get webhook(): WebhookConfig {
    return this.config.webhook;
  }

  get retry(): RetryConfig {
    return this.config.retry;
  }

  get stripe(): StripeConfig | undefined {
    return this.config.stripe;
  }

  get nowpayments(): NowPaymentsConfig | undefined {
    return this.config.nowpayments;
  }

  getProviderConfig(): PaymentProviderConfig {
    // Return safe copy without secrets for logging/diagnostics
    return {
      provider: this.config.provider,
      enabled: this.config.enabled,
      checkout: this.config.checkout,
      webhook: this.config.webhook,
      retry: this.config.retry,
      stripe: this.config.stripe
        ? {
            secretKey: this.redactSecret(this.config.stripe.secretKey),
            webhookSecret: this.redactSecret(this.config.stripe.webhookSecret),
            apiVersion: this.config.stripe.apiVersion,
            maxNetworkRetries: this.config.stripe.maxNetworkRetries,
            timeoutMs: this.config.stripe.timeoutMs,
          }
        : undefined,
      nowpayments: this.config.nowpayments
        ? {
            apiKey: this.redactSecret(this.config.nowpayments.apiKey),
            ipnSecret: this.redactSecret(this.config.nowpayments.ipnSecret),
            apiBaseUrl: this.config.nowpayments.apiBaseUrl,
            webhookBaseUrl: this.config.nowpayments.webhookBaseUrl,
            timeoutMs: this.config.nowpayments.timeoutMs,
          }
        : undefined,
    };
  }

  isProviderEnabled(provider: PaymentProvider): boolean {
    if (provider === PaymentProvider.NONE) {
      return false;
    }
    if (this.config.provider === PaymentProvider.NONE) {
      return false;
    }
    if (provider === PaymentProvider.STRIPE) {
      return !!this.config.stripe?.secretKey && !!this.config.stripe?.webhookSecret;
    }
    if (provider === PaymentProvider.NOWPAYMENTS) {
      return !!this.config.nowpayments?.apiKey;
    }
    return false;
  }

  getStripeSecretKey(): string {
    const key = this.config.stripe?.secretKey;
    if (!key) {
      throw new Error('Stripe secret key not configured');
    }
    return key;
  }

  getStripeWebhookSecret(): string {
    const secret = this.config.stripe?.webhookSecret;
    if (!secret) {
      throw new Error('Stripe webhook secret not configured');
    }
    return secret;
  }

  getNowPaymentsApiKey(): string {
    const key = this.config.nowpayments?.apiKey;
    if (!key) {
      throw new Error('NowPayments API key not configured');
    }
    return key;
  }

  getNowPaymentsIpnSecret(): string | undefined {
    return this.config.nowpayments?.ipnSecret;
  }

  private buildConfig(): PaymentProviderConfig {
    const providerRaw = this.appConfig.billingProvider as string;
    const provider = this.parseProvider(providerRaw);

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
    const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
    const nowpaymentsApiKey = process.env.NOWPAYMENTS_API_KEY || '';
    const nowpaymentsIpnSecret = process.env.NOWPAYMENTS_IPN_SECRET || '';

    const publicUrl = this.appConfig.publicUrl || 'http://localhost:4000';
    const adminWebUrl = this.appConfig.adminWebUrl || 'http://localhost:3000';

    const config: PaymentProviderConfig = {
      provider,
      enabled: provider !== PaymentProvider.NONE,
      checkout: {
        successUrl: `${adminWebUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${adminWebUrl}/billing/cancel`,
        defaultCurrency: 'USD',
        expirationMinutes: 60,
        idempotencyTtlSeconds: 24 * 60 * 60,
      },
      webhook: {
        enabled: true,
        toleranceSeconds: 300,
        replayWindowSeconds: 24 * 60 * 60,
        maxRetries: 3,
        retryDelayMs: 1000,
      },
      retry: {
        maxAttempts: 3,
        initialDelayMs: 1000,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
        timeoutMs: 30000,
      },
    };

    if (stripeSecretKey) {
      config.stripe = {
        secretKey: stripeSecretKey,
        webhookSecret: stripeWebhookSecret,
        apiVersion: '2023-10-16',
        maxNetworkRetries: 2,
        timeoutMs: 30000,
      };
    }

    if (nowpaymentsApiKey) {
      config.nowpayments = {
        apiKey: nowpaymentsApiKey,
        ipnSecret: nowpaymentsIpnSecret,
        apiBaseUrl: 'https://api.nowpayments.io/v1',
        timeoutMs: 30000,
      };
    }

    return config;
  }

  private parseProvider(raw: string): PaymentProvider {
    switch (raw?.toLowerCase()) {
      case 'stripe':
        return PaymentProvider.STRIPE;
      case 'nowpayments':
        return PaymentProvider.NOWPAYMENTS;
      case 'none':
      case '':
      case undefined:
        return PaymentProvider.NONE;
      default:
        return PaymentProvider.NONE;
    }
  }

  private redactSecret(secret: string): string {
    if (!secret || secret.length < 8) {
      return '***';
    }
    return `${secret.substring(0, 4)}***${secret.substring(secret.length - 4)}`;
  }
}
