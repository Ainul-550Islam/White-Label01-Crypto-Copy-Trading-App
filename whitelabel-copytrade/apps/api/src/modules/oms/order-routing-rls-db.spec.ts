// Real PostgreSQL coverage for the routing service's tenant-scoped persistence.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderRoutingService } from './order-routing.service';
import { OrderSubmissionResultService } from './order-submission-result.service';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL, rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;
(adminUrl && rlsUrl ? describe : describe.skip)('OMS routing with forced tenant RLS', () => {
  const tenant = randomUUID(), foreignTenant = randomUUID(), owner = randomUUID(), account = randomUUID();
  const riskId = randomUUID();
  const tables = ['trading_accounts', 'trading_symbols', 'oms_order_intents', 'orders', 'positions', 'compliance_screening_requests'];
  const prior = new Map<string, { relrowsecurity: boolean; relforcerowsecurity: boolean }>();
  const client = (url: string) => new PrismaService({ databaseUrl: url, isProduction: false, databaseReadEnabled: false } as never,
    { warn() {}, debug() {}, error() {}, info() {} } as never);
  let admin: PrismaService, db: PrismaService, service: OrderRoutingService, exchangeId: string, symbolId: string, createdExchange = false;
  const queue = { enqueueOrThrow: jest.fn(async () => 'job-1') };
  const risk = { evaluateUnifiedRisk: jest.fn(async () => ({ id: riskId, decision: 'ALLOW', policyVersion: 'v1', ruleIds: [] })) };
  const intentData = () => ({ tenantId: tenant, accountId: account, symbol: 'BTC-USDT', side: 'BUY', orderType: 'LIMIT',
    quantity: '0.1', price: '20', environment: 'PAPER', clientOrderId: randomUUID(), source: 'MANUAL', isSimulated: true });
  beforeAll(async () => {
    admin = client(adminUrl!); db = client(rlsUrl!);
    for (const table of tables) {
      const [state] = await admin.$queryRawUnsafe<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='${table}'`);
      prior.set(table, state);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    }
    await admin.tenant.createMany({ data: [tenant, foreignTenant].map((id) => ({ id, slug: `routing-rls-${id}`, name: 'Routing test' })) });
    await admin.user.create({ data: { id: owner, tenantId: tenant, email: `${owner}@example.test`,
      emailIndex: owner.replace(/-/g, ''), passwordHash: 'synthetic', status: 'ACTIVE' } });
    const old = await admin.exchange.findUnique({ where: { venue: 'PAPER' } });
    const exchange = old ?? await admin.exchange.create({ data: { venue: 'PAPER', name: 'Paper', supportedMarketTypes: ['SPOT'],
      restBaseUrl: 'https://example.invalid', wsBaseUrl: 'wss://example.invalid' } });
    exchangeId = exchange.id; createdExchange = !old;
    await admin.tradingAccount.create({ data: { id: account, tenantId: tenant, userId: owner, exchangeId, marketType: 'SPOT',
      label: 'Routing account', apiKeyBlindIndex: randomUUID(), apiKeyLastFour: '0001' } });
    const symbol = await admin.tradingSymbol.create({ data: { tenantId: tenant, exchangeId, symbol: 'BTC-USDT', venueSymbol: 'BTCUSDT',
      marketType: 'SPOT', baseAsset: 'BTC', quoteAsset: 'USDT', priceTick: '0.01', quantityStep: '0.01', minQuantity: '0.01',
      minNotional: '1', isTradeable: true } });
    symbolId = symbol.id;
    await admin.position.create({ data: { tenantId: tenant, accountId: account, symbolId, venue: 'PAPER', symbol: 'BTC-USDT',
      quantity: '0.4', side: 'LONG', markPrice: '20', containsSimulatedFills: true } });
    const lifecycle = new OrderLifecycleService(db, { append: async () => undefined } as never);
    service = new OrderRoutingService(db, {} as never, lifecycle, risk as never, { route: async () => ({ venue: 'PAPER' }) } as never,
      {} as never, {} as never, queue as never);
  });
  afterAll(async () => {
    if (!admin) return;
    await admin.order.updateMany({ where: { tenantId: tenant }, data: { status: 'CANCELLED', reconciliationState: 'IN_SYNC' } });
    await admin.omsOrderIntent.updateMany({ where: { tenantId: tenant }, data: { state: 'CANCELLED' } });
    await admin.tenant.deleteMany({ where: { id: { in: [tenant, foreignTenant] } } });
    if (createdExchange) await admin.exchange.delete({ where: { id: exchangeId } });
    for (const table of tables) {
      const state = prior.get(table);
      if (state && !state.relforcerowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`);
      if (state && !state.relrowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
    }
    await db.$disconnect(); await admin.$disconnect();
  });
  beforeEach(() => { queue.enqueueOrThrow.mockReset().mockResolvedValue('job-1'); risk.evaluateUnifiedRisk.mockClear(); });

  it('finds the owned intent and positions, creates its canonical order, and enqueues the real exposure', async () => {
    const intent = await admin.omsOrderIntent.create({ data: intentData() as never });
    expect(await db.omsOrderIntent.count()).toBe(0);
    expect(await db.position.count()).toBe(0);
    const routed = await service.routeIntent({ tenantId: tenant, intentId: intent.id, userId: owner });
    const order = await admin.order.findUniqueOrThrow({ where: { id: routed.canonicalOrderId } });
    expect(order).toMatchObject({ tenantId: tenant, accountId: account, symbolId, riskDecisionId: riskId, status: 'SUBMITTED' });
    expect((await admin.omsOrderIntent.findUniqueOrThrow({ where: { id: intent.id } })).state).toBe('SUBMITTED');
    expect(queue.enqueueOrThrow).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      tenantId: tenant, accountId: account, orderId: order.id, riskDecisionId: riskId,
      exposure: { positionQuantity: '0.4', symbolExposureNotional: '8', accountExposureNotional: '8', complete: true },
    }), expect.anything());
    await expect(service.routeIntent({ tenantId: foreignTenant, intentId: intent.id })).rejects.toThrow('not found');
    expect(queue.enqueueOrThrow).toHaveBeenCalledTimes(1);
  });

  it('leaves an already-present conflicting canonical order untouched and requires reconciliation', async () => {
    const intent = await admin.omsOrderIntent.create({ data: intentData() as never });
    const oldOrder = await admin.order.create({ data: { tenantId: tenant, accountId: account, symbolId,
      clientOrderId: intent.clientOrderId, venue: 'PAPER', symbol: 'BTC-USDT', side: 'BUY', orderType: 'LIMIT',
      status: 'SUBMITTED', quantity: '0.1', price: '20', isSimulated: true, riskDecisionId: randomUUID() } });
    await expect(service.routeIntent({ tenantId: tenant, intentId: intent.id, userId: owner })).rejects.toMatchObject({
      response: { code: 'CANONICAL_ORDER_CONFLICT' },
    });
    expect((await admin.order.findUniqueOrThrow({ where: { id: oldOrder.id } })).status).toBe('SUBMITTED');
    expect((await admin.omsOrderIntent.findUniqueOrThrow({ where: { id: intent.id } })).state).toBe('RECONCILIATION_REQUIRED');
    expect(queue.enqueueOrThrow).not.toHaveBeenCalled();
  });

  it('keeps an ambiguous queue outcome unresolved without exposing the backend error', async () => {
    const intent = await admin.omsOrderIntent.create({ data: intentData() as never });
    queue.enqueueOrThrow.mockRejectedValueOnce(new Error('private queue error'));
    await expect(service.routeIntent({ tenantId: tenant, intentId: intent.id, userId: owner }))
      .rejects.toThrow('Execution submission could not be confirmed.');
    const order = await admin.order.findFirstOrThrow({ where: { tenantId: tenant, clientOrderId: intent.clientOrderId } });
    expect(order).toMatchObject({ status: 'SUBMITTED', reconciliationState: 'UNKNOWN', terminalAt: null });
    expect(order.reconciliationDetail).not.toContain('private queue error');
    expect((await admin.omsOrderIntent.findUniqueOrThrow({ where: { id: intent.id } })).state).toBe('SUBMITTED');
    await expect(service.routeIntent({ tenantId: tenant, intentId: intent.id, userId: owner })).rejects.toThrow('not in routable state');
    expect(queue.enqueueOrThrow).toHaveBeenCalledTimes(1);
  });

  it('keeps failed worker jobs tenant-scoped and unresolved without regressing acknowledgements', async () => {
    const intent = await admin.omsOrderIntent.create({ data: intentData() as never });
    const routed = await service.routeIntent({ tenantId: tenant, intentId: intent.id, userId: owner });
    const recorder = new OrderSubmissionResultService(db, {} as never, {} as never);
    await recorder.recordFailure({ tenantId: foreignTenant, clientOrderId: intent.clientOrderId, reason: 'private failure' });
    expect((await admin.order.findUniqueOrThrow({ where: { id: routed.canonicalOrderId } })).reconciliationState).toBe('IN_SYNC');
    await recorder.recordFailure({ tenantId: tenant, clientOrderId: intent.clientOrderId, reason: 'private failure' });
    const unknown = await admin.order.findUniqueOrThrow({ where: { id: routed.canonicalOrderId } });
    expect(unknown).toMatchObject({ status: 'SUBMITTED', reconciliationState: 'UNKNOWN', terminalAt: null });
    expect(unknown.reconciliationDetail).not.toContain('private failure');
    expect((await admin.omsOrderIntent.findUniqueOrThrow({ where: { id: intent.id } })).state).toBe('SUBMITTED');
    await admin.order.update({ where: { id: routed.canonicalOrderId }, data: { status: 'ACKNOWLEDGED', reconciliationState: 'IN_SYNC' } });
    await recorder.recordFailure({ tenantId: tenant, clientOrderId: intent.clientOrderId, reason: 'late failure' });
    expect(await admin.order.findUniqueOrThrow({ where: { id: routed.canonicalOrderId } }))
      .toMatchObject({ status: 'ACKNOWLEDGED', reconciliationState: 'IN_SYNC', terminalAt: null });
  });

  it('does not overwrite an acknowledgement that races an ambiguous queue error', async () => {
    const intent = await admin.omsOrderIntent.create({ data: intentData() as never });
    queue.enqueueOrThrow.mockImplementationOnce(async () => {
      await admin.order.updateMany({ where: { tenantId: tenant, clientOrderId: intent.clientOrderId },
        data: { status: 'ACKNOWLEDGED', reconciliationState: 'IN_SYNC' } });
      await admin.omsOrderIntent.update({ where: { id: intent.id }, data: { state: 'ACKNOWLEDGED' } });
      throw new Error('private queue error after acceptance');
    });
    await expect(service.routeIntent({ tenantId: tenant, intentId: intent.id, userId: owner }))
      .rejects.toThrow('Execution submission could not be confirmed.');
    const order = await admin.order.findFirstOrThrow({ where: { tenantId: tenant, clientOrderId: intent.clientOrderId } });
    expect(order).toMatchObject({ status: 'ACKNOWLEDGED', reconciliationState: 'IN_SYNC', terminalAt: null });
    expect((await admin.omsOrderIntent.findUniqueOrThrow({ where: { id: intent.id } })).state).toBe('ACKNOWLEDGED');
  });
});
