// # Responsibility: defines validated request data for the Batch 04 API capability.
// # Validates supported locale, display-currency, timezone, and date-format preferences.
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export const SUPPORTED_PREFERENCE_LOCALES = ['en', 'bn', 'ar', 'es', 'tr'] as const;
export const SUPPORTED_PREFERENCE_CURRENCIES = ['BDT', 'USD', 'EUR', 'GBP', 'JPY', 'BTC', 'ETH'] as const;
export const SUPPORTED_DATE_FORMATS = ['ISO', 'DMY', 'MDY'] as const;

export class UserPreferencesDto {
  @IsIn(SUPPORTED_PREFERENCE_LOCALES)
  locale!: (typeof SUPPORTED_PREFERENCE_LOCALES)[number];

  @IsIn(SUPPORTED_PREFERENCE_CURRENCIES)
  displayCurrency!: (typeof SUPPORTED_PREFERENCE_CURRENCIES)[number];

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  timezone!: string;

  @IsIn(SUPPORTED_DATE_FORMATS)
  dateFormat!: (typeof SUPPORTED_DATE_FORMATS)[number];
}
