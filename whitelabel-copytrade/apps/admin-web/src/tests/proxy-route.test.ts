import { POST, GET } from '../app/api/proxy/[...path]/route';

jest.mock('@/lib/env', () => ({
  publicEnv: { apiVersion: 'v1' },
  serverEnv: () => ({ API_BASE_URL: 'https://api.example.test/api', ADMIN_TENANT_SLUG: 'tenant' }),
}));
jest.mock('@/lib/session', () => ({
  getAccessToken: jest.fn(async () => 'token'),
  getCsrfToken: jest.fn(async () => 'csrf'),
}));

describe('admin proxy', () => {
  const upstream = jest.fn();
  beforeEach(() => {
    upstream.mockReset();
    upstream.mockResolvedValue(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    global.fetch = upstream;
  });

  it('forwards the configured version once and preserves a mutation idempotency key', async () => {
    const req = new Request('https://admin.example.test/api/proxy/v1/developer-platform/webhooks/id/replay', {
      method: 'POST',
      headers: { 'x-csrf-token': 'csrf', 'content-type': 'application/json', 'Idempotency-Key': 'request-123' },
      body: JSON.stringify({ eventId: 'event-123' }),
    });
    const res = await POST(req, { params: Promise.resolve({ path: ['v1', 'developer-platform', 'webhooks', 'id', 'replay'] }) });
    expect(res.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(upstream.mock.calls[0]?.[0]).toBe('https://api.example.test/api/v1/developer-platform/webhooks/id/replay');
    const options = upstream.mock.calls[0]?.[1] as RequestInit;
    expect(options.headers).toMatchObject({ 'Idempotency-Key': 'request-123', authorization: 'Bearer token' });
  });

  it('adds the configured version when the browser omitted it', async () => {
    const req = new Request('https://admin.example.test/api/proxy/developer-platform/api-versions');
    await GET(req, { params: Promise.resolve({ path: ['developer-platform', 'api-versions'] }) });
    expect(upstream.mock.calls[0]?.[0]).toBe('https://api.example.test/api/v1/developer-platform/api-versions');
  });

  it('strips stored signing material before a webhook response reaches the browser', async () => {
    upstream.mockResolvedValue(new Response(JSON.stringify({ success: true, data: {
      subscription: { id: 'id', endpointUrl: 'https://hook.example', secretHash: 'digest', secretEncrypted: 'cipher', idempotencyKey: 'internal' },
      secret: 'one-time-secret',
    } }), { status: 201, headers: { 'content-type': 'application/json' } }));
    const req = new Request('https://admin.example.test/api/proxy/v1/developer-platform/webhooks', {
      method: 'POST', headers: { 'x-csrf-token': 'csrf', 'Idempotency-Key': 'request-123' }, body: '{}',
    });
    const res = await POST(req, { params: Promise.resolve({ path: ['v1', 'developer-platform', 'webhooks'] }) });
    const body = await res.json() as { data: { subscription: Record<string, unknown>; secret: string } };
    expect(body.data.secret).toBe('one-time-secret');
    expect(body.data.subscription).toEqual({ id: 'id', endpointUrl: 'https://hook.example' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('does not forward encoded traversal or separators', async () => {
    const req = new Request('https://admin.example.test/api/proxy/a');
    const res = await GET(req, { params: Promise.resolve({ path: ['v1', 'x%252e%252e', 'data'] }) });
    expect(res.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('rejects an invalid idempotency key without calling the API', async () => {
    const req = new Request('https://admin.example.test/api/proxy/v1/example', {
      method: 'POST', headers: { 'x-csrf-token': 'csrf', 'Idempotency-Key': 'bad key' }, body: '{}',
    });
    const res = await POST(req, { params: Promise.resolve({ path: ['v1', 'example'] }) });
    expect(res.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
});
