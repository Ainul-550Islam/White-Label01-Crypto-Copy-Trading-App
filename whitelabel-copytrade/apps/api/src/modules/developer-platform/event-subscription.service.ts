/**
 * Maps authoritative platform events into developer-visible envelopes.
 *
 * There is NO second event source of truth: `projectEvent` accepts an
 * authoritative domain observation (source module, domain record id,
 * correlation id, tenant) and either projects a developer envelope for a
 * matching ACTIVE subscription or reports that no subscription wants it.
 * Tenant scoping is absolute: an event of tenant A can never be projected
 * into a subscription of tenant B (CHECK 42).
 */

import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  buildEventEnvelope,
  DEVELOPER_EVENT_TYPES,
  eventDefinition,
  eventMatchesFilter,
  idempotencyKey,
  type DeveloperEventEnvelope,
  type EventSubscriptionFilter,
} from './developer.types';
import { WebhookDeliveryService } from './webhook-delivery.service';

/** An observation from an AUTHORITATIVE domain (never built by developers). */
export interface AuthoritativeEventObservation {
  tenantId: string;
  source: string;
  eventType: string;
  domainRecordId: string;
  occurredAt: Date;
  correlationId: string;
  payload: Record<string, unknown>;
}

export interface ProjectionOutcome {
  /** True when at least one ACTIVE subscription accepted the event. */
  delivered: boolean;
  /** Delivery rows created (one per accepting subscription). */
  deliveryIds: string[];
}

@Injectable()
export class EventSubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: WebhookDeliveryService,
  ) {}

  /**
   * Projects one authoritative observation to all matching subscriptions of
   * the SAME tenant. Deterministic: same observation + same subscriptions =
   * same envelope eventId (idempotency key from domain record + event type),
   * so re-running a projection cannot double-deliver (CHECK 44 support).
   */
  async projectEvent(observation: AuthoritativeEventObservation): Promise<ProjectionOutcome> {
    const definition = eventDefinition(observation.eventType);
    if (!definition || definition.source !== observation.source) {
      // Unknown or source-mismatched events NEVER become deliveries: an
      // unknown webhook event must not turn into a success mutation.
      return { delivered: false, deliveryIds: [] };
    }
    const envelope = buildEventEnvelope({
      eventId: idempotencyKey(
        observation.tenantId,
        'developer.event',
        `${observation.eventType}|${observation.domainRecordId}`,
      ),
      eventType: observation.eventType,
      tenantId: observation.tenantId,
      occurredAt: observation.occurredAt.toISOString(),
      correlationId: observation.correlationId,
      payload: observation.payload,
    });

    const subscriptions = await this.prisma.developerWebhookSubscription.findMany({
      where: {
        tenantId: observation.tenantId,
        state: 'ACTIVE',
        revokedAt: null,
        eventTypes: { has: observation.eventType },
      },
    });

    const deliveryIds: string[] = [];
    for (const subscription of subscriptions) {
      const filter: EventSubscriptionFilter = {
        eventTypes: subscription.eventTypes,
        eventVersion: subscription.eventVersion,
      };
      if (!eventMatchesFilter(envelope, filter)) {
        continue;
      }
      const record = await this.delivery.enqueue({
        tenantId: observation.tenantId,
        subscriptionId: subscription.id,
        applicationId: subscription.applicationId,
        envelope,
        idempotencyKey: idempotencyKey(
          observation.tenantId,
          'webhook.delivery',
          `${subscription.id}|${envelope.eventId}`,
        ),
        environment: subscription.environment,
      });
      deliveryIds.push(record.id);
    }
    return { delivered: deliveryIds.length > 0, deliveryIds };
  }

  /** Portal-facing list of event types a subscription may choose from. */
  catalog(): { eventType: string; resourceType: string; eventVersion: string; source: string }[] {
    return DEVELOPER_EVENT_TYPES.map((definition) => ({ ...definition }));
  }
}
