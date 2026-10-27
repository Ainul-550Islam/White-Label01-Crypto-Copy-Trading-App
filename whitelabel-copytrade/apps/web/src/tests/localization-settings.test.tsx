import { parsePreferences } from '@/features/settings/localization-settings-page';
import { preferenceCopy } from '@/features/settings/localization-settings-copy';

const valid = { locale: 'en', displayCurrency: 'USD', timezone: 'UTC', dateFormat: 'ISO' };

test.each(['en', 'bn', 'ar', 'es', 'tr'] as const)('accepts the saved %s locale', (locale) => {
  expect(parsePreferences({ ...valid, locale, tenantId: 'ignored' }).locale).toBe(locale);
  expect(preferenceCopy[locale].save).toBeTruthy();
});

test.each([
  null, {}, { ...valid, locale: 'fr' }, { ...valid, displayCurrency: 'USDT' },
  { ...valid, timezone: '' }, { ...valid, dateFormat: 'OTHER' },
])('rejects malformed preference response %# rather than replacing it with defaults', (value) => {
  expect(() => parsePreferences(value)).toThrow();
});
