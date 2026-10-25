// # Responsibility: prove fresh, tenant/environment-bound exchange evidence and native conditional/counter writes with typed unit ports; no case contacts a venue or certifies live trading.
import { ExchangeRoutingService } from './exchange-routing.service';
import { ExchangeSymbolService } from './exchange-symbol.service';
import { ExchangeRateLimitService } from './exchange-rate-limit.service';
import { ExchangeOrderSyncService } from './exchange-order-sync.service';
import { ExchangePositionSyncService } from './exchange-position-sync.service';
import { ExchangeBalanceSyncService } from './exchange-balance-sync.service';
import { ExchangeAccountService } from './exchange-account.service';
import type { SealedPayload } from '@wlct/utils';
import { type AuthenticatedActor, Permission } from '@wlct/shared-types';
import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import { AppConfigService } from '../../config/app-config.service';
import { ExchangesController } from './exchanges.controller';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma, type TradingAccount, type TradingVenue } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CacheService } from '../../infrastructure/redis/cache.service';
import { ExchangeAccountRepository, type ExchangeAccountRecord } from './exchange-account.repository';
import { ExchangeConnectivityService } from './exchange-connectivity.service';
import { ExchangeCredentialService } from './exchange-credential.service';
import { ExchangeProviderFactory } from './exchange-provider.factory';
import { ExchangeRegistryService } from './exchange-registry.service';
import { ExchangeAuditService } from './exchange-audit.service';
import { ExchangeHealthService } from './exchange-health.service';
import { type ExchangeProvider, type ExchangeProviderContext, ExchangeProviderError, ExchangeProviderErrorCode } from './exchange-provider.interface';
import { ExchangeVenue, ExchangeEnvironment, ExchangeAccountState, ExchangeConnectionState, ExchangeHealthState,
  type ExchangeHealth, type ExchangeConnectivityResult, type ExchangeCapabilityDiscovery, type ExchangeSafeReference, sanitizeExchangeMetadata } from './exchange.types';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const ACCOUNT = 'account-1';
const INPUT = { tenantId: TENANT, accountId: ACCOUNT, venue: ExchangeVenue.BINANCE, environment: ExchangeEnvironment.LIVE };
function accountRecord(overrides: Partial<ExchangeAccountRecord> = {}): ExchangeAccountRecord {
  const now = new Date();
  return { id: ACCOUNT, tenantId: TENANT, userId: 'user-1', exchangeId: 'exchange-1', venue: ExchangeVenue.BINANCE, label: 'Unit account',
    status: ExchangeAccountState.ACTIVE, environment: ExchangeEnvironment.LIVE, isSandbox: false, credentialSource: 'SECRET_MANAGER',
    credentialRef: 'unit-secret-reference', apiKeyLastFour: null, apiKeyBlindIndex: null, capabilities: [], healthState: ExchangeHealthState.HEALTHY,
    connectionState: ExchangeConnectionState.CONNECTED, lastVerifiedAt: now, lastSyncAt: now, lastErrorCode: null, lastErrorMessage: null,
    liveTradingEnabled: false, privateStreamEnabled: false, createdAt: now, updatedAt: now, deletedAt: null, idempotencyKey: null, metadata: {}, ...overrides };
}
function connectivity(overrides: Partial<ExchangeConnectivityResult> = {}): ExchangeConnectivityResult {
  return { connected: true, degraded: false, state: ExchangeConnectionState.CONNECTED, latencyMs: 0, serverTimeMicros: '1000000', clockDriftMs: 0,
    capabilities: [], failureCode: null, failureReason: null, isSimulated: false, environment: ExchangeEnvironment.LIVE, ...overrides };
}
function healthRecord(overrides: Partial<ExchangeHealth> = {}): ExchangeHealth {
  return { ...INPUT, state: ExchangeHealthState.HEALTHY, latencyMs: 0, authFailures: 0, apiErrors: 0, rateLimitPressure: 0,
    dataCompleteness: 'OBSERVED', syncAgeMs: 0, clockDriftMs: 0, websocketConnected: null, providerAvailable: true,
    credentialExpired: false, credentialRevoked: false, lastCheckedAt: new Date().toISOString(), lastErrorCode: null, message: null, ...overrides };
}
function discovery(overrides: Partial<ExchangeCapabilityDiscovery> = {}): ExchangeCapabilityDiscovery {
  return { venue: ExchangeVenue.BINANCE, environment: ExchangeEnvironment.LIVE, capabilities: [], supportedOrderTypes: [],
    supportedEnvironments: [ExchangeEnvironment.LIVE], apiVersion: 'unit-version', restAvailable: true, websocketAvailable: false,
    rateLimitModel: 'unit-limit', authenticationModel: 'unit-auth', symbolFormat: 'unit-symbol', timestamp: new Date().toISOString(), ...overrides };
}

