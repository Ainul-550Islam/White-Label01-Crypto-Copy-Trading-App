// Verifies acknowledgement and lifecycle outbox writes share one transaction.
import { ExecutionAckService } from './execution-ack.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderIntentState } from './oms.types';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

function buildHarness() {
  let intent: any = { id: 'intent-1', tenantId: TENANT_ID, accountId: 'account-1', clientOrderId: 'client-order-1',
    state: OrderIntentState.SUBMITTED, symbol: 'BTC-USDT', side: 'SELL', quantity: '0.5', price: '50000', isSimulated: false, metadata: { transitions: [] } };
  const order = { id: 'canonical-order-1', tenantId: TENANT_ID, accountId: 'account-1', clientOrderId: 'client-order-1',
    symbol: 'BTC-USDT', side: 'SELL', venue: 'BINANCE', status: 'ACKNOWLEDGED', isSimulated: false,
    exchangeOrderId: null, metadata: { omsIntentId: 'intent-1' } };
  let ackRow: any = null;
  let rejectAppend = true;
  const tx = {
    $queryRaw: jest.fn(async () => [{ id: 'locked' }]),
    omsOrderIntent: {
      findFirst: jest.fn(async () => intent),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { intent = { ...intent, ...data }; return intent; }),
    },
    omsExecutionAck: {
      findMany: jest.fn(async () => ackRow ? [ackRow] : []),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { ackRow = { id: 'ack-1', ...data }; return ackRow; }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { ackRow = { ...ackRow, ...data }; return ackRow; }),
    },
    order: { findFirst: jest.fn(async () => order), update: jest.fn(async () => order) },
  };
  const prisma: any = {
    withTenantRls: jest.fn(async (_tenantId: string, work: (transaction: unknown) => Promise<unknown>) => {
      const beforeIntent = intent; const beforeAck = ackRow;
      try { return await work(tx); }
      catch (error) { intent = beforeIntent; ackRow = beforeAck; throw error; }
    }),
  };
  const appended: Record<string, unknown>[] = [];
  const outbox = { append: jest.fn(async (_transaction: unknown, input: Record<string, unknown>) => {
    if (rejectAppend) throw new Error('outbox unavailable');
    appended.push(input);
    return undefined;
  }) };
  const lifecycle = new OrderLifecycleService(prisma, outbox as never);
  const service = new ExecutionAckService(prisma, lifecycle);
  const input = { tenantId: TENANT_ID, orderId: order.id, clientOrderId: order.clientOrderId,
    exchangeOrderId: 'exchange-order-1', venue: 'BINANCE', status: 'ACKNOWLEDGED',
    occurredAtMicros: '1791547200000000', correlationId: 'correlation-1', source: 'EXECUTION_ENGINE' };
  return { service, prisma, tx, outbox, appended, input, state: () => intent.state, ack: () => ackRow,
    allowAppend: () => { rejectAppend = false; } };
}

describe('ExecutionAckService transactional outbox', () => {
  it('does not invent a durable acknowledgement when persistence fails', async () => {
    const { service, tx, input, state, ack, outbox } = buildHarness();
    tx.omsExecutionAck.create.mockRejectedValueOnce(new Error('private database failure'));
    await expect(service.processAckFromExecutionEvent(input)).rejects.toMatchObject({
      code: 'OMS_EXECUTION_ACK_PERSIST_FAILED', message: 'Money-path operation failed (OMS_EXECUTION_ACK_PERSIST_FAILED)',
    });
    expect(state()).toBe(OrderIntentState.SUBMITTED);
    expect(ack()).toBeNull();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('rolls acknowledgement and lifecycle back together and safely retries', async () => {
    const { service, prisma, tx, outbox, appended, input, state, ack, allowAppend } = buildHarness();
    await expect(service.processAckFromExecutionEvent(input)).rejects.toThrow('outbox unavailable');
    expect(state()).toBe(OrderIntentState.SUBMITTED);
    expect(ack()).toBeNull();
    expect(tx.omsExecutionAck.create).toHaveBeenCalledTimes(1);
    allowAppend();
    await service.processAckFromExecutionEvent(input);
    await service.processAckFromExecutionEvent(input);
    expect(state()).toBe(OrderIntentState.ACKNOWLEDGED);
    expect(tx.omsExecutionAck.create).toHaveBeenCalledTimes(2);
    expect(prisma.withTenantRls).toHaveBeenCalledTimes(3);
    expect(outbox.append).toHaveBeenCalledTimes(2);
    expect(appended).toHaveLength(1);
    expect(appended[0]).toEqual(expect.objectContaining({ tenantId: TENANT_ID, aggregateType: 'order',
      aggregateId: 'intent-1', eventType: 'order.acknowledged', payload: expect.objectContaining({
        orderId: 'intent-1', status: 'ACKNOWLEDGED', symbol: 'BTC-USDT', side: 'SELL', quantity: '0.5', price: '50000',
      }) }));
  });

  it('does not turn unknown status into an acceptance', async () => {
    const { service, tx, input, state } = buildHarness();
    expect(await service.processAckFromExecutionEvent({ ...input, status: 'UNKNOWN' })).toBeNull();
    expect(tx.omsExecutionAck.create).not.toHaveBeenCalled();
    expect(state()).toBe(OrderIntentState.SUBMITTED);
  });
});
