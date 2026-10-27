import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { VersioningType, type INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Permission } from '@wlct/shared-types';
import request from 'supertest';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { LiquidationAlertController } from './liquidation-alert.controller';
import { LiquidationRiskService } from './liquidation-risk.service';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL;
const rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;
(adminUrl && rlsUrl ? describe : describe.skip)('liquidation alerts with forced tenant RLS', () => {
  const tenant = randomUUID(), otherTenant = randomUUID(), owner = randomUUID(), peer = randomUUID(), outsider = randomUUID();
  const account = randomUUID(), peerAccount = randomUUID(), otherAccount = randomUUID(), pos = randomUUID();
  const symbol = randomUUID(), flatSymbol = randomUUID(), otherSymbol = randomUUID();
  const prior = new Map<string, { relrowsecurity: boolean; relforcerowsecurity: boolean }>();
  const tables = ['trading_accounts', 'positions'];
  const client = (url: string) => new PrismaService({ databaseUrl: url, isProduction: false, databaseReadEnabled: false } as never,
    { warn() {}, debug() {}, error() {}, info() {} } as never);
  let admin: PrismaService, db: PrismaService, risk: LiquidationRiskService, app: INestApplication, exchangeId: string, createdExchange = false;
  beforeAll(async () => {
    admin = client(adminUrl!); db = client(rlsUrl!);
    for (const table of tables) {
      const [state] = await admin.$queryRawUnsafe<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='${table}'`);
      prior.set(table, state);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    }
    await admin.tenant.createMany({ data: [tenant, otherTenant].map((id) => ({ id, slug: `liq-${id}`, name: 'Liquidation test' })) });
    await admin.user.createMany({ data: [
      { id: owner, tenantId: tenant }, { id: peer, tenantId: tenant }, { id: outsider, tenantId: otherTenant },
    ].map((u) => ({ ...u, email: `${u.id}@example.test`, emailIndex: u.id.replace(/-/g, ''), passwordHash: 'not-a-real-secret', status: 'ACTIVE' as const })) });
    const existing = await admin.exchange.findUnique({ where: { venue: 'PAPER' } });
    const exchange = existing ?? await admin.exchange.create({ data: { venue: 'PAPER', name: 'Test paper venue',
      supportedMarketTypes: ['SPOT'], restBaseUrl: 'https://example.invalid', wsBaseUrl: 'wss://example.invalid' } });
    exchangeId = exchange.id; createdExchange = !existing;
    await admin.tradingAccount.createMany({ data: [
      { id: account, tenantId: tenant, userId: owner }, { id: peerAccount, tenantId: tenant, userId: peer },
      { id: otherAccount, tenantId: otherTenant, userId: outsider },
    ].map((a, i) => ({ ...a, exchangeId, label: `Test ${i}`, apiKeyBlindIndex: randomUUID(), apiKeyLastFour: '0001' })) });
    await admin.tradingSymbol.createMany({ data: [
      { id: symbol, tenantId: tenant, symbol: 'BTC-USDT' }, { id: flatSymbol, tenantId: tenant, symbol: 'ETH-USDT' },
      { id: otherSymbol, tenantId: otherTenant, symbol: 'BTC-USDT' },
    ].map((s) => ({ ...s, exchangeId, venueSymbol: s.symbol, baseAsset: 'BTC', quoteAsset: 'USDT',
      priceTick: '0.01', quantityStep: '0.01', minQuantity: '0.01', minNotional: '1' })) });
    await admin.position.createMany({ data: [
      { id: pos, tenantId: tenant, accountId: account, symbolId: symbol, symbol: 'BTC-USDT', venue: 'PAPER', side: 'LONG', quantity: '1.25', markPrice: '100' },
      { tenantId: tenant, accountId: account, symbolId: flatSymbol, symbol: 'ETH-USDT', venue: 'PAPER', side: 'FLAT', quantity: '0' },
      { tenantId: tenant, accountId: peerAccount, symbolId: symbol, symbol: 'BTC-USDT', venue: 'PAPER', side: 'LONG', quantity: '9' },
      { tenantId: otherTenant, accountId: otherAccount, symbolId: otherSymbol, symbol: 'BTC-USDT', venue: 'PAPER', side: 'LONG', quantity: '8' },
    ] });
    risk = new LiquidationRiskService(db, { resolveEffectivePolicy: async () => ({ thresholds: { marketDataMaxAgeMs: 60000 }, effectiveVersion: 1 }) } as never);
    const module = await Test.createTestingModule({ controllers: [LiquidationAlertController], providers: [
      { provide: PrismaService, useValue: db }, { provide: LiquidationRiskService, useValue: risk },
    ] }).compile();
    app = module.createNestApplication();
    app.use((req: { headers: Record<string, string | undefined>; actor?: unknown; user?: unknown; tenantContext?: unknown }, _res: unknown, next: () => void) => {
      const who = req.headers['x-test-actor'];
      if (who) {
        const id = who === 'owner' ? owner : who === 'peer' ? peer : outsider;
        const tid = who === 'outsider' ? otherTenant : tenant;
        req.actor = { tenantId: tid, userId: id, roles: [], permissions: [] }; req.user = req.actor;
        req.tenantContext = { tenantId: tid };
      }
      next();
    });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalGuards(new PermissionsGuard(new Reflector(), {
      getEffectiveAccess: async (id: string) => ({ roleKeys: [], permissionKeys: id === outsider ? [] : [Permission.POSITION_READ] }),
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
  it('requires permission and uses the caller and forced RLS, without treating missing risk results as no positions', async () => {
    await request(app.getHttpServer()).get('/v1/risk/liquidation-alerts').expect(401);
    await request(app.getHttpServer()).get('/v1/risk/liquidation-alerts').set('x-test-actor', 'outsider').expect(403);
    const result = await request(app.getHttpServer()).get('/v1/risk/liquidation-alerts').set('x-test-actor', 'owner').expect(200);
    expect(result.body).toMatchObject({ tenantId: tenant, userId: owner, total: 1, unknownCount: 1 });
    expect(result.body.data[0]).toMatchObject({ positionId: pos, accountId: account, symbol: 'BTC-USDT', quantity: '1.25', bucket: 'UNKNOWN', liquidationPrice: null, distancePercent: null });
    expect(await db.position.count()).toBe(0); // no ambient tenant session
    const peerResult = await request(app.getHttpServer()).get('/v1/risk/liquidation-alerts').set('x-test-actor', 'peer').expect(200);
    expect(peerResult.body.data).toHaveLength(1);
    expect(peerResult.body.data[0]).toMatchObject({ accountId: peerAccount, quantity: '9', bucket: 'UNKNOWN' });
  });
  it('includes a nonzero position even when a stale closed timestamp was not cleared', async () => {
    await admin.position.updateMany({ where: { accountId: account, symbolId: flatSymbol }, data: { quantity: '0.5', side: 'LONG', closedAt: new Date() } });
    try {
      const result = await request(app.getHttpServer()).get('/v1/risk/liquidation-alerts').set('x-test-actor', 'owner').expect(200);
      expect(result.body.total).toBe(2);
      expect(result.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ symbol: 'ETH-USDT', quantity: '0.5', bucket: 'UNKNOWN' })]));
    } finally {
      await admin.position.updateMany({ where: { accountId: account, symbolId: flatSymbol }, data: { quantity: '0', side: 'FLAT', closedAt: null } });
    }
  });
  it('does not promote a non-authoritative NORMAL result to a safe position', async () => {
    jest.spyOn(risk, 'evaluateLiquidationRisk').mockResolvedValueOnce([{ accountId: account, symbol: 'BTC-USDT', state: 'NORMAL',
      isAuthoritative: false, markPrice: '100', liquidationPrice: null, distancePercent: null, severity: 'INFO' } as never]);
    const result = await request(app.getHttpServer()).get('/v1/risk/liquidation-alerts').set('x-test-actor', 'owner').expect(200);
    expect(result.body.data[0].bucket).toBe('UNKNOWN');
  });
  it('reports evaluation failure without inventing a zero quantity or leaking the error', async () => {
    jest.spyOn(risk, 'evaluateLiquidationRisk').mockRejectedValueOnce(new Error('secret-provider-detail'));
    const result = await request(app.getHttpServer()).get('/v1/risk/liquidation-alerts').set('x-test-actor', 'owner').expect(200);
    expect(result.body.data[0]).toMatchObject({ quantity: null, bucket: 'UNKNOWN', accountId: account });
    expect(JSON.stringify(result.body)).not.toContain('secret-provider-detail');
  });
});
