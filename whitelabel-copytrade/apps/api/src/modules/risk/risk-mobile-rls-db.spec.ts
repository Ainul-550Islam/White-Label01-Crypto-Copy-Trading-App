import { randomUUID } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ListRiskEventsDto } from './dto/risk.dto';
import { RiskStateService } from './risk-state.service';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL;
const rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;
(adminUrl && rlsUrl ? describe : describe.skip)('mobile risk mirrors under forced tenant RLS', () => {
  const tenant = randomUUID(), other = randomUUID(), account = randomUUID(), otherAccount = randomUUID();
  const tables = ['trading_accounts', 'risk_protection_actions', 'risk_events', 'risk_snapshot_metadata'];
  const prior = new Map<string, { relrowsecurity: boolean; relforcerowsecurity: boolean }>();
  const client = (url: string) => new PrismaService({ databaseUrl: url, isProduction: false, databaseReadEnabled: false } as never,
    { warn() {}, debug() {}, error() {}, info() {} } as never);
  let admin: PrismaService, db: PrismaService, service: RiskStateService, exchangeId: string, createdExchange = false;
  beforeAll(async () => {
    admin = client(adminUrl!); db = client(rlsUrl!);
    for (const table of tables) {
      const [state] = await admin.$queryRawUnsafe<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='${table}'`);
      prior.set(table, state);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    }
    await admin.tenant.createMany({ data: [tenant, other].map((id) => ({ id, slug: `risk-${id}`, name: 'Risk RLS test' })) });
    const existing = await admin.exchange.findUnique({ where: { venue: 'PAPER' } });
    const exchange = existing ?? await admin.exchange.create({ data: { venue: 'PAPER', name: 'Test paper venue',
      supportedMarketTypes: ['SPOT'], restBaseUrl: 'https://example.invalid', wsBaseUrl: 'wss://example.invalid' } });
    exchangeId = exchange.id; createdExchange = !existing;
    await admin.tradingAccount.createMany({ data: [
      { id: account, tenantId: tenant, exchangeId, label: 'One', apiKeyBlindIndex: randomUUID(), apiKeyLastFour: '0001' },
      { id: otherAccount, tenantId: other, exchangeId, label: 'Other', apiKeyBlindIndex: randomUUID(), apiKeyLastFour: '0002' },
    ] });
    await admin.riskSnapshotMetadata.create({ data: { tenantId: tenant, accountId: account, snapshotId: randomUUID(),
      snapshotVersion: 1n, tradingDay: '2026-10-27', equity: '123.45', openOrderCount: 2, capturedAt: new Date(), isComplete: true } });
    await admin.riskProtectionTrip.createMany({ data: [
      { tenantId: tenant, accountId: account, scope: 'ACCOUNT', action: 'BLOCK_ACCOUNT', reason: 'Test protection' },
      { tenantId: tenant, accountId: account, scope: 'ACCOUNT', action: 'BLOCK_ACCOUNT', reason: 'Simulated protection', isSimulated: true },
    ] });
    await admin.killSwitch.create({ data: { tenantId: tenant, scope: 'ACCOUNT', target: account, isEngaged: true, status: 'TRIGGERED', requiresExplicitClear: true } });
    await admin.riskEvent.createMany({ data: [
      { tenantId: tenant, accountId: account, eventType: 'LIMIT_BREACHED', severity: 'CRITICAL', code: 'TEST', message: 'Tenant event' },
      { tenantId: tenant, accountId: account, eventType: 'LIMIT_BREACHED', severity: 'CRITICAL', code: 'SIM', message: 'Simulated event', isSimulated: true },
      { tenantId: other, accountId: otherAccount, eventType: 'LIMIT_BREACHED', severity: 'WARNING', code: 'OTHER', message: 'Other tenant event' },
    ] });
    const config = { riskSnapshotRefreshMs: 60_000, riskSafetySummary: { engineEnabled: true, failClosed: true,
      maxRiskStateAgeMs: 120_000, snapshotRefreshMs: 60_000, refreshOutpacesStaleness: true, ceilings: {}, note: 'Mirror only' } };
    service = new RiskStateService(db, config as never, {} as never, { warn() {}, debug() {}, error() {}, info() {} } as never);
  });
  afterAll(async () => {
    if (!admin) return;
    await admin.tenant.deleteMany({ where: { id: { in: [tenant, other] } } });
    if (createdExchange) await admin.exchange.delete({ where: { id: exchangeId } });
    for (const table of tables) {
      const state = prior.get(table);
      if (state && !state.relforcerowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`);
      if (state && !state.relrowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
    }
    await db.$disconnect(); await admin.$disconnect();
  });
  it('does not turn real risk mirrors, protections or events into empty data when RLS is forced', async () => {
    const status = await service.status(tenant);
    expect(status.engagedSwitchCount).toBe(1);
    expect(status.triggeredProtectionCount).toBe(1);
    expect(status.latestSnapshotPerAccount).toHaveLength(1);
    expect(status.latestSnapshotPerAccount[0]).toMatchObject({ accountId: account, equity: '123.45', openOrderCount: 2 });
    expect(status.eventsLast24hBySeverity.CRITICAL).toBe(1);
    const events = await service.listEvents(tenant, new ListRiskEventsDto());
    expect(events.items).toHaveLength(1);
    expect(events.items[0]).toMatchObject({ tenantId: tenant, message: 'Tenant event' });
    const otherStatus = await service.status(other);
    expect(otherStatus.latestSnapshotPerAccount).toHaveLength(0);
    expect(otherStatus.staleAccounts).toEqual([otherAccount]);
    expect(otherStatus.engagedSwitchCount).toBe(0);
    expect(otherStatus.triggeredProtectionCount).toBe(0);
    expect((await service.listEvents(other, new ListRiskEventsDto())).items[0].message).toBe('Other tenant event');
    expect(await db.riskEvent.count()).toBe(0);
  });
});
