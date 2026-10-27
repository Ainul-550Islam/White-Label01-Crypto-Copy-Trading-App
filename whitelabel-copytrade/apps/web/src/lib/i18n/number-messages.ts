/** User-facing number-format errors. Locale tags with a region use their language. */
const invalidDecimal = {
  en: 'Enter a valid decimal amount.',
  bn: 'একটি বৈধ দশমিক পরিমাণ লিখুন।',
  ar: 'أدخل مبلغًا عشريًا صالحًا.',
  es: 'Introduce una cantidad decimal válida.',
  tr: 'Geçerli bir ondalık tutar girin.',
} as const;

export function decimalErrorMessage(locale: string): string {
  const language = locale.toLowerCase().split('-')[0] as keyof typeof invalidDecimal;
  return invalidDecimal[language] ?? invalidDecimal.en;
}
