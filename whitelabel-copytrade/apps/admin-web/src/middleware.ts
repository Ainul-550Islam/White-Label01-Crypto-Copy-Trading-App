import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge middleware.
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

export function middleware(request: NextRequest): NextResponse {
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
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
