import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PortfolioExposureService } from './portfolio-exposure.service';
import { RiskState } from './risk-management.types';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL;
const rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;
(adminUrl && rlsUrl ? describe : describe.skip)('portfolio exposure against forced tenant RLS', () => {
  const tenants = [randomUUID(), randomUUID()], users = [randomUUID(), randomUUID()];
  const accounts = [randomUUID(), randomUUID()], symbols = [randomUUID(), randomUUID()];
  const tables = ['trading_accounts', 'trading_symbols', 'positions', 'orders', 'oms_order_intents', 'account_balance_snapshots'];
  const prior = new Map<string, { relrowsecurity: boolean; relforcerowsecurity: boolean }>();
  const client = (url: string) => new PrismaService({ databaseUrl: url, isProduction: false, databaseReadEnabled: false } as never,
    { warn() {}, debug() {}, error() {}, info() {} } as never);
  let admin: PrismaService, db: PrismaService, service: PortfolioExposureService;
  let exchangeId: string, createdExchange = false;
  beforeAll(async () => {
    admin = client(adminUrl!); db = client(rlsUrl!);
    for (const table of tables) {
      const [state] = await admin.$queryRawUnsafe<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='${table}'`);
      prior.set(table, state);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    }
    await admin.tenant.createMany({ data: tenants.map((id) => ({ id, slug: `exposure-${id}`, name: 'Exposure test' })) });
    await admin.user.createMany({ data: users.map((id, i) => ({ id, tenantId: tenants[i], email: `${id}@example.test`,
      emailIndex: id.replace(/-/g, ''), passwordHash: 'not-a-real-secret', status: 'ACTIVE' as const })) });
    const existing = await admin.exchange.findUnique({ where: { venue: 'PAPER' } });
    const exchange = existing ?? await admin.exchange.create({ data: { venue: 'PAPER', name: 'Test paper venue',
      supportedMarketTypes: ['SPOT'], restBaseUrl: 'https://example.invalid', wsBaseUrl: 'wss://example.invalid' } });
    exchangeId = exchange.id; createdExchange = !existing;
    await admin.tradingAccount.createMany({ data: accounts.map((id, i) => ({ id, tenantId: tenants[i], userId: users[i],
      exchangeId, label: `Test ${i}`, apiKeyBlindIndex: randomUUID(), apiKeyLastFour: '0001' })) });
    await admin.tradingSymbol.createMany({ data: symbols.map((id, i) => ({ id, tenantId: tenants[i], exchangeId,
      symbol: 'BTC-USDT', venueSymbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', marketType: 'SPOT' as const,
      priceTick: '0.01', quantityStep: '0.01', minQuantity: '0.01', minNotional: '1' })) });
    await admin.position.createMany({ data: accounts.map((accountId, i) => ({ tenantId: tenants[i], accountId, symbolId: symbols[i],
      symbol: 'BTC-USDT', venue: 'PAPER' as const, side: 'LONG' as const, quantity: i ? '8' : '2', markPrice: '999' })) });
    const now = Date.now();
    await admin.marketDataRecord.createMany({ data: symbols.map((symbolId, i) => ({ symbolId, venue: 'PAPER' as const,
      symbol: 'BTC-USDT', interval: '1m', openTime: new Date(now - 61000), closeTime: new Date(now - 1000),
      open: i ? '500' : '10', high: i ? '500' : '10', low: i ? '500' : '10', close: i ? '500' : '10',
      volume: '1', tradeCount: 1 })) });
    await admin.order.createMany({ data: accounts.map((accountId, i) => ({ tenantId: tenants[i], accountId,
      symbolId: symbols[i], clientOrderId: `e${randomUUID().replace(/-/g, '')}`, venue: 'PAPER' as const, symbol: 'BTC-USDT',
      side: 'BUY' as const, orderType: 'LIMIT' as const, status: 'CANCEL_REQUESTED' as const,
      quantity: i ? '100' : '1', price: '5' })) });
    const thresholds = { marketDataMaxAgeMs: 120000, notionalCurrency: 'USDT', maxGrossExposure: '1000',
      maxStrategyExposure: null, maxTraderExposure: null, maxFollowerExposure: null };
    service = new PortfolioExposureService(db, { resolveEffectivePolicy: async () => ({ effectiveVersion: 'test', thresholds,
      sourcePolicies: [{ thresholds }] }) } as never);
  });
  afterAll(async () => {
    if (!admin) return;
    await admin.omsOrderIntent.updateMany({ where: { tenantId: { in: tenants } }, data: { state: 'CANCELLED' } });
    await admin.order.updateMany({ where: { tenantId: { in: tenants } }, data: { status: 'CANCELLED', reconciliationState: 'IN_SYNC' } });
    await admin.order.deleteMany({ where: { tenantId: { in: tenants } } });
    await admin.position.deleteMany({ where: { tenantId: { in: tenants } } });
    await admin.tenant.deleteMany({ where: { id: { in: tenants } } });
    if (createdExchange) await admin.exchange.delete({ where: { id: exchangeId } });
    for (const table of tables) {
      const state = prior.get(table);
      if (state && !state.relforcerowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`);
      if (state && !state.relrowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
    }
    await db.$disconnect(); await admin.$disconnect();
  });
  it('reads this tenant inside a scoped transaction and cannot see the other tenant', async () => {
    expect(await db.position.count()).toBe(0);
    const result = await service.calculateExposure({ tenantId: tenants[0], accountId: accounts[0], candidateSymbol: 'BTC-USDT' });
    expect(result.state).toBe(RiskState.NORMAL);
    expect(result.grossExposure).toBe('20');
    expect(result.openOrderExposure).toBe('5');
    expect(result.totalExposure).toBe('25');
    expect(result.symbolExposures[0].price).toBe('10');
    expect(result.accountExposures).toHaveLength(1);
    expect(result.accountExposures[0].accountId).toBe(accounts[0]);
  });
  it('aggregates the whole tenant while resolving the candidate market from its own account', async () => {
    const otherAccount = await admin.tradingAccount.create({ data: { tenantId: tenants[0], userId: users[0], exchangeId,
      label: 'Second account', apiKeyBlindIndex: randomUUID(), apiKeyLastFour: '0002' } });
    const secondOrder = await admin.order.create({ data: { tenantId: tenants[0], accountId: otherAccount.id, symbolId: symbols[0],
      clientOrderId: `e${randomUUID().replace(/-/g, '')}`, venue: 'PAPER', symbol: 'BTC-USDT', side: 'BUY', orderType: 'LIMIT',
      status: 'FAILED', reconciliationState: 'IN_SYNC', quantity: '8', price: '10' } });
    try {
      const total = await service.calculateExposure({ tenantId: tenants[0], candidateAccountId: accounts[0], candidateSymbol: 'BTC-USDT' });
      expect(total.state).toBe(RiskState.NORMAL);
      expect(total.valuationCurrency).toBe('USDT');
      expect(total.totalExposure).toBe('105');
      expect(total.accountExposures.map((a) => a.accountId)).toEqual(expect.arrayContaining([accounts[0], otherAccount.id]));
      const one = await service.calculateExposure({ tenantId: tenants[0], accountId: accounts[0], candidateSymbol: 'BTC-USDT' });
      expect(one.totalExposure).toBe('25');
      await expect(service.calculateExposure({ tenantId: tenants[0], accountId: accounts[0], candidateAccountId: otherAccount.id,
        candidateSymbol: 'BTC-USDT' })).rejects.toThrow('Candidate account does not match');
    } finally {
      await admin.order.update({ where: { id: secondOrder.id }, data: { status: 'CANCELLED', reconciliationState: 'IN_SYNC' } });
      await admin.order.delete({ where: { id: secondOrder.id } });
      await admin.tradingAccount.delete({ where: { id: otherAccount.id } });
    }
  });
  it('marks an unpaired pending OMS reservation unknown under tenant RLS', async () => {
    const intent = await admin.omsOrderIntent.create({ data: { tenantId: tenants[0], accountId: accounts[0],
      symbol: 'ETH-USDT', side: 'BUY', orderType: 'LIMIT', quantity: '1', price: '10',
      environment: 'PAPER', source: 'MANUAL', clientOrderId: `e${randomUUID().replace(/-/g, '')}` } });
    try {
      const result = await service.calculateExposure({ tenantId: tenants[0], accountId: accounts[0], candidateSymbol: 'BTC-USDT' });
      expect(result.state).toBe(RiskState.UNKNOWN);
      expect(result.unknownPrices).toContain('ETH-USDT');
      const ownRoute = await service.calculateExposure({ tenantId: tenants[0], accountId: accounts[0],
        candidateSymbol: 'BTC-USDT', excludePendingIntentId: intent.id });
      expect(ownRoute.state).toBe(RiskState.NORMAL);
    } finally {
      await admin.omsOrderIntent.update({ where: { id: intent.id }, data: { state: 'CANCELLED' } });
      await admin.omsOrderIntent.delete({ where: { id: intent.id } });
    }
  });
  it('reports unknown for another tenant account, rather than interpreting its absence as a safe candidate', async () => {
    const result = await service.calculateExposure({ tenantId: tenants[0], accountId: accounts[1], candidateSymbol: 'BTC-USDT' });
    expect(result.state).toBe(RiskState.UNKNOWN);
    expect(result.unknownPrices).toContain('BTC-USDT');
  });
});
