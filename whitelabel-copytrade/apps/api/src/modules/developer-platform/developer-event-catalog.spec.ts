// # NEW — every event has schema + emitter + delivery test; catalog snapshot

import { DEVELOPER_EVENT_TYPES, eventDefinition, isKnownEventType } from './developer.types';
import { EventSubscriptionService } from './event-subscription.service';
import {
  DEVELOPER_EVENT_PAYLOAD_SCHEMAS,
  validateDeveloperEventPayload,
} from './event-schemas/developer-event-schemas';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

function makeDeliveryHarness() {
  const delivery = {
    enqueue: jest.fn(async (input: { idempotencyKey: string; envelope: { eventType: string; eventId: string } }) => ({
      id: `delivery:${input.envelope.eventType}`,
    })),
  };
  const prisma = {
    developerWebhookSubscription: {
      findMany: jest.fn(async (query: { where: { tenantId: string; eventTypes: { has: string } } }) => [
        {
          id: `subscription:${query.where.eventTypes.has}`,
          tenantId: query.where.tenantId,
          applicationId: 'application-1',
          eventTypes: [query.where.eventTypes.has],
          eventVersion: 'v1',
          environment: 'SANDBOX',
        },
      ]),
    },
  };
  const service = new EventSubscriptionService(prisma as never, delivery as never);
  return { service, delivery, prisma };
}

