import { createHash, generateKeyPairSync, randomUUID, verify } from 'node:crypto';
import { Reflector } from '@nestjs/core';
import { Permission, type AuthenticatedActor } from '@wlct/shared-types';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PERMISSIONS_KEY, PERMISSIONS_MODE_KEY } from '../../common/constants/metadata.constants';
import { REQUIRE_STEP_UP_KEY } from '../auth/step-up/require-step-up.decorator';
import { FireblocksVaultClient } from '../custody/fireblocks-vault.client';
import { CustomerDepositAddressController } from './customer-deposit-address.controller';
import { CustomerDepositAddressService, type CustomerDepositProviderFactory } from './customer-deposit-address.service';

const adminUrl = process.env.BATCH02_TEST_DATABASE_URL;
const rlsUrl = process.env.BATCH02_TEST_RLS_DATABASE_URL;
const address = '0x' + 'a'.repeat(40);
const sourceAddress = '0x' + 'b'.repeat(40);
const transferHash = '0x' + 'c'.repeat(64);
const blockHash = '0x' + 'd'.repeat(64);

type FakeVault = { id: string; name: string; customerRefId: string; wallet: boolean; address: string; tag: string | null };

/** An in-process transport fixture; all authorization, signatures and DB work
 * still run through the actual production client and service. */
function providerFixture() {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const vaults: FakeVault[] = [];
  let vaultCreates = 0, assetCreates = 0;
  let createTimeout = false;
  let badAsset = false;
  let afterAddress: (() => Promise<void>) | null = null;
  let waitForCreate: Promise<void> | null = null;
  let transfer: { id: string; vaultId: string; status: string; amount: string } | null = null;
  const calls: string[] = [];
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  const fetcher = async (rawUrl: string, init: RequestInit): Promise<Response> => {
    const url = new URL(rawUrl);
    const path = url.pathname;
    const headers = init.headers as Record<string, string>;
    const [h, p, signature] = headers.Authorization!.slice('Bearer '.length).split('.') as [string, string, string];
    if (!verify('RSA-SHA256', Buffer.from(`${h}.${p}`), keys.publicKey, Buffer.from(signature, 'base64url'))) throw new Error('bad JWT');
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (claims.uri !== `${path}${url.search}` || claims.bodyHash !== createHash('sha256').update((init.body as string | undefined) ?? '').digest('hex')) throw new Error('bad request binding');
    calls.push(`${init.method} ${path}`);
    if (path === '/v1/supported_assets') return json([{ id: 'ETH', type: 'BASE_ASSET', decimals: badAsset ? 17 : 18 }]);
    if (path === '/v1/transactions') {
      if (!transfer || url.searchParams.get('destId') !== transfer.vaultId || url.searchParams.get('txHash')?.toLowerCase() !== transferHash) return json([]);
      return json([{ id: transfer.id, status: transfer.status, assetId: 'ETH', txHash: transferHash,
        destination: { type: 'VAULT_ACCOUNT', id: transfer.vaultId } }]);
    }
    if (transfer && path === `/v1/transactions/${transfer.id}`) {
      const vault = vaults.find((v) => v.id === transfer!.vaultId)!;
      return json({ id: transfer.id, status: transfer.status, operation: 'TRANSFER', assetId: 'ETH',
        destination: { type: 'VAULT_ACCOUNT', id: vault.id }, destinationAddress: vault.address, source: { type: 'UNKNOWN' },
        sourceAddress, customerRefId: vault.customerRefId, txHash: transferHash, amountInfo: { netAmount: transfer.amount },
        numOfConfirmations: 40, blockInfo: { blockHash, blockHeight: '123' } });
    }
    if (transfer && path === `/v1/contract_interactions/base_asset_id/ETH/tx_hash/${transferHash}/receipt`) {
      const vault = vaults.find((v) => v.id === transfer!.vaultId)!;
      return json({ status: 1, transactionHash: transferHash, blockHash, blockNumber: 123, transactionIndex: 2,
        from: sourceAddress, to: vault.address, logs: [] });
    }
    if (path === '/v1/vault/accounts_paged') return json({ accounts: vaults.filter((v) => v.name.startsWith(url.searchParams.get('namePrefix') ?? '')), paging: {} });
    if (path === '/v1/vault/accounts' && init.method === 'POST') {
      vaultCreates++;
      if (waitForCreate) await waitForCreate;
      const body = JSON.parse(init.body as string);
      const vault = { id: String(vaults.length + 1), name: body.name, customerRefId: body.customerRefId, wallet: false, address, tag: null };
      vaults.push(vault);
      if (createTimeout) { createTimeout = false; throw new Error('transport timed out after provider committed'); }
      return json(vault);
    }
    const match = /^\/v1\/vault\/accounts\/(\d+)(?:\/(ETH)(?:\/(addresses_paginated))?)?$/.exec(path);
    if (!match) return json({ message: 'not found' }, 404);
    const vault = vaults.find((v) => v.id === match[1]);
    if (!vault) return json({}, 404);
    if (!match[2]) return json(vault);
    if (match[3]) {
      if (afterAddress) { const callback = afterAddress; afterAddress = null; await callback(); }
      return json({ addresses: [{ assetId: 'ETH', address: vault.address, tag: vault.tag, customerRefId: vault.customerRefId }], paging: {} });
    }
    if (init.method === 'POST') { assetCreates++; vault.wallet = true; return json({ id: 'ETH' }); }
    return vault.wallet ? json({ id: 'ETH', total: '0' }) : json({}, 404);
  };
  const client = new FireblocksVaultClient('test-api-key', pem, 'https://api.fireblocks.io', fetcher);
  return {
    client, vaults, calls,
    get vaultCreates() { return vaultCreates; }, get assetCreates() { return assetCreates; },
    timeoutNextCreate() { createTimeout = true; }, mismatchAsset(value: boolean) { badAsset = value; },
    addTransfer(vaultId: string, status = 'COMPLETED', amount = '1.000000000000000001') {
      transfer = { id: randomUUID(), vaultId, status, amount };
    },
    onAddress(callback: () => Promise<void>) { afterAddress = callback; },
    pauseCreate(promise: Promise<void>) { waitForCreate = promise; },
    resumeCreate() { waitForCreate = null; },
  };
}

