/**
 * Deterministic SDK tests (node:test): route contract parity with the
 * backend inventory, pagination, error normalization and webhook signature
 * verification. No network — the transport is an in-process fake.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  APPLICATION_STATES,
  DEVELOPER_EVENT_TYPES,
  DEVELOPER_SCOPES,
  DeveloperApiError,
  DeveloperPlatformClient,
  verifyWebhook,
} from '../index';

interface RecordedCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

function makeClient(routes: Map<string, { status: number; body: unknown }>) {
  const calls: RecordedCall[] = [];
  const transport = async (input: string, init: RequestInit) => {
    const url = new URL(input);
    const key = `${init.method ?? 'GET'} ${url.pathname}`;
    calls.push({
      method: init.method ?? 'GET',
      path: `${url.pathname}${url.search}`,
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const route = routes.get(key);
    if (!route) {
      return new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'no such route' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (route.status === 204) {
      return new Response(null, { status: 204, headers: { 'x-correlation-id': 'corr-test' } });
    }
    return new Response(JSON.stringify(route.body ?? {}), {
      status: route.status,
      headers: { 'content-type': 'application/json', 'x-correlation-id': 'corr-test' },
    });
  };
  const client = new DeveloperPlatformClient({
    baseUrl: 'https://api.example.test',
    auth: { kind: 'bearer', token: 'tok' },
    transport,
  });
  return { client, calls };
}

test('SDK route inventory: every method hits exactly its backend route', async () => {
  const routes = new Map([
    ['GET /developer-platform/api-versions', { status: 200, body: { versions: [{ version: 'v2', state: 'SUPPORTED' }] } }],
    ['GET /developer-platform/event-types', { status: 200, body: { eventTypes: [] } }],
    ['POST /developer-platform/applications', { status: 201, body: { id: 'app-1', state: 'PENDING' } }],
    ['GET /developer-platform/applications/app-1', { status: 200, body: { id: 'app-1' } }],
    ['PATCH /developer-platform/applications/app-1', { status: 200, body: { id: 'app-1' } }],
    ['POST /developer-platform/applications/app-1/transitions', { status: 200, body: { id: 'app-1', state: 'ACTIVE' } }],
    ['POST /developer-platform/applications/app-1/redirect-uris', { status: 200, body: { id: 'app-1' } }],
    ['PUT /developer-platform/applications/app-1/scopes', { status: 200, body: { id: 'app-1' } }],
    ['POST /developer-platform/applications/app-1/credentials', { status: 201, body: { keyId: 'k', secret: 's', scopes: [], expiresAt: null } }],
    ['POST /developer-platform/applications/app-1/credentials/k/rotate', { status: 201, body: { keyId: 'k2', secret: 's2', scopes: [], expiresAt: null } }],
    ['DELETE /developer-platform/applications/app-1/credentials/k', { status: 204, body: undefined }],
    ['GET /developer-platform/credentials', { status: 200, body: { rows: [], nextCursor: null } }],
    ['POST /developer-platform/oauth/token', { status: 200, body: { accessToken: 'at', tokenType: 'Bearer', expiresIn: 3600, scope: 'profile:read' } }],
    ['POST /developer-platform/oauth/revoke', { status: 204, body: undefined }],
    ['POST /developer-platform/webhooks', { status: 201, body: { subscription: { id: 'wh-1' }, secret: 'whsec_x' } }],
    ['GET /developer-platform/webhooks', { status: 200, body: { rows: [], nextCursor: null } }],
    ['PATCH /developer-platform/webhooks/wh-1', { status: 200, body: { id: 'wh-1' } }],
    ['POST /developer-platform/webhooks/wh-1/actions', { status: 200, body: { id: 'wh-1', state: 'PAUSED' } }],
    ['POST /developer-platform/webhooks/wh-1/rotate-secret', { status: 201, body: { secret: 'whsec_y' } }],
    ['POST /developer-platform/webhooks/wh-1/replay', { status: 202, body: { deliveryId: 'd2', eventId: 'evt-1' } }],
    ['GET /developer-platform/webhooks/wh-1/deliveries', { status: 200, body: { rows: [], nextCursor: null } }],
    ['GET /developer-platform/usage', { status: 200, body: { totalRequests: 0, totalRateLimited: 0, totalWebhookDeliveries: 0, totalWebhookFailures: 0, byEndpoint: [], byApiVersion: [] } }],
    ['GET /developer-platform/analytics', { status: 200, body: { p95LatencyMs: null } }],
  ]);
  const { client, calls } = makeClient(routes);
  await client.meta.apiVersions();
  await client.meta.eventTypes();
  await client.applications.create({ name: 'n', description: 'd', redirectUris: ['https://cb'] });
  await client.applications.get('app-1');
  await client.applications.update('app-1', { name: 'n2' });
  await client.applications.transition('app-1', 'ACTIVE', 'go');
  await client.applications.addRedirectUri('app-1', 'https://cb2');
  await client.applications.updateScopes('app-1', ['profile:read']);
  await client.credentials.create('app-1', { label: 'l' });
  await client.credentials.rotate('app-1', 'k');
  await client.credentials.revoke('app-1', 'k', 'done');
  await client.credentials.list().first();
  await client.oauth.exchangeToken({ clientId: 'c', code: 'x', redirectUri: 'https://cb' });
  await client.oauth.revoke('at');

  await client.webhooks.list().first();
  const created = await client.webhooks.create({ applicationId: 'app-1', endpointUrl: 'https://h', eventTypes: ['payment.succeeded'] });
  await client.webhooks.update(created.data.subscription.id, { description: 'd' });
  // (created subscription id asserted implicitly via route hit above)
  await client.webhooks.action(created.data.subscription.id, 'pause', 'maint');
  await client.webhooks.rotateSecret('wh-1');
  await client.webhooks.replay('wh-1', 'evt-1');
  await client.webhooks.deliveries('wh-1').first();
  await client.usage.rollup();
  await client.analytics.application('app-1');
  assert.equal(calls.length, 23);
  assert.ok(calls.every((call) => call.headers['X-Api-Version'] === 'v2'));
  assert.ok(calls.every((call) => typeof call.headers['x-correlation-id'] === 'string'));
  const paths = calls.map((call) => `${call.method} ${call.path.split('?')[0]}`);
  assert.ok(paths.includes('POST /developer-platform/applications/app-1/transitions'));
});

test('pagination follows nextCursor until exhaustion', async () => {
  const routes = new Map<string, { status: number; body: unknown }>();
  let page = 0;
  routes.set('GET /developer-platform/webhooks', {
    status: 200,
    get body() {
      page += 1;
      return page < 3 ? { rows: [`row-${page}`], nextCursor: `c${page}` } : { rows: ['row-3'], nextCursor: null };
    },
  });
  const { client } = makeClient(routes);
  const iterator = client.webhooks.list();
  const seen: unknown[] = [];
  let result = await iterator.first();
  seen.push(...result.rows);
  while (result.nextCursor) {
    result = await iterator.next(result.nextCursor);
    seen.push(...result.rows);
  }
  assert.deepEqual(seen.map((row) => String(row)), ['row-1', 'row-2', 'row-3']);
});

test('errors normalize with backend code, status and correlation id', async () => {
  const routes = new Map([['GET /developer-platform/usage', { status: 403, body: { code: 'SCOPE_NOT_AUTHORIZED', message: 'denied' } }]]);
  const { client } = makeClient(routes);
  await assert.rejects(
    client.usage.rollup(),
    (error: unknown) => {
      assert.ok(error instanceof DeveloperApiError);
      assert.equal(error.status, 403);
      assert.equal(error.code, 'SCOPE_NOT_AUTHORIZED');
      assert.equal(error.correlationId, 'corr-test');
      return true;
    },
  );
});

test('webhook verification: valid, tampered, stale, wrong secret', async () => {
  const secret = 'whsec_test';
  const rawBody = JSON.stringify({ id: 'pay-1' });
  const timestamp = 1_790_000_000;
  const canonical = `t=${timestamp}.id=evt-1.v=v1.${rawBody}`;
  const signature = `v1=${createHmac('sha256', secret).update(canonical).digest('hex')}`;
  const valid = await verifyWebhook({
    rawBody,
    secret,
    headers: {
      'x-webhook-timestamp': String(timestamp),
      'x-webhook-event-id': 'evt-1',
      'x-webhook-version': 'v1',
      'x-webhook-signature': signature,
    },
    nowSeconds: timestamp,
  });
  assert.equal(valid.eventId, 'evt-1');
  await assert.rejects(
    verifyWebhook({
      rawBody: rawBody.replace('pay-1', 'pay-2'),
      secret,
      headers: {
        'x-webhook-timestamp': String(timestamp),
        'x-webhook-event-id': 'evt-1',
        'x-webhook-version': 'v1',
        'x-webhook-signature': signature,
      },
      nowSeconds: timestamp,
    }),
    /does not verify/,
  );
  await assert.rejects(
    verifyWebhook({
      rawBody,
      secret,
      headers: {
        'x-webhook-timestamp': String(timestamp - 4_000),
        'x-webhook-event-id': 'evt-1',
        'x-webhook-version': 'v1',
        'x-webhook-signature': signature,
      },
      nowSeconds: timestamp,
    }),
    /timestamp/,
  );
  await assert.rejects(
    verifyWebhook({
      rawBody,
      secret: 'whsec_other',
      headers: {
        'x-webhook-timestamp': String(timestamp),
        'x-webhook-event-id': 'evt-1',
        'x-webhook-version': 'v1',
        'x-webhook-signature': signature,
      },
      nowSeconds: timestamp,
    }),
    /does not verify/,
  );
});

test('catalogs are backend-pinned (16 scopes, 23 events, 5 states)', () => {
  assert.equal(DEVELOPER_SCOPES.length, 16);
  assert.equal(DEVELOPER_EVENT_TYPES.length, 23);
  assert.equal(APPLICATION_STATES.length, 5);
  assert.ok(DEVELOPER_SCOPES.includes('trading:execute'));
  assert.ok(DEVELOPER_EVENT_TYPES.includes('compliance.review.required'));
  assert.equal(APPLICATION_STATES[4], 'REVOKED');
});
