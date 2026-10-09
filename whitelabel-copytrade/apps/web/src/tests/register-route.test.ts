/**
 * Customer registration BFF route (POST /api/auth/register).
 */

const serverFetch = jest.fn();
const persistSession = jest.fn();

jest.mock('@/lib/server-api', () => ({ serverFetch: (...args: unknown[]) => serverFetch(...args) }));
jest.mock('@/lib/session', () => ({ persistSession: (...args: unknown[]) => persistSession(...args) }));

import { POST } from '@/app/api/auth/register/route';
import { ApiError } from '@wlct/utils/api-error';

function makeRequest(body: unknown, host = 'acme.example.test'): Request {
  return new Request('https://acme.example.test/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host },
    body: JSON.stringify(body),
  });
}

describe('BFF POST /api/auth/register', () => {
  beforeEach(() => {
    serverFetch.mockReset();
    persistSession.mockReset();
  });

  it('registers a valid customer account, persists the session cookies, and redirects to /onboarding', async () => {
    serverFetch.mockResolvedValue({
      tokens: {
        accessToken: 'at-1',
        refreshToken: 'rt-1',
        expiresIn: 900,
        refreshExpiresIn: 604800,
      },
      user: { id: 'u-1', email: 'new@acme.example.test' },
      sessionId: 'sess-1',
    });

    const res = await POST(
      makeRequest({
        email: 'new@acme.example.test',
        password: 'StrongPassword!99',
        firstName: 'Ainul',
        lastName: 'Islam',
        locale: 'bn',
        acceptedTerms: true,
      }),
    );

    expect(res.status).toBe(201);
    const json = (await res.json()) as { success: boolean; data: { redirectTo: string } };
    expect(json).toEqual({
      success: true,
      data: { redirectTo: '/onboarding' },
    });
    expect(serverFetch).toHaveBeenCalledTimes(1);
    const [path, opts] = serverFetch.mock.calls[0] as [string, { body: Record<string, unknown>; host: string }];
    expect(path).toBe('/auth/register');
    expect(opts.host).toBe('acme.example.test');
    expect(opts.body).toMatchObject({
      email: 'new@acme.example.test',
      password: 'StrongPassword!99',
      firstName: 'Ainul',
      lastName: 'Islam',
      locale: 'bn',
      acceptedTerms: true,
      deviceName: 'Customer Web',
      platform: 'web',
    });
    expect(typeof opts.body.deviceId).toBe('string');
    expect(persistSession).toHaveBeenCalledTimes(1);
  });

  it('rejects registration when acceptedTerms is false or password is shorter than 12 characters', async () => {
    const res = await POST(
      makeRequest({
        email: 'new@acme.example.test',
        password: 'short',
        acceptedTerms: false,
      }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { success: boolean; error: { code: string } };
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(serverFetch).not.toHaveBeenCalled();
    expect(persistSession).not.toHaveBeenCalled();
  });

  it('forwards backend ApiError status and code when registration is refused', async () => {
    serverFetch.mockRejectedValue(
      new ApiError(409, 'EMAIL_ALREADY_REGISTERED', 'An account with this email already exists.'),
    );
    const res = await POST(
      makeRequest({
        email: 'existing@acme.example.test',
        password: 'StrongPassword!99',
        acceptedTerms: true,
      }),
    );
    expect(res.status).toBe(409);
    const json = (await res.json()) as { success: boolean; error: { code: string; message: string } };
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('EMAIL_ALREADY_REGISTERED');
    expect(persistSession).not.toHaveBeenCalled();
  });
});