describe('Exchange health evidence fails closed', () => {
  let module: TestingModule; let stored: Map<string, unknown>; let account: ExchangeAccountRecord | null;
  const repository = { findById: jest.fn<ExchangeAccountRepository['findById']>(), listByTenant: jest.fn<ExchangeAccountRepository['listByTenant']>(),
    recordConnectivityFailure: jest.fn<ExchangeAccountRepository['recordConnectivityFailure']>() };
  const native = { tradingAccount: { findFirst: jest.fn<(args: Prisma.TradingAccountFindFirstArgs) => Promise<Pick<TradingAccount, 'credentialExpiresAt' | 'consecutiveFailures' | 'lastFailureCode'> | null>>() } };
  const credential = { validateCredentialReference: jest.fn<ExchangeCredentialService['validateCredentialReference']>() };
  const probe = { checkConnectivity: jest.fn<ExchangeConnectivityService['checkConnectivity']>() };
  const audit = { record: jest.fn<ExchangeAuditService['record']>() };
  const cache = { get: jest.fn<(key: string) => Promise<unknown>>(), set: jest.fn<(key: string, value: unknown, ttl: number) => Promise<void>>(),
    delete: jest.fn<(...keys: string[]) => Promise<void>>() };
  beforeEach(async () => {
    account = accountRecord(); stored = new Map();
    const now = new Date().toISOString();
    stored.set(`exchange:health:metrics:${TENANT}:${ACCOUNT}`, { tenantId: TENANT, accountId: ACCOUNT, latencyMs: null, latencyMeasuredAt: null,
      rateLimitPressure: 0, rateLimitMeasuredAt: now, retryUntilMs: null });
    repository.findById.mockReset().mockImplementation(async () => account); repository.listByTenant.mockReset().mockResolvedValue({ data: [], total: 0 });
    repository.recordConnectivityFailure.mockReset().mockResolvedValue(true);
    native.tradingAccount.findFirst.mockReset().mockResolvedValue({ credentialExpiresAt: null, consecutiveFailures: 0, lastFailureCode: null });
    credential.validateCredentialReference.mockReset().mockResolvedValue({ valid: true, source: 'SECRET_MANAGER', ref: 'unit-secret-reference', lastFour: null }); probe.checkConnectivity.mockReset().mockResolvedValue(connectivity());
    audit.record.mockReset().mockResolvedValue(undefined); cache.get.mockReset().mockImplementation(async (key) => stored.get(key) ?? null);
    cache.set.mockReset().mockImplementation(async (key, value) => { stored.set(key, value); });
    cache.delete.mockReset().mockImplementation(async (...keys) => { for (const key of keys) stored.delete(key); });
    module = await Test.createTestingModule({ providers: [ExchangeHealthService, { provide: PrismaService, useValue: native },
      { provide: ExchangeCredentialService, useValue: credential }, { provide: ExchangeAccountRepository, useValue: repository },
      { provide: ExchangeConnectivityService, useValue: probe }, { provide: ExchangeAuditService, useValue: audit }, { provide: CacheService, useValue: cache },
    ] }).compile();
  });
  afterEach(async () => { await module.close(); });
  function service() { return module.get<ExchangeHealthService>(ExchangeHealthService); }
  it('preserves observed zero latency, zero clock drift and zero pressure instead of converting them to null', async () => {
    const health = await service().checkHealth(INPUT);
    expect(health).toMatchObject({ state: ExchangeHealthState.HEALTHY, latencyMs: 0, clockDriftMs: 0, rateLimitPressure: 0, dataCompleteness: 'OBSERVED' });
    expect(service().isStaleHealthAllowsLiveTrading(health)).toBe(true);
    expect(health).not.toHaveProperty('liveTradingEnabled');
  });
  it('does not consider merely constructing a provider to be reachability evidence', async () => {
    probe.checkConnectivity.mockResolvedValueOnce(connectivity({ connected: false, failureCode: 'NETWORK_ERROR' }));
    const health = await service().checkHealth(INPUT);
    expect(health.providerAvailable).toBe(false); expect(service().isStaleHealthAllowsLiveTrading(health)).toBe(false);
  });
  it('does not accept simulated connectivity evidence for a LIVE account', async () => {
    probe.checkConnectivity.mockResolvedValueOnce(connectivity({ isSimulated: true }));
    expect(await service().checkHealth(INPUT)).toMatchObject({ state: ExchangeHealthState.UNAVAILABLE, providerAvailable: false });
  });
  it('does not default unobserved rate-limit pressure to measured zero', async () => {
    stored.clear();
    const health = await service().checkHealth(INPUT);
    expect(health).toMatchObject({ state: ExchangeHealthState.DEGRADED, rateLimitPressure: null, dataCompleteness: 'UNKNOWN' });
    expect(service().isStaleHealthAllowsLiveTrading(health)).toBe(false);
  });
  it('does not call credential verification time an account-data sync timestamp', async () => {
    account = accountRecord({ lastSyncAt: null });
    expect(await service().checkHealth(INPUT)).toMatchObject({ state: ExchangeHealthState.DEGRADED, syncAgeMs: null, dataCompleteness: 'UNKNOWN' });
  });
  it('fails closed on a required native credential/counter read failure', async () => {
    native.tradingAccount.findFirst.mockRejectedValueOnce(new Error('native credentials unavailable'));
    expect(await service().checkHealth(INPUT)).toMatchObject({ state: ExchangeHealthState.AUTH_FAILED, credentialRevoked: true, authFailures: null });
    expect(probe.checkConnectivity).not.toHaveBeenCalled();
  });
  it('does not treat a corrupt negative native failure counter as observed zero', async () => {
    native.tradingAccount.findFirst.mockResolvedValueOnce({ credentialExpiresAt: null, consecutiveFailures: -1, lastFailureCode: null });
    expect(await service().checkHealth(INPUT)).toMatchObject({ dataCompleteness: 'UNKNOWN', authFailures: null, apiErrors: null });
  });
  it('does not infer exact auth/API counts from an aggregate positive native failure count', async () => {
    native.tradingAccount.findFirst.mockResolvedValueOnce({ credentialExpiresAt: null, consecutiveFailures: 2, lastFailureCode: 'NETWORK_ERROR' });
    expect(await service().checkHealth(INPUT)).toMatchObject({ dataCompleteness: 'UNKNOWN', authFailures: null, apiErrors: null });
  });
  it.each([new Date(Number.NaN), new Date(Date.now() + 60_000)])('does not permit an invalid or future sync timestamp %s', async (lastSyncAt) => {
    account = accountRecord({ lastSyncAt });
    const health = await service().checkHealth(INPUT);
    expect(health).toMatchObject({ syncAgeMs: null, dataCompleteness: 'UNKNOWN' }); expect(service().isStaleHealthAllowsLiveTrading(health)).toBe(false);
  });
  it('rejects an account environment mismatch before making a probe', async () => {
    account = accountRecord({ environment: ExchangeEnvironment.TESTNET, isSandbox: true });
    expect(await service().checkHealth(INPUT)).toMatchObject({ state: ExchangeHealthState.UNAVAILABLE, lastErrorCode: 'ENVIRONMENT_MISMATCH' });
    expect(probe.checkConnectivity).not.toHaveBeenCalled();
  });
  it('never uses cached HEALTHY as a substitute for fresh authenticated evidence', async () => {
    stored.set(`exchange:health:${TENANT}:${ACCOUNT}`, healthRecord());
    probe.checkConnectivity.mockResolvedValueOnce(connectivity({ connected: false, failureCode: 'NETWORK_ERROR' }));
    const health = await service().getHealth(TENANT, ACCOUNT);
    expect(probe.checkConnectivity).toHaveBeenCalled(); expect(health?.state).toBe(ExchangeHealthState.UNAVAILABLE);
  });
  it('rejects cross-tenant or malformed cached health instead of trusting a typed cache assertion', async () => {
    stored.set(`exchange:health:${TENANT}:${ACCOUNT}`, { ...healthRecord({ tenantId: OTHER_TENANT, state: ExchangeHealthState.UNAVAILABLE }), authFailures: '0' });
    expect((await service().getHealth(TENANT, ACCOUNT))?.tenantId).toBe(TENANT); expect(probe.checkConnectivity).toHaveBeenCalled();
  });
  it('does not renew an expired pressure observation when latency is recorded', async () => {
    stored.set(`exchange:health:metrics:${TENANT}:${ACCOUNT}`, { tenantId: TENANT, accountId: ACCOUNT, latencyMs: null, latencyMeasuredAt: null,
      rateLimitPressure: 0, rateLimitMeasuredAt: new Date(Date.now() - 90_000).toISOString(), retryUntilMs: null });
    await service().recordLatency(TENANT, ACCOUNT, 0);
    expect(await service().checkHealth(INPUT)).toMatchObject({ state: ExchangeHealthState.DEGRADED, rateLimitPressure: null });
  });
  it.each([ExchangeHealthState.DEGRADED, ExchangeHealthState.RATE_LIMITED, ExchangeHealthState.STALE, ExchangeHealthState.AUTH_FAILED, ExchangeHealthState.UNAVAILABLE])('does not allow LIVE health prerequisite for %s', (state) => {
    expect(service().isStaleHealthAllowsLiveTrading(healthRecord({ state }))).toBe(false);
  });
  it('rejects stale, future-dated and non-LIVE health prerequisites', () => {
    expect(service().isStaleHealthAllowsLiveTrading(healthRecord({ lastCheckedAt: new Date(Date.now() - 61_000).toISOString() }))).toBe(false);
    expect(service().isStaleHealthAllowsLiveTrading(healthRecord({ lastCheckedAt: new Date(Date.now() + 60_000).toISOString() }))).toBe(false);
    expect(service().isStaleHealthAllowsLiveTrading(healthRecord({ environment: ExchangeEnvironment.TESTNET }))).toBe(false);
  });
  it('does not allow a contradictory HEALTHY record with error or missing clock evidence', () => {
    expect(service().isStaleHealthAllowsLiveTrading(healthRecord({ lastErrorCode: 'AUTH_FAILED' }))).toBe(false);
    expect(service().isStaleHealthAllowsLiveTrading(healthRecord({ clockDriftMs: null }))).toBe(false);
  });
  it('records authentication failure with a durable atomic increment before invalidating health', async () => {
    await service().recordAuthFailure(TENANT, ACCOUNT, 'AUTH_FAILED');
    expect(repository.recordConnectivityFailure).toHaveBeenCalledWith(ACCOUNT, TENANT, 'AUTH_FAILED');
    expect(cache.delete).toHaveBeenCalledWith(`exchange:health:${TENANT}:${ACCOUNT}`);
  });
  it('does not acknowledge an authentication-failure write that matched no tenant account', async () => {
    repository.recordConnectivityFailure.mockResolvedValueOnce(false);
    await expect(service().recordAuthFailure(TENANT, ACCOUNT, 'AUTH_FAILED')).rejects.toThrow(BadRequestException);
    expect(cache.delete).not.toHaveBeenCalled();
  });
  it.each([-1, 101, Number.NaN])('rejects invalid pressure %s rather than caching it as health evidence', async (pressure) => {
    await expect(service().recordRateLimit(TENANT, ACCOUNT, pressure)).rejects.toThrow(BadRequestException); expect(cache.set).not.toHaveBeenCalled();
  });
});

