/**
 * Phase 3 — the SECRET_MANAGER credential source, implemented.
 *
 * Before this file, `credentialSource = SECRET_MANAGER` stored a reference and
 * then threw "fetch not implemented" on every read. Two backends are provided,
 * both over plain `fetch` (the API ships no vendor SDK):
 *
 *  - HashiCorp Vault KV v2 (`VAULT_ADDR`, `VAULT_TOKEN`/`VAULT_TOKEN_FILE`,
 *    optional `VAULT_NAMESPACE`, `SECRET_MANAGER_VAULT_MOUNT`). The default
 *    path template matches the execution engine's reader
 *    (EXECUTION_VAULT_PATH_TEMPLATE = "wlct/{tenant}/{account}/{exchange}") and
 *    the payload uses the field names that reader accepts (`api_key`,
 *    `api_secret`), so a credential written here is the credential the engine
 *    fetches.
 *  - AWS Secrets Manager (`AWS_REGION`, `AWS_ACCESS_KEY_ID`,
 *    `AWS_SECRET_ACCESS_KEY`, optional `AWS_SESSION_TOKEN`), signed with
 *    SigV4 in this file. Static/env credentials only: instance-profile / IRSA
 *    credential discovery is NOT implemented, and an AWS store without keys
 *    refuses to construct rather than guessing.
 *
 * Laws: secret material is never logged and never returned in an error; every
 * failure is an explicit error, never an empty credential; a store that is not
 * configured is `null` from the factory and the caller refuses the operation.
 */

import { createHash, createHmac } from 'crypto';
import { readFileSync } from 'fs';

export interface StoredExchangeSecret {
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
  /** Environment binding recorded WITH the secret, checked on every read. */
  environment: string;
  venue: string;
}

export interface SecretStore {
  readonly kind: 'vault-kv2' | 'aws-secrets-manager';
  /** The reference persisted on the trading account for this secret. */
  referenceFor(parts: { tenantId: string; accountId: string; venue: string; environment: string }): string;
  write(ref: string, secret: StoredExchangeSecret): Promise<void>;
  read(ref: string): Promise<StoredExchangeSecret>;
  exists(ref: string): Promise<boolean>;
  destroy(ref: string): Promise<void>;
}

export class SecretStoreError extends Error {
  public constructor(
    public readonly code: 'NOT_CONFIGURED' | 'NOT_FOUND' | 'UNAVAILABLE' | 'DENIED' | 'MALFORMED' | 'BAD_REFERENCE',
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'SecretStoreError';
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// One path segment: safe characters only, and never '.' or '..' (traversal).
const REF_SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,128}$/;

function fillTemplate(template: string, parts: { tenantId: string; accountId: string; venue: string; environment: string }): string {
  const values: Record<string, string> = {
    tenant: parts.tenantId,
    account: parts.accountId,
    exchange: parts.venue.toLowerCase(),
    venue: parts.venue.toLowerCase(),
    environment: parts.environment.toLowerCase(),
  };
  const filled = template.replace(/\{(tenant|account|exchange|venue|environment)\}/g, (_m, key: string) => values[key]);
  for (const segment of filled.split('/')) {
    if (!REF_SEGMENT.test(segment)) {
      throw new SecretStoreError('BAD_REFERENCE', 'Secret path contains an illegal segment');
    }
  }
  return filled;
}

function parseSecretPayload(data: unknown): StoredExchangeSecret {
  if (typeof data !== 'object' || data === null) throw new SecretStoreError('MALFORMED', 'Secret payload is not an object');
  const record = data as Record<string, unknown>;
  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.length > 0) return value;
    }
    return undefined;
  };
  const apiKey = pick('api_key', 'apiKey');
  const apiSecret = pick('api_secret', 'apiSecret');
  if (!apiKey || !apiSecret) throw new SecretStoreError('MALFORMED', 'Secret payload is missing the API key or secret');
  const passphrase = pick('passphrase');
  return {
    apiKey,
    apiSecret,
    ...(passphrase ? { passphrase } : {}),
    environment: pick('environment') ?? 'UNKNOWN',
    venue: pick('venue') ?? 'UNKNOWN',
  };
}

function serialisePayload(secret: StoredExchangeSecret): Record<string, string> {
  return {
    api_key: secret.apiKey,
    api_secret: secret.apiSecret,
    ...(secret.passphrase ? { passphrase: secret.passphrase } : {}),
    environment: secret.environment,
    venue: secret.venue,
  };
}

