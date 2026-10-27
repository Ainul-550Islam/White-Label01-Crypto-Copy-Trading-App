/** Opt in only against a disposable, migrated PostgreSQL database. */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PrismaWithdrawalDestinationRepository, WithdrawalDestinationPolicyService } from './withdrawal-destination-policy.service';
import { WithdrawalRequestService } from '../client-lifecycle/withdrawal-request.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { ReserveManagementService } from './reserve-management.service';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL, rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;
(adminUrl && rlsUrl ? describe : describe.skip)('withdrawal safety with forced PostgreSQL RLS', () => {
  const tenant = randomUUID(), otherTenant = randomUUID(), user = randomUUID(), otherUser = randomUUID(), accountId = randomUUID();
  const address = '0x1111111111111111111111111111111111111111';
  const assetId = `ETH-${randomUUID()}`, walletId = randomUUID();
  let admin: PrismaService, db: PrismaService, repo: PrismaWithdrawalDestinationRepository, policy: WithdrawalDestinationPolicyService;
  const tables = ['users','institutional_accounts','account_ownerships','account_restrictions','custody_wallets','custody_reserves','custody_audits','withdrawal_requests','client_lifecycle_audits','outbox_events'];
  const prior = new Map<string, { relrowsecurity: boolean; relforcerowsecurity: boolean }>();
  const client = (url: string) => new PrismaService({ databaseUrl: url, isProduction: false, databaseReadEnabled: false } as never, { warn() {}, debug() {}, error() {}, info() {} } as never);
  beforeAll(async () => {
    admin = client(adminUrl!); db = client(rlsUrl!);
    for (const table of tables) {
      const [state] = await admin.$queryRawUnsafe<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='${table}'`);
      prior.set(table, state);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await admin.$executeRawUnsafe(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    }
    await admin.tenant.createMany({ data: [tenant, otherTenant].map((id) => ({ id, slug: `wd-${id}`, name: 'Withdrawal test' })) });
    await admin.user.createMany({ data: [{ id: user, tenantId: tenant }, { id: otherUser, tenantId: otherTenant }].map((entry) => ({ ...entry, email: `${entry.id}@example.test`, emailIndex: entry.id.replace(/-/g, ''), passwordHash: 'not-a-real-secret', status: 'ACTIVE' })) });
    await admin.institutionalAccount.create({ data: { id: accountId, tenantId: tenant, state: 'ACTIVE', isWithdrawalEnabled: true, complianceStatus: 'CLEAR', riskStatus: 'CLEAR', idempotencyKey: `acct-${accountId}` } });
    await admin.accountOwnership.create({ data: { tenantId: tenant, accountId, ownerId: user, ownerType: 'USER', status: 'ACTIVE', idempotencyKey: `owner-${user}` } });
    await admin.custodyNetwork.create({ data: { networkId: 'ethereum', name: 'Ethereum', nativeAssetId: assetId, nativeAssetSymbol: 'ETH', status: 'ACTIVE' } });
    await admin.custodyAsset.create({ data: { assetId, symbol: 'ETH', name: 'Ether', decimals: 18, networkId: 'ethereum' } });
    await admin.custodyWallet.create({ data: { id: walletId, tenantId: tenant, accountId, scope: 'ACCOUNT', state: 'ACTIVE', isActive: true, assetId, networkId: 'ethereum', idempotencyKey: `wallet-${walletId}` } });
    repo = new PrismaWithdrawalDestinationRepository(db); policy = new WithdrawalDestinationPolicyService(repo);
  });
  afterAll(async () => {
    if (!admin) return;
    await admin.$executeRaw`DELETE FROM outbox_events WHERE tenant_id IN (${tenant}::uuid, ${otherTenant}::uuid)`;
    await admin.$executeRaw`DELETE FROM client_lifecycle_audits WHERE tenant_id IN (${tenant}::uuid, ${otherTenant}::uuid)`;
    await admin.tenant.deleteMany({ where: { id: { in: [tenant, otherTenant] } } });
    await admin.custodyAsset.deleteMany({ where: { assetId } });
    await admin.custodyNetwork.deleteMany({ where: { networkId: 'ethereum' } });
    for (const table of tables) { const state = prior.get(table); if (state && !state.relforcerowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`); if (state && !state.relrowsecurity) await admin.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`); }
    await db.$disconnect(); await admin.$disconnect();
  });
  it('does not revive a revoked destination after a stale due sweep, including across tenants', async () => {
    const row = await repo.create({ tenantId: tenant, userId: user, network: 'ETHEREUM', address, label: 'Vault', activatesAt: new Date(Date.now() - 1000) });
    expect(await repo.findById({ tenantId: otherTenant, userId: otherUser, id: row.id })).toBeNull();
    expect((await policy.revoke({ tenantId: tenant, userId: user, destinationId: row.id, stepUpProven: true })).ok).toBe(true);
    expect(await repo.setStatus({ tenantId: tenant, userId: user, id: row.id, status: 'ACTIVE', revokedAt: null, dueAt: new Date() })).toBeNull();
    expect((await repo.findById({ tenantId: tenant, userId: user, id: row.id }))?.status).toBe('REVOKED');
    expect(await policy.evaluateWithdrawal({ tenantId: tenant, userId: user, network: 'ETHEREUM', address })).toMatchObject({ decision: 'DENY', code: 'DESTINATION_REVOKED' });
  });
  it('atomically reserves fresh provider-derived balance against concurrent requests', async () => {
    const addr = '0x2222222222222222222222222222222222222222';
    const row = await repo.create({ tenantId: tenant, userId: user, network: 'ETHEREUM', address: addr, label: 'Savings', activatesAt: new Date(Date.now() - 1000) });
    await repo.setStatus({ tenantId: tenant, userId: user, id: row.id, status: 'ACTIVE', revokedAt: null, dueAt: new Date() });
    const balance = { getWalletBalance: async () => ({ tenantId: tenant, walletId, assetId, assetSymbol: 'ETH', networkId: 'ethereum', available: '10.0', observationTimestamp: new Date().toISOString(), provider: 'test-transport', sourceReference: 'observation-1', dataCompleteness: 'PROVIDER_DERIVED' }) };
    const reserves = { evaluateReserveSufficiency: async () => ({ sufficient: true, availableAfterReserve: '9.00', dataCompleteness: 'PROVIDER_DERIVED' }) };
    const lifecyclePolicy = { resolvePolicy: async () => ({ fundingControls: { allowedCurrencies: ['ETH'] }, withdrawalRules: { requireComplianceCheck: true, requireRiskCheck: true } }) };
    const service = new WithdrawalRequestService(db, lifecyclePolicy as never, {} as never, {} as never, new OutboxService(), balance as never, reserves as never);
    const input = { tenantId: tenant, accountId, requestedBy: user, stepUpVerified: true, requestedAmount: '6.000000000001', currency: 'ETH', destinationAddress: addr, destinationType: 'ETHEREUM' };
    await expect(service.createWithdrawalRequest({ ...input, stepUpVerified: false, idempotencyKey: 'wd-missing-mfa' })).rejects.toThrow('multi-factor');
    await admin.withdrawalDestination.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    await expect(service.createWithdrawalRequest({ ...input, idempotencyKey: 'wd-revoked-evidence' })).rejects.toThrow('active withdrawal destination');
    await admin.withdrawalDestination.update({ where: { id: row.id }, data: { revokedAt: null } });
    const attempts = await Promise.allSettled([service.createWithdrawalRequest({ ...input, idempotencyKey: 'wd-first-key-123' }), service.createWithdrawalRequest({ ...input, idempotencyKey: 'wd-second-key-123' })]);
    if (attempts.every((a) => a.status === 'rejected')) throw new Error(attempts.map((a) => a.status === 'rejected' ? String(a.reason?.stack ?? a.reason) : '').join('\n---\n'));
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((a) => a.status === 'rejected')).toHaveLength(1);
    const saved = await admin.withdrawalRequest.findMany({ where: { tenantId: tenant, accountId } });
    expect(saved).toHaveLength(1); expect(saved[0].requestedAmount).toBe('6.000000000001'); expect(saved[0].state).toBe('REQUESTED');
    expect(await admin.outboxEvent.count({ where: { tenantId: tenant, eventType: 'withdrawal.requested' } })).toBe(1);
    const retried = await service.createWithdrawalRequest({ ...input, idempotencyKey: saved[0].idempotencyKey });
    expect(retried.id).toBe(saved[0].id);
    await expect(service.createWithdrawalRequest({ ...input, requestedAmount: '1', idempotencyKey: saved[0].idempotencyKey })).rejects.toThrow('Request key already used');
  });
  it('reserves confirmed and larger submitted amounts until the observation includes them', async () => {
    const prior = await admin.withdrawalRequest.findFirstOrThrow({ where: { tenantId: tenant, accountId } });
    const observation = new Date(Date.now() - 30_000);
    const balance = { getWalletBalance: async () => ({ walletId, assetId, assetSymbol: 'ETH', networkId: 'ethereum', available: '10', observationTimestamp: observation.toISOString(), provider: 'test-transport', sourceReference: 'observation-2', dataCompleteness: 'PROVIDER_DERIVED' }) };
    const reserves = { evaluateReserveSufficiency: async (_params: unknown, supplied: unknown) => {
      expect(supplied).toMatchObject({ walletId, observationTimestamp: observation.toISOString(), available: '10' });
      return { sufficient: true, availableAfterReserve: '9', dataCompleteness: 'PROVIDER_DERIVED' };
    } };
    const lifecyclePolicy = { resolvePolicy: async () => ({ fundingControls: { allowedCurrencies: ['ETH'] }, withdrawalRules: { requireComplianceCheck: true, requireRiskCheck: true } }) };
    const service = new WithdrawalRequestService(db, lifecyclePolicy as never, {} as never, {} as never, new OutboxService(), balance as never, reserves as never);
    const input = { tenantId: tenant, accountId, requestedBy: user, stepUpVerified: true, requestedAmount: '2.1', currency: 'ETH', destinationAddress: '0x2222222222222222222222222222222222222222', destinationType: 'ETHEREUM', idempotencyKey: 'wd-stale-observation-1' };
    await admin.withdrawalRequest.update({ where: { id: prior.id }, data: { state: 'CONFIRMED', confirmedAt: new Date(), confirmedAmount: '7' } });
    await expect(service.createWithdrawalRequest(input)).rejects.toThrow('insufficient');
    await admin.withdrawalRequest.update({ where: { id: prior.id }, data: { confirmedAt: null, confirmedAmount: null } });
    await expect(service.createWithdrawalRequest(input)).rejects.toThrow('Confirmed balance evidence');
    await admin.withdrawalRequest.update({ where: { id: prior.id }, data: { state: 'SUBMITTED', submittedAmount: '7', confirmedAmount: null } });
    await expect(service.createWithdrawalRequest(input)).rejects.toThrow('insufficient');
    await admin.withdrawalRequest.update({ where: { id: prior.id }, data: { state: 'CONFIRMED', confirmedAt: new Date(observation.getTime() - 1000), confirmedAmount: '7', submittedAmount: '7' } });
    await expect(service.createWithdrawalRequest(input)).resolves.toMatchObject({ state: 'REQUESTED', requestedAmount: '2.1' });
  });
  it('creates tenant-scoped reserves and audit atomically and reuses the supplied balance', async () => {
    const observed = { walletId, assetId, assetSymbol: 'ETH', networkId: 'ethereum', available: '10', observationTimestamp: new Date().toISOString(), provider: 'test-transport', sourceReference: 'observation-3', dataCompleteness: 'PROVIDER_DERIVED' };
    const getWalletBalance = jest.fn().mockRejectedValue(new Error('should reuse supplied evidence'));
    const policy = { resolvePolicy: async () => ({ reserveRequirements: { operationalReserveBps: 1000, withdrawalReserveBps: null, gasReserveAmount: null } }) };
    const reserves = new ReserveManagementService(db, policy as never, { getWalletBalance } as never);
    const created = await reserves.createReserve({ tenantId: tenant, walletId, assetId, networkId: 'ethereum', reserveType: 'operational', requiredAmount: '2', operatorId: user });
    expect(created.availableAmount).toBeNull();
    expect((await reserves.listReserves({ tenantId: tenant })).data.map((row) => row.id)).toContain(created.id);
    expect((await reserves.listReserves({ tenantId: otherTenant })).data).toEqual([]);
    expect(await admin.custodyAudit.count({ where: { tenantId: tenant, entityId: created.id, action: 'RESERVE_UPDATED' } })).toBe(1);
    expect(await reserves.evaluateReserveSufficiency({ tenantId: tenant, walletId, assetId, networkId: 'ethereum', requestedAmount: '7' }, observed)).toMatchObject({ sufficient: true, requiredReserve: '3', availableAfterReserve: '7', dataCompleteness: 'PROVIDER_DERIVED' });
    expect(getWalletBalance).not.toHaveBeenCalled();
    expect(await reserves.evaluateReserveSufficiency({ tenantId: tenant, walletId, assetId, networkId: 'ethereum', requestedAmount: '1' }, { ...observed, observationTimestamp: new Date(Date.now() - 120_000).toISOString() })).toMatchObject({ sufficient: false, dataCompleteness: 'UNKNOWN' });
  });
});
