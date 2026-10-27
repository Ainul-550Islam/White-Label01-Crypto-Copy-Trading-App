'use client';
import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/auth/auth.store';
import { newIdempotencyKey } from '@/lib/idempotency-key';
import { oauthApi, parseAuthorizationQuery, type AuthorizationInput, type AuthorizationRequest } from './oauth-api';
import { oauthCopy, type OAuthLocale } from './oauth-copy';
import { LocaleSelector } from './locale-selector';

export default function ConsentPage(): JSX.Element {
  const auth = useAuth();
  const [locale, setLocale] = useState<OAuthLocale>('en');
  const [input, setInput] = useState<AuthorizationInput | null | undefined>();
  const [request, setRequest] = useState<AuthorizationRequest | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const keys = useRef({ authorize: newIdempotencyKey('authorize'), consent: newIdempotencyKey('consent'), code: newIdempotencyKey('code') });
  const t = oauthCopy[locale];
  useEffect(() => { const language = navigator.language.split('-')[0] as OAuthLocale; if (language in oauthCopy) setLocale(language); setInput(parseAuthorizationQuery(window.location.search)); }, []);
  useEffect(() => {
    if (!auth.isAuthenticated || !input) return;
    let active = true;
    oauthApi.authorize(input, keys.current.authorize).then((value) => {
      if (!active) return;
      if (!value || typeof value.grantId !== 'string' || !value.grantId || typeof value.clientName !== 'string' || !value.clientName ||
          !['SANDBOX', 'PRODUCTION'].includes(value.environment) || value.redirectTo !== input.redirectUri ||
          !Array.isArray(value.consentedScopes) || value.consentedScopes.length !== 1 || value.consentedScopes[0] !== 'profile:read') setFailed(true);
      else setRequest(value);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [auth.isAuthenticated, input]);
  async function decide(decision: 'GRANTED' | 'DENIED'): Promise<void> {
    if (!request || !input || locked.current) return;
    locked.current = true; setBusy(true); setFailed(false);
    try {
      const recorded = await oauthApi.consent(request.grantId, decision, keys.current.consent);
      if (!recorded || recorded.grantId !== request.grantId || recorded.state !== decision) throw new Error('Invalid response');
      const destination = new URL(request.redirectTo);
      if (decision === 'GRANTED') {
        const issued = await oauthApi.code(request.grantId, keys.current.code);
        if (!issued || issued.redirectTo !== input.redirectUri || issued.state !== input.state || typeof issued.code !== 'string' || !issued.code) throw new Error('Invalid response');
        destination.searchParams.set('code', issued.code);
      } else destination.searchParams.set('error', 'access_denied');
      destination.searchParams.set('state', input.state);
      window.location.replace(destination.toString());
    } catch { setFailed(true); setBusy(false); }
  }
  return <section lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} className="mx-auto max-w-xl space-y-5 p-6">
    <LocaleSelector locale={locale} onChange={setLocale} label={t.language}/>
    <h1 className="text-2xl font-semibold">{t.title}</h1>
    {auth.isLoading || input === undefined ? <p role="status">{t.loading}</p> : !input || failed ? <p role="alert">{!input ? t.invalid : t.failure}</p> : !auth.isAuthenticated ? <div className="space-y-3"><p>{t.signin}</p><a className="underline" href="/login" target="_blank" rel="noopener noreferrer">{t.login}</a><br/><button className="rounded border p-2" onClick={() => void auth.refreshSession()}>{t.refresh}</button></div> : !request ? <p role="status">{t.loading}</p> : <div className="space-y-4">
      <p><strong>{request.clientName}</strong> {t.intro}</p>
      <p>{t.account}: <strong>{auth.session?.user.email}</strong><br/>{t.tenant}: {auth.session?.tenant.name}</p>
      <div className="rounded border p-4"><h2 className="font-semibold">{t.permission}</h2><p>{t.permissionDetail}</p></div>
      <p className="break-all">{t.destination}: <strong>{request.redirectTo}</strong><br/>{t.environment}: {request.environment}</p>
      <div className="flex flex-wrap gap-3"><button disabled={busy} onClick={() => void decide('GRANTED')} className="rounded bg-primary p-3 text-white">{t.approve}</button><button disabled={busy} onClick={() => void decide('DENIED')} className="rounded border p-3">{t.deny}</button></div>
      {busy && <p role="status" aria-live="polite">{t.working}</p>}
    </div>}
    <p><a className="underline" href="/settings/connected-apps">{t.manage}</a></p>
  </section>;
}
