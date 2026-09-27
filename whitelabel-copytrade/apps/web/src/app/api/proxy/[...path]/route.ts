import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { serverEnv, publicEnv } from '@/lib/env';
import { getAccessToken, getCsrfToken } from '@/lib/session';

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
  if (!token) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'No active session.' } },
      { status: 401 }
    );
  }

  if (segments.some((segment) => segment.includes('..') || segment.includes('\\'))) {
    return NextResponse.json(
      { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid path.' } },
      { status: 400 }
    );
  }

  const incoming = new URL(request.url);
  const base = env.API_BASE_URL.replace(/\/+$/, '');
  const target = new URL(`${base}/${publicEnv.apiVersion}/${segments.join('/')}`);
  target.search = incoming.search;

  const headers: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${token}`,
    'x-request-id': request.headers.get('x-request-id') ?? randomUUID(),
    'x-correlation-id': request.headers.get('x-correlation-id') ?? randomUUID(),
  };

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
