// Authenticated account display preferences. A successful write is confirmed by
// the real preferences endpoint; the example amount is never a balance.
'use client';

import type { FormEvent, JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { apiClient } from '@/api/api-client';
import { formatMoney } from '@/lib/i18n/locale-number-format';
import { newIdempotencyKey } from '@/lib/idempotency-key';
import { preferenceCopy, type PreferenceLocale } from './localization-settings-copy';

export interface UserPreferences {
  locale: PreferenceLocale;
  displayCurrency: string;
  timezone: string;
  dateFormat: 'ISO' | 'DMY' | 'MDY';
}
const currencies = ['BDT', 'USD', 'EUR', 'GBP', 'JPY', 'BTC', 'ETH'] as const;
const locales: PreferenceLocale[] = ['en', 'bn', 'ar', 'es', 'tr'];
const formats = ['ISO', 'DMY', 'MDY'] as const;

/** Do not replace a user's saved choices with defaults on a malformed reply. */
export function parsePreferences(value: unknown): UserPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid preference response');
  const row = value as Record<string, unknown>;
  if (typeof row.locale !== 'string' || !locales.includes(row.locale as PreferenceLocale) ||
      typeof row.displayCurrency !== 'string' || !currencies.some((currency) => currency === row.displayCurrency) ||
      typeof row.timezone !== 'string' || !row.timezone.trim() || row.timezone.length > 64 ||
      typeof row.dateFormat !== 'string' || !formats.some((format) => format === row.dateFormat)) {
    throw new Error('Invalid preference response');
  }
  return { locale: row.locale as PreferenceLocale, displayCurrency: row.displayCurrency, timezone: row.timezone, dateFormat: row.dateFormat as UserPreferences['dateFormat'] };
}

export default function LocalizationSettingsPage(): JSX.Element {
  const [value, setValue] = useState<UserPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<'load' | 'save' | null>(null);
  const intent = useRef<{ fingerprint: string; key: string } | null>(null);
  const locale = value?.locale ?? 'en';
  const t = preferenceCopy[locale];

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    apiClient.get<unknown>('/v1/users/me/preferences')
      .then((result) => { if (active) setValue(parsePreferences(result)); })
      .catch(() => { if (active) { setValue(null); setError('load'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);

  function change<K extends keyof UserPreferences>(key: K, next: UserPreferences[K]): void {
    setValue((current) => current ? { ...current, [key]: next } : current);
    setSaved(false); setError(null);
  }
  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!value || pending) return;
    const next = { ...value, timezone: value.timezone.trim() };
    const fingerprint = JSON.stringify(next);
    if (intent.current?.fingerprint !== fingerprint) intent.current = { fingerprint, key: newIdempotencyKey('preferences') };
    setPending(true); setSaved(false); setError(null);
    try {
      const response = parsePreferences(await apiClient.put<unknown>('/v1/users/me/preferences', next, { idempotencyKey: intent.current.key }));
      // A malformed or mismatching acknowledgement is not a confirmed save.
      if (JSON.stringify(response) !== fingerprint) throw new Error('Preference acknowledgement mismatch');
      setValue(response); setSaved(true); intent.current = null;
    } catch {
      setError('save');
    } finally {
      setPending(false);
    }
  }
  const preview = value ? formatMoney('12345678.90', value.displayCurrency, value.locale) : null;
  return <section className="mx-auto max-w-2xl space-y-5" aria-labelledby="localization-title" lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
    <header><h1 id="localization-title" className="text-2xl font-bold">{t.title}</h1><p className="text-sm text-muted">{t.description}</p></header>
    {loading ? <p role="status">{t.loading}</p> : error === 'load' ? <div role="alert"><p>{t.loadError}</p><button type="button" onClick={() => setRevision((n) => n + 1)} className="rounded border px-3 py-2">{t.retry}</button></div> : value && <form onSubmit={(event) => void save(event)} className="space-y-4 rounded border bg-card p-5">
      <div><label htmlFor="locale" className="mb-1 block text-sm font-medium">{t.language}</label><select id="locale" disabled={pending} value={value.locale} onChange={(event) => change('locale', event.target.value as PreferenceLocale)} className="w-full rounded border bg-transparent p-2"><option value="en">English</option><option value="bn">বাংলা</option><option value="ar">العربية</option><option value="es">Español</option><option value="tr">Türkçe</option></select></div>
      <div><label htmlFor="currency" className="mb-1 block text-sm font-medium">{t.currency}</label><select id="currency" disabled={pending} value={value.displayCurrency} onChange={(event) => change('displayCurrency', event.target.value)} className="w-full rounded border bg-transparent p-2">{currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></div>
      <div><label htmlFor="timezone" className="mb-1 block text-sm font-medium">{t.timezone}</label><input id="timezone" dir="ltr" required maxLength={64} disabled={pending} value={value.timezone} onChange={(event) => change('timezone', event.target.value)} aria-describedby="timezone-help" className="w-full rounded border bg-transparent p-2"/><p id="timezone-help" className="text-sm text-muted">{t.timezoneHelp}</p></div>
      <div><label htmlFor="date-format" className="mb-1 block text-sm font-medium">{t.date}</label><select id="date-format" disabled={pending} value={value.dateFormat} onChange={(event) => change('dateFormat', event.target.value as UserPreferences['dateFormat'])} className="w-full rounded border bg-transparent p-2"><option value="ISO">ISO (YYYY-MM-DD)</option><option value="DMY">{t.day}</option><option value="MDY">{t.month}</option></select></div>
      <div className="rounded border p-3"><p className="text-xs text-muted">{t.example}</p><output aria-live="polite" className="text-lg font-semibold"><bdi>{preview}</bdi></output></div>
      {error === 'save' && <p role="alert" className="text-sm text-red-700">{t.saveError}</p>}{saved && <p role="status">{t.saved}</p>}
      <button type="submit" disabled={pending} className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">{pending ? t.saving : t.save}</button>
    </form>}
  </section>;
}
