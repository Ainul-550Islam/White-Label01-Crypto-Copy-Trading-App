// Real PostgreSQL: receipt, ACK, lifecycle and outbox share one forced-RLS transaction.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { JOB_NAMES } from '@wlct/config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { ExecutionAckService } from './execution-ack.service';
import { OrderSubmissionResultService, type SubmissionResultView } from './order-submission-result.service';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL;
const rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;
(adminUrl && rlsUrl ? describe : describe.skip)('submission result atomicity under forced RLS', () => {
  const tenant = randomUUID(), otherTenant = randomUUID(), user = randomUUID(), otherUser = randomUUID();
  const account = randomUUID(), otherAccount = randomUUID();
  const client = (url: string) => new PrismaService({ databaseUrl: url, isProduction: false, databaseReadEnabled: false } as never,
    { warn() {}, debug() {}, error() {}, info() {} } as never);
  let admin: PrismaService, db: PrismaService, symbol: string, otherSymbol: string, exchangeId: string, createdExchange = false;
  let service: OrderSubmissionResultService;
  const jobs = new Map<string, unknown>();
  const queue = { getQueue: () => ({ getJob: async (id: string) => jobs.get(id) ?? null }) };

  function recorder(outbox: OutboxService) {
    const lifecycle = new OrderLifecycleService(db, outbox);
    const ack = new ExecutionAckService(db, lifecycle);
    return new OrderSubmissionResultService(db, ack, queue as never);
  }

  async function createOrder(selectedTenant = tenant): Promise<SubmissionResultView> {
    const id = randomUUID(), intentId = randomUUID(), clientOrderId = randomUUID();
    const selectedAccount = selectedTenant === tenant ? account : otherAccount;
    const symbolId = selectedTenant === tenant ? symbol : otherSymbol;
    await admin.omsOrderIntent.create({ data: { id: intentId, tenantId: selectedTenant, accountId: selectedAccount,
      symbol: 'BTC-USDT', side: 'BUY', orderType: 'LIMIT', quantity: '0.1', price: '20', environment: 'PAPER',
      clientOrderId, source: 'MANUAL', isSimulated: true, state: 'SUBMITTED', metadata: { transitions: [] } } });
    await admin.order.create({ data: { id, tenantId: selectedTenant, accountId: selectedAccount, symbolId, clientOrderId,
      venue: 'PAPER', symbol: 'BTC-USDT', side: 'BUY', orderType: 'LIMIT', status: 'SUBMITTED', quantity: '0.1',
      price: '20', isSimulated: true, metadata: { omsIntentId: intentId } } });
    return { tenantId: selectedTenant, platformOrderId: id, omsIntentId: intentId, clientOrderId,
      outcome: 'ACCEPTED', engineOrderId: randomUUID(), exchangeOrderId: 'paper-order-1', orderStatus: 'ACKNOWLEDGED',
      filledQuantity: '0', averageFillPrice: null, cumulativeFee: '0', feeCurrency: null, errorCode: null, message: null,
      latencyMicros: 100, isSimulated: true };
  }

  beforeAll(async () => {
    admin = client(adminUrl!); db = client(rlsUrl!);
    await admin.tenant.createMany({ data: [tenant, otherTenant].map((id) => ({ id, slug: `result-atomic-${id}`, name: 'Result test' })) });
    for (const [id, tenantId] of [[user, tenant], [otherUser, otherTenant]]) {
      await admin.user.create({ data: { id, tenantId, email: `${id}@example.test`, emailIndex: id.replace(/-/g, ''),
        passwordHash: 'synthetic', status: 'ACTIVE' } });
    }
    const old = await admin.exchange.findUnique({ where: { venue: 'PAPER' } });
    const exchange = old ?? await admin.exchange.create({ data: { venue: 'PAPER', name: 'Paper', supportedMarketTypes: ['SPOT'],
      restBaseUrl: 'https://example.invalid', wsBaseUrl: 'wss://example.invalid' } });
    exchangeId = exchange.id; createdExchange = !old;
    for (const [id, tenantId, userId] of [[account, tenant, user], [otherAccount, otherTenant, otherUser]]) {
      await admin.tradingAccount.create({ data: { id, tenantId, userId, exchangeId, marketType: 'SPOT', label: 'Account',
        apiKeyBlindIndex: randomUUID(), apiKeyLastFour: '0001' } });
    }
    const first = await admin.tradingSymbol.create({ data: { tenantId: tenant, exchangeId, symbol: 'BTC-USDT', venueSymbol: 'BTCUSDT',
      marketType: 'SPOT', baseAsset: 'BTC', quoteAsset: 'USDT', priceTick: '0.01', quantityStep: '0.01', minQuantity: '0.01', minNotional: '1' } });
    const second = await admin.tradingSymbol.create({ data: { tenantId: otherTenant, exchangeId, symbol: 'BTC-USDT', venueSymbol: 'BTCUSDT',
      marketType: 'SPOT', baseAsset: 'BTC', quoteAsset: 'USDT', priceTick: '0.01', quantityStep: '0.01', minQuantity: '0.01', minNotional: '1' } });
    symbol = first.id; otherSymbol = second.id;
    service = recorder(new OutboxService());
  });

  afterAll(async () => {
    if (admin) {
      await admin.order.updateMany({ where: { tenantId: { in: [tenant, otherTenant] } }, data: { status: 'CANCELLED', reconciliationState: 'IN_SYNC' } });
      await admin.omsOrderIntent.updateMany({ where: { tenantId: { in: [tenant, otherTenant] } }, data: { state: 'CANCELLED' } });
      await admin.executionOrder.deleteMany({ where: { tenantId: { in: [tenant, otherTenant] } } });
      await admin.tenant.deleteMany({ where: { id: { in: [tenant, otherTenant] } } });
      if (createdExchange) await admin.exchange.delete({ where: { id: exchangeId } });
    }
    await db?.$disconnect(); await admin?.$disconnect();
  });

  it('persists a duplicate concurrent acknowledgement once with the state and event', async () => {
    const result = await createOrder();
    expect(await db.order.count()).toBe(0);
    await Promise.all([service.recordResult(result), service.recordResult(result)]);
    expect(await admin.order.findUniqueOrThrow({ where: { id: result.platformOrderId } })).toMatchObject({
      status: 'ACKNOWLEDGED', exchangeOrderId: result.exchangeOrderId,
    });
    expect(await admin.omsOrderIntent.findUniqueOrThrow({ where: { id: result.omsIntentId! } })).toMatchObject({ state: 'ACKNOWLEDGED' });
    expect(await admin.omsExecutionAck.count({ where: { tenantId: tenant, orderIntentId: result.omsIntentId! } })).toBe(1);
    expect(await admin.outboxEvent.count({ where: { tenantId: tenant, aggregateId: result.omsIntentId!, eventType: 'order.acknowledged' } })).toBe(1);
    expect(await db.omsExecutionAck.count()).toBe(0);
  });

  it('also deduplicates NULL venue IDs, which PostgreSQL unique indexes normally allow repeatedly', async () => {
    const result = { ...(await createOrder()), exchangeOrderId: null };
    await Promise.all([service.recordResult(result), service.recordResult(result)]);
    expect(await admin.omsExecutionAck.count({ where: { tenantId: tenant, orderIntentId: result.omsIntentId!, exchangeOrderId: null } })).toBe(1);
  });

  it('enriches a null-id acknowledgement when the venue id arrives without creating a duplicate', async () => {
    const result = await createOrder();
    await service.recordResult({ ...result, exchangeOrderId: null });
    await service.recordResult(result);
    const acks = await admin.omsExecutionAck.findMany({ where: { tenantId: tenant, orderIntentId: result.omsIntentId! } });
    expect(acks).toHaveLength(1);
    expect(acks[0]).toMatchObject({ exchangeOrderId: result.exchangeOrderId, providerOrderId: result.engineOrderId });
    expect(await admin.omsOrderIntent.findUniqueOrThrow({ where: { id: result.omsIntentId! } })).toMatchObject({
      state: 'ACKNOWLEDGED', exchangeOrderId: result.exchangeOrderId,
    });
    expect(await admin.outboxEvent.count({ where: { tenantId: tenant, aggregateId: result.omsIntentId!, eventType: 'order.acknowledged' } })).toBe(1);
  });

  it('rolls the order, intent and acknowledgement back when outbox persistence fails', async () => {
    const result = await createOrder();
    const broken = recorder({ append: async () => { throw new Error('synthetic outbox failure'); } } as never);
    await expect(broken.recordResult(result)).rejects.toThrow('synthetic outbox failure');
    expect(await admin.order.findUniqueOrThrow({ where: { id: result.platformOrderId } })).toMatchObject({ status: 'SUBMITTED', exchangeOrderId: null });
    expect(await admin.omsOrderIntent.findUniqueOrThrow({ where: { id: result.omsIntentId! } })).toMatchObject({ state: 'SUBMITTED' });
    expect(await admin.omsExecutionAck.count({ where: { tenantId: tenant, orderIntentId: result.omsIntentId! } })).toBe(0);
    await service.recordResult(result);
    expect(await admin.omsExecutionAck.count({ where: { tenantId: tenant, orderIntentId: result.omsIntentId! } })).toBe(1);
  });

  it('refuses a foreign or identity-mismatched receipt without mutating the order', async () => {
    const result = await createOrder();
    expect(await service.recordResult({ ...result, tenantId: otherTenant })).toMatchObject({ kind: 'unknown' });
    expect(await service.recordResult({ ...result, clientOrderId: randomUUID() })).toMatchObject({ kind: 'unknown' });
    expect(await admin.order.findUniqueOrThrow({ where: { id: result.platformOrderId } })).toMatchObject({ status: 'SUBMITTED', reconciliationState: 'IN_SYNC' });
    expect(await admin.omsExecutionAck.count({ where: { tenantId: tenant, orderIntentId: result.omsIntentId! } })).toBe(0);
  });

  it('matches duplicate receipts to the complete durable engine intent, not just the client id', async () => {
    const matching = await createOrder();
    const absent = await createOrder();
    expect(await service.recordResult({ ...absent, outcome: 'DUPLICATE' })).toMatchObject({ kind: 'unknown' });
    const engineData = (result: SubmissionResultView, accountId: string) => ({
      tenantId: tenant, orderId: result.engineOrderId!, clientOrderId: result.clientOrderId, accountId,
      exchange: 'PAPER', symbol: 'BTC-USDT', side: 'BUY', orderType: 'LIMIT', timeInForce: 'GTC',
      reduceOnly: false, isSimulated: true, status: 'ACKNOWLEDGED', exchangeOrderId: result.exchangeOrderId,
      quantity: '0.1', price: '20', stopPrice: null, filledQuantity: '0', averageFillPrice: null,
      cumulativeFee: '0', feeCurrency: null, createdAt: 1n, updatedAt: 1n,
    });
    await admin.executionOrder.create({ data: engineData(matching, account) });
    expect(await service.recordResult({ ...matching, outcome: 'DUPLICATE' })).toMatchObject({ kind: 'accepted' });
    const mismatch = await createOrder();
    await admin.executionOrder.create({ data: engineData(mismatch, otherAccount) });
    expect(await service.recordResult({ ...mismatch, outcome: 'DUPLICATE' })).toMatchObject({ kind: 'unknown' });
    expect(await admin.order.findUniqueOrThrow({ where: { id: mismatch.platformOrderId } })).toMatchObject({ status: 'SUBMITTED', reconciliationState: 'UNKNOWN' });
  });

  it('does not finalize an aggregate-only fill or a potentially retried refusal', async () => {
    const filled = await createOrder();
    expect(await service.recordResult({ ...filled, orderStatus: 'FILLED', filledQuantity: '0.1', averageFillPrice: '20' }))
      .toMatchObject({ kind: 'unknown' });
    expect(await admin.order.findUniqueOrThrow({ where: { id: filled.platformOrderId } })).toMatchObject({ status: 'SUBMITTED', reconciliationState: 'UNKNOWN' });
    const rejected = await createOrder();
    expect(await service.recordResult({ ...rejected, outcome: 'REJECTED_LOCALLY', orderStatus: 'UNKNOWN', errorCode: 'RISK_BLOCK' }))
      .toMatchObject({ kind: 'unknown' });
    expect(await admin.order.findUniqueOrThrow({ where: { id: rejected.platformOrderId } })).toMatchObject({ status: 'SUBMITTED', reconciliationState: 'UNKNOWN' });
  });

  it('binds a completion event to the authoritative job payload before applying it', async () => {
    const accepted = await createOrder();
    const jobId = `oms-submit-${accepted.clientOrderId}`;
    jobs.set(jobId, { name: JOB_NAMES.SUBMIT_ORDER, data: { tenantId: accepted.tenantId,
      orderId: accepted.platformOrderId, omsIntentId: accepted.omsIntentId, clientOrderId: accepted.clientOrderId } });
    await (service as any).onCompleted(jobId, accepted);
    expect((await admin.order.findUniqueOrThrow({ where: { id: accepted.platformOrderId } })).status).toBe('ACKNOWLEDGED');

    const forged = await createOrder();
    const forgedJobId = `oms-submit-${forged.clientOrderId}`;
    jobs.set(forgedJobId, { name: JOB_NAMES.SUBMIT_ORDER, data: { tenantId: forged.tenantId,
      orderId: forged.platformOrderId, omsIntentId: forged.omsIntentId, clientOrderId: forged.clientOrderId } });
    await (service as any).onCompleted(forgedJobId, { ...forged, tenantId: otherTenant });
    expect(await admin.order.findUniqueOrThrow({ where: { id: forged.platformOrderId } })).toMatchObject({
      status: 'SUBMITTED', reconciliationState: 'UNKNOWN',
    });
    expect(await admin.omsExecutionAck.count({ where: { tenantId: tenant, orderIntentId: forged.omsIntentId! } })).toBe(0);
  });

  it('sweeps pending receipts per tenant instead of relying on an unscoped order query', async () => {
    const one = await createOrder(tenant), two = await createOrder(otherTenant);
    for (const result of [one, two]) jobs.set(`oms-submit-${result.clientOrderId}`, { name: JOB_NAMES.SUBMIT_ORDER,
      data: { tenantId: result.tenantId, orderId: result.platformOrderId, omsIntentId: result.omsIntentId, clientOrderId: result.clientOrderId },
      finishedOn: Date.now(), returnvalue: result });
    const sweep = recorder(new OutboxService());
    await sweep.sweepPending();
    expect((await admin.order.findUniqueOrThrow({ where: { id: one.platformOrderId } })).status).toBe('ACKNOWLEDGED');
    expect((await admin.order.findUniqueOrThrow({ where: { id: two.platformOrderId } })).status).toBe('ACKNOWLEDGED');
  });

  it('advances across tenants and past old missing jobs with a one-order sweep budget', async () => {
    // Existing unresolved orders precede these two; their missing jobs must
    // not monopolize every sweep.
    const one = await createOrder(tenant), two = await createOrder(otherTenant);
    for (const result of [one, two]) jobs.set(`oms-submit-${result.clientOrderId}`, {
      name: JOB_NAMES.SUBMIT_ORDER, finishedOn: Date.now(), returnvalue: result,
      data: { tenantId: result.tenantId, orderId: result.platformOrderId, omsIntentId: result.omsIntentId, clientOrderId: result.clientOrderId },
    });
    const sweep = recorder(new OutboxService());
    let statuses: string[] = [];
    for (let attempt = 0; attempt < 100; attempt++) {
      await sweep.sweepPending(1);
      statuses = (await admin.order.findMany({ where: { id: { in: [one.platformOrderId, two.platformOrderId] } },
        orderBy: { id: 'asc' }, select: { status: true } })).map((order) => order.status);
      if (statuses.length === 2 && statuses.every((status) => status === 'ACKNOWLEDGED')) break;
    }
    expect(statuses).toEqual(['ACKNOWLEDGED', 'ACKNOWLEDGED']);
  });
});
