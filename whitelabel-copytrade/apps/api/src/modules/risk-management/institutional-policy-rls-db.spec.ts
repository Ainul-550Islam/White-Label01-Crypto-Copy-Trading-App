// # Responsibility: proves that forced RLS cannot erase or cross-wire institutional tenant rules.
import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { InstitutionalRiskPolicyService } from './risk-policy.service';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL, rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;
(adminUrl && rlsUrl ? describe : describe.skip)('institutional risk policy resolution with forced RLS', () => {
  const tenants = [randomUUID(), randomUUID()], users = [randomUUID(), randomUUID()];
  const strategy = randomUUID(), ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const client = (url: string) => new PrismaService({ databaseUrl: url, isProduction: false, databaseReadEnabled: false } as never,
    { warn() {}, debug() {}, error() {}, info() {} } as never);
  let admin: PrismaService, scoped: PrismaService, wasEnabled: boolean, wasForced: boolean, auditEnabled: boolean, auditForced: boolean;
  beforeAll(async () => {
    admin = client(adminUrl!); scoped = client(rlsUrl!);
    const [state] = await admin.$queryRaw<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='institutional_risk_policies'`;
    wasEnabled = state.relrowsecurity; wasForced = state.relforcerowsecurity;
    const [audit] = await admin.$queryRaw<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='audit_logs'`;
    auditEnabled = audit.relrowsecurity; auditForced = audit.relforcerowsecurity;
    await admin.$executeRawUnsafe('ALTER TABLE institutional_risk_policies ENABLE ROW LEVEL SECURITY');
    await admin.$executeRawUnsafe('ALTER TABLE institutional_risk_policies FORCE ROW LEVEL SECURITY');
    await admin.$executeRawUnsafe('ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY');
    await admin.$executeRawUnsafe('ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY');
    await admin.tenant.createMany({ data: tenants.map((id) => ({ id, slug: `risk-policy-${id}`, name: 'Risk policy test' })) });
    await admin.user.createMany({ data: users.map((id, i) => ({ id, tenantId: tenants[i], email: `${id}@example.test`,
      emailIndex: id.replace(/-/g, ''), passwordHash: 'not-a-real-secret', status: 'ACTIVE' as const })) });
    await admin.strategy.create({ data: { id: strategy, tenantId: tenants[0], name: `policy-${strategy}`, kind: 'test', version: '1',
      venue: 'PAPER', symbols: ['BTCUSDT'], maxOrderQuantity: '1', maxPositionQuantity: '1', maxOrderNotional: '1', maxDailyLoss: '1' } });
    const row = (id: string, tenantId: string | null, scope: 'PLATFORM' | 'TENANT' | 'STRATEGY', scopeId: string | null, maxGrossExposure: string) => ({
      id, tenantId, scope, scopeId, version: 999999, digest: id.replace(/-/g, ''), policyJson: { maxGrossExposure },
      changeReason: 'Test policy scope', changedByUserId: users[0], isActive: true,
    });
    await admin.institutionalRiskPolicy.createMany({ data: [
      row(ids[0], null, 'PLATFORM', null, '500'),
      row(ids[1], tenants[0], 'TENANT', tenants[0], '100'),
      row(ids[2], tenants[1], 'TENANT', tenants[1], '50'),
      row(ids[3], tenants[0], 'STRATEGY', strategy, '80'),
      row(ids[4], tenants[1], 'STRATEGY', strategy, '1'),
    ] });
  });
  afterAll(async () => {
    if (!admin) return;
    await admin.auditLog.deleteMany({ where: { tenantId: { in: tenants }, action: 'RISK_POLICY_UPSERT' } });
    await admin.$executeRaw`DELETE FROM institutional_risk_policy_update_intents WHERE tenant_id IN (${tenants[0]}::uuid, ${tenants[1]}::uuid)`;
    await admin.institutionalRiskPolicy.deleteMany({ where: { OR: [{ id: { in: ids } }, { tenantId: { in: tenants } }] } });
    await admin.tenant.deleteMany({ where: { id: { in: tenants } } });
    if (!wasForced) await admin.$executeRawUnsafe('ALTER TABLE institutional_risk_policies NO FORCE ROW LEVEL SECURITY');
    if (!wasEnabled) await admin.$executeRawUnsafe('ALTER TABLE institutional_risk_policies DISABLE ROW LEVEL SECURITY');
    if (!auditForced) await admin.$executeRawUnsafe('ALTER TABLE audit_logs NO FORCE ROW LEVEL SECURITY');
    if (!auditEnabled) await admin.$executeRawUnsafe('ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY');
    await scoped.$disconnect(); await admin.$disconnect();
  });
  it('resolves the platform, correct tenant and matching strategy without importing the other tenant', async () => {
    const result = await new InstitutionalRiskPolicyService(scoped).resolveEffectivePolicy({ tenantId: tenants[0], strategyId: strategy });
    expect(result.thresholds.maxGrossExposure).toBe('80');
    expect(result.sourcePolicies.map((p) => p.thresholds.maxGrossExposure)).toEqual(['500', '100', '80']);
    const other = await new InstitutionalRiskPolicyService(scoped).resolveEffectivePolicy({ tenantId: tenants[1], strategyId: strategy });
    expect(other.thresholds.maxGrossExposure).toBe('1');
    const unscoped = await scoped.institutionalRiskPolicy.findMany({ where: { id: { in: ids } } });
    expect(unscoped.map((p) => p.id)).toEqual([ids[0]]);
  });
  it('lists only tenant-bound history and still exposes platform history under forced RLS', async () => {
    const service = new InstitutionalRiskPolicyService(scoped);
    const tenantHistory = await service.getPolicyHistory({ scope: 'STRATEGY' as never, tenantId: tenants[0], scopeId: strategy });
    expect(tenantHistory.map((p) => p.id)).toEqual([ids[3]]);
    const platformHistory = await service.getPolicyHistory({ scope: 'PLATFORM' as never, tenantId: tenants[0] });
    expect(platformHistory.map((p) => p.id)).toContain(ids[0]);
    await expect(service.getPolicyHistory({ scope: 'STRATEGY' as never, scopeId: strategy })).rejects.toThrow('Tenant context is required');
    const bypass = await new InstitutionalRiskPolicyService(admin).getPolicyHistory({ scope: 'STRATEGY' as never, tenantId: tenants[0], scopeId: strategy });
    expect(bypass.map((p) => p.id)).toEqual([ids[3]]);
  });
  it('keeps tenant isolation in the query even with a database role that bypasses RLS', async () => {
    const result = await new InstitutionalRiskPolicyService(admin).resolveEffectivePolicy({ tenantId: tenants[0], strategyId: strategy });
    expect(result.thresholds.maxGrossExposure).toBe('80');
    expect(result.sourcePolicies.map((p) => p.thresholds.maxGrossExposure)).toEqual(['500', '100', '80']);
  });
  it('serializes policy versions and commits one active tenant revision and its audit atomically', async () => {
    const service = new InstitutionalRiskPolicyService(scoped);
    const base = { scope: 'STRATEGY' as never, scopeId: strategy, tenantId: tenants[0], changedByUserId: users[0],
      actorTenantId: tenants[0], expectedVersion: 999999, idempotencyKey: 'policy-test-first',
      changeReason: 'Test transactional risk policy' };
    const first = { ...base, thresholds: { maxGrossExposure: '70' } };
    const results = await Promise.all([service.upsertPolicy(first), service.upsertPolicy(first)]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0].version).toBe(1000000);
    await expect(service.upsertPolicy({ ...first, thresholds: { maxGrossExposure: '60' } })).rejects.toThrow('different policy update');
    await expect(service.upsertPolicy({ ...first, idempotencyKey: 'policy-test-stale' })).rejects.toThrow('Policy changed');
    const contenders = await Promise.allSettled([
      service.upsertPolicy({ ...first, expectedVersion: 1000000, idempotencyKey: 'policy-test-second', thresholds: { maxGrossExposure: '60' } }),
      service.upsertPolicy({ ...first, expectedVersion: 1000000, idempotencyKey: 'policy-test-third', thresholds: { maxGrossExposure: '55' } }),
    ]);
    const successful = contenders.filter((r): r is PromiseFulfilledResult<{ id: string; version: number; digest: string }> => r.status === 'fulfilled');
    const rejected = contenders.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(successful).toHaveLength(1);
    expect(successful[0].value.version).toBe(1000001);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toContain('Policy changed');
    expect(await service.upsertPolicy(first)).toEqual(results[0]);
    const rows = await admin.institutionalRiskPolicy.findMany({ where: { tenantId: tenants[0], scope: 'STRATEGY', scopeId: strategy } });
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.isActive)).toHaveLength(1);
    expect(await admin.auditLog.count({ where: { tenantId: tenants[0], action: 'RISK_POLICY_UPSERT' } })).toBe(2);
    expect((await admin.institutionalRiskPolicy.findUniqueOrThrow({ where: { id: ids[4] } })).isActive).toBe(true);
    await admin.$executeRawUnsafe('REVOKE INSERT ON audit_logs FROM batch02_rls');
    try {
      await expect(service.upsertPolicy({ ...base, expectedVersion: 1000001, idempotencyKey: 'policy-test-audit-fail',
        thresholds: { maxGrossExposure: '50' } })).rejects.toThrow();
      expect(await admin.institutionalRiskPolicy.count({ where: { tenantId: tenants[0], scope: 'STRATEGY', scopeId: strategy } })).toBe(3);
      expect((await admin.institutionalRiskPolicy.findFirstOrThrow({ where: { tenantId: tenants[0], scope: 'STRATEGY', scopeId: strategy, isActive: true } })).version).toBe(1000001);
    } finally { await admin.$executeRawUnsafe('GRANT INSERT ON audit_logs TO batch02_rls'); }
  });
  it.each([
    { maxGrossExposure: 10 },
    { maxGrossExposure: '-1' },
    { circuitBreakerEnabled: 'false' },
    { unsupportedRiskField: '1' },
  ])('rejects malformed or unsupported policy fields: %p', async (thresholds) => {
    const service = new InstitutionalRiskPolicyService(scoped);
    await expect(service.upsertPolicy({ scope: 'STRATEGY' as never, scopeId: strategy, tenantId: tenants[0],
      actorTenantId: tenants[0], changedByUserId: users[0], expectedVersion: 999999, idempotencyKey: 'policy-invalid-test',
      changeReason: 'Test invalid policy fields', thresholds: thresholds as never })).rejects.toThrow();
  });
  it.each([
    { maxGrossExposure: '101' },
    { circuitBreakerEnabled: false },
    { liquidationWarningDistance: '9' },
    { marketDataMaxAgeMs: 30001 },
  ])('rejects a first or later policy that weakens inherited protection: %p', async (thresholds) => {
    const service = new InstitutionalRiskPolicyService(scoped);
    await expect(service.upsertPolicy({ scope: 'STRATEGY' as never, scopeId: strategy, tenantId: tenants[0],
      actorTenantId: tenants[0], changedByUserId: users[0], expectedVersion: 999999, idempotencyKey: 'policy-weak-test',
      changeReason: 'Test inherited policy protections', thresholds })).rejects.toThrow('weaken');
  });
  it('enforces a unique global revision, one active revision and valid scope binding at the database', async () => {
    const global = { tenantId: null, scope: 'PLATFORM' as const, scopeId: null, digest: 'synthetic', policyJson: {},
      changeReason: 'Test database policy uniqueness', changedByUserId: users[0] };
    await expect(admin.institutionalRiskPolicy.create({ data: { ...global, version: 999999, isActive: false } })).rejects.toThrow();
    await expect(admin.institutionalRiskPolicy.create({ data: { ...global, version: 1000000, isActive: true } })).rejects.toThrow();
    await expect(admin.institutionalRiskPolicy.create({ data: { ...global, tenantId: tenants[0], scope: 'TENANT', scopeId: tenants[1],
      version: 1, isActive: true } })).rejects.toThrow();
  });
  it('does not permit a tenant database role to create a foreign or platform policy', async () => {
    const service = new InstitutionalRiskPolicyService(scoped);
    await expect(service.upsertPolicy({ scope: 'PLATFORM' as never, tenantId: null, scopeId: null, changedByUserId: users[0],
      actorTenantId: tenants[0], expectedVersion: 999999, idempotencyKey: 'policy-global-test',
      changeReason: 'Test global policy permission', thresholds: { maxGrossExposure: '20' } })).rejects.toThrow();
    await expect(service.upsertPolicy({ scope: 'STRATEGY' as never, tenantId: tenants[1], scopeId: strategy,
      actorTenantId: tenants[1], changedByUserId: users[1], expectedVersion: 999999, idempotencyKey: 'policy-foreign-entity',
      changeReason: 'Reject foreign scope ownership', thresholds: { maxGrossExposure: '40' } })).rejects.toThrow('not found in the target tenant');
    await expect(service.upsertPolicy({ scope: 'FOLLOWER' as never, tenantId: tenants[0], scopeId: users[1],
      actorTenantId: tenants[0], changedByUserId: users[0], expectedVersion: null, idempotencyKey: 'policy-foreign-follower',
      changeReason: 'Reject foreign follower scope', thresholds: { maxGrossExposure: '40' } })).rejects.toThrow('not found in the target tenant');
    await expect(scoped.withTenantRls(tenants[0], (tx) => tx.institutionalRiskPolicy.create({ data: {
      tenantId: tenants[1], scope: 'TENANT', scopeId: tenants[1], version: 1234, digest: 'synthetic', policyJson: {},
      changeReason: 'Cross tenant test', changedByUserId: users[0], isActive: true,
    } }))).rejects.toThrow();
  });
});
