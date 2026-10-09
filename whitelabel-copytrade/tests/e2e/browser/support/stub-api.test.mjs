// # Responsibility: proves the browser suite's stub upstream enforces its own contract - envelope, auth, parameter matching and the unmatched-route behaviour the specs rely on.
//
// The stub is test infrastructure, and infrastructure that silently fabricates a response is worse
// than no infrastructure: it would make every browser spec pass against data the real API never
// sends. These tests run without a browser (`node --test`), which is why they can be verified on a
// machine where chromium cannot start.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { createStubApi } from './stub-api.mjs';
import { E2E_ACCESS_TOKEN } from './fixtures.mjs';

const PORT = 4699;
let stub;

before(async () => {
  stub = createStubApi({ port: PORT });
  await stub.listen();
});

after(async () => {
  if (stub) await stub.close();
});

async function call(path, { method = 'GET', token = E2E_ACCESS_TOKEN, body } = {}) {
  const response = await fetch(`${stub.baseUrl}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload };
}

test('login answers the session envelope the web login route unwraps', async () => {
  const { status, payload } = await call('/v1/auth/login', {
    method: 'POST',
    token: null,
    body: { email: 'e2e-follower@example.test', password: 'irrelevant-to-the-stub' },
  });
  assert.equal(status, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.data.tokens.accessToken, E2E_ACCESS_TOKEN);
  assert.equal(payload.data.user.email, 'e2e-follower@example.test');
});

test('every route except login requires the session token', async () => {
  const anonymous = await call('/v1/copy-trading/traders', { token: null });
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.payload.error.code, 'UNAUTHORIZED');

  const withToken = await call('/v1/copy-trading/traders');
  assert.equal(withToken.status, 200);
  assert.equal(withToken.payload.success, true);
});

test('the paged discovery payload is the shape parsePaged expects', async () => {
  const { payload } = await call('/v1/copy-trading/traders');
  assert.ok(Array.isArray(payload.data.data), 'data.data must be an array');
  assert.equal(typeof payload.data.total, 'number');
  assert.equal(payload.data.total, payload.data.data.length);
});

test('query parameters filter the trader list the way the page asks', async () => {
  const all = await call('/v1/copy-trading/traders');
  assert.equal(all.payload.data.total, 2);

  const search = await call('/v1/copy-trading/traders?search=Alpha');
  assert.equal(search.payload.data.total, 1);
  assert.equal(search.payload.data.data[0].traderId, 'trader-alpha');

  const featured = await call('/v1/copy-trading/traders?isFeatured=true');
  assert.equal(featured.payload.data.total, 1);
  assert.equal(featured.payload.data.data[0].isFeatured, true);

  const verified = await call('/v1/copy-trading/traders?verificationState=UNVERIFIED');
  assert.equal(verified.payload.data.total, 1);
  assert.equal(verified.payload.data.data[0].traderId, 'trader-beta');
});

test('path parameters reach the handler, and an unknown trader is a 404 rather than an empty object', async () => {
  const known = await call('/v1/copy-trading/traders/trader-alpha');
  assert.equal(known.status, 200);
  assert.equal(known.payload.data.traderId, 'trader-alpha');

  const unknown = await call('/v1/copy-trading/traders/trader-does-not-exist');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.payload.error.code, 'NOT_FOUND');
});

test('pausing a subscription changes what the detail route returns', async () => {
  const before = await call('/v1/copy-trading/subscriptions/sub-e2e-1');
  assert.equal(before.payload.data.state, 'ACTIVE');

  const paused = await call('/v1/copy-trading/subscriptions/sub-e2e-1/pause', { method: 'POST' });
  assert.equal(paused.status, 200);

  const afterPause = await call('/v1/copy-trading/subscriptions/sub-e2e-1');
  assert.equal(afterPause.payload.data.state, 'PAUSED');
  assert.equal(afterPause.payload.data.pausedAt !== null, true);
});

test('the three calls the subscription detail view composes are all declared', async () => {
  const subscription = await call('/v1/copy-trading/subscriptions/sub-e2e-1');
  const policy = await call('/v1/copy-trading/policies/effective?subscriptionId=sub-e2e-1');
  const executions = await call('/v1/copy-trading/executions?subscriptionId=sub-e2e-1&page=1&limit=20');

  assert.equal(subscription.payload.data.subscriptionId, 'sub-e2e-1');
  assert.equal(policy.payload.data.sizingMode, 'FIXED');
  assert.equal(executions.payload.data.data.length, 1);
  assert.equal(executions.payload.data.data[0].executionId, 'exec-e2e-1');
  assert.equal(executions.payload.data.data[0].followerOrderId, 'follower-order-1');

  const log = await call('/__stub/requests');
  assert.equal(log.payload.data.unmatched.length, 0);
});

test('mode toggles drive the unavailable-ranking state the fail-closed spec asserts', async () => {
  await call('/__stub/mode', { method: 'POST', body: { rankingUnavailable: true } });
  const unavailable = await call('/v1/copy-trading/rankings');
  assert.equal(unavailable.payload.data.methodology.status, 'UNAVAILABLE');
  assert.equal(unavailable.payload.data.data.length, 0);

  await call('/__stub/mode', { method: 'POST', body: { rankingUnavailable: false } });
  const available = await call('/v1/copy-trading/rankings');
  assert.equal(available.payload.data.methodology.status, 'AVAILABLE');
  assert.equal(available.payload.data.data.length, 2);
});

test('an undeclared route is a named 404 recorded for the specs to assert on', async () => {
  const missing = await call('/v1/definitely/not/declared');
  assert.equal(missing.status, 404);
  assert.equal(missing.payload.error.code, 'STUB_API_UNMATCHED_ROUTE');
  assert.match(missing.payload.error.message, /stub-api\.mjs/);

  const log = await call('/__stub/requests');
  assert.equal(log.status, 200);
  assert.ok(
    log.payload.data.unmatched.some((entry) => entry.path === '/v1/definitely/not/declared'),
    'the unmatched request must be visible to the suite',
  );
});

test('reset clears the request log, the mode and the pause', async () => {
  await call('/__stub/reset', { method: 'POST' });
  const log = await call('/__stub/requests');
  const detail = await call('/v1/copy-trading/subscriptions/sub-e2e-1');
  assert.equal(log.payload.data.requests.length >= 1, true, 'the log call itself is recorded after the reset');
  assert.equal(log.payload.data.mode.rankingUnavailable, false);
  assert.equal(log.payload.data.unmatched.length, 0);
  assert.equal(detail.payload.data.state, 'ACTIVE');
});
