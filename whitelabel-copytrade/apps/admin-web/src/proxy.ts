// # Applies first-party admin authentication redirects and per-request security headers through the Next.js Proxy.
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Request proxy - the ONE request entrypoint of the admin console.
 *
 * Next 16 accepts a single request entrypoint per application and reads this
 * one; a sibling middleware entrypoint made `next build` fail outright ("both
 * middleware and proxy files detected"), which is why this file is the only one
 * that exists. Everything the deleted middleware module did - the login
 * redirect, the per-request CSP nonce, the matcher - is here, because the two
 * files were byte-identical in behaviour; the parameterised security headers
 * below are the additions that only ever lived in neither of them.
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

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
  const hasSession = Boolean(request.cookies.get('wlct_at')?.value);

  if (!isPublic && !hasSession && !pathname.startsWith('/api/')) {
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

  // 'unsafe-inline' for styles is required by the inline-style approach used in
  // the components; scripts stay nonce-locked, which is where XSS actually bites.
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' ${process.env.NODE_ENV === 'development' ? "'unsafe-eval'" : ''}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');

  response.headers.set('Content-Security-Policy', csp);
  for (const [name, value] of STATIC_SECURITY_HEADERS) {
    response.headers.set(name, value);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