describe('Exchange authenticated connectivity and capability evidence', () => {
  let module: TestingModule;
  const provider: Pick<ExchangeProvider, 'testConnectivity' | 'getCapabilities' | 'getServerTime'> = {
    testConnectivity: jest.fn<ExchangeProvider['testConnectivity']>(), getCapabilities: jest.fn<ExchangeProvider['getCapabilities']>(),
    getServerTime: jest.fn<ExchangeProvider['getServerTime']>(),
  };
  const check = jest.fn<ExchangeProvider['testConnectivity']>(); const capabilities = jest.fn<ExchangeProvider['getCapabilities']>();
  const clock = jest.fn<ExchangeProvider['getServerTime']>();
  const factory = { validateEnvironmentBinding: jest.fn<ExchangeProviderFactory['validateEnvironmentBinding']>(), getProvider: jest.fn<() => typeof provider>() };
  const credential = { getDecryptedCredentialsForProvider: jest.fn<ExchangeCredentialService['getDecryptedCredentialsForProvider']>() };
  const repository = { findById: jest.fn<ExchangeAccountRepository['findById']>(), updateHealth: jest.fn<ExchangeAccountRepository['updateHealth']>(),
    recordConnectivityFailure: jest.fn<ExchangeAccountRepository['recordConnectivityFailure']>() };
  const audit = { record: jest.fn<ExchangeAuditService['record']>() };
  beforeEach(async () => {
    check.mockReset().mockResolvedValue(connectivity()); capabilities.mockReset().mockResolvedValue(discovery());
    clock.mockReset().mockResolvedValue({ driftMs: 0, serverTimeMicros: '1000000', localTimeMicros: '1000000' });
    factory.validateEnvironmentBinding.mockReset(); factory.getProvider.mockReset().mockReturnValue({ testConnectivity: check, getCapabilities: capabilities, getServerTime: clock });
    credential.getDecryptedCredentialsForProvider.mockReset().mockResolvedValue({ apiKey: 'unit-only-key', apiSecret: 'unit-only-credential' });
    repository.findById.mockReset().mockResolvedValue(accountRecord()); repository.updateHealth.mockReset().mockResolvedValue(accountRecord());
    repository.recordConnectivityFailure.mockReset().mockResolvedValue(true); audit.record.mockReset().mockResolvedValue(undefined);
    module = await Test.createTestingModule({ providers: [ExchangeConnectivityService, { provide: ExchangeProviderFactory, useValue: factory },
      { provide: ExchangeRegistryService, useValue: { getVenue: () => ({ supportedEnvironments: [ExchangeEnvironment.LIVE] }) } },
      { provide: ExchangeCredentialService, useValue: credential }, { provide: ExchangeAccountRepository, useValue: repository }, { provide: ExchangeAuditService, useValue: audit },
    ] }).compile();
  });
  afterEach(async () => { await module.close(); });
  function service() { return module.get<ExchangeConnectivityService>(ExchangeConnectivityService); }
  it('does not return connected when required health persistence fails', async () => {
    repository.updateHealth.mockRejectedValueOnce(new Error('health store unavailable'));
    expect(await service().checkConnectivity(INPUT)).toMatchObject({ connected: false, degraded: true });
  });
  it('does not relabel TESTNET evidence as LIVE by overwriting its environment fields', async () => {
    check.mockResolvedValueOnce(connectivity({ environment: ExchangeEnvironment.TESTNET, isSimulated: true }));
    expect(await service().checkConnectivity(INPUT)).toMatchObject({ connected: false, failureCode: ExchangeProviderErrorCode.ENVIRONMENT_MISMATCH });
    expect(repository.updateHealth).not.toHaveBeenCalled();
  });
  it('does not leak an unexpected provider error message containing credential material', async () => {
    check.mockRejectedValueOnce(new Error('unit-failure apiSecret=CANARY-do-not-copy'));
    const result = await service().checkConnectivity(INPUT);
    expect(result.connected).toBe(false); expect(result.failureReason).not.toContain('CANARY'); expect(result.failureReason).not.toContain('apiSecret');
  });
  it('does not replace failed authenticated discovery with registry capabilities', async () => {
    const failure = new ExchangeProviderError(ExchangeProviderErrorCode.PROVIDER_UNAVAILABLE, 'unit-secret-store unavailable', ExchangeVenue.BINANCE, ExchangeEnvironment.LIVE);
    credential.getDecryptedCredentialsForProvider.mockRejectedValueOnce(failure);
    await expect(service().discoverCapabilities(INPUT)).rejects.toBe(failure); expect(capabilities).not.toHaveBeenCalled();
  });
  it('propagates provider discovery failure instead of fabricating a discovery timestamp', async () => {
    const failure = new Error('discovery unavailable'); capabilities.mockRejectedValueOnce(failure);
    await expect(service().discoverCapabilities(INPUT)).rejects.toBe(failure);
  });
  it('does not use empty placeholder credentials after a required clock credential read fails', async () => {
    const failure = new Error('credentials unavailable'); credential.getDecryptedCredentialsForProvider.mockRejectedValueOnce(failure);
    await expect(service().checkServerTime(INPUT)).rejects.toBe(failure); expect(clock).not.toHaveBeenCalled();
  });
});

