// # Applies first-party admin authentication redirects and per-request security headers through the Next.js Proxy.
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Request proxy - the ONE request entrypoint of the admin console.
 *
 * Next 16 accepts a single request entrypoint per application and reads this
 * one; a sibling middleware entrypoint made `next build` fail outright ("both
 * middleware and proxy files detected"), which is why this file is the only
 * one that exists. The old module is gone, removed by the batch delete script
 * that ships beside this change.
 *
 * Nothing was dropped in that merge. The behaviour of the former middleware
 * module was, item by item:
 *
 *  1. `PUBLIC_PATHS` allowlist (`/login`, the three auth routes) - kept below
 *     and matched identically (exact or `/segment/...` prefix).
 *  2. A login redirect that preserves the intended destination in `?next=` for
 *     every non-public, non-`/api/` navigation without a session cookie -
 *     kept verbatim.
 *  3. The session cookie read (`wlct_at`), used only as a redirect
 *     optimisation; the API still validates every token.
 *  4. A per-request CSP nonce (`crypto.randomUUID()` with the dashes stripped),
 *     forwarded to the render as `x-nonce` and pinned in `script-src` -
 *     kept verbatim.
 *  5. The exact CSP directive list, including `'unsafe-eval'` only in
 *     development, `'unsafe-inline'` for styles, and `frame-ancestors 'none'`.
 *  6. `X-Content-Type-Options: nosniff` and
 *     `Referrer-Policy: strict-origin-when-cross-origin`.
 *  7. The matcher `/((?!_next/static|_next/image|favicon.ico).*)`.
 *
 * Items 1-7 are all present below. On top of them this file sets the static
 * security headers that only ever lived here (Permissions-Policy,
 * X-Frame-Options, COOP, CORP), which is why the two files were never
 * interchangeable: this one is a strict superset. The entrypoint test covering
 * this file asserts each of the seven behaviours individually so a future edit
 * cannot quietly drop one again.
 *
 * Two jobs, both cheap:
 *  1. Bounce unauthenticated navigation to /login before a server component
 *     tries (and fails) to fetch data.
 *  2. Attach a per-request Content-Security-Policy nonce and the security
 *     headers that must vary per response.
 *
 * The presence of a cookie is NOT treated as proof of authentication - the API
 * validates every token. This is a redirect optimisation, not access control.
 */
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/two-factor', '/api/auth/refresh'];

/** The session cookie set by `app/api/auth/login`. Presence only; never trusted. */
const SESSION_COOKIE = 'wlct_at';

/**
 * Headers that are identical on every response. Kept in one place so a header
 * added for one route cannot be forgotten on another: the proxy runs for every
 * non-static request, which is what makes it the right layer for them.
 */
const STATIC_SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  // The console never needs any of these device APIs; denying them means an
  // injected script cannot ask for them either.
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'],
  // Frame-ancestors in the CSP below is the enforcing rule; this is the
  // belt-and-braces header older browsers still read.
  ['X-Frame-Options', 'DENY'],
  ['Cross-Origin-Opener-Policy', 'same-origin'],
  ['Cross-Origin-Resource-Policy', 'same-origin'],
];

/** True for an allowlisted path: an exact match or anything beneath it. */
function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/**
 * Builds the per-response CSP. Scripts stay nonce-locked - that is where XSS
 * actually bites. `'unsafe-inline'` for styles is required by the inline-style
 * approach used in the components; `'unsafe-eval'` is development-only because
 * the dev overlay needs it and nothing in production does.
 */
function contentSecurityPolicy(nonce: string, nodeEnv: string | undefined): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' ${nodeEnv === 'development' ? "'unsafe-eval'" : ''}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  // Auth routes and their static assets must stay reachable while signed out,
  // otherwise the login page redirects to itself. `/api/*` is exempt because
  // those routes answer with a 401 envelope the client knows how to refresh on.
  if (!isPublicPath(pathname) && !hasSession && !pathname.startsWith('/api/')) {
    const loginUrl = new URL('/login', request.url);
    // Preserve the destination so the user lands where they intended.
    if (pathname !== '/') {
      loginUrl.searchParams.set('next', pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  const nonce = crypto.randomUUID().replace(/-/g, '');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set('Content-Security-Policy', contentSecurityPolicy(nonce, process.env.NODE_ENV));
  for (const [name, value] of STATIC_SECURITY_HEADERS) {
    response.headers.set(name, value);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
