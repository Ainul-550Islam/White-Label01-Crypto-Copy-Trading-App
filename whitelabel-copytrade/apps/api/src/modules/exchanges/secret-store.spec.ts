/**
 * Phase 3: SECRET_MANAGER credential source.
 *
 * The SigV4 expectations below were produced by botocore's own SigV4Auth for
 * the identical request (fixed clock 2026-09-28T12:00:00Z), so they pin this
 * file's signer against AWS's reference implementation, not against itself.
 */

import {
  AwsSecretsManagerStore,
  SecretStoreError,
  VaultKv2SecretStore,
  createSecretStoreFromEnv,
  signAwsRequest,
  type SecretStore,
  type StoredExchangeSecret,
} from './secret-store';
import { ExchangeCredentialService } from './exchange-credential.service';
import { ExchangeEnvironment, ExchangeVenue } from './exchange.types';
import { ExchangeProviderError, ExchangeProviderErrorCode } from './exchange-provider.interface';

const SECRET: StoredExchangeSecret = {
  apiKey: 'AKEY-12345678',
  apiSecret: 'SECRET-abcdefgh',
  environment: 'LIVE',
  venue: 'BINANCE',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('signAwsRequest (SigV4) matches botocore', () => {
  const base = {
    method: 'POST',
    host: 'secretsmanager.us-east-1.amazonaws.com',
    path: '/',
    region: 'us-east-1',
    service: 'secretsmanager',
    headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'secretsmanager.GetSecretValue' },
    body: '{"SecretId":"wlct/t/a/binance/live"}',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    now: new Date('2026-09-28T12:00:00.000Z'),
  };

  it('without a session token', () => {
    const headers = signAwsRequest(base);
    expect(headers['x-amz-date']).toBe('20260928T120000Z');
    expect(headers.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20260928/us-east-1/secretsmanager/aws4_request, ' +
        'SignedHeaders=content-type;host;x-amz-date;x-amz-target, ' +
        'Signature=896a1ea5b705d036770b939342b58bbde9bdd2302f5ed54981c5a179c5ea5af9',
    );
  });

  it('with a session token (signed header included)', () => {
    const headers = signAwsRequest({ ...base, sessionToken: 'session-token-example' });
    expect(headers['x-amz-security-token']).toBe('session-token-example');
    expect(headers.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20260928/us-east-1/secretsmanager/aws4_request, ' +
        'SignedHeaders=content-type;host;x-amz-date;x-amz-security-token;x-amz-target, ' +
        'Signature=a3e31fe450fa62029bbf03a0de0f53727b47cb8b706019c027d34f48b1f22561',
    );
  });
});

