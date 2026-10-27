/** Opt-in: run against a disposable database with the Batch 02 migration. */
import 'reflect-metadata';
import { randomUUID, createHash } from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { FeatureFlagsService } from './feature-flags.service';
import { createDeveloperPolicyData } from '../developer-platform/developer-policy-data';
import { DeveloperPolicyService } from '../developer-platform/developer-policy.service';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL;
const rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;
(adminUrl && rlsUrl ? describe : describe.skip)('feature-flag mutation idempotency on PostgreSQL', () => {
  const tenantA = randomUUID(), tenantB = randomUUID(), actorId = randomUUID();
  const flagKey = `batch02_${randomUUID().replace(/-/g, '')}`;
  let admin: PrismaService, db: PrismaService, service: FeatureFlagsService;
  const cache = { delete: jest.fn().mockResolvedValue(undefined), deleteByPattern: jest.fn().mockResolvedValue(undefined) };
  const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
  const tables = ['tenant_subscriptions', 'tenant_feature_flags'];
  const prior = new Map<string, { relrowsecurity: boolean; relforcerowsecurity: boolean }>();
  const context = { actorId, ipHash: 'test-hash', requestId: 'test-request' };
  function client(databaseUrl: string) {
    return new PrismaService({ databaseUrl, isProduction: false, databaseReadEnabled: false } as never, logger as never);
  }
  beforeAll(async () => {
    if (!adminUrl || !rlsUrl) throw new Error('both database URLs are required');
    admin = client(adminUrl); db = client(rlsUrl);
    await admin.$executeRaw`INSERT INTO tenants (id, slug, name, updated_at) VALUES (${tenantA}::uuid, ${`flag-${tenantA}`}, 'Flag A', now()), (${tenantB}::uuid, ${`flag-${tenantB}`}, 'Flag B', now())`;
    await admin.featureFlag.create({ data: { key: flagKey, name: 'Flag test' } });
    const plan = await admin.subscriptionPlan.create({ data: {
      code: flagKey, name: 'Flag test plan', price: '0', features: [flagKey],
      limits: { developer_applications: 3, developer_webhook_subscriptions: 4, [`tenant_flag_grant_${flagKey}`]: true },
    } });
    await admin.tenantSubscription.createMany({ data: [tenantA, tenantB].map((tenantId) => ({
      tenantId, planId: plan.id, status: 'ACTIVE', currentPeriodEnd: new Date('2099-01-01'),
    })) });
    // These tables are forced in deployed RLS configurations; exercise the
    // same non-bypass role and restore the disposable DB flags in afterAll.
    for (const table of tables) {
      const [flags] = await admin.$queryRawUnsafe<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = '${table}'`);
      prior.set(table, flags);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    }
    service = new FeatureFlagsService(db, { ...cache, remember: async (_k: string, _t: number, f: () => Promise<unknown>) => f() } as never, logger as never);
  });
  afterAll(async () => {
    if (admin) {
      for (const table of tables) {
        const flags = prior.get(table);
        if (flags && !flags.relforcerowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`);
        if (flags && !flags.relrowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
      }
      await admin.$executeRaw`DELETE FROM audit_logs WHERE tenant_id IN (${tenantA}::uuid, ${tenantB}::uuid)`;
      await admin.$executeRaw`DELETE FROM tenants WHERE id IN (${tenantA}::uuid, ${tenantB}::uuid)`;
      await admin.featureFlag.deleteMany({ where: { key: flagKey } });
      await admin.subscriptionPlan.deleteMany({ where: { code: flagKey } });
      await admin.$disconnect();
    }
    await db?.$disconnect();
  });
  it('commits one tenant-scoped intent, override and audit for concurrent retries', async () => {
    const dto = { key: flagKey, enabled: true, metadata: { reason: 'approved' } };
    const outcomes = await Promise.allSettled([
      service.setForTenant(tenantA, dto, context, 'flag-request-key-1'),
      service.setForTenant(tenantA, dto, context, 'flag-request-key-1'),
    ]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await admin.tenantFeatureFlag.count({ where: { tenantId: tenantA, featureFlag: { key: flagKey } } })).toBe(1);
    expect(await admin.auditLog.count({ where: { tenantId: tenantA, action: 'FEATURE_FLAG_UPDATED' } })).toBe(1);
    expect(cache.delete).toHaveBeenCalledTimes(1);
    // The same caller-chosen key is independent for a different tenant.
    await service.setForTenant(tenantB, dto, context, 'flag-request-key-1');
    expect(await admin.tenantFeatureFlag.count({ where: { tenantId: tenantB, featureFlag: { key: flagKey } } })).toBe(1);
  });
  it('resolves subscribed-plan policy and flag reads under forced tenant RLS', async () => {
    const policy = createDeveloperPolicyData(db);
    expect((await policy.planLimitViewForTenant(tenantA)).limits).toMatchObject({ developer_applications: 3, developer_webhook_subscriptions: 4 });
    expect((await policy.planLimitViewForTenant(tenantA)).features).toContain(flagKey);
    expect(await policy.tenantEntitlementKeys(tenantA)).toContain(flagKey);
    expect((await service.listForTenant(tenantA)).map((row) => row.key)).toContain(flagKey);
    expect((await service.getAllForTenant(tenantA))[flagKey]).toBe(true);
    expect(await service.isEnabled(tenantA, flagKey)).toBe(true);
    const absentTenant = randomUUID();
    expect(await policy.planLimitViewForTenant(absentTenant)).toEqual({ planKey: 'none', limits: {}, features: [] });
    expect(await service.listForTenant(absentTenant)).toEqual([]);
  });
  it('rolls back the intent and override if the mandatory audit insert fails', async () => {
    const key = 'flag-request-key-rollback';
    await expect(service.setForTenant(tenantA, { key: flagKey, enabled: false }, { ...context, actorId: 'not-a-uuid' }, key)).rejects.toThrow();
    const hash = createHash('sha256').update(key).digest('hex');
    const intents = await admin.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM developer_mutation_intents WHERE tenant_id=${tenantA}::uuid AND key_hash=${hash}`;
    expect(intents[0].count).toBe(0n);
    expect((await admin.tenantFeatureFlag.findFirstOrThrow({ where: { tenantId: tenantA, featureFlag: { key: flagKey } } })).enabled).toBe(true);
    // The exact same key is usable after a rollback.
    await expect(service.setForTenant(tenantA, { key: flagKey, enabled: false }, context, key)).resolves.toMatchObject({ enabled: false });
  });
  it('requires one intent and commits one audit for concurrent global definition writes', async () => {
    const before = await admin.auditLog.count({ where: { tenantId: tenantA, resourceType: 'FeatureFlag' } });
    const definition = { key: flagKey, name: 'Updated flag', isGlobalDefault: false };
    const globalContext = { ...context, tenantId: tenantA };
    const result = await Promise.allSettled([
      service.upsertDefinition(definition, globalContext, 'definition-intent-key'),
      service.upsertDefinition(definition, globalContext, 'definition-intent-key'),
    ]);
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter((item) => item.status === 'rejected')).toHaveLength(1);
    expect((await admin.featureFlag.findUniqueOrThrow({ where: { key: flagKey } })).name).toBe('Updated flag');
    expect(await admin.auditLog.count({ where: { tenantId: tenantA, resourceType: 'FeatureFlag' } })).toBe(before + 1);
    expect(cache.deleteByPattern).toHaveBeenCalledWith('tenant:*:feature-flags');
  });
  it('refuses enabling a feature not granted by the subscribed plan', async () => {
    const plan = await admin.subscriptionPlan.findFirstOrThrow({ where: { code: flagKey } });
    // Marketing text alone is not an entitlement; remove the explicit boolean grant.
    const original = { features: plan.features, limits: plan.limits };
    await admin.subscriptionPlan.update({ where: { id: plan.id }, data: { features: [flagKey], limits: {} } });
    try {
      const before = await admin.auditLog.count({ where: { tenantId: tenantA, action: 'FEATURE_FLAG_UPDATED' } });
      await expect(service.setForTenant(tenantA, { key: flagKey, enabled: true }, context, 'flag-missing-plan-feature')).rejects.toMatchObject({ status: 403 });
      expect(await admin.auditLog.count({ where: { tenantId: tenantA, action: 'FEATURE_FLAG_UPDATED' } })).toBe(before);
    } finally {
      await admin.subscriptionPlan.update({ where: { id: plan.id }, data: original as never });
    }
  });
  it('honours explicit boolean plan grants without treating marketing copy or strings as grants', async () => {
    const plan = await admin.subscriptionPlan.findFirstOrThrow({ where: { code: flagKey } });
    const original = { features: plan.features, limits: plan.limits };
    try {
      await admin.subscriptionPlan.update({ where: { id: plan.id }, data: {
        features: [], limits: { [`tenant_flag_grant_${flagKey}`]: true,
          developer_feature_portfolio_read: true, developer_feature_trading: false,
          developer_feature_funding: 'true', developer_applications: 2 },
      } });
      await expect(service.setForTenant(tenantA, { key: flagKey, enabled: true }, context, 'flag-boolean-plan-grant')).resolves.toMatchObject({ enabled: true });
      const view = await createDeveloperPolicyData(db).planLimitViewForTenant(tenantA);
      expect(view.limits.developer_applications).toBe(2);
      expect(view.features).toContain('developer_portfolio_read');
      expect(view.features).not.toContain('developer_trading');
      expect(view.features).not.toContain('developer_funding');
      const resolved = new DeveloperPolicyService().resolve(tenantA, view, []);
      expect(resolved.maxApplications).toBe(2);
      expect(resolved.allowedScopes).toEqual(expect.arrayContaining(['profile:read', 'account:read', 'portfolio:read']));
      expect(resolved.allowedScopes).not.toContain('trading:execute');
      expect(resolved.allowedScopes).not.toContain('funding:request');
      const staleOverride = new DeveloperPolicyService().resolve(tenantA, view, ['developer_trading', 'developer_funding']);
      expect(staleOverride.allowedScopes).not.toContain('trading:execute');
      expect(staleOverride.allowedScopes).not.toContain('funding:request');
      expect(staleOverride.maxRedirectUris).toBe(0);
      expect(staleOverride.maxWebhookEndpointsPerApplication).toBe(0);
      expect(staleOverride.oauth.pkceRequired).toBe(true);
      await admin.subscriptionPlan.update({ where: { id: plan.id }, data: { limits: { [`tenant_flag_grant_${flagKey}`]: 'true' } } });
      await expect(service.setForTenant(tenantA, { key: flagKey, enabled: true }, context, 'flag-string-plan-denied')).rejects.toMatchObject({ status: 403 });
    } finally {
      await admin.subscriptionPlan.update({ where: { id: plan.id }, data: original as never });
    }
  });
  it('reports the committed result even if cache eviction is temporarily unavailable', async () => {
    cache.delete.mockRejectedValueOnce(new Error('cache unavailable'));
    await expect(service.setForTenant(tenantA, { key: flagKey, enabled: true }, context, 'flag-request-key-cache')).resolves.toMatchObject({ enabled: true });
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'feature_flag.cache_invalidation_failed' }), expect.any(String));
  });
});
