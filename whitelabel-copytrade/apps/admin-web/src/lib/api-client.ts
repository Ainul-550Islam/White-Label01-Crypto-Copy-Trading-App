'use client';

import { ApiError } from './api-error';

/**
 * Browser-side API client.
 *
 * It talks to this app's own `/api/proxy/*` route rather than the platform API
 * directly. That keeps the access token in an httpOnly cookie, avoids CORS
 * entirely, and gives one place to handle refresh-on-401.
 */
const PROXY_PREFIX = '/api/proxy';

function readCsrfCookie(): string {
  const match = document.cookie.match(/(?:^|;\s*)wlct_csrf=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

export interface ClientFetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  searchParams?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: ClientFetchOptions, retry: boolean): Promise<T> {
  const { method = 'GET', body, searchParams, signal } = options;

  const url = new URL(
    `${PROXY_PREFIX}${path.startsWith('/') ? path : `/${path}`}`,
    window.location.origin,
  );

  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = { accept: 'application/json' };

  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  if (method !== 'GET') {
    headers['x-csrf-token'] = readCsrfCookie();
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    signal,
  });

  if (response.status === 401 && retry) {
    // One silent refresh attempt, then give up and let the caller redirect.
    const refreshed = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-csrf-token': readCsrfCookie() },
    });

    if (refreshed.ok) {
      return request<T>(path, options, false);
    }
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const payload: unknown = text.length > 0 ? JSON.parse(text) : undefined;

  if (!response.ok) {
    throw ApiError.fromBody(response.status, payload);
  }

  const envelope = payload as { success?: boolean; data?: T } | undefined;
  return envelope && 'data' in envelope ? (envelope.data as T) : (payload as T);
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
