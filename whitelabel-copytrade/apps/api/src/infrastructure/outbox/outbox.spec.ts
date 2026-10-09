// # NEW — Tests crash recovery, aggregate order, dead-lettering, and idempotent publication
import { randomUUID } from 'node:crypto';

import { CopyExecutionStatus, CopySubscriptionState } from '../../modules/copy-trading/copy-trading.types';
import { CopyExecutionRepository } from '../../modules/copy-trading/copy-execution.repository';
import { CopyExecutionService } from '../../modules/copy-trading/copy-execution.service';
import { EventSubscriptionService } from '../../modules/developer-platform/event-subscription.service';
import { DEVELOPER_EVENT_TYPES, idempotencyKey } from '../../modules/developer-platform/developer.types';
import { DEVELOPER_EVENT_PAYLOAD_SCHEMAS } from '../../modules/developer-platform/event-schemas/developer-event-schemas';
import { OutboxRelayProcessor, outboxRetryDelayMs } from './outbox-relay.processor';
import { OutboxService } from './outbox.service';

jest.mock('@nestjs/schedule', () => ({ Interval: () => () => undefined }));

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const FIXED_TIME = new Date('2026-10-09T00:00:00.000Z');

interface FakeOutboxEvent {
  id: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateSequence: number;
  eventType: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  correlationId: string | null;
  status: 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'DEAD';
  attempts: number;
  availableAt: Date;
  publishedAt: Date | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  lastErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function newEvent(overrides: Partial<FakeOutboxEvent> = {}): FakeOutboxEvent {
  const eventId = randomUUID();
  return {
    id: eventId,
    tenantId: TENANT_ID,
    aggregateType: 'copy.subscription',
    aggregateId: 'subscription-1',
    aggregateSequence: 1,
    eventType: 'copy.subscription.created',
    payload: {
      subscriptionId: 'subscription-1',
      followerId: '11111111-1111-4111-8111-111111111112',
      traderId: '11111111-1111-4111-8111-111111111113',
      strategyId: '11111111-1111-4111-8111-111111111114',
      state: 'ACTIVE',
    },
    idempotencyKey: `copy-subscription:${eventId}:created`,
    correlationId: 'correlation-1',
    status: 'PENDING',
    attempts: 0,
    availableAt: new Date(0),
    publishedAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastErrorCode: null,
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    ...overrides,
  };
}

function makeRelayHarness(inputEvents: FakeOutboxEvent[], overrides: {
  projectEvent?: jest.Mock;
  emitNotification?: jest.Mock;
  subscriptions?: object;
} = {}) {
  const events = inputEvents.map((event) => structuredClone(event));
  const projectEvent = overrides.projectEvent ?? jest.fn(async (_observation: { eventType: string; domainRecordId: string }) => ({ delivered: true, deliveryIds: ['delivery-1'] }));
  const emitNotification = overrides.emitNotification ?? jest.fn(async () => ({ id: 'notification-1', delivered: true }));
  const metrics = { inc: jest.fn(), setGauge: jest.fn() };
  let claimedSql = '';

  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      claimedSql = sql;
      if (!sql.includes('WITH candidates')) return [];

      const now = Date.now();
      const leaseOwner = values[2] as string;
      const eligible = events
        .filter((event) =>
          event.tenantId === TENANT_ID &&
          ((event.status === 'PENDING' && event.availableAt.getTime() <= now) ||
            (event.status === 'PROCESSING' && (event.leaseExpiresAt?.getTime() ?? Infinity) <= now)),
        )
        .sort((left, right) =>
          left.availableAt.getTime() - right.availableAt.getTime() ||
          left.createdAt.getTime() - right.createdAt.getTime() ||
          left.id.localeCompare(right.id),
        );
      const claimed: FakeOutboxEvent[] = [];
      const aggregates = new Set<string>();
      for (const candidate of eligible) {
        const aggregateKey = `${candidate.tenantId}:${candidate.aggregateType}:${candidate.aggregateId}`;
        if (aggregates.has(aggregateKey)) continue;
        const earlierUnpublished = events.some((earlier) =>
          earlier.tenantId === candidate.tenantId &&
          earlier.aggregateType === candidate.aggregateType &&
          earlier.aggregateId === candidate.aggregateId &&
          earlier.aggregateSequence < candidate.aggregateSequence &&
          earlier.status !== 'PUBLISHED',
        );
        if (earlierUnpublished) continue;
        aggregates.add(aggregateKey);
        candidate.status = 'PROCESSING';
        candidate.attempts += 1;
        candidate.leaseOwner = leaseOwner;
        candidate.leaseExpiresAt = new Date(now + 120_000);
        candidate.updatedAt = new Date(now);
        claimed.push(structuredClone(candidate));
        if (claimed.length >= 20) break;
      }
      return claimed;
    },
    outboxEvent: {
      findFirst: async () => {
        const oldest = events
          .filter((event) => event.status !== 'PUBLISHED')
          .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.aggregateSequence - right.aggregateSequence)[0];
        return oldest ? { createdAt: oldest.createdAt } : null;
      },
      updateMany: async (query: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const row = events.find((event) =>
          event.id === query.where.id &&
          event.tenantId === query.where.tenantId &&
          event.status === query.where.status &&
          event.leaseOwner === query.where.leaseOwner,
        );
        if (!row) return { count: 0 };
        Object.assign(row, query.data);
        return { count: 1 };
      },
    },
  };

  const prisma = {
    tenant: { findMany: jest.fn(async () => [{ id: TENANT_ID }]) },
    withTenantRls: jest.fn(async (_tenantId: string, work: (client: typeof tx) => Promise<unknown>) => work(tx)),
  };
  const processor = new OutboxRelayProcessor(
    prisma as never,
    (overrides.subscriptions ?? { projectEvent }) as never,
    { emitCopyTradingNotification: emitNotification } as never,
    metrics as never,
  );

  return { processor, events, projectEvent, emitNotification, metrics, getClaimedSql: () => claimedSql };
}

