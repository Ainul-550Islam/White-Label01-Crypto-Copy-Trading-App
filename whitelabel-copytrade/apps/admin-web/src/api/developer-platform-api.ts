// Typed portal contracts from developer-platform/developer.controller.ts.
// Mutation keys travel in a header; callers must retain the same key when
// retrying one intent. A header does not by itself make a backend idempotent.
import { apiClient } from '@/lib/api-client';
import { assertStepUpProof } from './step-up-proof';

export type DeveloperEnvironment = 'SANDBOX' | 'PRODUCTION';
export type ApplicationState = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REACTIVATION_REVIEW' | 'REVOKED';
export interface Rows<T> { rows: T[]; nextCursor?: string | null }
export interface DeveloperApplication {
  id: string; name: string; description: string; clientId: string; state: ApplicationState;
  environment: DeveloperEnvironment; redirectUris: string[]; scopes: string[];
  homePageUrl: string | null; createdAt: string; updatedAt: string;
}
export interface ApplicationInput {
  name: string; description: string; redirectUris: string[]; requestedScopes?: string[];
  environment?: DeveloperEnvironment; naturalKey?: string;
}
export interface Credential {
  id: string; applicationId: string; keyId: string; label: string; kind: string;
  scopes: string[]; expiresAt: string | null; revokedAt: string | null; createdAt: string;
}
export interface IssuedCredential { keyId: string; secret: string; scopes: string[]; expiresAt: string | null }
export interface WebhookSubscription {
  id: string; applicationId: string; endpointUrl: string; eventTypes: string[];
  eventVersion: string; environment: DeveloperEnvironment; description: string | null;
  state: 'ACTIVE' | 'PAUSED' | 'REVOKED'; createdAt: string; updatedAt: string;
}
export interface WebhookInput {
  applicationId: string; endpointUrl: string; eventTypes: string[]; eventVersion?: string;
  environment?: DeveloperEnvironment; description?: string;
}
export interface Delivery {
  id: string; eventId: string; eventType: string; attempt: number; state: string;
  outcomeClass: string | null; responseStatus: number | null; nextRetryAt: string | null;
  correlationId: string; createdAt: string; payload: Record<string, unknown> | null;
}
export interface ScopeDefinition { scope: string; category: string; write: boolean }
export interface EventType { eventType: string; resourceType: string; eventVersion: string; source: string; schemaId: string }
export interface Usage {
  totalRequests: number; totalRateLimited: number; totalWebhookDeliveries: number; totalWebhookFailures: number;
  byEndpoint: Array<{ endpoint: string; requests: number; errors4xx: number; errors5xx: number }>;
  byApiVersion: Array<{ version: string; requests: number }>;
  periodId: string; sources: Array<{ meterKey: string; count: number }>; truncated: boolean;
}
export interface Analytics {
  applicationId: string; window: { from: string; to: string }; requests: number; successes: number;
  errors: number; errors4xx: number; errors5xx: number; rateLimitHits: number;
  averageLatencyMs: number | null; p95LatencyMs: number | null; webhookDeliveries: number;
  webhookFailures: number; deliveryTruncated: boolean; activeApplications: number; activeApiKeys: number; topEndpoints: Array<{ endpoint: string; requests: number }>;
  apiVersionUsage: Array<{ version: string; requests: number }>; usage: Usage;
}
export interface AuditRecord {
  id: string; sequence: number; applicationId: string | null; actorType: string; actorId: string;
  correlationId: string; action: string; detail: Record<string, unknown>; createdAt: string;
}
export interface ApiVersion { version: string; state: 'SUPPORTED' | 'DEPRECATED' | 'SUNSET'; deprecatedAt?: string; sunsetAt?: string; replacement?: string }
export interface ReconciliationReport { tenantId: string; scannedAt: string; truncated: boolean; findings: Array<{ kind: string; severity: 'LOW' | 'MEDIUM' | 'HIGH'; subjectType: string; subjectId: string; detail: string; suggestedAction: string }> }
export type DeveloperStepUpAction = 'DEVELOPER_APPLICATION_CREATE' | 'DEVELOPER_APPLICATION_UPDATE' | 'DEVELOPER_APPLICATION_SCOPE_CHANGE' | 'DEVELOPER_APPLICATION_VERSION_PIN' | 'DEVELOPER_APPLICATION_ACTIVATE' | 'DEVELOPER_APPLICATION_SUSPEND' | 'DEVELOPER_APPLICATION_REACTIVATE' | 'DEVELOPER_APPLICATION_REVOKE' | 'DEVELOPER_APPLICATION_APPROVE' | 'API_KEY_CREATE' | 'API_KEY_REVOKE' | 'WEBHOOK_CREATE' | 'WEBHOOK_UPDATE' | 'WEBHOOK_PAUSE' | 'WEBHOOK_RESUME' | 'WEBHOOK_REVOKE' | 'WEBHOOK_SECRET_ROTATE' | 'WEBHOOK_REPLAY';
export type StepUpMethod = 'TOTP' | 'PASSWORD' | 'RECOVERY_CODE';
export interface OAuthAuthorizeInput {
  clientId: string; redirectUri: string; state: string; requestedScopes?: string[];
  codeChallenge: string; codeChallengeMethod: 'S256'; nonce?: string;
}
export interface OAuthExchangeInput { clientId: string; code: string; redirectUri: string; codeVerifier: string; clientSecret?: string }
export interface UserGrant { id: string; clientName: string; environment: DeveloperEnvironment; scopes: string[]; createdAt: string }
export interface IntegrationClient { clientId: string; name: string; environment: DeveloperEnvironment; apiVersion: string }
export interface IntegrationProfile { id: string; email: string; displayName: string | null; locale: string | null }
export type IntegrationCredential = { type: 'oauth'; token: string } | { type: 'apiKey'; keyId: string; secret: string };
export interface IntegrationRequest {
  /** Trusted tenant API origin. The admin session proxy is deliberately not used for integration credentials. */
  apiOrigin: string;
  environment: 'sandbox' | 'production';
  credential: IntegrationCredential;
  version: string;
  signal?: AbortSignal;
}

