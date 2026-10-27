'use client';
import type { JSX } from 'react';
import type { OAuthLocale } from './oauth-copy';
export function LocaleSelector({ locale, onChange, label }: { locale: OAuthLocale; onChange: (locale: OAuthLocale) => void; label: string }): JSX.Element {
  return <label className="block text-sm">{label}<select className="ms-2 rounded border bg-card p-2" value={locale} onChange={(e) => onChange(e.target.value as OAuthLocale)}>
    <option value="en">English</option><option value="bn">বাংলা</option><option value="ar">العربية</option><option value="es">Español</option><option value="tr">Türkçe</option>
  </select></label>;
}