function classifyStatus(status: number, what: string): SecretStoreError {
  if (status === 404) return new SecretStoreError('NOT_FOUND', `${what}: secret not found`);
  if (status === 401 || status === 403) return new SecretStoreError('DENIED', `${what}: access denied by the secret manager`);
  if (status === 429 || status >= 500) return new SecretStoreError('UNAVAILABLE', `${what}: secret manager unavailable (HTTP ${status})`, true);
  return new SecretStoreError('UNAVAILABLE', `${what}: secret manager refused the request (HTTP ${status})`);
}

// ---------------------------------------------------------------------------
// Vault KV v2
// ---------------------------------------------------------------------------

export interface VaultKv2Options {
  address: string;
  token: string;
  mount?: string;
  namespace?: string | null;
  pathTemplate?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

export class VaultKv2SecretStore implements SecretStore {
  public readonly kind = 'vault-kv2' as const;
  private readonly address: string;
  private readonly mount: string;
  private readonly pathTemplate: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  public constructor(private readonly options: VaultKv2Options) {
    if (!/^https?:\/\//.test(options.address)) throw new SecretStoreError('NOT_CONFIGURED', 'VAULT_ADDR must be an http(s) URL');
    if (!options.token || options.token.length < 8) throw new SecretStoreError('NOT_CONFIGURED', 'Vault token is missing');
    this.address = options.address.replace(/\/+$/, '');
    this.mount = (options.mount ?? 'secret').replace(/^\/+|\/+$/g, '');
    if (!REF_SEGMENT.test(this.mount)) throw new SecretStoreError('NOT_CONFIGURED', 'Vault mount must be a single path segment');
    this.pathTemplate = options.pathTemplate ?? 'wlct/{tenant}/{account}/{exchange}';
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  public referenceFor(parts: { tenantId: string; accountId: string; venue: string; environment: string }): string {
    return `${this.mount}/data/${fillTemplate(this.pathTemplate, parts)}`;
  }

  /** Accepts `mount/data/path` (what referenceFor produces) or a bare `path`. */
  private relativePath(ref: string): string {
    const prefix = `${this.mount}/data/`;
    const path = ref.startsWith(prefix) ? ref.slice(prefix.length) : ref.replace(/^\/+/, '');
    const segments = path.split('/');
    if (segments.length === 0 || segments.some((segment) => !REF_SEGMENT.test(segment))) {
      throw new SecretStoreError('BAD_REFERENCE', 'Vault reference is not a valid KV v2 path');
    }
    return path;
  }

  private headers(): Record<string, string> {
    return {
      'X-Vault-Token': this.options.token,
      'Content-Type': 'application/json',
      ...(this.options.namespace ? { 'X-Vault-Namespace': this.options.namespace } : {}),
    };
  }

  private async request(method: string, url: string, body?: unknown): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        method,
        headers: this.headers(),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new SecretStoreError('UNAVAILABLE', `Vault request failed: ${(error as Error).name}`, true);
    }
  }

  public async write(ref: string, secret: StoredExchangeSecret): Promise<void> {
    const path = this.relativePath(ref);
    const response = await this.request('POST', `${this.address}/v1/${this.mount}/data/${path}`, { data: serialisePayload(secret) });
    if (!response.ok) throw classifyStatus(response.status, 'Vault write');
  }

  public async read(ref: string): Promise<StoredExchangeSecret> {
    const path = this.relativePath(ref);
    const response = await this.request('GET', `${this.address}/v1/${this.mount}/data/${path}`);
    if (!response.ok) throw classifyStatus(response.status, 'Vault read');
    const body = (await response.json().catch(() => null)) as { data?: { data?: unknown } } | null;
    return parseSecretPayload(body?.data?.data);
  }

  public async exists(ref: string): Promise<boolean> {
    const path = this.relativePath(ref);
    const response = await this.request('GET', `${this.address}/v1/${this.mount}/metadata/${path}`);
    if (response.status === 404) return false;
    if (!response.ok) throw classifyStatus(response.status, 'Vault metadata');
    return true;
  }