function makeOutboxWriteTransaction(rows: FakeOutboxEvent[]) {
  const tx = {
    $queryRaw: jest.fn(async () => []),
    outboxEvent: {
      aggregate: jest.fn(async (query: { where: { tenantId: string; aggregateType: string; aggregateId: string } }) => {
        const matches = rows.filter((row) =>
          row.tenantId === query.where.tenantId &&
          row.aggregateType === query.where.aggregateType &&
          row.aggregateId === query.where.aggregateId,
        );
        return { _max: { aggregateSequence: matches.reduce<number | null>((max, row) => Math.max(max ?? 0, row.aggregateSequence), null) } };
      }),
      upsert: jest.fn(async (query: { where: { tenantId_idempotencyKey: { tenantId: string; idempotencyKey: string } }; create: Omit<FakeOutboxEvent, 'id' | 'status' | 'attempts' | 'availableAt' | 'publishedAt' | 'leaseOwner' | 'leaseExpiresAt' | 'lastErrorCode'> }) => {
        const existing = rows.find((row) =>
          row.tenantId === query.where.tenantId_idempotencyKey.tenantId &&
          row.idempotencyKey === query.where.tenantId_idempotencyKey.idempotencyKey,
        );
        if (existing) return structuredClone(existing);
        const created: FakeOutboxEvent = {
          ...query.create,
          id: randomUUID(),
          status: 'PENDING',
          attempts: 0,
          availableAt: query.create.createdAt,
          publishedAt: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
        };
        rows.push(created);
        return structuredClone(created);
      }),
    },
  };
  return tx;
}

