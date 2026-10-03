/**
 * Round 7 D3: BFF logout and the IdP session (OIDC RP-initiated logout).
 *
 * POST /api/auth/logout asks the API for the IdP logout URL of the CURRENT
 * session while the access token is still valid, revokes the local session
 * (always), clears the cookies, and returns either /login or the IdP's
 * https end-session URL as `redirectTo`. Nothing about the IdP can stop the
 * local logout.
 */

const serverFetch = jest.fn();
const clearSession = jest.fn();

jest.mock('@/lib/server-api', () => ({ serverFetch: (...args: unknown[]) => serverFetch(...args) }));
jest.mock('@/lib/session', () => ({ clearSession: () => clearSession() }));

import { POST } from '@/app/api/auth/logout/route';

async function redirectOf(): Promise<string> {
  const response = await POST();
  const body = (await response.json()) as { success: boolean; data: { redirectTo: string } };
  expect(body.success).toBe(true);
  return body.data.redirectTo;
}

function apiReturns(logoutUrlResult: unknown) {
  serverFetch.mockImplementation(async (path: string) => {
    if (path === '/auth/sso/logout-url') {
      if (logoutUrlResult instanceof Error) throw logoutUrlResult;
      return logoutUrlResult;
    }
    if (path === '/auth/logout') return { loggedOut: true, sessionsRevoked: 1 };
    throw new Error(`unexpected path ${path}`);
  });
}

describe('BFF POST /api/auth/logout', () => {
  beforeEach(() => {
    serverFetch.mockReset();
    clearSession.mockReset();
  });

  it('an OIDC SSO session is sent to the IdP end-session URL after the local logout', async () => {
    apiReturns({ logoutUrl: 'https://idp.acme.test/oidc/logout?client_id=app', providerType: 'OIDC', reason: null });
    await expect(redirectOf()).resolves.toBe('https://idp.acme.test/oidc/logout?client_id=app');
    // The URL is fetched first (token still valid), then the session is revoked.
    expect(serverFetch.mock.calls.map((c) => c[0])).toEqual(['/auth/sso/logout-url', '/auth/logout']);
    expect(clearSession).toHaveBeenCalledTimes(1);
  });

  it('a password session, or a SAML session without Single Logout, goes to /login', async () => {
    apiReturns({ logoutUrl: null, providerType: null, reason: 'NOT_SSO_SESSION' });
    await expect(redirectOf()).resolves.toBe('/login');
    apiReturns({ logoutUrl: null, providerType: 'SAML', reason: 'SAML_SLO_NOT_CONFIGURED' });
    await expect(redirectOf()).resolves.toBe('/login');
  });

  it('round 8: a SAML session with Single Logout is sent to the IdP SingleLogoutService after the local logout', async () => {
    const slo = 'https://idp.acme.test/saml/slo?SAMLRequest=fZJN&RelayState=abc&SigAlg=http%3A%2F%2Fwww.w3.org%2F2001%2F04%2Fxmldsig-more%23rsa-sha256&Signature=c2ln';
    apiReturns({ logoutUrl: slo, providerType: 'SAML', reason: null });
    // Byte-for-byte: the IdP verifies the redirect-binding signature over these exact query bytes.
    await expect(redirectOf()).resolves.toBe(slo);
    expect(serverFetch.mock.calls.map((c) => c[0])).toEqual(['/auth/sso/logout-url', '/auth/logout']);
    expect(clearSession).toHaveBeenCalledTimes(1);
  });

  it('a non-https or malformed URL is never followed', async () => {
    for (const logoutUrl of ['http://idp.acme.test/logout', 'javascript:alert(1)', '/relative', 'not a url']) {
      apiReturns({ logoutUrl, providerType: 'OIDC', reason: null });
      await expect(redirectOf()).resolves.toBe('/login');
    }
  });

  it('when the logout-url lookup fails, the local logout still happens', async () => {
    apiReturns(new Error('API down'));
    await expect(redirectOf()).resolves.toBe('/login');
    expect(serverFetch).toHaveBeenCalledWith('/auth/logout', { method: 'POST' });
    expect(clearSession).toHaveBeenCalledTimes(1);
  });

  it('when the local revoke fails, cookies are still cleared', async () => {
    serverFetch.mockImplementation(async (path: string) => {
      if (path === '/auth/sso/logout-url') return { logoutUrl: null, providerType: null, reason: 'NOT_SSO_SESSION' };
      throw new Error('revoke failed');
    });
    await expect(redirectOf()).resolves.toBe('/login');
    expect(clearSession).toHaveBeenCalledTimes(1);
  });
});
