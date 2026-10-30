import { NextRequest } from 'next/server';

import { config, proxy } from '../proxy';

/**
 * The middleware entrypoint was deleted because Next 16 accepts one request
 * entrypoint and named it proxy. Deleting an entrypoint is exactly the kind of
 * change that silently drops a security behaviour, so every behaviour the
 * deleted module had is asserted here one by one:
 *
 *  1. the public-path allowlist,
 *  2. the session redirect plus its `?next=` destination,
 *  3. the `/api/*` exemption,
 *  4. the per-request CSP nonce forwarded as `x-nonce`,
 *  5. the full CSP directive list (and its dev-only `'unsafe-eval'`),
 *  6. the static security headers,
 *  7. the matcher that keeps static assets out of the entrypoint.
 */
function request(pathname: string, options: { session?: boolean } = {}): NextRequest {
  const headers = new Headers();
  if (options.session) {
    headers.set('cookie', 'wlct_at=session-token');
  }
  return new NextRequest(new URL(pathname, 'https://admin.example.test'), { headers });
}

function cspDirectives(response: Response): Record<string, string> {
  const header = response.headers.get('content-security-policy') ?? '';
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...rest] = part.split(' ');
        return [name, rest.join(' ')];
      }),
  );
}

/**
 * Next's ambient types declare `NODE_ENV` read-only, so the test writes it
 * through a mutable view. Restored after each case so the dev-only branch
 * cannot leak into another test.
 */
const mutableEnv = process.env as Record<string, string | undefined>;
const originalNodeEnv = process.env.NODE_ENV;

function setNodeEnv(value: 'development' | 'production'): void {
  mutableEnv.NODE_ENV = value;
}

afterEach(() => {
  mutableEnv.NODE_ENV = originalNodeEnv;
});

