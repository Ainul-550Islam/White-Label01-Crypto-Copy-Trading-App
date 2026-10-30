// # Responsibility: one dictionary per locale plus the translator the Batch 04 pages share, so no screen invents its own copy or falls back to an English literal.
'use client';

import { useCallback, useMemo } from 'react';

import ar from './ar.json';
import bn from './bn.json';
import en from './en.json';
import es from './es.json';
import tr from './tr.json';
import { usePreferredLocale } from '@/lib/preferred-locale';

/** The five locales the product ships. Order is the order the selector lists them. */
export const LOCALES = ['en', 'bn', 'ar', 'es', 'tr'] as const;

export type Locale = (typeof LOCALES)[number];

/** Every key the dictionaries carry; the type is derived from the English file. */
export type CopyKey = keyof typeof en;

export type Copy = Record<CopyKey, string>;

/** Native name of each locale, for a selector a customer can read. */
export const LOCALE_LABELS: Readonly<Record<Locale, string>> = {
  en: 'English',
  bn: 'বাংলা',
  ar: 'العربية',
  es: 'Español',
  tr: 'Türkçe',
};

/**
 * The dictionaries, as data.
 *
 * `en` is the reference set: `i18n-parity.test.ts` fails when any other locale carries a different
 * key set, an empty value, or a value that is just its own key. That test is what makes the
 * fallback below unreachable in practice - it exists so a missing sentence degrades to English
 * rather than to `rebalance.title` on screen.
 */
export const dictionaries: Readonly<Record<Locale, Copy>> = {
  en: en as Copy,
  bn: bn as Copy,
  ar: ar as Copy,
  es: es as Copy,
  tr: tr as Copy,
};

export type Translate = (key: CopyKey) => string;

/** The translator for one locale, with the English sentence as the only fallback. */
export function translator(locale: Locale): Translate {
  const dictionary = dictionaries[locale];
  return (key: CopyKey) => dictionary[key] ?? dictionaries.en[key];
}

/** Right-to-left layout is a property of the language, not of the screen. */
export function directionOf(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

export interface CopyContext {
  t: Translate;
  locale: Locale;
  setLocale: (next: Locale) => void;
  dir: 'rtl' | 'ltr';
  lang: string;
}

/**
 * The copy for the current screen.
 *
 * The browser's preferred language is read through `usePreferredLocale`, which resolves it with a
 * hydration-safe snapshot instead of a mount effect: the server render and the hydration render
 * agree on English, and the browser's own choice takes over immediately afterwards.
 */
export function useCopy(): CopyContext {
  const [locale, setLocale] = usePreferredLocale(dictionaries, 'en');
  const t = useMemo(() => translator(locale), [locale]);
  const choose = useCallback((next: Locale) => setLocale(next), [setLocale]);
  return { t, locale, setLocale: choose, dir: directionOf(locale), lang: locale };
}
