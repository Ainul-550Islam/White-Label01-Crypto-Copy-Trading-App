'use client';

import { ApiError } from './api-errors';
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
}

async function request<T>(path: string, options: ClientFetchOptions, retry: boolean): Promise<T> {
  const { method = 'GET', body, searchParams, signal, correlationId } = options;

  const url = new URL(
    `${PROXY_PREFIX}${path.startsWith('/') ? path : `/${path}`}`,
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

    if (response.status === 401 && retry && !options.skipAuthRefresh) {
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
};

export function createAbortController(): AbortController {
  return new AbortController();
}
