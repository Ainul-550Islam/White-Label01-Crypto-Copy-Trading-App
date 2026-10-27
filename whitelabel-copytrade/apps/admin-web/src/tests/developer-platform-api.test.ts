import { developerPlatformApi as api } from '@/api/developer-platform-api';
import { apiClient } from '@/lib/api-client';

jest.mock('@/lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
const key = 'intent-123';
const opts = { idempotencyKey: key };
const app = 'app/id';
const hook = 'hook/id';
const credential = 'key/id';
const appPath = '/v1/developer-platform/applications/app%2Fid';
const webhookPath = '/v1/developer-platform/webhooks/hook%2Fid';
const base = '/v1/developer-platform';

afterEach(() => jest.clearAllMocks());

test('application routes use the declared methods, paths, bodies and keys', () => {
  const input = { name: 'Example', description: 'App', redirectUris: ['https://app.example/callback'] };
  api.createApplication(input, key); expect(apiClient.post).toHaveBeenCalledWith(`${base}/applications`, input, opts);
  api.listApplications({ state: 'ACTIVE' }); expect(apiClient.get).toHaveBeenCalledWith(`${base}/applications`, { searchParams: { state: 'ACTIVE' } });
  api.getApplication(app); expect(apiClient.get).toHaveBeenCalledWith(appPath);
  api.updateApplication(app, { name: 'Next' }, key); expect(apiClient.patch).toHaveBeenCalledWith(appPath, { name: 'Next' }, opts);
  api.transitionApplication(app, { targetState: 'SUSPENDED', reason: 'reason' }, key); expect(apiClient.post).toHaveBeenCalledWith(`${appPath}/transitions`, { targetState: 'SUSPENDED', reason: 'reason' }, opts);
  api.activateApplication(app, key); expect(apiClient.post).toHaveBeenCalledWith(`${appPath}/activate`, { targetState: 'ACTIVE' }, opts);
  api.suspendApplication(app, 'pause', key); expect(apiClient.post).toHaveBeenCalledWith(`${appPath}/suspend`, { targetState: 'SUSPENDED', reason: 'pause' }, opts);
  api.requestApplicationReactivation(app, 'resume', key); expect(apiClient.post).toHaveBeenCalledWith(`${appPath}/request-reactivation`, { targetState: 'REACTIVATION_REVIEW', reason: 'resume' }, opts);
  api.revokeApplication(app, 'revoke', key); expect(apiClient.post).toHaveBeenCalledWith(`${appPath}/revoke`, { targetState: 'REVOKED', reason: 'revoke' }, opts);
  api.approveApplicationReactivation(app, key); expect(apiClient.post).toHaveBeenCalledWith(`${appPath}/approve-reactivation`, { targetState: 'ACTIVE' }, opts);
  api.scopeCatalog(); expect(apiClient.get).toHaveBeenCalledWith(`${base}/scope-catalog`);
  api.addRedirectUri(app, 'https://app.example/callback', key); expect(apiClient.post).toHaveBeenCalledWith(`${appPath}/redirect-uris`, { redirect: { uri: 'https://app.example/callback' } }, opts);
  api.updateScopes(app, { scopes: ['webhooks:manage'] }, key); expect(apiClient.put).toHaveBeenCalledWith(`${appPath}/scopes`, { scopes: ['webhooks:manage'] }, opts);
});

test('credential operations are scoped to the application and carry idempotency headers', () => {
  api.createCredential(app, { label: 'deploy' }, key); expect(apiClient.post).toHaveBeenCalledWith(`${appPath}/credentials`, { label: 'deploy' }, opts);
  api.listCredentials({ applicationId: 'a' }); expect(apiClient.get).toHaveBeenCalledWith(`${base}/credentials`, { searchParams: { applicationId: 'a' } });
  api.rotateCredential(app, credential, 'rotation', key); expect(apiClient.post).toHaveBeenCalledWith(`${appPath}/credentials/key%2Fid/rotate`, { keyId: credential, reason: 'rotation' }, opts);
  api.revokeCredential(app, credential, 'revoke', key); expect(apiClient.delete).toHaveBeenCalledWith(`${appPath}/credentials/key%2Fid`, { ...opts, body: { keyId: credential, reason: 'revoke' } });
});

test('OAuth methods match the controller without logging credential material', () => {
  const authorize = { clientId: 'client', redirectUri: 'https://example.test', state: 'state', codeChallenge: 'a'.repeat(43), codeChallengeMethod: 'S256' as const };
  api.oauthAuthorize(authorize, key); expect(apiClient.post).toHaveBeenCalledWith(`${base}/oauth/authorize`, authorize, opts);
  api.oauthConsent({ grantId: 'grant', decision: 'GRANTED' }, key); expect(apiClient.post).toHaveBeenCalledWith(`${base}/oauth/consent`, { grantId: 'grant', decision: 'GRANTED' }, opts);
  api.oauthIssueCode('grant', key); expect(apiClient.post).toHaveBeenCalledWith(`${base}/oauth/code`, { grantId: 'grant' }, opts);
  const exchange = { clientId: 'client', code: 'code', redirectUri: 'https://example.test', codeVerifier: 'a'.repeat(43) };
  api.oauthExchange(exchange, key); expect(apiClient.post).toHaveBeenCalledWith(`${base}/oauth/token`, exchange, opts);
  api.oauthRevoke('token-value', key); expect(apiClient.post).toHaveBeenCalledWith(`${base}/oauth/revoke`, { token: 'token-value' }, opts);
  api.oauthGrants({ limit: 25, cursor: 'cursor' }); expect(apiClient.get).toHaveBeenCalledWith(`${base}/oauth/grants`, { searchParams: { limit: 25, cursor: 'cursor' } });
  api.oauthRevokeGrant('grant/id', key); expect(apiClient.post).toHaveBeenCalledWith(`${base}/oauth/grants/grant%2Fid/revoke`, {}, opts);
});

test('integration reads send their own authorization directly to the tenant API, never through the session proxy', async () => {
  const client = { clientId: 'client', name: 'Partner', environment: 'SANDBOX', apiVersion: 'v1' };
  const profile = { id: 'user', email: 'customer@example.test', displayName: null, locale: 'en' };
  const send = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: client }) })
    .mockResolvedValueOnce({ ok: true, json: async () => profile });
  const previous = global.fetch;
  global.fetch = send as typeof fetch;
  try {
    const request = { apiOrigin: 'https://tenant.example.test', environment: 'sandbox' as const, version: 'v1',
      credential: { type: 'apiKey' as const, keyId: 'devkey_abc', secret: 'devsec_def' } };
    expect(await api.integrationClient(request)).toEqual(client);
    expect(send).toHaveBeenNthCalledWith(1, new URL('https://tenant.example.test/v1/developer-platform/integration/sandbox/client'),
      expect.objectContaining({ method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
        headers: { accept: 'application/json', authorization: 'Developer devkey_abc.devsec_def', 'x-api-version': 'v1' } }));
    const oauth = { ...request, credential: { type: 'oauth' as const, token: 'dvc_token' } };
    expect(await api.integrationProfile(oauth)).toEqual(profile);
    expect(send).toHaveBeenNthCalledWith(2, new URL('https://tenant.example.test/v1/developer-platform/integration/sandbox/profile'),
      expect.objectContaining({ headers: { accept: 'application/json', authorization: 'Bearer dvc_token', 'x-api-version': 'v1' } }));
    await expect(api.integrationProfile(request)).rejects.toThrow('User authorization is required');
    await expect(api.integrationClient({ ...request, apiOrigin: 'http://tenant.example.test' })).rejects.toThrow('Invalid integration request');
    await expect(api.integrationClient({ ...request, apiOrigin: 'https://tenant.example.test/path' })).rejects.toThrow('Invalid integration request');
    await expect(api.integrationClient({ ...oauth, credential: { type: 'oauth', token: 'value\r\nheader' } })).rejects.toThrow('Invalid integration credential');
    expect(send).toHaveBeenCalledTimes(2);
  } finally { global.fetch = previous; }
});