(adminUrl && rlsUrl ? describe : describe.skip)('customer deposit issuance with forced PostgreSQL RLS', () => {
  const tenantId = randomUUID(), foreignTenant = randomUUID();
  const alice = randomUUID(), bob = randomUUID(), aliceProfile = randomUUID(), bobProfile = randomUUID();
  const aliceAccount = randomUUID(), bobAccount = randomUUID();
  const assetId = `ETH-${randomUUID()}`, secondAssetId = `ETH-${randomUUID()}`;
  let admin: PrismaService, db: PrismaService;
  let fixture: ReturnType<typeof providerFixture>, service: CustomerDepositAddressService;
  const prisma = (url: string) => new PrismaService({ databaseUrl: url, isProduction: false, databaseReadEnabled: false } as never,
    { warn() {}, debug() {}, error() {}, info() {} } as never);
  async function request(accountId = aliceAccount, profileId = aliceProfile) {
    return admin.fundingRequest.create({ data: { tenantId, accountId, clientProfileId: profileId, state: 'REQUESTED',
      currency: 'ETH', requestedAmount: '1', requestedBy: accountId === aliceAccount ? alice : bob, idempotencyKey: randomUUID() } });
  }
  const input = (fundingRequestId: string, userId = alice, key = `deposit-${fundingRequestId}`) => ({
    tenantId, userId, fundingRequestId, assetId, networkId: 'ethereum', idempotencyKey: key,
  });
  beforeAll(async () => {
    admin = prisma(adminUrl!); db = prisma(rlsUrl!);
    await admin.tenant.createMany({ data: [tenantId, foreignTenant].map((id) => ({ id, slug: `deposit-${id}`, name: 'Deposit test' })) });
    await admin.user.createMany({ data: [alice, bob].map((id) => ({ id, tenantId, email: `${id}@example.test`, emailIndex: id.replace(/-/g, ''), passwordHash: 'not-a-real-secret', status: 'ACTIVE' })) });
    await admin.clientProfile.createMany({ data: [{ id: aliceProfile, user: alice }, { id: bobProfile, user: bob }].map(({ id, user }) => ({
      id, tenantId, status: 'ACTIVE', externalIdentityRef: user, idempotencyKey: `profile-${id}`,
    })) });
    await admin.institutionalAccount.createMany({ data: [{ id: aliceAccount, clientProfileId: aliceProfile }, { id: bobAccount, clientProfileId: bobProfile }].map((row) => ({
      ...row, tenantId, state: 'ACTIVE', isFundingEnabled: true, idempotencyKey: `account-${row.id}`,
    })) });
    await admin.custodyNetwork.create({ data: { networkId: 'ethereum', chainId: '1', name: 'Ethereum', nativeAssetSymbol: 'ETH',
      status: 'ACTIVE', metadata: { fireblocksNativeAssetId: 'ETH' } } });
    await admin.custodyAsset.createMany({ data: [assetId, secondAssetId].map((id) => ({ assetId: id, symbol: 'ETH', name: 'Ether',
      decimals: 18, isNative: true, isActive: true, chainId: '1', networkId: 'ethereum', metadata: { fireblocksAssetId: 'ETH' } })) });
  });
  beforeEach(() => {
    fixture = providerFixture();
    service = new CustomerDepositAddressService(db, { create: () => fixture.client } as CustomerDepositProviderFactory);
  });
  afterAll(async () => {
    if (!admin) return;
    await admin.$executeRaw`DELETE FROM "customer_deposit_address_request_keys" WHERE "tenant_id"=${tenantId}::uuid`;
    await admin.$executeRaw`DELETE FROM "customer_deposit_address_issuances" WHERE "tenant_id"=${tenantId}::uuid`;
    await admin.tenant.deleteMany({ where: { id: { in: [tenantId, foreignTenant] } } });
    await admin.custodyAsset.deleteMany({ where: { assetId: { in: [assetId, secondAssetId] } } });
    await admin.custodyNetwork.deleteMany({ where: { networkId: 'ethereum' } });
    await db.$disconnect(); await admin.$disconnect();
  });

  it('issues one provider-verified address, replays both keys, audits once, and does not claim settlement', async () => {
    const funding = await request();
    await expect(service.listAssets({ tenantId, userId: bob, fundingRequestId: funding.id })).rejects.toThrow('Funding request not found');
    const choices = await service.listAssets({ tenantId, userId: alice, fundingRequestId: funding.id });
    expect(choices).toEqual(expect.arrayContaining([expect.objectContaining({ assetId, networkId: 'ethereum', currency: 'ETH', contractAddress: null })]));
    const first = await service.issue(input(funding.id));
    expect(first).toMatchObject({ fundingRequestId: funding.id, accountId: aliceAccount, assetId, networkId: 'ethereum',
      currency: 'ETH', address, status: 'ADDRESS_VERIFIED', settlementStatus: 'NOT_CONFIRMED', monitoringStatus: 'NOT_CONNECTED' });
    expect(fixture.vaultCreates).toBe(1); expect(fixture.assetCreates).toBe(1);
    expect((await service.issue(input(funding.id))).address).toBe(address);
    expect((await service.issue(input(funding.id, alice, 'new-key-456'))).address).toBe(address);
    expect((await service.get(input(funding.id))).address).toBe(address);
    expect(fixture.vaultCreates).toBe(1); expect(fixture.assetCreates).toBe(1);
    expect(await admin.clientLifecycleAudit.count({ where: { tenantId, accountId: aliceAccount, action: 'DEPOSIT_ADDRESS_VERIFIED',
      evidence: { path: ['fundingRequestId'], equals: funding.id } } })).toBe(1);
    expect((await admin.fundingRequest.findUniqueOrThrow({ where: { id: funding.id } })).state).toBe('REQUESTED');
    expect(await admin.custodyDeposit.count({ where: { tenantId } })).toBe(0);
    const hidden = await db.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM "customer_deposit_address_issuances"`;
    expect(hidden[0]?.n).toBe(0n);
  });

  it('refuses another user, another tenant, a restricted account and conflicting idempotency reuse', async () => {
    const funding = await request();
    await expect(service.issue(input(funding.id, bob))).rejects.toThrow('Funding request not found');
    await expect(service.issue({ ...input(funding.id), tenantId: foreignTenant })).rejects.toThrow('Funding request not found');
    const restriction = await admin.accountRestriction.create({ data: { tenantId, accountId: aliceAccount, restrictionType: 'NO_DEPOSIT',
      status: 'ACTIVE', source: 'test', reason: 'Restricted', idempotencyKey: randomUUID() } });
    await expect(service.issue(input(funding.id))).rejects.toThrow('Deposits are restricted');
    await admin.accountRestriction.update({ where: { id: restriction.id }, data: { status: 'REVOKED' } });
    await service.issue(input(funding.id));
    await expect(service.issue({ ...input(funding.id), assetId: secondAssetId })).rejects.toThrow('Request key was used for a different deposit address');
  });

  it('derives ownership from the account when an older request has no profile', async () => {
    const funding = await request();
    await admin.fundingRequest.update({ where: { id: funding.id }, data: { clientProfileId: null } });
    await expect(service.issue(input(funding.id, bob, 'profile-missing-bob'))).rejects.toThrow('Funding request not found');
    await expect(service.issue(input(funding.id, alice, 'profile-missing-alice'))).resolves.toMatchObject({ accountId: aliceAccount, address });
  });

  it('reconciles a provider timeout after vault creation without creating a second vault', async () => {
    const funding = await request(); fixture.timeoutNextCreate();
    await expect(service.issue(input(funding.id, alice, 'uncertain-key'))).rejects.toThrow('could not be verified');
    expect(fixture.vaultCreates).toBe(1);
    await expect(service.issue(input(funding.id, alice, 'uncertain-key'))).resolves.toMatchObject({ address, settlementStatus: 'NOT_CONFIRMED' });
    expect(fixture.vaultCreates).toBe(1); expect(fixture.assetCreates).toBe(1);
  });

  it('blocks invalid asset evidence and changed vault identity or memo on a replay', async () => {
    const funding = await request(); fixture.mismatchAsset(true);
    await expect(service.issue(input(funding.id, alice, 'metadata-key'))).rejects.toThrow('could not be verified');
    expect(fixture.vaultCreates).toBe(0);
    fixture.mismatchAsset(false);
    await service.issue(input(funding.id, alice, 'metadata-key'));
    fixture.vaults[0]!.customerRefId = bobAccount;
    await expect(service.get(input(funding.id))).rejects.toThrow('could not be verified');
    fixture.vaults[0]!.customerRefId = aliceAccount;
    fixture.vaults[0]!.tag = 'required-memo';
    await expect(service.get(input(funding.id))).rejects.toThrow('could not be verified');
  });

  it('does not repeat a provider write after its idempotency window has expired', async () => {
    const funding = await request(); fixture.mismatchAsset(true);
    const inpt = input(funding.id, alice, 'old-uncertain-key');
    await expect(service.issue(inpt)).rejects.toThrow();
    await admin.$executeRaw`UPDATE "customer_deposit_address_issuances" SET "attempt_started_at"=now() - interval '25 hours' WHERE "funding_request_id"=${funding.id}::uuid`;
    fixture.mismatchAsset(false);
    await expect(service.issue(inpt)).rejects.toThrow('could not be verified');
    expect(fixture.vaultCreates).toBe(0);
    const [row] = await admin.$queryRaw<Array<{ state: string }>>`SELECT "state" FROM "customer_deposit_address_issuances" WHERE "funding_request_id"=${funding.id}::uuid`;
    expect(row?.state).toBe('MANUAL_REVIEW');
  });

  it('rechecks eligibility after the provider call and never reveals the address after suspension', async () => {
    const funding = await request();
    fixture.onAddress(async () => { await admin.institutionalAccount.update({ where: { id: aliceAccount }, data: { state: 'SUSPENDED' } }); });
    try {
      await expect(service.issue(input(funding.id, alice, 'suspension-key'))).rejects.toThrow('cannot receive a deposit address');
      const [row] = await admin.$queryRaw<Array<{ state: string; address: string | null }>>`SELECT "state", "address" FROM "customer_deposit_address_issuances" WHERE "funding_request_id"=${funding.id}::uuid`;
      expect(row).toMatchObject({ state: 'PENDING', address: null });
    } finally {
      await admin.institutionalAccount.update({ where: { id: aliceAccount }, data: { state: 'ACTIVE' } });
    }
    await expect(service.issue(input(funding.id, alice, 'suspension-key'))).resolves.toMatchObject({ address });
    expect(fixture.vaultCreates).toBe(1);
  });

  it('waits for a concurrent restriction committed before final eligibility and does not reveal the address', async () => {
    const funding = await request();
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const inserted = new Promise<void>((resolve) => { entered = resolve; });
    let restrictionWrite!: Promise<unknown>;
    fixture.onAddress(async () => {
      restrictionWrite = admin.$transaction(async (tx) => {
        await tx.accountRestriction.create({ data: { tenantId, accountId: aliceAccount, restrictionType: 'NO_DEPOSIT',
          status: 'ACTIVE', source: 'test', reason: 'Concurrent restriction', idempotencyKey: `race-${funding.id}` } });
        entered();
        await gate;
      }, { timeout: 10000 });
      await inserted;
    });
    const issuance = service.issue(input(funding.id, alice, 'restriction-wins'));
    // Attach the rejection handler before releasing the writer.
    const outcome = issuance.then(() => 'issued', (error: Error) => error.message);
    await inserted;
    try {
      let waiting = false;
      for (let n = 0; n < 100; n++) {
        const [row] = await admin.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted`;
        if (row && row.count > 0n) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
    } finally { release(); }
    await restrictionWrite;
    expect(await outcome).toContain('Deposits are restricted');
    const [row] = await admin.$queryRaw<Array<{ state: string; address: string | null }>>`SELECT state, address FROM customer_deposit_address_issuances WHERE funding_request_id=${funding.id}::uuid`;
    expect(row).toMatchObject({ state: 'PENDING', address: null });
    await admin.accountRestriction.updateMany({ where: { tenantId, idempotencyKey: `race-${funding.id}` }, data: { status: 'REVOKED' } });
  });

  it('holds the eligibility decision through commit before a concurrent restriction can take effect', async () => {
    const funding = await request();
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const checked = new Promise<void>((resolve) => { entered = resolve; });
    const privateService = service as unknown as { requireEligible: (...args: unknown[]) => Promise<unknown> };
    const original = privateService.requireEligible.bind(service);
    let calls = 0;
    const spy = jest.spyOn(privateService, 'requireEligible').mockImplementation(async (...args) => {
      const result = await original(...args);
      if (++calls === 3) { entered(); await gate; }
      return result;
    });
    const issuance = service.issue(input(funding.id, alice, 'issuance-wins'));
    await checked;
    // Prisma write promises are lazy; start this one before inspecting locks.
    const restriction = (async () => admin.accountRestriction.create({ data: { tenantId, accountId: aliceAccount, restrictionType: 'NO_DEPOSIT',
      status: 'ACTIVE', source: 'test', reason: 'Restriction after eligibility', idempotencyKey: `after-${funding.id}` } }))();
    try {
      let waiting = false;
      for (let n = 0; n < 100; n++) {
        const [row] = await admin.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted`;
        if (row && row.count > 0n) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
    } finally { release(); }
    await expect(issuance).resolves.toMatchObject({ address });
    await restriction;
    spy.mockRestore();
    await expect(service.get(input(funding.id))).rejects.toThrow('Deposits are restricted');
    await admin.accountRestriction.updateMany({ where: { tenantId, idempotencyKey: `after-${funding.id}` }, data: { status: 'REVOKED' } });
  });

  it('takes eligibility before the issuance row when an expired lease races final publication', async () => {
    const funding = await request();
    const privateService = service as unknown as {
      reserve: (...args: unknown[]) => Promise<unknown>;
      verifyAndProvision: (...args: unknown[]) => Promise<unknown>;
      requireEligible: (...args: unknown[]) => Promise<unknown>;
    };
    const stale = await privateService.reserve(input(funding.id, alice, 'expired-lease-stale-key'), fixture.client.credentialFingerprint);
    let resume!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    const finalDecision = new Promise<void>((resolve) => { entered = resolve; });
    const original = privateService.requireEligible.bind(service);
    let checks = 0;
    const spy = jest.spyOn(privateService, 'requireEligible').mockImplementation(async (...args) => {
      const result = await original(...args);
      if (++checks === 3) { entered(); await gate; }
      return result;
    });
    fixture.onAddress(async () => {
      // Model an expiry after provider I/O, just before final publication.
      await admin.$executeRaw`UPDATE customer_deposit_address_issuances SET lease_until=now()-interval '1 second' WHERE funding_request_id=${funding.id}::uuid`;
    });
    const first = service.issue(input(funding.id, alice, 'expired-lease-first-key'));
    const firstOutcome = first.then(() => 'issued', (error: Error) => error.message);
    await finalDecision;
    const second = privateService.verifyAndProvision(input(funding.id, alice, 'expired-lease-stale-key'), stale, fixture.client, true);
    const secondOutcome = second.then((value) => ({ value }), (error: Error) => ({ error }));
    try {
      let waiting = false;
      for (let n = 0; n < 100; n++) {
        const [locks] = await admin.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted`;
        if (locks && locks.count > 0n) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      // The contender must be waiting *before* it holds the issuance row.
      // The previous row-first order made this NOWAIT lock fail, and releasing
      // finalization formed a PostgreSQL deadlock between the two requests.
      await expect(admin.$queryRaw`SELECT id FROM customer_deposit_address_issuances WHERE funding_request_id=${funding.id}::uuid FOR UPDATE NOWAIT`).resolves.toHaveLength(1);
    } finally { resume(); spy.mockRestore(); }
    expect(await firstOutcome).toContain('could not be verified');
    expect(await secondOutcome).toMatchObject({ value: { address, status: 'ADDRESS_VERIFIED' } });
    expect(fixture.vaultCreates).toBe(1);
    expect(await admin.clientLifecycleAudit.count({ where: { tenantId, action: 'DEPOSIT_ADDRESS_VERIFIED',
      evidence: { path: ['fundingRequestId'], equals: funding.id } } })).toBe(1);
  });

  it('refreshes a stale pre-lease snapshot after a competing request completes', async () => {
    const funding = await request();
    let resume!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    const reserved = new Promise<void>((resolve) => { entered = resolve; });
    const privateService = service as unknown as { verifyAndProvision: (...args: unknown[]) => Promise<unknown> };
    const original = privateService.verifyAndProvision.bind(service);
    const spy = jest.spyOn(privateService, 'verifyAndProvision').mockImplementationOnce(async (...args) => {
      entered(); await gate; return original(...args);
    });
    const delayed = service.issue(input(funding.id, alice, 'stale-lease-key-1'));
    await reserved;
    try {
      await expect(service.issue(input(funding.id, alice, 'stale-lease-key-2'))).resolves.toMatchObject({ address });
    } finally { resume(); }
    await expect(delayed).resolves.toMatchObject({ address });
    spy.mockRestore();
    expect(fixture.vaultCreates).toBe(1); expect(fixture.assetCreates).toBe(1);
    expect(await admin.clientLifecycleAudit.count({ where: { tenantId, accountId: aliceAccount, action: 'DEPOSIT_ADDRESS_VERIFIED',
      evidence: { path: ['fundingRequestId'], equals: funding.id } } })).toBe(1);
  });

  it('rolls back address completion when its atomic audit insert fails and reconciles the existing provider vault', async () => {
    const funding = await request();
    const name = `deposit_audit_${funding.id.replace(/-/g, '')}`;
    await admin.$executeRawUnsafe(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'DEPOSIT_ADDRESS_VERIFIED' AND NEW.evidence->>'fundingRequestId' = '${funding.id}' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END $$`);
    await admin.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE INSERT ON client_lifecycle_audits FOR EACH ROW EXECUTE FUNCTION ${name}()`);
    try {
      await expect(service.issue(input(funding.id, alice, 'audit-rollback-key'))).rejects.toThrow('could not be verified');
      const [row] = await admin.$queryRaw<Array<{ state: string; address: string | null }>>`SELECT state, address FROM customer_deposit_address_issuances WHERE funding_request_id=${funding.id}::uuid`;
      expect(row).toMatchObject({ state: 'PENDING', address: null });
      expect(fixture.vaultCreates).toBe(1);
    } finally {
      await admin.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON client_lifecycle_audits`);
      await admin.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}()`);
    }
    await expect(service.issue(input(funding.id, alice, 'audit-rollback-key'))).resolves.toMatchObject({ address });
    expect(fixture.vaultCreates).toBe(1);
  });

  it('serializes concurrent requests and fences the losing attempt', async () => {
    const funding = await request();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    fixture.pauseCreate(held);
    const first = service.issue(input(funding.id, alice, 'parallel-key-1'));
    // Observe the first provider call rather than relying on a fixed sleep.
    for (let n = 0; n < 100 && fixture.vaultCreates === 0; n++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fixture.vaultCreates).toBe(1);
    await expect(service.issue(input(funding.id, alice, 'parallel-key-2'))).rejects.toThrow('verification is in progress');
    fixture.resumeCreate(); release();
    await expect(first).resolves.toMatchObject({ address });
    await expect(service.issue(input(funding.id, alice, 'parallel-key-2'))).resolves.toMatchObject({ address });
    expect(fixture.vaultCreates).toBe(1);
  });

  it('looks up an owner-bound provider transfer as an observation, without settling or crediting', async () => {
    const funding = await request();
    await service.issue(input(funding.id));
    fixture.addTransfer(fixture.vaults[0]!.id);
    const result = await service.observeTransfer({ ...input(funding.id), transactionHash: transferHash });
    expect(result).toMatchObject({ status: 'OBSERVED', fundingRequestId: funding.id, assetId, currency: 'ETH',
      transactionHash: transferHash, amount: '1.000000000000000001', rawUnits: '1000000000000000001',
      amountEvidence: 'PROVIDER_REPORTED', logIndex: null, settlementStatus: 'NOT_CONFIRMED',
      monitoringStatus: 'LOOKUP_ONLY', complianceStatus: 'NOT_EVALUATED' });
    expect((await admin.fundingRequest.findUniqueOrThrow({ where: { id: funding.id } })).state).toBe('REQUESTED');
    expect(await admin.custodyDeposit.count({ where: { tenantId } })).toBe(0);
    const before = fixture.calls.length;
    await expect(service.observeTransfer({ ...input(funding.id, bob), transactionHash: transferHash })).rejects.toThrow('Funding request not found');
    await expect(service.observeTransfer({ ...input(funding.id), tenantId: foreignTenant, transactionHash: transferHash })).rejects.toThrow('Funding request not found');
    expect(fixture.calls.length).toBe(before);
  });

  it('does not call pending, inexact, missing or mismatched provider records a completed observation', async () => {
    const funding = await request();
    await service.issue(input(funding.id));
    const lookup = { ...input(funding.id), transactionHash: transferHash };
    await expect(service.observeTransfer({ ...lookup, transactionHash: 'bad-hash' })).rejects.toThrow('Invalid transaction hash');
    await expect(service.observeTransfer(lookup)).rejects.toThrow('No completed transfer observation');
    fixture.addTransfer(fixture.vaults[0]!.id, 'CONFIRMING');
    await expect(service.observeTransfer(lookup)).rejects.toThrow('No completed transfer observation');
    fixture.addTransfer(fixture.vaults[0]!.id, 'COMPLETED', '0.0000000000000000001');
    await expect(service.observeTransfer(lookup)).rejects.toThrow('no account credit has been confirmed');
    fixture.addTransfer(fixture.vaults[0]!.id);
    fixture.mismatchAsset(true);
    await expect(service.observeTransfer(lookup)).rejects.toThrow('no account credit has been confirmed');
    expect(await admin.custodyDeposit.count({ where: { tenantId } })).toBe(0);
  });

  it('rechecks account restrictions after provider lookup before returning the observation', async () => {
    const funding = await request();
    await service.issue(input(funding.id));
    fixture.addTransfer(fixture.vaults[0]!.id);
    const key = `observation-restriction-${funding.id}`;
    fixture.onAddress(async () => { await admin.accountRestriction.create({ data: { tenantId, accountId: aliceAccount,
      restrictionType: 'NO_DEPOSIT', status: 'ACTIVE', source: 'test', reason: 'Restricted', idempotencyKey: key } }); });
    try {
      await expect(service.observeTransfer({ ...input(funding.id), transactionHash: transferHash })).rejects.toThrow('Deposits are restricted');
      expect(await admin.custodyDeposit.count({ where: { tenantId } })).toBe(0);
    } finally {
      await admin.accountRestriction.updateMany({ where: { tenantId, idempotencyKey: key }, data: { status: 'REVOKED' } });
    }
  });

  it('protects issuance with permission and action-specific step-up, while reads remain owner-scoped', async () => {
    const reflector = new Reflector();
    const issue = CustomerDepositAddressController.prototype.issue;
    expect(reflector.get(REQUIRE_STEP_UP_KEY, issue)).toBe('CUSTODY_ADDRESS_ISSUE');
    expect(reflector.get(PERMISSIONS_KEY, issue)).toEqual([Permission.PORTFOLIO_READ, Permission.PAYOUT_MANAGE]);
    expect(reflector.get(PERMISSIONS_MODE_KEY, issue)).toBe('any');
    const observe = CustomerDepositAddressController.prototype.observeTransfer;
    expect(reflector.get(PERMISSIONS_KEY, observe)).toEqual([Permission.PORTFOLIO_READ, Permission.PAYOUT_MANAGE]);
    expect(reflector.get(PERMISSIONS_MODE_KEY, observe)).toBe('any');
    const controller = new CustomerDepositAddressController(service);
    const actor = { tenantId, userId: bob } as AuthenticatedActor;
    await expect(controller.get(tenantId, actor, randomUUID(), { assetId, networkId: 'ethereum' })).rejects.toThrow();
    await expect(controller.observeTransfer(tenantId, actor, randomUUID(), transferHash,
      { assetId, networkId: 'ethereum' })).rejects.toThrow();
  });
});
