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

import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
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
  ): Promise<{ deliveryId: string; eventId: string }> {
    const subscription = await this.prisma.developerWebhookSubscription.findUnique({
      where: { id: subscriptionId },
    });
    if (!subscription || subscription.tenantId !== actor.tenantId) {
      throw new NotFoundException('webhook subscription not found');
    }
    if (subscription.revokedAt || subscription.state === 'PAUSED') {
      throw new NotFoundException('webhook subscription is not active');
    }
    // The event must exist in the subscription's delivery history (the
    // persisted event record is the replay source — no synthesized events).
    const original = await this.prisma.developerWebhookDelivery.findFirst({
      where: { tenantId: actor.tenantId, subscriptionId, eventId },
      orderBy: { createdAt: 'asc' },
    });
    if (!original) {
      throw new NotFoundException('event has no delivery history for this subscription');
    }

    const replayKey = idempotencyKey(
      actor.tenantId,
      'webhook.delivery.replay',
      `${subscriptionId}|${eventId}|${new Date().toISOString().slice(0, 13)}`, // hourly bucket
    );
    const existingReplay = await this.prisma.developerWebhookDelivery.findFirst({
      where: { tenantId: actor.tenantId, idempotencyKey: replayKey },
    });
    if (existingReplay) {
      // Same-hour duplicate replay request is idempotent, not a new delivery.
      return { deliveryId: existingReplay.id, eventId };
    }

    const delivery = await this.prisma.developerWebhookDelivery.create({
      data: {
        tenantId: actor.tenantId,
        subscriptionId,
        applicationId: subscription.applicationId,
        eventId, // ORIGINAL id preserved (consumer dedupe contract)
        eventType: original.eventType,
        eventVersion: original.eventVersion,
        attempt: 0,
        state: 'QUEUED',
        correlationId: original.correlationId,
        idempotencyKey: replayKey,
        environment: subscription.environment,
        replayOfDeliveryId: original.id,
      },
    });
    await this.audit.record({
      ...actor,
      applicationId: subscription.applicationId,
      action: 'webhook.replay',
      detail: { subscriptionId, eventId, deliveryId: delivery.id, originalDeliveryId: original.id },
    });
    return { deliveryId: delivery.id, eventId };
  }
}
