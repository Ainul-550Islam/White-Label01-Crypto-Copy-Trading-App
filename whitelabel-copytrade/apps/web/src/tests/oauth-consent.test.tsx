import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ConsentPage from '@/features/oauth/consent-page';
import { AuthContext } from '@/auth/auth.store';
import { parseAuthorizationQuery } from '@/features/oauth/oauth-api';
import { oauthCopy } from '@/features/oauth/oauth-copy';

const good = new URLSearchParams({ response_type: 'code', client_id: 'client-1', redirect_uri: 'https://client.example/callback', scope: 'profile:read', state: '0123456789abcdef', code_challenge: 'A'.repeat(43), code_challenge_method: 'S256' });

test('parses a bounded PKCE profile request and rejects ambiguous or unsafe inputs', () => {
  expect(parseAuthorizationQuery(good.toString())).toMatchObject({ requestedScopes: ['profile:read'], codeChallengeMethod: 'S256' });
  for (const [key, value] of [['response_type', 'token'], ['scope', 'profile:read webhooks:manage'], ['redirect_uri', 'https://evil.example/cb?next=x'], ['code_challenge_method', 'plain'], ['state', 'short'], ['redirect_uri', 'http://example.com/cb']] as const) {
    const params = new URLSearchParams(good); params.set(key, value);
    expect(parseAuthorizationQuery(params.toString())).toBeNull();
  }
  const duplicate = new URLSearchParams(good); duplicate.append('redirect_uri', 'https://evil.example');
  expect(parseAuthorizationQuery(duplicate.toString())).toBeNull();
  const unknown = new URLSearchParams(good); unknown.set('extra', 'anything');
  expect(parseAuthorizationQuery(unknown.toString())).toBeNull();
});

test('initial consent view is accessible and does not show an unverified client', () => {
  const html = renderToStaticMarkup(<AuthContext.Provider value={{ session: null, isLoading: true, isAuthenticated: false, error: null, refreshSession: async () => {}, logout: async () => {} }}><ConsentPage /></AuthContext.Provider>);
  expect(html).toContain('role="status"');
  expect(html).toContain('Connect an application');
  expect(html).not.toContain('Allow access');
  expect(Object.keys(oauthCopy)).toEqual(['en', 'bn', 'ar', 'es', 'tr']);
});
