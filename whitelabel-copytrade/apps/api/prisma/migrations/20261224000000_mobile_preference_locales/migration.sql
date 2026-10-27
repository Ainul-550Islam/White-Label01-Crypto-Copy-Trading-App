-- Preserve existing user preferences while allowing all supported mobile UI locales.
ALTER TABLE "user_preferences" DROP CONSTRAINT "user_preferences_locale_check";
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_locale_check"
  CHECK ("locale" IN ('en', 'bn', 'ar', 'es', 'tr'));