  public async destroy(ref: string): Promise<void> {
    const path = this.relativePath(ref);
    const response = await this.request('DELETE', `${this.address}/v1/${this.mount}/metadata/${path}`);
    if (!response.ok && response.status !== 404) throw classifyStatus(response.status, 'Vault destroy');
  }
}

// ---------------------------------------------------------------------------
// AWS Secrets Manager (SigV4 over fetch)
// ---------------------------------------------------------------------------

export interface AwsSecretsManagerOptions {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | null;
  namePrefix?: string;
  kmsKeyId?: string | null;
  endpoint?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

/** AWS Signature Version 4 for a JSON POST to a regional service endpoint.
 * Exported for the deterministic test vector in the spec. */
export function signAwsRequest(input: {
  method: string;
  host: string;
  path: string;
  region: string;
  service: string;
  headers: Record<string, string>;
  body: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | null;
  now: Date;
}): Record<string, string> {
  const amzDate = input.now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    ...input.headers,
    host: input.host,
    'x-amz-date': amzDate,
    ...(input.sessionToken ? { 'x-amz-security-token': input.sessionToken } : {}),
  };
  const lowered = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const signedHeaderNames = Object.keys(lowered).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${lowered[name]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const payloadHash = sha256Hex(input.body);
  const canonicalRequest = [input.method, input.path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${input.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  return {
    ...headers,
    Authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export class AwsSecretsManagerStore implements SecretStore {
  public readonly kind = 'aws-secrets-manager' as const;
  private readonly endpoint: string;
  private readonly host: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;

  public constructor(private readonly options: AwsSecretsManagerOptions) {
    if (!/^[a-z]{2}(-[a-z]+)+-\d$/.test(options.region)) throw new SecretStoreError('NOT_CONFIGURED', 'AWS_REGION is not a valid region');
    if (!options.accessKeyId || !options.secretAccessKey) {
      throw new SecretStoreError('NOT_CONFIGURED', 'AWS credentials are missing (instance-profile discovery is not implemented)');
    }
    this.endpoint = (options.endpoint ?? `https://secretsmanager.${options.region}.amazonaws.com`).replace(/\/+$/, '');
    this.host = new URL(this.endpoint).host;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? (() => new Date());
  }

  public referenceFor(parts: { tenantId: string; accountId: string; venue: string; environment: string }): string {
    const prefix = (this.options.namePrefix ?? 'wlct').replace(/^\/+|\/+$/g, '');
    return `aws-sm:${prefix}/${fillTemplate('{tenant}/{account}/{exchange}/{environment}', parts)}`;
  }

  private secretId(ref: string): string {
    if (!ref.startsWith('aws-sm:')) throw new SecretStoreError('BAD_REFERENCE', 'AWS Secrets Manager reference must start with aws-sm:');
    const id = ref.slice('aws-sm:'.length);
    if (!/^[A-Za-z0-9/_+=.@-]{1,512}$/.test(id)) throw new SecretStoreError('BAD_REFERENCE', 'AWS secret id contains illegal characters');
    return id;
  }

  private async call(target: string, payload: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
    const body = JSON.stringify(payload);
    const headers = signAwsRequest({
      method: 'POST',
      host: this.host,
      path: '/',
      region: this.options.region,
      service: 'secretsmanager',
      headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': `secretsmanager.${target}` },
      body,
      accessKeyId: this.options.accessKeyId,
      secretAccessKey: this.options.secretAccessKey,
      sessionToken: this.options.sessionToken ?? null,
      now: this.now(),
    });
    delete headers.host; // fetch sets Host itself; it was signed with the same value
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.endpoint}/`, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 5000),
      });
    } catch (error) {
      throw new SecretStoreError('UNAVAILABLE', `AWS Secrets Manager request failed: ${(error as Error).name}`, true);
    }
    const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: response.status, body: parsed };
  }

  private static errorType(body: Record<string, unknown>): string {
    const raw = typeof body.__type === 'string' ? body.__type : '';
    return raw.includes('#') ? raw.split('#').pop() ?? raw : raw;
  }

  public async write(ref: string, secret: StoredExchangeSecret): Promise<void> {
    const secretId = this.secretId(ref);
    const secretString = JSON.stringify(serialisePayload(secret));
    const put = await this.call('PutSecretValue', { SecretId: secretId, SecretString: secretString });
    if (put.status === 200) return;
    if (AwsSecretsManagerStore.errorType(put.body) === 'ResourceNotFoundException') {
      const created = await this.call('CreateSecret', {
        Name: secretId,
        SecretString: secretString,
        ...(this.options.kmsKeyId ? { KmsKeyId: this.options.kmsKeyId } : {}),
        Tags: [{ Key: 'wlct:purpose', Value: 'exchange-credential' }],
      });
      if (created.status === 200) return;
      throw this.toError(created, 'AWS CreateSecret');
    }
    throw this.toError(put, 'AWS PutSecretValue');
  }

  public async read(ref: string): Promise<StoredExchangeSecret> {
    const result = await this.call('GetSecretValue', { SecretId: this.secretId(ref) });
    if (result.status !== 200) throw this.toError(result, 'AWS GetSecretValue');
    const secretString = result.body.SecretString;
    if (typeof secretString !== 'string') throw new SecretStoreError('MALFORMED', 'AWS secret has no SecretString');
    let parsed: unknown;
    try {
      parsed = JSON.parse(secretString);
    } catch {
      throw new SecretStoreError('MALFORMED', 'AWS secret is not JSON');
    }
    return parseSecretPayload(parsed);
  }

  public async exists(ref: string): Promise<boolean> {
    const result = await this.call('DescribeSecret', { SecretId: this.secretId(ref) });
    if (result.status === 200) return result.body.DeletedDate === undefined || result.body.DeletedDate === null;
    if (AwsSecretsManagerStore.errorType(result.body) === 'ResourceNotFoundException') return false;
    throw this.toError(result, 'AWS DescribeSecret');
  }

  public async destroy(ref: string): Promise<void> {
    const result = await this.call('DeleteSecret', { SecretId: this.secretId(ref), RecoveryWindowInDays: 7 });
    if (result.status === 200) return;
    if (AwsSecretsManagerStore.errorType(result.body) === 'ResourceNotFoundException') return;
    throw this.toError(result, 'AWS DeleteSecret');
  }

  private toError(result: { status: number; body: Record<string, unknown> }, what: string): SecretStoreError {
    const type = AwsSecretsManagerStore.errorType(result.body);
    if (type === 'ResourceNotFoundException') return new SecretStoreError('NOT_FOUND', `${what}: secret not found`);
    if (type === 'AccessDeniedException' || type === 'UnrecognizedClientException' || type === 'InvalidSignatureException') {
      return new SecretStoreError('DENIED', `${what}: ${type}`);
    }
    return classifyStatus(result.status, `${what}${type ? ` (${type})` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function readToken(env: NodeJS.ProcessEnv): string | null {
  if (env.VAULT_TOKEN && env.VAULT_TOKEN.trim()) return env.VAULT_TOKEN.trim();
  if (env.VAULT_TOKEN_FILE) {
    try {
      const token = readFileSync(env.VAULT_TOKEN_FILE, 'utf8').trim();
      return token.length > 0 ? token : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Select the configured store. `SECRET_MANAGER_PROVIDER` = `vault` | `aws`
 * picks explicitly; otherwise VAULT_ADDR selects Vault and
 * AWS_SECRETS_MANAGER_ENABLED=true selects AWS. Returns null when nothing is
 * configured; throws SecretStoreError(NOT_CONFIGURED) when a provider is
 * selected but incomplete - a half-configured secret manager must be loud.
 */
export function createSecretStoreFromEnv(env: NodeJS.ProcessEnv = process.env, fetchImpl?: FetchLike): SecretStore | null {
  const explicit = (env.SECRET_MANAGER_PROVIDER ?? '').trim().toLowerCase();
  const wantsVault = explicit === 'vault' || (explicit === '' && !!env.VAULT_ADDR);
  const wantsAws = explicit === 'aws' || (explicit === '' && !wantsVault && (env.AWS_SECRETS_MANAGER_ENABLED ?? '').toLowerCase() === 'true');
  if (explicit !== '' && explicit !== 'vault' && explicit !== 'aws') {
    throw new SecretStoreError('NOT_CONFIGURED', `Unknown SECRET_MANAGER_PROVIDER ${explicit}`);
  }
  if (wantsVault) {
    const token = readToken(env);
    if (!env.VAULT_ADDR || !token) throw new SecretStoreError('NOT_CONFIGURED', 'Vault selected but VAULT_ADDR / VAULT_TOKEN (or VAULT_TOKEN_FILE) is missing');
    return new VaultKv2SecretStore({
      address: env.VAULT_ADDR,
      token,
      mount: env.SECRET_MANAGER_VAULT_MOUNT || 'secret',
      namespace: env.VAULT_NAMESPACE || null,
      pathTemplate: env.SECRET_MANAGER_VAULT_PATH_TEMPLATE || 'wlct/{tenant}/{account}/{exchange}',
      fetchImpl,
    });
  }
  if (wantsAws) {
    return new AwsSecretsManagerStore({
      region: env.AWS_REGION || env.AWS_DEFAULT_REGION || '',
      accessKeyId: env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY || '',
      sessionToken: env.AWS_SESSION_TOKEN || null,
      namePrefix: env.SECRET_MANAGER_AWS_PREFIX || 'wlct',
      kmsKeyId: env.SECRET_MANAGER_AWS_KMS_KEY_ID || null,
      fetchImpl,
    });
  }
  return null;
}

/** Nest injection token: tests (and a future DI-managed store) provide a
 * SecretStore here; when absent the credential service uses the env factory. */
export const EXCHANGE_SECRET_STORE = 'EXCHANGE_SECRET_STORE';
