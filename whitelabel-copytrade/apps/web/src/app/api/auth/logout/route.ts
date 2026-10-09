import { NextResponse } from 'next/server';
import { serverFetch } from '@/lib/server-api';
import { clearSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SsoLogoutUrlResult {
  logoutUrl: string | null;
  providerType: 'OIDC' | 'SAML' | null;
  reason: string | null;
}

/**
 * Only an absolute https URL is followed (the OP's end_session_endpoint, or
 * the SAML IdP's SingleLogoutService URL with a signed LogoutRequest);
 * anything else falls back to the local login page.
 */
function safeIdpLogoutUrl(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function POST(): Promise<NextResponse> {
  let redirectTo = '/login';

  // 1. While the access token is still valid, ask whether this session was
  //    created by an IdP; if so, the browser is sent to the IdP after the
  //    local logout: the OIDC end-session endpoint (RP-initiated logout) or
  //    the SAML SingleLogoutService with a signed LogoutRequest (Single
  //    Logout; the IdP answers at /v1/auth/sso/saml/slo). Password sessions,
  //    and SSO sessions whose provider logout is not configured, get no URL.
  //    A failure here never blocks the local logout.
  try {
    const sso = await serverFetch<SsoLogoutUrlResult>('/auth/sso/logout-url', { method: 'POST' });
    redirectTo = safeIdpLogoutUrl(sso?.logoutUrl) ?? '/login';
  } catch {
    redirectTo = '/login';
  }

  // 2. Revoke the local session (always), then clear the cookies.
  try {
    await serverFetch('/auth/logout', { method: 'POST' });
  } catch {
    // Ignore logout errors, clear cookies anyway
  } finally {
    await clearSession();
  }

  const response = NextResponse.json({ success: true, data: { redirectTo } });
  response.cookies.delete('wlct_2fa');
  response.cookies.delete('wlct_2fa_did');
  return response;
}
