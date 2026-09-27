import 'server-only';

import { cookies } from 'next/headers';

/**
 * Session storage.
 *
 * Tokens live exclusively in httpOnly, SameSite=Strict cookies. They are never
 * written to localStorage and never serialised into a client component payload,
 * so an XSS bug in the console cannot exfiltrate a session. Browser code talks
 * to the API only through this app's own proxy route, which attaches the token
 * server-side.
 */
export const ACCESS_TOKEN_COOKIE = 'wlct_at';
export const REFRESH_TOKEN_COOKIE = 'wlct_rt';
export const DEVICE_ID_COOKIE = 'wlct_did';
export const CSRF_COOKIE = 'wlct_csrf';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

function baseCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    maxAge,
  };
}

export function persistSession(tokens: SessionTokens, deviceId: string, csrfToken: string): void {
  const store = cookies();

  store.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, baseCookieOptions(tokens.expiresIn));
  store.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken, baseCookieOptions(tokens.refreshExpiresIn));
  store.set(DEVICE_ID_COOKIE, deviceId, baseCookieOptions(tokens.refreshExpiresIn));

  // Double-submit CSRF token: readable by scripts on purpose so the client can
  // echo it in a header, while the cookie itself is same-site restricted.
  store.set(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: tokens.refreshExpiresIn,
  });
}

export function clearSession(): void {
  const store = cookies();
  for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, DEVICE_ID_COOKIE, CSRF_COOKIE]) {
    store.delete(name);
  }
}

export function getAccessToken(): string | null {
  return cookies().get(ACCESS_TOKEN_COOKIE)?.value ?? null;
}

export function getRefreshToken(): string | null {
  return cookies().get(REFRESH_TOKEN_COOKIE)?.value ?? null;
}

export function getDeviceId(): string {
  return cookies().get(DEVICE_ID_COOKIE)?.value ?? '';
}

export function getCsrfToken(): string | null {
  return cookies().get(CSRF_COOKIE)?.value ?? null;
}

/**
 * Decodes the access token payload for display purposes only.
 *
 * The signature is deliberately not verified here: the API is the only
 * authority on validity. Nothing in the console grants access based on this.
 */
export function decodeAccessTokenClaims(
  token: string,
): { sub: string; tid: string; roles: string[]; perms: string[]; plat: boolean; exp: number } | null {
  const segments = token.split('.');
  if (segments.length !== 3 || !segments[1]) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;

    return {
      sub: String(payload.sub ?? ''),
      tid: String(payload.tid ?? ''),
      roles: Array.isArray(payload.roles) ? (payload.roles as string[]) : [],
      perms: Array.isArray(payload.perms) ? (payload.perms as string[]) : [],
      plat: Boolean(payload.plat),
      exp: Number(payload.exp ?? 0),
    };
  } catch {
    return null;
  }
}
