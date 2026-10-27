'use client';
import { apiClient } from '@/api/api-client';

export interface AuthorizationInput {
  clientId: string; redirectUri: string; requestedScopes: string[]; state: string;
  codeChallenge: string; codeChallengeMethod: 'S256'; nonce?: string;
}
export interface AuthorizationRequest {
  grantId: string; redirectTo: string; clientName: string; environment: string; consentedScopes: string[];
}
export interface UserGrant { id: string; clientName: string; environment: string; scopes: string[]; createdAt: string }
export const oauthApi = {
  authorize: (body: AuthorizationInput, idempotencyKey: string) =>
    apiClient.post<AuthorizationRequest>('/v1/developer-platform/oauth/authorize', body, { idempotencyKey }),
  consent: (grantId: string, decision: 'GRANTED' | 'DENIED', idempotencyKey: string) =>
    apiClient.post<{ grantId: string; state: string }>('/v1/developer-platform/oauth/consent', { grantId, decision }, { idempotencyKey }),
  code: (grantId: string, idempotencyKey: string) =>
    apiClient.post<{ code: string; redirectTo: string; state: string }>('/v1/developer-platform/oauth/code', { grantId }, { idempotencyKey }),
  grants: (cursor?: string) => apiClient.get<{ rows: UserGrant[]; nextCursor: string | null }>('/v1/developer-platform/oauth/grants', { searchParams: { cursor } }),
  revoke: (id: string, idempotencyKey: string) => apiClient.post<void>(`/v1/developer-platform/oauth/grants/${encodeURIComponent(id)}/revoke`, {}, { idempotencyKey }),
};

/** Parse one unambiguous OAuth authorization request without trusting its redirect. */
export function parseAuthorizationQuery(search: string): AuthorizationInput | null {
  const p = new URLSearchParams(search);
  const allowed = new Set(['response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'code_challenge', 'code_challenge_method', 'nonce']);
  for (const key of p.keys()) if (!allowed.has(key) || p.getAll(key).length !== 1) return null;
  const clientId = p.get('client_id') ?? '', redirectUri = p.get('redirect_uri') ?? '', state = p.get('state') ?? '';
  const codeChallenge = p.get('code_challenge') ?? '', nonce = p.get('nonce') ?? undefined;
  const scopes = (p.get('scope') ?? '').trim().split(/\s+/).filter(Boolean);
  if (p.get('response_type') !== 'code' || p.get('code_challenge_method') !== 'S256' ||
      !clientId || clientId.length > 128 || state.length < 16 || state.length > 128 ||
      !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge) || (nonce !== undefined && nonce.length > 128) ||
      scopes.length !== 1 || scopes[0] !== 'profile:read' || redirectUri.length > 512) return null;
  try {
    const url = new URL(redirectUri);
    if (!url.hostname || url.username || url.password || url.search || url.hash ||
        !(url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost'))) return null;
  } catch { return null; }
  return { clientId, redirectUri, requestedScopes: scopes, state, codeChallenge, codeChallengeMethod: 'S256', ...(nonce ? { nonce } : {}) };
}