describe('VaultKv2SecretStore', () => {
  function vault(fetchImpl: jest.Mock) {
    return new VaultKv2SecretStore({ address: 'https://vault.test:8200/', token: 'hvs.test-token', namespace: 'ns1', fetchImpl });
  }

  it('builds references on the execution engine template', () => {
    const store = vault(jest.fn());
    expect(store.referenceFor({ tenantId: 't-1', accountId: 'a-1', venue: 'BINANCE', environment: 'LIVE' })).toBe('secret/data/wlct/t-1/a-1/binance');
  });

  it('writes the engine-readable field names under data/ with token and namespace headers', async () => {
    const fetchImpl = jest.fn(async () => json({ data: { version: 1 } }));
    await vault(fetchImpl).write('secret/data/wlct/t-1/a-1/binance', SECRET);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://vault.test:8200/v1/secret/data/wlct/t-1/a-1/binance');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Vault-Token']).toBe('hvs.test-token');
    expect((init.headers as Record<string, string>)['X-Vault-Namespace']).toBe('ns1');
    expect(JSON.parse(String(init.body))).toEqual({
      data: { api_key: 'AKEY-12345678', api_secret: 'SECRET-abcdefgh', environment: 'LIVE', venue: 'BINANCE' },
    });
  });

  it('reads data.data and accepts camelCase fields too', async () => {
    const fetchImpl = jest.fn(async () => json({ data: { data: { apiKey: 'k-12345678', apiSecret: 's-12345678', environment: 'TESTNET', venue: 'BYBIT' } } }));
    await expect(vault(fetchImpl).read('wlct/t/a/bybit')).resolves.toEqual({ apiKey: 'k-12345678', apiSecret: 's-12345678', environment: 'TESTNET', venue: 'BYBIT' });
  });

  it('maps statuses: 404 NOT_FOUND, 403 DENIED, 503 retryable UNAVAILABLE; metadata 404 = not exists', async () => {
    await expect(vault(jest.fn(async () => json({}, 404))).read('wlct/x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(vault(jest.fn(async () => json({}, 403))).read('wlct/x')).rejects.toMatchObject({ code: 'DENIED' });
    await expect(vault(jest.fn(async () => json({}, 503))).read('wlct/x')).rejects.toMatchObject({ code: 'UNAVAILABLE', retryable: true });
    await expect(vault(jest.fn(async () => json({}, 404))).exists('wlct/x')).resolves.toBe(false);
    await expect(vault(jest.fn(async () => json({ data: {} }))).exists('wlct/x')).resolves.toBe(true);
  });

  it('refuses path traversal and malformed payloads', async () => {
    await expect(vault(jest.fn()).read('secret/data/../sys/raw')).rejects.toMatchObject({ code: 'BAD_REFERENCE' });
    await expect(vault(jest.fn(async () => json({ data: { data: { api_key: 'only-key' } } }))).read('wlct/x')).rejects.toMatchObject({ code: 'MALFORMED' });
  });

  it('a transport failure is retryable UNAVAILABLE and never leaks the token', async () => {
    const error = await vault(jest.fn(async () => { throw new TypeError('fetch failed'); })).read('wlct/x').catch((e) => e);
    expect(error).toBeInstanceOf(SecretStoreError);
    expect(error.retryable).toBe(true);
    expect(String(error.message)).not.toContain('hvs.test-token');
  });
});

describe('AwsSecretsManagerStore', () => {
  function aws(fetchImpl: jest.Mock) {
    return new AwsSecretsManagerStore({
      region: 'us-east-1',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      fetchImpl,
      now: () => new Date('2026-09-28T12:00:00.000Z'),
    });
  }

  it('creates the secret when PutSecretValue reports it missing', async () => {
    const fetchImpl = jest
      .fn()
      .mockImplementationOnce(async () => json({ __type: 'com.amazonaws.secretsmanager#ResourceNotFoundException' }, 400))
      .mockImplementationOnce(async () => json({ ARN: 'arn:aws:secretsmanager:us-east-1:1:secret:x' }));
    const store = aws(fetchImpl);
    const ref = store.referenceFor({ tenantId: 't', accountId: 'a', venue: 'BINANCE', environment: 'LIVE' });
    expect(ref).toBe('aws-sm:wlct/t/a/binance/live');
    await store.write(ref, SECRET);
    const targets = fetchImpl.mock.calls.map((call) => ((call[1] as RequestInit).headers as Record<string, string>)['x-amz-target']);
    expect(targets).toEqual(['secretsmanager.PutSecretValue', 'secretsmanager.CreateSecret']);
    const created = JSON.parse(String((fetchImpl.mock.calls[1][1] as RequestInit).body));
    expect(created.Name).toBe('wlct/t/a/binance/live');
    expect(JSON.parse(created.SecretString)).toMatchObject({ api_key: 'AKEY-12345678', environment: 'LIVE' });
    expect(((fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<string, string>).Authorization).toMatch(/^AWS4-HMAC-SHA256 /);
  });

  it('reads SecretString JSON; missing is NOT_FOUND; denied is DENIED', async () => {
    const ok = aws(jest.fn(async () => json({ SecretString: JSON.stringify({ api_key: 'k-12345678', api_secret: 's-12345678', environment: 'LIVE', venue: 'OKX', passphrase: 'pp' }) })));
    await expect(ok.read('aws-sm:wlct/t/a/okx/live')).resolves.toMatchObject({ passphrase: 'pp', venue: 'OKX' });
    const missing = aws(jest.fn(async () => json({ __type: 'ResourceNotFoundException' }, 400)));
    await expect(missing.read('aws-sm:wlct/x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(missing.exists('aws-sm:wlct/x')).resolves.toBe(false);
    const denied = aws(jest.fn(async () => json({ __type: 'AccessDeniedException' }, 400)));
    await expect(denied.read('aws-sm:wlct/x')).rejects.toMatchObject({ code: 'DENIED' });
  });

  it('refuses references without the aws-sm: scheme and construction without keys', async () => {
    await expect(aws(jest.fn()).read('secret/data/x')).rejects.toMatchObject({ code: 'BAD_REFERENCE' });
    expect(() => new AwsSecretsManagerStore({ region: 'us-east-1', accessKeyId: '', secretAccessKey: '' })).toThrow(SecretStoreError);
  });
});

describe('createSecretStoreFromEnv', () => {
  it('returns null when nothing is configured', () => {
    expect(createSecretStoreFromEnv({})).toBeNull();
  });
  it('selects Vault from VAULT_ADDR and refuses a Vault without a token', () => {
    expect(createSecretStoreFromEnv({ VAULT_ADDR: 'https://v:8200', VAULT_TOKEN: 'hvs.12345678' })?.kind).toBe('vault-kv2');
    expect(() => createSecretStoreFromEnv({ VAULT_ADDR: 'https://v:8200' })).toThrow(/VAULT_TOKEN/);
  });
  it('selects AWS explicitly or via AWS_SECRETS_MANAGER_ENABLED', () => {
    const env = { AWS_SECRETS_MANAGER_ENABLED: 'true', AWS_REGION: 'eu-west-1', AWS_ACCESS_KEY_ID: 'AKID', AWS_SECRET_ACCESS_KEY: 'secret' };
    expect(createSecretStoreFromEnv(env)?.kind).toBe('aws-secrets-manager');
    expect(createSecretStoreFromEnv({ ...env, AWS_SECRETS_MANAGER_ENABLED: undefined, SECRET_MANAGER_PROVIDER: 'aws' })?.kind).toBe('aws-secrets-manager');
    expect(() => createSecretStoreFromEnv({ SECRET_MANAGER_PROVIDER: 'gcp' })).toThrow(/Unknown/);
  });
});

class MemoryStore implements SecretStore {
  public readonly kind = 'vault-kv2' as const;
  public readonly secrets = new Map<string, StoredExchangeSecret>();
  public failWrites = false;
  referenceFor(p: { tenantId: string; accountId: string; venue: string }): string {
    return `secret/data/wlct/${p.tenantId}/${p.accountId}/${p.venue.toLowerCase()}`;
  }
  async write(ref: string, secret: StoredExchangeSecret): Promise<void> {
    if (this.failWrites) throw new SecretStoreError('UNAVAILABLE', 'Vault write: unavailable', true);
    this.secrets.set(ref, secret);
  }
  async read(ref: string): Promise<StoredExchangeSecret> {
    const secret = this.secrets.get(ref);
    if (!secret) throw new SecretStoreError('NOT_FOUND', 'Vault read: secret not found');
    return secret;
  }
  async exists(ref: string): Promise<boolean> {
    return this.secrets.has(ref);
  }
  async destroy(ref: string): Promise<void> {
    this.secrets.delete(ref);
  }
}

function credentialService(store: SecretStore | null) {
  const accounts = new Map<string, Record<string, unknown>>();
  const prisma = {
    tradingAccount: {
      update: jest.fn(async ({ where, data }: any) => {
        const next = { ...(accounts.get(where.id) ?? { id: where.id, tenantId: 't-1' }), ...data };
        accounts.set(where.id, next);
        return next;
      }),
      findFirst: jest.fn(async ({ where }: any) => accounts.get(where.id) ?? null),
    },
  };
  const crypto = { blindIndex: (v: string) => `bi_${v.length}`, encrypt: jest.fn(), decrypt: jest.fn() };
  const service = new ExchangeCredentialService(prisma as any, crypto as any, {} as any, store);
  return { service, accounts, prisma };
}

describe('ExchangeCredentialService SECRET_MANAGER path', () => {
  const input = {
    tenantId: 't-1',
    userId: null,
    accountId: 'a-1',
    venue: ExchangeVenue.BINANCE,
    environment: ExchangeEnvironment.LIVE,
    apiKey: 'AKEY-12345678',
    apiSecret: 'SECRET-abcdefgh',
    credentialSource: 'SECRET_MANAGER' as const,
  };

  it('writes the secret to the store, persists only the reference, and reads it back', async () => {
    const store = new MemoryStore();
    const { service, accounts } = credentialService(store);
    const ref = await service.createCredentialReference(input);
    expect(ref.credentialRef).toBe('secret/data/wlct/t-1/a-1/binance');
    expect(store.secrets.get(ref.credentialRef as string)).toMatchObject({ apiKey: 'AKEY-12345678', environment: 'LIVE' });
    const row = accounts.get('a-1') as Record<string, unknown>;
    expect(row.apiKeyCiphertext).toBeNull();
    expect(row.apiSecretCiphertext).toBeNull();
    expect(JSON.stringify(row)).not.toContain('SECRET-abcdefgh');
    await expect(service.getDecryptedCredentialsForProvider('t-1', 'a-1', ExchangeVenue.BINANCE, ExchangeEnvironment.LIVE)).resolves.toEqual({
      apiKey: 'AKEY-12345678',
      apiSecret: 'SECRET-abcdefgh',
    });
    await expect(service.validateCredentialReference('t-1', 'a-1')).resolves.toMatchObject({ valid: true });
  });

  it('refuses a LIVE read of a secret bound to TESTNET', async () => {
    const store = new MemoryStore();
    const { service } = credentialService(store);
    await service.createCredentialReference({ ...input, environment: ExchangeEnvironment.TESTNET });
    const error = await service
      .getDecryptedCredentialsForProvider('t-1', 'a-1', ExchangeVenue.BINANCE, ExchangeEnvironment.LIVE)
      .catch((e) => e);
    expect(error).toBeInstanceOf(ExchangeProviderError);
    expect(error.code).toBe(ExchangeProviderErrorCode.ENVIRONMENT_MISMATCH);
  });

  it('a failed store write persists nothing and surfaces a retryable PROVIDER_UNAVAILABLE', async () => {
    const store = new MemoryStore();
    store.failWrites = true;
    const { service, prisma } = credentialService(store);
    const error = await service.createCredentialReference(input).catch((e) => e);
    expect(error.code).toBe(ExchangeProviderErrorCode.PROVIDER_UNAVAILABLE);
    expect(error.isRetryable).toBe(true);
    expect(prisma.tradingAccount.update).not.toHaveBeenCalled();
  });

  it('with no store configured the SECRET_MANAGER source is refused explicitly', async () => {
    const saved = { VAULT_ADDR: process.env.VAULT_ADDR, AWS: process.env.AWS_SECRETS_MANAGER_ENABLED, P: process.env.SECRET_MANAGER_PROVIDER };
    delete process.env.VAULT_ADDR;
    delete process.env.AWS_SECRETS_MANAGER_ENABLED;
    delete process.env.SECRET_MANAGER_PROVIDER;
    try {
      const { service } = credentialService(null);
      const error = await service.createCredentialReference(input).catch((e) => e);
      expect(error.code).toBe(ExchangeProviderErrorCode.PROVIDER_UNAVAILABLE);
      expect(String(error.message)).toContain('SECRET_MANAGER');
    } finally {
      if (saved.VAULT_ADDR !== undefined) process.env.VAULT_ADDR = saved.VAULT_ADDR;
      if (saved.AWS !== undefined) process.env.AWS_SECRETS_MANAGER_ENABLED = saved.AWS;
      if (saved.P !== undefined) process.env.SECRET_MANAGER_PROVIDER = saved.P;
    }
  });

  it('revoke destroys the stored secret and clears the reference', async () => {
    const store = new MemoryStore();
    const { service, accounts } = credentialService(store);
    const ref = await service.createCredentialReference(input);
    await service.revokeCredential('t-1', 'a-1', ExchangeVenue.BINANCE, ExchangeEnvironment.LIVE);
    expect(store.secrets.has(ref.credentialRef as string)).toBe(false);
    expect((accounts.get('a-1') as Record<string, unknown>).credentialRef).toBeNull();
  });
});
