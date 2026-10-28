import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PositionLimitService } from './position-limit.service';
import { CopyBudgetService } from '../copy-trading/copy-budget.service';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL;
const rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;
(adminUrl && rlsUrl ? describe : describe.skip)('user position limits against PostgreSQL and forced tenant RLS', () => {
  const tenant = randomUUID(), foreignTenant = randomUUID(), user = randomUUID(), otherUser = randomUUID();
  const account = randomUUID(), foreignAccount = randomUUID();
  let admin: PrismaService, db: PrismaService, service: PositionLimitService, exchangeId: string, createdExchange = false;
  const client = (url: string) => new PrismaService({ databaseUrl: url, isProduction: false, databaseReadEnabled: false } as never,
    { warn() {}, debug() {}, error() {}, info() {} } as never);
  beforeAll(async () => {
    admin = client(adminUrl!); db = client(rlsUrl!); service = new PositionLimitService(db);
    await admin.tenant.createMany({ data: [tenant, foreignTenant].map((id) => ({ id, slug: `position-limit-${id}`, name: 'Position limit test' })) });
    await admin.user.createMany({ data: [{ id: user, tenantId: tenant }, { id: otherUser, tenantId: foreignTenant }].map((row) => ({
      ...row, email: `${row.id}@example.test`, emailIndex: row.id.replace(/-/g, ''), passwordHash: 'synthetic', status: 'ACTIVE',
    })) });
    const existing = await admin.exchange.findUnique({ where: { venue: 'PAPER' } });
    const exchange = existing ?? await admin.exchange.create({ data: { venue: 'PAPER', name: 'Test paper venue', supportedMarketTypes: ['SPOT'],
      restBaseUrl: 'https://example.invalid', wsBaseUrl: 'wss://example.invalid' } });
    exchangeId = exchange.id; createdExchange = !existing;
    await admin.tradingAccount.createMany({ data: [
      { id: account, tenantId: tenant, userId: user, exchangeId, label: 'Mine', apiKeyBlindIndex: randomUUID(), apiKeyLastFour: '0001' },
      { id: foreignAccount, tenantId: foreignTenant, userId: otherUser, exchangeId, label: 'Foreign', apiKeyBlindIndex: randomUUID(), apiKeyLastFour: '0002' },
    ] });
  });
  afterAll(async () => {
    if (!admin) return;
    // Active reservations cannot be erased by the account-owner safety guard;
    // resolve test fixtures before cascading the tenant deletion.
    await admin.order.updateMany({ where: { tenantId: { in: [tenant, foreignTenant] } }, data: { status: 'CANCELLED', reconciliationState: 'IN_SYNC' } });
    await admin.omsOrderIntent.updateMany({ where: { tenantId: { in: [tenant, foreignTenant] } }, data: { state: 'CANCELLED' } });
    await admin.tenant.deleteMany({ where: { id: { in: [tenant, foreignTenant] } } });
    if (createdExchange) await admin.exchange.delete({ where: { id: exchangeId } });
    await db.$disconnect(); await admin.$disconnect();
  });

  it('persists editable limits with an atomic audit and hides another tenant', async () => {
    const initial = { tenantId: tenant, userId: user, patch: { maxConcurrentPositions: 2, maxOpenOrders: 1 },
      requestId: 'risk-db-test', idempotencyKey: 'initial-limit-key', expectedUpdatedAt: null };
    const result = await service.updateMyLimits(initial);
    expect(result.limits).toEqual({ maxConcurrentPositions: 2, maxOpenOrders: 1 });
    const replay = await service.updateMyLimits(initial);
    expect(replay.limits).toEqual(result.limits);
    expect(await admin.auditLog.count({ where: { tenantId: tenant, actorId: user, action: 'USER_POSITION_LIMIT_UPDATED', requestId: 'risk-db-test' } })).toBe(1);
    await expect(service.updateMyLimits({ ...initial, patch: { maxOpenOrders: 4 } })).rejects.toThrow('different limits update');
    const next = await service.updateMyLimits({ tenantId: tenant, userId: user, patch: { maxConcurrentPositions: 3, maxOpenOrders: 1 },
      idempotencyKey: 'second-limit-key', expectedUpdatedAt: result.updatedAt });
    expect(next.updatedAt).not.toBe(result.updatedAt);
    await expect(service.updateMyLimits({ ...initial, idempotencyKey: 'stale-limit-key', expectedUpdatedAt: result.updatedAt })).rejects.toThrow('Limits changed');
    expect((await service.updateMyLimits(initial)).limits).toEqual(next.limits);
    expect(await admin.auditLog.count({ where: { tenantId: tenant, actorId: user, action: 'USER_POSITION_LIMIT_UPDATED' } })).toBe(2);
    const invisible = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM "user_position_limit_update_intents"`;
    expect(invisible[0]?.count).toBe(0n);
    expect(await db.userPositionLimit.count()).toBe(0);
    await expect(service.getMyLimits({ tenantId: foreignTenant, userId: user })).rejects.toThrow();
    await expect(service.persistOrderIntentWithLimits({ tenantId: tenant, accountId: foreignAccount, symbol: 'BTC-USDT', persist: async () => 'must not persist' })).rejects.toThrow();
  });

  it('allows only one concurrent edit based on the same observed version', async () => {
    const current = await service.getMyLimits({ tenantId: tenant, userId: user });
    const edit = (maxConcurrentPositions: number, key: string) => service.updateMyLimits({ tenantId: tenant, userId: user,
      patch: { maxConcurrentPositions, maxOpenOrders: 1 }, idempotencyKey: key, expectedUpdatedAt: current.updatedAt });
    const results = await Promise.allSettled([edit(2, 'concurrent-key-one'), edit(3, 'concurrent-key-two')]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected?.reason?.message).toContain('Limits changed');
    expect((await service.getMyLimits({ tenantId: tenant, userId: user })).limits.maxOpenOrders).toBe(1);
  });

  it('rolls back a failed usage read to a savepoint, but still fails closed on admission', async () => {
    const current = await service.getMyLimits({ tenantId: tenant, userId: user });
    await admin.$executeRawUnsafe('REVOKE SELECT ON "positions" FROM batch02_rls');
    try {
      const unreadable = await service.getMyLimits({ tenantId: tenant, userId: user });
      expect(unreadable.usageState).toBe('UNKNOWN');
      expect(unreadable.usage).toBeNull();
      const saved = await service.updateMyLimits({ tenantId: tenant, userId: user, patch: { maxConcurrentPositions: 2, maxOpenOrders: 1 },
        idempotencyKey: 'unavailable-usage-key', expectedUpdatedAt: current.updatedAt });
      expect(saved.usageState).toBe('UNKNOWN');
      expect(saved.limits.maxOpenOrders).toBe(1);
      expect(await admin.auditLog.count({ where: { tenantId: tenant, actorId: user, action: 'USER_POSITION_LIMIT_UPDATED',
        resourceId: { not: null } } })).toBeGreaterThanOrEqual(1);
      const persist = jest.fn(async () => 'not persisted');
      await expect(service.persistOrderIntentWithLimits({ tenantId: tenant, accountId: account, symbol: 'BTC-USDT', persist })).rejects.toThrow();
      expect(persist).not.toHaveBeenCalled();
    } finally {
      await admin.$executeRawUnsafe('GRANT SELECT ON "positions" TO batch02_rls');
    }
    expect((await service.getMyLimits({ tenantId: tenant, userId: user })).usageState).toBe('CURRENT');
  });

  it('uses the new owner policy when an ownership transfer commits before admission', async () => {
    const fromOwner = randomUUID(), toOwner = randomUUID(), movingAccount = randomUUID();
    await admin.user.createMany({ data: [fromOwner, toOwner].map((id) => ({ id, tenantId: tenant, email: `${id}@example.test`,
      emailIndex: id.replace(/-/g, ''), passwordHash: 'synthetic', status: 'ACTIVE' })) });
    await admin.tradingAccount.create({ data: { id: movingAccount, tenantId: tenant, userId: fromOwner, exchangeId,
      label: 'Moving', apiKeyBlindIndex: randomUUID(), apiKeyLastFour: '0003' } });
    await service.updateMyLimits({ tenantId: tenant, userId: fromOwner, patch: { maxOpenOrders: 100 },
      idempotencyKey: 'transfer-from-key', expectedUpdatedAt: null });
    await service.updateMyLimits({ tenantId: tenant, userId: toOwner, patch: { maxOpenOrders: 0 },
      idempotencyKey: 'transfer-to-key', expectedUpdatedAt: null });
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const changed = new Promise<void>((resolve) => { entered = resolve; });
    const transfer = admin.$transaction(async (tx) => {
      await tx.tradingAccount.update({ where: { id: movingAccount }, data: { userId: toOwner } });
      entered(); await gate;
    }, { timeout: 10000 });
    await changed;
    const persist = jest.fn(async () => 'incorrectly admitted');
    const admission = service.persistOrderIntentWithLimits({ tenantId: tenant, accountId: movingAccount, symbol: 'BTC-USDT', persist });
    const outcome = admission.then(() => null, (error) => error);
    try {
      let waiting = false;
      for (let n = 0; n < 100; n++) {
        const [row] = await admin.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM pg_locks WHERE NOT granted`;
        if (row && row.count > 0n) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
    } finally { release(); }
    await transfer;
    expect((await outcome)?.getResponse?.()).toMatchObject({ code: 'USER_OPEN_ORDER_LIMIT_EXCEEDED' });
    expect(persist).not.toHaveBeenCalled();
  });

  it('refuses to transfer existing positions or unresolved orders into a count-limited owner', async () => {
    const donor = randomUUID(), incoming = randomUUID();
    await admin.user.create({ data: { id: donor, tenantId: tenant, email: `${donor}@example.test`,
      emailIndex: donor.replace(/-/g, ''), passwordHash: 'synthetic', status: 'ACTIVE' } });
    await admin.tradingAccount.create({ data: { id: incoming, tenantId: tenant, userId: donor, exchangeId,
      label: 'Incoming account', apiKeyBlindIndex: randomUUID(), apiKeyLastFour: '0005' } });
    const symbol = await admin.tradingSymbol.create({ data: { tenantId: tenant, exchangeId, symbol: 'ETH-USDT', venueSymbol: 'ETHUSDT',
      baseAsset: 'ETH', quoteAsset: 'USDT', priceTick: '0.01', quantityStep: '0.00001', minQuantity: '0.00001', minNotional: '1', isTradeable: true } });
    const position = await admin.position.create({ data: { tenantId: tenant, accountId: incoming, symbolId: symbol.id,
      venue: 'PAPER', symbol: 'ETH-USDT', quantity: '1', side: 'LONG' } });
    const outstanding = await admin.omsOrderIntent.create({ data: { tenantId: tenant, accountId: incoming, symbol: 'ETH-USDT',
      side: 'BUY', orderType: 'LIMIT', quantity: '1', price: '1', environment: 'PAPER', clientOrderId: randomUUID(), source: 'MANUAL', isSimulated: true } });
    await expect(db.withTenantRls(tenant, (tx) => tx.tradingAccount.update({ where: { id: incoming }, data: { userId: user } }))).rejects.toThrow();
    await admin.omsOrderIntent.update({ where: { id: outstanding.id }, data: { state: 'CANCELLED' } });
    await expect(db.withTenantRls(tenant, (tx) => tx.tradingAccount.update({ where: { id: incoming }, data: { userId: user } }))).rejects.toThrow();
    await admin.position.update({ where: { id: position.id }, data: { quantity: '0', side: 'FLAT' } });
    await expect(admin.tradingAccount.update({ where: { id: incoming }, data: { userId: user } })).resolves.toMatchObject({ userId: user });
    const pending = await admin.omsOrderIntent.create({ data: { tenantId: tenant, accountId: incoming, symbol: 'ETH-USDT',
      side: 'BUY', orderType: 'LIMIT', quantity: '1', price: '1', environment: 'PAPER', clientOrderId: randomUUID(), source: 'MANUAL', isSimulated: true } });
    await expect(db.withTenantRls(tenant, (tx) => tx.tradingAccount.update({ where: { id: incoming }, data: { deletedAt: new Date() } }))).rejects.toThrow();
    await admin.omsOrderIntent.update({ where: { id: pending.id }, data: { state: 'CANCELLED' } });
    await admin.tradingAccount.update({ where: { id: incoming }, data: { userId: donor } });
  });

  it('serializes copy-budget configuration with OMS admission and binds it to the actual account owner', async () => {
    const follower = randomUUID(), copyAccount = randomUUID();
    await admin.user.create({ data: { id: follower, tenantId: tenant, email: `${follower}@example.test`,
      emailIndex: follower.replace(/-/g, ''), passwordHash: 'synthetic', status: 'ACTIVE' } });
    await admin.tradingAccount.create({ data: { id: copyAccount, tenantId: tenant, userId: follower, exchangeId,
      label: 'Copy account', apiKeyBlindIndex: randomUUID(), apiKeyLastFour: '0004' } });
    const persist = jest.fn(async (tx: Prisma.TransactionClient) =>
      tx.omsOrderIntent.create({ data: { tenantId: tenant, accountId: copyAccount, symbol: 'BTC-USDT', side: 'BUY', orderType: 'LIMIT',
        quantity: '1', price: '1', environment: 'PAPER', clientOrderId: randomUUID(), source: 'COPY_TRADING', followerId: follower, isSimulated: true } }));
    await expect(service.persistOrderIntentWithLimits({ tenantId: tenant, accountId: copyAccount, symbol: 'BTC-USDT', copyFollowerId: user, persist }))
      .rejects.toThrow('does not own');
    expect(persist).not.toHaveBeenCalled();

    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const configured = new Promise<void>((resolve) => { entered = resolve; });
    const writer = admin.$transaction(async (tx) => {
      await tx.copyBudget.create({ data: { tenantId: tenant, userId: follower, maxActiveExposure: '100', currency: 'USDT' } });
      entered(); await gate;
    }, { timeout: 10000 });
    await configured;
    const admission = service.persistOrderIntentWithLimits({ tenantId: tenant, accountId: copyAccount, symbol: 'BTC-USDT', copyFollowerId: follower, persist });
    const outcome = admission.then(() => null, (error) => error);
    try {
      let waiting = false;
      for (let n = 0; n < 100; n++) {
        const [row] = await admin.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted`;
        if (row && row.count > 0n) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
    } finally { release(); }
    await writer;
    expect((await outcome)?.getResponse?.()).toMatchObject({ code: 'BLOCKED_EXPOSURE_UNVERIFIED' });
    expect(persist).not.toHaveBeenCalled();

    // When admission wins, a new ceiling waits for that intent and then
    // refuses to activate while it is in flight. Otherwise the older intent
    // could still be routed after the new cap had supposedly taken effect.
    await admin.copyBudget.deleteMany({ where: { tenantId: tenant, userId: follower } });
    let finish!: () => void, admitted!: () => void;
    const hold = new Promise<void>((resolve) => { finish = resolve; });
    const inside = new Promise<void>((resolve) => { admitted = resolve; });
    const first = service.persistOrderIntentWithLimits({ tenantId: tenant, accountId: copyAccount, symbol: 'BTC-USDT', copyFollowerId: follower,
      persist: async (tx) => { const row = await persist(tx); admitted(); await hold; return row; } });
    await inside;
    const ceilingWriter = (async () => admin.tenantSetting.create({ data: { tenantId: tenant, key: 'copy_budget.tenant_ceiling',
      value: { amount: '100', currency: 'USDT' } } }))();
    const ceilingOutcome = ceilingWriter.then(() => null, (error) => error);
    try {
      let waiting = false;
      for (let n = 0; n < 100; n++) {
        const [row] = await admin.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted`;
        if (row && row.count > 0n) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
    } finally { finish(); }
    const accepted = await first;
    expect(String((await ceilingOutcome)?.message)).toContain('Resolve active copy orders');
    const symbol = await admin.tradingSymbol.create({ data: { tenantId: tenant, exchangeId, symbol: 'BTC-USDT', venueSymbol: 'BTCUSDT',
      baseAsset: 'BTC', quoteAsset: 'USDT', priceTick: '0.01', quantityStep: '0.00001', minQuantity: '0.00001', minNotional: '1', isTradeable: true } });
    const canonical = await admin.order.create({ data: { tenantId: tenant, accountId: copyAccount, symbolId: symbol.id,
      clientOrderId: accepted.clientOrderId, venue: 'PAPER', symbol: 'BTC-USDT', side: 'BUY', orderType: 'LIMIT',
      status: 'SUBMITTED', quantity: '1', price: '1', isSimulated: true, metadata: { source: 'COPY_TRADING' } } });
    // The current service returns a safe, actionable conflict. Direct/older
    // writers are independently blocked by the database trigger.
    await expect(new CopyBudgetService(db).upsertLimits({ tenantId: tenant, userId: follower, maxActiveExposure: '100', currency: 'USDT' }))
      .rejects.toMatchObject({ response: { code: 'COPY_BUDGET_ACTIVE_ORDERS' } });
    await expect(db.withTenantRls(tenant, (tx) => tx.copyBudget.create({ data: { tenantId: tenant, userId: follower,
      maxActiveExposure: '100', currency: 'USDT' } }))).rejects.toThrow();
    await expect(admin.tradingAccount.update({ where: { id: copyAccount }, data: { userId: user } })).rejects.toThrow();
    await expect(admin.omsOrderIntent.update({ where: { id: accepted.id }, data: { source: 'MANUAL' } })).rejects.toThrow();
    await expect(admin.omsOrderIntent.delete({ where: { id: accepted.id } })).rejects.toThrow();
    await expect(admin.order.delete({ where: { id: canonical.id } })).rejects.toThrow();
    // FAILED can mean an enqueue response was lost. It is not proof of no
    // order, and even a nominally cancelled intent cannot hide an open order.
    await admin.omsOrderIntent.update({ where: { id: accepted.id }, data: { state: 'FAILED' } });
    await expect(new CopyBudgetService(db).upsertLimits({ tenantId: tenant, userId: follower, maxActiveExposure: '100', currency: 'USDT' }))
      .rejects.toMatchObject({ response: { code: 'COPY_BUDGET_ACTIVE_ORDERS' } });
    await admin.omsOrderIntent.update({ where: { id: accepted.id }, data: { state: 'RECONCILIATION_REQUIRED' } });
    await admin.omsOrderIntent.update({ where: { id: accepted.id }, data: { state: 'CANCELLED' } });
    await expect(admin.tenantSetting.create({ data: { tenantId: tenant, key: 'copy_budget.tenant_ceiling', value: { amount: '100', currency: 'USDT' } } })).rejects.toThrow();
    await admin.order.update({ where: { id: canonical.id }, data: { status: 'CANCELLED' } });
    await admin.tenantSetting.create({ data: { tenantId: tenant, key: 'copy_budget.tenant_ceiling', value: { amount: '100', currency: 'USDT' } } });
    await expect(admin.order.update({ where: { id: canonical.id }, data: { status: 'SUBMITTED' } })).rejects.toThrow();
    await admin.order.delete({ where: { id: canonical.id } });
    await expect(admin.order.create({ data: { tenantId: tenant, accountId: copyAccount, symbolId: symbol.id,
      clientOrderId: accepted.clientOrderId, venue: 'PAPER', symbol: 'BTC-USDT', side: 'BUY', orderType: 'LIMIT',
      status: 'SUBMITTED', quantity: '1', price: '1', isSimulated: true, metadata: { source: 'COPY_TRADING' } } })).rejects.toThrow();
    await expect(service.persistOrderIntentWithLimits({ tenantId: tenant, accountId: copyAccount, symbol: 'ETH-USDT', copyFollowerId: follower, persist }))
      .rejects.toMatchObject({ response: { code: 'BLOCKED_EXPOSURE_UNVERIFIED' } });
    // The DB trigger also refuses legacy inserts and reactivation without the
    // application wrapper, including writes under the tenant-scoped RLS role.
    await expect(db.withTenantRls(tenant, (tx) => tx.omsOrderIntent.create({ data: { tenantId: tenant, accountId: copyAccount,
      followerId: follower, symbol: 'ETH-USDT', side: 'BUY', orderType: 'LIMIT', quantity: '1', price: '1',
      environment: 'PAPER', clientOrderId: randomUUID(), source: 'COPY_TRADING', isSimulated: true } }))).rejects.toThrow();
    await expect(admin.omsOrderIntent.update({ where: { id: accepted.id }, data: { state: 'CREATED' } })).rejects.toThrow();
    expect(await admin.omsOrderIntent.count({ where: { tenantId: tenant, accountId: copyAccount } })).toBe(1);
    await admin.tenantSetting.deleteMany({ where: { tenantId: tenant, key: 'copy_budget.tenant_ceiling' } });
  });

  it('serializes two real OMS reservations, blocking the second at the user-wide order cap', async () => {
    const attempt = (symbol: string) => service.persistOrderIntentWithLimits({ tenantId: tenant, accountId: account, symbol,
      persist: (tx) => tx.omsOrderIntent.create({ data: { tenantId: tenant, accountId: account, symbol, side: 'BUY',
        orderType: 'LIMIT', quantity: '1', price: '1', environment: 'PAPER', clientOrderId: randomUUID(), source: 'MANUAL', isSimulated: true } }),
    });
    const results = await Promise.allSettled([attempt('BTC-USDT'), attempt('ETH-USDT')]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(refused?.reason?.getResponse?.()).toMatchObject({ code: 'USER_OPEN_ORDER_LIMIT_EXCEEDED' });
    const view = await service.getMyLimits({ tenantId: tenant, userId: user });
    expect(view.usage).toMatchObject({ ownedAccountCount: 1, openOrderCount: 1, openPositionSlots: 1 });
    expect(await admin.omsOrderIntent.count({ where: { tenantId: tenant, accountId: account } })).toBe(1);
  });
});
