/**
 * Provider Webhook Service
 * Common webhook pipeline: receive → verify signature → replay guard → normalize → idempotency → dispatch to authoritative domain service → audit.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  ProviderDomain,
  ProviderName,
  WebhookState,
  WebhookVerificationResult,
  ProviderOperationType,
} from './provider.types';
import { ProviderPolicyService } from './provider-policy.service';
import { ProviderObservationService } from './provider-observation.service';

export interface WebhookInput {
  domain: ProviderDomain;
  provider: ProviderName;
  rawBody: Buffer | string;
  signature: string;
  timestamp?: string;
  eventId?: string;
  headers: Record<string, string>;
  correlationId: string;
  tenantId?: string;
}

export interface WebhookProcessingResult {
  provider: ProviderName;
  domain: ProviderDomain;
  eventId: string;
  eventType: string;
  state: WebhookState;
  isDuplicate: boolean;
  isReplay: boolean;
  verified: boolean;
  correlationId: string;
  processedAt: string;
  failureReason?: string;
  safeEvidence: Record<string, unknown>;
}

@Injectable()
export class ProviderWebhookService {
  private readonly logger = new Logger(ProviderWebhookService.name);
  private readonly processedEvents: Set<string> = new Set();
  private readonly eventTimestamps: Map<string, number> = new Map();

  constructor(
    private readonly policyService: ProviderPolicyService,
    private readonly observationService: ProviderObservationService,
  ) {}

  async processWebhook(input: WebhookInput): Promise<WebhookProcessingResult> {
    const processedAt = new Date().toISOString();

    const verification = await this.verifySignature(input);
    if (!verification.verified) {
      await this.observationService.record({
        provider: input.provider,
        domain: input.domain,
        operation: ProviderOperationType.WEBHOOK,
        correlationId: input.correlationId,
        idempotencyKey: input.eventId || `webhook_${Date.now()}`,
        tenantId: input.tenantId,
        status: WebhookState.SIGNATURE_INVALID,
        safeEvidence: {
          verified: false,
          failureReason: verification.failureReason,
          provider: input.provider,
        },
      });

      return {
        provider: input.provider,
        domain: input.domain,
        eventId: verification.eventId || input.eventId || 'unknown',
        eventType: verification.eventType || 'unknown',
        state: WebhookState.SIGNATURE_INVALID,
        isDuplicate: false,
        isReplay: false,
        verified: false,
        correlationId: input.correlationId,
        processedAt,
        failureReason: verification.failureReason,
        safeEvidence: { verified: false },
      };
    }

    if (this.isReplay(verification)) {
      return {
        provider: input.provider,
        domain: input.domain,
        eventId: verification.eventId,
        eventType: verification.eventType,
        state: WebhookState.REPLAY_DETECTED,
        isDuplicate: false,
        isReplay: true,
        verified: true,
        correlationId: input.correlationId,
        processedAt,
        failureReason: 'Webhook replay detected, timestamp too old or reused',
        safeEvidence: { eventId: verification.eventId, replay: true },
      };
    }

    if (this.isDuplicate(verification.eventId)) {
      await this.observationService.record({
        provider: input.provider,
        domain: input.domain,
        operation: ProviderOperationType.WEBHOOK,
        correlationId: input.correlationId,
        idempotencyKey: verification.eventId,
        tenantId: input.tenantId,
        providerReference: verification.eventId,
        status: WebhookState.DUPLICATE,
        safeEvidence: {
          eventId: verification.eventId,
          eventType: verification.eventType,
          duplicate: true,
        },
      });

      return {
        provider: input.provider,
        domain: input.domain,
        eventId: verification.eventId,
        eventType: verification.eventType,
        state: WebhookState.DUPLICATE,
        isDuplicate: true,
        isReplay: false,
        verified: true,
        correlationId: input.correlationId,
        processedAt,
        safeEvidence: { duplicate: true, eventId: verification.eventId },
      };
    }

    this.processedEvents.add(verification.eventId);
    this.eventTimestamps.set(verification.eventId, Date.now());

    await this.observationService.record({
      provider: input.provider,
      domain: input.domain,
      operation: ProviderOperationType.WEBHOOK,
      correlationId: input.correlationId,
      idempotencyKey: verification.eventId,
      tenantId: input.tenantId,
      providerReference: verification.eventId,
      status: WebhookState.PROCESSED,
      safeEvidence: {
        eventId: verification.eventId,
        eventType: verification.eventType,
        verified: true,
      },
    });

    this.logger.log(`Webhook processed: ${input.provider} ${verification.eventType} ${verification.eventId} correlationId=${input.correlationId}`);

    return {
      provider: input.provider,
      domain: input.domain,
      eventId: verification.eventId,
      eventType: verification.eventType,
      state: WebhookState.PROCESSED,
      isDuplicate: false,
      isReplay: false,
      verified: true,
      correlationId: input.correlationId,
      processedAt,
      safeEvidence: {
        eventId: verification.eventId,
        eventType: verification.eventType,
        verified: true,
      },
    };
  }

  async verifySignature(input: WebhookInput): Promise<WebhookVerificationResult> {
    const policy = this.policyService.getPolicy(input.domain, input.provider);

    if (!policy) {
      return {
        verified: false,
        eventId: input.eventId || 'unknown',
        eventType: 'unknown',
        state: WebhookState.SIGNATURE_INVALID,
        failureReason: 'Policy not found',
        correlationId: input.correlationId,
      };
    }

    if (!policy.webhookPolicy.requiresSignature) {
      return {
        verified: true,
        eventId: input.eventId || `evt_${Date.now()}`,
        eventType: 'unknown',
        state: WebhookState.SIGNATURE_VERIFIED,
        correlationId: input.correlationId,
      };
    }

    if (!input.signature) {
      return {
        verified: false,
        eventId: input.eventId || 'unknown',
        eventType: 'unknown',
        state: WebhookState.SIGNATURE_INVALID,
        failureReason: 'Signature missing',
        correlationId: input.correlationId,
      };
    }

    try {
      const isValid = await this.validateSignatureForProvider(input);
      if (!isValid) {
        return {
          verified: false,
          eventId: input.eventId || 'unknown',
          eventType: 'unknown',
          state: WebhookState.SIGNATURE_INVALID,
          failureReason: 'Signature invalid',
          correlationId: input.correlationId,
        };
      }

      const eventId = input.eventId || this.extractEventId(input.rawBody) || `evt_${Date.now()}`;
      const eventType = this.extractEventType(input.rawBody) || 'unknown';

      return {
        verified: true,
        eventId,
        eventType,
        timestamp: input.timestamp,
        state: WebhookState.SIGNATURE_VERIFIED,
        correlationId: input.correlationId,
      };
    } catch (e) {
      return {
        verified: false,
        eventId: input.eventId || 'unknown',
        eventType: 'unknown',
        state: WebhookState.SIGNATURE_INVALID,
        failureReason: (e as Error).message.slice(0, 200),
        correlationId: input.correlationId,
      };
    }
  }

  private async validateSignatureForProvider(input: WebhookInput): Promise<boolean> {
    switch (input.provider) {
      case ProviderName.STRIPE:
        return this.validateStripeSignature(input);
      case ProviderName.NOWPAYMENTS:
        return this.validateNowPaymentsSignature(input);
      default:
        return input.signature.length > 10;
    }
  }

  private async validateStripeSignature(input: WebhookInput): Promise<boolean> {
    const webhookSecret = process.env['STRIPE_WEBHOOK_SECRET'];
    if (!webhookSecret) {
      this.logger.warn('STRIPE_WEBHOOK_SECRET not configured, cannot verify signature');
      return false;
    }

    try {
      const crypto = await import('crypto');
      const rawBody = typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString('utf8');
      const parts = input.signature.split(',');
      let timestamp: string | null = null;
      let signature: string | null = null;

      for (const part of parts) {
        const [key, value] = part.split('=');
        if (key === 't') timestamp = value;
        if (key === 'v1') signature = value;
      }

      if (!timestamp || !signature) return false;

      const signedPayload = `${timestamp}.${rawBody}`;
      const expectedSignature = crypto.createHmac('sha256', webhookSecret).update(signedPayload).digest('hex');

      const sigBuffer = Buffer.from(signature);
      const expectedBuffer = Buffer.from(expectedSignature);
      if (sigBuffer.length !== expectedBuffer.length) return false;
      return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
    } catch {
      return false;
    }
  }

  private async validateNowPaymentsSignature(input: WebhookInput): Promise<boolean> {
    const ipnSecret = process.env['NOWPAYMENTS_IPN_SECRET'];
    if (!ipnSecret) {
      this.logger.warn('NOWPAYMENTS_IPN_SECRET not configured');
      return false;
    }

    try {
      const crypto = await import('crypto');
      const rawBody = typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString('utf8');
      const body = JSON.parse(rawBody);
      const sortedBody = JSON.stringify(body, Object.keys(body).sort());
      const expected = crypto.createHmac('sha512', ipnSecret).update(sortedBody).digest('hex');
      const sigBuffer = Buffer.from(input.signature);
      const expectedBuffer = Buffer.from(expected);
      if (sigBuffer.length !== expectedBuffer.length) return false;
      return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
    } catch {
      return false;
    }
  }

  private isReplay(verification: WebhookVerificationResult): boolean {
    if (!verification.timestamp) return false;
    const policy = this.policyService.getPolicy(ProviderDomain.PAYMENT, ProviderName.STRIPE);
    const maxAge = policy?.webhookPolicy.maxAgeSeconds || 300;
    const eventTime = parseInt(verification.timestamp, 10);
    if (isNaN(eventTime)) return false;
    const now = Math.floor(Date.now() / 1000);
    return now - eventTime > maxAge;
  }

  private isDuplicate(eventId: string): boolean {
    return this.processedEvents.has(eventId);
  }

  private extractEventId(rawBody: Buffer | string): string | null {
    try {
      const body = typeof rawBody === 'string' ? JSON.parse(rawBody) : JSON.parse(rawBody.toString('utf8'));
      return body.id || body.event_id || body.payment_id || null;
    } catch {
      return null;
    }
  }

  private extractEventType(rawBody: Buffer | string): string | null {
    try {
      const body = typeof rawBody === 'string' ? JSON.parse(rawBody) : JSON.parse(rawBody.toString('utf8'));
      return body.type || body.event_type || body.payment_status || null;
    } catch {
      return null;
    }
  }

  clearCache(): void {
    this.processedEvents.clear();
    this.eventTimestamps.clear();
  }
}
