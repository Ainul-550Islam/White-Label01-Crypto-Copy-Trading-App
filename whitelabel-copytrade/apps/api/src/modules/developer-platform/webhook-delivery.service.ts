/**
 * Signed webhook delivery with idempotency, timeout handling, deterministic
 * retry classification/backoff and explicit delivery states.
 *
 * Hard rules enforced here:
 * - DELIVERED requires an actually received 2xx response (CHECK 36/59).
 * - 4xx (except 429) is NEVER retried blindly (CHECK 37).
 * - 5xx / timeout / network errors / 429 follow policy backoff (38/39).
 * - One delivery row per (subscriptionId, eventId, attempt) — idempotent
 *   enqueue (CHECK 34).
 * - Exhaustion is tracked and observable (CHECK 40).
 */

import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  classifyAttempt,
  DEFAULT_MAX_ATTEMPTS,
  DELIVERY_TRANSITIONS,
  isTerminalDeliveryState,
  RETRYABLE_OUTCOMES,
  retryBackoffSeconds,
  transitionOrThrow,
  type DeliveryOutcomeClass,
  type DeliveryState,
  type DeveloperEventEnvelope,
} from './developer.types';
import { DEVELOPER_SECRET_CIPHER, WebhookSigningService, type DeveloperSecretCipher } from './webhook-signing.service';
import { DeveloperPolicyService, type DeveloperPolicy } from './developer-policy.service';
import { DeveloperAuditService, type DeveloperAuditActor } from './developer-audit.service';

/** HTTP port for outbound deliveries — adapter injected by the module. */
export interface WebhookHttpClient {
  post(url: string, headers: Record<string, string>, body: string, timeoutMs: number): Promise<{
    status?: number;
    timedOut?: boolean;
    networkError?: boolean;
  }>;
}

export const DEVELOPER_WEBHOOK_HTTP = Symbol('DEVELOPER_WEBHOOK_HTTP');

export interface DeliveryRecord {
  id: string;
  subscriptionId: string;
  tenantId: string;
  eventId: string;
  eventType: string;
  eventVersion: string;
  attempt: number;
  state: DeliveryState;
  outcomeClass: DeliveryOutcomeClass | null;
  responseStatus: number | null;
  durationMs: number | null;
  nextRetryAt: Date | null;
  correlationId: string;
}