function makeTransactionalCopyExecutionPrisma(options: { failOutboxAppend?: boolean } = {}) {
  const committed = {
    execution: {
      id: 'execution-1',
      tenantId: TENANT_ID,
      subscriptionId: 'subscription-1',
      followerId: '11111111-1111-4111-8111-111111111112',
      traderId: '11111111-1111-4111-8111-111111111113',
      status: 'ROUTED',
      executionIntent: { symbol: 'BTC-USDT', side: 'BUY' },
      followerQuantity: '0.125',
      retryCount: 0,
    },
    subscription: { id: 'subscription-1', tenantId: TENANT_ID, strategyId: '11111111-1111-4111-8111-111111111114' },
    outbox: [] as FakeOutboxEvent[],
  };

  const prisma = {
    withTenantRls: async (_tenantId: string, work: (client: any) => Promise<unknown>) => {
      const staged = structuredClone(committed);
      const tx = {
        $queryRaw: async () => [],
        copyExecution: {
          findFirst: async ({ where }: { where: { id: string; tenantId: string } }) =>
            staged.execution.id === where.id && staged.execution.tenantId === where.tenantId
              ? structuredClone(staged.execution)
              : null,
          update: async ({ where, data }: { where: { id: string; tenantId: string }; data: Record<string, unknown> }) => {
            if (staged.execution.id !== where.id || staged.execution.tenantId !== where.tenantId) {
              throw new Error('execution row missing');
            }
            for (const [key, value] of Object.entries(data)) {
              if (value !== undefined) (staged.execution as Record<string, unknown>)[key] = value;
            }
            return structuredClone(staged.execution);
          },
        },
        copySubscription: {
          findFirst: async () => ({ strategyId: staged.subscription.strategyId }),
        },
        outboxEvent: {
          aggregate: async ({ where }: { where: { tenantId: string; aggregateType: string; aggregateId: string } }) => {
            const rows = staged.outbox.filter((row) =>
              row.tenantId === where.tenantId &&
              row.aggregateType === where.aggregateType &&
              row.aggregateId === where.aggregateId,
            );
            return { _max: { aggregateSequence: rows.reduce<number | null>((max, row) => Math.max(max ?? 0, row.aggregateSequence), null) } };
          },
          upsert: async (query: { where: { tenantId_idempotencyKey: { tenantId: string; idempotencyKey: string } }; create: Record<string, unknown> }) => {
            if (options.failOutboxAppend) throw new Error('simulated outbox storage failure');
            const existing = staged.outbox.find((row) =>
              row.tenantId === query.where.tenantId_idempotencyKey.tenantId &&
              row.idempotencyKey === query.where.tenantId_idempotencyKey.idempotencyKey,
            );
            if (existing) return structuredClone(existing);
            const created = {
              ...query.create,
              id: randomUUID(),
              status: 'PENDING',
              attempts: 0,
              availableAt: query.create.createdAt,
              publishedAt: null,
              leaseOwner: null,
              leaseExpiresAt: null,
              lastErrorCode: null,
            } as FakeOutboxEvent;
            staged.outbox.push(created);
            return structuredClone(created);
          },
        },
      };

      const result = await work(tx);
      committed.execution = staged.execution;
      committed.outbox = staged.outbox;
      return result;
    },
  };

  return { prisma, committed };
}

