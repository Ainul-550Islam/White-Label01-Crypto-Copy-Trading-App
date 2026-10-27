'use client';
import type { JSX } from 'react';
import { useDeveloperI18n } from './i18n';
export function DeveloperAccessDenied(): JSX.Element {
  const { t } = useDeveloperI18n();
  return <section><h1>{t.developer}</h1><p role="alert">{t.denied}</p></section>;
}