const enc = encodeURIComponent;
const mutation = (idempotencyKey: string) => ({ idempotencyKey });

/** Direct integration calls use their own credential, never the admin-session proxy. */
async function integrationGet<T>(request: IntegrationRequest, path: string, valid: (value: unknown) => value is T): Promise<T> {
  const { apiOrigin, environment, credential, version, signal } = request;
  let origin: URL;
  try { origin = new URL(apiOrigin); } catch { throw new Error('Invalid integration origin.'); }
  const localSandbox = environment === 'sandbox' && origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if ((!localSandbox && origin.protocol !== 'https:') || origin.username || origin.password ||
      origin.pathname !== '/' || origin.search || origin.hash ||
      !['sandbox', 'production'].includes(environment) || !/^v[1-9][0-9]{0,8}$/.test(version)) {
    throw new Error('Invalid integration request.');
  }
  const safePart = (part: string) => typeof part === 'string' && /^[A-Za-z0-9_~+\/-]{1,2048}={0,2}$/.test(part);
  let authorization: string;
  if (credential?.type === 'oauth' && safePart(credential.token)) authorization = `Bearer ${credential.token}`;
  else if (credential?.type === 'apiKey' && safePart(credential.keyId) && safePart(credential.secret)) authorization = `Developer ${credential.keyId}.${credential.secret}`;
  else throw new Error('Invalid integration credential.');

  let response: Response;
  try {
    response = await fetch(new URL(path, origin), {
      method: 'GET', headers: { accept: 'application/json', authorization, 'x-api-version': version },
      credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal,
    });
  } catch {
    throw new Error('Integration request failed.');
  }
  if (!response.ok) throw new Error('Integration request failed.');
  let value: unknown;
  try { value = await response.json(); } catch { throw new Error('Invalid integration response.'); }
  const data = value && typeof value === 'object' && 'data' in value ? (value as { data: unknown }).data : value;
  if (!valid(data)) throw new Error('Invalid integration response.');
  return data;
}

