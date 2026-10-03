/**
 * Connectivity checks name the real secret-manager failure.
 *
 * Every PROVIDER_UNAVAILABLE failure from a SECRET_MANAGER credential used to
 * be reported as "Secret manager vault not configured or fetch not
 * implemented", although the Vault and AWS stores are implemented. A store
 * that was only down (HTTP 503) therefore told the operator to reconfigure it.
 * The degraded, never-fake-success behaviour is unchanged; only the reason is
 * now the actual cause. These tests run the real ExchangeCredentialService.
 */
import { ExchangeConnectivityService } from './exchange-connectivity.service';
import { ExchangeCredentialService } from './exchange-credential.service';
import { ExchangeProviderErrorCode } from './exchange-provider.interface';
import { SecretStore, SecretStoreError } from './secret-store';
import { ExchangeConnectionState, ExchangeEnvironment, ExchangeVenue } from './exchange.types';

const TENANT = '11111111-1111-1111-1111-111111111111';
const ACCOUNT = '22222222-2222-2222-2222-222222222222';

const SECRET_ENV_KEYS = [
  'SECRET_MANAGER_PROVIDER',
  'VAULT_ADDR',
  'VAULT_TOKEN',
  'VAULT_TOKEN_FILE',
  'AWS_SECRETS_MANAGER_ENABLED',
] as const;

function storeThatFails(error: unknown): SecretStore {
  return {
    kind: 'vault-kv2',
    referenceFor: () => 'vault:secret/wlct/t/a/binance',
    write: async () => undefined,
    read: async () => {
      throw error;
    },
    exists: async () => false,
    destroy: async () => undefined,
  };
}

function build(store: SecretStore | null) {
  const prisma = {
    tradingAccount: {
      findFirst: jest.fn(async () => ({
        apiKeyCiphertext: null,
        apiSecretCiphertext: null,
        passphraseCiphertext: null,
        credentialSource: 'SECRET_MANAGER',
        credentialRef: 'vault:secret/wlct/t/a/binance',
      })),
    },
  };
  const credentials = new ExchangeCredentialService(prisma as any, {} as any, {} as any, store);
  const providerFactory = {
    validateEnvironmentBinding: jest.fn(),
    getProvider: jest.fn(() => ({})),
  };
  const service = new ExchangeConnectivityService(
    providerFactory as any,
    {} as any,
    credentials,
    {} as any,
    {} as any,
  );
  return { service };
}

const check = (service: ExchangeConnectivityService) =>
  service.checkConnectivity({
    tenantId: TENANT,
    accountId: ACCOUNT,
    venue: ExchangeVenue.BINANCE,
    environment: ExchangeEnvironment.TESTNET,
  });

describe('ExchangeConnectivityService - secret manager failure reasons', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of SECRET_ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of SECRET_ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('reports a store outage as unavailable with its HTTP status, not as unimplemented', async () => {
    const { service } = build(
      storeThatFails(
        new SecretStoreError('UNAVAILABLE', 'read: secret manager unavailable (HTTP 503)', true),
      ),
    );

    const result = await check(service);

    expect(result.connected).toBe(false);
    expect(result.degraded).toBe(true);
    expect(result.state).toBe(ExchangeConnectionState.FAILED);
    expect(result.failureCode).toBe(ExchangeProviderErrorCode.PROVIDER_UNAVAILABLE);
    expect(result.failureReason).toMatch(/^Secret manager unavailable: /);
    expect(result.failureReason).toContain('HTTP 503');
    expect(result.failureReason).not.toMatch(/not implemented/i);
  });

  it('reports a store that is not configured at all as not configured', async () => {
    const { service } = build(null);

    const result = await check(service);

    expect(result.connected).toBe(false);
    expect(result.degraded).toBe(true);
    expect(result.failureCode).toBe(ExchangeProviderErrorCode.PROVIDER_UNAVAILABLE);
    expect(result.failureReason).toMatch(/^Secret manager unavailable: /);
    expect(result.failureReason).toContain('is not configured');
    expect(result.failureReason).not.toMatch(/not implemented/i);
  });

  it('reports a Vault selection without a token as misconfigured', async () => {
    process.env.SECRET_MANAGER_PROVIDER = 'vault';
    process.env.VAULT_ADDR = 'https://vault.example.internal';
    const { service } = build(null);

    const result = await check(service);

    expect(result.degraded).toBe(true);
    expect(result.failureCode).toBe(ExchangeProviderErrorCode.PROVIDER_UNAVAILABLE);
    expect(result.failureReason).toContain('SECRET_MANAGER misconfigured');
    expect(result.failureReason).toContain('VAULT_TOKEN');
  });

  it('keeps a missing secret on the AUTH_FAILED path, not the degraded one', async () => {
    const { service } = build(
      storeThatFails(new SecretStoreError('NOT_FOUND', 'read: secret not found')),
    );

    const result = await check(service);

    expect(result.connected).toBe(false);
    expect(result.degraded).toBe(false);
    expect(result.failureCode).toBe(ExchangeProviderErrorCode.AUTH_FAILED);
    expect(result.failureReason).toContain('secret not found');
  });

  it('never copies an unexpected error message into the reason', async () => {
    const { service } = build(
      storeThatFails(new TypeError('socket closed; token=hvs.CANARY-do-not-leak')),
    );

    const result = await check(service);

    expect(result.degraded).toBe(true);
    expect(result.failureReason).toContain('TypeError');
    expect(result.failureReason).not.toContain('CANARY');
    expect(result.failureReason).not.toContain('hvs.');
  });
});
