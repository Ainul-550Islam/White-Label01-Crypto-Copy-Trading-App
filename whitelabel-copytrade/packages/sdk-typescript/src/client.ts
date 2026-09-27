/**
 * Production TypeScript SDK client for the developer platform.
 *
 * - typed resource clients whose every method maps to a REAL backend route
 *   (the inventory is pinned by developer.contract.spec.ts CHECK 47);
 * - explicit API version on every request (X-Api-Version);
 * - correlation ids propagated end to end (x-correlation-id);
 * - retries ONLY for safe (GET) transport failures, with capped backoff;
 * - cursor pagination helpers;
 * - normalized errors (DeveloperApiError with code/status/correlationId);
 * - webhook signature verification helper (constant-time);
 * - no credential is ever logged or persisted by the client.
 */

export type ApiVersion = 'v1' | 'v2';

export interface DeveloperCredentials {
  kind: 'bearer';
  token: string;
}

export interface DeveloperKeyCredentials {
  kind: 'developer-key';
  keyId: string;
  secret: string;
}

export type DeveloperAuth = DeveloperCredentials | DeveloperKeyCredentials;

export interface SdkOptions {
  baseUrl: string;
  apiVersion?: ApiVersion;
  auth?: DeveloperAuth;
  /** Injectable transport (fetch-compatible); defaults to global fetch. */
  transport?: (input: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  maxSafeRetries?: number;
}

export class DeveloperApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly correlationId: string | null;

  constructor(status: number, code: string, message: string, correlationId: string | null) {
    super(message);
    this.name = 'DeveloperApiError';
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
  }
}

export interface Paginated<T> {
  rows: T[];
  nextCursor: string | null;
}

export interface DeveloperApplicationView {
  id: string;
  tenantId: string;
  name: string;
  clientId: string;
  state: string;
  environment: string;
  redirectUris: string[];
  scopes: string[];
  createdAt: string;
}

export interface IssuedCredential {
  keyId: string;
  /** One-time presentation: the platform never shows this value again. */
  secret: string;
  scopes: string[];
  expiresAt: string | null;
}

export interface ApplicationLifecycleInput {
  name: string;
  description: string;
  redirectUris: string[];
  requestedScopes?: string[];
  environment?: 'SANDBOX' | 'PRODUCTION';
  naturalKey?: string;
}

export interface WebhookSubscriptionInput {
  applicationId: string;
  endpointUrl: string;
  eventTypes: string[];
  eventVersion?: 'v1' | 'v2';
  environment?: 'SANDBOX' | 'PRODUCTION';
  description?: string;
}

export interface WebhookSubscriptionView {
  id: string;
  applicationId: string;
  endpointUrl: string;
  eventTypes: string[];
  state: string;
  environment: string;
}

export interface UsageRollup {
  totalRequests: number;
  totalRateLimited: number;
  totalWebhookDeliveries: number;
  totalWebhookFailures: number;
  byEndpoint: { endpoint: string; requests: number; errors4xx: number; errors5xx: number }[];
  byApiVersion: { version: string; requests: number }[];
}

const RETRYABLE_STATUS = new Set([502, 503, 504]);

export class DeveloperPlatformClient {
  private readonly baseUrl: string;
  private readonly apiVersion: ApiVersion;
  private auth?: DeveloperAuth;
  private readonly transport: (input: string, init: RequestInit) => Promise<Response>;
  private readonly timeoutMs: number;
  private readonly maxSafeRetries: number;

  constructor(options: SdkOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiVersion = options.apiVersion ?? 'v2';
    this.auth = options.auth;
    this.transport = options.transport ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxSafeRetries = options.maxSafeRetries ?? 2;
  }

  setAuth(auth: DeveloperAuth): void {
    this.auth = auth;
  }