describe('transactional outbox writer and domain integration', () => {
  it('allocates a strictly increasing aggregate sequence and deduplicates by tenant idempotency key', async () => {
    const rows: FakeOutboxEvent[] = [];
    const tx = makeOutboxWriteTransaction(rows);
    const outbox = new OutboxService();
    const firstInput = {
      tenantId: TENANT_ID,
      aggregateType: 'copy.subscription',
      aggregateId: 'subscription-1',
      eventType: 'copy.subscription.created',
      payload: {
        subscriptionId: 'subscription-1',
        followerId: '11111111-1111-4111-8111-111111111112',
        traderId: '11111111-1111-4111-8111-111111111113',
        strategyId: '11111111-1111-4111-8111-111111111114',
        state: 'ACTIVE',
      },
      idempotencyKey: 'subscription-created-1',
      occurredAt: FIXED_TIME,
    };

    const first = await outbox.append(tx as never, firstInput);
    const replay = await outbox.append(tx as never, firstInput);
    const second = await outbox.append(tx as never, {
      ...firstInput,
      eventType: 'copy.subscription.paused',
      payload: {
        subscriptionId: 'subscription-1',
        followerId: '11111111-1111-4111-8111-111111111112',
        traderId: '11111111-1111-4111-8111-111111111113',
        strategyId: '11111111-1111-4111-8111-111111111114',
        state: 'PAUSED',
      },
      idempotencyKey: 'subscription-paused-1',
    });

    expect(replay.id).toBe(first.id);
    expect(rows).toHaveLength(2);
    expect(first.aggregateSequence).toBe(1);
    expect(second.aggregateSequence).toBe(2);
    await expect(
      outbox.append(tx as never, {
        ...firstInput,
        payload: {
          subscriptionId: 'subscription-1',
          followerId: '11111111-1111-4111-8111-111111111115',
          traderId: '11111111-1111-4111-8111-111111111113',
          strategyId: '11111111-1111-4111-8111-111111111114',
          state: 'ACTIVE',
        },
      }),
    ).rejects.toThrow('outbox idempotency key was reused for a different event');
  });

  it('rejects unregistered event types and malformed v1 payloads before touching persistence', async () => {
    const tx = makeOutboxWriteTransaction([]);
    const outbox = new OutboxService();
    const base = {
      tenantId: TENANT_ID,
      aggregateType: 'copy.subscription',
      aggregateId: 'subscription-1',
      eventType: 'copy.subscription.created',
      payload: {
        subscriptionId: 'subscription-1',
        followerId: '11111111-1111-4111-8111-111111111112',
        traderId: '11111111-1111-4111-8111-111111111113',
        strategyId: '11111111-1111-4111-8111-111111111114',
        state: 'ACTIVE',
      },
      idempotencyKey: 'subscription-created-1',
    };

    await expect(
      outbox.append(tx as never, { ...base, eventType: 'copy.subscription.not-catalogued' }),
    ).rejects.toMatchObject({ code: 'DEVELOPER_EVENT_NOT_SUBSCRIBED' });
    await expect(
      outbox.append(tx as never, { ...base, payload: { subscriptionId: 'subscription-1' } }),
    ).rejects.toMatchObject({ code: 'DEVELOPER_VALIDATION' });
    expect(tx.outboxEvent.aggregate).not.toHaveBeenCalled();
    expect(tx.outboxEvent.upsert).not.toHaveBeenCalled();
  });

  it('commits an execution status and terminal event together, and rolls both back when event append fails', async () => {
    const healthy = makeTransactionalCopyExecutionPrisma();
    const repository = new CopyExecutionRepository(healthy.prisma as never, new OutboxService());

    await repository.updateStatus('execution-1', TENANT_ID, CopyExecutionStatus.FILLED);

    expect(healthy.committed.execution.status).toBe(CopyExecutionStatus.FILLED);
    expect(healthy.committed.outbox).toHaveLength(1);
    expect(healthy.committed.outbox[0]).toMatchObject({
      tenantId: TENANT_ID,
      aggregateType: 'copy.execution',
      aggregateId: 'execution-1',
      eventType: 'copy.execution.filled',
      status: 'PENDING',
      payload: {
        executionId: 'execution-1',
        subscriptionId: 'subscription-1',
        followerId: '11111111-1111-4111-8111-111111111112',
        traderId: '11111111-1111-4111-8111-111111111113',
        strategyId: '11111111-1111-4111-8111-111111111114',
        status: 'FILLED',
        quantity: '0.125',
      },
    });

    const failing = makeTransactionalCopyExecutionPrisma({ failOutboxAppend: true });
    const failingRepository = new CopyExecutionRepository(failing.prisma as never, new OutboxService());
    await expect(
      failingRepository.updateStatus('execution-1', TENANT_ID, CopyExecutionStatus.FILLED),
    ).rejects.toThrow('simulated outbox storage failure');
    expect(failing.committed.execution.status).toBe('ROUTED');
    expect(failing.committed.outbox).toHaveLength(0);
  });
});

