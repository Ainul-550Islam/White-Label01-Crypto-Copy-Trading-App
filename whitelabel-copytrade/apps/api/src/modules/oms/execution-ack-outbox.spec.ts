// # Proves execution acknowledgements retry through the transactional OMS outbox after a failed append

import { ExecutionAckService } from './execution-ack.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderIntentState } from './oms.types';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

function buildHarness() {
  let intent: any = {
    id: 'intent-1',
    tenantId: TENANT_ID,
    clientOrderId: 'client-order-1',
    state: OrderIntentState.SUBMITTED,
    symbol: 'BTC-USDT',
    side: 'SELL',
    quantity: '0.5',
    price: '50000',
    metadata: { transitions: [] },
  };
  let ackRow: any = null;
  let rejectAppend = true;
  const tx = {
    omsOrderIntent: {
      findFirst: jest.fn(async () => intent),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        intent = { ...intent, ...data };
        return intent;
      }),
    },
    order: {
      findFirst: jest.fn(async () => null),
      update: jest.fn(async () => null),
    },
  };
  const prisma: any = {
    withTenantRls: jest.fn(async (_tenantId: string, work: (transaction: unknown) => Promise<unknown>) => {
      const before = intent;
      try {
        return await work(tx);
      } catch (error) {
        intent = before;
        throw error;
      }
    }),
    omsOrderIntent: { findFirst: jest.fn(async () => intent) },
    omsExecutionAck: {
      findFirst: jest.fn(async () => ackRow),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        ackRow = { id: 'ack-1', ...data };
        return ackRow;
      }),
    },
    order: { findFirst: jest.fn(async () => null), update: jest.fn(async () => null) },
  };
  const appended: Record<string, unknown>[] = [];
  const outbox = {
    append: jest.fn(async (_transaction: unknown, input: Record<string, unknown>) => {
      if (rejectAppend) throw new Error('outbox unavailable');
      appended.push(input);
      return undefined;
    }),
  };
  const lifecycle = new OrderLifecycleService(prisma, outbox as never);
  const service = new ExecutionAckService(prisma, lifecycle);
  const input = {
    tenantId: TENANT_ID,
    orderId: 'canonical-order-1',
    clientOrderId: 'client-order-1',
    exchangeOrderId: 'exchange-order-1',
    venue: 'BINANCE',
    status: 'ACKNOWLEDGED',
    occurredAtMicros: '1791547200000000',
    correlationId: 'correlation-1',
    source: 'EXECUTION_ENGINE',
  };
  return {
    service,
    prisma,
    tx,
    outbox,
    appended,
    input,
    state: () => intent.state,
    allowAppend: () => { rejectAppend = false; },
  };
}

describe('ExecutionAckService outbox retry', () => {
  it('retries lifecycle delivery after the ack row was already persisted and does not duplicate the ack row', async () => {
    const { service, prisma, tx, outbox, appended, input, state, allowAppend } = buildHarness();

    await expect(service.processAckFromExecutionEvent(input)).rejects.toThrow('outbox unavailable');
    expect(state()).toBe(OrderIntentState.SUBMITTED);
    expect(prisma.omsExecutionAck.create).toHaveBeenCalledTimes(1);
    expect(outbox.append).toHaveBeenCalledTimes(1);

    allowAppend();
    await service.processAckFromExecutionEvent(input);

    expect(state()).toBe(OrderIntentState.ACKNOWLEDGED);
    expect(prisma.omsExecutionAck.create).toHaveBeenCalledTimes(1);
    expect(prisma.omsExecutionAck.findFirst).toHaveBeenCalledTimes(2);
    expect(tx.omsOrderIntent.update).toHaveBeenCalledTimes(2);
    expect(appended).toHaveLength(1);
    expect(appended[0]).toEqual(expect.objectContaining({
      tenantId: TENANT_ID,
      aggregateType: 'order',
      aggregateId: 'intent-1',
      eventType: 'order.acknowledged',
      payload: expect.objectContaining({
        orderId: 'intent-1',
        status: 'ACKNOWLEDGED',
        symbol: 'BTC-USDT',
        side: 'SELL',
        quantity: '0.5',
        price: '50000',
      }),
    }));
  });
});
