import { Injectable, Logger } from '@nestjs/common';
import { PaymentProvider } from './payment.types';
import { PaymentConfigService } from './payment.config';
import { PaymentProviderFactory } from './payment-provider.factory';
import type { WebhookPayload, WebhookVerificationResult } from './webhook.types';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '@wlct/shared-types';

/**
 * Provider-specific webhook signature verification abstraction and safe
 * verification helpers; must never persist or log raw secrets.
 *
 * Every provider webhook must pass:
 *  raw request body → provider signature/authentication verification
 *  → provider event ID extraction → replay/idempotency check
 *  → event normalization → state validation → payment update
 *  → subscription synchronization
 *
 * Do not process unverified webhook payloads.
 * Do not log raw authorization secrets.
 * Do not log full sensitive webhook payloads.
 */

@Injectable()
export class WebhookSignatureService {
  private readonly logger = new Logger(WebhookSignatureService.name);

  constructor(
    private readonly config: PaymentConfigService,
    private readonly providerFactory: PaymentProviderFactory,
  ) {}

  async verifySignature(payload: WebhookPayload): Promise<WebhookVerificationResult> {
    const provider = payload.provider;

    if (provider === PaymentProvider.NONE) {
      throw new AppException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Payment provider must be specified for webhook verification',
      });
    }

    try {
      const providerAdapter = this.providerFactory.getProvider(provider);

      const verificationResult = await providerAdapter.verifyWebhookSignature({
        rawBody: payload.rawBody,
        signature: payload.signature,
        timestamp: payload.timestamp,
      });

      if (!verificationResult.verified) {
        this.logger.warn(`Webhook signature verification failed for provider ${provider}: ${verificationResult.failureReason}`);

        return {
          verified: false,
          provider,
          failureReason: verificationResult.failureReason || 'Signature verification failed',
        };
      }

      this.logger.log(`Webhook signature verified for provider ${provider}, event ${verificationResult.eventId}`);

      return {
        verified: true,
        provider,
        providerEventId: verificationResult.eventId,
        eventType: verificationResult.eventType,
        rawEvent: verificationResult.rawEvent,
      };
    } catch (error) {
      if (error instanceof AppException) {
        throw error;
      }

      this.logger.error(`Webhook verification error for provider ${provider}: ${(error as Error).message}`);

      return {
        verified: false,
        provider,
        failureReason: (error as Error).message,
      };
    }
  }

  async verifyStripeSignature(rawBody: Buffer | string, signature: string): Promise<WebhookVerificationResult> {
    return this.verifySignature({
      provider: PaymentProvider.STRIPE,
      rawBody,
      signature,
    });
  }

  async verifyNowPaymentsSignature(rawBody: Buffer | string, signature: string): Promise<WebhookVerificationResult> {
    return this.verifySignature({
      provider: PaymentProvider.NOWPAYMENTS,
      rawBody,
      signature,
    });
  }

  extractEventId(provider: PaymentProvider, rawEvent: unknown): string | null {
    try {
      const event = rawEvent as any;

      switch (provider) {
        case PaymentProvider.STRIPE:
          return event.id || null;

        case PaymentProvider.NOWPAYMENTS:
          return event.payment_id?.toString() || event.order_id || null;

        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  extractEventType(provider: PaymentProvider, rawEvent: unknown): string | null {
    try {
      const event = rawEvent as any;

      switch (provider) {
        case PaymentProvider.STRIPE:
          return event.type || null;

        case PaymentProvider.NOWPAYMENTS:
          return event.payment_status || null;

        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  computeEventHash(provider: PaymentProvider, providerEventId: string, eventType: string, payload?: unknown): string {
    try {
      const crypto = require('crypto');
      const data = `${provider}:${providerEventId}:${eventType}:${payload ? JSON.stringify(payload).substring(0, 500) : ''}`;
      return crypto.createHash('sha256').update(data).digest('hex');
    } catch {
      // Fallback hash
      return `${provider}_${providerEventId}_${eventType}_${Date.now()}`.substring(0, 64);
    }
  }

  isSignaturePresent(signature: string | undefined | null): boolean {
    return !!signature && signature.length > 0;
  }

  sanitizeHeadersForLogging(headers: Record<string, string> | undefined): Record<string, string> {
    if (!headers) return {};

    const sanitized: Record<string, string> = {};
    const sensitiveHeaders = ['authorization', 'x-api-key', 'stripe-signature', 'x-nowpayments-sig'];

    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveHeaders.some((s) => lowerKey.includes(s.toLowerCase()))) {
        sanitized[key] = '***REDACTED***';
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}
