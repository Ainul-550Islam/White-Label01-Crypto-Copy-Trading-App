// # Responsibility: implements a Batch 04 commercial interface component or supporting utility.
'use client';
// # Responsibility: edits only the currently authenticated tenant's sanitized white-label theme configuration.
import { useEffect, useState } from 'react';
import { businessAdminApi } from '@/api/business-admin-api';

type Brand = { appName?: string; logoUrl?: string | null; primaryColor?: string; secondaryColor?: string; accentColor?: string; backgroundColor?: string; textColor?: string; fontFamily?: string; supportEmail?: string | null; supportUrl?: string | null };
const FIELDS: Array<{ key: keyof Brand; label: string; type?: string }> = [
  { key: 'appName', label: 'Application name' }, { key: 'logoUrl', label: 'Logo URL' },
  { key: 'primaryColor', label: 'Primary color', type: 'color' }, { key: 'secondaryColor', label: 'Secondary color', type: 'color' },
  { key: 'accentColor', label: 'Accent color', type: 'color' }, { key: 'backgroundColor', label: 'Background color', type: 'color' },
  { key: 'textColor', label: 'Text color', type: 'color' }, { key: 'fontFamily', label: 'Font family' },
  { key: 'supportEmail', label: 'Support email', type: 'email' }, { key: 'supportUrl', label: 'Support URL', type: 'url' },
];
export function TenantBrandingEditor() {
  const [brand, setBrand] = useState<Brand>({}); const [error, setError] = useState(''); const [saved, setSaved] = useState(false);
  useEffect(() => { fetch('/api/proxy/tenants/current/branding', { credentials: 'same-origin' }).then(async r => { if (!r.ok) throw new Error(); const p = await r.json(); setBrand(p.data ?? p); }).catch(() => setError('Unable to load tenant branding.')); }, []);
  const save = async (event: React.FormEvent) => { event.preventDefault(); setError(''); setSaved(false); try { await businessAdminApi.updateTenantBranding(brand as Record<string, string | null>); setSaved(true); } catch { setError('Branding could not be saved. Check your tenant permission and the supplied values.'); } };
  return <section className="max-w-3xl space-y-5"><header><h1 className="text-2xl font-semibold">Tenant branding</h1><p className="text-sm text-muted-foreground">Changes affect this tenant only. Theme values are validated and sanitized by the API.</p></header><form onSubmit={save} className="grid gap-4 sm:grid-cols-2">{FIELDS.map(f => <label key={f.key} className="grid gap-1 text-sm">{f.label}<input type={f.type ?? 'text'} value={String(brand[f.key] ?? (f.type === 'color' ? '#000000' : ''))} onChange={e => setBrand(prev => ({ ...prev, [f.key]: e.target.value }))} className="rounded border px-3 py-2" /></label>)}<div className="flex items-center gap-3 sm:col-span-2"><button className="rounded bg-primary px-4 py-2 text-primary-foreground" type="submit">Save branding</button>{saved && <span role="status">Saved.</span>}{error && <span role="alert">{error}</span>}</div></form></section>;
}
