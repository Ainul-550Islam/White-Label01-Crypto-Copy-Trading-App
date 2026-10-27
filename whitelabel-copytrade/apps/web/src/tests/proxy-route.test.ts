import { GET, HEAD, OPTIONS, POST } from '../app/api/proxy/[...path]/route';
import { getAccessToken, getCsrfToken } from '../lib/session';

jest.mock('../lib/env', () => ({ serverEnv: () => ({ API_BASE_URL: 'https://api.example.test/api' }) }));
jest.mock('../lib/session', () => ({ getAccessToken: jest.fn(), getCsrfToken: jest.fn() }));

const upstream = jest.fn();
const originalFetch = global.fetch;
const context = (path: string[]) => ({ params: Promise.resolve({ path }) });

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = upstream;
  jest.mocked(getAccessToken).mockResolvedValue(null);
  jest.mocked(getCsrfToken).mockResolvedValue('csrf');
  upstream.mockResolvedValue(new Response('{}', { status: 200 }));
});
afterAll(() => { global.fetch = originalFetch; });

test('only the exact anonymous fee schedule GET is forwarded', async () => {
  const response = await GET(new Request('https://web.example.test/api/proxy/v1/public/fee-schedule'), context(['v1', 'public', 'fee-schedule']));
  expect(response.status).toBe(200);
  const [url, init] = upstream.mock.calls[0] as [string, RequestInit];
  expect(url).toBe('https://api.example.test/api/v1/public/fee-schedule');
  expect((init.headers as Record<string, string>).authorization).toBeUndefined();
});

test('trailing and encoded paths never inherit the anonymous exemption', async () => {
  for (const url of ['https://web.example.test/api/proxy/public/fee-schedule/', 'https://web.example.test/api/proxy/%70ublic/fee-schedule']) {
    const response = await GET(new Request(url), context(['public', 'fee-schedule']));
    expect(response.status).toBe(401);
  }
  const traversal = await GET(new Request('https://web.example.test/api/proxy/unused'), context(['public', 'fee-schedule', '%252e%252e']));
  expect(traversal.status).toBe(400);
  expect(upstream).not.toHaveBeenCalled();
});

test('HEAD, OPTIONS and POST require a session even for the public fee path', async () => {
  const url = 'https://web.example.test/api/proxy/public/fee-schedule';
  expect((await HEAD(new Request(url, { method: 'HEAD' }), context(['public', 'fee-schedule']))).status).toBe(401);
  expect((await OPTIONS(new Request(url, { method: 'OPTIONS' }), context(['public', 'fee-schedule']))).status).toBe(401);
  expect((await POST(new Request(url, { method: 'POST', headers: { 'x-csrf-token': 'csrf' } }), context(['public', 'fee-schedule']))).status).toBe(401);
  expect(upstream).not.toHaveBeenCalled();
});

test('forwards a bounded idempotency key only for an authenticated mutation', async () => {
  jest.mocked(getAccessToken).mockResolvedValue('session-token');
  const url = 'https://web.example.test/api/proxy/developer-platform/oauth/grants/123/revoke';
  await POST(new Request(url, { method: 'POST', headers: { 'x-csrf-token': 'csrf', 'idempotency-key': 'oauth-revoke-123456', 'x-untrusted': 'no' } }), context(['developer-platform', 'oauth', 'grants', '123', 'revoke']));
  const [, init] = upstream.mock.calls[0] as [string, RequestInit];
  expect((init.headers as Record<string, string>)['idempotency-key']).toBe('oauth-revoke-123456');
  expect((init.headers as Record<string, string>)['x-untrusted']).toBeUndefined();
});
