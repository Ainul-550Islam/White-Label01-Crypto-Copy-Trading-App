import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RiskDecisionService } from './risk-decision.service';
import { RiskState } from './risk-management.types';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL;
const rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;
(adminUrl && rlsUrl ? describe : describe.skip)('unified risk checks with forced tenant RLS', () => {
  const tenants = [randomUUID(), randomUUID()], users = [randomUUID(), randomUUID()];
  const tables = ['compliance_screening_requests', 'security_threat_signals', 'risk_decision_records'];
  const prior = new Map<string, { relrowsecurity: boolean; relforcerowsecurity: boolean }>();
  const client = (url: string) => new PrismaService({ databaseUrl: url, isProduction: false, databaseReadEnabled: false } as never,
    { warn() {}, debug() {}, error() {}, info() {} } as never);
  let admin: PrismaService, db: PrismaService, service: RiskDecisionService;
  beforeAll(async () => {
    admin = client(adminUrl!); db = client(rlsUrl!);
    for (const table of tables) {
      const [state] = await admin.$queryRawUnsafe<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='${table}'`);
      prior.set(table, state);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    }
    await admin.tenant.createMany({ data: tenants.map((id) => ({ id, slug: `risk-rls-${id}`, name: 'Risk test' })) });
    await admin.user.createMany({ data: users.map((id, i) => ({ id, tenantId: tenants[i], email: `${id}@example.test`,
      emailIndex: id.replace(/-/g, ''), passwordHash: 'not-a-real-secret', status: 'ACTIVE' as const })) });
    await admin.complianceScreeningRequest.create({ data: { tenantId: tenants[0], userId: users[0], type: 'AML',
      status: 'COMPLETED', decision: 'BLOCK', idempotencyKey: randomUUID() } });
    await admin.securityThreatSignal.create({ data: { tenantId: tenants[1], userId: users[1], ruleId: 'TEST',
      riskLevel: 'HIGH', decision: 'DENY', safeSummary: 'Risk evidence' } });
    const empty = async () => [];
    const policy = { effectiveVersion: 'v1', scopeChain: [], thresholds: {
      maxGrossExposure: null, maxSymbolExposure: null, maxPositionNotional: null, maxDailyLoss: null,
      maxDrawdownPercent: null, maxIntradayDrawdownPercent: null, marketDataMaxAgeMs: 60000,
      exchangeHealthMaxAgeMs: 60000, liquidationCriticalDistance: '5', liquidationWarningDistance: '10',
      marginCriticalUtilization: null,
    } };
    service = new RiskDecisionService(db, { resolveEffectivePolicy: async () => policy } as never,
      { calculateExposure: async () => ({ state: RiskState.NORMAL, grossExposure: '0', totalExposure: '0', symbolExposures: [], staleSymbols: [], unknownPrices: [] }) } as never,
      { evaluatePositionRisk: empty } as never, { evaluateMargin: empty } as never,
      { evaluateLeverage: empty } as never, { evaluateLiquidationRisk: empty } as never,
      { evaluateConcentration: empty } as never, { evaluateDrawdown: empty } as never,
      { evaluateDailyLoss: empty } as never, { evaluateCorrelation: empty } as never,
      { evaluateVar: empty } as never, { runStressTests: empty } as never,
      { isBlocked: async () => false } as never, { isEngaged: async () => false } as never,
      {} as never, { emitThresholdBreached: async () => undefined } as never, {} as never);
  });
  afterAll(async () => {
    if (!admin) return;
    await admin.complianceScreeningRequest.deleteMany({ where: { tenantId: { in: tenants } } });
    await admin.securityThreatSignal.deleteMany({ where: { tenantId: { in: tenants } } });
    await admin.riskDecisionRecord.deleteMany({ where: { tenantId: { in: tenants } } });
    await admin.tenant.deleteMany({ where: { id: { in: tenants } } });
    for (const table of tables) {
      const state = prior.get(table);
      if (state && !state.relforcerowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`);
      if (state && !state.relrowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
    }
    await db.$disconnect(); await admin.$disconnect();
  });
  it('blocks the correct tenant screening and persists the returned UUID', async () => {
    expect(await db.complianceScreeningRequest.count()).toBe(0);
    const result = await service.evaluateUnifiedRisk({ tenantId: tenants[0], userId: users[0] });
    expect(result.decision).toBe('BLOCK');
    expect(result.ruleIds).toContain('COMPLIANCE_BLOCK');
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/i);
    const row = await db.withTenantRls(tenants[0], (tx) => tx.riskDecisionRecord.findFirst({ where: { id: result.id } }));
    expect(row).toMatchObject({ id: result.id, tenantId: tenants[0], decision: 'BLOCK' });
    expect(await db.withTenantRls(tenants[1], (tx) => tx.riskDecisionRecord.findFirst({ where: { id: result.id } }))).toBeNull();
  });
  it('reads a high-severity security signal only within its tenant', async () => {
    const result = await service.evaluateUnifiedRisk({ tenantId: tenants[1], userId: users[1] });
    expect(result.decision).toBe('BLOCK');
    expect(result.ruleIds).toContain('SECURITY_BLOCK');
    const crossTenant = await service.evaluateUnifiedRisk({ tenantId: tenants[0], userId: users[1] });
    expect(crossTenant.ruleIds).not.toContain('SECURITY_BLOCK');
    expect(crossTenant.ruleIds).not.toContain('COMPLIANCE_BLOCK');
  });
});
