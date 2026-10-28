// # Responsibility: verifies account-owner screening and ownership serialization with real PostgreSQL and forced tenant RLS.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PositionLimitService } from '../risk/position-limit.service';
import { RiskDecisionService } from '../risk-management/risk-decision.service';
import { RiskState } from '../risk-management/risk-management.types';
import { OrderIntentService } from './order-intent.service';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL;
const rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;
(adminUrl && rlsUrl ? describe : describe.skip)('owner-bound OMS risk and database guard under forced RLS', () => {
  const tenant = randomUUID(), otherTenant = randomUUID();
  const owner = randomUUID(), operator = randomUUID(), successor = randomUUID(), otherOwner = randomUUID();
  const account = randomUUID();
  const tables = ['trading_accounts', 'trading_symbols', 'oms_order_intents', 'orders',
    'compliance_screening_requests', 'security_threat_signals', 'risk_decision_records'];
  const prior = new Map<string, { relrowsecurity: boolean; relforcerowsecurity: boolean }>();
  const client = (url: string) => new PrismaService({ databaseUrl: url, isProduction: false, databaseReadEnabled: false } as never,
    { warn() {}, debug() {}, error() {}, info() {} } as never);
  let admin: PrismaService, db: PrismaService, limits: PositionLimitService, risk: RiskDecisionService;
  let exchangeId: string, symbolId: string, createdExchange = false, previousExchangeEnabled = false;

  beforeAll(async () => {
    admin = client(adminUrl!); db = client(rlsUrl!); limits = new PositionLimitService(db);
    for (const table of tables) {
      const [state] = await admin.$queryRawUnsafe<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='${table}'`);
      prior.set(table, state);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    }
    await admin.tenant.createMany({ data: [tenant, otherTenant].map((id) => ({ id, slug: `owner-risk-${id}`, name: 'Risk test' })) });
    await admin.user.createMany({ data: [
      { id: owner, tenantId: tenant }, { id: operator, tenantId: tenant }, { id: successor, tenantId: tenant },
      { id: otherOwner, tenantId: otherTenant },
    ].map((u) => ({ ...u, email: `${u.id}@example.test`, emailIndex: u.id.replace(/-/g, ''), passwordHash: 'synthetic', status: 'ACTIVE' })) });
    const existing = await admin.exchange.findUnique({ where: { venue: 'PAPER' } });
    const exchange = existing ?? await admin.exchange.create({ data: { venue: 'PAPER', name: 'Paper test venue', supportedMarketTypes: ['SPOT'],
      restBaseUrl: 'https://example.invalid', wsBaseUrl: 'wss://example.invalid' } });
    exchangeId = exchange.id; createdExchange = !existing; previousExchangeEnabled = exchange.isEnabled;
    await admin.exchange.update({ where: { id: exchangeId }, data: { isEnabled: true } });
    await admin.tradingAccount.create({ data: { id: account, tenantId: tenant, userId: owner, exchangeId, label: 'Owner account',
      status: 'ACTIVE', marketType: 'SPOT', lastVerifiedAt: new Date(), apiKeyBlindIndex: randomUUID(), apiKeyLastFour: '0001' } });
    const symbol = await admin.tradingSymbol.create({ data: { tenantId: tenant, exchangeId, symbol: 'BTC-USDT', venueSymbol: 'BTCUSDT',
      baseAsset: 'BTC', quoteAsset: 'USDT', marketType: 'SPOT', priceTick: '0.01', quantityStep: '0.0001',
      minQuantity: '0.0001', minNotional: '1', isTradeable: true } });
    symbolId = symbol.id;
    const empty = async () => [];
    const policy = { effectiveVersion: 'v1', scopeChain: [], thresholds: {
      maxGrossExposure: null, maxSymbolExposure: null, maxPositionNotional: null, maxDailyLoss: null,
      maxDrawdownPercent: null, maxIntradayDrawdownPercent: null, marketDataMaxAgeMs: 60000,
      exchangeHealthMaxAgeMs: 60000, liquidationCriticalDistance: '5', liquidationWarningDistance: '10', marginCriticalUtilization: null,
    } };
    risk = new RiskDecisionService(db, { resolveEffectivePolicy: async () => policy } as never,
      { calculateExposure: async () => ({ state: RiskState.NORMAL, grossExposure: '0', totalExposure: '0', symbolExposures: [], staleSymbols: [], unknownPrices: [] }) } as never,
      { evaluatePositionRisk: empty } as never, { evaluateMargin: empty } as never, { evaluateLeverage: empty } as never,
      { evaluateLiquidationRisk: empty } as never, { evaluateConcentration: empty } as never, { evaluateDrawdown: empty } as never,
      { evaluateDailyLoss: empty } as never, { evaluateCorrelation: empty } as never, { evaluateVar: empty } as never,
      { runStressTests: empty } as never, { isBlocked: async () => false } as never, { isEngaged: async () => false } as never,
      {} as never, { emitThresholdBreached: async () => undefined } as never, {} as never);
  });

  afterAll(async () => {
    if (!admin) return;
    // The production guard requires terminal/reconciled orders before deletion.
    await admin.order.updateMany({ where: { tenantId: tenant }, data: { status: 'CANCELLED', reconciliationState: 'IN_SYNC' } });
    await admin.omsOrderIntent.updateMany({ where: { tenantId: tenant }, data: { state: 'CANCELLED' } });
    await admin.tenant.deleteMany({ where: { id: { in: [tenant, otherTenant] } } });
    if (createdExchange) await admin.exchange.delete({ where: { id: exchangeId } });
    else await admin.exchange.update({ where: { id: exchangeId }, data: { isEnabled: previousExchangeEnabled } });
    for (const table of tables) {
      const state = prior.get(table);
      if (state && !state.relforcerowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`);
      if (state && !state.relrowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
    }
    await db.$disconnect(); await admin.$disconnect();
  });

  it('blocks the account owner even when the operator is clear', async () => {
    await admin.complianceScreeningRequest.create({ data: { tenantId: tenant, userId: owner, type: 'AML', status: 'COMPLETED',
      decision: 'BLOCK', idempotencyKey: randomUUID() } });
    expect(await db.complianceScreeningRequest.count()).toBe(0); // no tenant GUC
    const result = await risk.evaluateUnifiedRisk({ tenantId: tenant, accountId: account, userId: operator, expectedAccountOwnerId: owner });
    expect(result.decision).toBe('BLOCK');
    expect(result.ruleIds).toContain('COMPLIANCE_BLOCK');
    const mismatched = await risk.evaluateUnifiedRisk({ tenantId: tenant, accountId: account, userId: operator, expectedAccountOwnerId: successor });
    expect(mismatched.ruleIds).toContain('ACCOUNT_OWNER_CHANGED');
  });

  it('rechecks both identities in the real reservation transaction, independently of a mocked earlier ALLOW', async () => {
    const fakeRisk = { evaluateUnifiedRisk: jest.fn(async () => ({ id: randomUUID(), decision: 'ALLOW', policyVersion: 'v1' })) };
    const outbox = { append: jest.fn(async () => undefined) };
    const service = new OrderIntentService(db, fakeRisk as never, limits, outbox as never);
    const input = { tenantId: tenant, accountId: account, symbol: 'BTC-USDT', side: 'BUY', orderType: 'LIMIT',
      quantity: '0.1', price: '100', environment: 'PAPER', source: 'MANUAL', userId: operator };
    await expect(service.createIntent(input)).rejects.toThrow('Compliance screening does not authorize this order.');
    expect(await admin.omsOrderIntent.count({ where: { tenantId: tenant, accountId: account } })).toBe(0);
    expect(outbox.append).not.toHaveBeenCalled();
    await admin.complianceScreeningRequest.deleteMany({ where: { tenantId: tenant, userId: owner } });
    await admin.securityThreatSignal.create({ data: { tenantId: tenant, userId: operator, ruleId: 'RISK_TEST', riskLevel: 'HIGH',
      decision: 'DENY', safeSummary: 'Synthetic risk signal' } });
    await expect(service.createIntent(input)).rejects.toThrow('Security state does not authorize this order.');
    await admin.securityThreatSignal.deleteMany({ where: { tenantId: tenant, userId: operator } });
    const accepted = await service.createIntent(input);
    expect(accepted).toMatchObject({ accountId: account, tenantId: tenant, state: 'CREATED' });
    expect(fakeRisk.evaluateUnifiedRisk).toHaveBeenLastCalledWith(expect.objectContaining({ userId: operator, expectedAccountOwnerId: owner }));
    expect(outbox.append).toHaveBeenCalledTimes(1);
    await admin.omsOrderIntent.update({ where: { id: accepted.id }, data: { state: 'CANCELLED' } });
  });

  it('serializes a legacy intent insert with a simultaneous transfer and prevents hiding the reservation', async () => {
    let release!: () => void, inserted!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const inside = new Promise<void>((resolve) => { inserted = resolve; });
    const id = randomUUID();
    const writer = admin.$transaction(async (tx) => {
      await tx.omsOrderIntent.create({ data: { id, tenantId: tenant, accountId: account, symbol: 'BTC-USDT', side: 'BUY',
        orderType: 'LIMIT', quantity: '1', price: '1', environment: 'PAPER', clientOrderId: randomUUID(), source: 'MANUAL' } });
      inserted(); await gate;
    }, { timeout: 10000 });
    await inside;
    const moving = db.withTenantRls(tenant, (tx) => tx.tradingAccount.update({ where: { id: account }, data: { userId: successor } }));
    const outcome = moving.then(() => null, (e) => e);
    try {
      let waiting = false;
      for (let n = 0; n < 100; n++) {
        const [row] = await admin.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM pg_locks WHERE NOT granted`;
        if (row && row.count > 0n) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
    } finally { release(); }
    await writer;
    expect(String((await outcome)?.message)).toContain('Resolve active orders');
    await expect(admin.omsOrderIntent.delete({ where: { id } })).rejects.toThrow();
    await expect(admin.tradingAccount.delete({ where: { id: account } })).rejects.toThrow();
    await expect(admin.tradingAccount.update({ where: { id: account }, data: { deletedAt: new Date() } })).rejects.toThrow();
    await admin.omsOrderIntent.update({ where: { id }, data: { state: 'CANCELLED' } });
    await admin.tradingAccount.update({ where: { id: account }, data: { userId: successor } });
    const persist = jest.fn(async () => 'must not persist');
    await expect(limits.persistOrderIntentWithLimits({ tenantId: tenant, accountId: account, symbol: 'BTC-USDT', expectedOwnerUserId: owner, persist }))
      .rejects.toThrow('ownership changed');
    expect(persist).not.toHaveBeenCalled();
    await admin.tradingAccount.update({ where: { id: account }, data: { userId: owner } });
  });

  it('includes observed venue orders and refuses stale-snapshot writes', async () => {
    const order = await admin.order.create({ data: { tenantId: tenant, accountId: account, symbolId, clientOrderId: randomUUID(),
      exchangeOrderId: 'venue-observation', venue: 'PAPER', symbol: 'BTC-USDT', side: 'BUY', orderType: 'LIMIT',
      status: 'SUBMITTED', quantity: '1', price: '1', isSimulated: true } });
    await expect(admin.tradingAccount.update({ where: { id: account }, data: { userId: successor } })).rejects.toThrow();
    await expect(admin.order.delete({ where: { id: order.id } })).rejects.toThrow();
    await admin.order.update({ where: { id: order.id }, data: { status: 'CANCELLED', reconciliationState: 'IN_SYNC' } });
    await admin.order.delete({ where: { id: order.id } });
    await expect(admin.$transaction((tx) => tx.omsOrderIntent.create({ data: { tenantId: tenant, accountId: account,
      symbol: 'BTC-USDT', side: 'BUY', orderType: 'LIMIT', quantity: '1', price: '1', environment: 'PAPER',
      clientOrderId: randomUUID(), source: 'MANUAL' } }), { isolationLevel: 'RepeatableRead' })).rejects.toThrow();
  });
});
