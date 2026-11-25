// # Responsibility: proves the server-enforced prepare-confirm credential rotation preserves the active key until a verified candidate is explicitly confirmed.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { CredentialSource } from '@prisma/client';

import { ApiKeyRotationService } from './api-key-rotation.service';
import type { ExchangeAccountRecord } from './exchange-account.repository';
import { ExchangeEnvironment, ExchangeVenue } from './exchange.types';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const OTHER_SESSION = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACCOUNT = '44444444-4444-4444-8444-444444444444';
const ROTATION = '55555555-5555-4555-8555-555555555555';

function createMock(): any {
  return jest.fn();
}

function account(overrides: Partial<ExchangeAccountRecord> = {}): ExchangeAccountRecord {
  const now = new Date('2026-11-18T00:00:00.000Z');
  return {
    id: ACCOUNT,
    tenantId: TENANT,
    userId: ACTOR,
    exchangeId: '66666666-6666-4666-8666-666666666666',
    venue: ExchangeVenue.BITGET,
    label: 'Bitget demo',
    status: 'ACTIVE' as ExchangeAccountRecord['status'],
    environment: ExchangeEnvironment.SANDBOX,
    isSandbox: true,
    credentialVersion: 7,
    credentialSource: CredentialSource.ENVELOPE_DB,
    credentialRef: null,
    apiKeyLastFour: 'OLD7',
    apiKeyBlindIndex: '0'.repeat(64),
    capabilities: [],
    healthState: 'HEALTHY' as ExchangeAccountRecord['healthState'],
    connectionState: 'CONNECTED' as ExchangeAccountRecord['connectionState'],
    lastVerifiedAt: now,
    credentialExpiresAt: null,
    consecutiveFailures: 0,
    lastSyncAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    liveTradingEnabled: false,
    privateStreamEnabled: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    idempotencyKey: null,
    metadata: {},
    ...overrides,
  };
}

function prepareInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT,
    accountId: ACCOUNT,
    actorId: ACTOR,
    sessionId: SESSION,
    venue: ExchangeVenue.BITGET,
    environment: ExchangeEnvironment.SANDBOX,
    apiKey: 'candidate-public-key',
    apiSecret: 'candidate-private-secret',
    passphrase: 'candidate-passphrase',
    requestId: 'request-1',
    ipHash: 'hash-1',
    ...overrides,
  };
}

function confirmInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT,
    accountId: ACCOUNT,
    rotationId: ROTATION,
    actorId: ACTOR,
    sessionId: SESSION,
    venue: ExchangeVenue.BITGET,
    environment: ExchangeEnvironment.SANDBOX,
    requestId: 'request-2',
    ipHash: 'hash-2',
    ...overrides,
  };
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: ROTATION,
    expectedCredentialVersion: 7,
    credentialSource: CredentialSource.ENVELOPE_DB,
    apiKeyCiphertext: 'sealed-public-key',
    apiSecretCiphertext: 'sealed-private-secret',
    passphraseCiphertext: 'sealed-passphrase',
    encryptedDataKey: 'wrapped-key',
    encryptionKeyId: 'test-kek',
    apiKeyBlindIndex: 'a'.repeat(64),
    apiKeyLastFour: 'KEY9',
    verifiedPermissions: ['ORDERS', 'SPOT'],
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

function venueMetadata(overrides: Record<string, unknown> = {}) {
  return {
    accountId: ACCOUNT,
    venue: ExchangeVenue.BITGET,
    environment: ExchangeEnvironment.SANDBOX,
    isSandbox: true,
    canTrade: true,
    canRead: true,
    canWithdraw: false,
    ipRestricted: true,
    permissions: ['SPOT_TRADE'],
    uid: null,
    email: null,
    ...overrides,
  };
}

