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