describe('outbox relay recovery and ordering', () => {
  it('maps failed, rejected, and skipped copy executions to their typed terminal events', async () => {
    const cases = [
      { status: CopyExecutionStatus.FAILED, eventType: 'copy.execution.failed' },
      { status: CopyExecutionStatus.REJECTED, eventType: 'copy.execution.failed' },
      { status: CopyExecutionStatus.SKIPPED, eventType: 'copy.execution.skipped' },
    ] as const;

    for (const item of cases) {
      const harness = makeTransactionalCopyExecutionPrisma();
      const repository = new CopyExecutionRepository(harness.prisma as never, new OutboxService());
      await repository.updateStatus('execution-1', TENANT_ID, item.status);

      expect(harness.committed.execution.status).toBe(item.status);
      expect(harness.committed.outbox).toHaveLength(1);
      expect(harness.committed.outbox[0]).toMatchObject({
        eventType: item.eventType,
        payload: { status: item.status },
      });
    }
  });

  it('relays every catalog event with its schema-valid immutable payload to a matching webhook subscription', async () => {
    const catalogEvents = DEVELOPER_EVENT_TYPES.map((definition, index) => {
      const schema = DEVELOPER_EVENT_PAYLOAD_SCHEMAS[definition.eventType];
      if (!schema) throw new Error(`catalog event ${definition.eventType} has no payload schema`);
      return newEvent({
        id: `outbox-catalog-${String(index).padStart(2, '0')}`,
        aggregateType: definition.resourceType,
        aggregateId: `record-${index}`,
        eventType: definition.eventType,
        payload: schema.examples[0] as Record<string, unknown>,
        idempotencyKey: `catalog-event-${index}`,
        correlationId: `catalog-correlation-${index}`,
      });
    });
    const deliveryEnqueue = jest.fn(async (input: {
      envelope: { eventType: string; eventId: string; payload: Record<string, unknown> };
    }) => ({ id: `delivery-${input.envelope.eventType}` }));
    const subscriptionStore = {
      developerWebhookSubscription: {
        findMany: jest.fn(async (query: { where: { eventTypes: { has: string } } }) => [{
          id: `subscription:${query.where.eventTypes.has}`,
          tenantId: TENANT_ID,
          applicationId: 'catalog-app',
          state: 'ACTIVE',
          revokedAt: null,
          eventTypes: [query.where.eventTypes.has],
          eventVersion: 'v1',
          environment: 'SANDBOX',
        }]),
      },
    };
    const actualSubscriptions = new EventSubscriptionService(
      subscriptionStore as never,
      { enqueue: deliveryEnqueue } as never,
    );
    const harness = makeRelayHarness(catalogEvents, { subscriptions: actualSubscriptions });

    let processed = 0;
    while (processed < catalogEvents.length) {
      processed += await harness.processor.relayOnce();
    }

    expect(processed).toBe(DEVELOPER_EVENT_TYPES.length);
    expect(deliveryEnqueue).toHaveBeenCalledTimes(DEVELOPER_EVENT_TYPES.length);
    expect(harness.events.every((event) => event.status === 'PUBLISHED')).toBe(true);
    for (const definition of DEVELOPER_EVENT_TYPES) {
      const schema = DEVELOPER_EVENT_PAYLOAD_SCHEMAS[definition.eventType];
      const matchingDelivery = deliveryEnqueue.mock.calls
        .map(([input]) => input)
        .find((input) => input.envelope.eventType === definition.eventType);
      expect(matchingDelivery).toBeDefined();
      expect(matchingDelivery?.envelope.payload).toEqual(schema.examples[0]);
      const outboxEvent = catalogEvents.find((event) => event.eventType === definition.eventType);
      expect(matchingDelivery?.envelope.eventId).toBe(
        idempotencyKey(TENANT_ID, 'developer.event', `outbox|${outboxEvent?.id}`),
      );
    }
  });

  it('claims only the oldest unpublished event per aggregate and processes sequences in order', async () => {
    const first = newEvent({ aggregateSequence: 1, idempotencyKey: 'event-sequence-1' });
    const second = newEvent({ aggregateSequence: 2, idempotencyKey: 'event-sequence-2', createdAt: new Date(FIXED_TIME.getTime() + 1) });
    const harness = makeRelayHarness([second, first]);

    await expect(harness.processor.relayOnce()).resolves.toBe(1);
    expect(harness.projectEvent.mock.calls[0]?.[0]).toMatchObject({ domainRecordId: 'subscription-1' });
    expect(harness.events.find((event) => event.aggregateSequence === 1)?.status).toBe('PUBLISHED');
    expect(harness.events.find((event) => event.aggregateSequence === 2)?.status).toBe('PENDING');
    expect(harness.getClaimedSql()).toContain('FOR UPDATE SKIP LOCKED');
    expect(harness.getClaimedSql()).toContain('earlier."aggregate_sequence" < candidate."aggregate_sequence"');

    await expect(harness.processor.relayOnce()).resolves.toBe(1);
    expect(harness.events.map((event) => event.status)).toEqual(['PUBLISHED', 'PUBLISHED']);
    expect(harness.metrics.inc).toHaveBeenCalledWith('wlct_outbox_published_total', {});
  });

  it('recovers after a crash between domain commit and publication with one effective notification', async () => {
    const event = newEvent();
    const durableNotificationRows = new Set<string>();
    const projectEvent = jest.fn(async (_observation: { eventType: string; domainRecordId: string }) => ({ delivered: true, deliveryIds: ['stable-delivery'] }));
    let failAfterNotificationCommit = true;
    const emitNotification = jest.fn(async (notification: { tenantId: string; sourceEventId: string; userId: string }) => {
      durableNotificationRows.add(`${notification.tenantId}:${notification.sourceEventId}:${notification.userId}`);
      if (failAfterNotificationCommit) {
        failAfterNotificationCommit = false;
        throw new Error('simulated process crash after durable notification insert');
      }
      return { id: 'stable-notification', delivered: true };
    });
    const harness = makeRelayHarness([event], { projectEvent, emitNotification });

    await expect(harness.processor.relayOnce()).resolves.toBe(1);
    expect(harness.events[0]?.status).toBe('PENDING');
    expect(harness.events[0]?.lastErrorCode).toBe('ERROR');
    expect(harness.metrics.inc).toHaveBeenCalledWith('wlct_outbox_failed_total', {});

    // The retry backoff is a real persisted timestamp; advance this test row to
    // due without sleeping, exactly as the scheduler would after that interval.
    if (harness.events[0]) harness.events[0].availableAt = new Date(0);
    await expect(harness.processor.relayOnce()).resolves.toBe(1);

    expect(harness.events[0]?.status).toBe('PUBLISHED');
    expect(durableNotificationRows.size).toBe(1);
    expect(projectEvent).toHaveBeenCalledTimes(2);
    expect(projectEvent.mock.calls[0]?.[0]).toMatchObject({
      eventType: 'copy.subscription.created',
      domainRecordId: 'subscription-1',
    });
    expect(projectEvent.mock.calls[1]?.[0]).toMatchObject({
      eventType: 'copy.subscription.created',
      domainRecordId: 'subscription-1',
    });
    const firstNotification = emitNotification.mock.calls[0]?.[0];
    const retryNotification = emitNotification.mock.calls[1]?.[0];
    expect(retryNotification?.sourceEventId).toBe(firstNotification?.sourceEventId);
    expect(retryNotification?.userId).toBe(firstNotification?.userId);
  });

  it('moves a repeatedly failing event to DEAD without releasing later aggregate events', async () => {
    const poison = newEvent({ attempts: 11, aggregateSequence: 1, idempotencyKey: 'poison-event' });
    const successor = newEvent({ aggregateSequence: 2, idempotencyKey: 'successor-event' });
    const projectEvent = jest.fn(async (_observation: { eventType: string; domainRecordId: string }) => {
      throw new Error('simulated webhook projection failure');
    });
    const harness = makeRelayHarness([poison, successor], { projectEvent });

    await expect(harness.processor.relayOnce()).resolves.toBe(1);

    expect(harness.events.find((event) => event.id === poison.id)).toMatchObject({
      status: 'DEAD',
      attempts: 12,
      lastErrorCode: 'ERROR',
    });
    expect(harness.events.find((event) => event.id === successor.id)?.status).toBe('PENDING');
    expect(outboxRetryDelayMs(1)).toBe(1_000);
    expect(outboxRetryDelayMs(5)).toBe(16_000);
    expect(outboxRetryDelayMs(50)).toBe(300_000);
  });
});