type PublicAccountRow = Pick<TradingAccount, 'id' | 'tenantId' | 'userId' | 'exchangeId' | 'label' | 'status' | 'marketType' | 'tradingMode'
  | 'isSandbox' | 'liveTradingEnabled' | 'privateStreamEnabled' | 'credentialSource' | 'credentialRef' | 'verifiedPermissions'
  | 'credentialRotatedAt' | 'credentialExpiresAt' | 'apiKeyLastFour' | 'apiKeyBlindIndex' | 'canTrade' | 'canReadData' | 'canWithdraw'
  | 'ipRestricted' | 'lastVerifiedAt' | 'lastFailureAt' | 'lastFailureCode' | 'consecutiveFailures' | 'createdAt' | 'updatedAt' | 'deletedAt'>
  & { exchange: { venue: TradingVenue } };
function publicAccountRow(): PublicAccountRow {
  const now = new Date();
  return { id: ACCOUNT, tenantId: TENANT, userId: 'user-1', exchangeId: 'exchange-1', label: 'Unit account', status: 'ACTIVE', marketType: 'SPOT',
    tradingMode: 'LIVE', isSandbox: false, liveTradingEnabled: false, privateStreamEnabled: false, credentialSource: 'SECRET_MANAGER', credentialRef: 'unit-reference',
    verifiedPermissions: [], credentialRotatedAt: null, credentialExpiresAt: null, apiKeyLastFour: 'unit', apiKeyBlindIndex: 'unit-index', canTrade: false,
    canReadData: true, canWithdraw: false, ipRestricted: false, lastVerifiedAt: now, lastFailureAt: null, lastFailureCode: null, consecutiveFailures: 0,
    createdAt: now, updatedAt: now, deletedAt: null, exchange: { venue: 'BINANCE' } };
}
describe('Native exchange account mutations and failure counters', () => {
  let module: TestingModule;
  const db = { tradingAccount: { update: jest.fn<(args: Prisma.TradingAccountUpdateArgs) => Promise<PublicAccountRow>>(),
    updateMany: jest.fn<(args: Prisma.TradingAccountUpdateManyArgs) => Promise<Prisma.BatchPayload>>() } };
  beforeEach(async () => {
    db.tradingAccount.update.mockReset().mockResolvedValue(publicAccountRow()); db.tradingAccount.updateMany.mockReset().mockResolvedValue({ count: 1 });
    module = await Test.createTestingModule({ providers: [ExchangeAccountRepository, { provide: PrismaService, useValue: db }] }).compile();
  });
  afterEach(async () => { await module.close(); });
  function repository() { return module.get<ExchangeAccountRepository>(ExchangeAccountRepository); }
  it('binds health mutation to the tenant before writing, not only after mutation', async () => {
    await repository().updateHealth(ACCOUNT, TENANT, { lastVerifiedAt: new Date() });
    expect(db.tradingAccount.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ACCOUNT, tenantId: TENANT, deletedAt: null } }));
  });
  it('increments failure count atomically using native update syntax', async () => {
    await expect(repository().recordConnectivityFailure(ACCOUNT, TENANT, 'AUTH_FAILED')).resolves.toBe(true);
    expect(db.tradingAccount.updateMany).toHaveBeenCalledWith({ where: { id: ACCOUNT, tenantId: TENANT, deletedAt: null },
      data: { consecutiveFailures: { increment: 1 }, lastFailureCode: 'AUTH_FAILED', lastFailureAt: expect.any(Date) } });
  });
  it('propagates counter-write failure instead of pretending to have recorded it', async () => {
    const failure = new Error('counter unavailable'); db.tradingAccount.updateMany.mockRejectedValueOnce(failure);
    await expect(repository().recordConnectivityFailure(ACCOUNT, TENANT, 'AUTH_FAILED')).rejects.toBe(failure);
  });
  it('does not map credential verification time into a nonexistent durable lastSyncAt column', async () => {
    const record = await repository().updateHealth(ACCOUNT, TENANT, { lastVerifiedAt: new Date() });
    expect(record?.lastSyncAt).toBeNull();
  });
});


