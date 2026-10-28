// Verifies legacy unscoped writes cannot hide a budget or an in-flight copy behind forced RLS.
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL, rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;
(adminUrl && rlsUrl ? describe : describe.skip)('copy-budget migration guards with legacy and forced-RLS writers', () => {
  const tenant = randomUUID(), owner = randomUUID(), account = randomUUID();
  const tables = ['trading_accounts', 'copy_budgets', 'tenant_settings', 'oms_order_intents', 'orders'];
  const prior = new Map<string, { relrowsecurity: boolean; relforcerowsecurity: boolean }>();
  const client = (url: string) => new PrismaService({ databaseUrl: url, isProduction: false, databaseReadEnabled: false } as never,
    { warn() {}, debug() {}, error() {}, info() {} } as never);
  let admin: PrismaService, db: PrismaService, exchangeId: string, createdExchange = false;
  const createIntent = () => ({ tenantId: tenant, accountId: account, followerId: owner, symbol: 'BTC-USDT', side: 'BUY',
    orderType: 'LIMIT', quantity: '1', price: '1', environment: 'PAPER', clientOrderId: randomUUID(), source: 'COPY_TRADING', isSimulated: true });
  async function force(table: string): Promise<void> {
    await admin.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    await admin.$executeRawUnsafe(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
  }
  beforeAll(async () => {
    admin = client(adminUrl!); db = client(rlsUrl!);
    for (const table of tables) {
      const [state] = await admin.$queryRawUnsafe<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='${table}'`);
      prior.set(table, state); await force(table);
    }
    await admin.tenant.create({ data: { id: tenant, slug: `legacy-copy-${tenant}`, name: 'Copy guard test' } });
    await admin.user.create({ data: { id: owner, tenantId: tenant, email: `${owner}@example.test`,
      emailIndex: owner.replace(/-/g, ''), passwordHash: 'synthetic', status: 'ACTIVE' } });
    const existing = await admin.exchange.findUnique({ where: { venue: 'PAPER' } });
    const exchange = existing ?? await admin.exchange.create({ data: { venue: 'PAPER', name: 'Paper', supportedMarketTypes: ['SPOT'],
      restBaseUrl: 'https://example.invalid', wsBaseUrl: 'wss://example.invalid' } });
    exchangeId = exchange.id; createdExchange = !existing;
    await admin.tradingAccount.create({ data: { id: account, tenantId: tenant, userId: owner, exchangeId,
      label: 'Legacy copy account', apiKeyBlindIndex: randomUUID(), apiKeyLastFour: '0001' } });
  });
  afterAll(async () => {
    if (!admin) return;
    for (const table of tables) await force(table);
    await admin.order.updateMany({ where: { tenantId: tenant }, data: { status: 'CANCELLED', reconciliationState: 'IN_SYNC' } });
    await admin.omsOrderIntent.updateMany({ where: { tenantId: tenant }, data: { state: 'CANCELLED' } });
    await admin.tenant.deleteMany({ where: { id: tenant } });
    if (createdExchange) await admin.exchange.delete({ where: { id: exchangeId } });
    for (const table of tables) {
      const state = prior.get(table);
      if (state && !state.relforcerowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`);
      if (state && !state.relrowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
    }
    await db.$disconnect(); await admin.$disconnect();
  });

  it('blocks an unscoped copy intent even when the budget alone uses forced RLS', async () => {
    await admin.copyBudget.create({ data: { tenantId: tenant, userId: owner, currency: 'USDT', maxActiveExposure: '100' } });
    // Simulate a rolling deployment: older OMS/account tables have not enabled
    // tenant RLS, while the budget table is already protected and invisible.
    await admin.$executeRawUnsafe('ALTER TABLE oms_order_intents DISABLE ROW LEVEL SECURITY');
    await admin.$executeRawUnsafe('ALTER TABLE trading_accounts DISABLE ROW LEVEL SECURITY');
    // Isolate this guard from the later owner-binding trigger, which otherwise
    // rejects the missing context before the copy-budget trigger can run.
    await admin.$executeRawUnsafe('ALTER TABLE oms_order_intents DISABLE TRIGGER account_order_owner_binding');
    try {
      expect(await db.copyBudget.count()).toBe(0);
      await expect(db.omsOrderIntent.create({ data: createIntent() as never }))
        .rejects.toThrow('Copy budget exposure and reservations are unverified');
      expect(await admin.omsOrderIntent.count({ where: { tenantId: tenant } })).toBe(0);
    } finally {
      await admin.$executeRawUnsafe('ALTER TABLE oms_order_intents ENABLE TRIGGER account_order_owner_binding');
      await force('oms_order_intents'); await force('trading_accounts');
      await admin.copyBudget.deleteMany({ where: { tenantId: tenant, userId: owner } });
    }
  });

  it('blocks an unscoped budget write while the active intent is hidden by forced RLS', async () => {
    const intent = await admin.omsOrderIntent.create({ data: createIntent() as never });
    await admin.$executeRawUnsafe('ALTER TABLE copy_budgets DISABLE ROW LEVEL SECURITY');
    try {
      expect(await db.omsOrderIntent.count()).toBe(0);
      await expect(db.copyBudget.create({ data: { tenantId: tenant, userId: owner, currency: 'USDT', maxActiveExposure: '100' } }))
        .rejects.toThrow('Resolve active copy orders before changing this budget');
      expect(await admin.copyBudget.count({ where: { tenantId: tenant, userId: owner } })).toBe(0);
    } finally {
      await force('copy_budgets');
      await admin.omsOrderIntent.update({ where: { id: intent.id }, data: { state: 'CANCELLED' } });
    }
  });
});
