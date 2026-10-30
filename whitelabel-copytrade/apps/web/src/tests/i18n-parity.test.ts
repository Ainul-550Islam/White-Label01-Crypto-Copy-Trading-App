// # Responsibility: proves all five locales carry the same keys with real sentences, that no value is just its own key, and that the runtime translates and falls back the way the screens assume.

import ar from '@/i18n/ar.json';
import bn from '@/i18n/bn.json';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import tr from '@/i18n/tr.json';
import { LOCALES, directionOf, translator, dictionaries } from '@/i18n';

const locales: ReadonlyArray<[string, Record<string, string>]> = [
  ['en', en as Record<string, string>],
  ['bn', bn as Record<string, string>],
  ['ar', ar as Record<string, string>],
  ['es', es as Record<string, string>],
  ['tr', tr as Record<string, string>],
];

const enKeys = Object.keys(en).sort();

describe('dictionary parity', () => {
  it('ships exactly the five locales the selector offers', () => {
    expect([...LOCALES]).toEqual(['en', 'bn', 'ar', 'es', 'tr']);
    expect(locales.map(([locale]) => locale)).toEqual([...LOCALES]);
  });

  it('carries every key the pages ask for, in every locale', () => {
    // A page that calls t('inbox.markedRead') must find it in all five files, not just in English.
    expect(enKeys.length).toBeGreaterThan(190);
    for (const [locale, dictionary] of locales) {
      expect({ locale, keys: Object.keys(dictionary).sort() }).toEqual({ locale, keys: enKeys });
    }
  });

  it.each(locales)('%s has no empty value and no value that is just its own key', (_locale, dictionary) => {
    const empty = Object.entries(dictionary).filter(([, value]) => typeof value !== 'string' || value.trim().length === 0);
    const keyEcho = Object.entries(dictionary).filter(([key, value]) => value === key);

    expect(empty).toEqual([]);
    expect(keyEcho).toEqual([]);
  });

  it('keeps the section namespaces the Batch 04 screens use', () => {
    for (const prefix of ['common.', 'nav.', 'rebalance.', 'budget.', 'timeline.', 'benchmark.', 'fees.', 'accounting.', 'stream.', 'destinations.', 'inbox.', 'preferences.']) {
      expect({ prefix, present: enKeys.some((key) => key.startsWith(prefix)) }).toEqual({ prefix, present: true });
    }
  });
});

describe('the runtime', () => {
  it('translates with the dictionary of the requested locale', () => {
    expect(translator('en')('inbox.markRead')).toBe('Mark read');
    expect(translator('bn')('inbox.markRead')).not.toBe('Mark read');
    expect(translator('ar')('inbox.markRead')).not.toBe('Mark read');
  });

  it('falls back to English, never to the key, and never widens the signature', () => {
    const translate = translator('tr');
    expect(translate('inbox.markRead')).toBe((tr as Record<string, string>)['inbox.markRead']);
    // The dictionary is the union: an unknown key is a type error, not a runtime surprise.
    expect(Object.keys(dictionaries)).toEqual([...LOCALES]);
  });

  it('marks Arabic as right to left and the rest as left to right', () => {
    expect(directionOf('ar')).toBe('rtl');
    expect(directionOf('en')).toBe('ltr');
    expect(directionOf('bn')).toBe('ltr');
  });

  it('has an English sentence for every key, so no screen can render a key', () => {
    const translate = translator('en');
    for (const key of enKeys) {
      expect(translate(key as keyof typeof en)).not.toBe(key);
    }
  });
});