describe('ApiKeyRotationService prepare-confirm protocol', () => {
  // The collaborators are intentionally structural. The unit owns only this
  // protocol and provides no database, crypto, provider, or audit fake beyond
  // the narrow contract consumed by the tested call.
  let prisma: any;
  let transactions: any;
  let accounts: any;
  let credentials: any;
  let provider: any;
  let providers: any;
  let registry: any;
  let audit: any;
  let service: ApiKeyRotationService;

  beforeEach(() => {
    transactions = {
      tradingAccount: { findFirst: createMock(), updateMany: createMock() },
      exchangeCredentialRotation: { create: createMock(), findFirst: createMock(), updateMany: createMock(), update: createMock() },
    };
    prisma = {
      withTenantRls: createMock().mockImplementation(async (_tenantId: string, work: (tx: any) => Promise<unknown>) => work(transactions)),
    };
    accounts = { findById: createMock().mockResolvedValue(account()) };
    credentials = {
      stageRotationCandidate: createMock().mockReturnValue({
        apiKeyCiphertext: 'sealed-public-key',
        apiSecretCiphertext: 'sealed-private-secret',
        passphraseCiphertext: 'sealed-passphrase',
        encryptedDataKey: 'wrapped-key',
        encryptionKeyId: 'test-kek',
        apiKeyLastFour: 'KEY9',
        apiKeyBlindIndex: 'a'.repeat(64),
      }),
      decryptRotationCandidate: createMock().mockReturnValue({
        apiKey: 'candidate-public-key',
        apiSecret: 'candidate-private-secret',
        passphrase: 'candidate-passphrase',
      }),
      writeSecretManagerRotationCandidate: createMock().mockResolvedValue('secrets/rotation-1'),
      destroySecretManagerRotationCandidate: createMock().mockResolvedValue(undefined),
    };
    provider = {
      getServerTime: createMock().mockResolvedValue({ serverTimeMicros: '1000000', localTimeMicros: '1000000', driftMs: 0 }),
      getAccountMetadata: createMock().mockResolvedValue(venueMetadata()),
      getCapabilities: createMock().mockResolvedValue({
        venue: ExchangeVenue.BITGET,
        environment: ExchangeEnvironment.SANDBOX,
        capabilities: ['SPOT', 'ORDERS'],
      }),
    };
    providers = { validateEnvironmentBinding: createMock(), getProvider: createMock().mockReturnValue(provider) };
    registry = { getVenue: createMock().mockReturnValue({ requiresPassphrase: true, supportedEnvironments: [ExchangeEnvironment.SANDBOX] }) };
    audit = { record: createMock().mockResolvedValue(undefined) };
    service = new ApiKeyRotationService(prisma, accounts, credentials, providers, registry, audit);
  });

  it('verifies and encrypts a Bitget candidate without replacing the active credential', async () => {
    transactions.tradingAccount.findFirst.mockResolvedValue(null);
    transactions.exchangeCredentialRotation.create.mockResolvedValue({
      id: ROTATION,
      apiKeyLastFour: 'KEY9',
      expiresAt: new Date(Date.now() + 60_000),
    });
    transactions.exchangeCredentialRotation.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.prepare(prepareInput());

    expect(result).toMatchObject({
      status: 'CANDIDATE_VERIFIED',
      rotationId: ROTATION,
      apiKeyLastFour: 'KEY9',
      previousKeyRetained: true,
    });
    expect(credentials.stageRotationCandidate).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'candidate-public-key' }));
    expect(transactions.exchangeCredentialRotation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        accountId: ACCOUNT,
        expectedCredentialVersion: 7,
        credentialSource: CredentialSource.ENVELOPE_DB,
        apiKeyCiphertext: 'sealed-public-key',
      }),
    }));
    expect(transactions.tradingAccount.updateMany).not.toHaveBeenCalled();
    const auditLog = JSON.stringify(audit.record.mock.calls);
    expect(auditLog).not.toContain('candidate-private-secret');
    expect(auditLog).not.toContain('candidate-passphrase');
  });

  it.each([ExchangeEnvironment.SANDBOX])(
    'binds a replacement candidate to the exact %s environment rather than collapsing non-live accounts',
    async (environment) => {
      accounts.findById.mockResolvedValueOnce(account({ environment, isSandbox: true }));
      provider.getAccountMetadata.mockResolvedValueOnce(venueMetadata({ environment, isSandbox: true }));
      provider.getCapabilities.mockResolvedValueOnce({ venue: ExchangeVenue.BITGET, environment, capabilities: ['SPOT', 'ORDERS'] });
      transactions.tradingAccount.findFirst.mockResolvedValue(null);
      transactions.exchangeCredentialRotation.updateMany.mockResolvedValue({ count: 0 });
      transactions.exchangeCredentialRotation.create.mockResolvedValue({ id: ROTATION, apiKeyLastFour: 'KEY9', expiresAt: new Date(Date.now() + 60_000) });

      await expect(service.prepare(prepareInput({ environment }))).resolves.toMatchObject({ status: 'CANDIDATE_VERIFIED' });
      expect(providers.validateEnvironmentBinding).toHaveBeenCalledWith(ExchangeVenue.BITGET, environment, true);
    },
  );

  it('refuses a withdrawal-capable candidate before it is staged', async () => {
    provider.getAccountMetadata.mockResolvedValueOnce(venueMetadata({ canWithdraw: true, permissions: ['WITHDRAW'] }));

    const result = await service.prepare(prepareInput());

    expect(result).toMatchObject({ status: 'REFUSED', code: 'CANDIDATE_CAN_WITHDRAW', previousKeyRetained: true });
    expect(credentials.stageRotationCandidate).not.toHaveBeenCalled();
    expect(transactions.exchangeCredentialRotation.create).not.toHaveBeenCalled();
  });

  it('refuses a candidate without verified venue IP allowlisting before it is staged', async () => {
    provider.getAccountMetadata.mockResolvedValueOnce(venueMetadata({ ipRestricted: false }));

    const result = await service.prepare(prepareInput());

    expect(result).toMatchObject({ status: 'REFUSED', code: 'CANDIDATE_IP_ALLOWLIST_REQUIRED', previousKeyRetained: true });
    expect(credentials.stageRotationCandidate).not.toHaveBeenCalled();
    expect(transactions.exchangeCredentialRotation.create).not.toHaveBeenCalled();
  });

  it('requires Bitget passphrase before any provider call', async () => {
    const result = await service.prepare(prepareInput({ passphrase: '' }));

    expect(result).toMatchObject({ status: 'REFUSED', code: 'PASSPHRASE_REQUIRED', previousKeyRetained: true });
    expect(providers.getProvider).not.toHaveBeenCalled();
    expect(credentials.stageRotationCandidate).not.toHaveBeenCalled();
  });

  it('atomically promotes only a previously verified candidate after confirmation', async () => {
    transactions.exchangeCredentialRotation.findFirst.mockResolvedValue(candidate());
    transactions.exchangeCredentialRotation.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    transactions.tradingAccount.updateMany.mockResolvedValue({ count: 1 });
    transactions.exchangeCredentialRotation.update.mockResolvedValue({});

    const result = await service.confirm(confirmInput());

    expect(result).toMatchObject({ status: 'ROTATED', code: 'ROTATION_COMPLETE', previousKeyRetained: false });
    expect(transactions.tradingAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ credentialVersion: 7 }),
      data: expect.objectContaining({ credentialVersion: { increment: 1 }, apiKeyLastFour: 'KEY9', ipRestricted: true }),
    }));
    expect(transactions.exchangeCredentialRotation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ apiKeyCiphertext: null, apiSecretCiphertext: null, passphraseCiphertext: null }),
    }));
  });

  it('uses a separately written secret-manager candidate only after the version-guarded promotion succeeds', async () => {
    accounts.findById.mockResolvedValueOnce(account({ credentialSource: CredentialSource.SECRET_MANAGER, credentialRef: 'secrets/active' }));
    transactions.exchangeCredentialRotation.findFirst.mockResolvedValue(candidate({ credentialSource: CredentialSource.SECRET_MANAGER }));
    transactions.exchangeCredentialRotation.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    transactions.tradingAccount.updateMany.mockResolvedValue({ count: 1 });
    transactions.exchangeCredentialRotation.update.mockResolvedValue({});

    await expect(service.confirm(confirmInput())).resolves.toMatchObject({ status: 'ROTATED' });

    expect(credentials.writeSecretManagerRotationCandidate).toHaveBeenCalledWith(expect.objectContaining({ rotationId: ROTATION }));
    expect(transactions.tradingAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ credentialRef: 'secrets/rotation-1', apiKeyCiphertext: null }),
    }));
  });

  it('does not switch when a competing change has advanced the account version', async () => {
    transactions.exchangeCredentialRotation.findFirst.mockResolvedValue(candidate());
    transactions.exchangeCredentialRotation.updateMany.mockResolvedValue({ count: 1 });
    transactions.tradingAccount.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.confirm(confirmInput());

    expect(result).toMatchObject({ status: 'REFUSED', code: 'STALE_VERSION', previousKeyRetained: true });
    expect(transactions.exchangeCredentialRotation.update).not.toHaveBeenCalled();
  });

  it('expires and erases candidate material without changing the active account', async () => {
    transactions.exchangeCredentialRotation.findFirst.mockResolvedValue(candidate({ expiresAt: new Date(Date.now() - 1_000) }));
    transactions.exchangeCredentialRotation.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.confirm(confirmInput());

    expect(result).toMatchObject({ status: 'REFUSED', code: 'ROTATION_EXPIRED', previousKeyRetained: true });
    expect(transactions.exchangeCredentialRotation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'EXPIRED', apiKeyCiphertext: null, apiSecretCiphertext: null }),
    }));
    expect(transactions.tradingAccount.updateMany).not.toHaveBeenCalled();
  });

  it('queries candidates under matching tenant, actor, account, and session scope', async () => {
    transactions.exchangeCredentialRotation.findFirst.mockResolvedValue(null);

    await expect(service.confirm(confirmInput({ tenantId: OTHER_TENANT, sessionId: OTHER_SESSION }))).resolves.toMatchObject({
      status: 'REFUSED',
      code: 'ROTATION_NOT_FOUND',
      previousKeyRetained: true,
    });

    expect(prisma.withTenantRls).toHaveBeenCalledWith(OTHER_TENANT, expect.any(Function));
    expect(transactions.exchangeCredentialRotation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        tenantId: OTHER_TENANT,
        accountId: ACCOUNT,
        actorId: ACTOR,
        sessionId: OTHER_SESSION,
      }),
    }));
    expect(transactions.tradingAccount.updateMany).not.toHaveBeenCalled();
  });

  it('erases a candidate on cancellation while leaving the account row unchanged', async () => {
    transactions.exchangeCredentialRotation.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.cancel(confirmInput());

    expect(result).toMatchObject({ status: 'CANCELLED', code: 'ROTATION_CANCELLED', previousKeyRetained: true });
    expect(transactions.exchangeCredentialRotation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CANCELLED', apiKeyCiphertext: null, apiSecretCiphertext: null }),
    }));
    expect(transactions.tradingAccount.updateMany).not.toHaveBeenCalled();
  });
});
