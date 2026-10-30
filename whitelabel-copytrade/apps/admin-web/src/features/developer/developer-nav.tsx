'use client';
import Link from 'next/link';
import type { JSX } from 'react';
import { useDeveloperI18n, type DeveloperLocale } from './i18n';

export function DeveloperNav({ canReconcile }: { canReconcile: boolean }): JSX.Element {
  const { t, locale, setLocale } = useDeveloperI18n();
  return <nav className="dev-nav" aria-label={t.developer}>
    <Link href="/developer">{t.overview}</Link>
    <Link href="/developer/applications">{t.applications}</Link>
    <Link href="/developer/api-keys">{t.keys}</Link>
    <Link href="/developer/webhooks">{t.webhooks}</Link>
    <Link href="/developer/audit">{t.audit}</Link>
    {canReconcile && <Link href="/developer/reconciliation">{t.reconciliation}</Link>}
    <Link href="/developer/versions">{t.versions}</Link>
    <Link href="/developer/integration">{t.integration}</Link>
    <label>{t.language}{' '}
      <select value={locale} onChange={(event) => setLocale(event.target.value as DeveloperLocale)}>
        <option value="en">English</option><option value="bn">বাংলা</option><option value="ar">العربية</option><option value="es">Español</option><option value="tr">Türkçe</option>
      </select>
    </label>
  </nav>;
}