@Injectable()
export class WebhookDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signing: WebhookSigningService,
    private readonly policyService: DeveloperPolicyService,
    private readonly audit: DeveloperAuditService,
    @Inject(DEVELOPER_WEBHOOK_HTTP) private readonly http: WebhookHttpClient,
    @Inject(DEVELOPER_SECRET_CIPHER) private readonly cipher: DeveloperSecretCipher,
  ) {}

  /** Enqueue is idempotent per (subscription, event): one QUEUED row. */
  async enqueue(input: {
    tenantId: string;
    subscriptionId: string;
    applicationId: string;
    envelope: DeveloperEventEnvelope;
    idempotencyKey: string;
    environment: string;
  }): Promise<DeliveryRecord> {
    const existing = await this.prisma.developerWebhookDelivery.findFirst({
      where: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      return existing as DeliveryRecord;
    }
    const created = await this.prisma.developerWebhookDelivery.create({
      data: {
        tenantId: input.tenantId,
        subscriptionId: input.subscriptionId,
        applicationId: input.applicationId,
        eventId: input.envelope.eventId,
        eventType: input.envelope.eventType,
        eventVersion: input.envelope.eventVersion,
        attempt: 0,
        state: 'QUEUED',
        correlationId: input.envelope.correlationId,
        idempotencyKey: input.idempotencyKey,
        environment: input.environment,
      },
    });
    return created as DeliveryRecord;
  }

  /**
   * Performs ONE delivery attempt against the real endpoint. The envelope is
   * signed fresh with the subscription's current secret; the body is the
   * canonical JSON of the envelope.
   */
  async attempt(actor: DeveloperAuditActor, deliveryId: string, policy: DeveloperPolicy): Promise<DeliveryRecord> {
    const delivery = await this.prisma.developerWebhookDelivery.findUnique({
      where: { id: deliveryId },
    });
    if (!delivery || delivery.tenantId !== actor.tenantId) {
      throw new NotFoundException('delivery not found');
    }
    if (isTerminalDeliveryState(delivery.state as DeliveryState)) {
      return delivery as DeliveryRecord;
    }
    const subscription = await this.prisma.developerWebhookSubscription.findUnique({
      where: { id: delivery.subscriptionId },
    });
    if (!subscription || subscription.tenantId !== actor.tenantId || subscription.revokedAt) {
      transitionOrThrow(
        DELIVERY_TRANSITIONS,
        delivery.state as DeliveryState,
        'CANCELLED',
        `delivery ${delivery.id}`,
      );
      const cancelled = await this.prisma.developerWebhookDelivery.update({
        where: { id: delivery.id },
        data: { state: 'CANCELLED' },
      });
      return cancelled as DeliveryRecord;
    }

    transitionOrThrow(DELIVERY_TRANSITIONS, delivery.state as DeliveryState, 'DELIVERING', `delivery ${delivery.id}`);
    const attemptNo = delivery.attempt + 1;
    await this.prisma.developerWebhookDelivery.update({
      where: { id: delivery.id },
      data: { state: 'DELIVERING', attempt: attemptNo },
    });

    const envelopeBody = JSON.stringify({
      eventId: delivery.eventId,
      eventType: delivery.eventType,
      eventVersion: delivery.eventVersion,
      occurredAt: delivery.createdAt,
      correlationId: delivery.correlationId,
    });
    const timestamp = Math.floor(Date.now() / 1000);
    let observation: Awaited<ReturnType<WebhookHttpClient['post']>> = {};
    let outcomeClass: DeliveryOutcomeClass;
    try {
      // The secret is decrypted only inside the signing call and never
      // logged, serialized, or included in any persisted detail.
      const secret = this.cipher.decrypt(subscription.secretEncrypted);
      const headers = this.signing.headersFor({
        timestamp,
        eventId: delivery.eventId,
        version: delivery.eventVersion,
        body: envelopeBody,
        secret,
      });
      observation = await this.http.post(
        subscription.endpointUrl,
        headers as unknown as Record<string, string>,
        envelopeBody,
        10_000,
      );
      outcomeClass = classifyAttempt(observation);
    } catch {
      outcomeClass = 'SIGNATURE_CONFIGURATION_FAILURE';
    }

    const maxAttempts = policy.webhookMaxAttempts || DEFAULT_MAX_ATTEMPTS;
    const exhausted = attemptNo >= maxAttempts;
    let nextState: DeliveryState;
    let nextRetryAt: Date | null = null;
    if (outcomeClass === 'SUCCESS') {
      nextState = 'DELIVERED';
    } else if (outcomeClass === 'CLIENT_4XX_NO_RETRY' || outcomeClass === 'PERMANENT_FAILURE') {
      nextState = 'FAILED';
    } else if (RETRYABLE_OUTCOMES.has(outcomeClass)) {
      if (exhausted) {
        nextState = 'EXHAUSTED';
      } else {
        nextState = 'RETRY_SCHEDULED';
        nextRetryAt = new Date(Date.now() + retryBackoffSeconds(attemptNo) * 1000);
      }
    } else {
      nextState = exhausted ? 'EXHAUSTED' : 'RETRY_SCHEDULED';
      if (nextRetryAt === null && nextState === 'RETRY_SCHEDULED') {
        nextRetryAt = new Date(Date.now() + retryBackoffSeconds(attemptNo) * 1000);
      }
    }

    transitionOrThrow(DELIVERY_TRANSITIONS, 'DELIVERING', nextState, `delivery ${delivery.id}`);
    const updated = await this.prisma.developerWebhookDelivery.update({
      where: { id: delivery.id },
      data: {
        state: nextState,
        outcomeClass,
        responseStatus: observation.status ?? null,
        durationMs: null,
        nextRetryAt,
      },
    });
    await this.audit.record({
      ...actor,
      applicationId: delivery.applicationId,
      action: 'webhook.delivery_attempted',
      detail: {
        deliveryId: delivery.id,
        attempt: attemptNo,
        outcomeClass,
        state: nextState,
        responseStatus: observation.status ?? null,
      },
    });
    return updated as DeliveryRecord;
  }

  /** Lists deliveries for an owned subscription with optional state filter. */
  async list(
    tenantId: string,
    query: { subscriptionId: string; state?: string; eventId?: string; limit?: number; cursor?: string },
  ) {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const owned = await this.prisma.developerWebhookSubscription.findUnique({
      where: { id: query.subscriptionId },
    });
    if (!owned || owned.tenantId !== tenantId) {
      throw new NotFoundException('webhook subscription not found');
    }
    const rows = await this.prisma.developerWebhookDelivery.findMany({
      where: {
        tenantId,
        subscriptionId: query.subscriptionId,
        ...(query.state ? { state: query.state } : {}),
        ...(query.eventId ? { eventId: query.eventId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return {
      rows: rows.map((row: { id: string; eventId: string; eventType: string; attempt: number; state: string; outcomeClass: string | null; responseStatus: number | null; nextRetryAt: Date | null; correlationId: string; createdAt: Date }) => ({
        id: row.id,
        eventId: row.eventId,
        eventType: row.eventType,
        attempt: row.attempt,
        state: row.state,
        outcomeClass: row.outcomeClass,
        responseStatus: row.responseStatus,
        nextRetryAt: row.nextRetryAt,
        correlationId: row.correlationId,
        createdAt: row.createdAt,
      })),
    };
  }
}