test('integration reads reject malformed and mismatched success responses and hide server errors', async () => {
  const previous = global.fetch;
  const send = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ clientId: 'id', name: 'x', environment: 'PRODUCTION', apiVersion: 'v1' }) })
    .mockResolvedValueOnce({ ok: false, json: async () => ({ message: 'sensitive server detail' }) });
  global.fetch = send as typeof fetch;
  try {
    const request = { apiOrigin: 'https://tenant.example.test', environment: 'sandbox' as const, version: 'v1',
      credential: { type: 'oauth' as const, token: 'dvc_token' } };
    await expect(api.integrationClient(request)).rejects.toThrow('Invalid integration response');
    await expect(api.integrationClient(request)).rejects.toThrow('Integration request failed');
  } finally { global.fetch = previous; }
});

test('webhook endpoint, signing secret, replay and delivery contracts match the controller', () => {
  const input = { applicationId: 'a', endpointUrl: 'https://example.test/hook', eventTypes: ['order.created'] };
  api.createWebhook(input, key); expect(apiClient.post).toHaveBeenCalledWith(`${base}/webhooks`, input, opts);
  api.listWebhooks({ status: 'ACTIVE' }); expect(apiClient.get).toHaveBeenCalledWith(`${base}/webhooks`, { searchParams: { status: 'ACTIVE' } });
  api.updateWebhook(hook, { description: 'updated' }, key); expect(apiClient.patch).toHaveBeenCalledWith(webhookPath, { description: 'updated' }, opts);
  api.webhookAction(hook, { action: 'pause' }, key); expect(apiClient.post).toHaveBeenCalledWith(`${webhookPath}/actions`, { action: 'pause' }, opts);
  api.pauseWebhook(hook, key); expect(apiClient.post).toHaveBeenCalledWith(`${webhookPath}/pause`, {}, opts);
  api.resumeWebhook(hook, key); expect(apiClient.post).toHaveBeenCalledWith(`${webhookPath}/resume`, {}, opts);
  api.revokeWebhook(hook, key); expect(apiClient.post).toHaveBeenCalledWith(`${webhookPath}/revoke`, {}, opts);
  api.rotateWebhookSecret(hook, key); expect(apiClient.post).toHaveBeenCalledWith(`${webhookPath}/rotate-secret`, undefined, opts);
  api.replayWebhook(hook, 'event-id', key); expect(apiClient.post).toHaveBeenCalledWith(`${webhookPath}/replay`, { eventId: 'event-id' }, opts);
  api.listDeliveries(hook, { state: 'FAILED' }); expect(apiClient.get).toHaveBeenCalledWith(`${webhookPath}/deliveries`, { searchParams: { state: 'FAILED' } });
  api.eventTypes(); expect(apiClient.get).toHaveBeenCalledWith(`${base}/event-types`);
});