describe('developer webhook event catalog', () => {
  it('matches the stable catalog snapshot', () => {
    expect(DEVELOPER_EVENT_TYPES).toMatchSnapshot();
  });

  it('has exactly one v1 JSON schema for every catalog entry and no orphan schema', () => {
    const catalogTypes = DEVELOPER_EVENT_TYPES.map((definition) => definition.eventType);
    const schemaTypes = Object.keys(DEVELOPER_EVENT_PAYLOAD_SCHEMAS);

    expect(new Set(catalogTypes).size).toBe(catalogTypes.length);
    expect([...schemaTypes].sort()).toEqual([...catalogTypes].sort());
    for (const definition of DEVELOPER_EVENT_TYPES) {
      const schema = DEVELOPER_EVENT_PAYLOAD_SCHEMAS[definition.eventType];
      expect(definition.eventVersion).toBe('v1');
      expect(schema.$id).toContain(`:${definition.eventType}:v1`);
      expect(schema.examples).toHaveLength(1);
      expect(validateDeveloperEventPayload(definition.eventType, schema.examples[0])).toEqual({ valid: true, errors: [] });
    }
  });

  it('publishes the stable schema URI for every authenticated catalog entry', () => {
    const { service } = makeDeliveryHarness();
    const catalog = service.catalog();

    expect(catalog).toHaveLength(DEVELOPER_EVENT_TYPES.length);
    for (const definition of DEVELOPER_EVENT_TYPES) {
      expect(catalog).toContainEqual({
        ...definition,
        schemaId: DEVELOPER_EVENT_PAYLOAD_SCHEMAS[definition.eventType]?.$id,
      });
    }
  });

  it('uses each catalog example to exercise the declared-source delivery projection', async () => {
    const { service, delivery, prisma } = makeDeliveryHarness();

    for (const definition of DEVELOPER_EVENT_TYPES) {
      const schema = DEVELOPER_EVENT_PAYLOAD_SCHEMAS[definition.eventType];
      const outcome = await service.projectEvent({
        tenantId: TENANT_ID,
        source: definition.source,
        eventType: definition.eventType,
        domainRecordId: `record:${definition.eventType}`,
        occurredAt: new Date('2026-10-09T00:00:00.000Z'),
        correlationId: `correlation:${definition.eventType}`,
        payload: schema.examples[0] as Record<string, unknown>,
      });

      expect(eventDefinition(definition.eventType)).toEqual(definition);
      expect(outcome.delivered).toBe(true);
      expect(outcome.deliveryIds).toEqual([`delivery:${definition.eventType}`]);
    }

    expect(prisma.developerWebhookSubscription.findMany).toHaveBeenCalledTimes(DEVELOPER_EVENT_TYPES.length);
    expect(delivery.enqueue).toHaveBeenCalledTimes(DEVELOPER_EVENT_TYPES.length);
    expect(delivery.enqueue.mock.calls.map(([input]) => input.envelope.eventType).sort()).toEqual(
      DEVELOPER_EVENT_TYPES.map((definition) => definition.eventType).sort(),
    );
  });

  it('keeps repeated lifecycle events distinct by stable outbox identity while retries reuse the same event id', async () => {
    const { service, delivery } = makeDeliveryHarness();
    const definition = DEVELOPER_EVENT_TYPES.find((entry) => entry.eventType === 'copy.subscription.paused');
    const schema = DEVELOPER_EVENT_PAYLOAD_SCHEMAS['copy.subscription.paused'];
    if (!definition) throw new Error('copy.subscription.paused is absent from the event catalog');

    const base = {
      tenantId: TENANT_ID,
      source: definition.source,
      eventType: definition.eventType,
      domainRecordId: 'subscription-1',
      occurredAt: new Date('2026-10-09T00:00:00.000Z'),
      correlationId: 'correlation-1',
      payload: schema.examples[0] as Record<string, unknown>,
    };
    await service.projectEvent({ ...base, outboxEventId: 'outbox-event-1' });
    await service.projectEvent({ ...base, outboxEventId: 'outbox-event-2' });
    await service.projectEvent({ ...base, outboxEventId: 'outbox-event-1' });

    const projectedEventIds = delivery.enqueue.mock.calls.map(([input]) => input.envelope.eventId);
    expect(projectedEventIds[0]).not.toBe(projectedEventIds[1]);
    expect(projectedEventIds[2]).toBe(projectedEventIds[0]);
  });

  it('rejects a malformed known event before any webhook delivery is enqueued', async () => {
    const { service, delivery } = makeDeliveryHarness();

    await expect(
      service.projectEvent({
        tenantId: TENANT_ID,
        source: 'copy-trading',
        eventType: 'copy.execution.filled',
        domainRecordId: 'execution-1',
        occurredAt: new Date('2026-10-09T00:00:00.000Z'),
        correlationId: 'correlation-1',
        payload: { executionId: 'execution-1' },
      }),
    ).rejects.toMatchObject({ code: 'DEVELOPER_VALIDATION' });

    expect(delivery.enqueue).not.toHaveBeenCalled();
  });

  it('does not project an unknown or source-mismatched catalog type', async () => {
    const { service, delivery } = makeDeliveryHarness();

    await expect(
      service.projectEvent({
        tenantId: TENANT_ID,
        source: 'copy-trading',
        eventType: 'copy.execution.not-a-real-event',
        domainRecordId: 'execution-1',
        occurredAt: new Date('2026-10-09T00:00:00.000Z'),
        correlationId: 'correlation-1',
        payload: {},
      }),
    ).resolves.toEqual({ delivered: false, deliveryIds: [] });
    await expect(
      service.projectEvent({
        tenantId: TENANT_ID,
        source: 'wrong-source',
        eventType: 'copy.execution.filled',
        domainRecordId: 'execution-1',
        occurredAt: new Date('2026-10-09T00:00:00.000Z'),
        correlationId: 'correlation-1',
        payload: DEVELOPER_EVENT_PAYLOAD_SCHEMAS['copy.execution.filled']?.examples[0] as Record<string, unknown>,
      }),
    ).resolves.toEqual({ delivered: false, deliveryIds: [] });

    expect(delivery.enqueue).not.toHaveBeenCalled();
    expect(isKnownEventType('copy.execution.not-a-real-event')).toBe(false);
    expect(isKnownEventType('copy.execution.filled')).toBe(true);
  });
});