type CredentialRow = Pick<TradingAccount, 'credentialSource' | 'credentialRef' | 'apiKeyLastFour' | 'apiKeyCiphertext' | 'apiSecretCiphertext' | 'passphraseCiphertext'>;
function envelopeRecord(): SealedPayload {
  return { ciphertext: 'unit-ciphertext', iv: 'unit-iv', authTag: 'unit-tag', wrappedKey: 'unit-wrapped-key', keyId: 'unit-key-id', algorithm: 'aes-256-gcm', version: 1 };
}
function credentialRow(): CredentialRow {
  return { credentialSource: 'ENVELOPE_DB', credentialRef: null, apiKeyLastFour: '1234', apiKeyCiphertext: JSON.stringify(envelopeRecord()),
    apiSecretCiphertext: JSON.stringify(envelopeRecord()), passphraseCiphertext: null };
}
describe('Native exchange credential mutations and envelope shape', () => {
  let module: TestingModule;
  const db = { tradingAccount: { findFirst: jest.fn<(args: Prisma.TradingAccountFindFirstArgs) => Promise<CredentialRow | null>>(),
    update: jest.fn<(args: Prisma.TradingAccountUpdateArgs) => Promise<CredentialRow>>() } };
  const crypto = { encrypt: jest.fn<CryptoService['encrypt']>(), decrypt: jest.fn<CryptoService['decrypt']>(), blindIndex: jest.fn<CryptoService['blindIndex']>() };
  const input = { ...INPUT, userId: 'user-1', apiKey: 'unit-only-key-1234', apiSecret: 'unit-only-credential-1234', credentialSource: 'ENVELOPE_DB' as const };
  beforeEach(async () => {
    db.tradingAccount.findFirst.mockReset().mockResolvedValue(credentialRow()); db.tradingAccount.update.mockReset().mockResolvedValue(credentialRow());
    crypto.encrypt.mockReset().mockReturnValue(envelopeRecord()); crypto.decrypt.mockReset().mockReturnValue('unit-decrypted'); crypto.blindIndex.mockReset().mockReturnValue('unit-index');
    module = await Test.createTestingModule({ providers: [ExchangeCredentialService, { provide: PrismaService, useValue: db },
      { provide: CryptoService, useValue: crypto }, { provide: AppConfigService, useValue: { isProduction: false } },
    ] }).compile();
  });
  afterEach(async () => { await module.close(); });
  function service() { return module.get<ExchangeCredentialService>(ExchangeCredentialService); }
  it('uses actual envelope key metadata and a tenant/nondeleted conditional mutation', async () => {
    const result = await service().createCredentialReference(input);
    expect(db.tradingAccount.update).toHaveBeenCalledWith({ where: { id: ACCOUNT, tenantId: TENANT, deletedAt: null }, data: expect.objectContaining({
      encryptedDataKey: 'unit-wrapped-key', encryptionKeyId: 'unit-key-id', credentialSource: 'ENVELOPE_DB' }) });
    expect(result).not.toHaveProperty('apiSecret'); expect(result).not.toHaveProperty('apiKeyCiphertext');
    expect(crypto.encrypt).toHaveBeenCalledWith(input.apiSecret, `trading_account:${TENANT}:${ACCOUNT}`);
  });
  it('does not invent envelope/active metadata after an invalid crypto envelope result', async () => {
    crypto.encrypt.mockReturnValueOnce({ ...envelopeRecord(), wrappedKey: '' });
    await expect(service().createCredentialReference(input)).rejects.toThrow('Failed to encrypt'); expect(db.tradingAccount.update).not.toHaveBeenCalled();
  });
  it('does not return a credential reference after its required native mutation fails', async () => {
    db.tradingAccount.update.mockRejectedValueOnce(new Error('CANARY-store-message'));
    await expect(service().createCredentialReference(input)).rejects.toThrow('Failed to persist credential reference');
  });
  it('does not decrypt arbitrary parsed JSON as though it were a typed v1 encryption envelope', async () => {
    db.tradingAccount.findFirst.mockResolvedValueOnce({ ...credentialRow(), apiKeyCiphertext: '{"unknown":"CANARY"}' });
    await expect(service().getDecryptedCredentialsForProvider(TENANT, ACCOUNT, ExchangeVenue.BINANCE, ExchangeEnvironment.LIVE)).rejects.toThrow('Failed to decrypt credentials');
    expect(crypto.decrypt).not.toHaveBeenCalled();
  });
  it('binds revocation to the tenant and does not acknowledge a failed native revocation', async () => {
    db.tradingAccount.update.mockRejectedValueOnce(new Error('revocation store unavailable'));
    await expect(service().revokeCredential(TENANT, ACCOUNT, ExchangeVenue.BINANCE, ExchangeEnvironment.LIVE)).rejects.toThrow('Failed to revoke credential');
    expect(db.tradingAccount.update).toHaveBeenCalledWith({ where: { id: ACCOUNT, tenantId: TENANT, deletedAt: null }, data: expect.objectContaining({ status: 'DISABLED', apiKeyCiphertext: null }) });
  });
});

