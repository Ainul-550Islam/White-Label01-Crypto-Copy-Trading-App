// # Responsibility: renders the Batch 04 commercial user interface for its route.
// # Lets users persist locale, currency, timezone, and date display preferences with an exact-string money preview.
'use client';

import type { FormEvent, JSX } from 'react';
import { useEffect, useState } from 'react';
import { apiClient } from '@/api/api-client';
import { formatMoney } from '@/lib/i18n/locale-number-format';

type UserPreferences = { locale: 'en' | 'bn'; displayCurrency: string; timezone: string; dateFormat: 'ISO' | 'DMY' | 'MDY' };
const defaults: UserPreferences = { locale: 'en', displayCurrency: 'USD', timezone: 'UTC', dateFormat: 'ISO' };
const currencies = ['BDT', 'USD', 'EUR', 'GBP', 'JPY', 'BTC', 'ETH'];
const zones = ['UTC', 'Asia/Dhaka', 'Asia/Kolkata', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles'];

export default function LocalizationSettingsPage(): JSX.Element {
  const [value, setValue] = useState<UserPreferences>(defaults);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    apiClient.get<UserPreferences>('/v1/users/me/preferences').then((result) => { if (active) setValue(result); }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : 'Preferences could not be loaded.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  function change<K extends keyof UserPreferences>(key: K, next: UserPreferences[K]): void { setValue((current) => ({ ...current, [key]: next })); }
  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setPending(true); setMessage(null); setError(null);
    try { const saved = await apiClient.put<UserPreferences>('/v1/users/me/preferences', value); setValue(saved); setMessage('Preferences saved. Financial values remain exact decimal strings; timezone changes affect display only.'); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Preferences could not be saved.'); }
    finally { setPending(false); }
  }
  let preview: string;
  try { preview = formatMoney('12345678.90', value.displayCurrency, value.locale); }
  catch { preview = 'Unsupported currency'; }
  return <section className="mx-auto max-w-2xl space-y-5" aria-labelledby="localization-title">
    <header><h1 id="localization-title" className="text-2xl font-bold">Language, currency and time</h1><p className="text-sm text-slate-600">These preferences affect presentation only. They never change stored timestamps, ledger amounts, or settlement currency.</p></header>
    {loading ? <p role="status">Loading preferences…</p> : <form onSubmit={(event) => void save(event)} className="space-y-4 rounded border bg-white p-5">
      <div><label htmlFor="locale" className="mb-1 block text-sm font-medium">Language</label><select id="locale" value={value.locale} onChange={(event) => change('locale', event.target.value as UserPreferences['locale'])} className="w-full rounded border p-2"><option value="en">English</option><option value="bn">বাংলা</option></select></div>
      <div><label htmlFor="currency" className="mb-1 block text-sm font-medium">Display currency</label><select id="currency" value={value.displayCurrency} onChange={(event) => change('displayCurrency', event.target.value)} className="w-full rounded border p-2">{currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></div>
      <div><label htmlFor="timezone" className="mb-1 block text-sm font-medium">Timezone</label><select id="timezone" value={value.timezone} onChange={(event) => change('timezone', event.target.value)} className="w-full rounded border p-2">{zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select></div>
      <div><label htmlFor="date-format" className="mb-1 block text-sm font-medium">Date format</label><select id="date-format" value={value.dateFormat} onChange={(event) => change('dateFormat', event.target.value as UserPreferences['dateFormat'])} className="w-full rounded border p-2"><option value="ISO">ISO (YYYY-MM-DD)</option><option value="DMY">Day / month / year</option><option value="MDY">Month / day / year</option></select></div>
      <div className="rounded bg-slate-50 p-3"><p className="text-xs text-slate-600">Exact financial-format preview</p><output aria-live="polite" className="text-lg font-semibold">{preview}</output></div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}{message && <p role="status" className="text-sm text-green-800">{message}</p>}
      <button type="submit" disabled={pending} className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50">{pending ? 'Saving…' : 'Save preferences'}</button>
    </form>}
  </section>;
}
