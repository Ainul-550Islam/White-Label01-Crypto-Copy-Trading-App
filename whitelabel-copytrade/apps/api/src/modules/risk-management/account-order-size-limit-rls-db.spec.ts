// # Responsibility: proves account-size limit edits, exact enforcement and locking against PostgreSQL under forced tenant RLS.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AccountOrderSizeLimitService, type AccountOrderSizeUpdate } from './account-order-size-limit.service';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL, rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;
(adminUrl && rlsUrl ? describe : describe.skip)('owner account order-size limits against real PostgreSQL', () => {
  const tenant = randomUUID(), otherTenant = randomUUID(), owner = randomUUID(), successor = randomUUID(), foreign = randomUUID();
  const account = randomUUID(), accountTwo = randomUUID(), foreignAccount = randomUUID();
  const tables = ['trading_accounts', 'trading_symbols', 'oms_order_intents', 'orders', 'audit_logs'];
  const prior = new Map<string, { relrowsecurity: boolean; relforcerowsecurity: boolean }>();
  const client = (url: string) => new PrismaService({ databaseUrl: url, isProduction: false, databaseReadEnabled: false } as never,
    { warn() {}, debug() {}, error() {}, info() {} } as never);
  let admin: PrismaService, db: PrismaService, service: AccountOrderSizeLimitService;
  let exchangeId: string, symbolId: string, createdExchange = false;
  const initial: AccountOrderSizeUpdate = { expectedRevision: null, maxBaseQuantity: '2', maxOrderNotional: '1.000000000002', notionalCurrency: 'USDT' };
  const update = (input: AccountOrderSizeUpdate, key: string, target = account, userId = owner) =>
    service.update({ tenantId: tenant, userId, accountId: target, input, idempotencyKey: key, requestId: 'account-size-test' });
  const intentData = (overrides: Record<string, unknown> = {}) => ({ tenantId: tenant, accountId: account, symbol: 'BTC-USDT',
    side: 'BUY', orderType: 'LIMIT', quantity: '1', price: '1', environment: 'PAPER', clientOrderId: randomUUID(), source: 'MANUAL', ...overrides });

  beforeAll(async () => {
    admin = client(adminUrl!); db = client(rlsUrl!); service = new AccountOrderSizeLimitService(db);
    for (const table of tables) {
      const [state] = await admin.$queryRawUnsafe<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='${table}'`);
      prior.set(table, state);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    }
    await admin.tenant.createMany({ data: [tenant, otherTenant].map((id) => ({ id, slug: `account-size-${id}`, name: 'Account limit test' })) });
    await admin.user.createMany({ data: [
      { id: owner, tenantId: tenant }, { id: successor, tenantId: tenant }, { id: foreign, tenantId: otherTenant },
    ].map((u) => ({ ...u, email: `${u.id}@example.test`, emailIndex: u.id.replace(/-/g, ''), passwordHash: 'synthetic', status: 'ACTIVE' })) });
    const existing = await admin.exchange.findUnique({ where: { venue: 'PAPER' } });
    const exchange = existing ?? await admin.exchange.create({ data: { venue: 'PAPER', name: 'Paper', supportedMarketTypes: ['SPOT'],
      restBaseUrl: 'https://example.invalid', wsBaseUrl: 'wss://example.invalid' } });
    exchangeId = exchange.id; createdExchange = !existing;
    await admin.tradingAccount.createMany({ data: [
      { id: account, tenantId: tenant, userId: owner }, { id: accountTwo, tenantId: tenant, userId: owner },
      { id: foreignAccount, tenantId: otherTenant, userId: foreign },
    ].map((a) => ({ ...a, exchangeId, label: 'Test account', marketType: 'SPOT' as const,
      apiKeyBlindIndex: randomUUID(), apiKeyLastFour: '0001' })) });
    const symbol = await admin.tradingSymbol.create({ data: { tenantId: tenant, exchangeId, symbol: 'BTC-USDT', venueSymbol: 'BTCUSDT',
      baseAsset: 'BTC', quoteAsset: 'USDT', priceTick: '0.01', quantityStep: '0.0001', minQuantity: '0.0001', minNotional: '1', isTradeable: true } });
    symbolId = symbol.id;
    await admin.tradingSymbol.create({ data: { tenantId: tenant, exchangeId, symbol: 'BTC-USD', venueSymbol: 'BTCUSD',
      baseAsset: 'BTC', quoteAsset: 'USD', priceTick: '0.01', quantityStep: '0.0001', minQuantity: '0.0001', minNotional: '1', isTradeable: true } });
  });
  afterAll(async () => {
    if (!admin) return;
    await admin.order.updateMany({ where: { tenantId: tenant }, data: { status: 'CANCELLED', reconciliationState: 'IN_SYNC' } });
    await admin.omsOrderIntent.updateMany({ where: { tenantId: tenant }, data: { state: 'CANCELLED' } });
    await admin.tenant.deleteMany({ where: { id: { in: [tenant, otherTenant] } } });
    if (createdExchange) await admin.exchange.delete({ where: { id: exchangeId } });
    for (const table of tables) {
      const state = prior.get(table);
      if (state && !state.relforcerowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`);
      if (state && !state.relrowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
    }
    await db.$disconnect(); await admin.$disconnect();
  });

  it('lists only the owner accounts and rejects a cross-tenant or different-user selection', async () => {
    const page = await service.list({ tenantId: tenant, userId: owner, page: 1, limit: 1 });
    expect(page.total).toBe(2); expect(page.data).toHaveLength(1);
    expect((await service.list({ tenantId: tenant, userId: owner, page: 2, limit: 1 })).data[0]?.id).not.toBe(page.data[0]?.id);
    await expect(service.get({ tenantId: tenant, userId: successor, accountId: account })).rejects.toThrow();
    await expect(service.get({ tenantId: tenant, userId: owner, accountId: foreignAccount })).rejects.toThrow();
    const hidden = await db.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM "account_order_size_limits"`;
    expect(hidden[0]?.n).toBe(0n);
  });

  it('commits a decimal-exact policy, retry record and audit together with optimistic concurrency', async () => {
    const saved = await update(initial, 'account-limit-first');
    expect(saved.limits).toEqual({ maxBaseQuantity: '2', maxOrderNotional: '1.000000000002', notionalCurrency: 'USDT' });
    expect(saved.revision).toMatch(/^[0-9a-f-]{36}$/i);
    expect((await update(initial, 'account-limit-first')).revision).toBe(saved.revision);
    expect(await admin.auditLog.count({ where: { tenantId: tenant, actorId: owner, action: 'ACCOUNT_ORDER_SIZE_LIMIT_UPDATED' } })).toBe(1);
    await expect(update({ ...initial, maxBaseQuantity: '3' }, 'account-limit-first')).rejects.toThrow('different limit update');
    await expect(update({ ...initial, expectedRevision: null }, 'account-limit-stale')).rejects.toThrow('Limits changed');
    const tries = await Promise.allSettled([
      update({ ...initial, expectedRevision: saved.revision, maxBaseQuantity: '2.5' }, 'account-limit-race-a'),
      update({ ...initial, expectedRevision: saved.revision, maxBaseQuantity: '2' }, 'account-limit-race-b'),
    ]);
    expect(tries.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(tries.filter((x) => x.status === 'rejected')).toHaveLength(1);
    const current = await service.get({ tenantId: tenant, userId: owner, accountId: account });
    const restored = await update({ ...initial, expectedRevision: current.revision }, 'account-limit-restore');
    expect(restored.limits.maxBaseQuantity).toBe('2');
  });

  it('enforces exact quantities, quote currency and a genuine order-notional upper bound for legacy and scoped writers', async () => {
    const accepted = await db.withTenantRls(tenant, (tx) => tx.omsOrderIntent.create({ data: intentData() as never }));
    await expect(admin.omsOrderIntent.create({ data: intentData({ quantity: '2.000000000001', price: '0.1' }) as never }))
      .rejects.toThrow('ACCOUNT_ORDER_LIMIT_QUANTITY_EXCEEDED');
    await expect(db.withTenantRls(tenant, (tx) => tx.omsOrderIntent.create({ data: intentData({ quantity: '1.000000000001', price: '1.000000000001' }) as never })))
      .rejects.toThrow('ACCOUNT_ORDER_LIMIT_NOTIONAL_EXCEEDED');
    await expect(admin.omsOrderIntent.create({ data: intentData({ side: 'SELL', price: '0.1' }) as never }))
      .rejects.toThrow('ACCOUNT_ORDER_LIMIT_NOTIONAL_UNBOUNDED');
    await expect(admin.omsOrderIntent.create({ data: intentData({ orderType: 'MARKET', price: null }) as never }))
      .rejects.toThrow('ACCOUNT_ORDER_LIMIT_NOTIONAL_UNBOUNDED');
    await expect(admin.omsOrderIntent.create({ data: intentData({ symbol: 'BTC-USD' }) as never }))
      .rejects.toThrow('ACCOUNT_ORDER_LIMIT_CURRENCY_UNVERIFIED');
    await expect(admin.omsOrderIntent.update({ where: { id: accepted.id }, data: { quantity: '1.1' } })).rejects.toThrow('ACTIVE_INTENT_IMMUTABLE');
    await admin.omsOrderIntent.update({ where: { id: accepted.id }, data: { state: 'CANCELLED' } });
  });

  it('does not let a legacy unscoped quantity update hide the forced-RLS policy', async () => {
    const intent = await db.withTenantRls(tenant, (tx) => tx.omsOrderIntent.create({ data: intentData() as never }));
    // Simulate a legacy deployment that has not enabled RLS on OMS, while the
    // new policy table itself is always forced. The trigger must still see it.
    await admin.$executeRawUnsafe('ALTER TABLE oms_order_intents DISABLE ROW LEVEL SECURITY');
    try {
      await expect(db.omsOrderIntent.update({ where: { id: intent.id }, data: { quantity: '1.1' } }))
        .rejects.toThrow('ACCOUNT_ORDER_LIMIT_ACTIVE_INTENT_IMMUTABLE');
    } finally {
      await admin.$executeRawUnsafe('ALTER TABLE oms_order_intents ENABLE ROW LEVEL SECURITY');
      await admin.$executeRawUnsafe('ALTER TABLE oms_order_intents FORCE ROW LEVEL SECURITY');
      await admin.omsOrderIntent.update({ where: { id: intent.id }, data: { state: 'CANCELLED' } });
    }
  });

  it('rejects a policy row whose tenant and account identity do not belong together', async () => {
    await expect(db.withTenantRls(otherTenant, (tx) => tx.$executeRaw`
      INSERT INTO account_order_size_limits (tenant_id, account_id, max_base_quantity)
      VALUES (${otherTenant}::uuid, ${account}::uuid, 1)`)).rejects.toThrow('Trading account ownership is unavailable');
  });

  it('allows observing an external venue order but refuses edits while it remains open', async () => {
    const order = await admin.order.create({ data: { tenantId: tenant, accountId: account, symbolId, clientOrderId: randomUUID(),
      exchangeOrderId: 'external-observation', venue: 'PAPER', symbol: 'BTC-USDT', side: 'SELL', orderType: 'MARKET',
      status: 'ACKNOWLEDGED', quantity: '10', isSimulated: true, metadata: { providerRawStatus: 'NEW' } } });
    const current = await service.get({ tenantId: tenant, userId: owner, accountId: account });
    await expect(update({ ...initial, expectedRevision: current.revision }, 'account-limit-open-order')).rejects.toMatchObject({
      response: { code: 'ACCOUNT_ORDER_LIMIT_ACTIVE_ORDERS' },
    });
    await admin.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
    await admin.order.delete({ where: { id: order.id } });
  });

  it('serializes first-time configuration with a legacy reservation instead of activating over an in-flight order', async () => {
    let release!: () => void, inserted!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { inserted = resolve; });
    const id = randomUUID();
    const writer = admin.$transaction(async (tx) => {
      await tx.omsOrderIntent.create({ data: intentData({ id, accountId: accountTwo }) as never });
      inserted(); await gate;
    }, { timeout: 10000 });
    await entered;
    const attempt = update(initial, 'account-limit-concurrent', accountTwo).then(() => null, (e) => e);
    try {
      let waiting = false;
      for (let n = 0; n < 100; n++) {
        const [row] = await admin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted`;
        if (row && row.n > 0n) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
    } finally { release(); }
    await writer;
    expect((await attempt)?.response?.code).toBe('ACCOUNT_ORDER_LIMIT_ACTIVE_ORDERS');
    expect((await service.get({ tenantId: tenant, userId: owner, accountId: accountTwo })).revision).toBeNull();
    await admin.omsOrderIntent.update({ where: { id }, data: { state: 'CANCELLED' } });
    await update({ expectedRevision: null, maxBaseQuantity: '0.000000000001', maxOrderNotional: null, notionalCurrency: null },
      'account-limit-precision', accountTwo);
    expect((await service.get({ tenantId: tenant, userId: owner, accountId: accountTwo })).limits.maxBaseQuantity).toBe('0.000000000001');
  });

  it('keeps a limit attached to a transferred account and allows only its new owner to edit', async () => {
    await admin.tradingAccount.update({ where: { id: account }, data: { userId: successor } });
    await expect(service.get({ tenantId: tenant, userId: owner, accountId: account })).rejects.toThrow();
    const inherited = await service.get({ tenantId: tenant, userId: successor, accountId: account });
    expect(inherited.limits.maxOrderNotional).toBe('1.000000000002');
    const cleared = await update({ expectedRevision: inherited.revision, maxBaseQuantity: null, maxOrderNotional: null, notionalCurrency: null },
      'account-limit-new-owner', account, successor);
    expect(cleared.configured).toBe(false);
  });
});