function safeReference(): ExchangeSafeReference {
  const now = new Date().toISOString();
  return { accountId: ACCOUNT, tenantId: TENANT, userId: 'user-1', venue: ExchangeVenue.BINANCE, environment: ExchangeEnvironment.LIVE,
    label: 'Unit account', maskedApiKey: '****1234', status: ExchangeAccountState.ACTIVE, connectionState: ExchangeConnectionState.CONNECTED,
    healthState: ExchangeHealthState.DEGRADED, capabilities: [], isSandbox: false, liveTradingEnabled: false, credentialRef: 'unit-reference',
    credentialSource: 'SECRET_MANAGER', lastVerifiedAt: now, lastSyncAt: null, lastErrorCode: null, createdAt: now, updatedAt: now };
}
describe('Exchange controller principal, request identity and honest unavailable operations', () => {
  let module: TestingModule;
  const actor: AuthenticatedActor = { userId: 'user-1', tenantId: TENANT, sessionId: 'session-1', roles: ['FOLLOWER'], permissions: [Permission.EXCHANGE_ACCOUNT_READ], isPlatformUser: false, tokenId: 'unit-token' };
  const accounts = { getAccount: jest.fn<ExchangeAccountService['getAccount']>(), connectAccount: jest.fn<ExchangeAccountService['connectAccount']>(),
    rotateCredentials: jest.fn<ExchangeAccountService['rotateCredentials']>(), listAccounts: jest.fn<ExchangeAccountService['listAccounts']>() };
  const rates = { getRateLimitState: jest.fn<ExchangeRateLimitService['getRateLimitState']>() };
  const health = { listHealthByTenant: jest.fn<ExchangeHealthService['listHealthByTenant']>() };
  beforeEach(async () => {
    accounts.getAccount.mockReset().mockResolvedValue(safeReference()); accounts.connectAccount.mockReset().mockResolvedValue(safeReference());
    accounts.rotateCredentials.mockReset(); accounts.listAccounts.mockReset().mockResolvedValue({ data: [], total: 0 }); rates.getRateLimitState.mockReset();
    health.listHealthByTenant.mockReset().mockResolvedValue([]);
    module = await Test.createTestingModule({ controllers: [ExchangesController], providers: [
      { provide: ExchangeAccountService, useValue: accounts },
      { provide: ExchangeConnectivityService, useValue: {} },
      { provide: ExchangeBalanceSyncService, useValue: {} },
      { provide: ExchangePositionSyncService, useValue: {} },
      { provide: ExchangeOrderSyncService, useValue: {} },
      { provide: ExchangeHealthService, useValue: health },
      { provide: ExchangeRateLimitService, useValue: rates },
      { provide: ExchangeSymbolService, useValue: {} },
      { provide: ExchangeRoutingService, useValue: {} },
      { provide: ExchangeRegistryService, useValue: {} },
      { provide: ExchangeProviderFactory, useValue: {} },
    ] }).compile();
  });
  afterEach(async () => { await module.close(); });
  function controller() { return module.get<ExchangesController>(ExchangesController); }
  it('keeps a nonprivileged account lookup scoped to the authenticated userId', async () => {
    await controller().getAccount(ACCOUNT, TENANT, actor); expect(accounts.getAccount).toHaveBeenCalledWith(TENANT, ACCOUNT, actor.userId);
  });
  it('does not broaden a caller-selected user filter into tenant-wide account authority', async () => {
    await controller().listAccounts({ userId: 'another-user' }, TENANT, actor);
    expect(accounts.listAccounts).toHaveBeenCalledWith(TENANT, expect.anything(), actor.userId, false);
  });
  it('does not claim a label update succeeded when no durable update adapter exists', async () => {
    await expect(controller().updateAccount(ACCOUNT, { label: 'New label' }, TENANT, actor)).rejects.toThrow(ServiceUnavailableException);
  });
  it('does not claim regular enablement from simply returning an unchanged account', async () => {
    await expect(controller().enableAccount(ACCOUNT, {}, TENANT, actor, { requestId: 'bound-request' })).rejects.toThrow(ServiceUnavailableException);
  });
  it('uses middleware-bound requestId and actor userId, not arbitrary id aliases or raw headers', async () => {
    const request = { requestId: 'bound-request', headers: { 'x-request-id': 'untrusted-header' } };
    const caller = { ...actor, id: 'untrusted-id-alias' };
    await controller().connectAccount({ venue: ExchangeVenue.BINANCE, environment: ExchangeEnvironment.LIVE, label: 'Unit', apiKey: 'unit-key', apiSecret: 'unit-credential' }, TENANT, caller, request);
    expect(accounts.connectAccount).toHaveBeenCalledWith(expect.objectContaining({ userId: actor.userId, actorId: actor.userId, requestId: 'bound-request' }));
  });
  it('does not rotate a credential outside the resolved owner scope', async () => {
    accounts.getAccount.mockResolvedValueOnce(null);
    await expect(controller().rotateCredentials(ACCOUNT, { apiKey: 'unit-key', apiSecret: 'unit-credential' }, TENANT, actor, { requestId: 'bound-request' })).rejects.toThrow(NotFoundException);
    expect(accounts.rotateCredentials).not.toHaveBeenCalled();
  });
  it('does not accept a query environment that selects a different limiter bucket from the account binding', async () => {
    await expect(controller().getRateLimits(ACCOUNT, 'BINANCE', 'TESTNET', 'PRIVATE', TENANT, actor)).rejects.toThrow('Rate-limit query must match');
    expect(rates.getRateLimitState).not.toHaveBeenCalled();
  });
  it('keeps the tenant-health list owner-filtered for a nonprivileged authenticated caller', async () => {
    await controller().listHealth(TENANT, actor); expect(health.listHealthByTenant).toHaveBeenCalledWith(TENANT, actor.userId);
  });
});


