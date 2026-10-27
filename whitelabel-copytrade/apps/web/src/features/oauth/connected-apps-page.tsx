'use client';
import type { JSX } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { newIdempotencyKey } from '@/lib/idempotency-key';
import { oauthApi, type UserGrant } from './oauth-api';
import { oauthCopy, type OAuthLocale } from './oauth-copy';
import { LocaleSelector } from './locale-selector';

export default function ConnectedAppsPage(): JSX.Element {
  const [locale, setLocale] = useState<OAuthLocale>('en');
  const [rows, setRows] = useState<UserGrant[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [history, setHistory] = useState<Array<string | undefined>>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [message, setMessage] = useState(false);
  const keys = useRef<Record<string, string>>({});
  const t = oauthCopy[locale];
  useEffect(() => { const language = navigator.language.split('-')[0] as OAuthLocale; if (language in oauthCopy) setLocale(language); }, []);
  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try { const page = await oauthApi.grants(cursor); setRows(page.rows); setNext(page.nextCursor); }
    catch { setRows([]); setNext(null); setError(true); }
    finally { setLoading(false); }
  }, [cursor]);
  useEffect(() => { void load(); }, [load]);
  async function revoke(row: UserGrant): Promise<void> {
    if (busyId || !window.confirm(t.confirm)) return;
    setBusyId(row.id); setError(false); setMessage(false);
    const key = keys.current[row.id] ?? newIdempotencyKey('revoke');
    keys.current[row.id] = key;
    try { await oauthApi.revoke(row.id, key); setMessage(true); await load(); }
    catch { setError(true); await load(); setError(true); }
    finally { setBusyId(null); }
  }
  return <section lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} className="mx-auto max-w-3xl space-y-5 p-6">
    <LocaleSelector locale={locale} onChange={setLocale} label={t.language}/><h1 className="text-2xl font-semibold">{t.listTitle}</h1><p>{t.listIntro}</p>
    {error && <p role="alert">{t.loadError}</p>}{message && <p role="status" aria-live="polite">{t.revoked}</p>}
    {loading ? <p role="status">{t.loading}</p> : rows.length === 0 && !error ? <p>{t.empty}</p> : <ul className="space-y-3">{rows.map((row) => <li key={row.id} className="rounded border p-4">
      <h2 className="font-semibold">{row.clientName}</h2><p>{t.permission} · {t.environment}: {row.environment}</p>
      <time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleDateString(locale)}</time><br/>
      <button className="mt-2 rounded border p-2" disabled={Boolean(busyId)} onClick={() => void revoke(row)} aria-label={`${t.revoke}: ${row.clientName}`}>{busyId === row.id ? t.working : t.revoke}</button>
    </li>)}</ul>}
    <div className="flex gap-3">{history.length > 0 && <button className="rounded border p-2" onClick={() => { setCursor(history[history.length - 1]); setHistory(history.slice(0, -1)); }}>{t.back}</button>}
      {next && <button className="rounded border p-2" onClick={() => { setHistory([...history, cursor]); setCursor(next); }}>{t.next}</button>}</div>
  </section>;
}