describe('copy execution stop lifecycle identity', () => {
  it('gives repeated same-aggregate pause events distinct outbox identities within one timestamp tick', async () => {
    const rows: FakeOutboxEvent[] = [];
    const tx = makeOutboxWriteTransaction(rows);
    let currentState = CopySubscriptionState.ACTIVE;
    const subscription = {
      id: 'subscription-1',
      tenantId: TENANT_ID,
      followerId: '11111111-1111-4111-8111-111111111112',
      traderId: '11111111-1111-4111-8111-111111111113',
      strategyId: '11111111-1111-4111-8111-111111111114',
      updatedAt: FIXED_TIME,
    };
    const prisma = {
      withTenantRls: jest.fn(async (_tenantId: string, work: (transaction: unknown) => Promise<unknown>) => work(tx)),
    };
    const subscriptionRepo = {
      updateState: jest.fn(async (
        _subscriptionId: string,
        _tenantId: string,
        nextState: CopySubscriptionState,
        _timestamps: Record<string, Date>,
        context: { expectedState: CopySubscriptionState },
      ) => {
        if (currentState !== context.expectedState) return null;
        currentState = nextState;
        return { ...subscription, state: nextState, updatedAt: FIXED_TIME };
      }),
    };
    const service = new CopyExecutionService(
      prisma as never,
      subscriptionRepo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new OutboxService(),
    );
    const transition = (service as unknown as {
      transitionSubscriptionWithOutbox(input: {
        tenantId: string;
        subscription: Record<string, unknown>;
        nextState: CopySubscriptionState;
        eventType: string;
        timestamps: { pausedAt?: Date; stoppedAt?: Date };
      }): Promise<void>;
    }).transitionSubscriptionWithOutbox;

    await transition.call(service, {
      tenantId: TENANT_ID,
      subscription: { ...subscription, state: currentState },
      nextState: CopySubscriptionState.PAUSED,
      eventType: 'copy.subscription.paused',
      timestamps: { pausedAt: FIXED_TIME },
    });
    await transition.call(service, {
      tenantId: TENANT_ID,
      subscription: { ...subscription, state: currentState },
      nextState: CopySubscriptionState.ACTIVE,
      eventType: 'copy.subscription.resumed',
      timestamps: {},
    });
    await transition.call(service, {
      tenantId: TENANT_ID,
      subscription: { ...subscription, state: currentState },
      nextState: CopySubscriptionState.PAUSED,
      eventType: 'copy.subscription.paused',
      timestamps: { pausedAt: FIXED_TIME },
    });

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.eventType)).toEqual([
      'copy.subscription.paused',
      'copy.subscription.resumed',
      'copy.subscription.paused',
    ]);
    expect(rows[0]?.idempotencyKey).not.toBe(rows[2]?.idempotencyKey);
    expect(new Set(rows.map((row) => row.idempotencyKey)).size).toBe(3);
    expect(rows.map((row) => row.aggregateSequence)).toEqual([1, 2, 3]);
  });
});
