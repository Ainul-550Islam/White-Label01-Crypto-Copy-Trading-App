import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';

import { serverEnv, publicEnv } from '@/lib/env';
import { getAccessToken, getCsrfToken } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Same-origin proxy to the platform API.
 *
 * Why a proxy at all: it keeps the bearer token in an httpOnly cookie (so XSS
 * cannot steal a session), removes the need for CORS on the API, and gives the
 * console one enforcement point for CSRF on state-changing verbs.
 *
 * Only paths under the API's versioned namespace are forwarded, and the
 * Authorization header is attached here - never by the browser.
 */
const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** Response headers that must not be echoed back to the browser. */
const STRIPPED_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'set-cookie',
]);

async function handle(request: Request, segments: string[]): Promise<NextResponse> {
  const env = serverEnv();

  if (MUTATING_METHODS.has(request.method)) {
    const submitted = request.headers.get('x-csrf-token');
    const expected = await getCsrfToken();

    if (!expected || submitted !== expected) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Invalid CSRF token.' } },
        { status: 403 },
      );
    }
  }

  const token = await getAccessToken();

  if (!token) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'No active session.' } },
      { status: 401 },
    );
  }

  // Path traversal guard: segments come from the URL and must stay simple.
  if (segments.some((segment) => !segment || segment.includes('..') || /[\\/\x00-\x1f\x7f%]/.test(segment))) {
    return NextResponse.json(
      { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid path.' } },
      { status: 400 },
    );
  }

  const incoming = new URL(request.url);
  const base = env.API_BASE_URL.replace(/\/+$/, '');
  // Browser clients may already include the configured version. Add it once,
  // just as serverFetch does, rather than forwarding /v1/v1/....
  const unversioned = segments[0] === publicEnv.apiVersion ? segments.slice(1) : segments;
  const target = new URL(`${base}/${publicEnv.apiVersion}/${unversioned.join('/')}`);
  target.search = incoming.search;

  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${token}`,
    'x-tenant-slug': env.ADMIN_TENANT_SLUG,
    'x-request-id': request.headers.get('x-request-id') ?? randomUUID(),
  };

  const idempotencyKey = request.headers.get('idempotency-key');
  if (idempotencyKey && MUTATING_METHODS.has(request.method)) {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey)) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid request key.' } },
        { status: 400 },
      );
    }
    headers['Idempotency-Key'] = idempotencyKey;
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
      body:
        request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : await request.arrayBuffer(),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'The platform API is unreachable. Please try again shortly.',
        },
      },
      { status: 503 },
    );
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  });

  responseHeaders.set('Cache-Control', 'no-store');

  // Some webhook controller responses currently include stored hash/ciphertext
  // fields. Strip them at the server-side proxy boundary, before they reach a
  // browser. Only create/rotate may return the explicitly issued secret once.
  if (unversioned[0] === 'developer-platform' && unversioned[1] === 'webhooks' && upstream.status !== 204) {
    const issuing = request.method === 'POST' &&
      (unversioned.length === 2 || (unversioned.length === 4 && unversioned[3] === 'rotate-secret'));
    const type = upstream.headers.get('content-type') ?? '';
    if (!type.toLowerCase().includes('application/json')) {
      return NextResponse.json({ success: false, error: { code: 'BAD_GATEWAY', message: 'Unexpected platform response.' } }, { status: 502 });
    }
    try {
      const raw: unknown = await upstream.json();
      const safe = scrubWebhookResponse(raw, issuing);
      return NextResponse.json(safe, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
    } catch {
      return NextResponse.json({ success: false, error: { code: 'BAD_GATEWAY', message: 'Unexpected platform response.' } }, { status: 502 });
    }
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

function scrubWebhookResponse(value: unknown, allowIssuedSecret: boolean, level = 0): unknown {
  if (Array.isArray(value)) return value.map((item) => scrubWebhookResponse(item, false, level + 1));
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [name, item] of Object.entries(value)) {
    if (/secret|password|token|idempotencykey/i.test(name)) {
      // The issued secret may only be a top-level result field, or inside the
      // normal success envelope's data object, never inside a subscription.
      if (name === 'secret' && allowIssuedSecret && level <= 1 && typeof item === 'string') result[name] = item;
      continue;
    }
    result[name] = scrubWebhookResponse(item, allowIssuedSecret && name === 'data', level + 1);
  }
  return result;
}

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  return handle(request, (await context.params).path);
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  return handle(request, (await context.params).path);
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  return handle(request, (await context.params).path);
}

export async function PUT(request: Request, context: RouteContext): Promise<NextResponse> {
  return handle(request, (await context.params).path);
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  return handle(request, (await context.params).path);
}
