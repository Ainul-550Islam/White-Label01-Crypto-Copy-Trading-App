import { confirmApplicationCreate, confirmApplicationScopes, confirmApplicationUpdate, confirmIssuedCredential, confirmReplay, confirmState, confirmVersion, confirmWebhook, confirmWebhookSecret } from '@/features/developer/mutation-response';

const appInput = { name: 'App', description: '', redirectUris: ['https://app.example/callback'], environment: 'SANDBOX' as const, requestedScopes: ['profile:read', 'webhooks:manage'] };
const app = { id: 'app', clientId: 'client', ...appInput, scopes: [...appInput.requestedScopes].reverse() };
const hookInput = { applicationId: 'app', endpointUrl: 'https://hooks.example/path', eventTypes: ['order.filled'], description: '' };
const hook = { id: 'hook', ...hookInput };
const key = { keyId: `devkey_${'a'.repeat(40)}`, secret: `devsec_${'b'.repeat(64)}`, scopes: ['profile:read'], expiresAt: null };
const webhookSecret = { secret: `whsec_${'c'.repeat(64)}` };

test('confirms only application responses matching the submitted intent', () => {
  expect(() => confirmApplicationCreate(app, appInput)).not.toThrow();
  expect(() => confirmApplicationCreate({ ...app, environment: 'PRODUCTION' }, appInput)).toThrow();
  expect(() => confirmApplicationCreate({ ...app, scopes: ['profile:read'] }, appInput)).toThrow();
  expect(() => confirmApplicationUpdate(app, 'app', appInput)).not.toThrow();
  expect(() => confirmApplicationUpdate({ ...app, id: 'other' }, 'app', appInput)).toThrow();
  expect(() => confirmApplicationScopes(app, 'app', appInput.requestedScopes)).not.toThrow();
  expect(() => confirmApplicationScopes({ ...app, scopes: ['profile:read', 'profile:read'] }, 'app', appInput.requestedScopes)).toThrow();
  expect(() => confirmState({ id: 'app', state: 'ACTIVE' }, 'app', ['ACTIVE'])).not.toThrow();
  expect(() => confirmState({ id: 'other', state: 'ACTIVE' }, 'app', ['ACTIVE'])).toThrow();
  expect(() => confirmState({ id: 'app', state: 'SUSPENDED' }, 'app', ['ACTIVE'])).toThrow();
});

test('rejects absent, malformed or replayed one-time credentials', () => {
  expect(() => confirmIssuedCredential(key)).not.toThrow();
  expect(() => confirmIssuedCredential(key, key.keyId)).toThrow();
  expect(() => confirmIssuedCredential({ ...key, secret: '[REDACTED]' })).toThrow();
  expect(() => confirmIssuedCredential({ ...key, keyId: '' })).toThrow();
  expect(() => confirmIssuedCredential({ ...key, expiresAt: 'not-a-date' })).toThrow();
  expect(() => confirmWebhookSecret(webhookSecret)).not.toThrow();
  expect(() => confirmWebhookSecret({ secret: 'wrong' })).toThrow();
});

test('confirms webhook, replay and version acknowledgements for the intended resource', () => {
  expect(() => confirmWebhook(hook, hookInput)).not.toThrow();
  expect(() => confirmWebhook(hook, hookInput, 'hook')).not.toThrow();
  expect(() => confirmWebhook({ ...hook, endpointUrl: 'https://other.example' }, hookInput)).toThrow();
  expect(() => confirmWebhook(hook, hookInput, 'other')).toThrow();
  expect(() => confirmReplay({ deliveryId: 'delivery', eventId: 'event' }, 'event')).not.toThrow();
  expect(() => confirmReplay({ deliveryId: 'delivery', eventId: 'other' }, 'event')).toThrow();
  expect(() => confirmVersion({ applicationId: 'app', version: 'v2' }, 'app', 'v2')).not.toThrow();
  expect(() => confirmVersion({ applicationId: 'app', version: 'v1' }, 'app', 'v2')).toThrow();
});
