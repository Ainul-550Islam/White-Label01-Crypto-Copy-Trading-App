'use client';
import type { JSX } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { newIdempotencyKey } from '@/lib/idempotency-key';
import { usePreferredLocale } from '@/lib/preferred-locale';
import { oauthApi, type UserGrant } from './oauth-api';
import { oauthCopy, type OAuthLocale } from './oauth-copy';
import { LocaleSelector } from './locale-selector';

export default function ConnectedAppsPage(): JSX.Element {
  const [locale, setLocale] = usePreferredLocale(oauthCopy, 'en');
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
  // A promise chain rather than an async function: this is called from the effect below, and React
  // 19 rejects a function that writes state synchronously on the way in. Every write here happens in
  // a settled callback. Paths that start a new page also set `loading` in their own event handler.
  const load = useCallback((): Promise<void> => oauthApi.grants(cursor)
    .then((page) => { setRows(page.rows); setNext(page.nextCursor); setError(false); })
    .catch(() => { setRows([]); setNext(null); setError(true); })
    .finally(() => { setLoading(false); }), [cursor]);
  const go = useCallback((apply: () => void) => { setLoading(true); setError(false); apply(); }, []);
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
    <div className="flex gap-3">{history.length > 0 && <button className="rounded border p-2" onClick={() => go(() => { setCursor(history[history.length - 1]); setHistory(history.slice(0, -1)); })}>{t.back}</button>}
      {next && <button className="rounded border p-2" onClick={() => go(() => { setHistory([...history, cursor]); setCursor(next); })}>{t.next}</button>}</div>
  </section>;
}
