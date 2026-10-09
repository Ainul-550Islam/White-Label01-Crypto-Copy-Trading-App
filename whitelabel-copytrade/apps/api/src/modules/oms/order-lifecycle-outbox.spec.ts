// # Proves OMS acknowledgement, fill, and rejection transitions commit with distinct outbox events

import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderIntentState } from './oms.types';
import { validateDeveloperEventPayload } from '../developer-platform/event-schemas/developer-event-schemas';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

function buildHarness(initialState: string, failAppend = false) {
  let current: any = {
    id: 'order-aggregate-1',
    tenantId: TENANT_ID,
    state: initialState,
    symbol: 'BTC-USDT',
    side: 'BUY',
    quantity: '0.25',
    filledQuantity: '0.25',
    price: '60000.00',
    averageFillPrice: '59999.50',
    correlationId: 'correlation-1',
    metadata: { transitions: [] },
  };
  const tx = {
    omsOrderIntent: {
      findFirst: jest.fn(async () => current),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        current = { ...current, ...data };
        return current;
      }),
    },
    order: {
      findFirst: jest.fn(async () => current),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        current = { ...current, ...data, state: data.status };
        return current;
      }),
    },
  };
  const prisma = {
    withTenantRls: jest.fn(async (_tenantId: string, work: (transaction: unknown) => Promise<unknown>) => {
      const before = current;
      try {
        return await work(tx);
      } catch (error) {
        current = before;
        throw error;
      }
    }),
  };
  const appended: Record<string, unknown>[] = [];
  const outbox = {
    append: jest.fn(async (_transaction: unknown, input: Record<string, unknown>) => {
      if (failAppend) throw new Error('outbox unavailable');
      appended.push(input);
      return undefined;
    }),
  };
  const service = new OrderLifecycleService(prisma as never, outbox as never);
  return { service, prisma, tx, outbox, appended, current: () => current };
}

describe('OrderLifecycleService developer events', () => {
  it('emits schema-valid acknowledgement, then a separately idempotent fill event on the same aggregate', async () => {
    const { service, prisma, tx, outbox, appended } = buildHarness(OrderIntentState.SUBMITTED);
    await service.transition({
      tenantId: TENANT_ID,
      intentId: 'order-aggregate-1',
      toState: OrderIntentState.ACKNOWLEDGED,
      source: 'EXECUTION_ENGINE',
      reason: 'Venue acknowledged the order.',
    });
    await service.transition({
      tenantId: TENANT_ID,
      intentId: 'order-aggregate-1',
      toState: OrderIntentState.FILLED,
      source: 'FILL_MANAGEMENT',
      reason: 'Venue fill completed the order.',
    });

    expect(prisma.withTenantRls).toHaveBeenCalledTimes(2);
    expect(tx.omsOrderIntent.update).toHaveBeenCalledTimes(2);
    expect(outbox.append).toHaveBeenCalledTimes(2);
    expect(appended.map((event) => event.eventType)).toEqual(['order.acknowledged', 'order.filled']);
    for (const event of appended) {
      expect(validateDeveloperEventPayload(String(event.eventType), event.payload)).toEqual({ valid: true, errors: [] });
    }
    expect(appended.map((event) => event.aggregateId)).toEqual(['order-aggregate-1', 'order-aggregate-1']);
    expect(appended[0]?.idempotencyKey).not.toBe(appended[1]?.idempotencyKey);
    expect(appended[0]?.payload).toEqual(expect.objectContaining({
      orderId: 'order-aggregate-1',
      status: 'ACKNOWLEDGED',
      symbol: 'BTC-USDT',
      side: 'BUY',
      quantity: '0.25',
      price: '60000.00',
    }));
    expect(appended[1]?.payload).toEqual(expect.objectContaining({
      orderId: 'order-aggregate-1',
      status: 'FILLED',
      symbol: 'BTC-USDT',
      side: 'BUY',
      quantity: '0.25',
      price: '59999.50',
    }));
    expect(appended[0]?.idempotencyKey).toContain('transition:');
    expect(appended[1]?.idempotencyKey).toContain('transition:');
  });

  it('emits a rejection event through the same state-and-event transaction', async () => {
    const { service, tx, outbox } = buildHarness(OrderIntentState.SUBMITTED);
    await service.transition({
      tenantId: TENANT_ID,
      intentId: 'order-aggregate-1',
      toState: OrderIntentState.REJECTED,
      source: 'EXECUTION_ENGINE',
      reason: 'Venue rejected the order.',
    });

    expect(tx.omsOrderIntent.update).toHaveBeenCalledTimes(1);
    expect(outbox.append).toHaveBeenCalledWith(tx, expect.objectContaining({
      aggregateId: 'order-aggregate-1',
      eventType: 'order.rejected',
      payload: expect.objectContaining({ orderId: 'order-aggregate-1', status: 'REJECTED' }),
    }));
  });

  it('rolls the lifecycle write back when the event cannot be appended', async () => {
    const { service, tx, outbox, current } = buildHarness(OrderIntentState.SUBMITTED, true);
    await expect(service.transition({
      tenantId: TENANT_ID,
      intentId: 'order-aggregate-1',
      toState: OrderIntentState.ACKNOWLEDGED,
      source: 'EXECUTION_ENGINE',
      reason: 'Venue acknowledged the order.',
    })).rejects.toThrow('outbox unavailable');

    expect(tx.omsOrderIntent.update).toHaveBeenCalledTimes(1);
    expect(outbox.append).toHaveBeenCalledTimes(1);
    expect(current().state).toBe(OrderIntentState.SUBMITTED);
  });
});
