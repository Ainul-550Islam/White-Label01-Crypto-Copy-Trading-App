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
    const expected = getCsrfToken();

    if (!expected || submitted !== expected) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: 'Invalid CSRF token.' } },
        { status: 403 },
      );
    }
  }

  const token = getAccessToken();

  if (!token) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'No active session.' } },
      { status: 401 },
    );
  }

  // Path traversal guard: segments come from the URL and must stay simple.
  if (segments.some((segment) => segment.includes('..') || segment.includes('\\'))) {
    return NextResponse.json(
      { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid path.' } },
      { status: 400 },
    );
  }

  const incoming = new URL(request.url);
  const base = env.API_BASE_URL.replace(/\/+$/, '');
  const target = new URL(`${base}/${publicEnv.apiVersion}/${segments.join('/')}`);
  target.search = incoming.search;

  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${token}`,
    'x-tenant-slug': env.ADMIN_TENANT_SLUG,
    'x-request-id': request.headers.get('x-request-id') ?? randomUUID(),
  };

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