describe('admin proxy entrypoint', () => {
  describe('authentication redirect (carried over from the deleted middleware)', () => {
    it('redirects an unauthenticated console navigation to the login page', () => {
      const response = proxy(request('/custody'));

      expect(response.status).toBe(307);
      const location = new URL(response.headers.get('location') ?? '');
      expect(location.pathname).toBe('/login');
      expect(location.searchParams.get('next')).toBe('/custody');
    });

    it('preserves a nested destination so the user lands where they intended', () => {
      const response = proxy(request('/custody/withdrawals'));
      const location = new URL(response.headers.get('location') ?? '');

      expect(location.pathname).toBe('/login');
      expect(location.searchParams.get('next')).toBe('/custody/withdrawals');
    });

    it('does not add a next parameter for the root path', () => {
      const response = proxy(request('/'));
      const location = new URL(response.headers.get('location') ?? '');

      expect(location.pathname).toBe('/login');
      expect(location.searchParams.has('next')).toBe(false);
    });

    it('lets an authenticated navigation through', () => {
      const response = proxy(request('/custody', { session: true }));

      expect(response.status).toBe(200);
      expect(response.headers.get('location')).toBeNull();
    });

    it.each(['/login', '/login/reset', '/api/auth/login', '/api/auth/two-factor', '/api/auth/refresh'])(
      'treats the allowlisted path %s as public',
      (path) => {
        const response = proxy(request(path));

        expect(response.status).toBe(200);
        expect(response.headers.get('location')).toBeNull();
      },
    );

    it('does not treat a lookalike path as public', () => {
      const response = proxy(request('/loginfo'));

      expect(response.status).toBe(307);
      expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/login');
    });

    it('exempts /api/* so the client receives the refreshable 401 envelope', () => {
      const response = proxy(request('/api/proxy/v1/custody/wallets'));

      expect(response.status).toBe(200);
      expect(response.headers.get('location')).toBeNull();
    });
  });

  describe('transport of the CSP nonce (carried over from the deleted middleware)', () => {
    it('forwards a fresh nonce to the render as x-nonce', () => {
      const response = proxy(request('/custody', { session: true }));
      const nonce = response.headers.get('x-middleware-request-x-nonce');

      expect(nonce).toMatch(/^[0-9a-f]{32}$/);
      expect(cspDirectives(response)['script-src']).toContain(`'nonce-${nonce}'`);
    });

    it('generates a different nonce on every request', () => {
      const first = proxy(request('/custody', { session: true }));
      const second = proxy(request('/custody', { session: true }));

      expect(first.headers.get('x-middleware-request-x-nonce')).not.toBe(
        second.headers.get('x-middleware-request-x-nonce'),
      );
    });

    it('keeps incoming request headers alongside the nonce', () => {
      const incoming = request('/custody', { session: true });
      incoming.headers.set('x-correlation-id', 'correlation-1');

      const response = proxy(incoming);

      expect(response.headers.get('x-middleware-request-x-correlation-id')).toBe('correlation-1');
    });
  });

  describe('content security policy (carried over from the deleted middleware)', () => {
    it('pins every directive the deleted middleware set', () => {
      const response = proxy(request('/custody', { session: true }));

      expect(cspDirectives(response)).toEqual({
        'default-src': "'self'",
        'script-src': expect.stringMatching(/^'self' 'nonce-[0-9a-f]{32}'$/),
        'style-src': "'self' 'unsafe-inline'",
        'img-src': "'self' data: https:",
        'font-src': "'self' data:",
        'connect-src': "'self'",
        'frame-ancestors': "'none'",
        'base-uri': "'self'",
        'form-action': "'self'",
        'object-src': "'none'",
      });
    });

    it('never allows unsafe-eval in production', () => {
      setNodeEnv('production');
      const response = proxy(request('/custody', { session: true }));

      expect(response.headers.get('content-security-policy')).not.toContain('unsafe-eval');
      expect(response.headers.get('content-security-policy')).not.toContain('unsafe-inline\' \'unsafe-eval');
    });

    it('allows unsafe-eval only when developing', () => {
      setNodeEnv('development');
      const response = proxy(request('/custody', { session: true }));

      expect(cspDirectives(response)['script-src']).toContain("'unsafe-eval'");
    });

    it('keeps scripts nonce-locked without unsafe-inline', () => {
      setNodeEnv('production');
      const response = proxy(request('/custody', { session: true }));
      const scriptSrc = cspDirectives(response)['script-src'] ?? '';

      expect(scriptSrc).not.toContain("'unsafe-inline'");
      expect(scriptSrc).not.toContain('*');
    });
  });

  describe('static security headers (carried over from the deleted middleware, extended)', () => {
    it('sets every header on an authenticated response', () => {
      const response = proxy(request('/custody', { session: true }));

      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
      expect(response.headers.get('permissions-policy')).toBe(
        'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      );
      expect(response.headers.get('x-frame-options')).toBe('DENY');
      expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
      expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    });

    it('sets security headers on a public path too', () => {
      const response = proxy(request('/login'));

      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    });

    it('does not attach security headers to the redirect it emits', () => {
      const response = proxy(request('/custody'));

      expect(response.status).toBe(307);
      expect(response.headers.get('content-security-policy')).toBeNull();
    });
  });

  describe('matcher (carried over from the deleted middleware)', () => {
    it('keeps the exact exclusion pattern', () => {
      expect(config.matcher).toEqual(['/((?!_next/static|_next/image|favicon.ico).*)']);
    });

    it('excludes Next static assets, images and the favicon from the entrypoint', () => {
      const pattern = new RegExp(`^${config.matcher[0]}$`);

      expect(pattern.test('/_next/static/chunk.js')).toBe(false);
      expect(pattern.test('/_next/image')).toBe(false);
      expect(pattern.test('/favicon.ico')).toBe(false);
      expect(pattern.test('/custody')).toBe(true);
      expect(pattern.test('/login')).toBe(true);
    });
  });
});