test('usage, analytics, audit, version and reconciliation read routes match', () => {
  api.usage({ applicationId: 'a' }); expect(apiClient.get).toHaveBeenCalledWith(`${base}/usage`, { searchParams: { applicationId: 'a' } });
  api.analytics({ applicationId: 'a', apiVersion: 'v1' }); expect(apiClient.get).toHaveBeenCalledWith(`${base}/analytics`, { searchParams: { applicationId: 'a', apiVersion: 'v1' } });
  api.audit({ cursor: 'cursor' }); expect(apiClient.get).toHaveBeenCalledWith(`${base}/audit`, { searchParams: { cursor: 'cursor' } });
  api.versions(); expect(apiClient.get).toHaveBeenCalledWith(`${base}/api-versions`);
  api.applicationVersion(app); expect(apiClient.get).toHaveBeenCalledWith(`${appPath}/api-version`);
  api.pinApplicationVersion(app, 'v2', key); expect(apiClient.put).toHaveBeenCalledWith(`${appPath}/api-version`, { version: 'v2' }, opts);
  api.reconciliation('tenant'); expect(apiClient.get).toHaveBeenCalledWith(`${base}/reconciliation`, { searchParams: { tenantId: 'tenant' } });
});


test('each webhook operation requests and validates its distinct action-bound proof', async () => {
  for (const action of ['WEBHOOK_CREATE', 'WEBHOOK_UPDATE', 'WEBHOOK_PAUSE', 'WEBHOOK_RESUME', 'WEBHOOK_REVOKE', 'WEBHOOK_SECRET_ROTATE', 'WEBHOOK_REPLAY'] as const) {
    jest.mocked(apiClient.post).mockResolvedValueOnce({ proofId: 'proof', action, method: 'TOTP', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await api.verifyStepUp(action, 'TOTP', '123456', key);
    expect(apiClient.post).toHaveBeenLastCalledWith('/v1/auth/step-up/verify', { action, method: 'TOTP', code: '123456' }, opts);
  }
});

test('does not proceed on a malformed, expired, or wrong-action proof', async () => {
  for (const proof of [{ ok: true }, { proofId: 'proof', action: 'WEBHOOK_CREATE', method: 'TOTP', expiresAt: '2000-01-01T00:00:00Z' }, { proofId: 'proof', action: 'WEBHOOK_UPDATE', method: 'TOTP', expiresAt: '2099-01-01T00:00:00Z' }]) {
    jest.mocked(apiClient.post).mockResolvedValueOnce(proof);
    await expect(api.verifyStepUp('WEBHOOK_CREATE', 'TOTP', '123456', key)).rejects.toThrow('Invalid verification response');
  }
});