describe('Exchange metadata safe boundary', () => {
  it('removes raw secret keys recursively inside metadata arrays without losing measured zero', () => {
    expect(sanitizeExchangeMetadata({ items: [{ apiSecret: 'CANARY', nested: { privateKey: 'CANARY', latency: 0 } }], note: 'safe' })).toEqual({ items: [{ nested: { latency: 0 } }], note: 'safe' });
  });
  it('does not accept circular metadata as sanitized safe evidence', () => {
    const input: Record<string, unknown> = {}; input.nested = input;
    expect(() => sanitizeExchangeMetadata(input)).toThrow('Circular exchange metadata');
  });
});


describe('Binance adapter runtime payload evidence (mocked fetch only)', () => {
  let module: TestingModule; let originalFetch: typeof fetch;
  const transport = jest.fn<typeof fetch>();
  const context: ExchangeProviderContext = { ...INPUT, isSandbox: false, credentials: { apiKey: 'unit-http-key', apiSecret: 'unit-http-credential',
    environment: ExchangeEnvironment.LIVE, isSandbox: false }, credentialRef: null };
  beforeEach(async () => {
    originalFetch = globalThis.fetch; transport.mockReset(); globalThis.fetch = transport;
    module = await Test.createTestingModule({ providers: [ExchangeProviderFactory, ExchangeRegistryService] }).compile();
    module.get<ExchangeProviderFactory>(ExchangeProviderFactory).onModuleInit();
  });
  afterEach(async () => { globalThis.fetch = originalFetch; await module.close(); });
  function provider() { return module.get<ExchangeProviderFactory>(ExchangeProviderFactory).getProvider(ExchangeVenue.BINANCE, ExchangeEnvironment.LIVE); }
  function respond(body: unknown, status = 200) { transport.mockResolvedValueOnce(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })); }
  it('keeps balance precision beyond safe floating-point integers with exact string addition', async () => {
    respond({ balances: [{ asset: 'BTC', free: '9007199254740993.000000000001', locked: '0' }] });
    expect(await provider().getBalances(context)).toEqual([expect.objectContaining({ free: '9007199254740993.000000000001', total: '9007199254740993.000000000001' })]);
  });
  it('does not report a malformed account balance payload as a measured empty wallet', async () => {
    respond({ balances: { unknown: 'not-array' } }); await expect(provider().getBalances(context)).rejects.toBeInstanceOf(ExchangeProviderError);
  });
  it('does not silently drop an unreadable balance into a supposedly complete list', async () => {
    respond({ balances: [{ asset: 'BTC', free: 'unknown', locked: '0' }] }); await expect(provider().getBalances(context)).rejects.toBeInstanceOf(ExchangeProviderError);
  });
  it('does not call an unauthorized futures account flat', async () => {
    respond({ code: -2015, msg: 'unit-denied' }, 403);
    await expect(provider().getPositions(context)).rejects.toMatchObject({ code: ExchangeProviderErrorCode.AUTH_FAILED });
  });
  it('does not treat a non-array order-history body as zero historical orders', async () => {
    respond({ unknown: 'not-array' }); await expect(provider().getOrderHistory(context)).rejects.toBeInstanceOf(ExchangeProviderError);
  });
  it('does not invent a venue fill timestamp when the raw receipt is missing time', async () => {
    respond([{ id: 1, orderId: 2, symbol: 'BTCUSDT', isBuyer: true, price: '1', qty: '1', quoteQty: '1', commission: '0', commissionAsset: 'USDT', isMaker: false }]);
    await expect(provider().getTradeHistory(context)).rejects.toBeInstanceOf(ExchangeProviderError);
  });
  it('preserves explicitly observed zero symbol precision instead of replacing it with eight', async () => {
    respond({ symbols: [{ status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDT', symbol: 'BTCUSDT', quotePrecision: 0, baseAssetPrecision: 0,
      filters: [{ filterType: 'LOT_SIZE', stepSize: '1' }, { filterType: 'PRICE_FILTER', tickSize: '1' }] }] });
    expect(await provider().getSymbols(context)).toEqual([expect.objectContaining({ pricePrecision: 0, quantityPrecision: 0, tickSize: '1', quantityStep: '1' })]);
  });
  it('does not synthesize default tick/quantity constraints when a required venue filter is absent', async () => {
    respond({ symbols: [{ status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDT', symbol: 'BTCUSDT', quotePrecision: 8, baseAssetPrecision: 8, filters: [] }] });
    await expect(provider().getSymbols(context)).rejects.toBeInstanceOf(ExchangeProviderError);
  });
  it('does not map a new unknown external order status into an invented NEW order', async () => {
    respond([{ symbol: 'BTCUSDT', status: 'UNKNOWN_EXTERNAL_STATUS', type: 'MARKET', clientOrderId: 'unit-client', orderId: 1, side: 'BUY', origQty: '1', executedQty: '0', price: '0' }]);
    await expect(provider().getOpenOrders(context)).rejects.toBeInstanceOf(ExchangeProviderError);
  });
});
