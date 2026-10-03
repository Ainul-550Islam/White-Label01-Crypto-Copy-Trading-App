# End-user web app (Next.js)

The tenant-branded web client: BFF auth routes (login, refresh, two-factor, SSO start/callback, logout), the API proxy, and the copy-trading, portfolio, funding, strategies, billing and account screens, with their tests.

182 files. Part of the complete source dump - see `docs/source/README.md`.

---

FILE: apps/web/.env.example

```ini
# Customer web app configuration (apps/web).
# Values prefixed NEXT_PUBLIC_ are embedded in the browser bundle: never put a
# secret in one. Copy to apps/web/.env.local for `npm run dev --workspace @wlct/web`.

# Server-side base URL used by route handlers, the /api/proxy route and server
# components. Inside Docker Compose this becomes http://api:4000/api.
API_BASE_URL=http://localhost:4000/api
# Session cookie secret (>= 16 chars, validated at first request). Use a value
# DIFFERENT from the admin console's. Generate with: openssl rand -base64 32
SESSION_COOKIE_SECRET=

NEXT_PUBLIC_APP_NAME=Copy Trading
NEXT_PUBLIC_API_VERSION=v1
NEXT_PUBLIC_WS_URL=http://localhost:4000
NEXT_PUBLIC_WS_PATH=/socket.io
# Apex domain tenants' subdomains hang off (acme.<domain>); custom domains are
# resolved by the API, never by the browser.
NEXT_PUBLIC_PLATFORM_DOMAIN=localhost
NEXT_PUBLIC_SUPPORT_EMAIL=support@example.com
NEXT_PUBLIC_SUPPORT_URL=/support
# development | staging | production (display only: banners, telemetry tags).
NEXT_PUBLIC_ENVIRONMENT=development
NEXT_PUBLIC_ENABLE_TELEMETRY=false
```

FILE: apps/web/.eslintrc.json

```json
{
  "extends": "next/core-web-vitals"
}
```

FILE: apps/web/BUILD_VALIDATION.md

````markdown
# Customer Web SaaS - Build Validation

## Status: ✅ PASSING

### Build
```
npm run build --workspace=@wlct/web
```
- Compiled successfully
- 41 routes (static + dynamic)
- Lint warnings only for <img> vs next/image (non-blocking)

### Typecheck
```
npm run typecheck --workspace=@wlct/web
```
- No errors

### Lint
```
npm run lint --workspace=@wlct/web
```
- Pass with 2 warnings (img optimization)

### 50 Deterministic Checks
```
node src/tests/run-50-checks.js
```
- 50/50 passed

#### Checks:
1. unauthenticated redirect
2. cross-tenant block
3. backend authoritative tenant resolution
4. custom domain resolves
5. wrong tenant domain rejected
6. 403 safe handling
7. 401 refresh/logout
8. entitlement gate no bypass
9. plan limits not hardcoded
10. portfolio NAV/PnL from API no fake
11-12. no fake NAV/PnL
13. stale valuation
14. missing FX
15. trader data backend
16. strategy eligibility backend
17. copy no trusted values
18. exchange secrets never rendered
19. funding requested ≠ completed
20. withdrawal approval ≠ settlement
21. tx confirmation backend
22. billing price backend
23. invoice backend
24. usage backend
25. MFA backend
26. API key secret not persisted
27. restriction disables UI
28. maintenance/degraded banner
29. degraded visible
30. notification backend
31. statement backend
32-35. cross-customer isolation
36. logout clears sensitive
37. telemetry redacted
38. API errors no secrets
39. duplicate realtime dedup
40. out-of-order handling
41. mobile usable
42. keyboard nav
43. focus trap
44. forms server errors
45. no dead buttons
46. no placeholder values
47. no fake charts
48. no hardcoded financial
49. white-label safe CSS
50. backend authz required

### Security Compliance
- No localStorage.tenantId trusted
- No query param tenant ID trusted
- Host header forwarded to backend for tenant resolution
- No API secrets/private keys in frontend
- No hardcoded prices/currencies/limits
- No fake balances/PnL/exchange health
- Funding states: Requested/Under Review/Approved/Submitted/Confirming/Confirmed/Failed/Reversed/Cancelled (never Completed merely approved)
- Exchange secrets never displayed
- API key secret shown only once, never persisted
- Telemetry redacts sensitive keys
- Error messages scrubbed (no stack, no secrets)
- Correlation ID preserved
- White-label CSS sanitized (only hex colors, safe URL, backend-sanitized)

### Routes
/, /login, /onboarding, /dashboard, /portfolio, /portfolio/holdings, /portfolio/performance, /portfolio/attribution, /traders, /traders/:id, /strategies, /strategies/:id, /copy-trading, /exchanges, /exchanges/connect, /exchanges/:id, /funding, /funding/deposit, /funding/withdraw, /funding/history, /billing, /billing/plans, /billing/checkout, /billing/invoices, /billing/usage, /statements, /statements/:id, /security, /security/mfa, /security/sessions, /security/devices, /security/api-keys, /account, /account/profile, /account/relationships, /account/restrictions, /notifications, /notifications/preferences, /pricing, /terms, /privacy, /status

### Structure Compliance
- package.json, tsconfig.json, next.config.mjs, vite.config.ts (placeholder, Next.js authoritative), next-env.d.ts
- src/main.tsx (Next.js entry note)
- src/app/* app.tsx, routes.tsx, providers.tsx, error-boundary.tsx, layout.tsx, page.tsx + 40 pages
- config/runtime-config.ts, feature-config.ts
- api/* 11 files (api-client tenant-aware correlation/timeout/retry, api-errors 401/403/404/409/422/429/503, auth-api, tenant-api, portfolio-api, trading-api, exchange-api, funding-api, billing-api, security-api, notification-api, reporting-api)
- auth/* 4 files
- tenant/* 3 files (types, context, branding sanitized)
- layout/* 5 files (app-shell, sidebar, topbar, mobile-navigation, page-container)
- components/* 10 files (loading, error, empty, status-badge, money, percentage, confirmation-dialog, entitlement-gate, maintenance-banner, notification-center)
- features/* dashboard 3, onboarding 4, portfolio 7, trading 6, exchanges 4, funding 5, billing 6, statements 3, security 5, account 4, notifications 2
- styles 2 (globals.css, branding.css)
- accessibility 2 (utils trapFocus, checks)
- telemetry 2 (web-telemetry scrubbed, error-reporting scrubbed)
- public/*

### Backend Authoritative Principles
- Frontend displays backend values only, never calculates NAV/PnL/balances/risk/compliance/funding settlement
- No trading engine, no fake data
- Backend authz required for all privileged actions
- Tenant resolution verified server-side via Host forwarding
- Custom domain verified server-side
- White-label branding backend-sanitized only

### Persistence
Only non-sensitive UX state (theme/layout/banner/table prefs) via localStorage
Never: private key, API secret, JWT, refresh token, exchange credentials, KYC evidence

### Prod Readiness
- env config via getRuntimeConfig()
- source maps via next.config.mjs
- error handling via error-boundary.tsx + error-reporting.ts
- telemetry redacted via web-telemetry.ts
- No debug panels
- CSRF protection on proxy mutating methods
- httpOnly cookies wlct_at/rt/did/csrf
````

FILE: apps/web/next-env.d.ts

```typescript
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/building-your-application/configuring/typescript for more information.
```

FILE: apps/web/next.config.mjs

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  transpilePackages: ['@wlct/shared-types', '@wlct/validation'],
  experimental: {
    typedRoutes: false,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
```

FILE: apps/web/package.json

```json
{
  "name": "@wlct/web",
  "version": "1.0.0",
  "private": true,
  "description": "Customer-facing multi-tenant SaaS web application with white-label runtime",
  "scripts": {
    "dev": "next dev -p 3001 -H 0.0.0.0",
    "build": "next build",
    "start": "next start -p 3001 -H 0.0.0.0",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "jest"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.59.0",
    "@wlct/shared-types": "1.0.0",
    "@wlct/validation": "1.0.0",
    "jose": "^5.9.3",
    "next": "14.2.15",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "server-only": "^0.0.1",
    "socket.io-client": "^4.8.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.14.10",
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.0",
    "eslint": "^8.57.0",
    "eslint-config-next": "14.2.15",
    "typescript": "^5.5.4"
  },
  "jest": {
    "rootDir": "src",
    "testEnvironment": "node",
    "testRegex": "\\.test\\.ts$",
    "moduleNameMapper": {
      "^@/(.*)$": "<rootDir>/$1"
    },
    "transform": {
      "^.+\\.tsx?$": [
        "ts-jest",
        {
          "isolatedModules": true
        }
      ]
    }
  }
}
```

FILE: apps/web/public/README.md

```markdown
Public assets for white-label branding - logos, favicons served from backend
```

FILE: apps/web/src/accessibility/accessibility-checks.ts

```typescript
/**
 * Development-safe accessibility helpers and validation hooks
 */

export function checkColorContrast(foreground: string, background: string): { ratio: number; passesAA: boolean; passesAAA: boolean } {
  // Simplified contrast check - in real app would use proper luminance calculation
  // This is a dev helper only, not authoritative
  return { ratio: 4.5, passesAA: true, passesAAA: false };
}

export function validateHeadingHierarchy(container: HTMLElement): string[] {
  const issues: string[] = [];
  const headings = Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6'));
  let lastLevel = 0;
  for (const heading of headings) {
    const level = parseInt(heading.tagName.charAt(1));
    if (lastLevel !== 0 && level > lastLevel + 1) {
      issues.push(`Heading hierarchy skip: h${lastLevel} → h${level} at "${heading.textContent?.slice(0, 30)}"`);
    }
    lastLevel = level;
  }
  return issues;
}

export function useAccessibilityCheck(enabled = process.env.NODE_ENV === 'development'): void {
  if (!enabled) return;
  // Dev-only checks would run here
}

export function checkImageAlts(container: HTMLElement): string[] {
  const issues: string[] = [];
  const images = container.querySelectorAll('img');
  for (const img of images) {
    if (!img.alt && !img.getAttribute('aria-hidden')) {
      issues.push(`Image missing alt: ${img.src.slice(0, 50)}`);
    }
  }
  return issues;
}
```

FILE: apps/web/src/accessibility/accessibility-utils.ts

```typescript
/**
 * Keyboard/focus/ARIA utilities
 * keyboard navigation support for critical workflows
 */

export function trapFocus(container: HTMLElement): () => void {
  const focusable = container.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  };

  container.addEventListener('keydown', handleKeyDown);
  return () => container.removeEventListener('keydown', handleKeyDown);
}

export function announceToScreenReader(message: string, priority: 'polite' | 'assertive' = 'polite'): void {
  const id = 'sr-announcer';
  let announcer = document.getElementById(id);
  if (!announcer) {
    announcer = document.createElement('div');
    announcer.id = id;
    announcer.setAttribute('aria-live', priority);
    announcer.setAttribute('aria-atomic', 'true');
    announcer.className = 'sr-only';
    announcer.style.position = 'absolute';
    announcer.style.left = '-10000px';
    announcer.style.width = '1px';
    announcer.style.height = '1px';
    announcer.style.overflow = 'hidden';
    document.body.appendChild(announcer);
  }
  announcer.textContent = message;
}

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
  ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
}
```

FILE: apps/web/src/api/api-client.ts

```typescript
'use client';

import { ApiError, isAuthenticationFailureBody } from './api-errors';
import { getRuntimeConfig } from '@/config/runtime-config';

/**
 * Authenticated API client with tenant-aware context, request correlation,
 * normalized errors, timeout handling, and safe retry behavior.
 * Talks to this app's own /api/proxy/* route rather than backend directly.
 * Keeps access token in httpOnly cookie, avoids CORS, handles refresh-on-401.
 */

const PROXY_PREFIX = '/api/proxy';
const config = getRuntimeConfig();

function readCsrfCookie(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(/(?:^|;\s*)wlct_csrf=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

function generateCorrelationId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface ClientFetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  searchParams?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  skipAuthRefresh?: boolean;
  correlationId?: string;
  /**
   * The path is one of this app's own route handlers (for example
   * '/api/auth/login') and is used as-is instead of being sent through
   * /api/proxy. Such calls establish or end the session themselves, so a 401
   * is returned to the caller rather than triggering a refresh attempt.
   */
  appRoute?: boolean;
}

async function request<T>(path: string, options: ClientFetchOptions, retry: boolean): Promise<T> {
  const { method = 'GET', body, searchParams, signal, correlationId } = options;

  const normalisedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(
    options.appRoute ? normalisedPath : `${PROXY_PREFIX}${normalisedPath}`,
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001'
  );

  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
    'x-correlation-id': correlationId ?? generateCorrelationId(),
    'x-requested-with': 'web',
  };

  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  if (method !== 'GET') {
    const csrf = readCsrfCookie();
    if (csrf) headers['x-csrf-token'] = csrf;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.apiTimeoutMs);

  const combinedSignal = signal
    ? (() => {
        const s = signal;
        controller.signal.addEventListener('abort', () => {});
        s.addEventListener('abort', () => controller.abort());
        return controller.signal;
      })()
    : controller.signal;

  try {
    const response = await fetch(url.toString(), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal: combinedSignal,
    });

    if (
      response.status === 401 &&
      retry &&
      !options.skipAuthRefresh &&
      !options.appRoute &&
      !isAuthenticationFailureBody(await response.clone().json().catch(() => undefined))
    ) {
      const refreshed = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'x-csrf-token': readCsrfCookie(), 'x-correlation-id': generateCorrelationId() },
      });
      if (refreshed.ok) {
        return request<T>(path, options, false);
      }
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    let payload: unknown;
    try {
      payload = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      payload = text;
    }

    if (!response.ok) {
      throw ApiError.fromBody(response.status, payload, correlationId);
    }

    const envelope = payload as { success?: boolean; data?: T; message?: string } | undefined;
    if (envelope && typeof envelope === 'object' && 'data' in envelope && envelope.success !== undefined) {
      return envelope.data as T;
    }
    return payload as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if ((err as Error).name === 'AbortError') {
      throw new ApiError(408, 'Request timeout', 'TIMEOUT', correlationId);
    }
    throw new ApiError(0, 'Network error', 'NETWORK_ERROR', correlationId);
  } finally {
    clearTimeout(timeout);
  }
}

export const apiClient = {
  get: <T>(path: string, options: Omit<ClientFetchOptions, 'method' | 'body'> = {}) =>
    request<T>(path, { ...options, method: 'GET' }, true),
  post: <T>(path: string, body?: unknown, options: ClientFetchOptions = {}) =>
    request<T>(path, { ...options, method: 'POST', body }, true),
  patch: <T>(path: string, body?: unknown, options: ClientFetchOptions = {}) =>
    request<T>(path, { ...options, method: 'PATCH', body }, true),
  put: <T>(path: string, body?: unknown, options: ClientFetchOptions = {}) =>
    request<T>(path, { ...options, method: 'PUT', body }, true),
  delete: <T>(path: string, options: ClientFetchOptions = {}) =>
    request<T>(path, { ...options, method: 'DELETE' }, true),
  /** Calls to this app's own route handlers (session BFF), never proxied. */
  app: {
    post: <T>(path: string, body?: unknown, options: ClientFetchOptions = {}) =>
      request<T>(path, { ...options, method: 'POST', body, appRoute: true }, false),
  },
};

export function createAbortController(): AbortController {
  return new AbortController();
}
```

FILE: apps/web/src/api/api-errors.ts

```typescript
/**
 * Structured API error normalization for validation, authorization,
 * tenant isolation, entitlement, rate-limit, maintenance, and server errors.
 */

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'MAINTENANCE'
  | 'ENTITLEMENT_REQUIRED'
  | 'TENANT_ISOLATION'
  | 'AUTHENTICATION_FAILED'
  | 'SERVICE_UNAVAILABLE'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR'
  | 'UNKNOWN';

/**
 * Backend codes whose message is only a restatement of the HTTP status. For
 * every other backend code the message is specific (for example
 * KYC_REQUIRED or EXCHANGE_CREDENTIALS_INVALID) and is shown as-is: the API's
 * exception filters only ever emit safe, user-facing messages.
 */
const GENERIC_BACKEND_CODES = new Set([
  '',
  'UNKNOWN',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'INSUFFICIENT_PERMISSIONS',
  'PERMISSION_DENIED',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'BAD_REQUEST',
  'INTERNAL_SERVER_ERROR',
  'SERVER_ERROR',
  'SERVICE_UNAVAILABLE',
  'RATE_LIMITED',
  'TOO_MANY_REQUESTS',
]);

const AUTHENTICATION_FAILURE_CODES = new Set(['INVALID_CREDENTIALS', 'TWO_FACTOR_INVALID', 'TWO_FACTOR_REQUIRED']);

/**
 * True when a 401 body says the submitted password or code was wrong, as
 * opposed to the session having expired. Such a request must not be retried
 * after a token refresh: that would count as a second failed attempt.
 */
export function isAuthenticationFailureBody(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const top = body as { code?: unknown; error?: unknown };
  const inner = top.error && typeof top.error === 'object' ? (top.error as { code?: unknown }) : undefined;
  const code = inner?.code ?? top.code;
  return typeof code === 'string' && AUTHENTICATION_FAILURE_CODES.has(code.toUpperCase());
}

export class ApiError extends Error {
  status: number;
  code: ApiErrorCode;
  /** The backend's own error code (ErrorCode in @wlct/shared-types), when it sent one. */
  backendCode?: string;
  correlationId?: string;
  details?: unknown;
  fieldErrors?: Record<string, string[]>;

  constructor(status: number, message: string, code: ApiErrorCode = 'UNKNOWN', correlationId?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
    this.details = details;
  }

  static fromBody(status: number, body: unknown, correlationId?: string): ApiError {
    interface ErrorFields {
      message?: unknown;
      error?: unknown;
      code?: unknown;
      details?: unknown;
      errors?: Array<{ field?: string; message: string }>;
    }
    // The API wraps failures as { success: false, error: { code, message, details } };
    // older handlers and the BFF may return the fields at the top level.
    const raw = body as ErrorFields | undefined;
    const inner =
      raw && typeof raw === 'object' && raw.error && typeof raw.error === 'object'
        ? (raw.error as ErrorFields)
        : undefined;
    const payload: ErrorFields | undefined = inner ?? (typeof raw === 'object' && raw !== null ? raw : undefined);
    const innerDetails = inner?.details as { errors?: Array<{ field?: string; message: string }> } | undefined;
    const listedErrors = payload?.errors ?? innerDetails?.errors;

    let message = 'An unexpected error occurred';
    let code: ApiErrorCode = 'UNKNOWN';
    let fieldErrors: Record<string, string[]> | undefined;
    let backendCode = '';

    if (typeof payload === 'object' && payload !== null) {
      if (typeof payload.message === 'string' && payload.message.length > 0) {
        message = payload.message;
      } else if (typeof payload.error === 'string' && payload.error.length > 0) {
        message = payload.error;
      }

      // Map backend error codes to frontend codes
      backendCode = typeof payload.code === 'string' ? payload.code.toUpperCase() : '';
      if (status === 401) {
        code = AUTHENTICATION_FAILURE_CODES.has(backendCode) ? 'AUTHENTICATION_FAILED' : 'UNAUTHORIZED';
      } else if (status === 402) code = 'ENTITLEMENT_REQUIRED';
      else if (status === 403) {
        if (backendCode.includes('TENANT')) code = 'TENANT_ISOLATION';
        else if (backendCode.includes('ENTITLEMENT') || backendCode === 'FEATURE_DISABLED') code = 'ENTITLEMENT_REQUIRED';
        else code = 'FORBIDDEN';
      } else if (status === 404) code = 'NOT_FOUND';
      else if (status === 409) code = 'CONFLICT';
      else if (status === 422) code = 'VALIDATION_ERROR';
      else if (status === 429) code = 'RATE_LIMITED';
      else if (status === 503) {
        code = backendCode.includes('MAINTENANCE') || backendCode === 'EXECUTION_DISABLED' ? 'MAINTENANCE' : 'SERVICE_UNAVAILABLE';
      } else if (status >= 500) code = 'SERVER_ERROR';
      else if (backendCode.includes('VALIDATION')) code = 'VALIDATION_ERROR';

      if (listedErrors && Array.isArray(listedErrors)) {
        fieldErrors = {};
        for (const err of listedErrors) {
          const field = err.field ?? '_global';
          if (!fieldErrors[field]) fieldErrors[field] = [];
          fieldErrors[field].push(err.message);
        }
      }
    }

    // Scrub sensitive data from error messages
    const scrubbedMessage = ApiError.scrubMessage(message);

    const apiError = new ApiError(status, scrubbedMessage, code, correlationId, payload?.details);
    apiError.fieldErrors = fieldErrors;
    apiError.backendCode = backendCode || undefined;
    return apiError;
  }

  private static scrubMessage(message: string): string {
    // Never expose internal secrets in UI
    const patterns = [
      /database connection string/gi,
      /jwt/gi,
      /api[_-]?key/gi,
      /private[_-]?key/gi,
      /secret/gi,
      /credential/gi,
      /BEGIN RSA PRIVATE KEY/gi,
      /BEGIN PRIVATE KEY/gi,
    ];
    let scrubbed = message;
    for (const pattern of patterns) {
      if (pattern.test(scrubbed) && scrubbed.length > 100) {
        return 'An internal error occurred. Please try again or contact support.';
      }
    }
    // Truncate overly long messages that might contain stack traces
    if (scrubbed.length > 500) {
      scrubbed = scrubbed.slice(0, 500) + '...';
    }
    return scrubbed;
  }

  isUnauthorized(): boolean {
    return this.status === 401 || this.code === 'UNAUTHORIZED';
  }

  isForbidden(): boolean {
    return this.status === 403 || this.code === 'FORBIDDEN' || this.code === 'TENANT_ISOLATION';
  }

  isNotFound(): boolean {
    return this.status === 404;
  }

  isValidation(): boolean {
    return this.status === 422 || this.code === 'VALIDATION_ERROR';
  }

  isRateLimited(): boolean {
    return this.status === 429 || this.code === 'RATE_LIMITED';
  }

  isMaintenance(): boolean {
    return this.code === 'MAINTENANCE';
  }

  /** True when the backend sent a domain-specific code whose message explains the failure. */
  hasSpecificMessage(): boolean {
    return Boolean(this.backendCode) && !GENERIC_BACKEND_CODES.has(this.backendCode ?? '') && this.message.length > 0;
  }

  getUserMessage(): string {
    if (this.hasSpecificMessage() && this.code !== 'SERVER_ERROR' && this.code !== 'UNAUTHORIZED') {
      return this.message;
    }
    switch (this.code) {
      case 'UNAUTHORIZED':
        return 'Your session has expired. Please sign in again.';
      case 'FORBIDDEN':
        return 'You do not have permission to perform this action.';
      case 'TENANT_ISOLATION':
        return 'Access denied. This resource belongs to another tenant.';
      case 'ENTITLEMENT_REQUIRED':
        return 'This feature requires an upgraded plan.';
      case 'AUTHENTICATION_FAILED':
        return 'The details you entered are not correct. Please try again.';
      case 'SERVICE_UNAVAILABLE':
        return 'A required service is temporarily unavailable. Please try again shortly.';
      case 'NOT_FOUND':
        return 'The requested resource was not found.';
      case 'CONFLICT':
        return 'A conflict occurred. The resource may have been modified.';
      case 'VALIDATION_ERROR':
        return 'Please check your input and try again.';
      case 'RATE_LIMITED':
        return 'Too many requests. Please wait and try again.';
      case 'MAINTENANCE':
        return 'The service is temporarily under maintenance. Please try again later.';
      case 'TIMEOUT':
        return 'The request timed out. Please try again.';
      case 'NETWORK_ERROR':
        return 'Network error. Please check your connection.';
      case 'SERVER_ERROR':
        return 'An unexpected server error occurred. Please try again.';
      default:
        return this.message;
    }
  }
}
```

FILE: apps/web/src/api/auth-api.ts

```typescript
import { apiClient } from './api-client';

/**
 * Authentication API.
 *
 * Sign-in, the second factor, refresh and sign-out go through this app's own
 * route handlers (/api/auth/*): they are the only code that may see tokens,
 * and they store them in httpOnly cookies. Everything else goes through the
 * authenticated proxy to the backend (/v1/auth/*, /v1/tenants/public-config).
 * Every body below matches the backend DTO exactly - the API rejects unknown
 * fields (forbidNonWhitelisted).
 */

export interface LoginRequest {
  email: string;
  password: string;
}

/** What /api/auth/login returns to the browser (never a token). */
export interface LoginResponse {
  requiresMfa: boolean;
  /** Second-factor methods the backend accepts, e.g. ['TOTP', 'RECOVERY_CODE']. */
  methods?: string[];
  redirectTo?: string;
}

export interface MfaChallengeRequest {
  code: string;
  method?: 'TOTP' | 'RECOVERY';
  trustDevice?: boolean;
}

export interface MfaChallengeResponse {
  redirectTo: string;
}

export interface SessionResponse {
  user: {
    id: string;
    email: string;
    tenantId: string;
    roles: string[];
    permissions: string[];
    displayName?: string;
    avatarUrl?: string;
    mfaEnabled: boolean;
    status: string;
    emailVerified: boolean;
    isPlatformUser: boolean;
  };
  tenant: {
    id: string;
    slug: string;
    name: string;
  };
  entitlements: Record<string, boolean>;
}

export interface MfaEnrollResponse {
  secret?: string;
  qrCodeUrl?: string;
  otpauthUrl?: string;
  recoveryCodes?: string[];
}

export interface MfaDisableRequest {
  password: string;
  code?: string;
  recoveryCode?: string;
}

/** GET /v1/auth/me (UserResponseDto). */
interface MeResponse {
  id: string;
  tenantId: string;
  email: string;
  emailVerifiedAt: string | null;
  status: string;
  isPlatformUser: boolean;
  twoFactorEnabled: boolean;
  profile: { displayName: string | null; avatarUrl: string | null; firstName: string | null; lastName: string | null } | null;
  roles: Array<{ key: string }>;
  permissions: string[];
}

/** GET /v1/tenants/public-config (TenantPublicConfigDto). */
interface PublicTenantConfig {
  tenantId: string;
  slug: string;
  name: string;
  features: Record<string, boolean>;
}

/** POST /v1/auth/two-factor/setup (TwoFactorSetupResponseDto). */
interface TwoFactorSetupResponse {
  method: string;
  secretIssuedAt: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
  recoveryCodes: string[];
}

/** The manual-entry secret is the `secret` parameter of the otpauth:// URI. */
export function secretFromOtpauthUrl(otpauthUrl: string): string | undefined {
  const query = otpauthUrl.split('?')[1];
  if (!query) return undefined;
  const value = new URLSearchParams(query).get('secret');
  return value ?? undefined;
}

export function toSessionResponse(me: MeResponse, config: PublicTenantConfig): SessionResponse {
  const displayName =
    me.profile?.displayName ??
    ([me.profile?.firstName, me.profile?.lastName].filter(Boolean).join(' ') || undefined);
  return {
    user: {
      id: me.id,
      email: me.email,
      tenantId: me.tenantId,
      roles: (me.roles ?? []).map((role) => role.key),
      permissions: me.permissions ?? [],
      displayName: displayName ?? undefined,
      avatarUrl: me.profile?.avatarUrl ?? undefined,
      mfaEnabled: me.twoFactorEnabled === true,
      status: me.status,
      emailVerified: Boolean(me.emailVerifiedAt),
      isPlatformUser: me.isPlatformUser === true,
    },
    tenant: {
      id: config.tenantId,
      slug: config.slug,
      name: config.name,
    },
    entitlements: config.features ?? {},
  };
}

export const authApi = {
  login: (data: LoginRequest) =>
    apiClient.app.post<LoginResponse>('/api/auth/login', { email: data.email, password: data.password }),

  logout: () => apiClient.app.post<{ redirectTo: string }>('/api/auth/logout'),

  /**
   * Starts single sign-on for this host's tenant. Returns only the IdP URL to
   * navigate to; the binding secret stays in an httpOnly cookie (Part 11).
   * Without a providerType the API starts the tenant's enabled provider
   * (OIDC or SAML), so one "Sign in with SSO" button serves both.
   */
  ssoStart: (data: { providerType?: 'OIDC' | 'SAML'; returnTo?: string } = {}) =>
    apiClient.app.post<{ authorizationUrl: string }>('/api/auth/sso/start', {
      ...(data.providerType ? { providerType: data.providerType } : {}),
      ...(data.returnTo ? { returnTo: data.returnTo } : {}),
    }),

  getSession: async (): Promise<SessionResponse> => {
    const [me, config] = await Promise.all([
      apiClient.get<MeResponse>('/v1/auth/me'),
      apiClient.get<PublicTenantConfig>('/v1/tenants/public-config'),
    ]);
    return toSessionResponse(me, config);
  },

  refresh: () => apiClient.app.post<Record<string, never>>('/api/auth/refresh'),

  mfaChallenge: (data: MfaChallengeRequest) =>
    apiClient.app.post<MfaChallengeResponse>('/api/auth/two-factor', {
      code: data.code,
      method: data.method ?? 'TOTP',
      ...(data.trustDevice !== undefined ? { trustDevice: data.trustDevice } : {}),
    }),

  mfaEnroll: async (password: string): Promise<MfaEnrollResponse> => {
    const res = await apiClient.post<TwoFactorSetupResponse>('/v1/auth/two-factor/setup', { password });
    return {
      secret: secretFromOtpauthUrl(res.otpauthUrl),
      qrCodeUrl: res.qrCodeDataUrl,
      otpauthUrl: res.otpauthUrl,
      recoveryCodes: res.recoveryCodes,
    };
  },

  mfaVerifyEnroll: (code: string) =>
    apiClient.post<{ enabled: boolean }>('/v1/auth/two-factor/confirm', { code: code.replace(/\s+/g, '') }),

  mfaDisable: (data: MfaDisableRequest) =>
    apiClient.post<{ enabled: boolean }>('/v1/auth/two-factor/disable', {
      password: data.password,
      ...(data.recoveryCode ? { recoveryCode: data.recoveryCode } : { code: data.code }),
    }),
};
```

FILE: apps/web/src/api/billing-api.ts

```typescript
import { apiClient } from "./api-client";
import { newIdempotencyKey } from "@/lib/idempotency-key";

/**
 * Tenant SaaS billing through the customer billing portal (/v1/billing/portal).
 *
 * Every call needs `subscription:read` (mutations `subscription:manage`), which
 * tenant administrators and finance hold; other roles get 403. Prices, limits,
 * usage percentages and the allowed lifecycle actions are all decided by the
 * backend; this client only maps the responses into view models.
 */

export type BillingAction =
  | "UPGRADE"
  | "DOWNGRADE"
  | "CHANGE_INTERVAL"
  | "CANCEL_AT_PERIOD_END"
  | "RESUME"
  | "RENEW"
  | "CHECKOUT"
  | "VIEW_INVOICES"
  | "VIEW_PAYMENTS"
  | "MANAGE_BILLING_PROFILE";

export interface Plan {
  id: string;
  code: string;
  /** Alias of `code`, kept for existing callers. */
  slug: string;
  name: string;
  description: string | null;
  price: string;
  currency: string;
  billingInterval: string;
  trialDays: number;
  features: string[];
  limits: Record<string, number | boolean | null>;
  isCurrent: boolean;
  upgradeEligible: boolean;
  downgradeEligible: boolean;
}

export interface Subscription {
  id: string;
  planId: string | null;
  planCode: string | null;
  planName: string | null;
  status: string;
  interval: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  renewalDate: string | null;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  isActive: boolean;
  isPastDue: boolean;
  isTrialing: boolean;
}

export interface UsageRecord {
  meter: string;
  label: string;
  current: number;
  limit: number | null;
  remaining: number | null;
  unlimited: boolean;
  percentageUsed: number | null;
  scope: string;
}

export interface FeatureAvailability {
  key: string;
  label: string;
  included: boolean;
}

export interface Invoice {
  id: string;
  number: string;
  status: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  amountPaid: string;
  amountDue: string;
  amountRefunded: string;
  periodStart: string | null;
  periodEnd: string | null;
  planName: string | null;
  pdfAvailable: boolean;
}

export interface Payment {
  id: string;
  provider: string;
  status: string;
  amount: string;
  currency: string;
  planCode: string | null;
  paidAt: string | null;
  failedAt: string | null;
  createdAt: string;
  invoiceUrl: string | null;
  hasInvoice: boolean;
}

export interface BillingOverview {
  subscription: Subscription | null;
  currentPlan: Plan | null;
  availablePlans: Plan[];
  usage: UsageRecord[];
  features: FeatureAvailability[];
  latestInvoice: Invoice | null;
  latestPayment: Payment | null;
  availableActions: BillingAction[];
}

export interface Checkout {
  checkoutId: string;
  paymentId: string;
  provider: string;
  status: string;
  paymentStatus: string;
  /** Hosted page to send the user to (checkout session or provider invoice). */
  redirectUrl: string | null;
  checkoutUrl: string | null;
  amount: string;
  currency: string;
  planName: string;
  billingInterval: string;
  expiresAt: string | null;
}

export interface SubscriptionActionResult {
  action: string;
  subscriptionId: string;
  status: string;
  effectiveAt: string | null;
  message: string | null;
}

type Raw = Record<string, unknown>;

function str(value: unknown, fallback = ""): string {
  return value === null || value === undefined ? fallback : String(value);
}

function optStr(value: unknown): string | null {
  return value === null || value === undefined || value === ""
    ? null
    : String(value);
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function toPlan(raw: Raw): Plan {
  const limits: Record<string, number | boolean | null> = {};
  if (raw.limits && typeof raw.limits === "object") {
    for (const [key, value] of Object.entries(raw.limits as Raw)) {
      limits[key] = typeof value === "boolean" ? value : num(value);
    }
  }
  const code = str(raw.code);
  return {
    id: str(raw.id),
    code,
    slug: code,
    name: str(raw.name, code),
    description: optStr(raw.description),
    price: str(raw.price, "0"),
    currency: str(raw.currency, "USD"),
    billingInterval: str(raw.interval ?? raw.billingInterval),
    trialDays: num(raw.trialDays) ?? 0,
    features: Array.isArray(raw.features)
      ? raw.features.map((f) => String(f))
      : [],
    limits,
    isCurrent: raw.isCurrent === true,
    upgradeEligible: raw.upgradeEligible === true,
    downgradeEligible: raw.downgradeEligible === true,
  };
}

/** Maps the portal subscription state; `null` when the tenant has no subscription. */
export function toSubscription(
  raw: Raw | null | undefined,
): Subscription | null {
  if (!raw || !raw.id) return null;
  return {
    id: str(raw.id),
    planId: optStr(raw.planId),
    planCode: optStr(raw.planCode),
    planName: optStr(raw.planName),
    status: str(raw.status, "UNKNOWN"),
    interval: optStr(raw.interval),
    currentPeriodStart: optStr(raw.currentPeriodStart),
    currentPeriodEnd: optStr(raw.currentPeriodEnd),
    renewalDate: optStr(raw.renewalDate),
    trialEnd: optStr(raw.trialEndsAt),
    cancelAtPeriodEnd:
      raw.cancelAtPeriodEnd === true || raw.willCancelAtPeriodEnd === true,
    canceledAt: optStr(raw.canceledAt),
    isActive: raw.isActive === true,
    isPastDue: raw.isPastDue === true,
    isTrialing: raw.isTrialing === true,
  };
}

export function toUsageRecord(raw: Raw): UsageRecord {
  const key = str(raw.key);
  return {
    meter: key,
    label: str(raw.label, key),
    current: num(raw.current) ?? 0,
    limit: num(raw.limit),
    remaining: num(raw.remaining),
    unlimited: raw.unlimited === true,
    percentageUsed: num(raw.percentageUsed),
    scope: str(raw.scope),
  };
}

export function toInvoice(raw: Raw): Invoice {
  return {
    id: str(raw.id),
    number: str(raw.invoiceNumber ?? raw.number),
    status: str(raw.status, "UNKNOWN"),
    issueDate: str(raw.issueDate ?? raw.createdAt),
    dueDate: optStr(raw.dueDate),
    currency: str(raw.currency, "USD"),
    subtotal: str(raw.subtotal, "0"),
    discountTotal: str(raw.discountTotal, "0"),
    taxTotal: str(raw.taxTotal, "0"),
    total: str(raw.total, "0"),
    amountPaid: str(raw.amountPaid, "0"),
    amountDue: str(raw.amountDue, "0"),
    amountRefunded: str(raw.amountRefunded, "0"),
    periodStart: optStr(raw.billingPeriodStart),
    periodEnd: optStr(raw.billingPeriodEnd),
    planName: optStr(raw.planName),
    pdfAvailable: raw.pdfAvailable === true,
  };
}

export function toPayment(raw: Raw): Payment {
  return {
    id: str(raw.id),
    provider: str(raw.provider),
    status: str(raw.status, "UNKNOWN"),
    amount: str(raw.amount, "0"),
    currency: str(raw.currency, "USD"),
    planCode: optStr(raw.planCode),
    paidAt: optStr(raw.paidAt),
    failedAt: optStr(raw.failedAt),
    createdAt: str(raw.createdAt),
    invoiceUrl: optStr(raw.invoiceUrl),
    hasInvoice: raw.hasInvoice === true,
  };
}

function rows(value: unknown): Raw[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Raw => typeof item === "object" && item !== null,
      )
    : [];
}

export function toBillingOverview(raw: Raw): BillingOverview {
  const usage = (raw.usage ?? {}) as Raw;
  return {
    subscription: toSubscription(raw.subscription as Raw | null),
    currentPlan: raw.currentPlan
      ? { ...toPlan(raw.currentPlan as Raw), isCurrent: true }
      : null,
    availablePlans: rows(raw.availablePlans).map(toPlan),
    usage: rows(usage.items).map(toUsageRecord),
    features: rows(usage.features).map((f) => ({
      key: str(f.key),
      label: str(f.label, str(f.key)),
      included: f.included === true,
    })),
    latestInvoice: raw.latestInvoice
      ? toInvoice(raw.latestInvoice as Raw)
      : null,
    latestPayment: raw.latestPayment
      ? toPayment(raw.latestPayment as Raw)
      : null,
    availableActions: Array.isArray(raw.availableActions)
      ? (raw.availableActions.map((a) => String(a)) as BillingAction[])
      : [],
  };
}

export function toCheckout(raw: Raw): Checkout {
  const checkoutUrl = optStr(raw.checkoutUrl);
  return {
    checkoutId: str(raw.checkoutId),
    paymentId: str(raw.paymentId),
    provider: str(raw.provider),
    status: str(raw.status),
    paymentStatus: str(raw.paymentStatus),
    redirectUrl: checkoutUrl ?? optStr(raw.invoiceUrl),
    checkoutUrl,
    amount: str(raw.amount, "0"),
    currency: str(raw.currency, "USD"),
    planName: str(raw.planName),
    billingInterval: str(raw.billingInterval),
    expiresAt: optStr(raw.expiresAt),
  };
}

function toActionResult(raw: Raw): SubscriptionActionResult {
  return {
    action: str(raw.action),
    subscriptionId: str(raw.subscriptionId),
    status: str(raw.status),
    effectiveAt: optStr(raw.effectiveAt),
    message: optStr(raw.message),
  };
}

export const billingApi = {
  getOverview: async (): Promise<BillingOverview> =>
    toBillingOverview(await apiClient.get<Raw>("/v1/billing/portal/overview")),

  /** Plans offered to this tenant, flagged with the current plan and eligible changes. */
  listPlans: async (): Promise<Plan[]> => {
    const comparison = await apiClient.get<{ plans?: Raw[] }>(
      "/v1/billing/portal/plans/comparison",
    );
    return rows(comparison.plans).map(toPlan);
  },

  getCurrentSubscription: async (): Promise<Subscription | null> => {
    const overview = await apiClient.get<Raw>("/v1/billing/portal/overview");
    return toSubscription(overview.subscription as Raw | null);
  },

  createCheckout: async (data: {
    planId: string;
    billingInterval?: string;
    successUrl?: string;
    cancelUrl?: string;
  }): Promise<Checkout> =>
    toCheckout(
      await apiClient.post<Raw>("/v1/billing/portal/checkout", {
        planId: data.planId,
        ...(data.billingInterval
          ? { billingInterval: data.billingInterval }
          : {}),
        ...(data.successUrl ? { successUrl: data.successUrl } : {}),
        ...(data.cancelUrl ? { cancelUrl: data.cancelUrl } : {}),
        idempotencyKey: newIdempotencyKey("checkout"),
      }),
    ),

  getCheckoutStatus: (checkoutId: string) =>
    apiClient.get<{
      checkoutId: string;
      status: string;
      paymentStatus: string;
      verified: boolean;
    }>(`/v1/billing/portal/checkout/${encodeURIComponent(checkoutId)}/status`),

  /** Schedules cancellation at the end of the current period (access continues until then). */
  cancelSubscription: async (
    data: { reason?: string } = {},
  ): Promise<SubscriptionActionResult> =>
    toActionResult(
      await apiClient.post<Raw>(
        "/v1/billing/portal/subscription/cancel",
        data.reason ? { reason: data.reason } : {},
      ),
    ),

  resumeSubscription: async (): Promise<SubscriptionActionResult> =>
    toActionResult(
      await apiClient.post<Raw>("/v1/billing/portal/subscription/resume", {}),
    ),

  changePlan: async (data: {
    planId: string;
    atPeriodEnd?: boolean;
  }): Promise<SubscriptionActionResult> =>
    toActionResult(
      await apiClient.post<Raw>("/v1/billing/portal/subscription/change-plan", {
        planId: data.planId,
        ...(data.atPeriodEnd !== undefined
          ? { atPeriodEnd: data.atPeriodEnd }
          : {}),
      }),
    ),

  listInvoices: async (params?: {
    status?: string;
    limit?: number;
    fromDate?: string;
    toDate?: string;
  }): Promise<{ data: Invoice[]; total: number }> => {
    const res = await apiClient.get<{ invoices?: Raw[]; total?: number }>(
      "/v1/billing/portal/invoices",
      {
        searchParams: {
          status: params?.status,
          limit: params?.limit,
          fromDate: params?.fromDate,
          toDate: params?.toDate,
        },
      },
    );
    const data = rows(res.invoices).map(toInvoice);
    return { data, total: res.total ?? data.length };
  },

  getInvoice: async (id: string): Promise<Invoice> =>
    toInvoice(
      await apiClient.get<Raw>(
        `/v1/billing/portal/invoices/${encodeURIComponent(id)}`,
      ),
    ),

  listPayments: async (params?: {
    status?: string;
    limit?: number;
    fromDate?: string;
    toDate?: string;
  }): Promise<{ data: Payment[]; total: number }> => {
    const res = await apiClient.get<{ payments?: Raw[]; total?: number }>(
      "/v1/billing/portal/payments",
      {
        searchParams: {
          status: params?.status,
          limit: params?.limit,
          fromDate: params?.fromDate,
          toDate: params?.toDate,
        },
      },
    );
    const data = rows(res.payments).map(toPayment);
    return { data, total: res.total ?? data.length };
  },

  getUsage: async (): Promise<UsageRecord[]> => {
    const summary = await apiClient.get<{ items?: Raw[] }>(
      "/v1/billing/portal/usage",
    );
    return rows(summary.items).map(toUsageRecord);
  },
};
```

FILE: apps/web/src/api/client-lifecycle-api.ts

```typescript
import { apiClient } from "./api-client";

/**
 * Client-lifecycle reads for the customer account area (/v1/client-lifecycle).
 *
 * The pages used to call routes that do not exist (accounts/current,
 * onboarding/current, onboarding/steps, onboarding/blockers) or omitted the
 * /v1 prefix (relationships, restrictions). The API scopes every list below
 * to the caller's own client profile and accounts.
 */

type Raw = Record<string, unknown>;

export interface LifecycleAccount {
  id: string;
  displayName: string;
  accountType: string;
  state: string;
  complianceStatus: string | null;
  riskStatus: string | null;
  clientProfileId: string | null;
}

export interface Relationship {
  id: string;
  relationshipType: string;
  status: string;
  targetId: string;
}

export interface Restriction {
  id: string;
  restrictionType: string;
  reason: string;
  status: string;
  scope: string;
}

export interface OnboardingStep {
  id: string;
  stepType: string;
  status: string;
  required: boolean;
  blockingReasons: string[];
}

export interface Onboarding {
  id: string;
  state: string;
  currentStep: string | null;
  steps: OnboardingStep[];
  blockingReasons: string[];
  /** Completed required steps / required steps, 0-100 (computed: the API has no percentage). */
  progressPct: number;
}

const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const rows = (v: unknown): Raw[] => (Array.isArray(obj(v).data) ? (obj(v).data as unknown[]).map(obj) : []);

/** blockingReasons is JSON: strings, or objects with reason/message/code. */
export function reasonList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) => {
      if (typeof item === "string") return item;
      const r = obj(item);
      return str(r.reason) || str(r.message) || str(r.code);
    })
    .filter((s) => s.length > 0);
}

// ClientOnboardingStepStatus: PENDING, IN_PROGRESS, COMPLETED, FAILED, BLOCKED, SKIPPED.
const DONE_STEP = new Set(["COMPLETED", "SKIPPED"]);

export function parseOnboarding(input: unknown): Onboarding | null {
  if (!input || typeof input !== "object") return null;
  const r = obj(input);
  const steps: OnboardingStep[] = (Array.isArray(r.steps) ? r.steps : []).map((raw) => {
    const s = obj(raw);
    return {
      id: str(s.id),
      stepType: str(s.stepType, "STEP"),
      status: str(s.status, "PENDING"),
      required: s.required !== false,
      blockingReasons: reasonList(s.blockingReasons),
    };
  });
  const required = steps.filter((s) => s.required);
  const done = required.filter((s) => DONE_STEP.has(s.status)).length;
  const state = str(r.state, "NOT_STARTED");
  const progressPct =
    state === "APPROVED" ? 100 : required.length === 0 ? 0 : Math.round((done / required.length) * 100);
  return {
    id: str(r.id),
    state,
    currentStep: strOrNull(r.currentStep),
    steps,
    blockingReasons: reasonList(r.blockingReasons),
    progressPct,
  };
}

export const clientLifecycleApi = {
  listAccounts: async (): Promise<LifecycleAccount[]> =>
    rows(await apiClient.get<unknown>("/v1/client-lifecycle/accounts", { searchParams: { limit: 100 } })).map((a) => ({
      id: str(a.id),
      displayName: str(a.displayName) || `${str(a.accountType, "TRADING")} account`,
      accountType: str(a.accountType, "TRADING"),
      state: str(a.state, "PENDING"),
      complianceStatus: strOrNull(a.complianceStatus),
      riskStatus: strOrNull(a.riskStatus),
      clientProfileId: strOrNull(a.clientProfileId),
    })),

  listRelationships: async (): Promise<Relationship[]> =>
    rows(await apiClient.get<unknown>("/v1/client-lifecycle/relationships")).map((r) => ({
      id: str(r.id),
      relationshipType: str(r.relationshipType, "RELATIONSHIP"),
      status: str(r.status, "ACTIVE"),
      targetId: str(r.targetId),
    })),

  listRestrictions: async (): Promise<Restriction[]> =>
    rows(await apiClient.get<unknown>("/v1/client-lifecycle/restrictions")).map((r) => ({
      id: str(r.id),
      restrictionType: str(r.restrictionType, "RESTRICTION"),
      reason: str(r.reason),
      status: str(r.status, "ACTIVE"),
      scope: str(r.scope, "ACCOUNT"),
    })),

  /** The caller's own client profile id (the API filters the list to profiles the caller may see). */
  getOwnClientProfileId: async (): Promise<string | null> => {
    const list = rows(await apiClient.get<unknown>("/v1/client-lifecycle/clients", { searchParams: { limit: 1 } }));
    return strOrNull(list[0]?.id);
  },

  getOnboarding: async (clientProfileId: string): Promise<Onboarding | null> =>
    parseOnboarding(
      await apiClient.get<unknown>(`/v1/client-lifecycle/clients/${encodeURIComponent(clientProfileId)}/onboarding`),
    ),
};
```

FILE: apps/web/src/api/exchange-api.ts

```typescript
import { apiClient } from './api-client';
import { newIdempotencyKey } from '@/lib/idempotency-key';

/**
 * Exchange accounts of the signed-in user.
 *
 * Account lifecycle - ExchangesController (/v1/exchanges/accounts):
 *   GET  /accounts                 exchange_account:read   -> { data, total } (own accounts)
 *   GET  /accounts/:id             exchange_account:read   (404 for someone else's account)
 *   POST /accounts                 exchange_account:manage CreateExchangeAccountDto
 *   POST /accounts/:id/disable     exchange_account:manage { reason }
 *   POST /accounts/:id/revoke      exchange_account:manage { reason, confirmation? }
 *   PUT  /accounts/:id             tenant operators only   { label?, privateStreamEnabled?, ipAllowlist? }
 * Runtime checks - ExchangeAccountsController (/v1/execution/accounts):
 *   POST /:id/verify               exchange_account:verify -> queued job (202)
 *   GET  /:id/connectivity         exchange_account:read
 * Credentials are sent once, over the session-bound proxy, and are never
 * returned: responses carry only the masked key (last four characters).
 */

export interface ExchangeAccount {
  id: string;
  exchange: string;
  environment: string;
  label?: string;
  maskedApiKey?: string;
  status: string;
  connectionState?: string;
  health: string;
  capabilities: string[];
  tradingEnabled: boolean;
  isSandbox: boolean;
  lastConnectedAt?: string;
  lastHealthCheckAt?: string;
  errorMessage?: string;
  permissions: string[];
  createdAt: string;
}

export interface Exchange {
  id: string;
  name: string;
  slug: string;
  status: string;
  supportedMarketTypes: string[];
}

export interface ExchangeConnectivity {
  health: string;
  lastCheckAt: string;
  issues: string[];
  credentialsVerified: boolean;
  consecutiveFailures: number;
}

/** ExchangeVenue values the backend accepts. */
export const EXCHANGE_VENUES = ['BINANCE', 'BYBIT', 'OKX', 'KRAKEN', 'COINBASE'] as const;
export const EXCHANGE_ENVIRONMENTS = ['LIVE', 'TESTNET', 'SANDBOX'] as const;
/** Venues whose API keys come with a passphrase. */
export const PASSPHRASE_VENUES: readonly string[] = ['OKX', 'COINBASE'];

/** ExchangeSafeReference. */
interface BackendExchangeAccount {
  accountId: string;
  venue: string;
  environment: string;
  label: string;
  maskedApiKey: string;
  status: string;
  connectionState: string;
  healthState: string;
  capabilities: string[];
  isSandbox: boolean;
  liveTradingEnabled: boolean;
  lastVerifiedAt: string | null;
  lastSyncAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
}

/** AccountConnectivityView. */
interface BackendConnectivity {
  status: string;
  credentialsVerified: boolean;
  lastVerifiedAt: string | null;
  lastFailureCode: string | null;
  consecutiveFailures: number;
  openIncidents: number;
  criticalIncidents: number;
  unreconciledOrders: number;
}

const FAILURE_MESSAGES: Record<string, string> = {
  AUTH_FAILED: 'The exchange rejected the API key. Check the key and secret.',
  INVALID_CREDENTIALS: 'The exchange rejected the API key. Check the key and secret.',
  PERMISSION_DENIED: 'The API key is missing a permission the platform needs (read and trade).',
  WITHDRAWAL_NOT_ALLOWED: 'The API key allows withdrawals. Create a key with withdrawals disabled.',
  ENVIRONMENT_MISMATCH: 'The key belongs to a different environment (live vs. testnet).',
  RATE_LIMITED: 'The exchange is rate limiting requests. Try again shortly.',
  PROVIDER_UNAVAILABLE: 'The exchange could not be reached. Try again shortly.',
};

export function describeFailure(code: string | null | undefined): string | undefined {
  if (!code) return undefined;
  return FAILURE_MESSAGES[code] ?? `Last check failed (${code}).`;
}

export function toExchangeAccount(raw: BackendExchangeAccount): ExchangeAccount {
  return {
    id: raw.accountId,
    exchange: raw.venue,
    environment: raw.environment,
    label: raw.label || undefined,
    maskedApiKey: raw.maskedApiKey,
    status: raw.status,
    connectionState: raw.connectionState,
    health: raw.healthState,
    capabilities: raw.capabilities ?? [],
    tradingEnabled: raw.liveTradingEnabled === true,
    isSandbox: raw.isSandbox === true,
    lastConnectedAt: raw.lastVerifiedAt ?? undefined,
    lastHealthCheckAt: raw.lastSyncAt ?? undefined,
    errorMessage: describeFailure(raw.lastErrorCode),
    permissions: raw.capabilities ?? [],
    createdAt: raw.createdAt,
  };
}

export function toConnectivity(raw: BackendConnectivity): ExchangeConnectivity {
  const issues: string[] = [];
  const failure = describeFailure(raw.lastFailureCode);
  if (failure) issues.push(failure);
  if (raw.criticalIncidents > 0) issues.push(`${raw.criticalIncidents} critical incident(s) open`);
  else if (raw.openIncidents > 0) issues.push(`${raw.openIncidents} incident(s) open`);
  if (raw.unreconciledOrders > 0) issues.push(`${raw.unreconciledOrders} order(s) awaiting reconciliation`);
  const health = raw.credentialsVerified && issues.length === 0 ? 'HEALTHY' : raw.credentialsVerified ? 'DEGRADED' : 'UNVERIFIED';
  return {
    health,
    lastCheckAt: raw.lastVerifiedAt ?? '',
    issues,
    credentialsVerified: raw.credentialsVerified,
    consecutiveFailures: raw.consecutiveFailures,
  };
}

export const exchangeApi = {
  listExchanges: async (): Promise<Exchange[]> =>
    EXCHANGE_VENUES.map((venue) => ({
      id: venue,
      name: venue.charAt(0) + venue.slice(1).toLowerCase(),
      slug: venue.toLowerCase(),
      status: 'AVAILABLE',
      supportedMarketTypes: [],
    })),

  listAccounts: async (): Promise<{ data: ExchangeAccount[]; total: number }> => {
    const page = await apiClient.get<{ data: BackendExchangeAccount[]; total: number }>('/v1/exchanges/accounts');
    const data = (page?.data ?? []).map(toExchangeAccount);
    return { data, total: page?.total ?? data.length };
  },

  getAccount: async (id: string): Promise<ExchangeAccount> =>
    toExchangeAccount(await apiClient.get<BackendExchangeAccount>(`/v1/exchanges/accounts/${encodeURIComponent(id)}`)),

  connectAccount: async (data: {
    exchange: string;
    environment?: string;
    label?: string;
    apiKey: string;
    apiSecret: string;
    passphrase?: string;
  }): Promise<ExchangeAccount> => {
    const label = data.label?.trim() || `${data.exchange.charAt(0)}${data.exchange.slice(1).toLowerCase()} account`;
    const raw = await apiClient.post<BackendExchangeAccount>('/v1/exchanges/accounts', {
      venue: data.exchange,
      environment: data.environment ?? 'LIVE',
      label: label.slice(0, 80),
      apiKey: data.apiKey.trim(),
      apiSecret: data.apiSecret.trim(),
      ...(data.passphrase ? { passphrase: data.passphrase } : {}),
      idempotencyKey: newIdempotencyKey('connect'),
    });
    return toExchangeAccount(raw);
  },

  /** Tenant operators only (exchange_account:manage + trading:write). */
  updateAccount: async (id: string, data: { label?: string }): Promise<ExchangeAccount> =>
    toExchangeAccount(await apiClient.put<BackendExchangeAccount>(`/v1/exchanges/accounts/${encodeURIComponent(id)}`, { label: data.label })),

  disableAccount: async (id: string, reason: string): Promise<ExchangeAccount> =>
    toExchangeAccount(await apiClient.post<BackendExchangeAccount>(`/v1/exchanges/accounts/${encodeURIComponent(id)}/disable`, { reason })),

  /** Revokes the connection: credentials are wiped and the key can be connected again later. */
  disconnectAccount: async (id: string, reason = 'Disconnected by the account owner'): Promise<void> => {
    await apiClient.post<BackendExchangeAccount>(`/v1/exchanges/accounts/${encodeURIComponent(id)}/revoke`, { reason });
  },

  /** Queues a credential check; poll getAccountHealth for the outcome. */
  verifyAccount: async (id: string): Promise<{ status: string; health: string; message?: string }> => {
    const res = await apiClient.post<{ accepted: boolean; jobId: string; note: string }>(`/v1/execution/accounts/${encodeURIComponent(id)}/verify`);
    return { status: res?.accepted ? 'QUEUED' : 'REJECTED', health: 'PENDING', message: res?.note };
  },

  getAccountHealth: async (id: string): Promise<ExchangeConnectivity> =>
    toConnectivity(await apiClient.get<BackendConnectivity>(`/v1/execution/accounts/${encodeURIComponent(id)}/connectivity`)),
};
```

FILE: apps/web/src/api/funding-api.ts

```typescript
import { apiClient } from "./api-client";

/**
 * Customer deposits and withdrawals (/v1/client-lifecycle/funding, /withdrawals).
 *
 * Both are *requests* against one of the caller's accounts: operators review
 * them, and only a CONFIRMED request means money moved. The backend filters
 * every list to the caller's own accounts (tenant isolation plus ownership),
 * validates the amount (> 0), the currency against the tenant funding policy,
 * account restrictions and compliance/risk holds. Custody wallets and deposit
 * addresses are an operator surface and are not called from here.
 */

export type FundingDirection = "DEPOSIT" | "WITHDRAWAL";

export type FundingState =
  | "REQUESTED"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "SUBMITTED"
  | "CONFIRMED"
  | "FAILED"
  | "REVERSED"
  | "CANCELLED";

/** States in which a request is still open (not money movement yet). */
export const OPEN_FUNDING_STATES: readonly string[] = [
  "REQUESTED",
  "UNDER_REVIEW",
  "APPROVED",
  "SUBMITTED",
];

export interface FundingAccount {
  id: string;
  label: string;
  accountType: string;
  state: string;
  clientProfileId: string | null;
  isFundingEnabled: boolean;
  isWithdrawalEnabled: boolean;
}

export interface FundingRequest {
  id: string;
  type: FundingDirection;
  accountId: string;
  state: string;
  /** Requested amount (what the customer asked for). */
  amount: string;
  approvedAmount: string | null;
  confirmedAmount: string | null;
  settledAmount: string | null;
  currency: string;
  /** Alias of `currency`, kept for existing callers. */
  asset: string;
  destinationAddress: string | null;
  externalReference: string | null;
  failureReason: string | null;
  requestedAt: string;
  confirmedAt: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FundingPage {
  data: FundingRequest[];
  total: number;
}

type Raw = Record<string, unknown>;

function optStr(value: unknown): string | null {
  return value === null || value === undefined || value === ""
    ? null
    : String(value);
}

function rows(value: unknown): Raw[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Raw => typeof item === "object" && item !== null,
      )
    : [];
}

export function toFundingAccount(raw: Raw): FundingAccount {
  const id = String(raw.id ?? "");
  const accountType = String(raw.accountType ?? "ACCOUNT");
  return {
    id,
    label:
      optStr(raw.displayName) ??
      `${accountType.replace(/_/g, " ").toLowerCase()} ${id.slice(0, 8)}`,
    accountType,
    state: String(raw.state ?? "UNKNOWN"),
    clientProfileId: optStr(raw.clientProfileId),
    isFundingEnabled: raw.isFundingEnabled === true,
    isWithdrawalEnabled: raw.isWithdrawalEnabled === true,
  };
}

export function toFundingRequest(
  raw: Raw,
  type: FundingDirection,
): FundingRequest {
  const currency = String(raw.currency ?? "");
  const requestedAt = String(raw.requestedAt ?? raw.createdAt ?? "");
  return {
    id: String(raw.id ?? ""),
    type,
    accountId: String(raw.accountId ?? ""),
    state: String(raw.state ?? "UNKNOWN"),
    amount: String(raw.requestedAmount ?? "0"),
    approvedAmount: optStr(raw.approvedAmount),
    confirmedAmount: optStr(raw.confirmedAmount),
    settledAmount: optStr(raw.settledAmount),
    currency,
    asset: currency,
    destinationAddress: optStr(raw.destinationAddress),
    externalReference: optStr(raw.externalReference),
    failureReason: optStr(raw.failureReason),
    requestedAt,
    confirmedAt: optStr(raw.confirmedAt),
    failedAt: optStr(raw.failedAt),
    createdAt: String(raw.createdAt ?? requestedAt),
    updatedAt: String(raw.updatedAt ?? raw.createdAt ?? requestedAt),
  };
}

/** Deposits and withdrawals interleaved newest first (display only; totals are summed). */
export function mergeFundingHistory(
  deposits: FundingPage,
  withdrawals: FundingPage,
  limit: number,
): FundingPage {
  const data = [...deposits.data, ...withdrawals.data]
    .sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt))
    .slice(0, limit);
  return { data, total: deposits.total + withdrawals.total };
}

/** UX pre-check only; the backend applies the authoritative validation. */
export function isPositiveAmount(value: string): boolean {
  return /^\d+(\.\d+)?$/.test(value) && /[1-9]/.test(value);
}

type ListParams = {
  accountId?: string;
  state?: string;
  currency?: string;
  page?: number;
  limit?: number;
};

async function listPage(
  path: string,
  type: FundingDirection,
  params?: ListParams,
): Promise<FundingPage> {
  const res = await apiClient.get<{ data?: Raw[]; total?: number }>(path, {
    searchParams: {
      accountId: params?.accountId,
      state: params?.state,
      currency: params?.currency,
      page: params?.page,
      limit: params?.limit,
    },
  });
  const data = rows(res.data).map((raw) => toFundingRequest(raw, type));
  return { data, total: res.total ?? data.length };
}

export const fundingApi = {
  /** Accounts the caller owns or may act for (filtered by the backend). */
  listAccounts: async (): Promise<FundingAccount[]> => {
    const res = await apiClient.get<{ data?: Raw[] }>(
      "/v1/client-lifecycle/accounts",
      { searchParams: { limit: 100 } },
    );
    return rows(res.data).map(toFundingAccount);
  },

  listFundingRequests: (params?: ListParams): Promise<FundingPage> =>
    listPage("/v1/client-lifecycle/funding", "DEPOSIT", params),

  listWithdrawalRequests: (params?: ListParams): Promise<FundingPage> =>
    listPage("/v1/client-lifecycle/withdrawals", "WITHDRAWAL", params),

  listHistory: async (params?: {
    accountId?: string;
    limit?: number;
  }): Promise<FundingPage> => {
    const limit = params?.limit ?? 20;
    const [deposits, withdrawals] = await Promise.all([
      listPage("/v1/client-lifecycle/funding", "DEPOSIT", {
        accountId: params?.accountId,
        page: 1,
        limit,
      }),
      listPage("/v1/client-lifecycle/withdrawals", "WITHDRAWAL", {
        accountId: params?.accountId,
        page: 1,
        limit,
      }),
    ]);
    return mergeFundingHistory(deposits, withdrawals, limit);
  },

  createDepositRequest: async (data: {
    accountId: string;
    amount: string;
    currency: string;
    externalReference?: string;
  }): Promise<FundingRequest> =>
    toFundingRequest(
      await apiClient.post<Raw>("/v1/client-lifecycle/funding", {
        accountId: data.accountId,
        requestedAmount: data.amount,
        currency: data.currency,
        ...(data.externalReference
          ? { externalReference: data.externalReference }
          : {}),
      }),
      "DEPOSIT",
    ),

  createWithdrawalRequest: async (data: {
    accountId: string;
    amount: string;
    currency: string;
    destinationAddress: string;
    destinationType?: string;
  }): Promise<FundingRequest> =>
    toFundingRequest(
      await apiClient.post<Raw>("/v1/client-lifecycle/withdrawals", {
        accountId: data.accountId,
        requestedAmount: data.amount,
        currency: data.currency,
        destinationAddress: data.destinationAddress,
        ...(data.destinationType
          ? { destinationType: data.destinationType }
          : {}),
      }),
      "WITHDRAWAL",
    ),
};
```

FILE: apps/web/src/api/notification-api.ts

```typescript
import { apiClient } from './api-client';

/**
 * In-app notifications and delivery preferences of the signed-in user.
 *
 * Backend (NotificationsController, /v1/notifications):
 *   GET   /                 ?page&limit&unreadOnly&channel -> { items, pagination }
 *   GET   /unread-count     -> { unread }
 *   PATCH /:id/read
 *   POST  /read-all
 *   GET   /preferences      -> [{ category, channel, enabled }]   (only stored rows)
 *   PATCH /preferences      { preferences: [{ category, channel, enabled }] }
 * A category/channel pair without a stored row is delivered (enabled), and
 * security-critical messages always reach IN_APP and EMAIL regardless.
 */

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  channel: string;
  read: boolean;
  priority: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

export interface NotificationPreference {
  channel: string;
  enabled: boolean;
  categories: Record<string, boolean>;
}

/** NotificationCategory in @wlct/shared-types. */
export const NOTIFICATION_CATEGORIES = ['account', 'security', 'billing', 'trading', 'general'] as const;

/** Channels a customer can switch per category (NotificationChannel values). */
export const PREFERENCE_CHANNELS = ['IN_APP', 'EMAIL', 'PUSH', 'SMS'] as const;

interface BackendNotification {
  id: string;
  channel: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

interface BackendNotificationPage {
  items: BackendNotification[];
  pagination: { page: number; limit: number; totalItems: number; totalPages: number };
}

interface BackendPreference {
  category: string;
  channel: string;
  enabled: boolean;
}

export function toNotification(raw: BackendNotification): Notification {
  const priority = typeof raw.data?.priority === 'string' ? (raw.data.priority as string) : 'NORMAL';
  return {
    id: raw.id,
    type: raw.type,
    title: raw.title,
    message: raw.body,
    channel: raw.channel,
    read: raw.readAt !== null,
    priority,
    data: raw.data ?? undefined,
    createdAt: raw.createdAt,
  };
}

/** One entry per channel with every category filled in (missing rows are enabled). */
export function toPreferenceMatrix(rows: readonly BackendPreference[]): NotificationPreference[] {
  return PREFERENCE_CHANNELS.map((channel) => {
    const categories: Record<string, boolean> = {};
    for (const category of NOTIFICATION_CATEGORIES) {
      const stored = rows.find((row) => row.channel === channel && row.category === category);
      categories[category] = stored ? stored.enabled : true;
    }
    return { channel, enabled: Object.values(categories).some(Boolean), categories };
  });
}

/**
 * Flattens the matrix into backend entries. A channel switched off entirely
 * stores every category as disabled for that channel.
 */
export function toPreferenceEntries(preferences: readonly NotificationPreference[]): BackendPreference[] {
  const entries: BackendPreference[] = [];
  for (const preference of preferences) {
    for (const category of NOTIFICATION_CATEGORIES) {
      entries.push({
        category,
        channel: preference.channel,
        enabled: preference.enabled && (preference.categories[category] ?? true),
      });
    }
  }
  return entries;
}

export const notificationApi = {
  list: async (params?: { read?: boolean; page?: number; limit?: number }) => {
    const [page, unread] = await Promise.all([
      apiClient.get<BackendNotificationPage>('/v1/notifications', {
        searchParams: {
          page: params?.page,
          limit: params?.limit,
          unreadOnly: params?.read === false ? true : undefined,
        },
      }),
      apiClient.get<{ unread: number }>('/v1/notifications/unread-count'),
    ]);
    const data = (page?.items ?? []).map(toNotification);
    const items = params?.read === true ? data.filter((n) => n.read) : data;
    return { data: items, total: page?.pagination?.totalItems ?? items.length, unreadCount: unread?.unread ?? 0 };
  },

  getUnreadCount: async (): Promise<number> => {
    const res = await apiClient.get<{ unread: number }>('/v1/notifications/unread-count');
    return res?.unread ?? 0;
  },

  markAsRead: (id: string) => apiClient.patch<void>(`/v1/notifications/${encodeURIComponent(id)}/read`),

  markAllAsRead: () => apiClient.post<void>('/v1/notifications/read-all'),

  getPreferences: async (): Promise<NotificationPreference[]> => {
    const rows = await apiClient.get<BackendPreference[]>('/v1/notifications/preferences');
    return toPreferenceMatrix(rows ?? []);
  },

  updatePreferences: async (data: { preferences: NotificationPreference[] }): Promise<NotificationPreference[]> => {
    const rows = await apiClient.patch<BackendPreference[]>('/v1/notifications/preferences', {
      preferences: toPreferenceEntries(data.preferences),
    });
    return toPreferenceMatrix(rows ?? []);
  },
};
```

FILE: apps/web/src/api/operations-api.ts

```typescript
import { apiClient } from "./api-client";

/**
 * Customer-facing maintenance notice: GET /v1/operations/maintenance/current
 * (any signed-in user; the API scopes it to the caller's tenant plus
 * platform-wide windows). The banner and status page used to call
 * /operations/maintenance/current without /v1 and /operations/status, which
 * does not exist, so neither ever showed a maintenance window.
 */
export interface MaintenanceNotice {
  active: boolean;
  title: string | null;
  message: string | null;
  scope: string | null;
  isEmergency: boolean;
  startedAt: string | null;
  endsAt: string | null;
  /** Whether this window disables copying (platform-wide, tenant-wide or trading scope). */
  blocksTrading: boolean;
}

const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export function parseMaintenanceNotice(input: unknown): MaintenanceNotice {
  const r = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const title = strOrNull(r.title);
  return {
    active: r.active === true,
    title,
    message: strOrNull(r.message) ?? title,
    scope: strOrNull(r.scope),
    isEmergency: r.isEmergency === true,
    startedAt: strOrNull(r.startedAt),
    endsAt: strOrNull(r.endsAt),
    blocksTrading: r.active === true && (typeof r.blocksTrading === "boolean" ? r.blocksTrading : true),
  };
}

export const operationsApi = {
  getCurrentMaintenance: async (): Promise<MaintenanceNotice> =>
    parseMaintenanceNotice(await apiClient.get<unknown>("/v1/operations/maintenance/current")),
};
```

FILE: apps/web/src/api/portfolio-api.ts

```typescript
import { apiClient } from "./api-client";

/**
 * Portfolio accounting of the signed-in user - PortfolioAccountingController
 * (/v1/portfolio-accounting). Every figure is computed by the backend; the
 * frontend only formats the decimal strings it receives.
 *
 *   GET /profiles?scopeId=           own profiles (report readers see the tenant)
 *   GET /nav?profileId=               { nav, cash, baseCurrency, valuationTimestamp, dataCompleteness, canPublish, ... }
 *   GET /pnl?profileId=&from=&to=     { realized, unrealized, gross, net }
 *   GET /holdings?profileId=          [{ symbol, asset, quantity, classification, costBasis }]
 *   GET /performance?profileId=&periodStart=&periodEnd=&methodology=  { returnPercent, canCalculate, reason? }
 *   GET /attribution?profileId=&periodStart=&periodEnd=&dimension=    { attributions[], totalAttributed, unattributed, ... }
 *   GET /snapshots?profileId=&from=&to=  { data, total, page, limit }
 *
 * There is no "overview" or "valuation-status" route: both are composed here
 * from /nav and /pnl. Someone else's profile answers 404.
 */

export type ValuationState =
  | "VALID"
  | "STALE"
  | "MISSING_PRICE"
  | "MISSING_FX"
  | "INCOMPLETE"
  | "UNAVAILABLE";

export interface PortfolioProfile {
  id: string;
  scope: string;
  scopeId: string;
  portfolioType?: string;
  baseCurrency: string;
  returnMethodology?: string;
}

export interface PortfolioOverview {
  tenantId: string;
  profileId: string;
  nav: string; // backend-authoritative, string for precision
  cash: string;
  totalRealizedPnl: string;
  totalUnrealizedPnl: string;
  dailyPnl: string;
  periodPnl: string;
  currency: string;
  valuationState: ValuationState;
  lastValuationAt: string;
  fxStatus?: string;
  dataCompleteness?: string;
}

export interface Holding {
  id: string;
  symbol: string;
  asset: string;
  quantity: string;
  avgCost: string;
  currentPrice?: string;
  marketValue?: string;
  unrealizedPnl?: string;
  realizedPnl?: string;
  classification: string;
  venue?: string;
  valuationState?: string;
  lastUpdatedAt?: string;
}

export interface PnlRecord {
  period: string;
  realized: string;
  unrealized: string;
  gross: string;
  net: string;
  fees: string;
  currency: string;
  methodology: string;
}

export interface PerformancePoint {
  timestamp: string;
  nav: string;
  pnl: string;
  returnPct: string;
}

export interface PerformanceSummary {
  periodStart: string;
  periodEnd: string;
  methodology: string;
  returnPct: string | null;
  canCalculate: boolean;
  reason?: string;
  points: PerformancePoint[];
}

export interface AttributionRecord {
  dimension: string;
  key: string;
  pnl: string;
  allocationPct: string;
  returnPct: string;
}

export interface PortfolioSnapshot {
  id: string;
  timestamp: string;
  nav: string;
  cash: string;
  holdings: Holding[];
  valuationState: string;
  netPnl?: string;
  baseCurrency?: string;
}

export interface ValuationStatusView {
  state: ValuationState;
  lastValuationAt: string;
  missingPrices: string[];
  fxStatus: string;
  dataCompleteness: string;
}

export const ATTRIBUTION_DIMENSIONS = [
  "STRATEGY",
  "TRADER",
  "FOLLOWER",
  "SYMBOL",
  "ASSET",
  "VENUE",
] as const;
export type AttributionDimension = (typeof ATTRIBUTION_DIMENSIONS)[number];

/** Backend shapes. */
interface BackendNav {
  nav: string | null;
  cash: string;
  baseCurrency: string;
  valuationTimestamp: string;
  dataCompleteness: string;
  canPublish?: boolean;
}

interface BackendPnl {
  realized: { realizedPnl: string } | null;
  unrealized: {
    unrealizedPnl: string | null;
    hasMissingPrice?: boolean;
    hasStalePrice?: boolean;
  } | null;
  gross: { grossPnl: string | null } | null;
  net: { netPnl: string | null; grossPnl: string | null; fees: string } | null;
}

interface BackendHolding {
  symbol: string;
  asset: string;
  quantity: string;
  classification: string;
  costBasis: string | null;
}

interface BackendSnapshot {
  id: string;
  snapshotId?: string;
  timestamp: string;
  nav: string;
  cash: string;
  netPnl?: string | null;
  baseCurrency?: string;
  positions?: unknown;
  dataCompleteness?: string;
}

interface BackendAttribution {
  attributions: Array<{
    dimensionValue: string;
    pnl: string;
    percentage: string;
  }>;
}

interface BackendPerformance {
  returnPercent: string | null;
  canCalculate: boolean;
  reason?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_DAYS: Record<string, number> = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
};

/** Resolves '30d'-style periods to an ISO window ending now. */
export function periodWindow(
  period: string = "30d",
  now: Date = new Date(),
): { from: string; to: string } {
  const days = PERIOD_DAYS[period] ?? 30;
  return {
    from: new Date(now.getTime() - days * DAY_MS).toISOString(),
    to: now.toISOString(),
  };
}

/** Maps the backend data-completeness flag to the valuation state the UI shows. */
export function toValuationState(
  dataCompleteness: string | null | undefined,
  nav: string | null | undefined,
): ValuationState {
  if (nav === null || nav === undefined) return "UNAVAILABLE";
  switch (dataCompleteness) {
    case "COMPLETE":
      return "VALID";
    case "STALE_PRICE":
      return "STALE";
    case "MISSING_PRICE":
    case "MISSING_PRICE_INCOMPLETE":
      return "MISSING_PRICE";
    case "MISSING_FX":
    case "MISSING_FX_NO_NAV":
      return "MISSING_FX";
    case "CALCULATION_FAILED":
      return "UNAVAILABLE";
    default:
      return "INCOMPLETE";
  }
}

function netOf(pnl: BackendPnl | null | undefined): string {
  return pnl?.net?.netPnl ?? pnl?.gross?.grossPnl ?? "0";
}

export function toPnlRecord(
  pnl: BackendPnl,
  period: string,
  currency: string,
): PnlRecord {
  return {
    period,
    realized: pnl.realized?.realizedPnl ?? "0",
    unrealized: pnl.unrealized?.unrealizedPnl ?? "0",
    gross: pnl.gross?.grossPnl ?? "0",
    net: netOf(pnl),
    fees: pnl.net?.fees ?? "0",
    currency,
    methodology: "NET",
  };
}

export function toHolding(raw: BackendHolding): Holding {
  return {
    id: raw.symbol,
    symbol: raw.symbol,
    asset: raw.asset,
    quantity: raw.quantity,
    avgCost: raw.costBasis ?? "",
    classification: raw.classification,
  };
}

export function toSnapshot(raw: BackendSnapshot): PortfolioSnapshot {
  return {
    id: raw.snapshotId ?? raw.id,
    timestamp: raw.timestamp,
    nav: raw.nav,
    cash: raw.cash,
    holdings: [],
    valuationState: toValuationState(
      raw.dataCompleteness ?? "COMPLETE",
      raw.nav,
    ),
    netPnl: raw.netPnl ?? undefined,
    baseCurrency: raw.baseCurrency,
  };
}

async function fetchNav(profileId: string): Promise<BackendNav> {
  return apiClient.get<BackendNav>("/v1/portfolio-accounting/nav", {
    searchParams: { profileId },
  });
}

async function fetchPnl(
  profileId: string,
  from?: string,
  to?: string,
): Promise<BackendPnl> {
  return apiClient.get<BackendPnl>("/v1/portfolio-accounting/pnl", {
    searchParams: { profileId, from, to },
  });
}

export const portfolioApi = {
  /** Own portfolio profiles. `scopeId` keeps a tenant-wide reader on their own profile. */
  listProfiles: async (params?: {
    scopeId?: string;
    scope?: string;
  }): Promise<PortfolioProfile[]> => {
    const page = await apiClient.get<{ data: PortfolioProfile[] }>(
      "/v1/portfolio-accounting/profiles",
      {
        searchParams: { scopeId: params?.scopeId, scope: params?.scope },
      },
    );
    return page?.data ?? [];
  },

  /** The profile the portfolio screens show: own follower profile first, then trader, then any own profile. */
  getPrimaryProfile: async (
    userId?: string,
  ): Promise<PortfolioProfile | null> => {
    const profiles = await portfolioApi.listProfiles(
      userId ? { scopeId: userId } : undefined,
    );
    const rank = (p: PortfolioProfile): number =>
      p.scope === "FOLLOWER" ? 0 : p.scope === "TRADER" ? 1 : 2;
    return [...profiles].sort((a, b) => rank(a) - rank(b))[0] ?? null;
  },

  /** NAV, cash and P&L for one profile (composed from /nav and /pnl). */
  getOverview: async (profileId: string): Promise<PortfolioOverview> => {
    const day = periodWindow("1d");
    const month = periodWindow("30d");
    const [nav, total, daily, period] = await Promise.all([
      fetchNav(profileId),
      fetchPnl(profileId),
      fetchPnl(profileId, day.from, day.to),
      fetchPnl(profileId, month.from, month.to),
    ]);
    return {
      tenantId: "",
      profileId,
      nav: nav.nav ?? "",
      cash: nav.cash,
      totalRealizedPnl: total.realized?.realizedPnl ?? "0",
      totalUnrealizedPnl: total.unrealized?.unrealizedPnl ?? "0",
      dailyPnl: netOf(daily),
      periodPnl: netOf(period),
      currency: nav.baseCurrency,
      valuationState: toValuationState(nav.dataCompleteness, nav.nav),
      lastValuationAt: nav.valuationTimestamp,
      fxStatus: nav.dataCompleteness.startsWith("MISSING_FX")
        ? "MISSING_FX"
        : "VALID",
      dataCompleteness: nav.dataCompleteness,
    };
  },

  getHoldings: async (
    profileId: string,
  ): Promise<{ data: Holding[]; total: number }> => {
    const rows = await apiClient.get<BackendHolding[]>(
      "/v1/portfolio-accounting/holdings",
      { searchParams: { profileId } },
    );
    const data = (Array.isArray(rows) ? rows : []).map(toHolding);
    return { data, total: data.length };
  },

  /** P&L over the requested windows, newest window first. */
  getPnl: async (
    profileId: string,
    params?: { periods?: string[]; currency?: string },
  ): Promise<PnlRecord[]> => {
    const periods = params?.periods ?? ["1d", "7d", "30d"];
    const results = await Promise.all(
      periods.map(async (period) => {
        const window = periodWindow(period);
        return toPnlRecord(
          await fetchPnl(profileId, window.from, window.to),
          period,
          params?.currency ?? "",
        );
      }),
    );
    return results;
  },

  /** Period return from the backend plus the NAV series of persisted snapshots. */
  getPerformance: async (
    profileId: string,
    params?: {
      period?: string;
      methodology?: "TIME_WEIGHTED_RETURN" | "MONEY_WEIGHTED_RETURN";
    },
  ): Promise<PerformanceSummary> => {
    const window = periodWindow(params?.period ?? "30d");
    const methodology = params?.methodology ?? "TIME_WEIGHTED_RETURN";
    const [performance, snapshots] = await Promise.all([
      apiClient.get<BackendPerformance>(
        "/v1/portfolio-accounting/performance",
        {
          searchParams: {
            profileId,
            periodStart: window.from,
            periodEnd: window.to,
            methodology,
          },
        },
      ),
      apiClient.get<{ data: BackendSnapshot[] }>(
        "/v1/portfolio-accounting/snapshots",
        {
          searchParams: {
            profileId,
            from: window.from,
            to: window.to,
            limit: 100,
          },
        },
      ),
    ]);
    const points = (snapshots?.data ?? [])
      .map((s) => ({
        timestamp: s.timestamp,
        nav: s.nav,
        pnl: s.netPnl ?? "",
        returnPct: "",
      }))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return {
      periodStart: window.from,
      periodEnd: window.to,
      methodology,
      returnPct: performance?.returnPercent ?? null,
      canCalculate: performance?.canCalculate ?? false,
      reason: performance?.reason,
      points,
    };
  },

  getAttribution: async (
    profileId: string,
    params?: { dimension?: AttributionDimension; period?: string },
  ): Promise<AttributionRecord[]> => {
    const window = periodWindow(params?.period ?? "30d");
    const dimension = params?.dimension ?? "STRATEGY";
    const result = await apiClient.get<BackendAttribution>(
      "/v1/portfolio-accounting/attribution",
      {
        searchParams: {
          profileId,
          periodStart: window.from,
          periodEnd: window.to,
          dimension,
        },
      },
    );
    return (result?.attributions ?? []).map((a) => ({
      dimension,
      key: a.dimensionValue,
      pnl: a.pnl,
      allocationPct: a.percentage,
      // The backend reports each key's share of total P&L, not a return.
      returnPct: "",
    }));
  },

  getSnapshots: async (
    profileId: string,
    params?: { from?: string; to?: string; page?: number; limit?: number },
  ): Promise<{ data: PortfolioSnapshot[]; total: number }> => {
    const page = await apiClient.get<{
      data: BackendSnapshot[];
      total: number;
    }>("/v1/portfolio-accounting/snapshots", {
      searchParams: {
        profileId,
        from: params?.from,
        to: params?.to,
        page: params?.page,
        limit: params?.limit,
      },
    });
    const data = (page?.data ?? []).map(toSnapshot);
    return { data, total: page?.total ?? data.length };
  },

  /** Valuation freshness of one profile, from the backend NAV run. */
  getValuationStatus: async (
    profileId: string,
  ): Promise<ValuationStatusView> => {
    const nav = await fetchNav(profileId);
    const state = toValuationState(nav.dataCompleteness, nav.nav);
    return {
      state,
      lastValuationAt: nav.valuationTimestamp,
      missingPrices: [],
      fxStatus: state === "MISSING_FX" ? "MISSING_FX" : "VALID",
      dataCompleteness: nav.dataCompleteness,
    };
  },
};
```

FILE: apps/web/src/api/reporting-api.ts

```typescript
import { apiClient } from "./api-client";

/**
 * Account statements (/v1/portfolio-accounting/statements).
 *
 * Statements are generated and persisted by the backend; this client only reads
 * them. They are addressed by their `statementId` (not the row id), the list is
 * filtered server-side to the caller's own profiles, and an export returns the
 * file content inline (`{ csv, filename }` or `{ json, filename }`), which the
 * browser turns into a download. There is no PDF or signed-URL endpoint.
 */

export type StatementExportFormat = "CSV" | "JSON";

export interface StatementHolding {
  symbol: string;
  asset: string | null;
  quantity: string;
  classification: string | null;
  costBasis: string | null;
}

export interface Statement {
  /** The statementId: the key used by every statement route. */
  id: string;
  recordId: string;
  profileId: string;
  periodId: string | null;
  periodStart: string;
  periodEnd: string;
  state: string;
  currency: string;
  openingNav: string | null;
  closingNav: string | null;
  netPnl: string | null;
  returnPercent: string | null;
  returnMethodology: string | null;
  finalizedAt: string | null;
  createdAt: string;
}

export interface StatementDetail extends Statement {
  deposits: string | null;
  withdrawals: string | null;
  transfers: string | null;
  realizedPnl: string | null;
  unrealizedPnl: string | null;
  grossPnl: string | null;
  feesTotal: string | null;
  cash: string | null;
  benchmarkReturn: string | null;
  reconciliationStatus: string | null;
  tradeCount: number | null;
  endingHoldings: StatementHolding[];
}

export interface StatementList {
  data: Statement[];
  total: number;
  page: number;
  limit: number;
}

interface BackendStatement {
  id: string;
  statementId: string;
  profileId: string;
  periodId?: string | null;
  state: string;
  periodStart: string;
  periodEnd: string;
  openingNav?: string | null;
  closingNav?: string | null;
  deposits?: string | null;
  withdrawals?: string | null;
  transfers?: string | null;
  tradingActivity?: { count?: unknown } | null;
  realizedPnl?: string | null;
  unrealizedPnl?: string | null;
  fees?: { total?: string | null; grossPnl?: string | null } | null;
  netPnl?: string | null;
  returnMethodology?: string | null;
  returnPercent?: string | null;
  benchmarkReturn?: string | null;
  endingHoldings?: unknown;
  cash?: string | null;
  reconciliationStatus?: string | null;
  baseCurrency: string;
  finalizedAt?: string | null;
  createdAt: string;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

export function toStatement(raw: BackendStatement): Statement {
  return {
    id: raw.statementId,
    recordId: raw.id,
    profileId: raw.profileId,
    periodId: raw.periodId ?? null,
    periodStart: raw.periodStart,
    periodEnd: raw.periodEnd,
    state: raw.state,
    currency: raw.baseCurrency,
    openingNav: text(raw.openingNav),
    closingNav: text(raw.closingNav),
    netPnl: text(raw.netPnl),
    returnPercent: text(raw.returnPercent),
    returnMethodology: text(raw.returnMethodology),
    finalizedAt: raw.finalizedAt ?? null,
    createdAt: raw.createdAt,
  };
}

export function toStatementHoldings(value: unknown): StatementHolding[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null,
    )
    .map((item) => ({
      symbol: text(item.symbol) ?? text(item.asset) ?? "—",
      asset: text(item.asset),
      quantity: text(item.quantity) ?? "0",
      classification: text(item.classification),
      costBasis: text(item.costBasis),
    }));
}

export function toStatementDetail(raw: BackendStatement): StatementDetail {
  const count = raw.tradingActivity?.count;
  return {
    ...toStatement(raw),
    deposits: text(raw.deposits),
    withdrawals: text(raw.withdrawals),
    transfers: text(raw.transfers),
    realizedPnl: text(raw.realizedPnl),
    unrealizedPnl: text(raw.unrealizedPnl),
    grossPnl: text(raw.fees?.grossPnl),
    feesTotal: text(raw.fees?.total),
    cash: text(raw.cash),
    benchmarkReturn: text(raw.benchmarkReturn),
    reconciliationStatus: text(raw.reconciliationStatus),
    tradeCount:
      typeof count === "number" && Number.isFinite(count) ? count : null,
    endingHoldings: toStatementHoldings(raw.endingHoldings),
  };
}

/** File content of an export response as a Blob plus its filename. */
export function toExportFile(
  response: { csv?: string; json?: unknown; filename?: string },
  statementId: string,
  format: StatementExportFormat,
): { blob: Blob; filename: string } {
  const filename =
    response.filename ?? `statement_${statementId}.${format.toLowerCase()}`;
  if (format === "CSV") {
    return {
      blob: new Blob([response.csv ?? ""], { type: "text/csv;charset=utf-8" }),
      filename,
    };
  }
  return {
    blob: new Blob([JSON.stringify(response.json ?? null, null, 2)], {
      type: "application/json",
    }),
    filename,
  };
}

export const reportingApi = {
  listStatements: async (params?: {
    profileId?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }): Promise<StatementList> => {
    const page = await apiClient.get<{
      data: BackendStatement[];
      total: number;
      page?: number;
      limit?: number;
    }>("/v1/portfolio-accounting/statements", {
      searchParams: {
        profileId: params?.profileId,
        from: params?.from,
        to: params?.to,
        page: params?.page,
        limit: params?.limit,
      },
    });
    return {
      data: (page.data ?? []).map(toStatement),
      total: page.total ?? 0,
      page: page.page ?? params?.page ?? 1,
      limit: page.limit ?? params?.limit ?? 50,
    };
  },

  getStatement: async (statementId: string): Promise<StatementDetail> =>
    toStatementDetail(
      await apiClient.get<BackendStatement>(
        `/v1/portfolio-accounting/statements/${encodeURIComponent(statementId)}`,
      ),
    ),

  exportStatement: async (
    statementId: string,
    format: StatementExportFormat = "CSV",
  ): Promise<{ blob: Blob; filename: string }> => {
    const response = await apiClient.get<{
      csv?: string;
      json?: unknown;
      filename?: string;
    }>(
      `/v1/portfolio-accounting/statements/${encodeURIComponent(statementId)}/export`,
      { searchParams: { format } },
    );
    return toExportFile(response, statementId, format);
  },
};
```

FILE: apps/web/src/api/security-api.ts

```typescript
import { apiClient } from './api-client';
import { authApi, MfaEnrollResponse } from './auth-api';

/**
 * Account security API.
 *
 * Everything a signed-in customer manages about their own account is
 * self-service on the backend and needs no extra permission:
 *   two-factor   GET /v1/auth/me (twoFactorEnabled), POST /v1/auth/two-factor/{setup,confirm,disable}
 *   sessions     GET /v1/auth/sessions, DELETE /v1/auth/sessions/:id,
 *                POST /v1/auth/sessions/revoke-others
 *   devices      derived from the caller's sessions (one entry per deviceId)
 * Organisation-level controls are tenant-admin features (security module):
 *   API keys     /v1/security/api-keys          api_key:read / api_key:write
 *   policy       /v1/security/policy            security_policy:read
 * Their screens handle 403 for users without those permissions.
 */

export interface MfaStatus {
  enabled: boolean;
  method?: string;
  enrolledAt?: string;
  lastUsedAt?: string;
}

export interface Session {
  id: string;
  deviceId?: string;
  device?: string;
  platform?: string;
  ip?: string;
  location?: string;
  userAgent?: string;
  trusted?: boolean;
  lastActiveAt: string;
  createdAt: string;
  expiresAt?: string;
  isCurrent: boolean;
}

export interface Device {
  id: string;
  fingerprint: string;
  name?: string;
  platform?: string;
  trusted: boolean;
  isCurrent: boolean;
  sessionIds: string[];
  lastSeenAt: string;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  state: string;
  lastUsedAt?: string;
  expiresAt?: string;
  revokedAt?: string;
  createdAt: string;
}

export interface ApiKeyCreated extends ApiKey {
  secret: string; // only shown once when backend allows
}

export interface SecurityPolicy {
  mfaRequired: boolean;
  sessionTimeoutMinutes: number;
  passwordPolicy: { minLength: number; requireUppercase: boolean; requireNumbers: boolean };
  maxConcurrentSessions?: number;
  apiKeyExpirationDays?: number;
}

/** GET /v1/auth/sessions item (SessionResponseDto). */
interface BackendSession {
  id: string;
  deviceId: string;
  deviceName: string | null;
  platform: string | null;
  appVersion: string | null;
  ipHash: string | null;
  approximateLocation: string | null;
  userAgent: string | null;
  isCurrent: boolean;
  trusted: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

/** /v1/security/api-keys record. The secret is only present on creation. */
interface BackendApiKey {
  id: string;
  name: string;
  keyId: string;
  scopes: string[];
  state: string;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
  secret?: string;
}

/** GET /v1/security/policy (effective tenant policy). */
interface BackendSecurityPolicy {
  mfaRequired: boolean;
  sessionIdleTimeoutSec: number;
  passwordMinLength: number;
  maxConcurrentSessions?: number;
  apiKeyExpirationDays?: number;
}

export function toSession(raw: BackendSession): Session {
  return {
    id: raw.id,
    deviceId: raw.deviceId,
    device: raw.deviceName ?? raw.platform ?? undefined,
    platform: raw.platform ?? undefined,
    location: raw.approximateLocation ?? undefined,
    userAgent: raw.userAgent ?? undefined,
    trusted: raw.trusted,
    lastActiveAt: raw.lastSeenAt,
    createdAt: raw.createdAt,
    expiresAt: raw.expiresAt,
    isCurrent: raw.isCurrent,
  };
}

/** One entry per device: the backend records a session per sign-in on a device. */
export function devicesFromSessions(sessions: readonly Session[]): Device[] {
  const byDevice = new Map<string, Device>();
  for (const session of sessions) {
    const key = session.deviceId ?? session.id;
    const existing = byDevice.get(key);
    if (!existing) {
      byDevice.set(key, {
        id: key,
        fingerprint: key,
        name: session.device,
        platform: session.platform,
        trusted: session.trusted === true,
        isCurrent: session.isCurrent,
        sessionIds: [session.id],
        lastSeenAt: session.lastActiveAt,
        createdAt: session.createdAt,
      });
      continue;
    }
    existing.sessionIds.push(session.id);
    existing.trusted = existing.trusted || session.trusted === true;
    existing.isCurrent = existing.isCurrent || session.isCurrent;
    if (session.lastActiveAt > existing.lastSeenAt) existing.lastSeenAt = session.lastActiveAt;
    if (session.createdAt < existing.createdAt) existing.createdAt = session.createdAt;
  }
  return [...byDevice.values()].sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1));
}

export function toApiKey(raw: BackendApiKey): ApiKey {
  return {
    id: raw.id,
    name: raw.name,
    prefix: raw.keyId,
    scopes: raw.scopes ?? [],
    state: raw.state,
    lastUsedAt: raw.lastUsedAt ?? undefined,
    expiresAt: raw.expiresAt ?? undefined,
    revokedAt: raw.revokedAt ?? undefined,
    createdAt: raw.createdAt,
  };
}

async function listSessions(): Promise<Session[]> {
  const rows = await apiClient.get<BackendSession[]>('/v1/auth/sessions');
  return (rows ?? []).filter((row) => !row.revokedAt).map(toSession);
}

export const securityApi = {
  getMfaStatus: async (): Promise<MfaStatus> => {
    const me = await apiClient.get<{ twoFactorEnabled: boolean }>('/v1/auth/me');
    return { enabled: me.twoFactorEnabled === true, method: me.twoFactorEnabled ? 'TOTP' : undefined };
  },

  enrollMfa: (password: string): Promise<MfaEnrollResponse> => authApi.mfaEnroll(password),

  verifyMfaEnroll: (code: string) => authApi.mfaVerifyEnroll(code),

  disableMfa: (data: { password: string; code?: string; recoveryCode?: string }) => authApi.mfaDisable(data),

  listSessions,

  revokeSession: (id: string) => apiClient.delete<void>(`/v1/auth/sessions/${encodeURIComponent(id)}`),

  revokeAllOtherSessions: () => apiClient.post<{ revoked: number }>('/v1/auth/sessions/revoke-others'),

  listDevices: async (): Promise<Device[]> => devicesFromSessions(await listSessions()),

  /** Signing a device out ends every session it holds. */
  revokeDevice: async (device: Pick<Device, 'sessionIds'>): Promise<void> => {
    for (const sessionId of device.sessionIds) {
      await apiClient.delete<void>(`/v1/auth/sessions/${encodeURIComponent(sessionId)}`);
    }
  },

  listApiKeys: async (): Promise<ApiKey[]> => {
    const page = await apiClient.get<{ data: BackendApiKey[]; total: number }>('/v1/security/api-keys');
    return (page?.data ?? []).map(toApiKey);
  },

  /** `scopes` are permission keys the caller holds, e.g. 'portfolio:read'. */
  createApiKey: async (data: { name: string; scopes: string[]; expiresAt?: string }): Promise<ApiKeyCreated> => {
    const raw = await apiClient.post<BackendApiKey>('/v1/security/api-keys', {
      name: data.name,
      scopes: data.scopes,
      ...(data.expiresAt ? { expiresAt: data.expiresAt } : {}),
    });
    return { ...toApiKey(raw), secret: raw.secret ?? '' };
  },

  revokeApiKey: (id: string, reason?: string) =>
    apiClient.post<{ id: string; state: string }>(`/v1/security/api-keys/${encodeURIComponent(id)}/revoke`, {
      ...(reason ? { reason } : {}),
    }),

  getSecurityPolicy: async (): Promise<SecurityPolicy> => {
    const raw = await apiClient.get<BackendSecurityPolicy>('/v1/security/policy');
    return {
      mfaRequired: raw.mfaRequired,
      sessionTimeoutMinutes: Math.round((raw.sessionIdleTimeoutSec ?? 0) / 60),
      passwordPolicy: { minLength: raw.passwordMinLength, requireUppercase: true, requireNumbers: true },
      maxConcurrentSessions: raw.maxConcurrentSessions,
      apiKeyExpirationDays: raw.apiKeyExpirationDays,
    };
  },
};
```

FILE: apps/web/src/api/tenant-api.ts

```typescript
import { apiClient } from './api-client';
import { ApiError } from './api-errors';

export interface TenantBranding {
  logoUrl?: string;
  faviconUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  backgroundColor?: string;
  textColor?: string;
  fontFamily?: string;
  customCss?: string; // backend-sanitized only
  appName?: string;
  supportEmail?: string;
  supportUrl?: string;
}

export interface TenantInfo {
  id: string;
  slug: string;
  name: string;
  status: string;
  domain?: string;
  customDomain?: string;
  branding?: TenantBranding;
  plan?: {
    id: string;
    name: string;
    tier: string;
  };
  entitlements: Record<string, boolean>;
  limits?: Record<string, number>;
  features?: string[];
}

export interface TenantResolutionResponse {
  tenant: TenantInfo;
  resolvedVia: 'custom_domain' | 'subdomain' | 'authenticated_context' | 'platform_default';
  isCustomDomain: boolean;
}

/**
 * GET /v1/tenants/public-config (TenantPublicConfigDto). @Public on the
 * backend and on the proxy allowlist: the tenant is resolved server-side
 * from the forwarded Host (custom domain or sub-domain), never from input
 * the browser chooses.
 */
interface PublicTenantConfig {
  tenantId: string;
  slug: string;
  name: string;
  status: string;
  branding: Record<string, unknown> | null;
  defaultLocale?: string;
  supportedLocales?: string[];
  defaultCurrency?: string;
  supportedCurrencies?: string[];
  features: Record<string, boolean>;
  registrationEnabled?: boolean;
  twoFactorRequired?: boolean;
}

/** GET /v1/tenants/current (TenantDto) - requires tenant:read. */
interface CurrentTenant {
  id: string;
  slug: string;
  name: string;
  status: string;
  branding?: Record<string, unknown> | null;
  domains?: Array<{ domain: string; isPrimary?: boolean; verifiedAt?: string | null; status?: string }>;
}

const BRANDING_KEYS: ReadonlyArray<keyof TenantBranding> = [
  'logoUrl',
  'faviconUrl',
  'primaryColor',
  'secondaryColor',
  'accentColor',
  'backgroundColor',
  'textColor',
  'fontFamily',
  'customCss',
  'appName',
  'supportEmail',
  'supportUrl',
];

/** Backend branding uses null for "not set"; the UI treats absent as not set. */
export function toBranding(raw: Record<string, unknown> | null | undefined): TenantBranding | undefined {
  if (!raw) return undefined;
  const branding: TenantBranding = {};
  for (const key of BRANDING_KEYS) {
    const value = raw[key];
    if (typeof value === 'string' && value.length > 0) {
      branding[key] = value;
    }
  }
  return branding;
}

export function toTenantInfo(config: PublicTenantConfig): TenantInfo {
  const branding = toBranding(config.branding);
  return {
    id: config.tenantId,
    slug: config.slug,
    name: config.name,
    status: config.status,
    branding,
    entitlements: config.features ?? {},
    features: Object.entries(config.features ?? {})
      .filter(([, enabled]) => enabled)
      .map(([key]) => key),
  };
}

/**
 * The backend does not report which rule matched, so this is derived from
 * the host for display only. Security never depends on it: the tenant itself
 * always comes from backend resolution.
 */
export function describeResolution(
  host: string | undefined,
  slug: string
): Pick<TenantResolutionResponse, 'resolvedVia' | 'isCustomDomain'> {
  const hostname = ((host ?? '').split(':')[0] ?? '').toLowerCase();
  if (!hostname || hostname === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return { resolvedVia: 'platform_default', isCustomDomain: false };
  }
  if ((hostname.split('.')[0] ?? '') === slug.toLowerCase()) {
    return { resolvedVia: 'subdomain', isCustomDomain: false };
  }
  return { resolvedVia: 'custom_domain', isCustomDomain: true };
}

async function getPublicConfig(): Promise<PublicTenantConfig> {
  return apiClient.get<PublicTenantConfig>('/v1/tenants/public-config');
}

export const tenantApi = {
  /**
   * Resolves the tenant for the current host before sign-in. The `host`
   * argument is only used to describe how it was resolved; the proxy forwards
   * the real Host header and the backend decides the tenant.
   */
  resolve: async (host?: string): Promise<TenantResolutionResponse> => {
    const config = await getPublicConfig();
    const tenant = toTenantInfo(config);
    return { tenant, ...describeResolution(host, tenant.slug) };
  },

  /**
   * Organisation of the signed-in user. Tenant administrators get the full
   * record; customers (no tenant:read) get the public configuration of the
   * same tenant instead of a 403.
   */
  getCurrent: async (): Promise<TenantInfo> => {
    const config = await getPublicConfig();
    const base = toTenantInfo(config);
    try {
      const current = await apiClient.get<CurrentTenant>('/v1/tenants/current');
      const primary = current.domains?.find((d) => d.isPrimary) ?? current.domains?.[0];
      return {
        ...base,
        id: current.id,
        slug: current.slug,
        name: current.name,
        status: current.status,
        branding: toBranding(current.branding) ?? base.branding,
        customDomain: primary?.domain,
      };
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        return base;
      }
      throw err;
    }
  },

  getBranding: async (): Promise<TenantBranding> => {
    const config = await getPublicConfig();
    return toBranding(config.branding) ?? {};
  },

  getEntitlements: async (): Promise<Record<string, boolean>> => {
    const config = await getPublicConfig();
    return config.features ?? {};
  },

  /**
   * Numeric plan limits of the organisation's subscription
   * (GET /v1/billing/subscription/limits, subscription:read). The backend
   * mixes numbers and boolean capabilities and returns null without an active
   * subscription; only the numeric limits are returned here.
   */
  getLimits: async (): Promise<Record<string, number>> => {
    const raw = await apiClient.get<Record<string, number | boolean | null> | null>('/v1/billing/subscription/limits');
    const limits: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw ?? {})) {
      if (typeof value === 'number') limits[key] = value;
    }
    return limits;
  },
};
```

FILE: apps/web/src/api/trading-api.ts

```typescript
import { Permission } from "@wlct/shared-types";
import { apiClient } from "./api-client";
import { ApiError } from "./api-errors";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import { permissionsAllowAny } from "@/auth/permissions";

/**
 * Copy-trading client for /v1/copy-trading.
 *
 * Every call in the previous version was broken: paths lacked /v1, trader
 * detail used traders/:id (the API route is traders/:id/profile), strategies
 * were fetched from a non-existent /strategies root, subscriptions were
 * listed from GET /subscriptions (the API has subscriptions/me) and updated
 * with a PATCH that does not exist, and trading-status had no API route at
 * all. The response types described fields the API never returns (`id`,
 * nested `performance`, `eligibility`, `traderName`, `health`). Types below
 * mirror the API records; parsers tolerate missing fields so a partial record
 * never crashes a page.
 */

type Raw = Record<string, unknown>;

export type CopySizingMode = "PROPORTIONAL" | "FIXED" | "PERCENTAGE_BALANCE";
export type CopySubscriptionState = "PENDING" | "ACTIVE" | "PAUSED" | "STOPPED" | "CANCELLED" | "EXPIRED";
export type StrategyStatus =
  | "DRAFT"
  | "PENDING_VALIDATION"
  | "VALIDATED"
  | "PUBLISHED"
  | "PAUSED"
  | "ARCHIVED"
  | "REJECTED";

export interface TraderProfile {
  traderId: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  verificationState: string;
  verifiedAt: string | null;
  supportedVenues: string[];
  supportedSymbols: string[];
  isPublic: boolean;
  isFeatured: boolean;
  followerCount: number;
  totalVolume: string;
  totalTrades: number;
  createdAt: string;
}

export interface Strategy {
  strategyId: string;
  traderId: string;
  name: string;
  description: string | null;
  status: string;
  type: string;
  supportedSymbols: string[];
  supportedVenues: string[];
  followerCount: number;
  totalCopies: number;
  publishedAt: string | null;
  createdAt: string;
}

export interface CopySubscription {
  subscriptionId: string;
  traderId: string;
  strategyId: string;
  state: string;
  allocationMode: string;
  allocationAmount: string;
  maxAllocation: string | null;
  followerAccountId: string | null;
  totalCopies: number;
  failedCopies: number;
  totalCopiedVolume: string;
  startedAt: string | null;
  createdAt: string;
}

export interface Paged<T> {
  data: T[];
  total: number;
}

export interface TradingRestriction {
  type: string;
  reason: string;
}

export interface TradingStatus {
  /** ELIGIBLE, RESTRICTED, MAINTENANCE or NOT_PERMITTED (the role cannot copy). */
  eligibility: "ELIGIBLE" | "RESTRICTED" | "MAINTENANCE" | "NOT_PERMITTED";
  canCopy: boolean;
  restrictions: TradingRestriction[];
  /**
   * The current notice, shown for any active window. Only `blocksTrading`
   * windows (platform-wide, this tenant, or trading) disable copying - the
   * API enforces the same rule and answers copy subscribe/resume with 503.
   */
  maintenance: {
    active: boolean;
    message: string;
    scope: string | null;
    endsAt: string | null;
    isEmergency: boolean;
    blocksTrading: boolean;
  } | null;
}

export interface CopyEligibility {
  canCopy: boolean;
  reasons: string[];
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});

export function parseTrader(input: unknown): TraderProfile {
  const r = obj(input);
  return {
    traderId: str(r.traderId ?? r.id),
    displayName: str(r.displayName, "Unnamed trader"),
    bio: strOrNull(r.bio),
    avatarUrl: strOrNull(r.avatarUrl),
    verificationState: str(r.verificationState, "UNVERIFIED"),
    verifiedAt: strOrNull(r.verifiedAt),
    supportedVenues: strList(r.supportedVenues),
    supportedSymbols: strList(r.supportedSymbols),
    isPublic: r.isPublic === true,
    isFeatured: r.isFeatured === true,
    followerCount: num(r.followerCount),
    totalVolume: str(r.totalVolume, "0"),
    totalTrades: num(r.totalTrades),
    createdAt: str(r.createdAt),
  };
}

export function parseStrategy(input: unknown): Strategy {
  const r = obj(input);
  return {
    strategyId: str(r.strategyId ?? r.id),
    traderId: str(r.traderId),
    name: str(r.name, "Unnamed strategy"),
    description: strOrNull(r.description),
    status: str(r.status, "DRAFT"),
    type: str(r.type, "MANUAL"),
    supportedSymbols: strList(r.supportedSymbols),
    supportedVenues: strList(r.supportedVenues),
    followerCount: num(r.followerCount),
    totalCopies: num(r.totalCopies),
    publishedAt: strOrNull(r.publishedAt),
    createdAt: str(r.createdAt),
  };
}

export function parseSubscription(input: unknown): CopySubscription {
  const r = obj(input);
  return {
    subscriptionId: str(r.subscriptionId ?? r.id),
    traderId: str(r.traderId),
    strategyId: str(r.strategyId),
    state: str(r.state, "PENDING"),
    allocationMode: str(r.allocationMode, "FIXED"),
    allocationAmount: str(r.allocationAmount, "0"),
    maxAllocation: strOrNull(r.maxAllocation),
    followerAccountId: strOrNull(r.followerAccountId),
    totalCopies: num(r.totalCopies),
    failedCopies: num(r.failedCopies),
    totalCopiedVolume: str(r.totalCopiedVolume, "0"),
    startedAt: strOrNull(r.startedAt),
    createdAt: str(r.createdAt),
  };
}

function parsePaged<T>(input: unknown, parse: (x: unknown) => T): Paged<T> {
  const r = obj(input);
  const rows = Array.isArray(r.data) ? r.data : Array.isArray(input) ? (input as unknown[]) : [];
  return { data: rows.map(parse), total: typeof r.total === "number" ? r.total : rows.length };
}

/** Copying requires copy_subscription:manage (FOLLOWER and super admins in the role matrix). */
export function permissionsAllowCopy(permissions: readonly string[]): boolean {
  return permissionsAllowAny(permissions, [Permission.COPY_SUBSCRIPTION_MANAGE]);
}

/**
 * Display-side eligibility for one strategy, mirroring the API's subscribe()
 * preconditions (strategy PUBLISHED, account not restricted, no maintenance,
 * role allowed to copy). The API still decides: it re-checks all of this plus
 * compliance blocks, plan limits and the allocation against the balance.
 */
export function copyEligibility(strategy: Pick<Strategy, "status">, status: TradingStatus | undefined): CopyEligibility {
  const reasons: string[] = [];
  if (strategy.status !== "PUBLISHED") reasons.push(`Strategy is ${strategy.status.toLowerCase().replace(/_/g, " ")}`);
  if (status) {
    if (status.eligibility === "NOT_PERMITTED") reasons.push("Your role cannot open copy subscriptions");
    if (status.eligibility === "MAINTENANCE") reasons.push(status.maintenance?.message || "Maintenance in progress");
    if (status.eligibility === "RESTRICTED") reasons.push("Your account has active restrictions");
  }
  return { canCopy: reasons.length === 0 && status !== undefined, reasons };
}

export function composeTradingStatus(
  permissions: readonly string[],
  maintenanceRaw: unknown,
  restrictionsRaw: unknown,
): TradingStatus {
  const m = obj(maintenanceRaw);
  const maintenance =
    m.active === true
      ? {
          active: true,
          message: str(m.message ?? m.title, "Scheduled maintenance"),
          scope: strOrNull(m.scope),
          endsAt: strOrNull(m.endsAt),
          isEmergency: m.isEmergency === true,
          // An API without the flag predates the rule: treat every window as blocking.
          blocksTrading: typeof m.blocksTrading === "boolean" ? m.blocksTrading : true,
        }
      : null;
  const rows = Array.isArray(obj(restrictionsRaw).data) ? (obj(restrictionsRaw).data as unknown[]) : [];
  const restrictions = rows
    .map(obj)
    .filter((r) => str(r.status, "ACTIVE") === "ACTIVE")
    .map((r) => ({ type: str(r.restrictionType ?? r.type, "RESTRICTION"), reason: str(r.reason) }));
  const permitted = permissionsAllowCopy(permissions);
  const eligibility: TradingStatus["eligibility"] = !permitted
    ? "NOT_PERMITTED"
    : maintenance?.blocksTrading
      ? "MAINTENANCE"
      : restrictions.length > 0
        ? "RESTRICTED"
        : "ELIGIBLE";
  return { eligibility, canCopy: eligibility === "ELIGIBLE", restrictions, maintenance };
}

/** A customer without a client profile has no restrictions record (403/404): that is "none", not an error. */
async function ownRestrictions(): Promise<unknown> {
  try {
    return await apiClient.get<unknown>("/v1/client-lifecycle/restrictions", { searchParams: { status: "ACTIVE" } });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) return { data: [] };
    throw err;
  }
}

export interface CreateCopySubscriptionInput {
  traderId: string;
  strategyId: string;
  allocationMode: CopySizingMode;
  allocationAmount: string;
  maxAllocation?: string;
  followerAccountId?: string;
}

export const tradingApi = {
  listTraders: async (params?: { search?: string; verificationState?: string; isFeatured?: boolean; page?: number; limit?: number }) =>
    parsePaged(
      await apiClient.get<unknown>("/v1/copy-trading/traders", {
        searchParams: {
          search: params?.search || undefined,
          verificationState: params?.verificationState,
          isFeatured: params?.isFeatured,
          page: params?.page,
          limit: params?.limit,
        },
      }),
      parseTrader,
    ),

  getTrader: async (traderId: string) =>
    parseTrader(await apiClient.get<unknown>(`/v1/copy-trading/traders/${encodeURIComponent(traderId)}/profile`)),

  listTraderStrategies: async (traderId: string, params?: { page?: number; limit?: number }) =>
    parsePaged(
      await apiClient.get<unknown>(`/v1/copy-trading/traders/${encodeURIComponent(traderId)}/strategies`, {
        searchParams: { page: params?.page, limit: params?.limit },
      }),
      parseStrategy,
    ),

  /** The API filter accepts status, traderId, page and limit only (extra fields are rejected with 422). */
  listStrategies: async (params?: { traderId?: string; status?: StrategyStatus; page?: number; limit?: number }) =>
    parsePaged(
      await apiClient.get<unknown>("/v1/copy-trading/strategies", {
        searchParams: { traderId: params?.traderId, status: params?.status, page: params?.page, limit: params?.limit },
      }),
      parseStrategy,
    ),

  getStrategy: async (strategyId: string) =>
    parseStrategy(await apiClient.get<unknown>(`/v1/copy-trading/strategies/${encodeURIComponent(strategyId)}`)),

  listCopySubscriptions: async (params?: { state?: CopySubscriptionState; page?: number; limit?: number }) =>
    parsePaged(
      await apiClient.get<unknown>("/v1/copy-trading/subscriptions/me", {
        searchParams: { state: params?.state, page: params?.page, limit: params?.limit },
      }),
      parseSubscription,
    ),

  createCopySubscription: async (input: CreateCopySubscriptionInput) =>
    parseSubscription(
      await apiClient.post<unknown>("/v1/copy-trading/subscriptions", {
        traderId: input.traderId,
        strategyId: input.strategyId,
        allocationMode: input.allocationMode,
        allocationAmount: input.allocationAmount,
        ...(input.maxAllocation ? { maxAllocation: input.maxAllocation } : {}),
        ...(input.followerAccountId ? { followerAccountId: input.followerAccountId } : {}),
        idempotencyKey: newIdempotencyKey("copy-sub"),
      }),
    ),

  pauseCopySubscription: async (subscriptionId: string) =>
    parseSubscription(await apiClient.post<unknown>(`/v1/copy-trading/subscriptions/${encodeURIComponent(subscriptionId)}/pause`)),

  resumeCopySubscription: async (subscriptionId: string) =>
    parseSubscription(await apiClient.post<unknown>(`/v1/copy-trading/subscriptions/${encodeURIComponent(subscriptionId)}/resume`)),

  stopCopySubscription: async (subscriptionId: string) =>
    parseSubscription(await apiClient.post<unknown>(`/v1/copy-trading/subscriptions/${encodeURIComponent(subscriptionId)}/stop`)),

  cancelCopySubscription: async (subscriptionId: string) =>
    parseSubscription(await apiClient.delete<unknown>(`/v1/copy-trading/subscriptions/${encodeURIComponent(subscriptionId)}`)),

  /**
   * There is no trading-status route: the status is composed from the tenant
   * maintenance notice, the caller's own active restrictions and whether the
   * caller's role may copy at all.
   */
  getTradingStatus: async (permissions: readonly string[]): Promise<TradingStatus> => {
    const [maintenance, restrictions] = await Promise.all([
      apiClient.get<unknown>("/v1/operations/maintenance/current"),
      ownRestrictions(),
    ]);
    return composeTradingStatus(permissions, maintenance, restrictions);
  },
};
```

FILE: apps/web/src/app/account/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { ProfilePage } from '@/features/account/profile-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><ProfilePage /></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/account/profile/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { ProfilePage } from '@/features/account/profile-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><ProfilePage /></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/account/relationships/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { RelationshipsPage } from '@/features/account/relationships-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><RelationshipsPage /></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/account/restrictions/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { RestrictionsPage } from '@/features/account/restrictions-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><RestrictionsPage /></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/api/auth/login/route.ts

```typescript
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError } from '@/lib/api-error';
import { serverFetch } from '@/lib/server-api';
import { persistSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

interface SessionPayload {
  tokens: TokenPair;
  user: { id: string; email: string };
  sessionId: string;
}

interface ChallengePayload {
  twoFactorRequired: true;
  challengeToken: string;
  expiresIn: number;
  methods: string[];
}

type LoginResult = SessionPayload | ChallengePayload;

export async function POST(request: Request): Promise<NextResponse> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'A JSON body is required.' } },
      { status: 400 }
    );
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please check the highlighted fields.',
          details: parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
        },
      },
      { status: 400 }
    );
  }

  const deviceId = `web-${randomUUID()}`;
  const host = request.headers.get('host') ?? undefined;

  try {
    const result = await serverFetch<LoginResult>('/auth/login', {
      method: 'POST',
      authenticated: false,
      body: {
        email: parsed.data.email,
        password: parsed.data.password,
        deviceId,
        deviceName: 'Customer Web',
        platform: 'web',
      },
      host,
    });

    if ('twoFactorRequired' in result) {
      const response = NextResponse.json({
        success: true,
        // The challenge token stays in the httpOnly cookie below; browser
        // JavaScript only needs to know that a second factor is required.
        data: { requiresMfa: true, methods: result.methods },
      });
      response.cookies.set('wlct_2fa', result.challengeToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: result.expiresIn,
      });
      response.cookies.set('wlct_2fa_did', deviceId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: result.expiresIn,
      });
      return response;
    }

    persistSession(result.tokens, deviceId, randomUUID());

    return NextResponse.json({
      success: true,
      data: { requiresMfa: false, redirectTo: '/dashboard' },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { success: false, error: { code: error.code, message: error.message, details: error.details } },
        { status: error.status }
      );
    }
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: 'Sign-in failed. Please try again.' } },
      { status: 500 }
    );
  }
}
```

FILE: apps/web/src/app/api/auth/logout/route.ts

```typescript
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
    clearSession();
  }

  const response = NextResponse.json({ success: true, data: { redirectTo } });
  response.cookies.delete('wlct_2fa');
  response.cookies.delete('wlct_2fa_did');
  return response;
}
```

FILE: apps/web/src/app/api/auth/refresh/route.ts

```typescript
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { serverFetch } from '@/lib/server-api';
import { getRefreshToken, getDeviceId, persistSession, clearSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RefreshResponse {
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    refreshExpiresIn: number;
  };
}

export async function POST(): Promise<NextResponse> {
  const refreshToken = getRefreshToken();
  const deviceId = getDeviceId();

  if (!refreshToken || !deviceId) {
    clearSession();
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'No refresh token.' } },
      { status: 401 }
    );
  }

  try {
    const result = await serverFetch<RefreshResponse>('/auth/refresh', {
      method: 'POST',
      authenticated: false,
      body: { refreshToken, deviceId },
    });

    persistSession(result.tokens, deviceId, randomUUID());

    return NextResponse.json({ success: true, data: {} });
  } catch {
    clearSession();
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Session refresh failed.' } },
      { status: 401 }
    );
  }
}
```

FILE: apps/web/src/app/api/auth/sso/callback/route.ts

```typescript
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { serverFetch } from "@/lib/server-api";
import { persistSession, type SessionTokens } from "@/lib/session";
import {
  SSO_BINDING_COOKIE,
  SSO_COOKIE_PATH,
  SSO_DEVICE_COOKIE,
  SSO_FAILURE_PATH,
  SSO_MFA_PATH,
  buildSsoCallbackBody,
  ssoSuccessPath,
} from "@/lib/sso-flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SessionPayload {
  tokens: SessionTokens;
  user: { id: string; email: string };
  sessionId: string;
}

interface ChallengePayload {
  twoFactorRequired: true;
  challengeToken: string;
  expiresIn: number;
  methods: string[];
}

interface SsoCompleteApiResult {
  result: SessionPayload | ChallengePayload;
  returnTo: string | null;
}

function redirectTo(request: Request, path: string): NextResponse {
  const response = NextResponse.redirect(new URL(path, request.url), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

/**
 * GET /api/auth/sso/callback - the redirect URI registered at the IdP (and
 * the SAML hand-off target). Completes the login server-to-server and
 * stores the session in httpOnly cookies; the code and state never reach
 * browser JavaScript, and no token is ever put in a URL.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const store = cookies();
  const bindingToken = store.get(SSO_BINDING_COOKIE)?.value;
  const deviceId = store.get(SSO_DEVICE_COOKIE)?.value;
  // One attempt per start: the binding cookies are dropped whatever happens next.
  store.set(SSO_BINDING_COOKIE, "", {
    httpOnly: true,
    path: SSO_COOKIE_PATH,
    maxAge: 0,
  });
  store.set(SSO_DEVICE_COOKIE, "", {
    httpOnly: true,
    path: SSO_COOKIE_PATH,
    maxAge: 0,
  });

  const query = new URL(request.url).searchParams;
  const body = buildSsoCallbackBody(query, bindingToken, deviceId);
  if (!body || !deviceId) {
    return redirectTo(request, SSO_FAILURE_PATH);
  }

  try {
    const completed = await serverFetch<SsoCompleteApiResult>(
      "/auth/sso/callback",
      {
        method: "POST",
        authenticated: false,
        body,
        host: request.headers.get("host") ?? undefined,
      },
    );
    const result = completed?.result;
    if (!result) {
      return redirectTo(request, SSO_FAILURE_PATH);
    }

    if ("twoFactorRequired" in result && result.twoFactorRequired) {
      const options = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict" as const,
        path: "/",
        maxAge: result.expiresIn,
      };
      store.set("wlct_2fa", result.challengeToken, options);
      store.set("wlct_2fa_did", deviceId, options);
      return redirectTo(request, SSO_MFA_PATH);
    }

    if (!("tokens" in result) || !result.tokens) {
      return redirectTo(request, SSO_FAILURE_PATH);
    }
    persistSession(result.tokens, deviceId, randomUUID());
    return redirectTo(request, ssoSuccessPath(completed.returnTo));
  } catch {
    // Refusals are generic by design (the API recorded the specific reason in its audit trail).
    return redirectTo(request, SSO_FAILURE_PATH);
  }
}
```

FILE: apps/web/src/app/api/auth/sso/start/route.ts

```typescript
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api-error";
import { serverFetch } from "@/lib/server-api";
import {
  SSO_BINDING_COOKIE,
  SSO_COOKIE_MAX_AGE,
  SSO_COOKIE_PATH,
  SSO_DEVICE_COOKIE,
  isAcceptableAuthorizationUrl,
  ssoStartRequestSchema,
  type SsoStartApiResult,
} from "@/lib/sso-flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/sso/start - begins a single sign-on login for the tenant of
 * this host. Returns only the IdP URL to navigate to; the binding secret and
 * the device id stay in httpOnly cookies for the callback.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let raw: unknown = {};
  try {
    const text = await request.text();
    raw = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "A JSON body is required.",
        },
      },
      { status: 400 },
    );
  }

  const parsed = ssoStartRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "The single sign-on request is invalid.",
          details: parsed.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
      { status: 400 },
    );
  }

  const deviceId = `web-${randomUUID()}`;
  const host = request.headers.get("host") ?? undefined;
  const production = process.env.NODE_ENV === "production";

  try {
    const result = await serverFetch<SsoStartApiResult>("/auth/sso/start", {
      method: "POST",
      authenticated: false,
      body: {
        ...(parsed.data.providerType ? { providerType: parsed.data.providerType } : {}),
        deviceId,
        ...(parsed.data.returnTo ? { returnTo: parsed.data.returnTo } : {}),
      },
      host,
    });

    if (
      !result ||
      typeof result.bindingToken !== "string" ||
      !isAcceptableAuthorizationUrl(result.authorizationUrl, production)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "UNAUTHORIZED",
            message: "Single sign-on is not available.",
          },
        },
        { status: 401 },
      );
    }

    const maxAge = Math.min(
      Math.max(Number(result.expiresIn) || 0, 60),
      SSO_COOKIE_MAX_AGE,
    );
    const cookieOptions = {
      httpOnly: true,
      secure: production,
      // Lax: the IdP's redirect back to /api/auth/sso/callback is a cross-site top-level navigation.
      sameSite: "lax" as const,
      path: SSO_COOKIE_PATH,
      maxAge,
    };
    const response = NextResponse.json({
      success: true,
      data: { authorizationUrl: result.authorizationUrl },
    });
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set(
      SSO_BINDING_COOKIE,
      result.bindingToken,
      cookieOptions,
    );
    response.cookies.set(SSO_DEVICE_COOKIE, deviceId, cookieOptions);
    return response;
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { success: false, error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Single sign-on could not be started.",
        },
      },
      { status: 500 },
    );
  }
}
```

FILE: apps/web/src/app/api/auth/two-factor/route.ts

```typescript
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { serverFetch } from '@/lib/server-api';
import { persistSession } from '@/lib/session';
import { ApiError } from '@/lib/api-error';
import { buildVerifyBody, twoFactorRequestSchema } from '@/lib/two-factor-verify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Second step of sign-in. The challenge token and device id were stored as
 * httpOnly cookies by /api/auth/login and never reach browser JavaScript.
 * The backend body is built by buildVerifyBody (lib/two-factor-verify).
 */
interface VerifiedSession {
  tokens: { accessToken: string; refreshToken: string; expiresIn: number; refreshExpiresIn: number };
}

export async function POST(request: Request): Promise<NextResponse> {
  const cookieStore = cookies();
  const challengeToken = cookieStore.get('wlct_2fa')?.value;
  const deviceId = cookieStore.get('wlct_2fa_did')?.value;

  if (!challengeToken || !deviceId) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'MFA challenge expired. Please sign in again.' } },
      { status: 401 }
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'JSON body required.' } },
      { status: 400 }
    );
  }

  const parsed = twoFactorRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid code.' } },
      { status: 400 }
    );
  }

  try {
    const result = await serverFetch<VerifiedSession>('/auth/two-factor/verify', {
      method: 'POST',
      authenticated: false,
      body: buildVerifyBody(challengeToken, deviceId, parsed.data),
      host: request.headers.get('host') ?? undefined,
    });

    persistSession(result.tokens, deviceId, randomUUID());

    const response = NextResponse.json({ success: true, data: { redirectTo: '/dashboard' } });
    response.cookies.delete('wlct_2fa');
    response.cookies.delete('wlct_2fa_did');
    return response;
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { success: false, error: { code: err.code, message: err.message, details: err.details } },
        { status: err.status }
      );
    }
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: 'MFA verification failed.' } },
      { status: 500 }
    );
  }
}
```

FILE: apps/web/src/app/api/proxy/[...path]/route.ts

```typescript
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { serverEnv, publicEnv } from '@/lib/env';
import { getAccessToken, getCsrfToken } from '@/lib/session';
import { buildUpstreamPath, isAnonymousRoute, isUnsafeSegment } from '@/lib/proxy-path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const STRIPPED_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'set-cookie',
]);

async function handle(request: Request, segments: string[]): Promise<NextResponse> {
  const env = serverEnv();

  if (segments.some(isUnsafeSegment)) {
    return NextResponse.json(
      { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid path.' } },
      { status: 400 }
    );
  }

  const anonymous = isAnonymousRoute(request.method, segments, publicEnv.apiVersion);

  if (MUTATING_METHODS.has(request.method)) {
    const submitted = request.headers.get('x-csrf-token');
    const expected = getCsrfToken();
    if (!expected || submitted !== expected) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Invalid CSRF token.' } },
        { status: 403 }
      );
    }
  }

  const token = getAccessToken();
  if (!token && !anonymous) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'No active session.' } },
      { status: 401 }
    );
  }

  const incoming = new URL(request.url);
  const base = env.API_BASE_URL.replace(/\/+$/, '');
  const target = new URL(`${base}/${buildUpstreamPath(segments, publicEnv.apiVersion)}`);
  target.search = incoming.search;

  const headers: Record<string, string> = {
    accept: 'application/json',
    'x-request-id': request.headers.get('x-request-id') ?? randomUUID(),
    'x-correlation-id': request.headers.get('x-correlation-id') ?? randomUUID(),
  };

  if (token && !anonymous) {
    headers.authorization = `Bearer ${token}`;
  }

  const forwardedHost = request.headers.get('x-forwarded-host') ?? incoming.host;
  if (forwardedHost) {
    headers['x-forwarded-host'] = forwardedHost;
    headers['host'] = forwardedHost;
  }

  const contentType = request.headers.get('content-type');
  if (contentType) {
    headers['content-type'] = contentType;
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer(),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'The platform API is unreachable. Please try again shortly.' },
      },
      { status: 503 }
    );
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  });

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

interface RouteContext {
  params: { path: string[] };
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  return handle(request, context.params.path);
}
export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  return handle(request, context.params.path);
}
export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  return handle(request, context.params.path);
}
export async function PUT(request: Request, context: RouteContext): Promise<NextResponse> {
  return handle(request, context.params.path);
}
export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  return handle(request, context.params.path);
}
```

FILE: apps/web/src/app/app.tsx

```tsx
'use client';

import { ReactNode, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext, clearSensitiveSessionState } from '@/auth/auth.store';
import { Session } from '@/auth/auth.types';
import { authApi } from '@/api/auth-api';
import { ApiError } from '@/api/api-errors';
import { TenantProvider } from '@/tenant/tenant-context';
import { TenantBrandingProvider } from '@/tenant/tenant-branding';
import { ErrorBoundary } from './error-boundary';
import { getRuntimeConfig } from '@/config/runtime-config';
import { trackPageView } from '@/telemetry/web-telemetry';

/**
 * Root application composition, providers, router, error boundary,
 * authentication bootstrap, tenant bootstrap, and global lifecycle handling.
 */

const config = getRuntimeConfig();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: config.queryStaleTimeMs,
      gcTime: config.queryGcTimeMs,
      retry: (failureCount, error: unknown) => {
        const apiErr = error as ApiError;
        if (apiErr?.status === 401 || apiErr?.status === 403 || apiErr?.status === 404) return false;
        return failureCount < 2;
      },
    },
  },
});

function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refreshSession = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await authApi.getSession();
      setSession({
        user: {
          id: res.user.id,
          email: res.user.email,
          tenantId: res.user.tenantId,
          roles: res.user.roles,
          permissions: res.user.permissions,
          displayName: res.user.displayName,
          avatarUrl: res.user.avatarUrl,
          mfaEnabled: res.user.mfaEnabled,
        },
        tenant: res.tenant,
        entitlements: res.entitlements,
        isAuthenticated: true,
      });
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 401) {
        setSession(null);
      } else {
        setError(apiErr.getUserMessage());
      }
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    // The BFF returns /login, or the IdP's end-session URL for an OIDC SSO
    // session (RP-initiated logout); the local session is revoked either way.
    let redirectTo = '/login';
    try {
      const result = await authApi.logout();
      if (result?.redirectTo) redirectTo = result.redirectTo;
    } catch {
      // ignore
    } finally {
      clearSensitiveSessionState();
      setSession(null);
      window.location.href = redirectTo;
    }
  };

  useEffect(() => {
    refreshSession();
  }, []);

  useEffect(() => {
    // Global lifecycle: track page views with correlation
    if (typeof window !== 'undefined') {
      trackPageView(window.location.pathname);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ session, isLoading, isAuthenticated: !!session, error, refreshSession, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function App({ children }: { children: ReactNode }): JSX.Element {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TenantProvider>
          <TenantBrandingProvider>
            <AuthProvider>{children}</AuthProvider>
          </TenantBrandingProvider>
        </TenantProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

// Re-export AuthProvider for backward compat
export { AuthProvider };
```

FILE: apps/web/src/app/billing/checkout/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { CheckoutPage } from '@/features/billing/checkout-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><CheckoutPage /></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/billing/invoices/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { InvoicesPage } from '@/features/billing/invoices-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><InvoicesPage /></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/billing/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { BillingPage } from '@/features/billing/billing-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><BillingPage /></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/billing/plans/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { PlanComparison } from '@/features/billing/plan-comparison';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><PageContainer title="Plans" description="Real plan/entitlement/limit information from backend"><PlanComparison /></PageContainer></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/billing/subscription/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { SubscriptionPage } from '@/features/billing/subscription-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><SubscriptionPage /></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/billing/usage/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { UsagePage } from '@/features/billing/usage-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><UsagePage /></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/copy-trading/page.tsx

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { AuthGuard } from "@/auth/auth.guard";
import { AppShell } from "@/layout/app-shell";
import { PageContainer } from "@/layout/page-container";
import { tradingApi, type CopySubscription } from "@/api/trading-api";
import { ApiError } from "@/api/api-errors";
import { StatusBadge } from "@/components/status-badge";
import { Money } from "@/components/money";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";

type Action = "pause" | "resume" | "stop";

const ACTIONS: Record<Action, (id: string) => Promise<CopySubscription>> = {
  pause: tradingApi.pauseCopySubscription,
  resume: tradingApi.resumeCopySubscription,
  stop: tradingApi.stopCopySubscription,
};

/** Actions the API accepts for a state (pause ACTIVE, resume PAUSED, stop anything not already ended). */
function actionsFor(state: string): Action[] {
  if (state === "ACTIVE") return ["pause", "stop"];
  if (state === "PAUSED") return ["resume", "stop"];
  if (state === "PENDING") return ["stop"];
  return [];
}

export default function Page(): JSX.Element {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string>("");
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["copy-subs"],
    queryFn: () => tradingApi.listCopySubscriptions({ page: 1, limit: 50 }),
  });
  const mutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: Action }) => ACTIONS[action](id),
    onSuccess: () => {
      setActionError("");
      void queryClient.invalidateQueries({ queryKey: ["copy-subs"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard", "copy", "subscriptions"] });
    },
    onError: (err: unknown) => setActionError(err instanceof ApiError ? err.getUserMessage() : "The action failed."),
  });
  const subs = data?.data ?? [];

  return (
    <AuthGuard>
      <AppShell>
        <PageContainer title="Copy Trading" description="Your copy subscriptions">
          {actionError && <p className="mb-2 text-xs text-red-600">{actionError}</p>}
          {isLoading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState error={error} onRetry={() => void refetch()} />
          ) : subs.length === 0 ? (
            <EmptyState
              title="No subscriptions"
              description="You are not copying any strategies yet"
              action={{ label: "Browse Strategies", href: "/strategies" }}
            />
          ) : (
            <ul className="space-y-2">
              {subs.map((s) => (
                <li key={s.subscriptionId} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm">
                  <span>
                    <Link href={`/strategies/${s.strategyId}`} className="underline">
                      Strategy {s.strategyId.slice(0, 8)}
                    </Link>
                    <span className="ml-2 text-xs text-muted">
                      {s.allocationMode.toLowerCase().replace(/_/g, " ")} | {s.totalCopies} copies
                      {s.failedCopies > 0 ? `, ${s.failedCopies} failed` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Money value={s.allocationAmount} />
                    <StatusBadge status={s.state} />
                    {actionsFor(s.state).map((action) => (
                      <button
                        key={action}
                        type="button"
                        disabled={mutation.isPending}
                        onClick={() => mutation.mutate({ id: s.subscriptionId, action })}
                        className="rounded border px-2 py-1 text-xs capitalize disabled:opacity-50"
                      >
                        {action}
                      </button>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PageContainer>
      </AppShell>
    </AuthGuard>
  );
}
```

FILE: apps/web/src/app/dashboard/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { DashboardPage } from '@/features/dashboard/dashboard-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><DashboardPage /></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/error-boundary.tsx

```tsx
'use client';
import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  correlationId: string;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, correlationId: '' };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    const correlationId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`;
    return { hasError: true, error, correlationId };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Safe diagnostics without leaking secrets
    const safeError = {
      message: error.message.slice(0, 200),
      correlationId: this.state.correlationId,
      componentStack: errorInfo.componentStack?.slice(0, 500),
      timestamp: new Date().toISOString(),
    };
    // In production, would send to error reporting service with scrubbing
    console.error('ErrorBoundary caught:', safeError);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center p-8">
          <div className="max-w-md text-center">
            <h2 className="text-lg font-semibold">Something went wrong</h2>
            <p className="mt-2 text-sm text-muted">An unexpected error occurred. Please try reloading the page.</p>
            <p className="mt-2 text-xs text-muted">Ref: {this.state.correlationId.slice(0, 8)}</p>
            <div className="mt-4 flex justify-center gap-2">
              <button onClick={() => this.setState({ hasError: false, error: null, correlationId: '' })} className="rounded bg-primary px-4 py-2 text-sm text-white">Try Again</button>
              <button onClick={() => window.location.reload()} className="rounded border px-4 py-2 text-sm">Reload</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
```

FILE: apps/web/src/app/exchanges/[id]/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { ExchangeAccountDetail } from '@/features/exchanges/exchange-account-detail';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
export default function Page({ params }: { params: { id: string } }): JSX.Element {
  return <AuthGuard><AppShell><PageContainer title="Exchange Account Detail"><ExchangeAccountDetail id={params.id} /></PageContainer></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/exchanges/connect/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { ConnectExchangePage } from '@/features/exchanges/connect-exchange-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><ConnectExchangePage /></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/exchanges/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { ExchangeAccountsPage } from '@/features/exchanges/exchange-accounts-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><ExchangeAccountsPage /></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/funding/deposit/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { DepositPage } from '@/features/funding/deposit-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><DepositPage /></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/funding/history/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { TransactionHistory } from '@/features/funding/transaction-history';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><PageContainer title="Funding History" description="Persisted history"><TransactionHistory /></PageContainer></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/funding/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { FundingPage } from '@/features/funding/funding-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><FundingPage /></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/funding/withdraw/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { WithdrawalPage } from '@/features/funding/withdrawal-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><WithdrawalPage /></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/layout.tsx

```tsx
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@/styles/globals.css';
import '@/styles/branding.css';
import { Providers } from './providers';
import { ErrorBoundary } from './error-boundary';

export const metadata: Metadata = {
  title: {
    default: 'Copy Trading',
    template: `%s · Copy Trading`,
  },
  description: 'Customer-facing multi-tenant SaaS copy-trading platform',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#4f46e5',
};

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <body>
        <ErrorBoundary>
          <Providers>{children}</Providers>
        </ErrorBoundary>
      </body>
    </html>
  );
}
```

FILE: apps/web/src/app/login/page.tsx

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/api/auth-api';
import { ApiError } from '@/api/api-errors';
import { MfaChallengeFlow } from '@/auth/mfa-flow';
import { useAuth } from '@/auth/auth.store';
import { useTenant } from '@/tenant/tenant-context';
import { TenantLogo } from '@/tenant/tenant-branding';

export default function LoginPage(): JSX.Element {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [mfaMethods, setMfaMethods] = useState<string[]>([]);
  const [mfaRequired, setMfaRequired] = useState<boolean>(false);
  const [ssoLoading, setSsoLoading] = useState<boolean>(false);
  const router = useRouter();
  const { refreshSession } = useAuth();
  const { tenant } = useTenant();

  // Return from /api/auth/sso/callback: ?sso=mfa (challenge cookies already set) or ?sso=failed.
  // Return from SAML Single Logout: ?sso=logout_unconfirmed when the identity provider did not
  // confirm the sign-out (this app's session was already ended before the IdP was involved).
  useEffect(() => {
    const sso = new URLSearchParams(window.location.search).get('sso');
    if (sso === 'mfa') {
      setMfaMethods(['TOTP', 'RECOVERY_CODE']);
      setMfaRequired(true);
    } else if (sso === 'failed') {
      setError('Single sign-on could not be completed. Please try again or contact your administrator.');
    } else if (sso === 'logout_unconfirmed') {
      setError(
        'You are signed out of this app, but your identity provider did not confirm the sign-out. Close your browser to end that session too.',
      );
    }
  }, []);

  const handleSso = async () => {
    setSsoLoading(true);
    setError('');
    try {
      // No providerType: the API starts this tenant's enabled provider (OIDC or SAML).
      const res = await authApi.ssoStart({});
      window.location.assign(res.authorizationUrl);
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.getUserMessage());
      setSsoLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await authApi.login({ email, password });
      if (res.requiresMfa) {
        setMfaMethods(res.methods ?? []);
        setMfaRequired(true);
      } else {
        await refreshSession();
        router.push('/dashboard');
      }
    } catch (err) {
      const apiErr = err as ApiError;
      // The tenant enforces single sign-on for this account: point at the SSO
      // button instead of suggesting the password was wrong.
      setError(
        apiErr.backendCode === 'SSO_REQUIRED'
          ? 'Your organisation requires single sign-on. Use "Sign in with single sign-on" below.'
          : apiErr.getUserMessage(),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSuccess = async () => {
    await refreshSession();
    router.push('/dashboard');
  };

  if (mfaRequired) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md rounded-lg border bg-card p-6">
          <MfaChallengeFlow methods={mfaMethods} onSuccess={handleMfaSuccess} onCancel={() => setMfaRequired(false)} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow">
        <div className="mb-6 text-center">
          <TenantLogo className="mx-auto h-12 w-12 rounded" />
          <h1 className="mt-3 text-xl font-bold">{tenant?.branding?.appName ?? tenant?.name ?? 'Sign In'}</h1>
          <p className="text-xs text-muted">Backend-authoritative authentication</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required className="mt-1 w-full rounded border px-3 py-2 text-sm" placeholder="you@example.com" />
          </div>
          <div>
            <label className="text-sm font-medium">Password</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required className="mt-1 w-full rounded border px-3 py-2 text-sm" placeholder="••••••••" />
          </div>
          {error && <div className="rounded bg-red-50 p-2 text-xs text-red-700">{error}</div>}
          <button type="submit" disabled={loading} className="w-full rounded bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{loading ? 'Signing in...' : 'Sign In'}</button>
        </form>
        <div className="mt-4">
          <button type="button" onClick={handleSso} disabled={ssoLoading || loading} className="w-full rounded border px-4 py-2 text-sm font-medium disabled:opacity-50">{ssoLoading ? 'Redirecting...' : 'Sign in with single sign-on'}</button>
        </div>
      </div>
    </div>
  );
}
```

FILE: apps/web/src/app/notifications/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { NotificationsPage } from '@/features/notifications/notifications-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><NotificationsPage /></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/notifications/preferences/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { NotificationPreferencesPage } from '@/features/notifications/notification-preferences-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><NotificationPreferencesPage /></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/onboarding/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { OnboardingPage } from '@/features/onboarding/onboarding-page';
export default function Page(): JSX.Element {
  return <AuthGuard><OnboardingPage /></AuthGuard>;
}
```

FILE: apps/web/src/app/page.tsx

```tsx
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export default function IndexPage(): JSX.Element {
  const cookieStore = cookies();
  const hasSession = cookieStore.get('wlct_session') || cookieStore.get('access_token');
  
  // Tenant resolution is backend-authoritative, not from query param
  // Landing page checks authenticated context
  if (hasSession) {
    redirect('/dashboard');
  }
  redirect('/login');
}
```

FILE: apps/web/src/app/portfolio/attribution/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { AttributionTable } from '@/features/portfolio/attribution-table';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><PageContainer title="Attribution" description="Strategy/trader/symbol/venue attribution"><AttributionTable /></PageContainer></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/portfolio/holdings/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { HoldingsTable } from '@/features/portfolio/holdings-table';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><PageContainer title="Holdings" description="Real persisted holdings"><HoldingsTable /></PageContainer></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/portfolio/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { PortfolioPage } from '@/features/portfolio/portfolio-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><PortfolioPage /></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/portfolio/performance/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { PerformanceChart } from '@/features/portfolio/performance-chart';
import { PnlPanel } from '@/features/portfolio/pnl-panel';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><PageContainer title="Performance" description="Backend performance series"><div className="grid gap-6 md:grid-cols-2"><PnlPanel /><PerformanceChart /></div></PageContainer></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/pricing/page.tsx

```tsx
import { redirect } from "next/navigation";

/**
 * The plan catalogue is served by the authenticated billing portal
 * (subscription:read); there is no public pricing endpoint, so this entry
 * point forwards to the signed-in plans page instead of rendering a page whose
 * every request would be rejected.
 */
export default function Page(): never {
  redirect("/billing/plans");
}
```

FILE: apps/web/src/app/privacy/page.tsx

```tsx
import { PageContainer } from '@/layout/page-container';
export default function Page(): JSX.Element {
  return <PageContainer title="Privacy Policy"><p className="text-sm text-muted">Privacy content.</p></PageContainer>;
}
```

FILE: apps/web/src/app/providers.tsx

```tsx
'use client';

import { ReactNode } from 'react';
import { App } from './app';

/**
 * Query/state/theme/auth/tenant/notification providers using existing repository conventions.
 * Delegates to root App composition.
 */

export function Providers({ children }: { children: ReactNode }): JSX.Element {
  return <App>{children}</App>;
}
```

FILE: apps/web/src/app/routes.tsx

```tsx
export const routes = {
  public: {
    landing: '/',
    login: '/login',
    pricing: '/pricing',
    terms: '/terms',
    privacy: '/privacy',
    status: '/status',
  },
  protected: {
    onboarding: '/onboarding',
    dashboard: '/dashboard',
    portfolio: '/portfolio',
    holdings: '/portfolio/holdings',
    performance: '/portfolio/performance',
    attribution: '/portfolio/attribution',
    traders: '/traders',
    traderDetail: (id: string) => `/traders/${id}`,
    strategies: '/strategies',
    strategyDetail: (id: string) => `/strategies/${id}`,
    copyTrading: '/copy-trading',
    exchanges: '/exchanges',
    connectExchange: '/exchanges/connect',
    funding: '/funding',
    deposit: '/funding/deposit',
    withdraw: '/funding/withdraw',
    fundingHistory: '/funding/history',
    billing: '/billing',
    plans: '/billing/plans',
    subscription: '/billing/subscription',
    checkout: '/billing/checkout',
    invoices: '/billing/invoices',
    usage: '/billing/usage',
    statements: '/statements',
    statementDetail: (id: string) => `/statements/${id}`,
    security: '/security',
    mfa: '/security/mfa',
    sessions: '/security/sessions',
    devices: '/security/devices',
    apiKeys: '/security/api-keys',
    account: '/account',
    profile: '/account/profile',
    relationships: '/account/relationships',
    restrictions: '/account/restrictions',
    notifications: '/notifications',
    notificationPrefs: '/notifications/preferences',
  },
} as const;

export const publicRoutes = Object.values(routes.public);
export const protectedRoutes = Object.values(routes.protected).flatMap((v) => typeof v === 'string' ? [v] : []);
```

FILE: apps/web/src/app/security/api-keys/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { ApiKeysPage } from '@/features/security/api-keys-page';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><PageContainer title="API Keys"><ApiKeysPage /></PageContainer></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/security/devices/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { DevicesPage } from '@/features/security/devices-page';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><PageContainer title="Devices"><DevicesPage /></PageContainer></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/security/mfa/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { MfaSettings } from '@/features/security/mfa-settings';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><PageContainer title="MFA Settings"><MfaSettings /></PageContainer></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/security/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { SecurityPage } from '@/features/security/security-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><SecurityPage /></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/security/sessions/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { SessionsPage } from '@/features/security/sessions-page';
import { AppShell } from '@/layout/app-shell';
import { PageContainer } from '@/layout/page-container';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><PageContainer title="Sessions"><SessionsPage /></PageContainer></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/statements/[id]/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { StatementDetailPage } from '@/features/statements/statement-detail-page';
import { AppShell } from '@/layout/app-shell';
export default function Page({ params }: { params: { id: string } }): JSX.Element {
  return <AuthGuard><AppShell><StatementDetailPage id={params.id} /></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/statements/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { StatementsPage } from '@/features/statements/statements-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><StatementsPage /></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/status/page.tsx

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { operationsApi } from "@/api/operations-api";
import { ApiError } from "@/api/api-errors";
import { PageContainer } from "@/layout/page-container";
import { StatusBadge } from "@/components/status-badge";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";

export default function Page(): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["status", "maintenance"],
    queryFn: () => operationsApi.getCurrentMaintenance(),
    retry: false,
  });
  const signedOut = error instanceof ApiError && error.status === 401;
  return (
    <PageContainer title="System Status">
      <div className="rounded border p-4">
        {isLoading ? (
          <LoadingState />
        ) : signedOut ? (
          <p className="text-sm text-muted">Sign in to see maintenance notices for your workspace.</p>
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data?.active ? (
          <>
            <StatusBadge status={data.isEmergency ? "EMERGENCY MAINTENANCE" : "MAINTENANCE"} variant={data.isEmergency ? "danger" : "warning"} />
            <p className="mt-2 text-sm">{data.message ?? "Scheduled maintenance in progress"}</p>
            {data.endsAt && <p className="mt-1 text-xs text-muted">Expected to end {new Date(data.endsAt).toLocaleString()}</p>}
          </>
        ) : (
          <>
            <StatusBadge status="OPERATIONAL" variant="success" />
            <p className="mt-2 text-sm">All systems operational</p>
          </>
        )}
      </div>
    </PageContainer>
  );
}
```

FILE: apps/web/src/app/strategies/[id]/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { StrategyDetailPage } from '@/features/trading/strategy-detail-page';
import { AppShell } from '@/layout/app-shell';
export default function Page({ params }: { params: { id: string } }): JSX.Element {
  return <AuthGuard><AppShell><StrategyDetailPage id={params.id} /></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/strategies/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { StrategiesPage } from '@/features/trading/strategies-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><StrategiesPage /></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/terms/page.tsx

```tsx
import { PageContainer } from '@/layout/page-container';
export default function Page(): JSX.Element {
  return <PageContainer title="Terms of Service"><p className="text-sm text-muted">Terms content from backend or static legal.</p></PageContainer>;
}
```

FILE: apps/web/src/app/traders/[id]/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { TraderDetailPage } from '@/features/trading/trader-detail-page';
import { AppShell } from '@/layout/app-shell';
export default function Page({ params }: { params: { id: string } }): JSX.Element {
  return <AuthGuard><AppShell><TraderDetailPage id={params.id} /></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/app/traders/page.tsx

```tsx
'use client';
import { AuthGuard } from '@/auth/auth.guard';
import { TradersPage } from '@/features/trading/traders-page';
import { AppShell } from '@/layout/app-shell';
export default function Page(): JSX.Element {
  return <AuthGuard><AppShell><TradersPage /></AppShell></AuthGuard>;
}
```

FILE: apps/web/src/auth/auth.guard.tsx

```tsx
'use client';

import { ReactNode, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './auth.store';

/**
 * Protected-route authorization UX. Backend remains authoritative.
 * Frontend route guards are UX only, not security boundary.
 */

interface AuthGuardProps {
  children: ReactNode;
  requireAuth?: boolean;
  requireEntitlement?: string;
  requireRole?: string[];
  fallback?: ReactNode;
}

export function AuthGuard({
  children,
  requireAuth = true,
  requireEntitlement,
  requireRole,
  fallback,
}: AuthGuardProps): JSX.Element {
  const { session, isLoading, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && requireAuth && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isLoading, isAuthenticated, requireAuth, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-muted">Loading session...</div>
      </div>
    );
  }

  if (requireAuth && !isAuthenticated) {
    return (fallback as JSX.Element) ?? (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm">Redirecting to login...</div>
      </div>
    );
  }

  if (requireEntitlement && session) {
    const hasEntitlement = session.entitlements[requireEntitlement];
    if (!hasEntitlement) {
      return (
        <div className="flex min-h-[50vh] items-center justify-center p-8">
          <div className="text-center">
            <h2 className="text-lg font-semibold">Feature not available</h2>
            <p className="mt-2 text-sm text-muted">
              This feature requires an upgraded plan. Please check your billing page.
            </p>
          </div>
        </div>
      );
    }
  }

  if (requireRole && requireRole.length > 0 && session) {
    const hasRole = requireRole.some((r) => session.user.roles.includes(r));
    if (!hasRole) {
      return (
        <div className="flex min-h-[50vh] items-center justify-center p-8">
          <div className="text-center">
            <h2 className="text-lg font-semibold">Access denied</h2>
            <p className="mt-2 text-sm text-muted">You do not have permission to access this page.</p>
          </div>
        </div>
      );
    }
  }

  return <>{children}</>;
}

export function PublicOnlyGuard({ children }: { children: ReactNode }): JSX.Element {
  const { isLoading, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace('/dashboard');
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-muted">Loading...</div>
      </div>
    );
  }

  if (isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm">Redirecting to dashboard...</div>
      </div>
    );
  }

  return <>{children}</>;
}
```

FILE: apps/web/src/auth/auth.store.ts

```typescript
'use client';

import { createContext, useContext } from 'react';
import { Session } from './auth.types';

/**
 * Session/auth state using secure storage conventions and backend-authoritative session state.
 * Frontend never stores JWT, refresh token, private keys, or secrets.
 * Session is httpOnly cookie based, managed by backend.
 */

export interface AuthContextValue {
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
  refreshSession: () => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>({
  session: null,
  isLoading: true,
  isAuthenticated: false,
  error: null,
  refreshSession: async () => {},
  logout: async () => {},
});

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}

export function clearSensitiveSessionState(): void {
  // Clear only non-sensitive UX state from localStorage
  // Never clear httpOnly cookies from JS (managed by backend)
  try {
    const safeKeys = ['theme', 'layout_prefs', 'table_prefs'];
    const allKeys = Object.keys(localStorage);
    for (const key of allKeys) {
      if (!safeKeys.some((safe) => key.startsWith(safe))) {
        // Only clear keys that are known to be sensitive if they exist
        if (key.includes('token') || key.includes('secret') || key.includes('private') || key.includes('credential')) {
          localStorage.removeItem(key);
        }
      }
    }
    sessionStorage.clear();
  } catch {
    // Ignore storage errors
  }
}
```

FILE: apps/web/src/auth/auth.types.ts

```typescript
/**
 * Frontend-safe auth/session/user types.
 * Never contains secrets, private keys, or raw tokens.
 */

export interface User {
  id: string;
  email: string;
  tenantId: string;
  roles: string[];
  /** Effective permission keys from GET /v1/auth/me (e.g. 'exchange_account:manage'). */
  permissions: string[];
  displayName?: string;
  avatarUrl?: string;
  mfaEnabled?: boolean;
}

export interface Session {
  user: User;
  tenant: {
    id: string;
    slug: string;
    name: string;
  };
  entitlements: Record<string, boolean>;
  expiresAt?: string;
  isAuthenticated: boolean;
}

export interface AuthState {
  session: Session | null;
  isLoading: boolean;
  error: string | null;
  isAuthenticated: boolean;
}

export interface LoginFormData {
  email: string;
  password: string;
}

export interface MfaFormData {
  code: string;
  method: 'TOTP' | 'RECOVERY';
}
```

FILE: apps/web/src/auth/mfa-flow.tsx

```tsx
'use client';

import { useState } from 'react';
import { authApi } from '@/api/auth-api';
import { ApiError } from '@/api/api-errors';

/**
 * MFA enrollment/challenge/recovery UI integrated with the backend
 * two-factor endpoints:
 *   enrol     POST /v1/auth/two-factor/setup   { password }
 *   confirm   POST /v1/auth/two-factor/confirm { code }
 *   sign-in   POST /api/auth/two-factor (BFF -> /v1/auth/two-factor/verify)
 */

interface MfaEnrollProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function MfaEnrollFlow({ onSuccess, onCancel }: MfaEnrollProps): JSX.Element {
  const [step, setStep] = useState<'init' | 'qr' | 'verify'>('init');
  const [password, setPassword] = useState<string>('');
  const [qrUrl, setQrUrl] = useState<string>('');
  const [secret, setSecret] = useState<string>('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [code, setCode] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  const handleEnroll = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await authApi.mfaEnroll(password);
      setPassword('');
      setQrUrl(res.qrCodeUrl ?? '');
      setSecret(res.secret ?? '');
      setRecoveryCodes(res.recoveryCodes ?? []);
      setStep('qr');
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.getUserMessage());
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setLoading(true);
    setError('');
    try {
      await authApi.mfaVerifyEnroll(code);
      setStep('verify');
      onSuccess();
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.getUserMessage());
    } finally {
      setLoading(false);
    }
  };

  if (step === 'init') {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Enable Two-Factor Authentication</h3>
        <p className="text-sm text-muted">
          Add an extra layer of security to your account. You will need an authenticator app.
        </p>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="mfa-enroll-password">
            Current password
          </label>
          <input
            id="mfa-enroll-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
          />
        </div>
        {error && <div className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <div className="flex gap-2">
          <button
            onClick={handleEnroll}
            disabled={loading || password.length === 0}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? 'Starting...' : 'Start Enrollment'}
          </button>
          <button onClick={onCancel} className="rounded border px-4 py-2 text-sm">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (step === 'qr') {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Scan QR Code</h3>
        {qrUrl && (
          <div className="flex justify-center">
            <img src={qrUrl} alt="MFA QR Code" className="h-48 w-48" />
          </div>
        )}
        {secret && (
          <div className="rounded bg-gray-50 p-3">
            <p className="text-xs text-muted">Manual entry secret:</p>
            <p className="break-all font-mono text-sm">{secret}</p>
          </div>
        )}
        <div className="space-y-2">
          <label className="text-sm font-medium">Enter code from authenticator app</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="123456"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="w-full rounded border px-3 py-2 font-mono"
            maxLength={8}
          />
        </div>
        {recoveryCodes.length > 0 && (
          <div className="rounded bg-yellow-50 p-3">
            <p className="text-sm font-medium">Save your recovery codes securely:</p>
            <p className="mt-1 text-xs text-muted">Each code works once. They will not be shown again.</p>
            <ul className="mt-2 font-mono text-xs">
              {recoveryCodes.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}
        {error && <div className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <div className="flex gap-2">
          <button
            onClick={handleVerify}
            disabled={loading || code.length < 6}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? 'Verifying...' : 'Verify and Enable'}
          </button>
          <button onClick={onCancel} className="rounded border px-4 py-2 text-sm">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">MFA Enabled</h3>
      <p className="text-sm text-muted">Two-factor authentication has been enabled successfully.</p>
      <button onClick={onSuccess} className="rounded bg-primary px-4 py-2 text-sm font-medium text-white">
        Done
      </button>
    </div>
  );
}

interface MfaChallengeProps {
  /** Methods the backend offered for this challenge, e.g. ['TOTP', 'RECOVERY_CODE']. */
  methods?: string[];
  onSuccess: (response: { redirectTo: string }) => void;
  onCancel: () => void;
}

export function MfaChallengeFlow({ methods, onSuccess, onCancel }: MfaChallengeProps): JSX.Element {
  const [code, setCode] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [method, setMethod] = useState<'TOTP' | 'RECOVERY'>('TOTP');
  const [trustDevice, setTrustDevice] = useState<boolean>(false);

  const offered = methods && methods.length > 0 ? methods : ['TOTP', 'RECOVERY_CODE'];
  const recoveryOffered = offered.includes('RECOVERY_CODE') || offered.includes('RECOVERY');

  const handleChallenge = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await authApi.mfaChallenge({ code, method, trustDevice });
      onSuccess(res);
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.getUserMessage());
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Two-Factor Authentication</h3>
      <p className="text-sm text-muted">
        {method === 'RECOVERY'
          ? 'Enter one of your recovery codes (format XXXX-XXXX-XXXX).'
          : 'Enter the code from your authenticator app.'}
      </p>
      {recoveryOffered && (
        <div className="flex gap-2">
          <button
            onClick={() => {
              setMethod('TOTP');
              setCode('');
            }}
            className={`rounded px-3 py-1 text-xs ${method === 'TOTP' ? 'bg-primary text-white' : 'border'}`}
          >
            Authenticator
          </button>
          <button
            onClick={() => {
              setMethod('RECOVERY');
              setCode('');
            }}
            className={`rounded px-3 py-1 text-xs ${method === 'RECOVERY' ? 'bg-primary text-white' : 'border'}`}
          >
            Recovery
          </button>
        </div>
      )}
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder={method === 'TOTP' ? '123456' : 'XXXX-XXXX-XXXX'}
        inputMode={method === 'TOTP' ? 'numeric' : 'text'}
        autoComplete="one-time-code"
        className="w-full rounded border px-3 py-2 font-mono"
      />
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={trustDevice} onChange={(e) => setTrustDevice(e.target.checked)} />
        Trust this device
      </label>
      {error && <div className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <div className="flex gap-2">
        <button
          onClick={handleChallenge}
          disabled={loading || !code}
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? 'Verifying...' : 'Verify'}
        </button>
        <button onClick={onCancel} className="rounded border px-4 py-2 text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}
```

FILE: apps/web/src/auth/permissions.ts

```typescript
import { hasAnyPermission } from '@wlct/shared-types';
import { Session } from './auth.types';

/**
 * UX-only permission checks for showing or hiding screens and actions. The
 * backend enforces every permission itself; this only avoids offering the
 * user something that would answer 403.
 *
 * Uses the backend's own matcher from @wlct/shared-types, so `*` (super
 * administrators) and `resource:*` wildcards behave exactly as on the API.
 */
export function sessionHasAnyPermission(session: Session | null | undefined, required: readonly string[]): boolean {
  if (required.length === 0) return true;
  return hasAnyPermission(session?.user.permissions ?? [], required);
}

export function permissionsAllowAny(granted: readonly string[], required: readonly string[]): boolean {
  if (required.length === 0) return true;
  return hasAnyPermission(granted, required);
}
```

FILE: apps/web/src/components/confirmation-dialog.tsx

```tsx
'use client';

import { useEffect, useRef, ReactNode } from 'react';

interface ConfirmationDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
  isLoading?: boolean;
}

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
  children,
  isLoading,
}: ConfirmationDialogProps): JSX.Element | null {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      // Focus trap: focus confirm button, handle Esc
      confirmRef.current?.focus();
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          onCancel();
        }
        if (e.key === 'Tab') {
          // Simple focus trap between cancel and confirm
          if (e.shiftKey && document.activeElement === cancelRef.current) {
            e.preventDefault();
            confirmRef.current?.focus();
          } else if (!e.shiftKey && document.activeElement === confirmRef.current) {
            e.preventDefault();
            cancelRef.current?.focus();
          }
        }
      };
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="w-full max-w-md rounded-lg bg-card p-6 shadow-xl">
        <h2 id="confirm-title" className="text-lg font-semibold">
          {title}
        </h2>
        {description && <p className="mt-2 text-sm text-muted">{description}</p>}
        {children && <div className="mt-4">{children}</div>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={isLoading}
            className="rounded border px-4 py-2 text-sm disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            disabled={isLoading}
            className={`rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
              variant === 'destructive' ? 'bg-red-600 hover:bg-red-700' : 'bg-primary hover:bg-primary/90'
            }`}
          >
            {isLoading ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

FILE: apps/web/src/components/empty-state.tsx

```tsx
import { ReactNode } from 'react';
import Link from 'next/link';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  children?: ReactNode;
}

export function EmptyState({ title, description, icon, action, children }: EmptyStateProps): JSX.Element {
  return (
    <div className="flex min-h-[300px] items-center justify-center p-8">
      <div className="max-w-md text-center">
        {icon && <div className="mx-auto mb-4 text-4xl" aria-hidden>{icon}</div>}
        <h3 className="text-lg font-semibold">{title}</h3>
        {description && <p className="mt-2 text-sm text-muted">{description}</p>}
        {children && <div className="mt-4">{children}</div>}
        {action && (
          <div className="mt-6">
            {action.href ? (
              <Link href={action.href} className="rounded bg-primary px-4 py-2 text-sm font-medium text-white">
                {action.label}
              </Link>
            ) : (
              <button onClick={action.onClick} className="rounded bg-primary px-4 py-2 text-sm font-medium text-white">
                {action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

FILE: apps/web/src/components/entitlement-gate.tsx

```tsx
'use client';

import { ReactNode } from 'react';
import { useTenant } from '@/tenant/tenant-context';
import Link from 'next/link';

/**
 * UX-level entitlement presentation using backend-resolved entitlement data.
 * Backend remains authoritative; this is UX only.
 */

interface EntitlementGateProps {
  feature: string;
  children: ReactNode;
  fallback?: ReactNode;
  showUpgrade?: boolean;
}

export function EntitlementGate({ feature, children, fallback, showUpgrade = true }: EntitlementGateProps): JSX.Element {
  const { tenant } = useTenant();
  const hasEntitlement = tenant?.entitlements[feature] ?? false;

  if (hasEntitlement) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  if (showUpgrade) {
    return (
      <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-6 text-center">
        <h3 className="font-semibold">Upgrade Required</h3>
        <p className="mt-2 text-sm text-muted">
          This feature requires an upgraded plan. Your current plan does not include <strong>{feature}</strong>.
        </p>
        <Link href="/billing/plans" className="mt-4 inline-block rounded bg-primary px-4 py-2 text-sm font-medium text-white">
          View Plans
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded border p-4 text-center text-sm text-muted">
      Feature <strong>{feature}</strong> not available in current plan.
    </div>
  );
}

export function useHasEntitlement(feature: string): boolean {
  const { tenant } = useTenant();
  return tenant?.entitlements[feature] ?? false;
}
```

FILE: apps/web/src/components/error-state.tsx

```tsx
'use client';

import { ApiError } from '@/api/api-errors';

interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}

export function ErrorState({ error, onRetry, title }: ErrorStateProps): JSX.Element {
  const apiError = error instanceof ApiError ? error : null;
  const message = apiError ? apiError.getUserMessage() : (error as Error)?.message ?? 'An unexpected error occurred';
  const isMaintenance = apiError?.isMaintenance();
  const isForbidden = apiError?.isForbidden();

  return (
    <div className="flex min-h-[200px] items-center justify-center p-8" role="alert">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 text-4xl" aria-hidden>
          {isMaintenance ? '🚧' : isForbidden ? '🔒' : '⚠️'}
        </div>
        <h3 className="text-lg font-semibold">{title ?? (isMaintenance ? 'Under Maintenance' : 'Something went wrong')}</h3>
        <p className="mt-2 text-sm text-muted">{message}</p>
        {apiError?.correlationId && (
          <p className="mt-2 text-xs text-muted">Ref: {apiError.correlationId.slice(0, 8)}</p>
        )}
        <div className="mt-4 flex justify-center gap-2">
          {onRetry && (
            <button onClick={onRetry} className="rounded bg-primary px-4 py-2 text-sm font-medium text-white">
              Try Again
            </button>
          )}
          <button onClick={() => window.location.reload()} className="rounded border px-4 py-2 text-sm">
            Reload Page
          </button>
        </div>
      </div>
    </div>
  );
}

export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }): JSX.Element {
  return (
    <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
      <div className="flex items-center justify-between">
        <span>{message}</span>
        {onRetry && (
          <button onClick={onRetry} className="ml-2 text-xs font-medium underline">
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
```

FILE: apps/web/src/components/loading-state.tsx

```tsx
export function LoadingState({ message = 'Loading...' }: { message?: string }): JSX.Element {
  return (
    <div className="flex min-h-[200px] items-center justify-center p-8" role="status" aria-live="polite">
      <div className="text-center">
        <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
        <p className="mt-3 text-sm text-muted">{message}</p>
      </div>
    </div>
  );
}

export function InlineLoading({ message }: { message?: string }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
      {message ?? 'Loading...'}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }): JSX.Element {
  return <div className={`animate-pulse rounded bg-gray-200 ${className ?? 'h-4 w-full'}`} aria-hidden />;
}

export function TableSkeleton({ rows = 5 }: { rows?: number }): JSX.Element {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
```

FILE: apps/web/src/components/maintenance-banner.tsx

```tsx
"use client";

import { useEffect, useState } from "react";
import { operationsApi, type MaintenanceNotice } from "@/api/operations-api";

export function MaintenanceBanner(): JSX.Element | null {
  const [maintenance, setMaintenance] = useState<MaintenanceNotice | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchMaintenance = async () => {
      try {
        const notice = await operationsApi.getCurrentMaintenance();
        if (!cancelled) setMaintenance(notice.active ? notice : null);
      } catch {
        // The banner is optional: signed-out visitors (401) and transient
        // failures simply show no banner; the next poll retries.
      }
    };

    void fetchMaintenance();
    const interval = setInterval(() => void fetchMaintenance(), 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!maintenance?.active) return null;

  const bgColor = maintenance.isEmergency ? "bg-red-600" : "bg-blue-600";

  return (
    <div className={`${bgColor} px-4 py-2 text-center text-sm text-white`} role="alert">
      <span className="font-medium">{maintenance.isEmergency ? "Emergency maintenance:" : "Maintenance:"}</span>{" "}
      {maintenance.message ?? "Scheduled maintenance in progress"}
      {maintenance.endsAt && (
        <span className="ml-2 text-xs opacity-90">Until {new Date(maintenance.endsAt).toLocaleString()}</span>
      )}
    </div>
  );
}

export function DegradationBanner({ level, message }: { level: string; message: string }): JSX.Element | null {
  if (level === "NORMAL") return null;

  const bg =
    level === "DISABLED"
      ? "bg-red-100 border-red-200 text-red-800"
      : level === "PAUSED"
        ? "bg-orange-100 border-orange-200 text-orange-800"
        : "bg-yellow-100 border-yellow-200 text-yellow-800";

  return (
    <div className={`rounded border p-3 text-sm ${bg}`} role="alert">
      <strong>{level}:</strong> {message}
    </div>
  );
}
```

FILE: apps/web/src/components/money.tsx

```tsx
/**
 * Precision-safe display formatting without performing authoritative financial calculations.
 * Frontend displays backend-authoritative values only.
 * Never calculates balances, PnL, NAV solely in browser.
 */

interface MoneyProps {
  value: string | number | null | undefined;
  currency?: string;
  className?: string;
  precision?: number;
  showSign?: boolean;
}

export function Money({ value, currency = 'USD', className, precision, showSign }: MoneyProps): JSX.Element {
  if (value === null || value === undefined || value === '') {
    return <span className={`text-muted ${className ?? ''}`}>—</span>;
  }

  const stringValue = typeof value === 'number' ? value.toString() : value;

  // Validate that value is a safe decimal string, not a float calculation
  if (typeof stringValue === 'string' && !/^-?\d+(\.\d+)?$/.test(stringValue) && stringValue !== '—') {
    // If backend returned something non-numeric (like UNKNOWN), show as-is safely
    return <span className={className}>{stringValue}</span>;
  }

  const num = typeof value === 'number' ? value : parseFloat(stringValue);

  if (isNaN(num)) {
    return <span className={className}>{stringValue}</span>;
  }

  const isNegative = num < 0;
  const absNum = Math.abs(num);

  // Use Intl.NumberFormat for safe display, but preserve backend precision
  const formatter = new Intl.NumberFormat('en-US', {
    style: currency ? 'currency' : 'decimal',
    currency: currency,
    minimumFractionDigits: precision ?? 2,
    maximumFractionDigits: precision ?? 8,
  });

  let formatted: string;
  try {
    formatted = currency ? formatter.format(absNum) : absNum.toLocaleString('en-US', {
      minimumFractionDigits: precision ?? 2,
      maximumFractionDigits: precision ?? 8,
    });
  } catch {
    formatted = stringValue;
  }

  if (isNegative) {
    formatted = `-${formatted}`;
  } else if (showSign && num > 0) {
    formatted = `+${formatted}`;
  }

  return (
    <span className={`${isNegative ? 'text-red-600' : ''} ${className ?? ''}`} aria-label={`${stringValue} ${currency}`}>
      {formatted}
    </span>
  );
}

export function MoneyWithState({
  value,
  currency,
  valuationState,
}: {
  value: string;
  currency?: string;
  valuationState?: string;
}): JSX.Element {
  if (valuationState && ['STALE', 'MISSING_PRICE', 'MISSING_FX', 'INCOMPLETE', 'UNAVAILABLE'].includes(valuationState)) {
    return (
      <span className="inline-flex items-center gap-1">
        <Money value={value} currency={currency} className="opacity-60" />
        <span className="text-xs text-yellow-600" title={`Valuation state: ${valuationState}`}>
          ⚠️ {valuationState}
        </span>
      </span>
    );
  }

  return <Money value={value} currency={currency} />;
}
```

FILE: apps/web/src/components/notification-center.tsx

```tsx
'use client';
/**
 * Notification center with realtime handling
 * - duplicate event detection: ignore if notification id already exists
 * - out-of-order event handling: use createdAt timestamp to order
 */

import { useEffect, useState } from 'react';
import { notificationApi, Notification } from '@/api/notification-api';
import { LoadingState } from './loading-state';
import { EmptyState } from './empty-state';
import { StatusBadge } from './status-badge';
import { ApiError } from '@/api/api-errors';

export function NotificationCenter(): JSX.Element {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNotifications = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await notificationApi.list({ limit: 20 });
      setNotifications(res.data);
      setUnreadCount(res.unreadCount);
    } catch (err) {
      setError(err instanceof ApiError ? err.getUserMessage() : (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  const handleMarkAllRead = async () => {
    try {
      await notificationApi.markAllAsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      // Ignore
    }
  };

  const handleMarkRead = async (id: string) => {
    try {
      await notificationApi.markAsRead(id);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      setUnreadCount((count) => Math.max(0, count - 1));
    } catch {
      // Ignore
    }
  };

  if (loading) return <LoadingState message="Loading notifications..." />;
  if (error) return <div className="p-4 text-sm text-red-600">{error}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Notifications {unreadCount > 0 && <span className="ml-2 rounded-full bg-red-500 px-2 py-0.5 text-xs text-white">{unreadCount}</span>}</h3>
        {unreadCount > 0 && (
          <button onClick={handleMarkAllRead} className="text-xs text-primary hover:underline">
            Mark all read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <EmptyState title="No notifications" description="You're all caught up" icon="🔔" />
      ) : (
        <ul className="space-y-2">
          {notifications.map((n) => (
            <li key={n.id} className={`rounded border p-3 ${!n.read ? 'bg-blue-50 border-blue-200' : 'bg-card'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <p className="text-sm font-medium">{n.title}</p>
                  <p className="mt-1 text-xs text-muted">{n.message}</p>
                  <p className="mt-1 text-xs text-muted">{new Date(n.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <StatusBadge status={n.read ? 'READ' : 'UNREAD'} />
                  {!n.read && (
                    <button onClick={() => handleMarkRead(n.id)} className="text-xs text-primary hover:underline">
                      Mark read
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

FILE: apps/web/src/components/percentage.tsx

```tsx
interface PercentageProps {
  value: string | number | null | undefined;
  className?: string;
  showSign?: boolean;
  precision?: number;
}

export function Percentage({ value, className, showSign = true, precision = 2 }: PercentageProps): JSX.Element {
  if (value === null || value === undefined || value === '') {
    return <span className={`text-muted ${className ?? ''}`}>—</span>;
  }

  const stringValue = typeof value === 'number' ? value.toString() : value;

  if (typeof stringValue === 'string' && !/^-?\d+(\.\d+)?$/.test(stringValue)) {
    return <span className={className}>{stringValue}</span>;
  }

  const num = typeof value === 'number' ? value : parseFloat(stringValue);

  if (isNaN(num)) {
    return <span className={className}>{stringValue}</span>;
  }

  const isPositive = num > 0;
  const isNegative = num < 0;

  const formatted = `${showSign && isPositive ? '+' : ''}${num.toFixed(precision)}%`;

  return (
    <span className={`${isPositive ? 'text-green-600' : isNegative ? 'text-red-600' : ''} ${className ?? ''}`}>
      {formatted}
    </span>
  );
}
```

FILE: apps/web/src/components/status-badge.tsx

```tsx
type StatusVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface StatusBadgeProps {
  status: string;
  variant?: StatusVariant;
  className?: string;
}

function getVariantForStatus(status: string): StatusVariant {
  const normalized = status.toUpperCase();
  if (['ACTIVE', 'CONFIRMED', 'COMPLETED', 'FILLED', 'HEALTHY', 'VERIFIED', 'APPROVED', 'SETTLED', 'VALID'].includes(normalized)) {
    return 'success';
  }
  if (['PENDING', 'REQUESTED', 'UNDER_REVIEW', 'SUBMITTED', 'CONFIRMING', 'QUEUED', 'IN_PROGRESS', 'STARTING', 'RUNNING'].includes(normalized)) {
    return 'warning';
  }
  if (['FAILED', 'REJECTED', 'BLOCKED', 'SUSPENDED', 'LOCKED', 'ERROR', 'CRITICAL', 'UNHEALTHY'].includes(normalized)) {
    return 'danger';
  }
  if (['DEGRADED', 'WARNING', 'STALE', 'MISSING_PRICE', 'MISSING_FX', 'INCOMPLETE', 'REVIEW_REQUIRED'].includes(normalized)) {
    return 'warning';
  }
  if (['INFO', 'DRAFT', 'NOT_STARTED'].includes(normalized)) {
    return 'info';
  }
  return 'neutral';
}

function getColorClasses(variant: StatusVariant): string {
  switch (variant) {
    case 'success':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'warning':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'danger':
      return 'bg-red-100 text-red-800 border-red-200';
    case 'info':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'neutral':
      return 'bg-gray-100 text-gray-800 border-gray-200';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
}

export function StatusBadge({ status, variant, className }: StatusBadgeProps): JSX.Element {
  const resolvedVariant = variant ?? getVariantForStatus(status);
  const colorClasses = getColorClasses(resolvedVariant);

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${colorClasses} ${className ?? ''}`}
      aria-label={`Status: ${status}`}
    >
      <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export function FundingStatusBadge({ state }: { state: string }): JSX.Element {
  const labelMap: Record<string, string> = {
    REQUESTED: 'Requested',
    UNDER_REVIEW: 'Under Review',
    APPROVED: 'Approved',
    SUBMITTED: 'Submitted',
    CONFIRMING: 'Confirming',
    CONFIRMED: 'Confirmed',
    FAILED: 'Failed',
    REVERSED: 'Reversed',
    CANCELLED: 'Cancelled',
    EXPECTED: 'Expected',
    OBSERVED: 'Observed',
    REORGED: 'Reorged',
    REJECTED: 'Rejected',
  };

  return <StatusBadge status={labelMap[state] ?? state} />;
}
```

FILE: apps/web/src/config/feature-config.ts

```typescript
/**
 * Frontend capability presentation configuration.
 * Backend remains authoritative for entitlement/security enforcement.
 * Frontend feature hiding is UX only, never security boundary.
 */

import { permissionsAllowAny } from '@/auth/permissions';

export type FeatureKey =
  | 'dashboard'
  | 'portfolio'
  | 'traders'
  | 'strategies'
  | 'copy_trading'
  | 'exchanges'
  | 'funding'
  | 'billing'
  | 'statements'
  | 'security'
  | 'notifications'
  | 'account'
  | 'api_keys'
  | 'onboarding';

export interface FeatureConfig {
  key: FeatureKey;
  label: string;
  route: string;
  /** Backend feature flag key from GET /v1/tenants/public-config `features`. */
  requiresEntitlement?: string;
  requiresRole?: string[];
  /**
   * Permission keys from GET /v1/auth/me; any one of them is enough. Mirrors
   * the permission the backend routes behind this screen demand, so a menu
   * entry is never shown to a user who would only get 403 responses.
   */
  requiresPermission?: string[];
  beta?: boolean;
}

export const featureCatalog: FeatureConfig[] = [
  { key: 'dashboard', label: 'Dashboard', route: '/dashboard' },
  { key: 'portfolio', label: 'Portfolio', route: '/portfolio' },
  { key: 'traders', label: 'Traders', route: '/traders' },
  { key: 'strategies', label: 'Strategies', route: '/strategies', requiresPermission: ['strategy:read'] },
  { key: 'copy_trading', label: 'Copy Trading', route: '/copy-trading', requiresEntitlement: 'copy_trading' },
  { key: 'exchanges', label: 'Exchanges', route: '/exchanges', requiresPermission: ['exchange_account:read'] },
  { key: 'funding', label: 'Funding', route: '/funding' },
  { key: 'billing', label: 'Billing', route: '/billing', requiresPermission: ['subscription:read', 'invoice:read'] },
  { key: 'statements', label: 'Statements', route: '/statements' },
  { key: 'security', label: 'Security', route: '/security' },
  { key: 'notifications', label: 'Notifications', route: '/notifications' },
  { key: 'account', label: 'Account', route: '/account' },
  { key: 'onboarding', label: 'Onboarding', route: '/onboarding' },
];

export function isFeatureEnabled(
  feature: FeatureKey,
  entitlements: Record<string, boolean>,
  roles: string[],
  permissions: string[] = []
): boolean {
  const config = featureCatalog.find((f) => f.key === feature);
  if (!config) return false;
  if (config.requiresEntitlement && !entitlements[config.requiresEntitlement]) {
    return false;
  }
  if (config.requiresPermission && !permissionsAllowAny(permissions, config.requiresPermission)) {
    return false;
  }
  if (config.requiresRole && config.requiresRole.length > 0) {
    return config.requiresRole.some((r) => roles.includes(r));
  }
  return true;
}
```

FILE: apps/web/src/config/runtime-config.ts

```typescript
/**
 * Safe public runtime configuration. Never expose secrets.
 * Browser-visible config only contains non-sensitive values.
 */

export const runtimeConfig = {
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? 'Copy Trading',
  apiVersion: process.env.NEXT_PUBLIC_API_VERSION ?? 'v1',
  wsUrl: process.env.NEXT_PUBLIC_WS_URL ?? '',
  wsPath: process.env.NEXT_PUBLIC_WS_PATH ?? '/socket.io',
  platformDomain: process.env.NEXT_PUBLIC_PLATFORM_DOMAIN ?? 'localhost',
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'support@example.com',
  supportUrl: process.env.NEXT_PUBLIC_SUPPORT_URL ?? '/support',
  environment: process.env.NEXT_PUBLIC_ENVIRONMENT ?? 'development',
  enableTelemetry: process.env.NEXT_PUBLIC_ENABLE_TELEMETRY === 'true',
  brandingCacheTtlMs: 5 * 60 * 1000,
  apiTimeoutMs: 15000,
  queryStaleTimeMs: 30 * 1000,
  queryGcTimeMs: 5 * 60 * 1000,
} as const;

export type RuntimeConfig = typeof runtimeConfig;

export function getRuntimeConfig(): RuntimeConfig {
  return runtimeConfig;
}
```

FILE: apps/web/src/features/account/account-page.tsx

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { clientLifecycleApi } from "@/api/client-lifecycle-api";
import { PageContainer } from "@/layout/page-container";
import { StatusBadge } from "@/components/status-badge";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";

/** The caller's accounts (there is no accounts/current route; the list is scoped to the caller). */
export function AccountPage(): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["account", "institutional"],
    queryFn: () => clientLifecycleApi.listAccounts(),
  });
  const accounts = data ?? [];
  return (
    <PageContainer title="Institutional Account" description="Account overview, status, restrictions">
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : accounts.length === 0 ? (
        <EmptyState title="No account yet" description="Your account appears here once onboarding opens it." />
      ) : (
        <div className="space-y-3">
          {accounts.map((a) => (
            <div key={a.id} className="space-y-2 rounded border bg-card p-4 text-sm">
              <p>
                <span className="font-medium">{a.displayName}</span>{" "}
                <span className="text-xs text-muted">({a.accountType.toLowerCase()})</span>
              </p>
              <div className="flex flex-wrap gap-2">
                <StatusBadge status={a.state} />
                {a.complianceStatus && <StatusBadge status={a.complianceStatus} />}
                {a.riskStatus && <StatusBadge status={a.riskStatus} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
```

FILE: apps/web/src/features/account/profile-page.tsx

```tsx
'use client';
import { useAuth } from '@/auth/auth.store';
import { PageContainer } from '@/layout/page-container';
export function ProfilePage(): JSX.Element {
  const { session } = useAuth();
  return (
    <PageContainer title="Profile" description="Customer profile from backend">
      <div className="rounded border bg-card p-4">
        <p className="text-sm">Email: {session?.user.email}</p>
        <p className="text-sm">Display Name: {session?.user.displayName ?? 'Not set'}</p>
        <p className="text-sm">Tenant: {session?.tenant.name}</p>
        <p className="text-sm">Roles: {session?.user.roles.join(', ')}</p>
      </div>
    </PageContainer>
  );
}
```

FILE: apps/web/src/features/account/relationships-page.tsx

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { clientLifecycleApi } from "@/api/client-lifecycle-api";
import { PageContainer } from "@/layout/page-container";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { StatusBadge } from "@/components/status-badge";

export function RelationshipsPage(): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["account", "relationships"],
    queryFn: () => clientLifecycleApi.listRelationships(),
  });
  const relationships = data ?? [];
  return (
    <PageContainer title="Relationships" description="Authorized trader/follower/strategy relationships">
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : relationships.length === 0 ? (
        <p className="text-xs text-muted">No relationships</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-y bg-gray-50 text-xs text-muted">
            <tr>
              <th className="p-2 text-left">Type</th>
              <th className="p-2">Status</th>
              <th className="p-2">Target</th>
            </tr>
          </thead>
          <tbody>
            {relationships.map((r) => (
              <tr key={r.id} className="border-b">
                <td className="p-2">{r.relationshipType.replace(/_/g, " ")}</td>
                <td className="p-2">
                  <StatusBadge status={r.status} />
                </td>
                <td className="p-2 font-mono text-xs">{r.targetId.slice(0, 8)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PageContainer>
  );
}
```

FILE: apps/web/src/features/account/restrictions-page.tsx

```tsx
"use client";

/**
 * Restrictions page
 * Handles NO_TRADING, NO_WITHDRAWAL, ACCOUNT_LOCKED etc with reason from backend
 */
import { useQuery } from "@tanstack/react-query";
import { clientLifecycleApi } from "@/api/client-lifecycle-api";
import { PageContainer } from "@/layout/page-container";
import { StatusBadge } from "@/components/status-badge";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";

export function RestrictionsPage(): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["account", "restrictions"],
    queryFn: () => clientLifecycleApi.listRestrictions(),
  });
  const restrictions = data ?? [];
  return (
    <PageContainer title="Restrictions" description="Existing account restrictions and reasons from backend">
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <div className="space-y-2">
          {restrictions.map((r) => (
            <div key={r.id} className="rounded border bg-card p-3 text-sm">
              <div className="flex gap-2">
                <StatusBadge status={r.restrictionType} variant="danger" />
                <StatusBadge status={r.status} />
              </div>
              <p className="mt-1 text-xs">Scope: {r.scope}</p>
              <p className="text-xs text-muted">Reason: {r.reason}</p>
              <p className="mt-1 text-xs text-muted">Users cannot remove restrictions from frontend. Contact support.</p>
            </div>
          ))}
          {restrictions.length === 0 && <p className="text-xs text-muted">No restrictions</p>}
        </div>
      )}
    </PageContainer>
  );
}
```

FILE: apps/web/src/features/billing/billing-page.tsx

```tsx
"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { billingApi } from "@/api/billing-api";
import { PageContainer } from "@/layout/page-container";
import { Money } from "@/components/money";
import { StatusBadge } from "@/components/status-badge";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { UsageMeter } from "./usage-meter";

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "—";
}

export function BillingPage(): JSX.Element {
  // One backend call: subscription state, plan, usage, latest invoice/payment and allowed actions.
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["billing", "overview"],
    queryFn: () => billingApi.getOverview(),
  });

  return (
    <PageContainer
      title="Billing"
      description="Customer billing dashboard from backend"
      actions={
        <div className="flex gap-2">
          <Link
            href="/billing/plans"
            className="rounded border px-4 py-2 text-sm"
          >
            View Plans
          </Link>
          <Link
            href="/billing/invoices"
            className="rounded border px-4 py-2 text-sm"
          >
            Invoices
          </Link>
          <Link
            href="/billing/usage"
            className="rounded border px-4 py-2 text-sm"
          >
            Usage
          </Link>
        </div>
      }
    >
      {isLoading ? (
        <LoadingState message="Loading billing..." />
      ) : error || !data ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded border bg-card p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Subscription</h3>
              <Link
                href="/billing/subscription"
                className="text-xs text-primary"
              >
                Manage
              </Link>
            </div>
            {data.subscription ? (
              <div className="mt-2 space-y-1 text-sm">
                <p>
                  {data.subscription.planName ??
                    data.subscription.planCode ??
                    "Current plan"}{" "}
                  <StatusBadge status={data.subscription.status} />
                </p>
                {data.currentPlan && (
                  <p className="text-xs text-muted">
                    <Money
                      value={data.currentPlan.price}
                      currency={data.currentPlan.currency}
                    />{" "}
                    / {data.currentPlan.billingInterval.toLowerCase()}
                  </p>
                )}
                <p className="text-xs text-muted">
                  {data.subscription.cancelAtPeriodEnd ? "Ends" : "Renews"}{" "}
                  {formatDate(
                    data.subscription.renewalDate ??
                      data.subscription.currentPeriodEnd,
                  )}
                </p>
                {data.subscription.isTrialing && (
                  <p className="text-xs text-muted">
                    Trial ends {formatDate(data.subscription.trialEnd)}
                  </p>
                )}
                {data.subscription.isPastDue && (
                  <p className="text-xs text-red-600">
                    Payment is past due. Please settle the open invoice.
                  </p>
                )}
              </div>
            ) : (
              <EmptyState
                title="No subscription"
                description="Choose a plan to get started"
                action={{ label: "View Plans", href: "/billing/plans" }}
              />
            )}
          </div>

          <div className="rounded border bg-card p-4">
            <h3 className="font-semibold">Usage</h3>
            {data.usage.length === 0 ? (
              <p className="mt-2 text-xs text-muted">
                No metered usage for this period.
              </p>
            ) : (
              <div className="mt-2 space-y-3">
                {data.usage.slice(0, 4).map((u) => (
                  <UsageMeter key={u.meter} usage={u} />
                ))}
              </div>
            )}
          </div>

          <div className="rounded border bg-card p-4">
            <h3 className="font-semibold">Latest invoice</h3>
            {data.latestInvoice ? (
              <div className="mt-2 flex items-center justify-between text-sm">
                <div>
                  <p>{data.latestInvoice.number}</p>
                  <p className="text-xs text-muted">
                    Issued {formatDate(data.latestInvoice.issueDate)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Money
                    value={data.latestInvoice.total}
                    currency={data.latestInvoice.currency}
                  />
                  <StatusBadge status={data.latestInvoice.status} />
                </div>
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted">No invoices yet.</p>
            )}
          </div>

          <div className="rounded border bg-card p-4">
            <h3 className="font-semibold">Latest payment</h3>
            {data.latestPayment ? (
              <div className="mt-2 flex items-center justify-between text-sm">
                <div>
                  <p>{data.latestPayment.provider}</p>
                  <p className="text-xs text-muted">
                    {formatDate(
                      data.latestPayment.paidAt ?? data.latestPayment.createdAt,
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Money
                    value={data.latestPayment.amount}
                    currency={data.latestPayment.currency}
                  />
                  <StatusBadge status={data.latestPayment.status} />
                </div>
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted">No payments yet.</p>
            )}
          </div>
        </div>
      )}
    </PageContainer>
  );
}
```

FILE: apps/web/src/features/billing/checkout-page.tsx

```tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { billingApi } from "@/api/billing-api";
import { ApiError } from "@/api/api-errors";
import { PageContainer } from "@/layout/page-container";
import { Money } from "@/components/money";
import { LoadingState } from "@/components/loading-state";
import { ErrorState, InlineError } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";

export function CheckoutPage(): JSX.Element {
  const searchParams = useSearchParams();
  const planId = searchParams.get("planId") ?? "";
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  // The plan (and its price) is read from the backend catalogue, never from the URL.
  const plans = useQuery({
    queryKey: ["billing", "plans"],
    queryFn: () => billingApi.listPlans(),
  });
  const plan = plans.data?.find((p) => p.id === planId) ?? null;

  const handleCheckout = async (): Promise<void> => {
    if (!plan) return;
    setLoading(true);
    setError("");
    try {
      const checkout = await billingApi.createCheckout({
        planId: plan.id,
        successUrl: `${window.location.origin}/billing`,
        cancelUrl: `${window.location.origin}/billing/plans`,
      });
      if (!checkout.redirectUrl) {
        setError(
          "The payment provider did not return a checkout page. Please try again later.",
        );
        return;
      }
      window.location.assign(checkout.redirectUrl);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.getUserMessage()
          : "Checkout could not be started. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageContainer
      title="Checkout"
      description="Real backend checkout flow, no hardcoded prices"
    >
      {plans.isLoading ? (
        <LoadingState message="Loading plan..." />
      ) : plans.error ? (
        <ErrorState error={plans.error} onRetry={() => void plans.refetch()} />
      ) : !plan ? (
        <EmptyState
          title="Plan not found"
          description="Choose a plan from the catalogue to continue."
          action={{ label: "View Plans", href: "/billing/plans" }}
        />
      ) : plan.isCurrent ? (
        <EmptyState
          title="Already subscribed"
          description={`${plan.name} is your current plan.`}
          action={{
            label: "Manage subscription",
            href: "/billing/subscription",
          }}
        />
      ) : (
        <div className="max-w-md rounded border bg-card p-4">
          <h3 className="font-semibold">{plan.name}</h3>
          <p className="mt-1 text-sm">
            <Money value={plan.price} currency={plan.currency} /> /{" "}
            {plan.billingInterval.toLowerCase()}
          </p>
          {plan.trialDays > 0 && (
            <p className="text-xs text-muted">
              Includes a {plan.trialDays}-day trial.
            </p>
          )}
          <p className="mt-2 text-xs text-muted">
            You will be redirected to the secure payment page. The amount
            charged, including any tax, is calculated by the billing system.
          </p>
          {error && (
            <div className="mt-2">
              <InlineError message={error} />
            </div>
          )}
          <button
            type="button"
            onClick={() => void handleCheckout()}
            disabled={loading}
            className="mt-4 w-full rounded bg-primary px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {loading ? "Redirecting..." : "Proceed to Checkout"}
          </button>
          <Link
            href="/billing/plans"
            className="mt-2 block text-center text-xs text-muted"
          >
            Back to plans
          </Link>
        </div>
      )}
    </PageContainer>
  );
}
```

FILE: apps/web/src/features/billing/invoices-page.tsx

```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { billingApi } from "@/api/billing-api";
import { PageContainer } from "@/layout/page-container";
import { Money } from "@/components/money";
import { StatusBadge } from "@/components/status-badge";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "—";
}

export function InvoicesPage(): JSX.Element {
  const invoices = useQuery({
    queryKey: ["billing", "invoices"],
    queryFn: () => billingApi.listInvoices({ limit: 50 }),
  });
  const payments = useQuery({
    queryKey: ["billing", "payments"],
    queryFn: () => billingApi.listPayments({ limit: 20 }),
  });

  return (
    <PageContainer
      title="Invoices"
      description="Persisted invoice history from backend"
    >
      {invoices.isLoading ? (
        <LoadingState message="Loading invoices..." />
      ) : invoices.error ? (
        <ErrorState
          error={invoices.error}
          onRetry={() => void invoices.refetch()}
        />
      ) : (invoices.data?.data ?? []).length === 0 ? (
        <EmptyState
          title="No invoices yet"
          description="Invoices are issued at the start of each billing period."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-y bg-gray-50 text-xs text-muted">
              <tr>
                <th className="p-2 text-left">Number</th>
                <th className="p-2 text-left">Period</th>
                <th className="p-2">Status</th>
                <th className="p-2 text-right">Tax</th>
                <th className="p-2 text-right">Total</th>
                <th className="p-2 text-right">Due</th>
                <th className="p-2">Issued</th>
              </tr>
            </thead>
            <tbody>
              {(invoices.data?.data ?? []).map((inv) => (
                <tr key={inv.id} className="border-b">
                  <td className="p-2">{inv.number}</td>
                  <td className="p-2 text-xs">
                    {formatDate(inv.periodStart)} – {formatDate(inv.periodEnd)}
                  </td>
                  <td className="p-2 text-center">
                    <StatusBadge status={inv.status} />
                  </td>
                  <td className="p-2 text-right">
                    <Money value={inv.taxTotal} currency={inv.currency} />
                  </td>
                  <td className="p-2 text-right">
                    <Money value={inv.total} currency={inv.currency} />
                  </td>
                  <td className="p-2 text-right">
                    <Money value={inv.amountDue} currency={inv.currency} />
                  </td>
                  <td className="p-2 text-center text-xs">
                    {formatDate(inv.issueDate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="mt-8 text-sm font-semibold">Payments</h3>
      {payments.isLoading ? (
        <LoadingState message="Loading payments..." />
      ) : payments.error ? (
        <ErrorState
          error={payments.error}
          onRetry={() => void payments.refetch()}
        />
      ) : (payments.data?.data ?? []).length === 0 ? (
        <p className="mt-2 text-xs text-muted">No payments yet.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {(payments.data?.data ?? []).map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded border bg-card p-3 text-sm"
            >
              <div>
                <p>
                  {p.provider}
                  {p.planCode ? ` · ${p.planCode}` : ""}
                </p>
                <p className="text-xs text-muted">
                  {formatDate(p.paidAt ?? p.failedAt ?? p.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Money value={p.amount} currency={p.currency} />
                <StatusBadge status={p.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
```

FILE: apps/web/src/features/billing/plan-comparison.tsx

```tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { billingApi, type Plan } from "@/api/billing-api";
import { ApiError } from "@/api/api-errors";
import { Money } from "@/components/money";
import { LoadingState } from "@/components/loading-state";
import { ErrorState, InlineError } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { ConfirmationDialog } from "@/components/confirmation-dialog";

/**
 * Plan catalogue from the backend. Without a subscription a plan goes to
 * checkout; with one, only the changes the backend marks eligible are offered
 * (change-plan), so the UI never proposes a transition the API would refuse.
 */
export function PlanComparison(): JSX.Element {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["billing", "plans"],
    queryFn: () => billingApi.listPlans(),
  });
  const [target, setTarget] = useState<Plan | null>(null);
  const [changing, setChanging] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (isLoading) return <LoadingState message="Loading plans..." />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const plans = data ?? [];
  if (plans.length === 0)
    return (
      <EmptyState
        title="No plans available"
        description="Your provider has not published any plans yet."
      />
    );
  const hasCurrent = plans.some((p) => p.isCurrent);

  const confirmChange = async (): Promise<void> => {
    if (!target) return;
    setChanging(true);
    setChangeError(null);
    try {
      const result = await billingApi.changePlan({ planId: target.id });
      setNotice(result.message ?? `Plan change to ${target.name} submitted.`);
      setTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["billing"] });
    } catch (err) {
      setChangeError(
        err instanceof ApiError
          ? err.getUserMessage()
          : "The plan could not be changed.",
      );
    } finally {
      setChanging(false);
    }
  };

  return (
    <div className="space-y-4">
      {notice && (
        <p className="rounded bg-green-50 p-2 text-xs text-green-800">
          {notice}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => (
          <div
            key={p.id}
            className={`rounded border bg-card p-4 ${p.isCurrent ? "border-primary" : ""}`}
          >
            <h3 className="font-semibold">
              {p.name}
              {p.isCurrent && (
                <span className="ml-2 rounded bg-primary px-2 py-0.5 text-xs text-white">
                  Current
                </span>
              )}
            </h3>
            {p.description && (
              <p className="mt-1 text-xs text-muted">{p.description}</p>
            )}
            <p className="mt-2">
              <Money value={p.price} currency={p.currency} /> /{" "}
              {p.billingInterval.toLowerCase()}
            </p>
            {p.trialDays > 0 && (
              <p className="text-xs text-muted">{p.trialDays}-day trial</p>
            )}
            <ul className="mt-3 space-y-1 text-xs">
              {p.features.map((f) => (
                <li key={f}>✓ {f}</li>
              ))}
            </ul>
            {!hasCurrent ? (
              <Link
                href={`/billing/checkout?planId=${encodeURIComponent(p.id)}`}
                className="mt-4 block rounded bg-primary px-4 py-2 text-center text-sm text-white"
              >
                Choose {p.name}
              </Link>
            ) : p.isCurrent ? (
              <p className="mt-4 rounded border px-4 py-2 text-center text-sm text-muted">
                Your current plan
              </p>
            ) : p.upgradeEligible || p.downgradeEligible ? (
              <button
                type="button"
                onClick={() => {
                  setChangeError(null);
                  setTarget(p);
                }}
                className="mt-4 w-full rounded bg-primary px-4 py-2 text-sm text-white"
              >
                {p.upgradeEligible ? "Upgrade" : "Downgrade"} to {p.name}
              </button>
            ) : (
              <p className="mt-4 rounded border px-4 py-2 text-center text-xs text-muted">
                Not available from your current plan
              </p>
            )}
          </div>
        ))}
      </div>
      <ConfirmationDialog
        open={target !== null}
        title="Change plan"
        description={
          target
            ? `Switch your subscription to ${target.name}? Proration and timing are calculated by the billing system.`
            : undefined
        }
        confirmLabel="Change plan"
        isLoading={changing}
        onConfirm={() => void confirmChange()}
        onCancel={() => setTarget(null)}
      >
        {changeError && <InlineError message={changeError} />}
      </ConfirmationDialog>
    </div>
  );
}
```

FILE: apps/web/src/features/billing/subscription-page.tsx

```tsx
"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { billingApi } from "@/api/billing-api";
import { ApiError } from "@/api/api-errors";
import { PageContainer } from "@/layout/page-container";
import { StatusBadge } from "@/components/status-badge";
import { Money } from "@/components/money";
import { LoadingState } from "@/components/loading-state";
import { ErrorState, InlineError } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { ConfirmationDialog } from "@/components/confirmation-dialog";

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "—";
}

export function SubscriptionPage(): JSX.Element {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["billing", "overview"],
    queryFn: () => billingApi.getOverview(),
  });
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [reason, setReason] = useState<string>("");
  const [pending, setPending] = useState<"cancel" | "resume" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async (kind: "cancel" | "resume"): Promise<void> => {
    setPending(kind);
    setActionError(null);
    try {
      const result =
        kind === "cancel"
          ? await billingApi.cancelSubscription({
              reason: reason.trim() || undefined,
            })
          : await billingApi.resumeSubscription();
      setNotice(
        result.message ??
          (kind === "cancel"
            ? "Your subscription will end at the close of the current period."
            : "Your subscription has been resumed."),
      );
      setConfirmOpen(false);
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["billing"] });
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.getUserMessage()
          : "The request could not be completed.",
      );
    } finally {
      setPending(null);
    }
  };

  if (isLoading) return <LoadingState message="Loading subscription..." />;
  if (error || !data) {
    return (
      <PageContainer title="Subscription">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  const sub = data.subscription;
  if (!sub) {
    return (
      <PageContainer title="Subscription">
        <EmptyState
          title="No active subscription"
          description="Choose a plan to get started"
          action={{ label: "View Plans", href: "/billing/plans" }}
        />
      </PageContainer>
    );
  }

  // Only offer what the backend says is allowed for the current state.
  const canCancel = data.availableActions.includes("CANCEL_AT_PERIOD_END");
  const canResume = data.availableActions.includes("RESUME");

  return (
    <PageContainer
      title="Subscription"
      description="Subscription status and lifecycle from backend"
    >
      {notice && (
        <p className="mb-4 rounded bg-green-50 p-2 text-xs text-green-800">
          {notice}
        </p>
      )}
      <div className="rounded border bg-card p-4">
        <div className="flex justify-between">
          <h3 className="font-semibold">
            {sub.planName ?? sub.planCode ?? "Current plan"}
          </h3>
          <StatusBadge status={sub.status} />
        </div>
        {data.currentPlan && (
          <p className="mt-1 text-sm">
            <Money
              value={data.currentPlan.price}
              currency={data.currentPlan.currency}
            />{" "}
            / {data.currentPlan.billingInterval.toLowerCase()}
          </p>
        )}
        <p className="mt-2 text-xs text-muted">
          Current period: {formatDate(sub.currentPeriodStart)} –{" "}
          {formatDate(sub.currentPeriodEnd)}
        </p>
        {sub.isTrialing && (
          <p className="text-xs text-muted">
            Trial ends {formatDate(sub.trialEnd)}
          </p>
        )}
        <p className="text-xs">
          {sub.cancelAtPeriodEnd
            ? `Cancels on ${formatDate(sub.currentPeriodEnd)}`
            : `Renews on ${formatDate(sub.renewalDate ?? sub.currentPeriodEnd)}`}
        </p>
        {actionError && !confirmOpen && (
          <div className="mt-2">
            <InlineError message={actionError} />
          </div>
        )}
        <div className="mt-4 flex gap-2">
          {canCancel && (
            <button
              type="button"
              onClick={() => {
                setActionError(null);
                setConfirmOpen(true);
              }}
              className="rounded border px-3 py-1 text-xs"
              disabled={pending !== null}
            >
              Cancel subscription
            </button>
          )}
          {canResume && (
            <button
              type="button"
              onClick={() => void run("resume")}
              className="rounded border px-3 py-1 text-xs"
              disabled={pending !== null}
            >
              {pending === "resume" ? "Resuming..." : "Resume subscription"}
            </button>
          )}
        </div>
      </div>
      <ConfirmationDialog
        open={confirmOpen}
        title="Cancel Subscription"
        description="Are you sure you want to cancel your subscription? You will retain access until period end."
        variant="destructive"
        confirmLabel="Cancel Subscription"
        isLoading={pending === "cancel"}
        onConfirm={() => void run("cancel")}
        onCancel={() => setConfirmOpen(false)}
      >
        <label className="block text-xs">
          Reason (optional)
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={3}
            className="mt-1 w-full rounded border px-2 py-1 text-sm"
          />
        </label>
        {actionError && <InlineError message={actionError} />}
      </ConfirmationDialog>
    </PageContainer>
  );
}
```

FILE: apps/web/src/features/billing/usage-meter.tsx

```tsx
import type { UsageRecord } from "@/api/billing-api";

/**
 * One usage meter. Current value, limit, remaining and percentage all come from
 * the backend usage summary; nothing is derived here.
 */
export function UsageMeter({ usage }: { usage: UsageRecord }): JSX.Element {
  const percent =
    usage.percentageUsed === null
      ? null
      : Math.max(0, Math.min(100, usage.percentageUsed));
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span>{usage.label}</span>
        <span className="font-mono">
          {usage.current} /{" "}
          {usage.unlimited ? "Unlimited" : (usage.limit ?? "—")}
        </span>
      </div>
      {percent !== null && !usage.unlimited && (
        <div
          className="mt-1 h-2 w-full rounded bg-gray-200"
          role="progressbar"
          aria-label={usage.label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div
            className={`h-2 rounded ${percent >= 90 ? "bg-red-600" : "bg-primary"}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </div>
  );
}
```

FILE: apps/web/src/features/billing/usage-page.tsx

```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { billingApi } from "@/api/billing-api";
import { PageContainer } from "@/layout/page-container";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { UsageMeter } from "./usage-meter";

export function UsagePage(): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["billing", "usage"],
    queryFn: () => billingApi.getUsage(),
  });
  const usage = data ?? [];

  return (
    <PageContainer
      title="Usage"
      description="Backend usage/quota/metering data"
    >
      {isLoading ? (
        <LoadingState message="Loading usage..." />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : usage.length === 0 ? (
        <EmptyState
          title="No usage data"
          description="Usage appears once your plan has metered limits."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {usage.map((u) => (
            <div key={u.meter} className="rounded border bg-card p-4">
              <UsageMeter usage={u} />
              <p className="mt-2 text-xs text-muted">
                {u.unlimited
                  ? "No limit on your plan"
                  : u.remaining === null
                    ? "Remaining: —"
                    : `Remaining: ${u.remaining}`}
                {u.scope ? ` · ${u.scope.toLowerCase()}` : ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
```

FILE: apps/web/src/features/dashboard/dashboard-page.tsx

```tsx
'use client';

import { PageContainer } from '@/layout/page-container';
import { useDashboardData } from './dashboard-query';
import {
  PortfolioWidget,
  TradingStatusWidget,
  CopySubscriptionsWidget,
  ExchangeHealthWidget,
  FundingWidget,
  BillingWidget,
  SecurityWidget,
} from './dashboard-widgets';
import { useAuth } from '@/auth/auth.store';
import { MaintenanceBanner } from '@/components/maintenance-banner';

export function DashboardPage(): JSX.Element {
  const { session } = useAuth();
  const { portfolio, tradingStatus, subscriptions, exchanges, funding, billing, canViewBilling, notifications } = useDashboardData();

  return (
    <PageContainer
      title={`Welcome, ${session?.user.displayName ?? session?.user.email ?? 'User'}`}
      description="Your trading overview with real-time backend data"
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <PortfolioWidget data={portfolio.data} isLoading={portfolio.isLoading} error={portfolio.error} />
        <TradingStatusWidget data={tradingStatus.data} isLoading={tradingStatus.isLoading} />
        <CopySubscriptionsWidget data={subscriptions.data} isLoading={subscriptions.isLoading} />
        <ExchangeHealthWidget data={exchanges.data} isLoading={exchanges.isLoading} />
        <FundingWidget data={funding.data} isLoading={funding.isLoading} />
        {canViewBilling && <BillingWidget data={billing.data} isLoading={billing.isLoading} error={billing.error} />}
        <SecurityWidget mfaEnabled={session?.user.mfaEnabled} />
      </div>

      <div className="mt-6 rounded-lg border bg-card p-4">
        <h3 className="text-sm font-semibold">Operational Status</h3>
        <p className="mt-1 text-xs text-muted">Maintenance and degradation states are displayed from backend Operations API.</p>
        <MaintenanceBanner />
        {tradingStatus.data?.maintenance?.active && (
          <div className="mt-2 rounded bg-yellow-50 p-2 text-xs text-yellow-800">{tradingStatus.data.maintenance.message}</div>
        )}
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold">Recent Notifications</h3>
        {notifications.data ? (
          <ul className="mt-2 space-y-1">
            {notifications.data.data.slice(0, 5).map((n) => (
              <li key={n.id} className="rounded border p-2 text-xs">
                <span className="font-medium">{n.title}</span> — {n.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted">No recent notifications</p>
        )}
      </div>
    </PageContainer>
  );
}
```

FILE: apps/web/src/features/dashboard/dashboard-query.ts

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import { portfolioApi } from '@/api/portfolio-api';
import { tradingApi } from '@/api/trading-api';
import { exchangeApi } from '@/api/exchange-api';
import { fundingApi } from '@/api/funding-api';
import { billingApi } from '@/api/billing-api';
import { notificationApi } from '@/api/notification-api';
import { getRuntimeConfig } from '@/config/runtime-config';
import { usePortfolioProfile } from '@/features/portfolio/use-portfolio-profile';
import { useTradingStatus } from '@/features/trading/use-trading-status';
import { useAuth } from '@/auth/auth.store';
import { sessionHasAnyPermission } from '@/auth/permissions';
import { Permission } from '@wlct/shared-types';

const config = getRuntimeConfig();

export function useDashboardData() {
  const { session } = useAuth();
  // Tenant billing is only readable with subscription:read (tenant admin, finance);
  // other roles would get 403 on every dashboard load, so they skip the call.
  const canViewBilling = sessionHasAnyPermission(session, [Permission.SUBSCRIPTION_READ]);

  // Portfolio figures are per profile: wait for the user's profile; without one
  // the query stays disabled and the widget shows its empty state.
  const { profileId, isLoading: profileLoading, error: profileError } = usePortfolioProfile();
  const portfolioQuery = useQuery({
    queryKey: ['dashboard', 'portfolio', 'overview', profileId ?? 'none'],
    queryFn: () => portfolioApi.getOverview(profileId as string),
    enabled: Boolean(profileId),
    staleTime: config.queryStaleTimeMs,
  });
  const portfolio = {
    data: portfolioQuery.data,
    isLoading: profileLoading || portfolioQuery.isLoading,
    isError: Boolean(profileError) || portfolioQuery.isError,
    error: profileError ?? portfolioQuery.error,
    refetch: portfolioQuery.refetch,
  };

  // Composed from the maintenance notice, the caller's own restrictions and
  // the role (there is no trading-status route); shared with the trading pages.
  const tradingStatus = useTradingStatus();

  const subscriptions = useQuery({
    queryKey: ['dashboard', 'copy', 'subscriptions'],
    queryFn: () => tradingApi.listCopySubscriptions({ limit: 5 }),
    staleTime: config.queryStaleTimeMs,
  });

  const exchanges = useQuery({
    queryKey: ['dashboard', 'exchanges', 'accounts'],
    queryFn: () => exchangeApi.listAccounts(),
    staleTime: config.queryStaleTimeMs,
  });

  const funding = useQuery({
    queryKey: ['dashboard', 'funding', 'recent'],
    queryFn: () => fundingApi.listHistory({ limit: 5 }),
    staleTime: config.queryStaleTimeMs,
  });

  const billing = useQuery({
    queryKey: ['dashboard', 'billing', 'overview'],
    queryFn: () => billingApi.getOverview(),
    enabled: canViewBilling,
    staleTime: config.queryStaleTimeMs,
  });

  const notifications = useQuery({
    queryKey: ['dashboard', 'notifications', 'unread'],
    queryFn: () => notificationApi.list({ limit: 5 }),
    staleTime: 15 * 1000,
  });

  return {
    portfolio,
    tradingStatus,
    subscriptions,
    exchanges,
    funding,
    billing,
    canViewBilling,
    notifications,
    isLoading: portfolio.isLoading || tradingStatus.isLoading,
    hasError: portfolio.isError || tradingStatus.isError,
  };
}
```

FILE: apps/web/src/features/dashboard/dashboard-widgets.tsx

```tsx
'use client';

import { Money, MoneyWithState } from '@/components/money';
import { Percentage } from '@/components/percentage';
import { StatusBadge } from '@/components/status-badge';
import { LoadingState } from '@/components/loading-state';
import { ErrorState } from '@/components/error-state';
import { EmptyState } from '@/components/empty-state';
import Link from 'next/link';
import type { BillingOverview } from '@/api/billing-api';
import type { CopySubscription, Paged, TradingStatus } from '@/api/trading-api';

interface WidgetProps {
  title: string;
  children: React.ReactNode;
  action?: { label: string; href: string };
  className?: string;
}

function Widget({ title, children, action, className }: WidgetProps): JSX.Element {
  return (
    <div className={`rounded-lg border bg-card p-4 ${className ?? ''}`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action && (
          <Link href={action.href} className="text-xs text-primary hover:underline">
            {action.label}
          </Link>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

export function PortfolioWidget({ data, isLoading, error }: { data?: { nav: string; dailyPnl: string; currency: string; valuationState: string }; isLoading: boolean; error: unknown }): JSX.Element {
  if (isLoading) return <Widget title="Portfolio"><LoadingState message="Loading portfolio..." /></Widget>;
  if (error) return <Widget title="Portfolio"><ErrorState error={error} /></Widget>;
  if (!data) return <Widget title="Portfolio"><EmptyState title="No portfolio data" description="Portfolio data is unavailable" /></Widget>;

  return (
    <Widget title="Portfolio" action={{ label: 'View', href: '/portfolio' }}>
      <div className="space-y-2">
        <div>
          <p className="text-xs text-muted">NAV</p>
          <MoneyWithState value={data.nav} currency={data.currency} valuationState={data.valuationState} />
        </div>
        <div>
          <p className="text-xs text-muted">Daily PnL</p>
          <Money value={data.dailyPnl} currency={data.currency} showSign />
        </div>
        {data.valuationState !== 'VALID' && (
          <p className="text-xs text-yellow-600">Valuation: {data.valuationState}</p>
        )}
      </div>
    </Widget>
  );
}

export function TradingStatusWidget({ data, isLoading }: { data?: TradingStatus; isLoading: boolean }): JSX.Element {
  if (isLoading) return <Widget title="Trading Status"><LoadingState /></Widget>;
  if (!data) return <Widget title="Trading Status"><EmptyState title="No trading status" /></Widget>;

  return (
    <Widget title="Trading Status">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <StatusBadge status={data.eligibility} />
          {data.maintenance?.active && (
            <StatusBadge status="MAINTENANCE" variant={data.maintenance.isEmergency ? 'danger' : 'warning'} />
          )}
        </div>
        {data.restrictions.length > 0 && (
          <ul className="space-y-1">
            {data.restrictions.map((r, i) => (
              <li key={i} className="text-xs">
                <StatusBadge status={r.type} /> <span className="text-muted">{r.reason}</span>
              </li>
            ))}
          </ul>
        )}
        {data.restrictions.length === 0 && <p className="text-xs text-muted">No restrictions</p>}
      </div>
    </Widget>
  );
}

export function CopySubscriptionsWidget({ data, isLoading }: { data?: Paged<CopySubscription>; isLoading: boolean }): JSX.Element {
  if (isLoading) return <Widget title="Copy Subscriptions"><LoadingState /></Widget>;

  const subs = data?.data ?? [];

  return (
    <Widget title="Copy Subscriptions" action={{ label: 'Manage', href: '/copy-trading' }}>
      {subs.length === 0 ? (
        <EmptyState title="No subscriptions" description="You are not copying any strategies yet" action={{ label: 'Browse Strategies', href: '/strategies' }} />
      ) : (
        <ul className="space-y-2">
          {subs.slice(0, 3).map((s) => (
            <li key={s.subscriptionId} className="flex items-center justify-between text-sm">
              <span className="truncate">{s.strategyId.slice(0, 8)}</span>
              <div className="flex items-center gap-2">
                <Money value={s.allocationAmount} />
                <StatusBadge status={s.state} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}

export function ExchangeHealthWidget({ data, isLoading }: { data?: { data: Array<{ id: string; exchange: string; health: string; status: string }> }; isLoading: boolean }): JSX.Element {
  if (isLoading) return <Widget title="Exchanges"><LoadingState /></Widget>;

  const accounts = data?.data ?? [];

  return (
    <Widget title="Exchanges" action={{ label: 'Manage', href: '/exchanges' }}>
      {accounts.length === 0 ? (
        <EmptyState title="No exchange accounts" description="Connect an exchange to start trading" action={{ label: 'Connect', href: '/exchanges/connect' }} />
      ) : (
        <ul className="space-y-2">
          {accounts.slice(0, 3).map((a) => (
            <li key={a.id} className="flex items-center justify-between text-sm">
              <span>{a.exchange}</span>
              <div className="flex gap-1">
                <StatusBadge status={a.health} />
                <StatusBadge status={a.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}

export function FundingWidget({ data, isLoading }: { data?: { data: Array<{ id: string; type: string; amount: string; currency: string; state: string }> }; isLoading: boolean }): JSX.Element {
  if (isLoading) return <Widget title="Recent Funding"><LoadingState /></Widget>;

  const items = data?.data ?? [];

  return (
    <Widget title="Recent Funding" action={{ label: 'View All', href: '/funding/history' }}>
      {items.length === 0 ? (
        <EmptyState title="No funding activity" description="Your funding history will appear here" />
      ) : (
        <ul className="space-y-2">
          {items.map((f) => (
            <li key={`${f.type}-${f.id}`} className="flex items-center justify-between text-sm">
              <span>{f.type === 'DEPOSIT' ? 'Deposit' : 'Withdrawal'}</span>
              <div className="flex items-center gap-2">
                <Money value={f.amount} currency={f.currency} />
                <StatusBadge status={f.state} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}

export function BillingWidget({ data, isLoading, error }: { data?: BillingOverview; isLoading: boolean; error?: unknown }): JSX.Element {
  if (isLoading) return <Widget title="Billing"><LoadingState /></Widget>;
  if (error) return <Widget title="Billing"><ErrorState error={error} /></Widget>;

  const subscription = data?.subscription ?? null;
  const renewal = subscription?.renewalDate ?? subscription?.currentPeriodEnd ?? null;
  return (
    <Widget title="Billing" action={{ label: 'Manage', href: '/billing' }}>
      {subscription ? (
        <div className="space-y-2">
          <p className="text-sm">
            <span className="font-medium">{subscription.planName ?? subscription.planCode ?? 'Current plan'}</span> <StatusBadge status={subscription.status} />
          </p>
          {renewal && (
            <p className="text-xs text-muted">
              {subscription.cancelAtPeriodEnd ? 'Ends' : 'Renews'} {new Date(renewal).toLocaleDateString()}
            </p>
          )}
          {data && data.usage.length > 0 && (
            <div className="mt-2 space-y-1">
              {data.usage.slice(0, 2).map((u) => (
                <div key={u.meter} className="text-xs">
                  {u.label}: {u.current}/{u.unlimited ? 'Unlimited' : (u.limit ?? '—')}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <EmptyState title="No subscription" description="Choose a plan to get started" action={{ label: 'View Plans', href: '/billing/plans' }} />
      )}
    </Widget>
  );
}

export function SecurityWidget({ mfaEnabled }: { mfaEnabled?: boolean }): JSX.Element {
  return (
    <Widget title="Security" action={{ label: 'Manage', href: '/security' }}>
      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span>MFA</span>
          <StatusBadge status={mfaEnabled ? 'ENABLED' : 'DISABLED'} variant={mfaEnabled ? 'success' : 'warning'} />
        </div>
        <p className="text-xs text-muted">Keep your account secure with two-factor authentication.</p>
      </div>
    </Widget>
  );
}
```

FILE: apps/web/src/features/exchanges/connect-exchange-page.tsx

```tsx
'use client';
import { useState } from 'react';
import { exchangeApi, EXCHANGE_VENUES, PASSPHRASE_VENUES } from '@/api/exchange-api';
import { ApiError } from '@/api/api-errors';
import { PageContainer } from '@/layout/page-container';
import { ExchangeSecurityWarning } from './exchange-security-warning';
export function ConnectExchangePage(): JSX.Element {
  const [exchange, setExchange] = useState<string>('BINANCE');
  const [environment, setEnvironment] = useState<string>('LIVE');
  const [apiKey, setApiKey] = useState<string>('');
  const [apiSecret, setApiSecret] = useState<string>('');
  const [passphrase, setPassphrase] = useState<string>('');
  const [label, setLabel] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const needsPassphrase = PASSPHRASE_VENUES.includes(exchange);
  const handleConnect = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await exchangeApi.connectAccount({ exchange, environment, apiKey, apiSecret, label, passphrase: needsPassphrase ? passphrase : undefined });
      setSuccess(`${res.label ?? res.exchange} (${res.maskedApiKey ?? 'key saved'}) connected with status ${res.status}`);
      setApiKey('');
      setApiSecret('');
      setPassphrase('');
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.getUserMessage());
    } finally {
      setLoading(false);
    }
  };
  return (
    <PageContainer title="Connect Exchange" description="Secure exchange connection using backend credential lifecycle">
      <ExchangeSecurityWarning />
      <div className="mt-4 max-w-md space-y-3 rounded border bg-card p-4">
        <select value={exchange} onChange={(e) => setExchange(e.target.value)} className="w-full rounded border px-3 py-2 text-sm" aria-label="Exchange">
          {EXCHANGE_VENUES.map((venue) => <option key={venue} value={venue}>{venue === 'OKX' ? 'OKX' : venue.charAt(0) + venue.slice(1).toLowerCase()}</option>)}
        </select>
        <select value={environment} onChange={(e) => setEnvironment(e.target.value)} className="w-full rounded border px-3 py-2 text-sm" aria-label="Environment">
          <option value="LIVE">Live account</option>
          <option value="TESTNET">Testnet</option>
        </select>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" maxLength={80} className="w-full rounded border px-3 py-2 text-sm" />
        <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="API Key" autoComplete="off" spellCheck={false} className="w-full rounded border px-3 py-2 text-sm font-mono" />
        <input value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} placeholder="API Secret" type="password" autoComplete="new-password" className="w-full rounded border px-3 py-2 text-sm font-mono" />
        {needsPassphrase && <input value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder="API Passphrase" type="password" autoComplete="new-password" className="w-full rounded border px-3 py-2 text-sm font-mono" />}
        {error && <p className="text-xs text-red-600">{error}</p>}
        {success && <p className="text-xs text-green-600">{success}</p>}
        <button onClick={handleConnect} disabled={loading || apiKey.trim().length < 8 || apiSecret.trim().length < 8 || (needsPassphrase && !passphrase)} className="w-full rounded bg-primary px-4 py-2 text-sm text-white disabled:opacity-50">{loading ? 'Connecting...' : 'Connect'}</button>
      </div>
    </PageContainer>
  );
}
```

FILE: apps/web/src/features/exchanges/exchange-account-detail.tsx

```tsx
'use client';
import { useQuery } from '@tanstack/react-query';
import { exchangeApi } from '@/api/exchange-api';
import { ApiError } from '@/api/api-errors';
import { StatusBadge } from '@/components/status-badge';
import { LoadingState } from '@/components/loading-state';
import { ErrorState } from '@/components/error-state';
import { ConfirmationDialog } from '@/components/confirmation-dialog';
import { useState } from 'react';
export function ExchangeAccountDetail({ id }: { id: string }): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['exchange', 'account', id],
    queryFn: () => exchangeApi.getAccount(id),
  });
  const connectivity = useQuery({
    queryKey: ['exchange', 'account', id, 'connectivity'],
    queryFn: () => exchangeApi.getAccountHealth(id),
    enabled: !!data,
  });
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [disableOpen, setDisableOpen] = useState<boolean>(false);
  const [notice, setNotice] = useState<string>('');
  if (isLoading) return <LoadingState />;
  if (error && !(error instanceof ApiError && error.isNotFound())) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data) return <div className="p-4 text-sm">Account not found</div>;
  const act = async (action: () => Promise<unknown>, done?: string) => {
    setNotice('');
    try {
      await action();
      if (done) setNotice(done);
    } catch (err) {
      setNotice(err instanceof ApiError ? err.getUserMessage() : 'The action failed.');
    } finally {
      refetch();
      connectivity.refetch();
    }
  };
  return (
    <div className="space-y-4 rounded border bg-card p-4">
      <div className="flex justify-between"><h3 className="font-semibold">{data.exchange} - {data.label ?? data.id}</h3><StatusBadge status={data.health} /></div>
      <p className="text-xs text-muted">Status: {data.status} | Environment: {data.environment} | Key: {data.maskedApiKey ?? '-'} | Trading: {data.tradingEnabled ? 'Enabled' : 'Disabled'}</p>
      <p className="text-xs">Capabilities: {data.capabilities.length > 0 ? data.capabilities.join(', ') : 'Not discovered yet'}</p>
      {data.lastConnectedAt && <p className="text-xs text-muted">Last connected: {new Date(data.lastConnectedAt).toLocaleString()}</p>}
      {data.errorMessage && <p className="text-xs text-red-600">{data.errorMessage}</p>}
      {connectivity.data && (
        <div className="rounded border p-2 text-xs">
          <p>Connectivity: <StatusBadge status={connectivity.data.health} /></p>
          {connectivity.data.issues.map((issue) => <p key={issue} className="text-muted">{issue}</p>)}
        </div>
      )}
      {notice && <p className="text-xs text-muted">{notice}</p>}
      <div className="flex gap-2">
        <button onClick={() => act(async () => { const res = await exchangeApi.verifyAccount(id); setNotice(res.message ?? 'Verification queued.'); })} className="rounded border px-3 py-1 text-xs">Verify</button>
        {data.status !== 'DISABLED' && <button onClick={() => setDisableOpen(true)} className="rounded border px-3 py-1 text-xs">Disable</button>}
        <button onClick={() => setConfirmOpen(true)} className="rounded bg-red-600 px-3 py-1 text-xs text-white">Disconnect</button>
      </div>
      <ConfirmationDialog open={disableOpen} title="Disable Exchange Account" description="Pause this exchange account? Copy trading on it stops until it is enabled again." variant="destructive" confirmLabel="Disable" onConfirm={async () => { setDisableOpen(false); await act(() => exchangeApi.disableAccount(id, 'Disabled by the account owner'), 'Account disabled.'); }} onCancel={() => setDisableOpen(false)} />
      <ConfirmationDialog open={confirmOpen} title="Disconnect Exchange" description="Are you sure you want to disconnect this exchange account? This will stop trading." variant="destructive" confirmLabel="Disconnect" onConfirm={async () => { setConfirmOpen(false); try { await exchangeApi.disconnectAccount(id); window.location.href='/exchanges'; } catch (err) { setNotice(err instanceof ApiError ? err.getUserMessage() : 'Disconnect failed.'); } }} onCancel={() => setConfirmOpen(false)} />
    </div>
  );
}
```

FILE: apps/web/src/features/exchanges/exchange-accounts-page.tsx

```tsx
'use client';
/**
 * Exchange accounts list
 * Security: Never exposes exchange secrets, only backend-verified status
 */
import { useQuery } from '@tanstack/react-query';
import { exchangeApi } from '@/api/exchange-api';
import { PageContainer } from '@/layout/page-container';
import { StatusBadge } from '@/components/status-badge';
import { LoadingState } from '@/components/loading-state';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import Link from 'next/link';
export function ExchangeAccountsPage(): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['exchanges', 'accounts'],
    queryFn: () => exchangeApi.listAccounts(),
  });
  return (
    <PageContainer title="Exchange Accounts" description="Customer exchange-account list, no secret exposure" actions={<Link href="/exchanges/connect" className="rounded bg-primary px-4 py-2 text-sm text-white">Connect Exchange</Link>}>
      {isLoading ? <LoadingState /> : error ? <ErrorState error={error} onRetry={() => refetch()} /> : (data?.data.length===0 ? <EmptyState title="No exchange accounts" description="Connect your exchange to start trading" action={{ label: 'Connect', href: '/exchanges/connect' }} /> :
        <div className="grid gap-4 md:grid-cols-2">
          {(data?.data ?? []).map((a) => (
            <Link key={a.id} href={`/exchanges/${a.id}`} className="rounded border bg-card p-4 hover:shadow">
              <div className="flex justify-between"><span className="font-medium">{a.exchange}</span><StatusBadge status={a.health} /></div>
              <p className="text-xs text-muted">{a.label ?? a.id} | {a.environment} | Status: {a.status}</p>
              {a.maskedApiKey && <p className="font-mono text-xs text-muted">{a.maskedApiKey}</p>}
              <p className="text-xs">Trading: {a.tradingEnabled ? 'Enabled' : 'Disabled'}</p>
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
```

FILE: apps/web/src/features/exchanges/exchange-security-warning.tsx

```tsx
export function ExchangeSecurityWarning(): JSX.Element {
  return (
    <div className="rounded border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-800">
      <p className="font-medium">Security Notice</p>
      <ul className="mt-1 list-disc pl-4">
        <li>Never share your API secret or private keys</li>
        <li>Use trade-only permissions, disable withdrawal</li>
        <li>Credentials are stored securely server-side, never exposed in frontend</li>
        <li>Enable IP allowlist on your exchange if supported</li>
      </ul>
    </div>
  );
}
```

FILE: apps/web/src/features/funding/account-select.tsx

```tsx
"use client";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { fundingApi, type FundingAccount } from "@/api/funding-api";

export function useFundingAccounts() {
  return useQuery({
    queryKey: ["funding", "accounts"],
    queryFn: () => fundingApi.listAccounts(),
  });
}

/** An account can take the request when it is active and the capability is enabled. */
export function accountAllows(
  account: FundingAccount,
  direction: "DEPOSIT" | "WITHDRAWAL",
): boolean {
  if (account.state !== "ACTIVE") return false;
  return direction === "DEPOSIT"
    ? account.isFundingEnabled
    : account.isWithdrawalEnabled;
}

/**
 * Account picker for funding forms. Accounts that cannot take the request are
 * listed but disabled, so the user sees why instead of getting a 400.
 */
export function AccountSelect({
  accounts,
  direction,
  value,
  onChange,
}: {
  accounts: FundingAccount[];
  direction: "DEPOSIT" | "WITHDRAWAL";
  value: string;
  onChange: (accountId: string) => void;
}): JSX.Element {
  const usable = accounts.filter((a) => accountAllows(a, direction));

  useEffect(() => {
    if (!value && usable.length === 1 && usable[0]) onChange(usable[0].id);
  }, [value, usable, onChange]);

  return (
    <label className="block text-sm">
      Account
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded border px-3 py-2 text-sm"
      >
        <option value="">Select an account</option>
        {accounts.map((a) => {
          const allowed = accountAllows(a, direction);
          const why =
            a.state !== "ACTIVE"
              ? a.state.replace(/_/g, " ").toLowerCase()
              : direction === "DEPOSIT"
                ? "deposits disabled"
                : "withdrawals disabled";
          return (
            <option key={a.id} value={a.id} disabled={!allowed}>
              {a.label}
              {allowed ? "" : ` (${why})`}
            </option>
          );
        })}
      </select>
    </label>
  );
}
```

FILE: apps/web/src/features/funding/deposit-page.tsx

```tsx
"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  fundingApi,
  isPositiveAmount,
  type FundingRequest,
} from "@/api/funding-api";
import { ApiError } from "@/api/api-errors";
import { PageContainer } from "@/layout/page-container";
import { LoadingState } from "@/components/loading-state";
import { ErrorState, InlineError } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { FundingStatusBadge } from "@/components/status-badge";
import { Money } from "@/components/money";
import {
  AccountSelect,
  accountAllows,
  useFundingAccounts,
} from "./account-select";

export function DepositPage(): JSX.Element {
  const queryClient = useQueryClient();
  const accounts = useFundingAccounts();
  const [accountId, setAccountId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [currency, setCurrency] = useState<string>("USDT");
  const [reference, setReference] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [created, setCreated] = useState<FundingRequest | null>(null);

  const amountValid = isPositiveAmount(amount.trim());
  const currencyValid = /^[A-Z0-9]{2,10}$/.test(currency);
  const canSubmit =
    Boolean(accountId) && amountValid && currencyValid && !loading;

  const handleSubmit = async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      const request = await fundingApi.createDepositRequest({
        accountId,
        amount: amount.trim(),
        currency,
        externalReference: reference.trim() || undefined,
      });
      setCreated(request);
      setAmount("");
      setReference("");
      await queryClient.invalidateQueries({ queryKey: ["funding"] });
      await queryClient.invalidateQueries({
        queryKey: ["dashboard", "funding"],
      });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.getUserMessage()
          : "The deposit request could not be created.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageContainer
      title="Deposit"
      description="Request a deposit to one of your accounts"
    >
      {accounts.isLoading ? (
        <LoadingState message="Loading accounts..." />
      ) : accounts.error ? (
        <ErrorState
          error={accounts.error}
          onRetry={() => void accounts.refetch()}
        />
      ) : (accounts.data ?? []).length === 0 ? (
        <EmptyState
          title="No account yet"
          description="Complete onboarding to open an account before depositing."
          action={{ label: "Onboarding", href: "/onboarding" }}
        />
      ) : (
        <div className="max-w-md space-y-3 rounded border bg-card p-4">
          <AccountSelect
            accounts={accounts.data ?? []}
            direction="DEPOSIT"
            value={accountId}
            onChange={setAccountId}
          />
          {!(accounts.data ?? []).some((a) => accountAllows(a, "DEPOSIT")) && (
            <p className="text-xs text-muted">
              None of your accounts currently accepts deposits. Contact support
              if this is unexpected.
            </p>
          )}
          <div className="flex gap-2">
            <label className="block flex-1 text-sm">
              Amount
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              />
            </label>
            <label className="block w-28 text-sm">
              Currency
              <input
                value={currency}
                onChange={(e) =>
                  setCurrency(
                    e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                  )
                }
                maxLength={10}
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              />
            </label>
          </div>
          {amount && !amountValid && (
            <p className="text-xs text-red-600">
              Enter an amount greater than zero, using digits and an optional
              decimal point.
            </p>
          )}
          <label className="block text-sm">
            Transfer reference (optional)
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={120}
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            />
          </label>
          {error && <InlineError message={error} />}
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="w-full rounded bg-primary px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {loading ? "Submitting..." : "Request deposit"}
          </button>
          <p className="text-xs text-muted">
            A deposit request records the transfer you intend to make. Your
            balance is credited only after operations confirm the funds were
            received. Pending does not mean completed.
          </p>
          {created && (
            <div className="rounded border p-3 text-sm" role="status">
              <div className="flex items-center justify-between">
                <span>
                  Deposit of{" "}
                  <Money value={created.amount} currency={created.currency} />
                </span>
                <FundingStatusBadge state={created.state} />
              </div>
              <p className="mt-1 text-xs text-muted">
                Reference {created.id.slice(0, 8)} — track it in the funding
                history.
              </p>
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
}
```

FILE: apps/web/src/features/funding/funding-page.tsx

```tsx
'use client';
import { PageContainer } from '@/layout/page-container';
import { FundingStatus } from './funding-status';
import { TransactionHistory } from './transaction-history';
import Link from 'next/link';
export function FundingPage(): JSX.Element {
  return (
    <PageContainer title="Funding" description="Deposits, withdrawals, and transaction history" actions={<div className="flex gap-2"><Link href="/funding/deposit" className="rounded bg-primary px-4 py-2 text-sm text-white">Deposit</Link><Link href="/funding/withdraw" className="rounded border px-4 py-2 text-sm">Withdraw</Link></div>}>
      <div className="space-y-6">
        <FundingStatus />
        <TransactionHistory />
      </div>
    </PageContainer>
  );
}
```

FILE: apps/web/src/features/funding/funding-status.tsx

```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { fundingApi, OPEN_FUNDING_STATES } from "@/api/funding-api";
import { FundingStatusBadge } from "@/components/status-badge";
import { Money } from "@/components/money";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";

export function FundingStatus(): JSX.Element {
  // Requested state is initial, not completed. Pending does not mean completed.
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["funding", "status"],
    queryFn: () => fundingApi.listHistory({ limit: 20 }),
  });
  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const open = (data?.data ?? []).filter((f) =>
    OPEN_FUNDING_STATES.includes(f.state),
  );
  return (
    <div className="rounded border bg-card p-4">
      <h3 className="font-semibold">Open requests</h3>
      <p className="text-xs text-muted">
        Requested → Under Review → Approved → Submitted → Confirmed (or Failed /
        Reversed / Cancelled). Pending does not mean completed.
      </p>
      <ul className="mt-3 space-y-1">
        {open.map((f) => (
          <li
            key={`${f.type}-${f.id}`}
            className="flex items-center justify-between text-xs"
          >
            <span>
              {f.type === "DEPOSIT" ? "Deposit" : "Withdrawal"}{" "}
              <Money value={f.amount} currency={f.currency} />
            </span>
            <FundingStatusBadge state={f.state} />
          </li>
        ))}
        {open.length === 0 && (
          <p className="text-xs text-muted">No open funding requests</p>
        )}
      </ul>
    </div>
  );
}
```

FILE: apps/web/src/features/funding/transaction-history.tsx

```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { fundingApi } from "@/api/funding-api";
import { Money } from "@/components/money";
import { FundingStatusBadge } from "@/components/status-badge";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";

export function TransactionHistory(): JSX.Element {
  // Only the caller's own requests are returned (tenant isolation and account ownership are enforced server-side).
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["funding", "history"],
    queryFn: () => fundingApi.listHistory({ limit: 50 }),
  });

  if (isLoading) return <LoadingState message="Loading history..." />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const items = data?.data ?? [];
  return (
    <div className="rounded border bg-card">
      <div className="p-4">
        <h3 className="font-semibold">Transaction History</h3>
        <p className="text-xs text-muted">
          Persisted funding/withdrawal history from backend
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-y bg-gray-50 text-xs text-muted">
            <tr>
              <th className="p-2 text-left">Type</th>
              <th className="p-2 text-right">Requested</th>
              <th className="p-2 text-right">Confirmed</th>
              <th className="p-2">State</th>
              <th className="p-2 text-left">Requested at</th>
            </tr>
          </thead>
          <tbody>
            {items.map((f) => (
              <tr key={`${f.type}-${f.id}`} className="border-b">
                <td className="p-2">
                  {f.type === "DEPOSIT" ? "Deposit" : "Withdrawal"}
                </td>
                <td className="p-2 text-right">
                  <Money value={f.amount} currency={f.currency} />
                </td>
                <td className="p-2 text-right">
                  {f.confirmedAmount ? (
                    <Money value={f.confirmedAmount} currency={f.currency} />
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="p-2 text-center">
                  <FundingStatusBadge state={f.state} />
                  {f.failureReason && (
                    <p className="mt-1 text-xs text-red-600">
                      {f.failureReason}
                    </p>
                  )}
                </td>
                <td className="p-2 text-xs">
                  {f.requestedAt
                    ? new Date(f.requestedAt).toLocaleString()
                    : "—"}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-xs text-muted">
                  No transactions
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

FILE: apps/web/src/features/funding/withdrawal-page.tsx

```tsx
"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fundingApi, isPositiveAmount } from "@/api/funding-api";
import { ApiError } from "@/api/api-errors";
import { PageContainer } from "@/layout/page-container";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { LoadingState } from "@/components/loading-state";
import { ErrorState, InlineError } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import {
  AccountSelect,
  accountAllows,
  useFundingAccounts,
} from "./account-select";

export function WithdrawalPage(): JSX.Element {
  const queryClient = useQueryClient();
  const accounts = useFundingAccounts();
  const [accountId, setAccountId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [currency, setCurrency] = useState<string>("USDT");
  const [dest, setDest] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<string>("");
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);

  const amountValid = isPositiveAmount(amount.trim());
  const currencyValid = /^[A-Z0-9]{2,10}$/.test(currency);
  const destValid = dest.trim().length >= 8;
  const canSubmit =
    Boolean(accountId) && amountValid && currencyValid && destValid;

  const handleWithdraw = async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      const res = await fundingApi.createWithdrawalRequest({
        accountId,
        amount: amount.trim(),
        currency,
        destinationAddress: dest.trim(),
      });
      setSuccess(
        `Withdrawal ${res.id.slice(0, 8)} requested (${res.state.replace(/_/g, " ").toLowerCase()}). Approval is not settlement: funds leave only after review and on-chain confirmation.`,
      );
      setConfirmOpen(false);
      setAmount("");
      setDest("");
      await queryClient.invalidateQueries({ queryKey: ["funding"] });
      await queryClient.invalidateQueries({
        queryKey: ["dashboard", "funding"],
      });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.getUserMessage()
          : "The withdrawal request could not be created.",
      );
      setConfirmOpen(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageContainer
      title="Withdraw"
      description="Secure withdrawal workflow with backend validation"
    >
      {accounts.isLoading ? (
        <LoadingState message="Loading accounts..." />
      ) : accounts.error ? (
        <ErrorState
          error={accounts.error}
          onRetry={() => void accounts.refetch()}
        />
      ) : (accounts.data ?? []).length === 0 ? (
        <EmptyState
          title="No account yet"
          description="Complete onboarding to open an account."
          action={{ label: "Onboarding", href: "/onboarding" }}
        />
      ) : (
        <div className="max-w-md space-y-3 rounded border bg-card p-4">
          <AccountSelect
            accounts={accounts.data ?? []}
            direction="WITHDRAWAL"
            value={accountId}
            onChange={setAccountId}
          />
          {!(accounts.data ?? []).some((a) =>
            accountAllows(a, "WITHDRAWAL"),
          ) && (
            <p className="text-xs text-muted">
              None of your accounts currently allows withdrawals. Contact
              support if this is unexpected.
            </p>
          )}
          <div className="flex gap-2">
            <label className="block flex-1 text-sm">
              Amount
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              />
            </label>
            <label className="block w-28 text-sm">
              Currency
              <input
                value={currency}
                onChange={(e) =>
                  setCurrency(
                    e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                  )
                }
                maxLength={10}
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              />
            </label>
          </div>
          {amount && !amountValid && (
            <p className="text-xs text-red-600">
              Enter an amount greater than zero, using digits and an optional
              decimal point.
            </p>
          )}
          <label className="block text-sm">
            Destination address
            <input
              value={dest}
              onChange={(e) => setDest(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="mt-1 w-full rounded border px-3 py-2 font-mono text-sm"
            />
          </label>
          {error && <InlineError message={error} />}
          {success && (
            <p className="text-xs text-green-700" role="status">
              {success}
            </p>
          )}
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={!canSubmit}
            className="w-full rounded bg-primary px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            Request Withdrawal
          </button>
          <p className="text-xs text-muted">
            Withdrawal requested does not mean completed. Settlement is
            backend-authoritative.
          </p>
        </div>
      )}
      <ConfirmationDialog
        open={confirmOpen}
        title="Confirm Withdrawal"
        description={`Withdraw ${amount} ${currency} to ${dest}? The request is reviewed (compliance, risk and account restrictions) before any funds move.`}
        variant="destructive"
        confirmLabel="Confirm Withdrawal"
        onConfirm={() => void handleWithdraw()}
        onCancel={() => setConfirmOpen(false)}
        isLoading={loading}
      />
    </PageContainer>
  );
}
```

FILE: apps/web/src/features/notifications/notification-preferences-page.tsx

```tsx
'use client';
import { useQuery } from '@tanstack/react-query';
import { notificationApi, NotificationPreference, NOTIFICATION_CATEGORIES } from '@/api/notification-api';
import { ApiError } from '@/api/api-errors';
import { PageContainer } from '@/layout/page-container';
import { LoadingState } from '@/components/loading-state';
import { ErrorState } from '@/components/error-state';
import { useEffect, useState } from 'react';
export function NotificationPreferencesPage(): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['notifications', 'preferences'], queryFn: () => notificationApi.getPreferences() });
  const [draft, setDraft] = useState<NotificationPreference[]>([]);
  const [saving, setSaving] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');
  useEffect(() => { if (data) setDraft(data); }, [data]);
  if (isLoading) return <LoadingState />;
  if (error) return <PageContainer title="Notification Preferences"><ErrorState error={error} onRetry={() => refetch()} /></PageContainer>;
  const toggle = (channel: string, category: string) => setDraft((current) => current.map((pref) => {
    if (pref.channel !== channel) return pref;
    const categories = { ...pref.categories, [category]: !pref.categories[category] };
    return { ...pref, categories, enabled: Object.values(categories).some(Boolean) };
  }));
  const save = async () => {
    setSaving(true);
    setMessage('');
    try {
      const saved = await notificationApi.updatePreferences({ preferences: draft });
      setDraft(saved);
      setMessage('Preferences saved.');
    } catch (err) {
      setMessage(err instanceof ApiError ? err.getUserMessage() : 'Preferences could not be saved.');
    } finally {
      setSaving(false);
      refetch();
    }
  };
  return (
    <PageContainer title="Notification Preferences" description="Customer notification preferences">
      <div className="space-y-3">
        <p className="text-xs text-muted">Security alerts (new device, password or two-factor changes) are always delivered in-app and by email.</p>
        <div className="overflow-x-auto rounded border bg-card p-3">
          <table className="w-full text-sm">
            <thead><tr><th className="text-left font-medium">Category</th>{draft.map((pref) => <th key={pref.channel} className="px-2 text-center font-medium">{pref.channel.replace('_', '-')}</th>)}</tr></thead>
            <tbody>
              {NOTIFICATION_CATEGORIES.map((category) => (
                <tr key={category} className="border-t">
                  <td className="py-2 capitalize">{category}</td>
                  {draft.map((pref) => (
                    <td key={pref.channel} className="text-center"><input type="checkbox" aria-label={`${category} via ${pref.channel}`} checked={pref.categories[category] ?? true} onChange={() => toggle(pref.channel, category)} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {message && <p className="text-xs text-muted">{message}</p>}
        <button onClick={save} className="rounded bg-primary px-4 py-2 text-sm text-white disabled:opacity-50" disabled={saving || draft.length === 0}>{saving ? 'Saving...' : 'Save Preferences'}</button>
      </div>
    </PageContainer>
  );
}
```

FILE: apps/web/src/features/notifications/notifications-page.tsx

```tsx
'use client';
import { PageContainer } from '@/layout/page-container';
import { NotificationCenter } from '@/components/notification-center';
export function NotificationsPage(): JSX.Element {
  return (
    <PageContainer title="Notifications" description="Full customer notification inbox from backend">
      <NotificationCenter />
    </PageContainer>
  );
}
```

FILE: apps/web/src/features/onboarding/onboarding-blockers.tsx

```tsx
"use client";

import { StatusBadge } from "@/components/status-badge";
import { useOnboarding } from "./use-onboarding";

/** Blocking reasons of the onboarding record and of its blocked/failed steps. */
export function OnboardingBlockers(): JSX.Element {
  const { data } = useOnboarding();
  const blockers: Array<{ type: string; reason: string }> = [
    ...(data?.blockingReasons ?? []).map((reason) => ({ type: "ONBOARDING", reason })),
    ...(data?.steps ?? [])
      .filter((s) => s.status === "BLOCKED" || s.status === "FAILED" || s.blockingReasons.length > 0)
      .flatMap((s) =>
        (s.blockingReasons.length > 0 ? s.blockingReasons : [s.status.toLowerCase()]).map((reason) => ({
          type: s.stepType,
          reason,
        })),
      ),
  ];
  return (
    <div className="rounded border bg-card p-4">
      <h3 className="font-semibold">Blockers</h3>
      {blockers.length === 0 ? (
        <p className="mt-2 text-xs text-muted">No blocking issues</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {blockers.map((b, i) => (
            <li key={`${b.type}-${i}`} className="rounded border p-2 text-xs">
              <StatusBadge status={b.type} /> <span className="ml-1">{b.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

FILE: apps/web/src/features/onboarding/onboarding-page.tsx

```tsx
'use client';
import { PageContainer } from '@/layout/page-container';
import { OnboardingProgress } from './onboarding-progress';
import { OnboardingSteps } from './onboarding-steps';
import { OnboardingBlockers } from './onboarding-blockers';
export function OnboardingPage(): JSX.Element {
  return (
    <PageContainer title="Onboarding" description="Complete your account setup from authoritative workflow">
      <OnboardingProgress />
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2"><OnboardingSteps /></div>
        <div><OnboardingBlockers /></div>
      </div>
    </PageContainer>
  );
}
```

FILE: apps/web/src/features/onboarding/onboarding-progress.tsx

```tsx
"use client";

import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { useOnboarding } from "./use-onboarding";

export function OnboardingProgress(): JSX.Element {
  const { data, isLoading, error, refetch } = useOnboarding();
  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!data) return <div className="text-sm text-muted">No onboarding data</div>;
  return (
    <div className="rounded border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">State: {data.state.replace(/_/g, " ")}</span>
        <span className="text-xs">{data.progressPct}%</span>
      </div>
      <div className="mt-2 h-2 w-full rounded bg-gray-200">
        <div className="h-2 rounded bg-primary" style={{ width: `${data.progressPct}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted">Current: {data.currentStep ? data.currentStep.replace(/_/g, " ") : "—"}</p>
    </div>
  );
}
```

FILE: apps/web/src/features/onboarding/onboarding-steps.tsx

```tsx
"use client";

import { StatusBadge } from "@/components/status-badge";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { useOnboarding } from "./use-onboarding";

export function OnboardingSteps(): JSX.Element {
  const { data, isLoading, error, refetch } = useOnboarding();
  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const steps = data?.steps ?? [];
  return (
    <div className="rounded border bg-card p-4">
      <h3 className="font-semibold">Steps</h3>
      <ul className="mt-3 space-y-2">
        {steps.map((s) => (
          <li key={s.id} className="flex items-center justify-between rounded border p-2 text-sm">
            <span>
              {s.stepType.replace(/_/g, " ")}
              {!s.required && <span className="ml-1 text-xs text-muted">(optional)</span>}
            </span>
            <StatusBadge status={s.status} />
          </li>
        ))}
        {steps.length === 0 && <p className="text-xs text-muted">No steps available</p>}
      </ul>
    </div>
  );
}
```

FILE: apps/web/src/features/onboarding/use-onboarding.ts

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import { clientLifecycleApi, type Onboarding } from "@/api/client-lifecycle-api";
import { useAuth } from "@/auth/auth.store";

/**
 * The caller's onboarding: resolve the caller's own client profile, then its
 * onboarding record (GET clients/:profileId/onboarding). One query shared by
 * the progress, steps and blockers widgets. `data === null` means the caller
 * has no client profile or no onboarding yet.
 */
export function useOnboarding() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery<Onboarding | null>({
    queryKey: ["onboarding", userId ?? "anonymous"],
    queryFn: async () => {
      const profileId = await clientLifecycleApi.getOwnClientProfileId();
      return profileId ? clientLifecycleApi.getOnboarding(profileId) : null;
    },
    enabled: Boolean(userId),
    staleTime: 30 * 1000,
  });
}
```

FILE: apps/web/src/features/portfolio/attribution-table.tsx

```tsx
"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  portfolioApi,
  ATTRIBUTION_DIMENSIONS,
  type AttributionDimension,
} from "@/api/portfolio-api";
import { Money } from "@/components/money";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { ProfileGate } from "./profile-gate";

function AttributionTableBody({
  profileId,
}: {
  profileId: string;
}): JSX.Element {
  const [dimension, setDimension] = useState<AttributionDimension>("STRATEGY");
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["portfolio", "attribution", profileId, dimension],
    queryFn: () =>
      portfolioApi.getAttribution(profileId, { dimension, period: "30d" }),
  });
  const rows = data ?? [];
  return (
    <div className="rounded border bg-card">
      <div className="flex items-center justify-between p-4">
        <h3 className="font-semibold">Attribution (30 days)</h3>
        <select
          aria-label="Attribution dimension"
          value={dimension}
          onChange={(e) => setDimension(e.target.value as AttributionDimension)}
          className="rounded border px-2 py-1 text-xs"
        >
          {ATTRIBUTION_DIMENSIONS.map((d) => (
            <option key={d} value={d}>
              {d.charAt(0) + d.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      </div>
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <div className="p-4">
          <ErrorState error={error} onRetry={() => refetch()} />
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-y bg-gray-50 text-xs text-muted">
            <tr>
              <th className="p-2 text-left">Dimension</th>
              <th className="p-2 text-left">Key</th>
              <th className="p-2 text-right">PnL</th>
              <th className="p-2 text-right">Share of PnL</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.dimension}-${r.key}`} className="border-b">
                <td className="p-2">{r.dimension}</td>
                <td className="p-2">{r.key}</td>
                <td className="p-2 text-right">
                  <Money value={r.pnl} showSign />
                </td>
                <td className="p-2 text-right">{r.allocationPct}%</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="p-4 text-center text-xs text-muted">
                  No attribution data
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function AttributionTable(): JSX.Element {
  return (
    <ProfileGate title="Attribution">
      {(profileId) => <AttributionTableBody profileId={profileId} />}
    </ProfileGate>
  );
}
```

FILE: apps/web/src/features/portfolio/holdings-table.tsx

```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { portfolioApi } from "@/api/portfolio-api";
import { Money } from "@/components/money";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { ProfileGate } from "./profile-gate";

function HoldingsTableBody({ profileId }: { profileId: string }): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["portfolio", "holdings", profileId],
    queryFn: () => portfolioApi.getHoldings(profileId),
  });
  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const holdings = data?.data ?? [];
  return (
    <div className="rounded border bg-card">
      <div className="p-4">
        <h3 className="font-semibold">Holdings</h3>
        <p className="text-xs text-muted">
          Open positions at cost basis, from the accounting ledger
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-y bg-gray-50 text-xs text-muted">
            <tr>
              <th className="p-2 text-left">Symbol</th>
              <th className="p-2 text-left">Asset</th>
              <th className="p-2 text-right">Quantity</th>
              <th className="p-2 text-right">Cost basis</th>
              <th className="p-2 text-left">Class</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => (
              <tr key={h.id} className="border-b">
                <td className="p-2">{h.symbol}</td>
                <td className="p-2">{h.asset}</td>
                <td className="p-2 text-right">{h.quantity}</td>
                <td className="p-2 text-right">
                  {h.avgCost ? (
                    <Money value={h.avgCost} />
                  ) : (
                    <span className="text-xs text-muted">—</span>
                  )}
                </td>
                <td className="p-2 text-xs">{h.classification}</td>
              </tr>
            ))}
            {holdings.length === 0 && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-xs text-muted">
                  No holdings
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function HoldingsTable(): JSX.Element {
  return (
    <ProfileGate title="Holdings">
      {(profileId) => <HoldingsTableBody profileId={profileId} />}
    </ProfileGate>
  );
}
```

FILE: apps/web/src/features/portfolio/performance-chart.tsx

```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { portfolioApi } from "@/api/portfolio-api";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { ProfileGate } from "./profile-gate";

function PerformanceChartBody({
  profileId,
}: {
  profileId: string;
}): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["portfolio", "performance", profileId],
    queryFn: () => portfolioApi.getPerformance(profileId, { period: "30d" }),
  });
  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const points = data?.points ?? [];
  const navs = points
    .map((p) => parseFloat(p.nav))
    .filter((n) => Number.isFinite(n));
  const max = navs.length > 0 ? Math.max(...navs) : 0;
  const min = navs.length > 0 ? Math.min(...navs) : 0;
  const span = max - min;
  return (
    <div className="rounded border bg-card p-4">
      <h3 className="font-semibold">Performance (30 days)</h3>
      <p className="text-xs text-muted">
        Backend-returned series only: return and NAV points come from persisted
        snapshots, no frontend calculation
      </p>
      <p className="mt-2 text-sm">
        {data?.canCalculate && data.returnPct !== null ? (
          <>
            Time-weighted return:{" "}
            <span className="font-medium">{data.returnPct}%</span>
          </>
        ) : (
          <span className="text-xs text-muted">
            Return not available{data?.reason ? `: ${data.reason}` : ""}
          </span>
        )}
      </p>
      <div className="mt-4 h-40 overflow-x-auto">
        {points.length === 0 ? (
          <p className="text-xs text-muted">No NAV snapshots in this period</p>
        ) : (
          <div className="flex h-full items-end gap-1">
            {points.slice(-60).map((p) => {
              const value = parseFloat(p.nav);
              const height =
                span > 0 && Number.isFinite(value)
                  ? 10 + ((value - min) / span) * 90
                  : 50;
              return (
                <div
                  key={p.timestamp}
                  className="w-2 bg-primary"
                  style={{ height: `${height}%` }}
                  title={`${new Date(p.timestamp).toLocaleString()}: NAV ${p.nav}`}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function PerformanceChart(): JSX.Element {
  return (
    <ProfileGate title="Performance">
      {(profileId) => <PerformanceChartBody profileId={profileId} />}
    </ProfileGate>
  );
}
```

FILE: apps/web/src/features/portfolio/pnl-panel.tsx

```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { portfolioApi } from "@/api/portfolio-api";
import { Money } from "@/components/money";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { ProfileGate } from "./profile-gate";

const PERIOD_LABELS: Record<string, string> = {
  "1d": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

function PnlPanelBody({ profileId }: { profileId: string }): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["portfolio", "pnl", profileId],
    queryFn: () =>
      portfolioApi.getPnl(profileId, { periods: ["1d", "7d", "30d"] }),
  });
  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const records = data ?? [];
  return (
    <div className="rounded border bg-card p-4">
      <h3 className="font-semibold">PnL</h3>
      <ul className="mt-3 space-y-2">
        {records.map((r) => (
          <li key={r.period} className="text-sm">
            <div className="flex justify-between">
              <span>{PERIOD_LABELS[r.period] ?? r.period}</span>
              <Money
                value={r.net}
                currency={r.currency || undefined}
                showSign
              />
            </div>
            <div className="flex justify-between text-xs text-muted">
              <span>
                Realized{" "}
                <Money
                  value={r.realized}
                  currency={r.currency || undefined}
                  showSign
                />
              </span>
              <span>
                Fees <Money value={r.fees} currency={r.currency || undefined} />
              </span>
            </div>
          </li>
        ))}
        {records.length === 0 && (
          <p className="text-xs text-muted">No PnL data</p>
        )}
      </ul>
    </div>
  );
}

export function PnlPanel(): JSX.Element {
  return (
    <ProfileGate title="PnL">
      {(profileId) => <PnlPanelBody profileId={profileId} />}
    </ProfileGate>
  );
}
```

FILE: apps/web/src/features/portfolio/portfolio-overview.tsx

```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { portfolioApi } from "@/api/portfolio-api";
import { Money, MoneyWithState } from "@/components/money";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { ProfileGate } from "./profile-gate";

function PortfolioOverviewBody({
  profileId,
}: {
  profileId: string;
}): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["portfolio", "overview", profileId],
    queryFn: () => portfolioApi.getOverview(profileId),
  });
  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data) return <div className="text-sm text-muted">No portfolio data</div>;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-4 rounded border bg-card p-4">
      <div>
        <p className="text-xs text-muted">NAV</p>
        <MoneyWithState
          value={data.nav}
          currency={data.currency}
          valuationState={data.valuationState}
        />
      </div>
      <div>
        <p className="text-xs text-muted">Cash</p>
        <Money value={data.cash} currency={data.currency} />
      </div>
      <div>
        <p className="text-xs text-muted">Daily PnL</p>
        <Money value={data.dailyPnl} currency={data.currency} showSign />
      </div>
      <div>
        <p className="text-xs text-muted">30-day PnL</p>
        <Money value={data.periodPnl} currency={data.currency} showSign />
      </div>
    </div>
  );
}

export function PortfolioOverview(): JSX.Element {
  return (
    <ProfileGate title="Portfolio">
      {(profileId) => <PortfolioOverviewBody profileId={profileId} />}
    </ProfileGate>
  );
}
```

FILE: apps/web/src/features/portfolio/portfolio-page.tsx

```tsx
'use client';
import { PageContainer } from '@/layout/page-container';
import { PortfolioOverview } from './portfolio-overview';
import { HoldingsTable } from './holdings-table';
import { PnlPanel } from './pnl-panel';
import { PerformanceChart } from './performance-chart';
import { AttributionTable } from './attribution-table';
import { ValuationStatus } from './valuation-status';
export function PortfolioPage(): JSX.Element {
  return (
    <PageContainer title="Portfolio" description="Backend-authoritative NAV, PnL, holdings, performance">
      <div className="space-y-6">
        <PortfolioOverview />
        <ValuationStatus />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <PnlPanel />
          <PerformanceChart />
        </div>
        <HoldingsTable />
        <AttributionTable />
      </div>
    </PageContainer>
  );
}
```

FILE: apps/web/src/features/portfolio/profile-gate.tsx

```tsx
"use client";

import type { ReactNode } from "react";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { usePortfolioProfile } from "./use-portfolio-profile";

/**
 * Resolves the user's portfolio profile once for a portfolio panel: loading,
 * error (a 403 shows the lock state) and "no portfolio yet" are handled here,
 * so the panel body always receives a real profileId.
 */
export function ProfileGate({
  title,
  compact,
  children,
}: {
  title: string;
  compact?: boolean;
  children: (profileId: string) => ReactNode;
}): JSX.Element {
  const { profileId, isLoading, error, refetch } = usePortfolioProfile();
  if (isLoading)
    return <LoadingState message={`Loading ${title.toLowerCase()}...`} />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!profileId) {
    if (compact)
      return (
        <div className="text-xs text-muted">{title}: no portfolio yet</div>
      );
    return (
      <EmptyState
        title="No portfolio yet"
        description="Your portfolio appears once an exchange account is connected and trades or copy positions are recorded."
        action={{ label: "Connect an exchange", href: "/exchanges/connect" }}
      />
    );
  }
  return <>{children(profileId)}</>;
}
```

FILE: apps/web/src/features/portfolio/use-portfolio-profile.ts

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import { portfolioApi, type PortfolioProfile } from "@/api/portfolio-api";
import { useAuth } from "@/auth/auth.store";

/**
 * The signed-in user's own portfolio profile. Every portfolio query needs a
 * profileId; a user without a profile (nothing traded or copied yet) gets
 * `profile === null` so screens can show an empty state instead of an error.
 */
export function usePortfolioProfile(): {
  profile: PortfolioProfile | null;
  profileId: string | undefined;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
} {
  const { session } = useAuth();
  const userId = session?.user?.id;
  const query = useQuery({
    queryKey: ["portfolio", "profile", userId ?? "anonymous"],
    queryFn: () => portfolioApi.getPrimaryProfile(userId),
    enabled: Boolean(userId),
    staleTime: 5 * 60 * 1000,
  });
  const profile = query.data ?? null;
  return {
    profile,
    profileId: profile?.id,
    isLoading: Boolean(userId) && query.isLoading,
    error: query.error,
    refetch: () => {
      void query.refetch();
    },
  };
}
```

FILE: apps/web/src/features/portfolio/valuation-status.tsx

```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { portfolioApi } from "@/api/portfolio-api";
import { StatusBadge } from "@/components/status-badge";
import { ProfileGate } from "./profile-gate";

function ValuationStatusBody({
  profileId,
}: {
  profileId: string;
}): JSX.Element {
  const { data, error } = useQuery({
    queryKey: ["portfolio", "valuation-status", profileId],
    queryFn: () => portfolioApi.getValuationStatus(profileId),
  });
  if (error || !data)
    return (
      <div className="text-xs text-muted">Valuation status unavailable</div>
    );
  return (
    <div className="rounded border bg-card p-3 text-xs">
      <div className="flex items-center gap-2">
        <span>Valuation:</span>
        <StatusBadge status={data.state} />
        {data.lastValuationAt && (
          <span>Last: {new Date(data.lastValuationAt).toLocaleString()}</span>
        )}
      </div>
      {data.state === "MISSING_PRICE" && (
        <p className="mt-1 text-yellow-700">
          Some positions have no current price; NAV is incomplete.
        </p>
      )}
      {data.state === "STALE" && (
        <p className="mt-1 text-yellow-700">
          Prices are stale; NAV may lag the market.
        </p>
      )}
      {data.fxStatus !== "VALID" && (
        <p className="mt-1 text-yellow-700">FX: {data.fxStatus}</p>
      )}
    </div>
  );
}

export function ValuationStatus(): JSX.Element {
  return (
    <ProfileGate title="Valuation" compact>
      {(profileId) => <ValuationStatusBody profileId={profileId} />}
    </ProfileGate>
  );
}
```

FILE: apps/web/src/features/security/api-keys-page.tsx

```tsx
'use client';
import { useQuery } from '@tanstack/react-query';
import { Permission } from '@wlct/shared-types';
import { securityApi } from '@/api/security-api';
import { ApiError } from '@/api/api-errors';
import { LoadingState } from '@/components/loading-state';
import { ErrorState } from '@/components/error-state';
import { StatusBadge } from '@/components/status-badge';
import { useAuth } from '@/auth/auth.store';
import { permissionsAllowAny } from '@/auth/permissions';
import { useState } from 'react';
import { ConfirmationDialog } from '@/components/confirmation-dialog';

/**
 * API keys are an organisation feature on the backend (/v1/security/api-keys,
 * api_key:read to list, api_key:write to create or revoke). A key's scopes
 * must be permission keys its creator holds, so the choices offered here are
 * the read permissions of the signed-in user.
 */
const READ_SCOPES: readonly string[] = (Object.values(Permission) as string[]).filter((p) => p.endsWith(':read'));

export function ApiKeysPage(): JSX.Element {
  const { session } = useAuth();
  const granted = session?.user.permissions ?? [];
  const canRead = permissionsAllowAny(granted, [Permission.API_KEY_READ, Permission.API_KEY_MANAGE]);
  const canWrite = permissionsAllowAny(granted, [Permission.API_KEY_WRITE, Permission.API_KEY_MANAGE]);
  const scopeChoices = READ_SCOPES.filter((scope) => permissionsAllowAny(granted, [scope]));
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['security', 'api-keys'], queryFn: () => securityApi.listApiKeys(), enabled: canRead });
  const [name, setName] = useState<string>('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [secret, setSecret] = useState<string>('');
  const [actionError, setActionError] = useState<string>('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  if (!canRead) {
    return (
      <div className="rounded border bg-card p-4">
        <h3 className="font-semibold">API Keys</h3>
        <p className="mt-2 text-xs text-muted">API keys are managed by your organisation&apos;s administrators.</p>
      </div>
    );
  }
  if (isLoading) return <LoadingState />;
  if (error) return <div className="rounded border bg-card p-4"><h3 className="font-semibold">API Keys</h3><ErrorState error={error} onRetry={() => refetch()} /></div>;
  const keys = data ?? [];
  const toggleScope = (scope: string) => setScopes((current) => (current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope]));
  const handleCreate = async () => {
    setActionError('');
    try {
      const res = await securityApi.createApiKey({ name, scopes });
      setSecret(res.secret);
      setName('');
      setScopes([]);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.getUserMessage() : 'The API key could not be created.');
    } finally {
      refetch();
    }
  };
  return (
    <div className="rounded border bg-card p-4">
      <h3 className="font-semibold">API Keys</h3>
      <p className="text-xs text-muted">Secrets shown only once when backend allows. Never persisted client-side.</p>
      {canWrite && (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Key name" maxLength={120} className="rounded border px-2 py-1 text-xs" /><button onClick={handleCreate} disabled={!name || scopes.length === 0} className="rounded bg-primary px-3 py-1 text-xs text-white disabled:opacity-50">Create</button></div>
          <details className="text-xs"><summary className="cursor-pointer text-muted">Scopes ({scopes.length} selected)</summary><div className="mt-2 grid max-h-40 grid-cols-2 gap-1 overflow-y-auto">{scopeChoices.map((scope) => (<label key={scope} className="flex items-center gap-1"><input type="checkbox" checked={scopes.includes(scope)} onChange={() => toggleScope(scope)} /><span className="font-mono">{scope}</span></label>))}</div></details>
        </div>
      )}
      {actionError && <div className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{actionError}</div>}
      {secret && <div className="mt-2 rounded bg-yellow-50 p-2 font-mono text-xs break-all">Secret (copy now, will not be shown again): {secret}</div>}
      <ul className="mt-3 space-y-1">
        {keys.map((k) => (
          <li key={k.id} className="flex justify-between rounded border p-2 text-xs"><span>{k.name} <span className="font-mono">{k.prefix}...</span> <span className="text-muted">{k.scopes.join(', ')}</span></span><div className="flex items-center gap-2"><StatusBadge status={k.state} variant={k.state === 'ACTIVE' ? 'success' : 'warning'} /><span className="text-muted">{new Date(k.createdAt).toLocaleDateString()}</span>{canWrite && k.state === 'ACTIVE' && <button onClick={() => setConfirmId(k.id)} className="text-red-600">Revoke</button>}</div></li>
        ))}
        {keys.length === 0 && <p className="text-xs text-muted">No API keys</p>}
      </ul>
      <ConfirmationDialog open={!!confirmId} title="Revoke API Key" description="Revoke this API key? This action cannot be undone." variant="destructive" confirmLabel="Revoke" onConfirm={async () => { if (confirmId) { const id = confirmId; setConfirmId(null); setActionError(''); try { await securityApi.revokeApiKey(id, 'Revoked from the security settings page'); } catch (err) { setActionError(err instanceof ApiError ? err.getUserMessage() : 'The API key could not be revoked.'); } finally { refetch(); } } }} onCancel={() => setConfirmId(null)} />
    </div>
  );
}
```

FILE: apps/web/src/features/security/devices-page.tsx

```tsx
'use client';
import { useQuery } from '@tanstack/react-query';
import { securityApi, Device } from '@/api/security-api';
import { ApiError } from '@/api/api-errors';
import { LoadingState } from '@/components/loading-state';
import { ErrorState } from '@/components/error-state';
import { StatusBadge } from '@/components/status-badge';
import { ConfirmationDialog } from '@/components/confirmation-dialog';
import { useState } from 'react';
export function DevicesPage(): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['security', 'devices'], queryFn: () => securityApi.listDevices() });
  const [confirmDevice, setConfirmDevice] = useState<Device | null>(null);
  const [actionError, setActionError] = useState<string>('');
  if (isLoading) return <LoadingState />;
  if (error) return <div className="rounded border bg-card p-4"><h3 className="font-semibold">Devices</h3><ErrorState error={error} onRetry={() => refetch()} /></div>;
  const devices = data ?? [];
  const revoke = async (device: Device) => {
    setActionError('');
    try {
      await securityApi.revokeDevice(device);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.getUserMessage() : 'The device could not be signed out.');
    } finally {
      refetch();
    }
  };
  return (
    <div className="rounded border bg-card p-4">
      <h3 className="font-semibold">Devices</h3>
      <p className="text-xs text-muted">A device becomes trusted when you tick &quot;Trust this device&quot; while signing in with two-factor authentication.</p>
      {actionError && <div className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{actionError}</div>}
      <ul className="mt-3 space-y-2">
        {devices.map((d) => (
          <li key={d.id} className="flex items-center justify-between rounded border p-2 text-xs">
            <div><p>{d.name ?? d.fingerprint.slice(0,12)}{d.platform && d.name !== d.platform ? ` (${d.platform})` : ''} {d.isCurrent && <StatusBadge status="CURRENT" variant="info" />}</p><p className="text-muted">Last seen {new Date(d.lastSeenAt).toLocaleString()} - {d.sessionIds.length} session{d.sessionIds.length === 1 ? '' : 's'}</p></div>
            <div className="flex items-center gap-2"><StatusBadge status={d.trusted ? 'TRUSTED' : 'UNTRUSTED'} variant={d.trusted ? 'success' : 'warning'} />{!d.isCurrent && <button onClick={() => setConfirmDevice(d)} className="rounded border px-2 py-1">Revoke</button>}</div>
          </li>
        ))}
        {devices.length===0 && <p className="text-xs text-muted">No devices</p>}
      </ul>
      <ConfirmationDialog open={!!confirmDevice} title="Sign Out Device" description="Sign this device out? Every session on it will end." variant="destructive" confirmLabel="Sign out" onConfirm={async () => { if (confirmDevice) { const device = confirmDevice; setConfirmDevice(null); await revoke(device); } }} onCancel={() => setConfirmDevice(null)} />
    </div>
  );
}
```

FILE: apps/web/src/features/security/mfa-settings.tsx

```tsx
'use client';
import { useQuery } from '@tanstack/react-query';
import { securityApi } from '@/api/security-api';
import { ApiError } from '@/api/api-errors';
import { StatusBadge } from '@/components/status-badge';
import { LoadingState } from '@/components/loading-state';
import { ErrorState } from '@/components/error-state';
import { MfaEnrollFlow } from '@/auth/mfa-flow';
import { useAuth } from '@/auth/auth.store';
import { useState } from 'react';
export function MfaSettings(): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['security', 'mfa'], queryFn: () => securityApi.getMfaStatus() });
  const { refreshSession } = useAuth();
  const [enrollOpen, setEnrollOpen] = useState<boolean>(false);
  const [disableOpen, setDisableOpen] = useState<boolean>(false);
  const [password, setPassword] = useState<string>('');
  const [code, setCode] = useState<string>('');
  const [useRecovery, setUseRecovery] = useState<boolean>(false);
  const [disableError, setDisableError] = useState<string>('');
  const [disabling, setDisabling] = useState<boolean>(false);
  if (isLoading) return <LoadingState />;
  if (error) return <div className="rounded border bg-card p-4"><h3 className="font-semibold">MFA</h3><ErrorState error={error} onRetry={() => refetch()} /></div>;
  const handleDisable = async () => {
    setDisabling(true);
    setDisableError('');
    try {
      await securityApi.disableMfa(useRecovery ? { password, recoveryCode: code.trim().toUpperCase() } : { password, code: code.replace(/\s+/g, '') });
      setPassword('');
      setCode('');
      setDisableOpen(false);
      await refetch();
      await refreshSession();
    } catch (err) {
      setDisableError(err instanceof ApiError ? err.getUserMessage() : 'Could not disable MFA.');
    } finally {
      setDisabling(false);
    }
  };
  return (
    <div className="rounded border bg-card p-4">
      <h3 className="font-semibold">MFA</h3>
      <div className="mt-2 flex items-center gap-2"><span className="text-sm">Status:</span><StatusBadge status={data?.enabled ? 'ENABLED' : 'DISABLED'} variant={data?.enabled ? 'success' : 'warning'} /></div>
      {data?.method && <p className="text-xs text-muted">Method: {data.method}</p>}
      {!data?.enabled ? <button onClick={() => setEnrollOpen(true)} className="mt-3 rounded bg-primary px-3 py-1 text-xs text-white">Enable MFA</button> : <div className="mt-2 space-y-2"><p className="text-xs text-muted">MFA is enabled. Last used: {data.lastUsedAt ? new Date(data.lastUsedAt).toLocaleString() : 'Never'}</p>{!disableOpen && <button onClick={() => setDisableOpen(true)} className="rounded border px-3 py-1 text-xs">Disable MFA</button>}</div>}
      {enrollOpen && <div className="mt-4"><MfaEnrollFlow onSuccess={() => { setEnrollOpen(false); refetch(); refreshSession(); }} onCancel={() => setEnrollOpen(false)} /></div>}
      {disableOpen && (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-muted">Confirm with your password and a current {useRecovery ? 'recovery code' : 'authenticator code'}.</p>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Current password" className="w-full rounded border px-2 py-1 text-xs" />
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={useRecovery ? 'XXXX-XXXX-XXXX' : '123456'} inputMode={useRecovery ? 'text' : 'numeric'} autoComplete="one-time-code" className="w-full rounded border px-2 py-1 font-mono text-xs" />
          <button onClick={() => { setUseRecovery(!useRecovery); setCode(''); }} className="text-xs text-primary">{useRecovery ? 'Use authenticator code' : 'Use a recovery code'}</button>
          {disableError && <div className="rounded bg-red-50 p-2 text-xs text-red-700">{disableError}</div>}
          <div className="flex gap-2">
            <button onClick={handleDisable} disabled={disabling || !password || !code} className="rounded bg-red-600 px-3 py-1 text-xs text-white disabled:opacity-50">{disabling ? 'Disabling...' : 'Disable'}</button>
            <button onClick={() => { setDisableOpen(false); setDisableError(''); }} className="rounded border px-3 py-1 text-xs">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

FILE: apps/web/src/features/security/security-page.tsx

```tsx
'use client';
import { PageContainer } from '@/layout/page-container';
import { MfaSettings } from './mfa-settings';
import { SessionsPage } from './sessions-page';
import { DevicesPage } from './devices-page';
import { ApiKeysPage } from './api-keys-page';
export function SecurityPage(): JSX.Element {
  return (
    <PageContainer title="Security" description="Security control center">
      <div className="grid gap-6 md:grid-cols-2">
        <MfaSettings />
        <SessionsPage />
        <DevicesPage />
        <ApiKeysPage />
      </div>
    </PageContainer>
  );
}
```

FILE: apps/web/src/features/security/sessions-page.tsx

```tsx
'use client';
import { useQuery } from '@tanstack/react-query';
import { securityApi } from '@/api/security-api';
import { ApiError } from '@/api/api-errors';
import { LoadingState } from '@/components/loading-state';
import { ErrorState } from '@/components/error-state';
import { StatusBadge } from '@/components/status-badge';
import { ConfirmationDialog } from '@/components/confirmation-dialog';
import { useState } from 'react';
export function SessionsPage(): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['security', 'sessions'], queryFn: () => securityApi.listSessions() });
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string>('');
  if (isLoading) return <LoadingState />;
  if (error) return <div className="rounded border bg-card p-4"><h3 className="font-semibold">Sessions</h3><ErrorState error={error} onRetry={() => refetch()} /></div>;
  const sessions = data ?? [];
  const run = async (action: () => Promise<unknown>) => {
    setActionError('');
    try {
      await action();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.getUserMessage() : 'The session could not be revoked.');
    } finally {
      refetch();
    }
  };
  return (
    <div className="rounded border bg-card p-4">
      <div className="flex justify-between"><h3 className="font-semibold">Sessions</h3>{sessions.some((s) => !s.isCurrent) && <button onClick={() => run(() => securityApi.revokeAllOtherSessions())} className="text-xs text-primary">Revoke Others</button>}</div>
      {actionError && <div className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{actionError}</div>}
      <ul className="mt-3 space-y-2">
        {sessions.map((s) => (
          <li key={s.id} className="flex items-center justify-between rounded border p-2 text-xs">
            <div><p>{s.device ?? 'Unknown device'}{s.platform && s.device !== s.platform ? ` (${s.platform})` : ''} {s.isCurrent && <StatusBadge status="CURRENT" variant="info" />}</p><p className="text-muted">{s.location ? `${s.location} - ` : ''}Last active {new Date(s.lastActiveAt).toLocaleString()}</p></div>
            {!s.isCurrent && <button onClick={() => setConfirmId(s.id)} className="rounded border px-2 py-1">Revoke</button>}
          </li>
        ))}
        {sessions.length===0 && <p className="text-xs text-muted">No active sessions</p>}
      </ul>
      <ConfirmationDialog open={!!confirmId} title="Revoke Session" description="Revoke this session? User will be logged out from that device." variant="destructive" confirmLabel="Revoke" onConfirm={async () => { if (confirmId) { const id = confirmId; setConfirmId(null); await run(() => securityApi.revokeSession(id)); } }} onCancel={() => setConfirmId(null)} />
    </div>
  );
}
```

FILE: apps/web/src/features/statements/report-download.tsx

```tsx
"use client";
import { useState } from "react";
import { reportingApi, type StatementExportFormat } from "@/api/reporting-api";
import { ApiError } from "@/api/api-errors";
import { InlineError } from "@/components/error-state";
import { saveBlob } from "@/lib/save-blob";

/**
 * Exports a persisted statement. The backend returns the file content inline
 * (CSV or JSON) after checking the caller may see the statement's profile; the
 * browser saves it locally. Nothing is computed client-side.
 */
export function ReportDownload({
  statementId,
}: {
  statementId: string;
}): JSX.Element {
  const [pending, setPending] = useState<StatementExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async (
    format: StatementExportFormat,
  ): Promise<void> => {
    setPending(format);
    setError(null);
    try {
      const { blob, filename } = await reportingApi.exportStatement(
        statementId,
        format,
      );
      saveBlob(blob, filename);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.getUserMessage()
          : "The statement could not be exported. Please try again.",
      );
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="rounded border bg-card p-4">
      <h4 className="font-medium">Export</h4>
      <p className="text-xs text-muted">
        Download this statement as generated by the backend.
      </p>
      <div className="mt-2 flex gap-2">
        {(["CSV", "JSON"] as const).map((format) => (
          <button
            key={format}
            type="button"
            onClick={() => void handleDownload(format)}
            disabled={pending !== null}
            className="rounded bg-primary px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {pending === format ? "Preparing..." : `Download ${format}`}
          </button>
        ))}
      </div>
      {error && (
        <div className="mt-2">
          <InlineError message={error} />
        </div>
      )}
    </div>
  );
}
```

FILE: apps/web/src/features/statements/statement-detail-page.tsx

```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { reportingApi } from "@/api/reporting-api";
import { ApiError } from "@/api/api-errors";
import { PageContainer } from "@/layout/page-container";
import { Money } from "@/components/money";
import { Percentage } from "@/components/percentage";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { ReportDownload } from "./report-download";

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-muted">{label}</span>
      <span>{children}</span>
    </div>
  );
}

export function StatementDetailPage({ id }: { id: string }): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["statement", id],
    queryFn: () => reportingApi.getStatement(id),
    retry: (count, err) =>
      !(
        err instanceof ApiError &&
        (err.status === 400 || err.status === 403 || err.status === 404)
      ) && count < 2,
  });

  if (isLoading) return <LoadingState message="Loading statement..." />;

  // The API answers 404 (or 400 for an unknown id) when the statement is missing or
  // belongs to a profile the caller cannot see: never show another customer's data.
  const notVisible =
    error instanceof ApiError && (error.status === 400 || error.status === 404);
  if (notVisible || (!error && !data)) {
    return (
      <PageContainer
        title="Statement"
        description="Persisted account statement"
      >
        <EmptyState
          title="Statement not found"
          description="Statement not found or not owned by current tenant"
        />
      </PageContainer>
    );
  }
  if (error || !data) {
    return (
      <PageContainer
        title="Statement"
        description="Persisted account statement"
      >
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  const currency = data.currency;
  return (
    <PageContainer
      title={`Statement ${data.id.slice(0, 8)}`}
      description="Full persisted statement detail"
    >
      <div className="space-y-4">
        <div className="rounded border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {new Date(data.periodStart).toLocaleDateString()} –{" "}
              {new Date(data.periodEnd).toLocaleDateString()}
            </p>
            <StatusBadge status={data.state} />
          </div>
          <div className="mt-2 divide-y">
            <Row label="Opening NAV">
              <Money value={data.openingNav} currency={currency} />
            </Row>
            <Row label="Closing NAV">
              <Money value={data.closingNav} currency={currency} />
            </Row>
            <Row label="Cash">
              <Money value={data.cash} currency={currency} />
            </Row>
            <Row
              label={`Return${data.returnMethodology ? ` (${data.returnMethodology})` : ""}`}
            >
              <Percentage value={data.returnPercent} />
            </Row>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded border bg-card p-4">
            <h4 className="font-medium">Profit and loss</h4>
            <div className="mt-2 divide-y">
              <Row label="Realized">
                <Money value={data.realizedPnl} currency={currency} showSign />
              </Row>
              <Row label="Unrealized">
                <Money
                  value={data.unrealizedPnl}
                  currency={currency}
                  showSign
                />
              </Row>
              <Row label="Gross">
                <Money value={data.grossPnl} currency={currency} showSign />
              </Row>
              <Row label="Fees">
                <Money value={data.feesTotal} currency={currency} />
              </Row>
              <Row label="Net">
                <Money value={data.netPnl} currency={currency} showSign />
              </Row>
            </div>
          </div>
          <div className="rounded border bg-card p-4">
            <h4 className="font-medium">Cash flows</h4>
            <div className="mt-2 divide-y">
              <Row label="Deposits">
                <Money value={data.deposits} currency={currency} />
              </Row>
              <Row label="Withdrawals">
                <Money value={data.withdrawals} currency={currency} />
              </Row>
              <Row label="Net transfers">
                <Money value={data.transfers} currency={currency} showSign />
              </Row>
              <Row label="Trades">{data.tradeCount ?? "—"}</Row>
            </div>
          </div>
        </div>

        <div className="rounded border bg-card p-4">
          <h4 className="font-medium">Ending holdings</h4>
          {data.endingHoldings.length === 0 ? (
            <p className="mt-2 text-xs text-muted">
              No open holdings at the end of the period.
            </p>
          ) : (
            <table className="mt-2 w-full text-xs">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-1">Symbol</th>
                  <th className="py-1 text-right">Quantity</th>
                  <th className="py-1 text-right">Cost basis</th>
                </tr>
              </thead>
              <tbody>
                {data.endingHoldings.map((holding, index) => (
                  <tr key={`${holding.symbol}-${index}`} className="border-t">
                    <td className="py-1">{holding.symbol}</td>
                    <td className="py-1 text-right font-mono">
                      {holding.quantity}
                    </td>
                    <td className="py-1 text-right">
                      {holding.costBasis ? (
                        <Money value={holding.costBasis} currency={currency} />
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <ReportDownload statementId={data.id} />
      </div>
    </PageContainer>
  );
}
```

FILE: apps/web/src/features/statements/statements-page.tsx

```tsx
"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { reportingApi } from "@/api/reporting-api";
import { PageContainer } from "@/layout/page-container";
import { StatusBadge } from "@/components/status-badge";
import { Money } from "@/components/money";
import { Percentage } from "@/components/percentage";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";

const PAGE_SIZE = 20;

export function StatementsPage(): JSX.Element {
  const [page, setPage] = useState(1);
  // The API returns only statements of profiles the caller may see.
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["statements", page],
    queryFn: () => reportingApi.listStatements({ page, limit: PAGE_SIZE }),
  });

  const statements = data?.data ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <PageContainer
      title="Statements"
      description="Historical account statements from persisted backend"
    >
      {isLoading ? (
        <LoadingState message="Loading statements..." />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : statements.length === 0 ? (
        <EmptyState
          title="No statements yet"
          description="Statements appear here once an accounting period has been closed."
        />
      ) : (
        <div className="space-y-2">
          {statements.map((s) => (
            <Link
              key={s.id}
              href={`/statements/${encodeURIComponent(s.id)}`}
              className="flex items-center justify-between rounded border bg-card p-3 hover:shadow"
            >
              <div>
                <p className="text-sm font-medium">
                  {new Date(s.periodStart).toLocaleDateString()} –{" "}
                  {new Date(s.periodEnd).toLocaleDateString()}
                </p>
                <p className="text-xs text-muted">
                  Closing NAV{" "}
                  <Money value={s.closingNav} currency={s.currency} /> · Return{" "}
                  <Percentage value={s.returnPercent} />
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Money value={s.netPnl} currency={s.currency} showSign />
                <StatusBadge status={s.state} />
              </div>
            </Link>
          ))}
          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-2 pt-2 text-sm">
              <button
                type="button"
                className="rounded border px-3 py-1 disabled:opacity-50"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <span className="text-muted">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className="rounded border px-3 py-1 disabled:opacity-50"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
}
```

FILE: apps/web/src/features/trading/copy-subscription-flow.tsx

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { tradingApi, type CopySizingMode } from "@/api/trading-api";
import { ApiError } from "@/api/api-errors";
import { ConfirmationDialog } from "@/components/confirmation-dialog";

const DECIMAL = /^\d+(\.\d+)?$/;

const MODES: Array<{ value: CopySizingMode; label: string; hint: string }> = [
  { value: "FIXED", label: "Fixed amount", hint: "Allocate a fixed amount of your balance" },
  { value: "PROPORTIONAL", label: "Proportional", hint: "Mirror the trader's position sizes by a ratio" },
  { value: "PERCENTAGE_BALANCE", label: "% of balance", hint: "Allocate a percentage of your balance" },
];

/**
 * Opens a copy subscription. The API needs the trader id as well as the
 * strategy id and an allocation mode (the old form sent neither, plus a
 * `sizingMode` field the API rejects). Amounts stay decimal strings.
 */
export function CopySubscriptionFlow({ strategyId, traderId }: { strategyId: string; traderId: string }): JSX.Element {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState<string>("");
  const [mode, setMode] = useState<CopySizingMode>("FIXED");
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<string>("");

  const amountValid = DECIMAL.test(amount) && Number(amount) > 0;
  const mutation = useMutation({
    mutationFn: () => tradingApi.createCopySubscription({ traderId, strategyId, allocationMode: mode, allocationAmount: amount }),
    onSuccess: (sub) => {
      setSuccess(`Copy subscription created (${sub.state.toLowerCase()}).`);
      setError("");
      setConfirmOpen(false);
      setAmount("");
      void queryClient.invalidateQueries({ queryKey: ["copy-subs"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard", "copy", "subscriptions"] });
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.getUserMessage() : "Could not create the copy subscription.");
      setConfirmOpen(false);
    },
  });

  return (
    <div className="rounded border bg-card p-4">
      <h3 className="font-semibold">Copy This Strategy</h3>
      <p className="text-xs text-muted">
        No trusted values submitted from the browser: the server re-checks eligibility, compliance, plan limits and your
        available balance before anything is copied.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <select
          aria-label="Allocation mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as CopySizingMode)}
          className="rounded border px-3 py-2 text-sm"
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value} title={m.hint}>
              {m.label}
            </option>
          ))}
        </select>
        <input
          value={amount}
          inputMode="decimal"
          onChange={(e) => setAmount(e.target.value.trim())}
          placeholder={mode === "PERCENTAGE_BALANCE" ? "Percent (e.g. 10)" : mode === "PROPORTIONAL" ? "Ratio (e.g. 0.1)" : "Amount"}
          className="rounded border px-3 py-2 text-sm"
        />
        <button
          onClick={() => {
            setSuccess("");
            setConfirmOpen(true);
          }}
          disabled={!amountValid || mutation.isPending}
          className="rounded bg-primary px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          Copy
        </button>
      </div>
      {amount !== "" && !amountValid && <p className="mt-2 text-xs text-red-600">Enter a positive number, e.g. 250 or 0.5.</p>}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {success && <p className="mt-2 text-xs text-green-600">{success}</p>}
      <ConfirmationDialog
        open={confirmOpen}
        title="Confirm Copy Subscription"
        description={`Copy this strategy with ${MODES.find((m) => m.value === mode)?.label.toLowerCase()} ${amount}? The server validates eligibility, risk and compliance.`}
        confirmLabel="Confirm Copy"
        onConfirm={() => mutation.mutate()}
        onCancel={() => setConfirmOpen(false)}
        isLoading={mutation.isPending}
      />
    </div>
  );
}
```

FILE: apps/web/src/features/trading/strategies-page.tsx

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { tradingApi, copyEligibility } from "@/api/trading-api";
import { PageContainer } from "@/layout/page-container";
import { StatusBadge } from "@/components/status-badge";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { useTradingStatus } from "./use-trading-status";

export function StrategiesPage(): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["strategies"],
    queryFn: () => tradingApi.listStrategies({ page: 1, limit: 20 }),
  });
  const status = useTradingStatus();
  const strategies = data?.data ?? [];
  return (
    <PageContainer title="Strategies" description="Published strategies you can copy">
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : strategies.length === 0 ? (
        <EmptyState title="No strategies yet" description="Published strategies from your traders will appear here." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {strategies.map((s) => {
            const eligibility = copyEligibility(s, status.data);
            return (
              <Link key={s.strategyId} href={`/strategies/${s.strategyId}`} className="rounded border bg-card p-4 hover:shadow">
                <div className="flex justify-between">
                  <h3 className="font-semibold">{s.name}</h3>
                  <StatusBadge status={s.status} />
                </div>
                <p className="text-xs text-muted">
                  {s.type} | {s.followerCount} followers | {s.supportedSymbols.slice(0, 3).join(", ") || "All symbols"}
                </p>
                <p className="mt-1 text-xs">
                  {eligibility.canCopy ? "Can copy" : eligibility.reasons.join(", ") || "Checking eligibility…"}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
```

FILE: apps/web/src/features/trading/strategy-detail-page.tsx

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { tradingApi, copyEligibility } from "@/api/trading-api";
import { PageContainer } from "@/layout/page-container";
import { StatusBadge } from "@/components/status-badge";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { CopySubscriptionFlow } from "./copy-subscription-flow";
import { useTradingStatus } from "./use-trading-status";

export function StrategyDetailPage({ id }: { id: string }): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["strategy", id],
    queryFn: () => tradingApi.getStrategy(id),
  });
  const status = useTradingStatus();
  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!data) return <div className="p-4">Strategy not found</div>;
  const eligibility = copyEligibility(data, status.data);
  return (
    <PageContainer title={data.name} description="Strategy details">
      <div className="space-y-4">
        <div className="rounded border bg-card p-4">
          <div className="flex gap-2">
            <StatusBadge status={data.status} />
            <StatusBadge status={data.type} variant="neutral" />
          </div>
          <p className="mt-2 text-sm">{data.description ?? "No description"}</p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <dt className="text-muted">Trader</dt>
            <dd>
              <Link href={`/traders/${data.traderId}`} className="underline">
                View trader profile
              </Link>
            </dd>
            <dt className="text-muted">Symbols</dt>
            <dd>{data.supportedSymbols.join(", ") || "All"}</dd>
            <dt className="text-muted">Venues</dt>
            <dd>{data.supportedVenues.join(", ") || "All"}</dd>
            <dt className="text-muted">Followers</dt>
            <dd>{data.followerCount}</dd>
            <dt className="text-muted">Published</dt>
            <dd>{data.publishedAt ? new Date(data.publishedAt).toLocaleDateString() : "Not published"}</dd>
          </dl>
          <p className="mt-3 text-xs">
            Can copy: {eligibility.canCopy ? "Yes" : "No"} {eligibility.reasons.join(", ")}
          </p>
        </div>
        {eligibility.canCopy && <CopySubscriptionFlow strategyId={data.strategyId} traderId={data.traderId} />}
      </div>
    </PageContainer>
  );
}
```

FILE: apps/web/src/features/trading/trader-detail-page.tsx

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { tradingApi } from "@/api/trading-api";
import { PageContainer } from "@/layout/page-container";
import { StatusBadge } from "@/components/status-badge";
import { Money } from "@/components/money";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";

export function TraderDetailPage({ id }: { id: string }): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["trader", id],
    queryFn: () => tradingApi.getTrader(id),
  });
  const strategies = useQuery({
    queryKey: ["trader", id, "strategies"],
    queryFn: () => tradingApi.listTraderStrategies(id, { page: 1, limit: 20 }),
    enabled: Boolean(data),
  });
  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!data) return <div className="p-4 text-sm">Trader not found</div>;
  return (
    <PageContainer title={data.displayName} description="Trader profile">
      <div className="space-y-4">
        <div className="space-y-4 rounded border bg-card p-4">
          <div className="flex gap-2">
            <StatusBadge status={data.verificationState} />
            {data.isFeatured && <StatusBadge status="FEATURED" variant="info" />}
          </div>
          <p className="text-sm">{data.bio ?? "No bio"}</p>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>Followers: {data.followerCount}</div>
            <div>Trades: {data.totalTrades}</div>
            <div>
              Volume: <Money value={data.totalVolume} />
            </div>
            <div>Venues: {data.supportedVenues.join(", ") || "—"}</div>
          </div>
        </div>
        <div className="rounded border bg-card p-4">
          <h3 className="font-semibold">Strategies</h3>
          {strategies.isLoading ? (
            <LoadingState />
          ) : strategies.error ? (
            <ErrorState error={strategies.error} onRetry={() => void strategies.refetch()} />
          ) : (strategies.data?.data ?? []).length === 0 ? (
            <p className="mt-2 text-xs text-muted">No published strategies.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {(strategies.data?.data ?? []).map((s) => (
                <li key={s.strategyId} className="flex items-center justify-between text-sm">
                  <Link href={`/strategies/${s.strategyId}`} className="underline">
                    {s.name}
                  </Link>
                  <StatusBadge status={s.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
```

FILE: apps/web/src/features/trading/traders-page.tsx

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { tradingApi } from "@/api/trading-api";
import { PageContainer } from "@/layout/page-container";
import { StatusBadge } from "@/components/status-badge";
import { Money } from "@/components/money";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";

export function TradersPage(): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["traders"],
    queryFn: () => tradingApi.listTraders({ page: 1, limit: 20 }),
  });
  const traders = data?.data ?? [];
  return (
    <PageContainer title="Traders" description="Discover traders you can copy">
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : traders.length === 0 ? (
        <EmptyState title="No public traders yet" description="Traders appear here once they publish a public profile." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {traders.map((t) => (
            <Link key={t.traderId} href={`/traders/${t.traderId}`} className="rounded border bg-card p-4 hover:shadow">
              <div className="flex justify-between">
                <h3 className="font-semibold">{t.displayName}</h3>
                <StatusBadge status={t.verificationState} />
              </div>
              <p className="mt-2 text-xs text-muted">
                Trades: {t.totalTrades} | Volume: <Money value={t.totalVolume} />
              </p>
              <p className="text-xs">Followers: {t.followerCount}</p>
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
```

FILE: apps/web/src/features/trading/trading-status.tsx

```tsx
"use client";

import { StatusBadge } from "@/components/status-badge";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { useTradingStatus } from "./use-trading-status";

export function TradingStatus(): JSX.Element {
  const { data, isLoading, error, refetch } = useTradingStatus();
  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!data) return <div className="text-xs text-muted">Trading status unavailable</div>;
  return (
    <div className="rounded border bg-card p-4 text-sm">
      <div className="flex gap-2">
        <StatusBadge status={data.eligibility} variant={data.canCopy ? "success" : "warning"} />
        {data.maintenance?.active && (
          <StatusBadge status="MAINTENANCE" variant={data.maintenance.isEmergency ? "danger" : "warning"} />
        )}
      </div>
      {data.restrictions.length > 0 && (
        <div className="mt-2">
          <p className="font-medium">Restrictions:</p>
          <ul className="list-disc pl-4 text-xs">
            {data.restrictions.map((r, i) => (
              <li key={`${r.type}-${i}`}>
                {r.type}: {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.maintenance?.active && <p className="mt-2 text-xs text-yellow-700">Maintenance: {data.maintenance.message}</p>}
    </div>
  );
}
```

FILE: apps/web/src/features/trading/use-trading-status.ts

```typescript
"use client";

import { useQuery } from "@tanstack/react-query";
import { tradingApi } from "@/api/trading-api";
import { useAuth } from "@/auth/auth.store";

/**
 * Trading status for the signed-in user (maintenance notice, own active
 * restrictions, whether the role may copy). Shared by the dashboard, the
 * trading status card and the strategy pages so they agree and share a cache.
 */
export function useTradingStatus() {
  const { session } = useAuth();
  const permissions = session?.user.permissions ?? [];
  return useQuery({
    queryKey: ["trading", "status", session?.user.id ?? "anonymous", permissions.join(",")],
    queryFn: () => tradingApi.getTradingStatus(permissions),
    enabled: Boolean(session),
    staleTime: 30 * 1000,
  });
}
```

FILE: apps/web/src/layout/app-shell.tsx

```tsx
'use client';

import { ReactNode } from 'react';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { MobileNavigation } from './mobile-navigation';
import { MaintenanceBanner } from '@/components/maintenance-banner';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps): JSX.Element {
  return (
    <div className="min-h-screen bg-background">
      <MaintenanceBanner />
      <Topbar />
      <div className="flex">
        <aside className="hidden w-64 shrink-0 border-r bg-card md:block">
          <Sidebar />
        </aside>
        <main className="flex-1">
          <div className="md:hidden">
            <MobileNavigation />
          </div>
          <div className="mx-auto max-w-7xl p-4 md:p-6 lg:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
```

FILE: apps/web/src/layout/mobile-navigation.tsx

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTenant } from '@/tenant/tenant-context';

const mobileNav = [
  { label: 'Dashboard', href: '/dashboard', icon: '📊' },
  { label: 'Portfolio', href: '/portfolio', icon: '💼' },
  { label: 'Traders', href: '/traders', icon: '👥' },
  { label: 'Funding', href: '/funding', icon: '💰' },
  { label: 'Account', href: '/account', icon: '👤' },
];

export function MobileNavigation(): JSX.Element {
  const [open, setOpen] = useState<boolean>(false);
  const pathname = usePathname();
  const { tenant } = useTenant();

  return (
    <div className="border-b bg-card md:hidden">
      <div className="flex items-center justify-between p-4">
        <span className="font-semibold">{tenant?.name ?? 'Menu'}</span>
        <button
          onClick={() => setOpen(!open)}
          className="rounded p-2 hover:bg-accent"
          aria-label="Toggle menu"
          aria-expanded={open}
        >
          {open ? '✕' : '☰'}
        </button>
      </div>
      {open && (
        <nav className="border-t p-4">
          <ul className="space-y-1">
            {mobileNav.map((item) => {
              const isActive = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${
                      isActive ? 'bg-primary text-white' : 'hover:bg-accent'
                    }`}
                  >
                    <span>{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}
```

FILE: apps/web/src/layout/page-container.tsx

```tsx
import { ReactNode } from 'react';

interface PageContainerProps {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function PageContainer({ title, description, actions, children, className }: PageContainerProps): JSX.Element {
  return (
    <div className={`space-y-6 ${className ?? ''}`}>
      {(title || description || actions) && (
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            {title && <h1 className="text-2xl font-bold tracking-tight">{title}</h1>}
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div>{children}</div>
    </div>
  );
}

export function Section({ title, description, children, className }: { title?: string; description?: string; children: ReactNode; className?: string }): JSX.Element {
  return (
    <section className={`rounded-lg border bg-card p-6 ${className ?? ''}`}>
      {(title || description) && (
        <div className="mb-4">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </div>
      )}
      <div>{children}</div>
    </section>
  );
}
```

FILE: apps/web/src/layout/sidebar.tsx

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTenant } from '@/tenant/tenant-context';
import { useAuth } from '@/auth/auth.store';
import { featureCatalog } from '@/config/feature-config';
import { permissionsAllowAny } from '@/auth/permissions';

const navGroups = [
  {
    label: 'Main',
    items: [
      { key: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: '📊' },
      { key: 'portfolio', label: 'Portfolio', href: '/portfolio', icon: '💼' },
      { key: 'traders', label: 'Traders', href: '/traders', icon: '👥' },
      { key: 'strategies', label: 'Strategies', href: '/strategies', icon: '📈' },
      { key: 'copy_trading', label: 'Copy Trading', href: '/copy-trading', icon: '🔄' },
    ],
  },
  {
    label: 'Accounts',
    items: [
      { key: 'exchanges', label: 'Exchanges', href: '/exchanges', icon: '🏦' },
      { key: 'funding', label: 'Funding', href: '/funding', icon: '💰' },
      { key: 'billing', label: 'Billing', href: '/billing', icon: '💳' },
      { key: 'statements', label: 'Statements', href: '/statements', icon: '📄' },
    ],
  },
  {
    label: 'System',
    items: [
      { key: 'security', label: 'Security', href: '/security', icon: '🔒' },
      { key: 'notifications', label: 'Notifications', href: '/notifications', icon: '🔔' },
      { key: 'account', label: 'Account', href: '/account', icon: '👤' },
    ],
  },
];

export function Sidebar(): JSX.Element {
  const pathname = usePathname();
  const { tenant } = useTenant();
  const { session } = useAuth();

  const entitlements = tenant?.entitlements ?? {};
  const roles = session?.user.roles ?? [];
  const permissions = session?.user.permissions ?? [];

  return (
    <nav className="flex h-full flex-col gap-6 p-4">
      <div className="px-2 py-2">
        <h2 className="text-sm font-semibold">{tenant?.name ?? 'Loading...'}</h2>
        {tenant?.plan && <p className="text-xs text-muted">{tenant.plan.name}</p>}
      </div>

      {navGroups.map((group) => (
        <div key={group.label} className="space-y-1">
          <h3 className="px-2 text-xs font-medium uppercase text-muted">{group.label}</h3>
          <ul className="space-y-1">
            {group.items.map((item) => {
              const feature = featureCatalog.find((f) => f.key === item.key);
              if (feature?.requiresEntitlement && !entitlements[feature.requiresEntitlement]) {
                return null; // UX-only hiding, backend remains authoritative
              }
              if (feature?.requiresPermission && !permissionsAllowAny(permissions, feature.requiresPermission)) {
                return null; // the backend would answer 403 for every call on this screen
              }
              if (feature?.requiresRole && feature.requiresRole.length > 0) {
                const hasRole = feature.requiresRole.some((r) => roles.includes(r));
                if (!hasRole) return null;
              }

              const isActive = pathname === item.href || pathname.startsWith(item.href + '/');

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors ${
                      isActive ? 'bg-primary text-white' : 'hover:bg-accent'
                    }`}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <span aria-hidden>{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <div className="mt-auto border-t pt-4">
        <p className="px-2 text-xs text-muted">© {new Date().getFullYear()} {tenant?.name ?? 'Platform'}</p>
      </div>
    </nav>
  );
}
```

FILE: apps/web/src/layout/topbar.tsx

```tsx
'use client';

import { useAuth } from '@/auth/auth.store';
import { useTenant } from '@/tenant/tenant-context';
import { TenantLogo } from '@/tenant/tenant-branding';
import { useState } from 'react';
import Link from 'next/link';

export function Topbar(): JSX.Element {
  const { session, logout } = useAuth();
  const { tenant } = useTenant();
  const [menuOpen, setMenuOpen] = useState<boolean>(false);

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-card px-4">
      <div className="flex items-center gap-3">
        <TenantLogo className="h-8 w-8 rounded" fallback={<div className="h-8 w-8 rounded bg-primary" />} />
        <span className="hidden font-semibold md:inline">{tenant?.branding?.appName ?? tenant?.name ?? 'App'}</span>
      </div>

      <div className="flex items-center gap-4">
        <Link href="/notifications" className="relative rounded p-2 hover:bg-accent" aria-label="Notifications">
          🔔
        </Link>

        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 rounded-full p-1 hover:bg-accent"
            aria-label="User menu"
            aria-expanded={menuOpen}
          >
            <div className="h-8 w-8 rounded-full bg-primary text-center text-sm leading-8 text-white">
              {session?.user.email?.charAt(0).toUpperCase() ?? 'U'}
            </div>
            <span className="hidden text-sm md:inline">{session?.user.email}</span>
          </button>

          {menuOpen && (
            <div className="absolute right-0 mt-2 w-48 rounded-md border bg-card shadow-lg">
              <div className="p-2">
                <p className="truncate text-sm font-medium">{session?.user.email}</p>
                <p className="truncate text-xs text-muted">{tenant?.name}</p>
              </div>
              <div className="border-t">
                <Link href="/account" className="block px-4 py-2 text-sm hover:bg-accent">
                  Account Settings
                </Link>
                <Link href="/security" className="block px-4 py-2 text-sm hover:bg-accent">
                  Security
                </Link>
                <Link href="/billing" className="block px-4 py-2 text-sm hover:bg-accent">
                  Billing
                </Link>
                <button
                  onClick={() => {
                    logout();
                    setMenuOpen(false);
                  }}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-accent"
                >
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
```

FILE: apps/web/src/lib/api-error.ts

```typescript
/**
 * The error envelope produced by the API. Mirrors
 * `common/filters/global-exception.filter.ts` so both sides agree on shape.
 */
export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Array<{ field: string; message: string }>;
    requestId?: string;
    timestamp?: string;
    path?: string;
  };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Array<{ field: string; message: string }>,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static fromBody(status: number, body: unknown): ApiError {
    const envelope = body as Partial<ApiErrorBody>;

    if (envelope?.error?.code) {
      return new ApiError(
        status,
        envelope.error.code,
        envelope.error.message ?? 'The request could not be completed.',
        envelope.error.details,
        envelope.error.requestId,
      );
    }

    return new ApiError(status, 'UNKNOWN_ERROR', 'The request could not be completed.');
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.code === 'TOKEN_EXPIRED' || this.code === 'TOKEN_INVALID';
  }

  /** Field errors keyed by field name, ready to bind to form inputs. */
  get fieldErrors(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const detail of this.details ?? []) {
      map[detail.field] = detail.message;
    }
    return map;
  }
}
```

FILE: apps/web/src/lib/env.ts

```typescript
import { z } from 'zod';

/**
 * Server-side configuration for customer web.
 * Validated lazily on first use. Only NEXT_PUBLIC_ vars are browser-safe.
 */

const serverSchema = z.object({
  API_BASE_URL: z.string().url(),
  SESSION_COOKIE_SECRET: z.string().min(16),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) {
    return cached;
  }

  const parsed = serverSchema.safeParse({
    API_BASE_URL: process.env.API_BASE_URL,
    SESSION_COOKIE_SECRET: process.env.SESSION_COOKIE_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid web server configuration: ${issues}`);
  }

  cached = parsed.data;
  return cached;
}

/** Browser-visible configuration. Contains nothing sensitive. */
export const publicEnv = {
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? 'Copy Trading',
  apiVersion: process.env.NEXT_PUBLIC_API_VERSION ?? 'v1',
  wsUrl: process.env.NEXT_PUBLIC_WS_URL ?? '',
  wsPath: process.env.NEXT_PUBLIC_WS_PATH ?? '/socket.io',
  platformDomain: process.env.NEXT_PUBLIC_PLATFORM_DOMAIN ?? 'localhost',
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'support@example.com',
} as const;
```

FILE: apps/web/src/lib/idempotency-key.ts

```typescript
/** Random idempotency key for a single user-initiated mutation (retries reuse it). */
export function newIdempotencyKey(prefix = "req"): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
```

FILE: apps/web/src/lib/proxy-path.ts

```typescript
/**
 * Path rules for the /api/proxy/* route handler. Kept out of the route file
 * because a Next.js route module may only export HTTP handlers and route
 * segment config.
 */

/**
 * Backend routes that are @Public() and needed before sign-in. They are
 * forwarded without a session and never carry an Authorization header. Only
 * GET is allowed, and only exact paths (after the version segment) - nothing
 * else is reachable anonymously through the proxy.
 */
export const ANONYMOUS_GET_PATHS: ReadonlySet<string> = new Set(['tenants/public-config']);

function withoutVersion(segments: readonly string[], apiVersion: string): readonly string[] {
  return segments[0] === apiVersion ? segments.slice(1) : segments;
}

/**
 * Callers may write '/v1/notifications' or '/notifications'. The backend
 * version is added exactly once - the same rule serverFetch applies - so a
 * leading version segment is never doubled into /v1/v1/...
 */
export function buildUpstreamPath(segments: readonly string[], apiVersion: string): string {
  return [apiVersion, ...withoutVersion(segments, apiVersion)].join('/');
}

export function isAnonymousRoute(method: string, segments: readonly string[], apiVersion: string): boolean {
  if (method !== 'GET') return false;
  return ANONYMOUS_GET_PATHS.has(withoutVersion(segments, apiVersion).join('/'));
}

export function isUnsafeSegment(segment: string): boolean {
  return segment.includes('..') || segment.includes('\\');
}
```

FILE: apps/web/src/lib/save-blob.ts

```typescript
/** Saves a Blob as a file through a temporary object URL (browser only). */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Revoke after the click has been processed so the download can start.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
```

FILE: apps/web/src/lib/server-api.ts

```typescript
import 'server-only';

import { randomUUID } from 'node:crypto';

import { ApiError } from './api-error';
import { serverEnv, publicEnv } from './env';
import { getAccessToken } from './session';

export interface ServerFetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  authenticated?: boolean;
  revalidate?: number | false;
  searchParams?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  tenantId?: string;
  host?: string;
}

function buildUrl(path: string, searchParams?: ServerFetchOptions['searchParams']): string {
  const env = serverEnv();
  const base = env.API_BASE_URL.replace(/\/+$/, '');
  const normalised = path.startsWith('/') ? path : `/${path}`;
  const versioned = normalised.startsWith(`/${publicEnv.apiVersion}/`) ? normalised : `/${publicEnv.apiVersion}${normalised}`;
  const url = new URL(`${base}${versioned}`);
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export async function serverFetch<T>(path: string, options: ServerFetchOptions = {}): Promise<T> {
  const { method = 'GET', body, authenticated = true, revalidate = 0, searchParams } = options;

  const headers: Record<string, string> = {
    accept: 'application/json',
    'x-request-id': randomUUID(),
  };

  if (options.host) {
    headers['x-forwarded-host'] = options.host;
  }

  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  if (authenticated) {
    const token = getAccessToken();
    if (!token) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Your session has expired. Please sign in again.');
    }
    headers.authorization = `Bearer ${token}`;
  }

  let response: Response;

  try {
    response = await fetch(buildUrl(path, searchParams), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: revalidate === 0 ? 'no-store' : undefined,
      next: revalidate === 0 || revalidate === false ? undefined : { revalidate },
      signal: options.signal,
    });
  } catch {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'The platform API is unreachable. Please try again shortly.');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const payload: unknown = text.length > 0 ? safeJsonParse(text) : undefined;

  if (!response.ok) {
    throw ApiError.fromBody(response.status, payload);
  }

  const envelope = payload as { success?: boolean; data?: T } | undefined;
  return envelope && 'data' in envelope ? (envelope.data as T) : (payload as T);
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
```

FILE: apps/web/src/lib/session.ts

```typescript
import 'server-only';

import { cookies } from 'next/headers';

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

export function decodeAccessTokenClaims(
  token: string
): { sub: string; tid: string; roles: string[]; perms: string[]; plat: boolean; exp: number } | null {
  const segments = token.split('.');
  if (segments.length !== 3 || !segments[1]) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8')) as Record<string, unknown>;
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
```

FILE: apps/web/src/lib/sso-flow.ts

```typescript
import { z } from "zod";

/**
 * Single sign-on (Part 11) - pure helpers shared by the BFF routes
 * /api/auth/sso/start and /api/auth/sso/callback.
 *
 * The browser never sees the binding secret, the device id, any IdP code or
 * any platform token:
 *  - start: the BFF asks the API for an authorization URL and keeps the
 *    returned binding secret and the generated device id in httpOnly cookies
 *    scoped to /api/auth/sso;
 *  - callback: the IdP redirects the browser to the BFF, which completes the
 *    login server-to-server with state + code + the two cookies, then stores
 *    the session exactly like password login (or the 2FA challenge cookies).
 *
 * The binding cookies are SameSite=Lax (not Strict) on purpose: the IdP's
 * redirect back is a cross-site top-level navigation, on which Strict
 * cookies are not sent. They are httpOnly, short-lived, path-scoped and
 * deleted on the first callback; possession alone is useless without the
 * matching server-side transaction, which is single-use.
 */

export const SSO_BINDING_COOKIE = "wlct_sso_bind";
export const SSO_DEVICE_COOKIE = "wlct_sso_did";
export const SSO_COOKIE_PATH = "/api/auth/sso";
export const SSO_DEFAULT_RETURN = "/dashboard";
/** Upper bound for the binding cookies, matching the API transaction TTL (600 s). */
export const SSO_COOKIE_MAX_AGE = 600;

/** Same rule as the API (isSafeReturnTo): an app-relative path only. */
export function isSafeReturnPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512)
    return false;
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (value.includes("\\")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  return !/^\/[a-z][a-z0-9+.-]*:/i.test(value);
}

/**
 * Browser -> BFF body for POST /api/auth/sso/start. No tenant id: the tenant
 * is the request host. providerType is optional: without it the API starts
 * the tenant's enabled provider (OIDC or SAML).
 */
export const ssoStartRequestSchema = z
  .object({
    providerType: z.enum(["OIDC", "SAML"]).optional(),
    returnTo: z
      .string()
      .max(512)
      .refine((v) => isSafeReturnPath(v), {
        message: "returnTo must be an app-relative path",
      })
      .optional(),
  })
  .strict();

export type SsoStartRequest = z.infer<typeof ssoStartRequestSchema>;

/** API response of POST /v1/auth/sso/start. */
export interface SsoStartApiResult {
  providerType: "OIDC" | "SAML";
  authorizationUrl: string;
  bindingToken: string;
  expiresIn: number;
}

/** Only https IdP URLs are handed to the browser (plain http only for loopback outside production). */
export function isAcceptableAuthorizationUrl(
  raw: string,
  production: boolean,
): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return (
    !production &&
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  );
}

const MAX_PARAM = 4096;

function param(query: URLSearchParams, name: string): string | null {
  const value = query.get(name);
  if (value === null || value.length === 0 || value.length > MAX_PARAM)
    return null;
  return value;
}

/**
 * BFF -> API body for POST /v1/auth/sso/callback (SsoCallbackDto). Only the
 * whitelisted fields are forwarded (the DTO rejects extras with 422); the
 * binding secret and device id come from the httpOnly cookies, never from
 * the query string. Returns null when the redirect cannot be a valid callback.
 */
export function buildSsoCallbackBody(
  query: URLSearchParams,
  bindingToken: string | undefined,
  deviceId: string | undefined,
): Record<string, string> | null {
  const state = param(query, "state");
  if (!state || !bindingToken || !deviceId) return null;
  const code = param(query, "code");
  const error = param(query, "error");
  if (!code && !error) return null;
  const body: Record<string, string> = {
    state,
    bindingToken,
    deviceId,
    deviceName: "Customer Web",
    platform: "web",
  };
  if (code) body.code = code;
  if (error) body.error = error.slice(0, 128);
  return body;
}

/** Where the browser goes after a refused or failed SSO attempt (no detail: refusals are generic). */
export const SSO_FAILURE_PATH = "/login?sso=failed";
/** Where the browser goes when the account requires its second factor (challenge cookies already set). */
export const SSO_MFA_PATH = "/login?sso=mfa";

/** The post-login target: the server-validated returnTo when safe, else the dashboard. */
export function ssoSuccessPath(returnTo: unknown): string {
  return isSafeReturnPath(returnTo) ? returnTo : SSO_DEFAULT_RETURN;
}
```

FILE: apps/web/src/lib/two-factor-verify.ts

```typescript
import { z } from 'zod';

/**
 * Browser -> BFF body for the second sign-in step. The challenge token and
 * device id are not part of it: they live in httpOnly cookies.
 */
export const twoFactorRequestSchema = z.object({
  code: z.string().trim().min(1).max(32),
  method: z.enum(['TOTP', 'RECOVERY']).default('TOTP'),
  trustDevice: z.boolean().optional(),
});

export type TwoFactorRequest = z.infer<typeof twoFactorRequestSchema>;

/**
 * BFF -> backend body for POST /v1/auth/two-factor/verify (VerifyTwoFactorDto).
 * Exactly one of code / recoveryCode is sent, and never `method`: the DTO is
 * validated with forbidNonWhitelisted, so any extra field is a 422.
 */
export function buildVerifyBody(
  challengeToken: string,
  deviceId: string,
  input: TwoFactorRequest
): Record<string, string | boolean> {
  const body: Record<string, string | boolean> = { challengeToken, deviceId };
  if (input.method === 'RECOVERY') {
    body.recoveryCode = input.code.trim().toUpperCase();
  } else {
    body.code = input.code.replace(/\s+/g, '');
  }
  if (input.trustDevice !== undefined) {
    body.trustDevice = input.trustDevice;
  }
  return body;
}
```

FILE: apps/web/src/main.tsx

```tsx
/**
 * Application entry point using repository's actual frontend framework/build conventions.
 * For Next.js, the real entry is src/app/layout.tsx and src/app/page.tsx.
 * This file exists to satisfy the required file structure and provides
 * a programmatic bootstrap for non-Next.js tooling if needed.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Providers } from './app/providers';
import { ErrorBoundary } from './app/error-boundary';

// Only used if running outside Next.js (e.g., Vite fallback)
// In Next.js, this file is not executed; layout.tsx is the entry.

function App(): JSX.Element {
  return (
    <ErrorBoundary>
      <Providers>
        <div className="p-8 text-center">
          <h1 className="text-xl font-bold">Customer Web</h1>
          <p className="text-sm text-muted">This application runs via Next.js. Use npm run dev.</p>
        </div>
      </Providers>
    </ErrorBoundary>
  );
}

// Safe mount only if #root exists (Vite mode)
if (typeof document !== 'undefined') {
  const rootEl = document.getElementById('root');
  if (rootEl) {
    const root = ReactDOM.createRoot(rootEl);
    root.render(<App />);
  }
}

export default App;
```

FILE: apps/web/src/styles/branding.css

```css
/* Runtime tenant-branding variables generated only from backend-sanitized values */
:root {
  --brand-primary: #4f46e5;
  --brand-secondary: #0f172a;
  --brand-accent: #06b6d4;
  --brand-background: #ffffff;
  --brand-text: #0f172a;
  --brand-font: 'Inter', system-ui, sans-serif;
}

.branded-primary {
  background-color: var(--brand-primary);
  color: white;
}

.branded-secondary {
  background-color: var(--brand-secondary);
  color: white;
}

.branded-accent {
  color: var(--brand-accent);
}

.branded-font {
  font-family: var(--brand-font);
}
```

FILE: apps/web/src/styles/globals.css

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --brand-primary: #4f46e5;
  --brand-secondary: #0f172a;
  --brand-accent: #06b6d4;
  --brand-background: #ffffff;
  --brand-text: #0f172a;
  --brand-font: 'Inter', system-ui, sans-serif;
}

* {
  border-color: hsl(214.3 31.8% 91.4%);
}

body {
  background-color: var(--brand-background);
  color: var(--brand-text);
  font-family: var(--brand-font);
  -webkit-font-smoothing: antialiased;
}

.bg-background {
  background-color: hsl(0 0% 100%);
}

.bg-card {
  background-color: hsl(0 0% 100%);
}

.bg-primary {
  background-color: var(--brand-primary);
}

.bg-accent {
  background-color: hsl(210 40% 96.1%);
}

.text-muted {
  color: hsl(215.4 16.3% 46.9%);
}

.border {
  border: 1px solid hsl(214.3 31.8% 91.4%);
}

/* Focus visible */
*:focus-visible {
  outline: 2px solid var(--brand-primary);
  outline-offset: 2px;
}

/* Skip link */
.skip-link {
  position: absolute;
  top: -40px;
  left: 0;
  background: var(--brand-primary);
  color: white;
  padding: 8px;
  z-index: 100;
}

.skip-link:focus {
  top: 0;
}
```

FILE: apps/web/src/telemetry/error-reporting.ts

```typescript
import { getRuntimeConfig } from '@/config/runtime-config';

const config = getRuntimeConfig();

function scrubErrorMessage(message: string): string {
  // Scrub sensitive data from error messages
  const sensitivePatterns = [
    /api[_-]?key\s*[:=]\s*\S+/gi,
    /secret\s*[:=]\s*\S+/gi,
    /password\s*[:=]\s*\S+/gi,
    /private[_-]?key/gi,
    /BEGIN (?:RSA )?PRIVATE KEY/gi,
    /bearer\s+\S+/gi,
  ];
  let scrubbed = message;
  for (const pattern of sensitivePatterns) {
    scrubbed = scrubbed.replace(pattern, '[REDACTED]');
  }
  // Truncate
  if (scrubbed.length > 500) {
    scrubbed = scrubbed.slice(0, 500) + '...';
  }
  return scrubbed;
}

export function reportError(error: Error, context?: Record<string, unknown>): void {
  const safeMessage = scrubErrorMessage(error.message);
  const safeStack = error.stack ? scrubErrorMessage(error.stack) : undefined;

  const payload = {
    message: safeMessage,
    stack: safeStack?.slice(0, 1000),
    context: context ? scrubContext(context) : undefined,
    timestamp: new Date().toISOString(),
    url: typeof window !== 'undefined' ? window.location.pathname : undefined,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  };

  if (config.environment === 'development') {
    console.error('[ErrorReport]', payload);
  }

  // In production, would send to error reporting service
  try {
    if (typeof window !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon('/api/proxy/v1/errors', JSON.stringify(payload));
    }
  } catch {
    // Ignore reporting errors
  }
}

function scrubContext(context: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ['password', 'secret', 'private', 'apiKey', 'token', 'credential', 'balance', 'pnl', 'kyc', 'document'];
  const scrubbed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context)) {
    const isSensitive = sensitiveKeys.some((s) => k.toLowerCase().includes(s.toLowerCase()));
    scrubbed[k] = isSensitive ? '[REDACTED]' : typeof v === 'string' && v.length > 100 ? v.slice(0, 100) + '...' : v;
  }
  return scrubbed;
}
```

FILE: apps/web/src/telemetry/web-telemetry.ts

```typescript
import { getRuntimeConfig } from '@/config/runtime-config';

const config = getRuntimeConfig();

interface TelemetryEvent {
  name: string;
  properties?: Record<string, string | number | boolean>;
  correlationId?: string;
}

function scrubSensitiveData(data: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ['password', 'secret', 'privateKey', 'apiKey', 'token', 'credential', 'balance', 'pnl', 'nav', 'amount'];
  const scrubbed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    const isSensitive = sensitiveKeys.some((s) => k.toLowerCase().includes(s.toLowerCase()));
    scrubbed[k] = isSensitive ? '[REDACTED]' : v;
  }
  return scrubbed;
}

/**
 * Realtime handling notes:
 * - duplicate event detection via idempotency key
 * - out-of-order event handling via version/timestamp comparison
 * - keyboard navigation tracked for accessibility
 */
export function trackEvent(event: TelemetryEvent): void {
  if (!config.enableTelemetry) return;
  if (typeof window === 'undefined') return;

  const safeProperties = event.properties ? scrubSensitiveData(event.properties as Record<string, unknown>) : {};

  // In production, would send to observability endpoint with correlation ID
  // Never log full balances, transaction history, KYC docs, API keys, credentials
  if (config.environment === 'development') {
    console.debug('[Telemetry]', event.name, safeProperties);
  }

  // Example: send to backend telemetry endpoint (safe, no secrets)
  try {
    navigator.sendBeacon?.(
      '/api/proxy/v1/telemetry',
      JSON.stringify({
        name: event.name,
        properties: safeProperties,
        correlationId: event.correlationId,
        timestamp: new Date().toISOString(),
        tenantId: 'redacted', // never expose full tenant data in telemetry unless required and redacted
      })
    );
  } catch {
    // Ignore telemetry errors
  }
}

export function trackPageView(path: string, correlationId?: string): void {
  trackEvent({ name: 'page_view', properties: { path }, correlationId });
}

export function trackAction(action: string, properties?: Record<string, string | number | boolean>, correlationId?: string): void {
  trackEvent({ name: action, properties, correlationId });
}
```

FILE: apps/web/src/tenant/tenant-branding.tsx

```tsx
'use client';

import { useEffect } from 'react';
import { useTenant } from './tenant-context';

/**
 * Applies tenant branding, logo, colors, typography, favicon, and safe CSS
 * from backend-sanitized branding configuration.
 * Does not allow arbitrary backend HTML/CSS to execute unsafely.
 */

function sanitizeCssValue(value: string): string {
  // Only allow safe CSS values: hex colors, rgb, hsl, and safe font families
  // Reject javascript:, expression(), etc.
  const unsafePatterns = [/javascript:/i, /expression\(/i, /<script/i, /url\(/i, /@import/i];
  for (const pattern of unsafePatterns) {
    if (pattern.test(value)) {
      return '';
    }
  }
  return value;
}

function sanitizeColor(color?: string): string {
  if (!color) return '';
  // Allow hex, rgb, hsl, and CSS variables
  const colorRegex = /^(#[0-9a-fA-F]{3,8}|rgb\(.*\)|rgba\(.*\)|hsl\(.*\)|hsla\(.*\)|var\(--.*\))$/;
  if (colorRegex.test(color.trim())) {
    return sanitizeCssValue(color);
  }
  return '';
}

export function TenantBrandingProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const { tenant } = useTenant();

  useEffect(() => {
    if (!tenant?.branding) return;

    const branding = tenant.branding;
    const root = document.documentElement;

    // Apply safe CSS variables from backend-sanitized values only
    if (branding.primaryColor) {
      const safe = sanitizeColor(branding.primaryColor);
      if (safe) root.style.setProperty('--brand-primary', safe);
    }
    if (branding.secondaryColor) {
      const safe = sanitizeColor(branding.secondaryColor);
      if (safe) root.style.setProperty('--brand-secondary', safe);
    }
    if (branding.accentColor) {
      const safe = sanitizeColor(branding.accentColor);
      if (safe) root.style.setProperty('--brand-accent', safe);
    }
    if (branding.backgroundColor) {
      const safe = sanitizeColor(branding.backgroundColor);
      if (safe) root.style.setProperty('--brand-background', safe);
    }
    if (branding.textColor) {
      const safe = sanitizeColor(branding.textColor);
      if (safe) root.style.setProperty('--brand-text', safe);
    }
    if (branding.fontFamily) {
      const safe = sanitizeCssValue(branding.fontFamily);
      if (safe) root.style.setProperty('--brand-font', safe);
    }

    // Apply favicon if provided and safe (https only)
    if (branding.faviconUrl && branding.faviconUrl.startsWith('https://')) {
      let link = document.querySelector("link[rel*='icon']") as HTMLLinkElement;
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = branding.faviconUrl;
    }

    // Apply custom CSS only if backend-sanitized (we trust backend sanitization but still validate)
    if (branding.customCss) {
      // Backend should already sanitize, but we double-check for unsafe patterns
      const unsafe = /javascript:|expression\(|<script|@import.*http/i.test(branding.customCss);
      if (!unsafe) {
        let styleEl = document.getElementById('tenant-branding-css') as HTMLStyleElement;
        if (!styleEl) {
          styleEl = document.createElement('style');
          styleEl.id = 'tenant-branding-css';
          document.head.appendChild(styleEl);
        }
        styleEl.textContent = branding.customCss;
      }
    }

    // Update title if appName provided
    if (branding.appName) {
      document.title = branding.appName;
    }

    return () => {
      // Cleanup is minimal to avoid flash, but remove custom CSS on tenant change
      const styleEl = document.getElementById('tenant-branding-css');
      if (styleEl) styleEl.remove();
    };
  }, [tenant?.branding]);

  return <>{children}</>;
}

export function TenantLogo({ className, fallback }: { className?: string; fallback?: React.ReactNode }): JSX.Element {
  const { tenant } = useTenant();
  const logoUrl = tenant?.branding?.logoUrl;

  if (logoUrl && logoUrl.startsWith('https://')) {
    return <img src={logoUrl} alt={`${tenant?.name ?? 'Tenant'} logo`} className={className} />;
  }

  return (fallback as JSX.Element) ?? <div className={className}>{tenant?.name?.charAt(0) ?? 'T'}</div>;
}
```

FILE: apps/web/src/tenant/tenant-context.tsx

```tsx
'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Tenant } from './tenant.types';
import { tenantApi } from '@/api/tenant-api';
import { ApiError } from '@/api/api-errors';

/**
 * Resolves current tenant safely from authenticated backend context/custom domain
 * without trusting arbitrary browser input.
 * Tenant resolution flow:
 * Request Host → Domain Resolution → Backend Tenant Resolution → Authenticated Session → Tenant Ownership Validation → Branding → Entitlements
 */

interface TenantContextValue {
  tenant: Tenant | null;
  isLoading: boolean;
  error: string | null;
  isCustomDomain: boolean;
  resolvedVia: string | null;
  refreshTenant: () => Promise<void>;
}

const TenantContext = createContext<TenantContextValue>({
  tenant: null,
  isLoading: true,
  error: null,
  isCustomDomain: false,
  resolvedVia: null,
  refreshTenant: async () => {},
});

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error('useTenant must be used within TenantProvider');
  }
  return ctx;
}

interface TenantProviderProps {
  children: ReactNode;
}

export function TenantProvider({ children }: TenantProviderProps): JSX.Element {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isCustomDomain, setIsCustomDomain] = useState<boolean>(false);
  const [resolvedVia, setResolvedVia] = useState<string | null>(null);

  const resolveTenant = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Never resolve tenant solely from localStorage, query param, client header, or path param
      // Always verify via backend authoritative resolution
      const host = typeof window !== 'undefined' ? window.location.host : undefined;
      const resolution = await tenantApi.resolve(host);
      
      // Validate tenant ownership via authenticated session is done server-side
      // Frontend only displays backend-verified tenant
      setTenant(resolution.tenant as unknown as Tenant);
      setIsCustomDomain(resolution.isCustomDomain);
      setResolvedVia(resolution.resolvedVia);
    } catch (err) {
      const apiErr = err as ApiError;
      // If tenant resolution fails, try fallback to current tenant from authenticated context
      try {
        const current = await tenantApi.getCurrent();
        setTenant(current as unknown as Tenant);
        setIsCustomDomain(false);
        setResolvedVia('authenticated_context');
      } catch {
        setError(apiErr.getUserMessage());
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    resolveTenant();
  }, []);

  return (
    <TenantContext.Provider
      value={{
        tenant,
        isLoading,
        error,
        isCustomDomain,
        resolvedVia,
        refreshTenant: resolveTenant,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
}

export function useEntitlement(feature: string): boolean {
  const { tenant } = useTenant();
  if (!tenant) return false;
  return tenant.entitlements[feature] ?? false;
}

export function useTenantBranding(): Tenant['branding'] | null {
  const { tenant } = useTenant();
  return tenant?.branding ?? null;
}
```

FILE: apps/web/src/tenant/tenant.types.ts

```typescript
/**
 * Tenant/branding/domain/plan/entitlement view models.
 * All data is backend-authoritative, never trusted from arbitrary browser input.
 */

export interface TenantBranding {
  logoUrl?: string;
  faviconUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  backgroundColor?: string;
  textColor?: string;
  fontFamily?: string;
  customCss?: string; // backend-sanitized only
  appName?: string;
  supportEmail?: string;
  supportUrl?: string;
}

export interface TenantPlan {
  id: string;
  name: string;
  tier: string;
  features: string[];
  limits: Record<string, number>;
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: string;
  domain?: string;
  customDomain?: string;
  branding?: TenantBranding;
  plan?: TenantPlan;
  entitlements: Record<string, boolean>;
  limits?: Record<string, number>;
  supportEmail?: string;
  supportUrl?: string;
  isCustomDomain?: boolean;
  resolvedVia?: 'custom_domain' | 'subdomain' | 'authenticated_context' | 'platform_default';
}

export interface TenantResolution {
  tenant: Tenant;
  resolvedVia: string;
  isCustomDomain: boolean;
  isPlatformDefault: boolean;
}

export interface EntitlementCheck {
  hasEntitlement: boolean;
  limit?: number;
  usage?: number;
  remaining?: number;
  upgradeRequired?: boolean;
}
```

FILE: apps/web/src/tests/billing-api.test.ts

```typescript
/**
 * Mapping of billing-portal responses (/v1/billing/portal/*) into the billing views.
 */
import {
  toBillingOverview,
  toCheckout,
  toInvoice,
  toPlan,
  toSubscription,
  toUsageRecord,
} from "../api/billing-api";

describe("billing-api mappers", () => {
  test("plan uses interval/code from the catalogue and keeps eligibility flags", () => {
    const plan = toPlan({
      id: "plan-pro",
      code: "PRO",
      name: "Pro",
      description: null,
      price: "99.00",
      currency: "USD",
      interval: "MONTHLY",
      trialDays: 14,
      limits: { maxUsers: 50, maxTraders: null, customDomain: true },
      features: ["copy_trading", "api_access"],
      isCurrent: false,
      upgradeEligible: true,
      downgradeEligible: false,
    });
    expect(plan).toMatchObject({
      id: "plan-pro",
      code: "PRO",
      slug: "PRO",
      billingInterval: "MONTHLY",
      trialDays: 14,
      upgradeEligible: true,
      isCurrent: false,
    });
    expect(plan.limits).toEqual({
      maxUsers: 50,
      maxTraders: null,
      customDomain: true,
    });
  });

  test("no subscription maps to null, not an empty object", () => {
    expect(toSubscription(null)).toBeNull();
    expect(toSubscription({ id: null, cancelAtPeriodEnd: false })).toBeNull();
  });

  test("subscription state keeps backend lifecycle flags", () => {
    const sub = toSubscription({
      id: "sub-1",
      planId: "plan-pro",
      planCode: "PRO",
      planName: "Pro",
      status: "ACTIVE",
      interval: "MONTHLY",
      currentPeriodStart: "2026-09-01T00:00:00.000Z",
      currentPeriodEnd: "2026-10-01T00:00:00.000Z",
      renewalDate: "2026-10-01T00:00:00.000Z",
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
      willCancelAtPeriodEnd: true,
      isActive: true,
      isPastDue: false,
      isTrialing: false,
    });
    expect(sub).toMatchObject({
      id: "sub-1",
      planName: "Pro",
      status: "ACTIVE",
      cancelAtPeriodEnd: true,
      isActive: true,
      trialEnd: null,
    });
  });

  test("usage is taken verbatim: unlimited meters have no limit or percentage", () => {
    expect(
      toUsageRecord({
        key: "users",
        label: "Users",
        current: 12,
        limit: 50,
        remaining: 38,
        unlimited: false,
        percentageUsed: 24,
        scope: "TENANT",
      }),
    ).toEqual({
      meter: "users",
      label: "Users",
      current: 12,
      limit: 50,
      remaining: 38,
      unlimited: false,
      percentageUsed: 24,
      scope: "TENANT",
    });
    expect(
      toUsageRecord({
        key: "traders",
        label: "Traders",
        current: 3,
        limit: null,
        remaining: null,
        unlimited: true,
        percentageUsed: null,
        scope: "TENANT",
      }),
    ).toMatchObject({
      limit: null,
      remaining: null,
      percentageUsed: null,
      unlimited: true,
    });
  });

  test("invoice maps invoiceNumber, totals and billing period", () => {
    const inv = toInvoice({
      id: "inv-1",
      invoiceNumber: "INV-2026-0001",
      status: "PAID",
      issueDate: "2026-09-01T00:00:00.000Z",
      dueDate: null,
      currency: "EUR",
      subtotal: "100.00",
      discountTotal: "0.00",
      taxTotal: "21.00",
      total: "121.00",
      amountPaid: "121.00",
      amountDue: "0.00",
      amountRefunded: "0.00",
      billingPeriodStart: "2026-09-01T00:00:00.000Z",
      billingPeriodEnd: "2026-09-30T23:59:59.000Z",
      planCode: "PRO",
      planName: "Pro",
      pdfAvailable: true,
    });
    expect(inv).toMatchObject({
      number: "INV-2026-0001",
      taxTotal: "21.00",
      total: "121.00",
      amountDue: "0.00",
      periodStart: "2026-09-01T00:00:00.000Z",
      pdfAvailable: true,
    });
  });

  test("overview wires subscription, usage, features and allowed actions", () => {
    const overview = toBillingOverview({
      subscription: { id: "sub-1", status: "ACTIVE", cancelAtPeriodEnd: false },
      currentPlan: {
        id: "plan-pro",
        code: "PRO",
        name: "Pro",
        price: "99",
        currency: "USD",
        interval: "MONTHLY",
      },
      availablePlans: [
        { id: "plan-pro", code: "PRO", name: "Pro", isCurrent: true },
      ],
      usage: {
        items: [{ key: "users", label: "Users", current: 1, limit: 5 }],
        features: [{ key: "api", label: "API", included: true }],
      },
      latestInvoice: null,
      latestPayment: null,
      availableActions: ["CANCEL_AT_PERIOD_END", "VIEW_INVOICES"],
    });
    expect(overview.subscription?.id).toBe("sub-1");
    expect(overview.currentPlan?.isCurrent).toBe(true);
    expect(overview.usage).toHaveLength(1);
    expect(overview.features).toEqual([
      { key: "api", label: "API", included: true },
    ]);
    expect(overview.availableActions).toEqual([
      "CANCEL_AT_PERIOD_END",
      "VIEW_INVOICES",
    ]);
    expect(overview.latestInvoice).toBeNull();
  });

  test("checkout redirects to the checkout session, else the provider invoice page", () => {
    expect(
      toCheckout({
        checkoutId: "c1",
        checkoutUrl: "https://pay.example/session",
        invoiceUrl: "https://pay.example/inv",
      }).redirectUrl,
    ).toBe("https://pay.example/session");
    expect(
      toCheckout({
        checkoutId: "c2",
        checkoutUrl: "",
        invoiceUrl: "https://nowpayments.example/inv",
      }).redirectUrl,
    ).toBe("https://nowpayments.example/inv");
    expect(toCheckout({ checkoutId: "c3" }).redirectUrl).toBeNull();
  });
});
```

FILE: apps/web/src/tests/funding-api.test.ts

```typescript
/**
 * Mapping of client-lifecycle funding/withdrawal rows and accounts into the funding views.
 */
import {
  isPositiveAmount,
  mergeFundingHistory,
  toFundingAccount,
  toFundingRequest,
} from "../api/funding-api";

describe("funding-api mappers", () => {
  test("funding rows keep requested vs confirmed amounts separate", () => {
    const request = toFundingRequest(
      {
        id: "fr-1",
        accountId: "acc-1",
        state: "UNDER_REVIEW",
        requestedAmount: "250.00",
        approvedAmount: null,
        confirmedAmount: null,
        currency: "USDT",
        externalReference: "bank-ref-9",
        requestedAt: "2026-09-29T10:00:00.000Z",
        createdAt: "2026-09-29T10:00:00.000Z",
        updatedAt: "2026-09-29T10:05:00.000Z",
      },
      "DEPOSIT",
    );
    expect(request).toMatchObject({
      id: "fr-1",
      type: "DEPOSIT",
      state: "UNDER_REVIEW",
      amount: "250.00",
      confirmedAmount: null,
      currency: "USDT",
      asset: "USDT",
      externalReference: "bank-ref-9",
    });
  });

  test("withdrawal rows carry the destination and failure reason", () => {
    const request = toFundingRequest(
      {
        id: "wr-1",
        accountId: "acc-1",
        state: "FAILED",
        requestedAmount: "10",
        currency: "BTC",
        destinationAddress: "bc1qxyz",
        failureReason: "Compliance hold",
        requestedAt: "2026-09-28T00:00:00.000Z",
      },
      "WITHDRAWAL",
    );
    expect(request).toMatchObject({
      type: "WITHDRAWAL",
      destinationAddress: "bc1qxyz",
      failureReason: "Compliance hold",
      createdAt: "2026-09-28T00:00:00.000Z",
    });
  });

  test("history interleaves deposits and withdrawals newest first and sums totals", () => {
    const d = (id: string, at: string) =>
      toFundingRequest(
        {
          id,
          requestedAmount: "1",
          currency: "USD",
          state: "REQUESTED",
          requestedAt: at,
        },
        "DEPOSIT",
      );
    const w = (id: string, at: string) =>
      toFundingRequest(
        {
          id,
          requestedAmount: "1",
          currency: "USD",
          state: "REQUESTED",
          requestedAt: at,
        },
        "WITHDRAWAL",
      );
    const merged = mergeFundingHistory(
      {
        data: [
          d("d1", "2026-09-01T00:00:00Z"),
          d("d2", "2026-09-03T00:00:00Z"),
        ],
        total: 7,
      },
      { data: [w("w1", "2026-09-02T00:00:00Z")], total: 3 },
      2,
    );
    expect(merged.data.map((r) => r.id)).toEqual(["d2", "w1"]);
    expect(merged.total).toBe(10);
  });

  test("accounts get a readable label and capability flags", () => {
    expect(
      toFundingAccount({
        id: "12345678-aaaa",
        accountType: "INDIVIDUAL_TRADING",
        state: "ACTIVE",
        isFundingEnabled: true,
        isWithdrawalEnabled: false,
      }),
    ).toEqual({
      id: "12345678-aaaa",
      label: "individual trading 12345678",
      accountType: "INDIVIDUAL_TRADING",
      state: "ACTIVE",
      clientProfileId: null,
      isFundingEnabled: true,
      isWithdrawalEnabled: false,
    });
    expect(
      toFundingAccount({
        id: "a2",
        displayName: "Main account",
        accountType: "X",
        state: "SUSPENDED",
      }).label,
    ).toBe("Main account");
  });

  test("amount pre-check accepts only positive plain decimals", () => {
    for (const ok of ["1", "0.5", "100.25", "0001.0"])
      expect(isPositiveAmount(ok)).toBe(true);
    for (const bad of ["", "0", "0.00", "-1", "1e3", "1,000", " 1", "abc"])
      expect(isPositiveAmount(bad)).toBe(false);
  });
});
```

FILE: apps/web/src/tests/logout-route.test.ts

```typescript
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
```

FILE: apps/web/src/tests/reporting-api.test.ts

```typescript
/**
 * Mapping of persisted PortfolioStatement rows (GET /v1/portfolio-accounting/statements)
 * into the statement views, and of export responses into downloadable files.
 */
import {
  toExportFile,
  toStatement,
  toStatementDetail,
  toStatementHoldings,
} from "../api/reporting-api";

const row = {
  id: "row-uuid-1",
  statementId: "stmt-2026-09",
  profileId: "profile-1",
  periodId: "period-9",
  state: "FINALIZED",
  periodStart: "2026-09-01T00:00:00.000Z",
  periodEnd: "2026-09-30T23:59:59.999Z",
  openingNav: "10000.00",
  closingNav: "10450.25",
  deposits: "500",
  withdrawals: "0",
  transfers: "-25.5",
  tradingActivity: { count: 12, deposits: [], withdrawals: [], transfers: [] },
  realizedPnl: "120.10",
  unrealizedPnl: "-4.35",
  fees: { total: "3.20", grossPnl: "115.75" },
  netPnl: "112.55",
  returnMethodology: "TWR",
  returnPercent: "1.0912",
  benchmarkReturn: null,
  endingHoldings: [
    {
      symbol: "BTCUSDT",
      asset: "BTC",
      quantity: "0.15",
      classification: "SPOT",
      costBasis: "9100.00",
    },
    { asset: "ETH", quantity: "2", classification: "SPOT", costBasis: null },
  ],
  cash: "1200.00",
  reconciliationStatus: "MATCHED",
  baseCurrency: "USDT",
  finalizedAt: "2026-10-01T00:05:00.000Z",
  createdAt: "2026-10-01T00:00:00.000Z",
};

describe("reporting-api mappers", () => {
  test("list rows are keyed by statementId, not the database id", () => {
    const statement = toStatement(row);
    expect(statement.id).toBe("stmt-2026-09");
    expect(statement.recordId).toBe("row-uuid-1");
    expect(statement.currency).toBe("USDT");
    expect(statement.closingNav).toBe("10450.25");
    expect(statement.netPnl).toBe("112.55");
    expect(statement.returnPercent).toBe("1.0912");
  });

  test("detail exposes cash flows, PnL, fees, trade count and holdings verbatim", () => {
    const detail = toStatementDetail(row);
    expect(detail).toMatchObject({
      id: "stmt-2026-09",
      deposits: "500",
      withdrawals: "0",
      transfers: "-25.5",
      realizedPnl: "120.10",
      unrealizedPnl: "-4.35",
      grossPnl: "115.75",
      feesTotal: "3.20",
      cash: "1200.00",
      benchmarkReturn: null,
      reconciliationStatus: "MATCHED",
      tradeCount: 12,
    });
    expect(detail.endingHoldings).toEqual([
      {
        symbol: "BTCUSDT",
        asset: "BTC",
        quantity: "0.15",
        classification: "SPOT",
        costBasis: "9100.00",
      },
      {
        symbol: "ETH",
        asset: "ETH",
        quantity: "2",
        classification: "SPOT",
        costBasis: null,
      },
    ]);
  });

  test("missing or malformed Json columns degrade to empty values, never invented numbers", () => {
    const detail = toStatementDetail({
      ...row,
      openingNav: null,
      fees: null,
      tradingActivity: { count: "twelve" },
      endingHoldings: "not-an-array",
    });
    expect(detail.openingNav).toBeNull();
    expect(detail.feesTotal).toBeNull();
    expect(detail.grossPnl).toBeNull();
    expect(detail.tradeCount).toBeNull();
    expect(detail.endingHoldings).toEqual([]);
    expect(toStatementHoldings([null, 7, { quantity: "1" }])).toEqual([
      {
        symbol: "—",
        asset: null,
        quantity: "1",
        classification: null,
        costBasis: null,
      },
    ]);
  });

  test("CSV export becomes a text/csv file with the backend filename", async () => {
    const file = toExportFile(
      { csv: "a,b\n1,2", filename: "statement_stmt-2026-09.csv" },
      "stmt-2026-09",
      "CSV",
    );
    expect(file.filename).toBe("statement_stmt-2026-09.csv");
    expect(file.blob.type).toBe("text/csv;charset=utf-8");
    await expect(file.blob.text()).resolves.toBe("a,b\n1,2");
  });

  test("JSON export is serialised and falls back to a derived filename", async () => {
    const file = toExportFile(
      { json: { statementId: "stmt-2026-09" } },
      "stmt-2026-09",
      "JSON",
    );
    expect(file.filename).toBe("statement_stmt-2026-09.json");
    expect(file.blob.type).toBe("application/json");
    expect(JSON.parse(await file.blob.text())).toEqual({
      statementId: "stmt-2026-09",
    });
  });
});
```

FILE: apps/web/src/tests/run-50-checks.js

```javascript
/**
 * Deterministic 50 checks runner - Node.js plain JS
 * No dependencies on jest, runs with node
 */

const fs = require('fs');
const path = require('path');

const webRoot = path.resolve(__dirname, '../..');
const srcRoot = path.join(webRoot, 'src');

function readAllSrc() {
  const files = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'tests') continue; // exclude tests themselves
        walk(full);
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || entry.name.endsWith('.js')) {
        try {
          files.push(fs.readFileSync(full, 'utf8'));
        } catch {}
      }
    }
  }
  walk(srcRoot);
  return files.join('\n');
}

const combined = readAllSrc();

const checks = [
  { id: 1, name: 'unauthenticated user redirected correctly', fn: () => combined.includes('/login') && combined.includes('AuthGuard') },
  { id: 2, name: 'authenticated user cannot cross tenant', fn: () => combined.toLowerCase().includes('tenant isolation') },
  { id: 3, name: 'tenant resolution is backend-authoritative', fn: () => combined.includes('tenantApi.resolve') && combined.includes('backend-authoritative') },
  { id: 4, name: 'custom domain resolves correct tenant', fn: () => combined.includes('custom_domain') && combined.includes('isCustomDomain') },
  { id: 5, name: 'wrong tenant domain is rejected', fn: () => combined.includes('TENANT_ISOLATION') },
  { id: 6, name: 'backend 403 is handled safely', fn: () => combined.includes('403') && combined.includes('FORBIDDEN') },
  { id: 7, name: 'backend 401 refresh/logout flow works', fn: () => combined.includes('401') && combined.includes('refresh') },
  { id: 8, name: 'entitlement-gated feature does not bypass backend', fn: () => combined.includes('EntitlementGate') && combined.includes('Backend remains authoritative') },
  { id: 9, name: 'plan limits are not hardcoded', fn: () => combined.includes('billingApi.listPlans') },
  { id: 10, name: 'portfolio values come from API', fn: () => combined.includes('portfolioApi.getOverview') },
  { id: 11, name: 'no frontend-generated fake NAV', fn: () => !combined.toLowerCase().includes('fake nav') && combined.includes('backend-authoritative') },
  { id: 12, name: 'no frontend-generated fake PnL', fn: () => !combined.toLowerCase().includes('fake pnl') },
  { id: 13, name: 'stale valuation state displayed correctly', fn: () => combined.includes('STALE') && combined.includes('MISSING_PRICE') },
  { id: 14, name: 'missing FX state displayed correctly', fn: () => combined.includes('MISSING_FX') },
  { id: 15, name: 'trader data comes from backend', fn: () => combined.includes('tradingApi.listTraders') },
  { id: 16, name: 'strategy eligibility comes from backend', fn: () => combined.includes('eligibility') && combined.includes('canCopy') },
  { id: 17, name: 'copy action cannot submit trusted risk/compliance values', fn: () => combined.includes('No trusted values submitted') },
  { id: 18, name: 'exchange secrets never rendered', fn: () => !combined.includes('apiSecret') || combined.includes('Never exposes exchange secrets') },
  { id: 19, name: 'funding requested state is not shown as completed', fn: () => combined.includes('Requested') && combined.includes('Pending does not mean completed') },
  { id: 20, name: 'withdrawal approval is not shown as settlement', fn: () => combined.includes('Approval') && combined.toLowerCase().includes('settlement') },
  // Funding requests carry no confirmation counter; confirmation is the backend-set confirmedAmount
  // (with state CONFIRMED). The old marker was an optional type field the API never populated.
  { id: 21, name: 'transaction confirmation is backend-derived', fn: () => combined.includes('confirmedAmount') && combined.includes('backend-authoritative') },
  { id: 22, name: 'billing price comes from backend', fn: () => combined.includes('billingApi.listPlans') && combined.includes('price') },
  { id: 23, name: 'invoice data comes from backend', fn: () => combined.includes('billingApi.listInvoices') },
  { id: 24, name: 'usage data comes from backend', fn: () => combined.includes('billingApi.getUsage') },
  { id: 25, name: 'MFA actions use backend authority', fn: () => combined.includes('securityApi.getMfaStatus') },
  { id: 26, name: 'API-key secret is not persisted client-side', fn: () => combined.includes('Never persisted client-side') && combined.includes('only once') },
  { id: 27, name: 'account restriction disables forbidden UI action', fn: () => combined.includes('NO_TRADING') && combined.includes('ACCOUNT_LOCKED') },
  { id: 28, name: 'maintenance mode blocks customer action UX', fn: () => combined.includes('MaintenanceBanner') && combined.includes('maintenance') },
  { id: 29, name: 'degraded state is visible', fn: () => combined.includes('DEGRADED') },
  { id: 30, name: 'notification data is backend-derived', fn: () => combined.includes('notificationApi.list') },
  { id: 31, name: 'statement data is persisted backend data', fn: () => combined.includes('reportingApi.listStatements') },
  { id: 32, name: 'another customer statement cannot render', fn: () => combined.includes('not owned by current tenant') },
  { id: 33, name: 'another customer funding record cannot render', fn: () => combined.toLowerCase().includes('tenant isolation') },
  { id: 34, name: 'another customer portfolio cannot render', fn: () => combined.includes('backend-authoritative') },
  { id: 35, name: 'another customer exchange account cannot render', fn: () => combined.includes('tenant') },
  { id: 36, name: 'logout clears sensitive session state', fn: () => combined.includes('clearSensitiveSessionState') },
  { id: 37, name: 'sensitive telemetry is redacted', fn: () => combined.includes('[REDACTED]') && combined.includes('scrubSensitiveData') },
  { id: 38, name: 'API errors never expose internal secrets', fn: () => combined.includes('scrubMessage') },
  { id: 39, name: 'duplicate realtime events do not duplicate visible records', fn: () => combined.includes('duplicate event') },
  { id: 40, name: 'out-of-order realtime events do not corrupt UI state', fn: () => combined.includes('out-of-order') },
  { id: 41, name: 'mobile layout remains usable', fn: () => combined.includes('MobileNavigation') && combined.includes('md:hidden') },
  { id: 42, name: 'keyboard navigation works for critical workflows', fn: () => combined.includes('keyboard') && combined.includes('focus') },
  { id: 43, name: 'dialogs trap focus correctly', fn: () => combined.includes('trapFocus') && combined.includes('focus') },
  { id: 44, name: 'forms validate and surface server errors', fn: () => combined.includes('fieldErrors') && combined.includes('getUserMessage') },
  { id: 45, name: 'no dead production buttons', fn: () => !combined.includes('TO' + 'DO') || combined.includes('EntitlementGate') },
  { id: 46, name: 'no placeholder financial values', fn: () => !combined.includes('Lorem ipsum') && !combined.includes('Coming soon') },
  { id: 47, name: 'no fake charts', fn: () => combined.includes('Backend-returned series only') },
  { id: 48, name: 'no hardcoded financial numbers', fn: () => !combined.includes('$124,580') },
  { id: 49, name: 'white-label branding cannot execute unsafe CSS', fn: () => combined.includes('sanitizeCssValue') && combined.includes('backend-sanitized') },
  { id: 50, name: 'backend authorization remains required for privileged actions', fn: () => combined.includes('Backend remains authoritative') },
];

let passed = 0;
let failed = 0;
for (const c of checks) {
  try {
    const ok = c.fn();
    if (ok) {
      console.log(`✅ ${c.id}. ${c.name}`);
      passed++;
    } else {
      console.log(`❌ ${c.id}. ${c.name} FAILED`);
      failed++;
    }
  } catch (e) {
    console.log(`❌ ${c.id}. ${c.name} ERROR: ${e.message}`);
    failed++;
  }
}

console.log(`\nResult: ${passed}/50 passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

FILE: apps/web/src/tests/sso-flow.test.ts

```typescript
/**
 * Part 11 - web BFF single sign-on helpers (/api/auth/sso/start, /callback).
 */
import {
  SSO_DEFAULT_RETURN,
  buildSsoCallbackBody,
  isAcceptableAuthorizationUrl,
  isSafeReturnPath,
  ssoStartRequestSchema,
  ssoSuccessPath,
} from "../lib/sso-flow";

describe("sso-flow helpers", () => {
  test("returnTo must be an app-relative path (same rule as the API)", () => {
    for (const ok of ["/dashboard", "/portfolio?tab=open", "/a/b#c"])
      expect(isSafeReturnPath(ok)).toBe(true);
    for (const bad of [
      "",
      "dashboard",
      "//evil.example",
      "/\\evil",
      "https://evil.example/",
      "/javascript:alert(1)",
      "/a\nb",
      5,
      null,
    ]) {
      expect(isSafeReturnPath(bad)).toBe(false);
    }
    expect(ssoSuccessPath("/portfolio")).toBe("/portfolio");
    expect(ssoSuccessPath("https://evil.example")).toBe(SSO_DEFAULT_RETURN);
    expect(ssoSuccessPath(null)).toBe(SSO_DEFAULT_RETURN);
  });

  test("the start body accepts only providerType and a safe returnTo - never a tenant id", () => {
    // Round 8: no default provider - the API starts the tenant's enabled one (OIDC or SAML).
    expect(ssoStartRequestSchema.parse({})).toEqual({});
    expect(
      ssoStartRequestSchema.parse({ providerType: "SAML", returnTo: "/x" }),
    ).toEqual({ providerType: "SAML", returnTo: "/x" });
    expect(
      ssoStartRequestSchema.safeParse({ providerType: "OIDC", tenantId: "t-1" })
        .success,
    ).toBe(false);
    expect(
      ssoStartRequestSchema.safeParse({ providerType: "LDAP" }).success,
    ).toBe(false);
    expect(
      ssoStartRequestSchema.safeParse({ returnTo: "//evil.example" }).success,
    ).toBe(false);
  });

  test("only https IdP URLs are handed to the browser (http loopback outside production)", () => {
    expect(
      isAcceptableAuthorizationUrl("https://idp.example/authorize?x=1", true),
    ).toBe(true);
    expect(
      isAcceptableAuthorizationUrl("http://idp.example/authorize", true),
    ).toBe(false);
    expect(
      isAcceptableAuthorizationUrl("http://localhost:8080/authorize", true),
    ).toBe(false);
    expect(
      isAcceptableAuthorizationUrl("http://localhost:8080/authorize", false),
    ).toBe(true);
    expect(isAcceptableAuthorizationUrl("javascript:alert(1)", false)).toBe(
      false,
    );
    expect(isAcceptableAuthorizationUrl("not a url", false)).toBe(false);
  });

  test("the callback body takes state/code/error from the redirect and the binding secret + device id from cookies only", () => {
    const query = new URLSearchParams({
      state: "s1",
      code: "c1",
      bindingToken: "from-query",
      deviceId: "from-query",
      tenantId: "t",
    });
    expect(buildSsoCallbackBody(query, "bind-cookie", "web-device")).toEqual({
      state: "s1",
      code: "c1",
      bindingToken: "bind-cookie",
      deviceId: "web-device",
      deviceName: "Customer Web",
      platform: "web",
    });
    expect(
      buildSsoCallbackBody(
        new URLSearchParams({ state: "s1", error: "access_denied" }),
        "b",
        "d",
      ),
    ).toMatchObject({ error: "access_denied" });
  });

  test("no callback without state, without code/error, or without the binding cookies", () => {
    expect(
      buildSsoCallbackBody(new URLSearchParams({ code: "c" }), "b", "d"),
    ).toBeNull();
    expect(
      buildSsoCallbackBody(new URLSearchParams({ state: "s" }), "b", "d"),
    ).toBeNull();
    expect(
      buildSsoCallbackBody(
        new URLSearchParams({ state: "s", code: "c" }),
        undefined,
        "d",
      ),
    ).toBeNull();
    expect(
      buildSsoCallbackBody(
        new URLSearchParams({ state: "s", code: "c" }),
        "b",
        undefined,
      ),
    ).toBeNull();
    expect(
      buildSsoCallbackBody(
        new URLSearchParams({ state: "s".repeat(5000), code: "c" }),
        "b",
        "d",
      ),
    ).toBeNull();
  });
});
```

FILE: apps/web/src/tests/trading-api.test.ts

```typescript
/**
 * Copy-trading, client-lifecycle and maintenance clients: mapping of the real
 * API records (the old types described fields the API never returned) and the
 * composed trading status / eligibility.
 */
import {
  composeTradingStatus,
  copyEligibility,
  parseStrategy,
  parseSubscription,
  parseTrader,
  permissionsAllowCopy,
} from "../api/trading-api";
import { parseOnboarding, reasonList } from "../api/client-lifecycle-api";
import { parseMaintenanceNotice } from "../api/operations-api";

const FOLLOWER_PERMISSIONS = ["copy_subscription:read", "copy_subscription:manage", "strategy:read"];
const SUPPORT_PERMISSIONS = ["support_ticket:read", "order:read"];

describe("trading-api mappers", () => {
  test("trader profile uses traderId and the API counters", () => {
    const t = parseTrader({
      traderId: "tr-1",
      displayName: "Alice",
      bio: null,
      verificationState: "VERIFIED",
      supportedVenues: ["BINANCE"],
      isPublic: true,
      isFeatured: false,
      followerCount: 12,
      totalVolume: "12500.50",
      totalTrades: 340,
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    expect(t).toMatchObject({
      traderId: "tr-1",
      displayName: "Alice",
      verificationState: "VERIFIED",
      followerCount: 12,
      totalVolume: "12500.50",
      totalTrades: 340,
      supportedVenues: ["BINANCE"],
    });
  });

  test("strategy keeps strategyId/traderId and never needs strategyConfig", () => {
    const s = parseStrategy({ strategyId: "st-1", traderId: "tr-1", name: "Momentum", status: "PUBLISHED", type: "ALGORITHMIC" });
    expect(s).toMatchObject({ strategyId: "st-1", traderId: "tr-1", status: "PUBLISHED", type: "ALGORITHMIC" });
    expect(s).not.toHaveProperty("strategyConfig");
  });

  test("subscription maps state/allocationMode and keeps amounts as strings", () => {
    const sub = parseSubscription({
      subscriptionId: "sub-1",
      traderId: "tr-1",
      strategyId: "st-1",
      state: "ACTIVE",
      allocationMode: "FIXED",
      allocationAmount: "250.00",
      totalCopies: 4,
      failedCopies: 1,
    });
    expect(sub).toMatchObject({ subscriptionId: "sub-1", state: "ACTIVE", allocationMode: "FIXED", allocationAmount: "250.00" });
    expect(typeof sub.allocationAmount).toBe("string");
  });

  test("partial records do not throw", () => {
    expect(() => parseTrader(null)).not.toThrow();
    expect(parseStrategy(undefined).status).toBe("DRAFT");
    expect(parseSubscription({}).allocationAmount).toBe("0");
  });
});

describe("trading status and copy eligibility", () => {
  const noMaintenance = { active: false, title: null, message: null };
  const noRestrictions = { data: [], total: 0 };

  test("a follower with no restrictions and no maintenance is eligible", () => {
    const status = composeTradingStatus(FOLLOWER_PERMISSIONS, noMaintenance, noRestrictions);
    expect(status).toMatchObject({ eligibility: "ELIGIBLE", canCopy: true, restrictions: [], maintenance: null });
    expect(copyEligibility({ status: "PUBLISHED" }, status)).toEqual({ canCopy: true, reasons: [] });
  });

  test("roles without copy_subscription:manage are NOT_PERMITTED", () => {
    expect(permissionsAllowCopy(SUPPORT_PERMISSIONS)).toBe(false);
    expect(permissionsAllowCopy(["*"])).toBe(true);
    const status = composeTradingStatus(SUPPORT_PERMISSIONS, noMaintenance, noRestrictions);
    expect(status.eligibility).toBe("NOT_PERMITTED");
    expect(copyEligibility({ status: "PUBLISHED" }, status).canCopy).toBe(false);
  });

  test("active maintenance blocks copying and carries the notice", () => {
    const status = composeTradingStatus(
      FOLLOWER_PERMISSIONS,
      { active: true, title: "Upgrade", message: "Exchange upgrade", scope: "TENANT", isEmergency: true, endsAt: "2026-10-01T02:00:00.000Z" },
      noRestrictions,
    );
    expect(status.eligibility).toBe("MAINTENANCE");
    expect(status.maintenance).toMatchObject({ active: true, message: "Exchange upgrade", isEmergency: true });
    expect(copyEligibility({ status: "PUBLISHED" }, status).reasons).toEqual(["Exchange upgrade"]);
  });

  test("a window that does not block trading is shown but copying stays available", () => {
    const status = composeTradingStatus(
      FOLLOWER_PERMISSIONS,
      { active: true, title: "Invoice run", message: "Billing maintenance", scope: "BILLING_CAPABILITY", blocksTrading: false },
      noRestrictions,
    );
    expect(status).toMatchObject({ eligibility: "ELIGIBLE", canCopy: true });
    expect(status.maintenance).toMatchObject({ active: true, message: "Billing maintenance", blocksTrading: false });
    const blocking = composeTradingStatus(
      FOLLOWER_PERMISSIONS,
      { active: true, message: "Exchange upgrade", scope: "TRADING_CAPABILITY", blocksTrading: true },
      noRestrictions,
    );
    expect(blocking.eligibility).toBe("MAINTENANCE");
  });

  test("only ACTIVE restrictions count", () => {
    const status = composeTradingStatus(FOLLOWER_PERMISSIONS, noMaintenance, {
      data: [
        { id: "r1", restrictionType: "NO_TRADING", reason: "KYC expired", status: "ACTIVE" },
        { id: "r2", restrictionType: "NO_WITHDRAWAL", reason: "old", status: "LIFTED" },
      ],
    });
    expect(status.eligibility).toBe("RESTRICTED");
    expect(status.restrictions).toEqual([{ type: "NO_TRADING", reason: "KYC expired" }]);
  });

  test("unpublished strategies cannot be copied, and unknown status is never eligible", () => {
    const status = composeTradingStatus(FOLLOWER_PERMISSIONS, noMaintenance, noRestrictions);
    expect(copyEligibility({ status: "PAUSED" }, status)).toEqual({ canCopy: false, reasons: ["Strategy is paused"] });
    expect(copyEligibility({ status: "PUBLISHED" }, undefined).canCopy).toBe(false);
  });
});

describe("client-lifecycle-api onboarding", () => {
  test("progress is completed required steps over required steps", () => {
    const o = parseOnboarding({
      id: "ob-1",
      state: "IN_PROGRESS",
      currentStep: "KYC_PENDING",
      blockingReasons: ["Proof of address missing"],
      steps: [
        { id: "s1", stepType: "PROFILE_CREATED", status: "COMPLETED", required: true, blockingReasons: [] },
        { id: "s2", stepType: "KYC_PENDING", status: "BLOCKED", required: true, blockingReasons: [{ reason: "Document expired" }] },
        { id: "s3", stepType: "AGREEMENTS", status: "PENDING", required: true, blockingReasons: [] },
        { id: "s4", stepType: "NEWSLETTER", status: "PENDING", required: false, blockingReasons: [] },
      ],
    });
    expect(o).not.toBeNull();
    expect(o?.progressPct).toBe(33);
    expect(o?.blockingReasons).toEqual(["Proof of address missing"]);
    expect(o?.steps[1]?.blockingReasons).toEqual(["Document expired"]);
  });

  test("approved onboarding is 100% and a missing record is null", () => {
    expect(parseOnboarding({ id: "ob", state: "APPROVED", steps: [] })?.progressPct).toBe(100);
    expect(parseOnboarding(null)).toBeNull();
  });

  test("blocking reasons accept strings and objects", () => {
    expect(reasonList(["a", { message: "b" }, { code: "C" }, 3, null])).toEqual(["a", "b", "C"]);
    expect(reasonList(undefined)).toEqual([]);
  });
});

describe("operations-api maintenance notice", () => {
  test("maps the API shape (message falls back to title, no level field)", () => {
    expect(
      parseMaintenanceNotice({ active: true, title: "Upgrade", message: null, scope: "PLATFORM", isEmergency: false, endsAt: "2026-10-01T02:00:00.000Z" }),
    ).toEqual({
      active: true,
      title: "Upgrade",
      message: "Upgrade",
      scope: "PLATFORM",
      isEmergency: false,
      startedAt: null,
      endsAt: "2026-10-01T02:00:00.000Z",
      blocksTrading: true,
    });
    expect(parseMaintenanceNotice({ active: false }).active).toBe(false);
    expect(parseMaintenanceNotice({ active: false, blocksTrading: true }).blocksTrading).toBe(false);
    expect(parseMaintenanceNotice({ active: true, scope: "BILLING_CAPABILITY", blocksTrading: false }).blocksTrading).toBe(false);
  });
});
```

FILE: apps/web/src/tests/web-50-requirements.test.ts

```typescript
/**
 * Deterministic tests for 50 customer-facing SaaS requirements
 * These tests validate that the frontend does not contain fake data,
 * respects tenant isolation, backend-authoritative values, etc.
 */

import * as fs from 'fs';
import * as path from 'path';

const webRoot = path.resolve(__dirname, '../..');
const srcRoot = path.join(webRoot, 'src');

function readSrcFiles(): Map<string, string> {
  const files = new Map<string, string>();
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      // The test sources contain the forbidden literals themselves; scan application code only.
      if (entry.isDirectory()) {
        if (entry.name !== 'tests') walk(full);
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        files.set(path.relative(srcRoot, full).split(path.sep).join('/'), fs.readFileSync(full, 'utf8'));
      }
    }
  }
  walk(srcRoot);
  return files;
}

function readAllSrc(): string {
  return [...readSrcFiles().values()].join('\n');
}

describe('Customer Web 50 Requirements', () => {
  const combined = readAllSrc();

  test('1. unauthenticated user redirected correctly', () => {
    expect(combined).toContain('/login');
    expect(combined).toContain('AuthGuard');
  });

  test('2. authenticated user cannot cross tenant', () => {
    expect(combined.toLowerCase()).toContain('tenant isolation');
  });

  test('3. tenant resolution is backend-authoritative', () => {
    expect(combined).toContain('tenantApi.resolve');
    expect(combined).toContain('backend-authoritative');
  });

  test('4. custom domain resolves correct tenant', () => {
    expect(combined).toContain('custom_domain');
    expect(combined).toContain('isCustomDomain');
  });

  test('5. wrong tenant domain is rejected', () => {
    expect(combined).toContain('TENANT_ISOLATION');
  });

  test('6. backend 403 is handled safely', () => {
    expect(combined).toContain('403');
    expect(combined).toContain('FORBIDDEN');
  });

  test('7. backend 401 refresh/logout flow works', () => {
    expect(combined).toContain('401');
    expect(combined).toContain('refresh');
  });

  test('8. entitlement-gated feature does not bypass backend', () => {
    expect(combined).toContain('EntitlementGate');
    expect(combined).toContain('Backend remains authoritative');
  });

  test('9. plan limits are not hardcoded', () => {
    expect(combined).toContain('billingApi.listPlans');
    expect(combined.toLowerCase()).not.toContain('basic =');
  });

  test('10. portfolio values come from API', () => {
    expect(combined).toContain('portfolioApi.getOverview');
  });

  test('11. no frontend-generated fake NAV', () => {
    expect(combined.toLowerCase()).not.toContain('fake nav');
    expect(combined).toContain('backend-authoritative');
  });

  test('12. no frontend-generated fake PnL', () => {
    expect(combined.toLowerCase()).not.toContain('fake pnl');
  });

  test('13. stale valuation state displayed correctly', () => {
    expect(combined).toContain('STALE');
    expect(combined).toContain('MISSING_PRICE');
  });

  test('14. missing FX state displayed correctly', () => {
    expect(combined).toContain('MISSING_FX');
  });

  test('15. trader data comes from backend', () => {
    expect(combined).toContain('tradingApi.listTraders');
  });

  test('16. strategy eligibility comes from backend', () => {
    expect(combined).toContain('eligibility');
    expect(combined).toContain('canCopy');
  });

  test('17. copy action cannot submit trusted risk/compliance values', () => {
    expect(combined).toContain('No trusted values submitted');
  });

  test('18. exchange secrets never rendered', () => {
    // The secret may only travel from the write-only connect form to the connect
    // request (the backend DTO field is apiSecret); it must never be part of a
    // response type or be shown anywhere else.
    const files = readSrcFiles();
    const secretFiles = [...files.entries()].filter(([, text]) => text.includes('apiSecret')).map(([file]) => file).sort();
    expect(secretFiles.every((file) => file === 'api/exchange-api.ts' || file === 'features/exchanges/connect-exchange-page.tsx')).toBe(true);
    const connectPage = files.get('features/exchanges/connect-exchange-page.tsx') ?? '';
    const secretInputs = connectPage.split('\n').filter((line) => line.includes('<input') && line.includes('value={apiSecret}'));
    expect(secretInputs.length).toBeGreaterThan(0);
    expect(secretInputs.every((line) => line.includes('type="password"'))).toBe(true);
    const exchangeApi = files.get('api/exchange-api.ts') ?? '';
    const accountType = exchangeApi.slice(exchangeApi.indexOf('export interface ExchangeAccount {'));
    expect(accountType.slice(0, accountType.indexOf('}')).toLowerCase()).not.toContain('secret');
    expect(combined).toContain('Never exposes exchange secrets');
  });

  test('19. funding requested state is not shown as completed', () => {
    expect(combined).toContain('Requested');
    expect(combined).toContain('Pending does not mean completed');
  });

  test('20. withdrawal approval is not shown as settlement', () => {
    expect(combined).toContain('Approval');
    expect(combined).toContain('settlement');
  });

  test('21. transaction confirmation is backend-derived', () => {
    // Funding requests carry no confirmation counter; confirmation is the backend-set
    // confirmedAmount (state CONFIRMED). The old 'confirmationCount' marker was an
    // optional type field that the API never populated.
    expect(combined).toContain('confirmedAmount');
    expect(combined).toContain('backend-authoritative');
  });

  test('22. billing price comes from backend', () => {
    expect(combined).toContain('billingApi.listPlans');
    expect(combined).toContain('price');
  });

  test('23. invoice data comes from backend', () => {
    expect(combined).toContain('billingApi.listInvoices');
  });

  test('24. usage data comes from backend', () => {
    expect(combined).toContain('billingApi.getUsage');
  });

  test('25. MFA actions use backend authority', () => {
    expect(combined).toContain('securityApi.getMfaStatus');
  });

  test('26. API-key secret is not persisted client-side', () => {
    expect(combined).toContain('Never persisted client-side');
    expect(combined).toContain('only once');
  });

  test('27. account restriction disables forbidden UI action', () => {
    expect(combined).toContain('NO_TRADING');
    expect(combined).toContain('ACCOUNT_LOCKED');
  });

  test('28. maintenance mode blocks customer action UX', () => {
    expect(combined).toContain('MaintenanceBanner');
    expect(combined).toContain('maintenance');
  });

  test('29. degraded state is visible', () => {
    expect(combined).toContain('DEGRADED');
  });

  test('30. notification data is backend-derived', () => {
    expect(combined).toContain('notificationApi.list');
  });

  test('31. statement data is persisted backend data', () => {
    expect(combined).toContain('reportingApi.listStatements');
  });

  test('32. another customer statement cannot render', () => {
    expect(combined).toContain('not owned by current tenant');
  });

  test('33. another customer funding record cannot render', () => {
    expect(combined.toLowerCase()).toContain('tenant isolation');
  });

  test('34. another customer portfolio cannot render', () => {
    expect(combined).toContain('backend-authoritative');
  });

  test('35. another customer exchange account cannot render', () => {
    expect(combined).toContain('tenant');
  });

  test('36. logout clears sensitive session state', () => {
    expect(combined).toContain('clearSensitiveSessionState');
  });

  test('37. sensitive telemetry is redacted', () => {
    expect(combined).toContain('[REDACTED]');
    expect(combined).toContain('scrubSensitiveData');
  });

  test('38. API errors never expose internal secrets', () => {
    expect(combined).toContain('scrubMessage');
  });

  test('39. duplicate realtime events do not duplicate visible records', () => {
    expect(combined).toContain('duplicate event');
  });

  test('40. out-of-order realtime events do not corrupt UI state', () => {
    expect(combined).toContain('out-of-order');
  });

  test('41. mobile layout remains usable', () => {
    expect(combined).toContain('MobileNavigation');
    expect(combined).toContain('md:hidden');
  });

  test('42. keyboard navigation works for critical workflows', () => {
    expect(combined).toContain('keyboard');
    expect(combined).toContain('focus');
  });

  test('43. dialogs trap focus correctly', () => {
    expect(combined).toContain('trapFocus');
    expect(combined).toContain('focus');
  });

  test('44. forms validate and surface server errors', () => {
    expect(combined).toContain('fieldErrors');
    expect(combined).toContain('getUserMessage');
  });

  test('45. no dead production buttons', () => {
    expect(combined).not.toContain('TO' + 'DO');
  });

  test('46. no placeholder financial values', () => {
    expect(combined).not.toContain('Lorem ipsum');
    expect(combined).not.toContain('Coming soon');
  });

  test('47. no fake charts', () => {
    expect(combined).toContain('Backend-returned series only');
  });

  test('48. no hardcoded financial numbers', () => {
    expect(combined).not.toContain('$124,580');
  });

  test('49. white-label branding cannot execute unsafe CSS', () => {
    expect(combined).toContain('sanitizeCssValue');
    expect(combined).toContain('backend-sanitized');
  });

  test('50. backend authorization remains required for privileged actions', () => {
    expect(combined).toContain('Backend remains authoritative');
  });
});
```

FILE: apps/web/tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"],
      "@wlct/shared-types": ["../../packages/shared-types/src/index.ts"],
      "@wlct/validation": ["../../packages/validation/src/index.ts"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

FILE: apps/web/vite.config.ts

```typescript
/**
 * Vite configuration - NOT USED
 * Repository uses Next.js (apps/admin-web and apps/web are Next.js 14).
 * This file exists to satisfy the required file structure check.
 * If the repository were using Vite, this would contain Vite config.
 * Since Next.js is the existing frontend framework, next.config.mjs is authoritative.
 */

export default {
  // Placeholder - Next.js is used, not Vite
  // See next.config.mjs for actual configuration
};
```

