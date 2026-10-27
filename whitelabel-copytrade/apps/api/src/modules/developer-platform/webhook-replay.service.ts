/**
 * Authorized webhook replay.
 *
 * A replay preserves the ORIGINAL event id (consumers dedupe on it) but
 * creates a DISTINCT delivery attempt row with its own idempotency key
 * scoped by `replay:`. Replay is refused for revoked/paused subscriptions,
 * unknown events for that subscription, and foreign tenants. Every replay
 * is audited. Replay can never double-mutate business state: the platform's
 * authoritative domains own their state; developer deliveries are
 * notifications, and consumer-side idempotency is contractually keyed on
 * the (immutable) event id.
 */

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { validateDeveloperEventPayload } from './event-schemas/developer-event-schemas';
import { idempotencyKey } from './developer.types';
import { DeveloperAuditService, type DeveloperAuditActor } from './developer-audit.service';
import { WebhookDeliveryService } from './webhook-delivery.service';

@Injectable()
export class WebhookReplayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DeveloperAuditService,
    private readonly delivery: WebhookDeliveryService,
  ) {}

  async replay(
    actor: DeveloperAuditActor,
    subscriptionId: string,
    eventId: string,
    requestKey?: string,
  ): Promise<{ deliveryId: string; eventId: string }> {
    const subscription = await this.prisma.withTenantRls(actor.tenantId, (tx) => tx.developerWebhookSubscription.findUnique({
      where: { id: subscriptionId },
    }));
    if (!subscription || subscription.tenantId !== actor.tenantId) {
      throw new NotFoundException('webhook subscription not found');
    }
    if (subscription.revokedAt || subscription.state === 'PAUSED') {
      throw new NotFoundException('webhook subscription is not active');
    }
    // The event must exist in the subscription's delivery history (the
    // persisted event record is the replay source — no synthesized events).
    const original = await this.prisma.withTenantRls(actor.tenantId, (tx) => tx.developerWebhookDelivery.findFirst({
      where: { tenantId: actor.tenantId, subscriptionId, eventId },
      orderBy: { createdAt: 'asc' },
    }));
    if (!original) {
      throw new NotFoundException('event has no delivery history for this subscription');
    }

    // The public controller requires a caller-supplied intent key. A dedicated
    // partial unique index provides atomic, tenant-scoped deduplication even
    // if two servers receive the same request concurrently. The fallback is
    // retained only for pre-existing internal callers without a request key.
    const replayKey = requestKey
      ? `replay2:${idempotencyKey(actor.tenantId, 'webhook.delivery.replay.request', requestKey)}`
      : idempotencyKey(actor.tenantId, 'webhook.delivery.replay', `${subscriptionId}|${eventId}|${new Date().toISOString().slice(0, 13)}`);
    const findReplay = () => this.prisma.withTenantRls(actor.tenantId, (tx) => tx.developerWebhookDelivery.findFirst({
      where: { tenantId: actor.tenantId, idempotencyKey: replayKey },
    }));
    const resolveReplay = (row: { id: string; subscriptionId: string; eventId: string }) => {
      if (row.subscriptionId !== subscriptionId || row.eventId !== eventId) {
        throw new ConflictException('idempotency key already used for a different replay');
      }
      return { deliveryId: row.id, eventId: row.eventId };
    };
    const existingReplay = await findReplay();
    if (existingReplay) return resolveReplay(existingReplay);

    if (original.payload === null || typeof original.payload !== 'object' || Array.isArray(original.payload)) {
      throw new Error('Persisted webhook payload is not a JSON object; refusing replay');
    }
    const payloadJson = JSON.stringify(original.payload);
    if (typeof payloadJson !== 'string') {
      throw new Error('Persisted webhook payload is not JSON-serializable; refusing replay');
    }
    const payload = JSON.parse(payloadJson) as Prisma.InputJsonValue;
    const validation = validateDeveloperEventPayload(original.eventType, payload);
    if (!validation.valid) {
      throw new Error('Persisted webhook payload no longer matches its versioned schema; refusing replay');
    }

    let delivery: { id: string };
    try {
      delivery = await this.prisma.withTenantRls(actor.tenantId, async (tx) => {
        // Serialize with pause/revoke so replay cannot race a state change.
        await tx.$queryRaw`SELECT "id" FROM "developer_webhook_subscriptions"
          WHERE "tenant_id" = ${actor.tenantId}::uuid AND "id" = ${subscriptionId}::uuid FOR UPDATE`;
        const current = await tx.developerWebhookSubscription.findUnique({ where: { id: subscriptionId } });
        if (!current || current.tenantId !== actor.tenantId || current.revokedAt || current.state !== 'ACTIVE') {
          throw new NotFoundException('webhook subscription is not active');
        }
        const row = await tx.developerWebhookDelivery.create({
          data: {
            tenantId: actor.tenantId,
            subscriptionId,
            applicationId: current.applicationId,
            eventId, // ORIGINAL id preserved (consumer dedupe contract)
            eventType: original.eventType,
            eventVersion: original.eventVersion,
            source: original.source,
            occurredAt: original.occurredAt,
            payload,
            attempt: 0,
            state: 'QUEUED',
            correlationId: original.correlationId,
            idempotencyKey: replayKey,
            environment: current.environment,
            replayOfDeliveryId: original.id,
          },
        });
        await this.audit.record({
          ...actor,
          applicationId: current.applicationId,
          action: 'webhook.replay',
          detail: { subscriptionId, eventId, deliveryId: row.id, originalDeliveryId: original.id },
        }, tx);
        return row;
      });
    } catch (error) {
      // A concurrent insertion may have won the unique-index race.
      if ((error as { code?: string }).code !== 'P2002') throw error;
      const winner = await findReplay();
      if (!winner) throw error;
      return resolveReplay(winner);
    }
    return { deliveryId: delivery.id, eventId };
  }
}
