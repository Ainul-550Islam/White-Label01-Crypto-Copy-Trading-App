import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { VersioningType, type INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Permission } from '@wlct/shared-types';
import request from 'supertest';
import { GlobalValidationPipe } from '../../common/pipes/global-validation.pipe';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CopyBudgetController } from './copy-budget.controller';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CopyBudgetService, COPY_BUDGET_TENANT_SETTING_KEY } from './copy-budget.service';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL;
const rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;
(adminUrl && rlsUrl ? describe : describe.skip)('copy budgets with forced tenant RLS', () => {
  const tenant = randomUUID(), otherTenant = randomUUID(), user = randomUUID(), otherUser = randomUUID();
  const account = randomUUID(), trader = randomUUID(), strategy = randomUUID(), subscription = randomUUID();
  const tables = ['users', 'copy_budgets', 'copy_budget_reduction_intents', 'tenant_settings', 'trading_accounts', 'account_balance_snapshots', 'copy_subscriptions'];
  const prior = new Map<string, { relrowsecurity: boolean; relforcerowsecurity: boolean }>();
  const client = (url: string) => new PrismaService({ databaseUrl: url, isProduction: false, databaseReadEnabled: false } as never,
    { warn() {}, debug() {}, error() {}, info() {} } as never);
  let admin: PrismaService, db: PrismaService, service: CopyBudgetService, app: INestApplication, exchangeId: string, createdExchange = false;

  beforeAll(async () => {
    admin = client(adminUrl!); db = client(rlsUrl!);
    for (const table of tables) {
      const [state] = await admin.$queryRawUnsafe<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='${table}'`);
      prior.set(table, state);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    }
    await admin.tenant.createMany({ data: [tenant, otherTenant].map((id) => ({ id, slug: `budget-${id}`, name: 'Budget RLS test' })) });
    await admin.user.createMany({ data: [
      { id: user, tenantId: tenant, email: `${user}@example.test`, emailIndex: user.replace(/-/g, ''), passwordHash: 'not-a-real-secret', status: 'ACTIVE' },
      { id: otherUser, tenantId: otherTenant, email: `${otherUser}@example.test`, emailIndex: otherUser.replace(/-/g, ''), passwordHash: 'not-a-real-secret', status: 'ACTIVE' },
    ] });
    const existing = await admin.exchange.findUnique({ where: { venue: 'PAPER' } });
    const exchange = existing ?? await admin.exchange.create({ data: { venue: 'PAPER', name: 'Test paper venue',
      supportedMarketTypes: ['SPOT'], restBaseUrl: 'https://example.invalid', wsBaseUrl: 'wss://example.invalid' } });
    exchangeId = exchange.id; createdExchange = !existing;
    await admin.tradingAccount.create({ data: { id: account, tenantId: tenant, userId: user, exchangeId, label: 'Budget account',
      apiKeyBlindIndex: randomUUID(), apiKeyLastFour: '0001' } });
    await admin.accountBalanceSnapshot.create({ data: { tenantId: tenant, accountId: account, asset: 'USDT', total: '1000',
      observedAtMicros: BigInt(Date.now()) * 1000n } });
    await admin.traderProfile.create({ data: { id: trader, tenantId: tenant, userId: user, displayName: 'Budget test trader' } });
    await admin.traderStrategy.create({ data: { id: strategy, tenantId: tenant, traderId: trader, userId: user, name: 'Budget test' } });
    await admin.copySubscription.create({ data: { id: subscription, tenantId: tenant, followerId: user, traderId: trader,
      strategyId: strategy, state: 'ACTIVE', allocationAmount: '40', idempotencyKey: `budget-${subscription}` } });
    await admin.tenantSetting.create({ data: { tenantId: tenant, key: COPY_BUDGET_TENANT_SETTING_KEY, value: { amount: '150', currency: 'USDT' } } });
    await admin.copyBudget.createMany({ data: [
      { tenantId: tenant, userId: user, maxActiveExposure: '100', currency: 'USDT' },
      { tenantId: otherTenant, userId: otherUser, maxActiveExposure: '1', currency: 'USDT' },
    ] });
    service = new CopyBudgetService(db);
    const module = await Test.createTestingModule({ controllers: [CopyBudgetController],
      providers: [{ provide: CopyBudgetService, useValue: service }] }).compile();
    app = module.createNestApplication();
    // Test actors stand in for JWT verification; the actual guard, DTO and
    // tenant-scoped PostgreSQL service are used by the HTTP requests below.
    app.use((req: { headers: Record<string, string | undefined>; actor?: unknown; user?: unknown }, _res: unknown, next: () => void) => {
      if (req.headers['x-test-actor']) {
        const actor = { tenantId: tenant, userId: req.headers['x-test-actor'] === 'owner' ? user : otherUser, roles: [], permissions: [] };
        req.actor = actor; req.user = actor;
      }
      next();
    });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new GlobalValidationPipe());
    app.useGlobalGuards(new PermissionsGuard(new Reflector(), {
      getEffectiveAccess: async (id: string) => ({ roleKeys: [], permissionKeys: id === user ? [Permission.COPY_SUBSCRIPTION_READ, Permission.COPY_SUBSCRIPTION_MANAGE] : [] }),
    } as never, { record: async () => undefined } as never));
    await app.init();
  });

  afterAll(async () => {
    if (!admin) return;
    if (app) await app.close();
    await admin.tenant.deleteMany({ where: { id: { in: [tenant, otherTenant] } } });
    if (createdExchange) await admin.exchange.delete({ where: { id: exchangeId } });
    for (const table of tables) {
      const state = prior.get(table);
      if (state && !state.relforcerowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`);
      if (state && !state.relrowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
    }
    await db.$disconnect(); await admin.$disconnect();
  });

  it('reads the real cap, ceiling, exposure and equity and isolates tenants', async () => {
    expect(await service.loadLimits(tenant, user)).toMatchObject({ maxActiveExposure: '100', tenantCeiling: '150', currency: 'USDT' });
    expect(await service.loadActiveExposure(tenant, user)).toEqual([{ subscriptionId: subscription, traderId: trader, allocationAmount: '40' }]);
    expect(await service.loadEquityObservedAt(tenant, user)).toBeInstanceOf(Date);
    const decision = await service.evaluate({ tenantId: tenant, userId: user, subscriptionId: subscription, traderId: trader,
      notional: '100', quantity: '1', price: '100', currency: 'USDT' });
    expect(decision).toMatchObject({ decision: 'BLOCK', reasonCode: 'BLOCKED_EXPOSURE_UNVERIFIED', effectiveCap: '100', committed: null, remaining: null, allowedNotional: '0' });
    expect(await db.copyBudget.count()).toBe(0);
    expect(await db.withTenantRls(otherTenant, (tx) => tx.copyBudget.findMany({ where: { tenantId: tenant } }))).toEqual([]);
    await expect(service.loadLimits(otherTenant, user)).rejects.toThrow('Copy budget user not found');
  });

  it('does not treat percentage allocations as quote-asset amounts', async () => {
    await admin.copySubscription.update({ where: { id: subscription }, data: { allocationMode: 'PERCENTAGE_BALANCE', allocationAmount: '10' } });
    try {
      expect(await service.getView(tenant, user)).toMatchObject({ effectiveCap: '100', committed: null, remaining: null, exposureStatus: 'UNAVAILABLE' });
      expect(await service.evaluate({ tenantId: tenant, userId: user, subscriptionId: subscription, traderId: trader,
        notional: '1', quantity: '1', price: '1', currency: 'USDT' })).toMatchObject({ decision: 'BLOCK', reasonCode: 'BLOCKED_BUDGET_UNREADABLE' });
    } finally {
      await admin.copySubscription.update({ where: { id: subscription }, data: { allocationMode: 'PROPORTIONAL', allocationAmount: '40' } });
    }
  });

  it('enforces permissions, exact decimal validation and the request key at the real HTTP boundary', async () => {
    const path = '/v1/copy-trading/budget/reduce';
    await request(app.getHttpServer()).post(path).send({ maxActiveExposure: '95', currency: 'USDT' }).expect(401);
    await request(app.getHttpServer()).post(path).set('x-test-actor', 'unprivileged')
      .set('Idempotency-Key', 'reduce-http-test').send({ maxActiveExposure: '95', currency: 'USDT' }).expect(403);
    await request(app.getHttpServer()).post(path).set('x-test-actor', 'owner').send({ maxActiveExposure: '95', currency: 'USDT' }).expect(400);
    for (const maxActiveExposure of ['1e3', '1.0000000000001', '-1', '10000000000000000']) {
      await request(app.getHttpServer()).post(path).set('x-test-actor', 'owner')
        .set('Idempotency-Key', 'reduce-http-invalid').send({ maxActiveExposure, currency: 'USDT' }).expect(422);
    }
    await request(app.getHttpServer()).post(path).set('x-test-actor', 'owner')
      .set('Idempotency-Key', 'reduce-http-test').send({ maxActiveExposure: '95', currency: 'USDT', userId: otherUser }).expect(422);
    const saved = await request(app.getHttpServer()).post(path).set('x-test-actor', 'owner')
      .set('Idempotency-Key', 'reduce-http-test').send({ maxActiveExposure: '95', currency: 'USDT' }).expect(200);
    expect(saved.body).toMatchObject({ userId: user, maxActiveExposure: '95', committed: '40' });
  });

  it('does not let the legacy PUT widen or clear limits without protected controls', async () => {
    const path = '/v1/copy-trading/budget';
    await request(app.getHttpServer()).put(path).set('x-test-actor', 'owner')
      .send({ maxActiveExposure: '94', currency: 'USDT' }).expect(400);
    await request(app.getHttpServer()).put(path).set('x-test-actor', 'owner').set('Idempotency-Key', 'legacy-missing-currency')
      .send({ maxActiveExposure: '94' }).expect(400);
    await request(app.getHttpServer()).put(path).set('x-test-actor', 'owner').set('Idempotency-Key', 'legacy-clear-trader')
      .send({ maxActiveExposure: '94', currency: 'USDT', perTraderCap: null }).expect(400);
    await request(app.getHttpServer()).put(path).set('x-test-actor', 'owner').set('Idempotency-Key', 'legacy-widen-budget')
      .send({ maxActiveExposure: '120', currency: 'USDT' }).expect(409);
    const saved = await request(app.getHttpServer()).put(path).set('x-test-actor', 'owner').set('Idempotency-Key', 'legacy-reduce-budget')
      .send({ maxActiveExposure: '94', currency: 'USDT' }).expect(200);
    expect(saved.body.maxActiveExposure).toBe('94');
  });

  it('serializes competing reductions, replays one intent and refuses widening or key reuse', async () => {
    const first = { tenantId: tenant, userId: user, maxActiveExposure: '90', currency: 'USDT', idempotencyKey: 'reduce-intent-first' };
    const second = { tenantId: tenant, userId: user, maxActiveExposure: '70', currency: 'USDT', idempotencyKey: 'reduce-intent-second' };
    const results = await Promise.allSettled([service.reduceLimit(first), service.reduceLimit(second)]);
    expect(results[1].status).toBe('fulfilled');
    expect((await service.getView(tenant, user)).maxActiveExposure).toBe('70');
    expect((await service.reduceLimit({ ...second, maxActiveExposure: '70.0000' })).maxActiveExposure).toBe('70');
    await expect(service.reduceLimit({ ...second, maxActiveExposure: '60' })).rejects.toMatchObject({ status: 409 });
    await expect(service.reduceLimit({ ...second, currency: 'BTC' })).rejects.toMatchObject({ status: 409 });
    await expect(service.reduceLimit({ ...first, currency: 'BTC', idempotencyKey: 'currency-mismatch' })).rejects.toMatchObject({ status: 409 });
    await expect(service.reduceLimit({ ...first, maxActiveExposure: '80', idempotencyKey: 'widening-intent' })).rejects.toMatchObject({ status: 409 });
    await expect(service.reduceLimit({ ...second, tenantId: otherTenant })).rejects.toThrow('Copy budget user not found');
    expect(await db.copyBudgetReductionIntent.count()).toBe(0);
    const history = await admin.copyBudgetReductionIntent.findMany({ where: { tenantId: tenant, userId: user } });
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history.some((row) => row.requestedExposure.toString() === '70')).toBe(true);
  });

  it('updates the owner only and rejects mismatched or corrupt ceilings before writing', async () => {
    const view = await service.upsertLimits({ tenantId: tenant, userId: user, maxActiveExposure: '90', currency: 'USDT' });
    expect(view).toMatchObject({ maxActiveExposure: '90', committed: '40', remaining: '50' });
    await expect(service.upsertLimits({ tenantId: otherTenant, userId: user, maxActiveExposure: '20', currency: 'USDT' }))
      .rejects.toThrow('Copy budget user not found');
    await expect(service.upsertLimits({ tenantId: tenant, userId: user, maxActiveExposure: '20', currency: 'BTC' }))
      .rejects.toThrow('Budget currency must match');
    await admin.tenantSetting.update({ where: { tenantId_key: { tenantId: tenant, key: COPY_BUDGET_TENANT_SETTING_KEY } },
      data: { value: { amount: 'broken', currency: 'USDT' } } });
    await expect(service.upsertLimits({ tenantId: tenant, userId: user, maxActiveExposure: '20', currency: 'USDT' }))
      .rejects.toMatchObject({ status: 503 });
    expect((await admin.copyBudget.findUnique({ where: { tenantId_userId: { tenantId: tenant, userId: user } } }))?.maxActiveExposure.toString()).toBe('90');
  });
});