const integrationClientShape = (value: unknown): value is IntegrationClient => {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.clientId === 'string' && !!row.clientId && typeof row.name === 'string' &&
    ['SANDBOX', 'PRODUCTION'].includes(String(row.environment)) && typeof row.apiVersion === 'string' && !!row.apiVersion;
};
const integrationProfileShape = (value: unknown): value is IntegrationProfile => {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' && !!row.id && typeof row.email === 'string' && !!row.email &&
    (row.displayName === null || typeof row.displayName === 'string') && (row.locale === null || typeof row.locale === 'string');
};

/** List endpoints use tenant-scoped, bounded cursor pagination. */
export const developerPlatformApi = {
  verifyStepUp: async (action: DeveloperStepUpAction, method: StepUpMethod, value: string, key: string) => {
    const proof = await apiClient.post<unknown>('/v1/auth/step-up/verify', { action, method, ...(method === 'TOTP' ? { code: value } : method === 'PASSWORD' ? { password: value } : { recoveryCode: value }) }, mutation(key));
    assertStepUpProof(proof, action, method);
  },
  createApplication: (dto: ApplicationInput, key: string) =>
    apiClient.post<DeveloperApplication>('/v1/developer-platform/applications', dto, mutation(key)),
  listApplications: (query: { state?: ApplicationState; environment?: DeveloperEnvironment; limit?: number; cursor?: string } = {}) =>
    apiClient.get<Rows<DeveloperApplication>>('/v1/developer-platform/applications', { searchParams: query }),
  getApplication: (id: string) => apiClient.get<DeveloperApplication>(`/v1/developer-platform/applications/${enc(id)}`),
  updateApplication: (id: string, dto: Partial<Pick<ApplicationInput, 'name' | 'description' | 'redirectUris'>> & { homePageUrl?: string }, key: string) =>
    apiClient.patch<DeveloperApplication>(`/v1/developer-platform/applications/${enc(id)}`, dto, mutation(key)),
  transitionApplication: (id: string, dto: { targetState: ApplicationState; reason?: string }, key: string) =>
    apiClient.post<{ id: string; state: ApplicationState }>(`/v1/developer-platform/applications/${enc(id)}/transitions`, dto, mutation(key)),
  activateApplication: (id: string, key: string) =>
    apiClient.post<{ id: string; state: ApplicationState }>(`/v1/developer-platform/applications/${enc(id)}/activate`, { targetState: 'ACTIVE' }, mutation(key)),
  suspendApplication: (id: string, reason: string | undefined, key: string) =>
    apiClient.post<{ id: string; state: ApplicationState }>(`/v1/developer-platform/applications/${enc(id)}/suspend`, { targetState: 'SUSPENDED', reason }, mutation(key)),
  requestApplicationReactivation: (id: string, reason: string | undefined, key: string) =>
    apiClient.post<{ id: string; state: ApplicationState }>(`/v1/developer-platform/applications/${enc(id)}/request-reactivation`, { targetState: 'REACTIVATION_REVIEW', reason }, mutation(key)),
  revokeApplication: (id: string, reason: string | undefined, key: string) =>
    apiClient.post<{ id: string; state: ApplicationState }>(`/v1/developer-platform/applications/${enc(id)}/revoke`, { targetState: 'REVOKED', reason }, mutation(key)),
  approveApplicationReactivation: (id: string, key: string) =>
    apiClient.post<{ id: string; state: ApplicationState }>(`/v1/developer-platform/applications/${enc(id)}/approve-reactivation`, { targetState: 'ACTIVE' }, mutation(key)),
  addRedirectUri: (id: string, uri: string, key: string) =>
    apiClient.post<DeveloperApplication>(`/v1/developer-platform/applications/${enc(id)}/redirect-uris`, { redirect: { uri } }, mutation(key)),
  updateScopes: (id: string, dto: { scopes: string[]; reason?: string }, key: string) =>
    apiClient.put<DeveloperApplication>(`/v1/developer-platform/applications/${enc(id)}/scopes`, dto, mutation(key)),
  createCredential: (id: string, dto: { label: string; expiresInDays?: number; scopes?: string[] }, key: string) =>
    apiClient.post<IssuedCredential>(`/v1/developer-platform/applications/${enc(id)}/credentials`, dto, mutation(key)),
  listCredentials: (query: { applicationId?: string; status?: 'ACTIVE' | 'REVOKED' | 'EXPIRED'; kind?: 'API_KEY' | 'OAUTH_CLIENT'; limit?: number; cursor?: string } = {}) =>
    apiClient.get<Rows<Credential>>('/v1/developer-platform/credentials', { searchParams: query }),
  rotateCredential: (id: string, keyId: string, reason: string | undefined, key: string) =>
    apiClient.post<IssuedCredential>(`/v1/developer-platform/applications/${enc(id)}/credentials/${enc(keyId)}/rotate`, { keyId, reason }, mutation(key)),
  revokeCredential: (id: string, keyId: string, reason: string | undefined, key: string) =>
    apiClient.delete<void>(`/v1/developer-platform/applications/${enc(id)}/credentials/${enc(keyId)}`, { ...mutation(key), body: { keyId, reason } }),
  oauthAuthorize: (dto: OAuthAuthorizeInput, key: string) =>
    apiClient.post<{ grantId: string; consentedScopes: string[]; redirectTo: string; clientName: string; environment: DeveloperEnvironment }>('/v1/developer-platform/oauth/authorize', dto, mutation(key)),
  oauthConsent: (dto: { grantId: string; decision: 'GRANTED' | 'DENIED' }, key: string) =>
    apiClient.post<{ grantId: string; state: 'GRANTED' | 'DENIED' }>('/v1/developer-platform/oauth/consent', dto, mutation(key)),
  oauthIssueCode: (grantId: string, key: string) =>
    apiClient.post<{ code: string; expiresIn: number; redirectTo: string; state: string }>('/v1/developer-platform/oauth/code', { grantId }, mutation(key)),
  oauthExchange: (dto: OAuthExchangeInput, key: string) =>
    apiClient.post<{ accessToken: string; tokenType: 'Bearer'; expiresIn: number; scope: string }>('/v1/developer-platform/oauth/token', dto, mutation(key)),
  oauthRevoke: (token: string, key: string) =>
    apiClient.post<void>('/v1/developer-platform/oauth/revoke', { token }, mutation(key)),
  /** Self-service grants belong only to the signed-in actor, not every tenant user. */
  oauthGrants: (query: { limit?: number; cursor?: string } = {}) =>
    apiClient.get<Rows<UserGrant>>('/v1/developer-platform/oauth/grants', { searchParams: query }),
  oauthRevokeGrant: (id: string, key: string) =>
    apiClient.post<void>(`/v1/developer-platform/oauth/grants/${enc(id)}/revoke`, {}, mutation(key)),
  integrationClient: (request: IntegrationRequest) =>
    integrationGet(request, `/v1/developer-platform/integration/${request.environment}/client`,
      (value): value is IntegrationClient => integrationClientShape(value) &&
        value.environment === request.environment.toUpperCase() && value.apiVersion === request.version),
  integrationProfile: (request: IntegrationRequest) => {
    if (request.credential.type !== 'oauth') return Promise.reject(new Error('User authorization is required.'));
    return integrationGet(request, `/v1/developer-platform/integration/${request.environment}/profile`, integrationProfileShape);
  },
  createWebhook: (dto: WebhookInput, key: string) =>
    apiClient.post<{ subscription: WebhookSubscription; secret: string }>('/v1/developer-platform/webhooks', dto, mutation(key)),
  listWebhooks: (query: { applicationId?: string; status?: 'ACTIVE' | 'PAUSED' | 'REVOKED'; limit?: number; cursor?: string } = {}) =>
    apiClient.get<Rows<WebhookSubscription>>('/v1/developer-platform/webhooks', { searchParams: query }),
  updateWebhook: (id: string, dto: { endpointUrl?: string; eventTypes?: string[]; description?: string }, key: string) =>
    apiClient.patch<WebhookSubscription>(`/v1/developer-platform/webhooks/${enc(id)}`, dto, mutation(key)),
  webhookAction: (id: string, dto: { action: 'pause' | 'resume' | 'revoke'; reason?: string }, key: string) =>
    apiClient.post<{ id: string; state: string }>(`/v1/developer-platform/webhooks/${enc(id)}/actions`, dto, mutation(key)),
  pauseWebhook: (id: string, key: string) =>
    apiClient.post<WebhookSubscription>(`/v1/developer-platform/webhooks/${enc(id)}/pause`, {}, mutation(key)),
  resumeWebhook: (id: string, key: string) =>
    apiClient.post<WebhookSubscription>(`/v1/developer-platform/webhooks/${enc(id)}/resume`, {}, mutation(key)),
  revokeWebhook: (id: string, key: string) =>
    apiClient.post<{ id: string; state: 'REVOKED' }>(`/v1/developer-platform/webhooks/${enc(id)}/revoke`, {}, mutation(key)),
  rotateWebhookSecret: (id: string, key: string) =>
    apiClient.post<{ secret: string }>(`/v1/developer-platform/webhooks/${enc(id)}/rotate-secret`, undefined, mutation(key)),
  replayWebhook: (id: string, eventId: string, key: string) =>
    apiClient.post<{ deliveryId: string; eventId: string }>(`/v1/developer-platform/webhooks/${enc(id)}/replay`, { eventId }, mutation(key)),
  listDeliveries: (id: string, query: { state?: string; eventId?: string; limit?: number; cursor?: string } = {}) =>
    apiClient.get<Rows<Delivery>>(`/v1/developer-platform/webhooks/${enc(id)}/deliveries`, { searchParams: query }),
  scopeCatalog: () => apiClient.get<{ scopes: ScopeDefinition[] }>('/v1/developer-platform/scope-catalog'),
  eventTypes: () => apiClient.get<{ eventTypes: EventType[] }>('/v1/developer-platform/event-types'),
  usage: (query: { applicationId: string; from?: string; to?: string; granularity?: 'minute' | 'hour' | 'day' }) =>
    apiClient.get<Usage>('/v1/developer-platform/usage', { searchParams: query }),
  analytics: (query: { applicationId: string; from?: string; to?: string; granularity?: 'minute' | 'hour' | 'day'; apiVersion?: 'v1' | 'v2' }) =>
    apiClient.get<Analytics>('/v1/developer-platform/analytics', { searchParams: query }),
  audit: (query: { applicationId?: string; action?: string; cursor?: string } = {}) =>
    apiClient.get<Rows<AuditRecord>>('/v1/developer-platform/audit', { searchParams: query }),
  versions: () => apiClient.get<{ versions: ApiVersion[] }>('/v1/developer-platform/api-versions'),
  applicationVersion: (id: string) => apiClient.get<{ applicationId: string; version: string }>(`/v1/developer-platform/applications/${enc(id)}/api-version`),
  pinApplicationVersion: (id: string, version: string, key: string) => apiClient.put<{ applicationId: string; version: string }>(`/v1/developer-platform/applications/${enc(id)}/api-version`, { version }, mutation(key)),
  reconciliation: (tenantId?: string) =>
    apiClient.get<ReconciliationReport>('/v1/developer-platform/reconciliation', { searchParams: { tenantId } }),
};
