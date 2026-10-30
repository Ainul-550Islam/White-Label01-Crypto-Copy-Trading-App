// # Responsibility: resolve the copy dictionary the browser asks for without an effect that writes state on mount.
'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';

/**
 * The browser's preferred language never changes while the page is open, so there is nothing to
 * subscribe to; the store exists only so the value can be read through React's hydration-safe
 * snapshot path instead of a mount effect. Writing it with `setLocale` inside `useEffect` was the
 * pattern this replaces: it renders the fallback language first, then re-renders on every mount,
 * and React 19's lint rules reject a synchronous state write in an effect outright.
 */
const subscribe = (): (() => void) => () => undefined;

/** Every locale a copy dictionary is keyed by. */
export type SupportedLocale<C> = keyof C & string;

/**
 * The locale a visitor asks for, unless they have chosen one on this page.
 *
 * `useSyncExternalStore` is the correct primitive rather than a lazy `useState` initialiser or a
 * mount effect: the server snapshot is the fallback (so the server render and the hydration render
 * agree) and the client snapshot is `navigator.language` (so the browser's own preference wins as
 * soon as hydration finishes). Only languages the caller actually ships copy for are ever returned,
 * which is why the dictionary - not a separate list - is the input.
 *
 * @param supported the copy dictionary, keyed by locale
 * @param fallback the locale to use on the server and for any language without copy
 * @returns the active locale and a setter for a locale picker
 */
export function usePreferredLocale<C extends Record<string, unknown>>(
  supported: C,
  fallback: NoInfer<SupportedLocale<C>>,
): readonly [SupportedLocale<C>, (next: SupportedLocale<C>) => void] {
  type Locale = SupportedLocale<C>;
  const [chosen, setChosen] = useState<Locale | null>(null);
  const detected = useSyncExternalStore<Locale>(
    subscribe,
    () => {
      const language = navigator.language.split('-')[0] ?? '';
      return (Object.prototype.hasOwnProperty.call(supported, language) ? language : fallback) as Locale;
    },
    () => fallback,
  );
  const choose = useCallback((next: Locale) => setChosen(next), []);
  return [chosen ?? detected, choose] as const;
}