  private correlationId(): string {
    return `sdk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private authHeaders(): Record<string, string> {
    if (!this.auth) throw new DeveloperApiError(0, 'SDK_NO_AUTH', 'credentials not configured', null);
    if (this.auth.kind === 'bearer') {
      return { Authorization: `Bearer ${this.auth.token}` };
    }
    return { Authorization: `Developer ${this.auth.keyId}.${this.auth.secret}` };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | undefined>,
  ): Promise<{ data: T; headers: Headers }> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = {
      'X-Api-Version': this.apiVersion,
      'x-correlation-id': this.correlationId(),
      ...this.authHeaders(),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    };
    let attempt = 0;
    for (;;) {
      const response = await this.transport(url.toString(), {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (RETRYABLE_STATUS.has(response.status) && method === 'GET' && attempt < this.maxSafeRetries) {
        attempt += 1;
        await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt));
        continue;
      }
      const correlationId = response.headers.get('x-correlation-id');
      if (!response.ok) {
        let code = 'HTTP_ERROR';
        let message = `request failed with HTTP ${response.status}`;
        try {
          const parsed = (await response.json()) as { code?: string; message?: string };
          code = parsed.code ?? code;
          message = parsed.message ?? message;
        } catch {
          // Non-JSON error bodies stay generic; never guessed into success.
        }
        throw new DeveloperApiError(response.status, code, message, correlationId);
      }
      if (response.status === 204) return { data: undefined as T, headers: response.headers };
      const data = (await response.json()) as T;
      return { data, headers: response.headers };
    }
  }

  private paginated<T>(path: string, query?: Record<string, string | number | undefined>) {
    return {
      first: async (): Promise<Paginated<T>> => {
        const { data } = await this.request<Paginated<T>>('GET', path, undefined, query);
        return data;
      },
      next: async (cursor: string): Promise<Paginated<T>> => {
        const { data } = await this.request<Paginated<T>>('GET', path, undefined, { ...query, cursor });
        return data;
      },
    };
  }

  // ------------------------------------------------------------- applications

  readonly applications = {
    create: (input: ApplicationLifecycleInput) =>
      this.request<DeveloperApplicationView & { id: string }>('POST', '/developer-platform/applications', input),
    list: (query?: { state?: string; environment?: string; limit?: number; cursor?: string }) =>
      this.paginated<DeveloperApplicationView>('/developer-platform/applications', query),
    get: (applicationId: string) =>
      this.request<DeveloperApplicationView>('GET', `/developer-platform/applications/${applicationId}`),
    update: (applicationId: string, patch: { name?: string; description?: string; redirectUris?: string[] }) =>
      this.request<DeveloperApplicationView>('PATCH', `/developer-platform/applications/${applicationId}`, patch),
    transition: (
      applicationId: string,
      targetState: 'ACTIVE' | 'SUSPENDED' | 'REACTIVATION_REVIEW' | 'REVOKED',
      reason?: string,
    ) =>
      this.request<{ id: string; state: string }>(
        'POST',
        `/developer-platform/applications/${applicationId}/transitions`,
        { targetState, reason },
      ),
    addRedirectUri: (applicationId: string, uri: string) =>
      this.request<DeveloperApplicationView>(
        'POST',
        `/developer-platform/applications/${applicationId}/redirect-uris`,
        { redirect: { uri } },
      ),
    updateScopes: (applicationId: string, scopes: string[], reason?: string) =>
      this.request<DeveloperApplicationView>(
        'PUT',
        `/developer-platform/applications/${applicationId}/scopes`,
        { scopes, reason },
      ),
  };

  // -------------------------------------------------------------- credentials

  readonly credentials = {
    create: (
      applicationId: string,
      input: { label: string; expiresInDays?: number; scopes?: string[] },
    ) =>
      this.request<IssuedCredential>(
        'POST',
        `/developer-platform/applications/${applicationId}/credentials`,
        input,
      ),
    list: (query?: { applicationId?: string; status?: string; limit?: number; cursor?: string }) =>
      this.paginated<{ keyId: string; label: string; kind: string; scopes: string[]; revokedAt: string | null }>(
        '/developer-platform/credentials',
        query,
      ),
    rotate: (applicationId: string, keyId: string, reason?: string) =>
      this.request<IssuedCredential>(
        'POST',
        `/developer-platform/applications/${applicationId}/credentials/${keyId}/rotate`,
        { keyId, reason },
      ),
    revoke: (applicationId: string, keyId: string, reason?: string) =>
      this.request<void>(
        'DELETE',
        `/developer-platform/applications/${applicationId}/credentials/${keyId}`,
        { reason },
      ),
  };

  // -------------------------------------------------------------------- oauth

  readonly oauth = {
    exchangeToken: (input: {
      clientId: string;
      code: string;
      redirectUri: string;
      codeVerifier?: string;
      clientSecret?: string;
    }) => this.request<{ accessToken: string; tokenType: string; expiresIn: number; scope: string }>(
      'POST',
      '/developer-platform/oauth/token',
      input,
    ),
    revoke: (token: string) =>
      this.request<void>('POST', '/developer-platform/oauth/revoke', { token }),
  };

  // ----------------------------------------------------------------- webhooks

  readonly webhooks = {
    create: (input: WebhookSubscriptionInput) =>
      this.request<{ subscription: WebhookSubscriptionView; secret: string }>(
        'POST',
        '/developer-platform/webhooks',
        input,
      ),
    list: (query?: { applicationId?: string; status?: string; limit?: number; cursor?: string }) =>
      this.paginated<WebhookSubscriptionView>('/developer-platform/webhooks', query),
    update: (subscriptionId: string, patch: { endpointUrl?: string; eventTypes?: string[]; description?: string }) =>
      this.request<WebhookSubscriptionView>('PATCH', `/developer-platform/webhooks/${subscriptionId}`, patch),
    action: (
      subscriptionId: string,
      action: 'pause' | 'resume' | 'revoke',
      reason?: string,
    ) =>
      this.request<WebhookSubscriptionView | { id: string; state: string }>(
        'POST',
        `/developer-platform/webhooks/${subscriptionId}/actions`,
        { action, reason },
      ),
    rotateSecret: (subscriptionId: string) =>
      this.request<{ secret: string }>(
        'POST',
        `/developer-platform/webhooks/${subscriptionId}/rotate-secret`,
        {},
      ),
    replay: (subscriptionId: string, eventId: string) =>
      this.request<{ deliveryId: string; eventId: string }>(
        'POST',
        `/developer-platform/webhooks/${subscriptionId}/replay`,
        { eventId },
      ),
    deliveries: (
      subscriptionId: string,
      query?: { state?: string; eventId?: string; limit?: number; cursor?: string },
    ) =>
      this.paginated<{
        id: string;
        eventId: string;
        eventType: string;
        attempt: number;
        state: string;
        responseStatus: number | null;
      }>(`/developer-platform/webhooks/${subscriptionId}/deliveries`, query),
  };

  // ------------------------------------------------------- usage & analytics

  readonly usage = {
    rollup: (query?: { applicationId?: string; from?: string; to?: string; granularity?: 'minute' | 'hour' | 'day' }) =>
      this.request<UsageRollup>('GET', '/developer-platform/usage', undefined, query),
  };

  readonly analytics = {
    application: (applicationId: string, query?: { from?: string; to?: string }) =>
      this.request<Record<string, unknown>>('GET', '/developer-platform/analytics', undefined, {
        applicationId,
        ...query,
      }),
  };

  // --------------------------------------------------------- versions & docs

  readonly meta = {
    apiVersions: () =>
      this.request<{ versions: { version: string; state: string; deprecatedAt?: string; sunsetAt?: string; replacement?: string }[] }>(
        'GET',
        '/developer-platform/api-versions',
      ),
    eventTypes: () =>
      this.request<{ eventTypes: { eventType: string; resourceType: string; eventVersion: string; source: string }[] }>(
        'GET',
        '/developer-platform/event-types',
      ),
  };
}

/**
 * Server-side webhook receiver helper: verifies the platform's signature
 * headers over the raw body (constant-time) and enforces the timestamp
 * tolerance. Consumers dedupe on the event id — replays reuse the SAME id.
 */
export async function verifyWebhook(input: {
  rawBody: string;
  secret: string;
  headers: Record<string, string>;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): Promise<{ eventId: string; version: string; valid: true }> {
  const timestamp = Number.parseInt(input.headers['x-webhook-timestamp'] ?? '', 10);
  const eventId = input.headers['x-webhook-event-id'] ?? '';
  const version = input.headers['x-webhook-version'] ?? '';
  const signature = input.headers['x-webhook-signature'] ?? '';
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? 300;
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > tolerance) {
    throw new DeveloperApiError(400, 'WEBHOOK_TIMESTAMP_EXPIRED', 'signature timestamp outside tolerance', null);
  }
  const canonical = `t=${timestamp}.id=${eventId}.v=${version}.${input.rawBody}`;
  const expected = `v1=${await hmacSha256Hex(input.secret, canonical)}`;
  if (!timingSafeEqualHex(expected, signature)) {
    throw new DeveloperApiError(401, 'WEBHOOK_SIGNATURE_INVALID', 'signature does not verify', null);
  }
  return { eventId, version, valid: true };
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  // Implemented over WebCrypto so the SDK works in Node (>=16) and browsers
  // without pulling an extra crypto dependency.
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new DeveloperApiError(0, 'SDK_NO_CRYPTO', 'WebCrypto unavailable in this runtime', null);
  }
  const encoder = new TextEncoder();
  const key = await subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}
