/**
 * Signed webhook delivery with idempotency, timeout handling, deterministic
 * retry classification/backoff and explicit delivery states.
 *
 * Hard rules enforced here:
 * - DELIVERED requires an actually received 2xx response (CHECK 36/59).
 * - 4xx (except 429) is NEVER retried blindly (CHECK 37).
 * - 5xx / timeout / network errors / 429 follow policy backoff (38/39).
 * - Enqueue is idempotent by tenant-scoped delivery key; replay uses a
 *   distinct replay-scoped key while preserving the original event id.
 * - Exhaustion is tracked and observable (CHECK 40).
 */

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Prisma } from '@prisma/client';

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
import { developerEventPayloadSchema, validateDeveloperEventPayload } from './event-schemas/developer-event-schemas';

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
  source: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
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

  /** Enqueue is idempotent by tenant-scoped delivery idempotency key. */
  async enqueue(input: {
    tenantId: string;
    subscriptionId: string;
    applicationId: string;
    envelope: DeveloperEventEnvelope;
    idempotencyKey: string;
    environment: string;
  }, transaction?: Prisma.TransactionClient): Promise<DeliveryRecord> {
    // Take an immutable JSON snapshot before the first await. The outbox path
    // validates event schemas, while enqueue remains independently usable by
    // replay; either way, later caller mutation cannot rewrite a queued body.
    const payloadJson = JSON.stringify(input.envelope.payload);
    if (typeof payloadJson !== 'string') {
      throw new Error('webhook event payload must be a JSON-serializable object');
    }
    const payload = JSON.parse(payloadJson) as Prisma.InputJsonValue;
    if (!transaction) {
      const snapshot = { ...input, envelope: { ...input.envelope, payload: JSON.parse(payloadJson) as Record<string, unknown> } };
      return this.prisma.withTenantRls(input.tenantId, (tx) => this.enqueue(snapshot, tx));
    }
    const database = transaction;
    const existing = await database.developerWebhookDelivery.findFirst({
      where: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      return existing as DeliveryRecord;
    }
    const created = await database.developerWebhookDelivery.create({
      data: {
        tenantId: input.tenantId,
        subscriptionId: input.subscriptionId,
        applicationId: input.applicationId,
        eventId: input.envelope.eventId,
        eventType: input.envelope.eventType,
        eventVersion: input.envelope.eventVersion,
        source: input.envelope.source,
        occurredAt: new Date(input.envelope.occurredAt),
        payload,
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
  async attempt(
    actor: DeveloperAuditActor,
    deliveryId: string,
    policy: DeveloperPolicy,
    transaction?: Prisma.TransactionClient,
  ): Promise<DeliveryRecord> {
    if (!transaction) {
      if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(actor.tenantId)) {
        throw new Error('delivery attempt requires a canonical tenant UUID');
      }
      return this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.tenant_id', ${actor.tenantId}, true)`;
        return this.attempt(actor, deliveryId, policy, tx);
      }, { timeout: 20_000, maxWait: 5_000 });
    }
    // The dispatcher already holds this lock. Direct callers take it too so
    // two processes can never run simultaneous attempts for the same row.
    await transaction.$queryRaw`
      SELECT "id" FROM "developer_webhook_deliveries"
      WHERE "id" = ${deliveryId}::uuid AND "tenant_id" = ${actor.tenantId}::uuid
      FOR UPDATE
    `;
    const delivery = await transaction.developerWebhookDelivery.findUnique({
      where: { id: deliveryId },
    });
    if (!delivery || delivery.tenantId !== actor.tenantId) {
      throw new NotFoundException('delivery not found');
    }
    if (isTerminalDeliveryState(delivery.state as DeliveryState)) {
      return delivery as DeliveryRecord;
    }
    // Serialize the start of an outbound request with pause/revoke/rotation.
    // A completed pause therefore cannot leave a newly-started send behind.
    await transaction.$queryRaw`
      SELECT "id" FROM "developer_webhook_subscriptions"
      WHERE "id" = ${delivery.subscriptionId}::uuid AND "tenant_id" = ${actor.tenantId}::uuid
      FOR SHARE
    `;
    const subscription = await transaction.developerWebhookSubscription.findUnique({
      where: { id: delivery.subscriptionId },
    });
    if (!subscription || subscription.tenantId !== actor.tenantId || subscription.revokedAt) {
      transitionOrThrow(
        DELIVERY_TRANSITIONS,
        delivery.state as DeliveryState,
        'CANCELLED',
        `delivery ${delivery.id}`,
      );
      const cancelled = await transaction.developerWebhookDelivery.update({
        where: { id: delivery.id },
        data: { state: 'CANCELLED', nextRetryAt: null },
      });
      await this.audit.record({
        ...actor,
        applicationId: delivery.applicationId,
        action: 'webhook.delivery_cancelled',
        detail: { deliveryId: delivery.id, state: 'CANCELLED' },
      }, transaction);
      return cancelled as DeliveryRecord;
    }
    // Pause or a downgraded plan is a hold, not an invitation to send queued events.
    if (subscription.state !== 'ACTIVE' || !policy.allowedScopes?.includes('webhooks:manage') ||
        !subscription.eventTypes.includes(delivery.eventType) || subscription.eventVersion !== delivery.eventVersion) {
      return delivery as DeliveryRecord;
    }
    // Serialize the start of a send with application suspension, revocation,
    // and scope changes. Recheck after acquiring the lock, not only when the
    // delivery was selected, and never trust a mismatched legacy relation.
    await transaction.$queryRaw`
      SELECT "id" FROM "developer_applications"
      WHERE "id" = ${delivery.applicationId}::uuid AND "tenant_id" = ${actor.tenantId}::uuid
      FOR SHARE
    `;
    const application = await transaction.developerApplication.findUnique({ where: { id: delivery.applicationId } });
    if (!application || application.tenantId !== actor.tenantId || application.id !== subscription.applicationId ||
        application.state !== 'ACTIVE' || !application.scopes.includes('webhooks:manage') ||
        application.environment !== subscription.environment || delivery.environment !== subscription.environment) {
      return delivery as DeliveryRecord;
    }

    transitionOrThrow(DELIVERY_TRANSITIONS, delivery.state as DeliveryState, 'DELIVERING', `delivery ${delivery.id}`);
    const attemptNo = delivery.attempt + 1;
    await transaction.developerWebhookDelivery.update({
      where: { id: delivery.id },
      data: { state: 'DELIVERING', attempt: attemptNo },
    });

    const envelopeBody = JSON.stringify({
      eventId: delivery.eventId,
      eventType: delivery.eventType,
      eventVersion: delivery.eventVersion,
      occurredAt: delivery.occurredAt,
      correlationId: delivery.correlationId,
      source: delivery.source,
      payload: delivery.payload,
    });
    const timestamp = Math.floor(Date.now() / 1000);
    let observation: Awaited<ReturnType<WebhookHttpClient['post']>> = {};
    let outcomeClass: DeliveryOutcomeClass;
    try {
      // Fail closed for legacy/corrupt rows. Never send an unknown version or
      // an arbitrary stored body which did not pass the event's schema.
      if (delivery.eventVersion !== 'v1' ||
          !validateDeveloperEventPayload(delivery.eventType, delivery.payload).valid) {
        throw new InvalidDeliveryPayload();
      }
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
    } catch (error) {
      outcomeClass = error instanceof InvalidDeliveryPayload ? 'PERMANENT_FAILURE' : 'SIGNATURE_CONFIGURATION_FAILURE';
    }

    const maxAttempts = policy.webhookMaxAttempts || DEFAULT_MAX_ATTEMPTS;
    const exhausted = attemptNo >= maxAttempts;
    let nextState: DeliveryState;
    let nextRetryAt: Date | null = null;
    if (outcomeClass === 'SUCCESS') {
      nextState = 'DELIVERED';
    } else if (outcomeClass === 'CLIENT_4XX_NO_RETRY' || outcomeClass === 'PERMANENT_FAILURE' || outcomeClass === 'SIGNATURE_CONFIGURATION_FAILURE') {
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
    const updated = await transaction.developerWebhookDelivery.update({
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
    }, transaction);
    return updated as DeliveryRecord;
  }

  /** Lists one stable, tenant- and filter-scoped page of redacted deliveries. */
  async list(
    tenantId: string,
    query: { subscriptionId: string; state?: string; eventId?: string; limit?: number; cursor?: string },
  ) {
    return this.prisma.withTenantRls(tenantId, async (transaction) => {
      const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
      const owned = await transaction.developerWebhookSubscription.findUnique({
        where: { id: query.subscriptionId },
      });
      if (!owned || owned.tenantId !== tenantId) {
        throw new NotFoundException('webhook subscription not found');
      }
      const where = {
        tenantId,
        subscriptionId: query.subscriptionId,
        ...(query.state ? { state: query.state } : {}),
        ...(query.eventId ? { eventId: query.eventId } : {}),
      };
      if (query.cursor) {
        // A foreign, malformed, deleted or differently filtered cursor is never
        // used to select the starting point of this tenant's page.
        if (!isUUID(query.cursor) || !await transaction.developerWebhookDelivery.findFirst({
          where: { ...where, id: query.cursor }, select: { id: true },
        })) {
          throw new BadRequestException('invalid delivery cursor');
        }
      }
      const rows = await transaction.developerWebhookDelivery.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, limit);
      return {
        rows: page.map((row) => ({
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
          payload: redactedPayload(row.eventType, row.eventVersion, row.payload),
        })),
        nextCursor: rows.length > limit ? page[page.length - 1].id : null,
      };
    });
  }
}

class InvalidDeliveryPayload extends Error {}

/**
 * Never pass arbitrary stored payload data through to the portal. Recognized,
 * valid v1 schemas may reveal a constrained enum; every other value is
 * masked. Unknown versions, unknown event types and invalid payloads are not
 * displayed at all. This also prevents a secret hidden in an identifier or
 * free-form string from leaking even if its field name looked innocuous.
 */
function redactedPayload(eventType: string, eventVersion: string, payload: unknown): Record<string, unknown> | null {
  const schema = developerEventPayloadSchema(eventType);
  if (eventVersion !== 'v1' || !schema || !validateDeveloperEventPayload(eventType, payload).valid ||
      payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const result: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(payload)) {
    const field = schema.properties[name];
    if (!field) return null;
    // Enums are defined by platform code, never by the request or stored row.
    result[name] = field?.enum?.some((allowed) => allowed === value) ? value : '[REDACTED]';
  }
  return result;
}
