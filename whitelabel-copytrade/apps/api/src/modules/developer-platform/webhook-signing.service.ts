/**
 * Webhook signature generation/verification.
 *
 * Scheme: HMAC-SHA256 over the canonical string
 *   `t=<unix-seconds>.id=<eventId>.v=<eventVersion>.<rawBody>`
 * delivered as `X-Webhook-Signature: v1=<hex>`, with `X-Webhook-Timestamp`
 * carried alongside. Verification is constant-time and enforces a policy
 * timestamp tolerance so captured requests cannot be replayed later
 * (CHECKS 31-33). Secrets never appear in logs or serialized envelopes.
 */

import { Injectable } from '@nestjs/common';

import {
  canonicalWebhookString,
  constantTimeEqual,
  DEVELOPER_ERROR_CODES,
  DeveloperError,
  generateWebhookSecret,
  signWebhook,
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_VERSION,
} from './developer.types';
import { DeveloperPolicyService } from './developer-policy.service';

export interface SignatureHeaderSet {
  'X-Webhook-Timestamp': string;
  'X-Webhook-Event-Id': string;
  'X-Webhook-Version': string;
  'X-Webhook-Signature': string;
}

/** Port over the existing crypto infrastructure (encrypt-at-rest). */
export interface DeveloperSecretCipher {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

export const DEVELOPER_SECRET_CIPHER = Symbol('DEVELOPER_SECRET_CIPHER');

@Injectable()
export class WebhookSigningService {
  constructor(private readonly policyService: DeveloperPolicyService) {}

  /** New per-subscription endpoint secret (shown once by the controller). */
  newSecret(): string {
    return generateWebhookSecret();
  }

  sign(input: { timestamp: number; eventId: string; version: string; body: string; secret: string }): string {
    if (!input.secret.startsWith('whsec_')) {
      // Misconfiguration is its own classification upstream; signing with a
      // wrong-shaped secret is refused rather than producing garbage.
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.WEBHOOK_SIGNATURE_INVALID,
        'webhook secret is not configured correctly',
      );
    }
    return signWebhook(
      { timestamp: input.timestamp, eventId: input.eventId, version: input.version, body: input.body },
      input.secret,
    );
  }

  /** Full header set for an outbound delivery (deterministic given inputs). */
  headersFor(input: {
    timestamp: number;
    eventId: string;
    version: string;
    body: string;
    secret: string;
  }): SignatureHeaderSet {
    return {
      'X-Webhook-Timestamp': String(input.timestamp),
      'X-Webhook-Event-Id': input.eventId,
      'X-Webhook-Version': input.version,
      'X-Webhook-Signature': this.sign(input),
    };
  }

  verify(input: {
    body: string;
    timestamp: number;
    eventId: string;
    version: string;
    signatureHeader: string;
    secret: string;
    nowSeconds: number;
    toleranceSeconds?: number;
  }): void {
    if (!input.signatureHeader.startsWith(`${WEBHOOK_SIGNATURE_VERSION}=`)) {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.WEBHOOK_SIGNATURE_INVALID,
        'unsupported signature scheme',
      );
    }
    verifyWebhookSignature({
      body: input.body,
      timestamp: input.timestamp,
      eventId: input.eventId,
      version: input.version,
      signatureHeader: input.signatureHeader,
      secret: input.secret,
      nowSeconds: input.nowSeconds,
      toleranceSeconds:
        input.toleranceSeconds ?? this.policyService.resolve('platform', { planKey: 'platform', limits: {}, features: [] }, []).webhookTimestampToleranceSeconds,
    });
  }

  /** Exposed for tests/docs: the exact canonical string contract. */
  canonical(material: { timestamp: number; eventId: string; version: string; body: string }): string {
    return canonicalWebhookString(material);
  }

  /** Verification helper reused by SDKs' server-side receivers. */
  verifyWithConstantTime(candidate: string, expected: string): boolean {
    return constantTimeEqual(candidate, expected);
  }
}
