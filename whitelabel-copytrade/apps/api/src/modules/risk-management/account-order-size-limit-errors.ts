// # Responsibility: maps only known account-order database guard failures to safe public errors.
const CODES = [
  'ACCOUNT_ORDER_LIMIT_QUANTITY_UNAVAILABLE',
  'ACCOUNT_ORDER_LIMIT_QUANTITY_EXCEEDED',
  'ACCOUNT_ORDER_LIMIT_NOTIONAL_UNBOUNDED',
  'ACCOUNT_ORDER_LIMIT_MARKET_UNVERIFIED',
  'ACCOUNT_ORDER_LIMIT_CURRENCY_UNVERIFIED',
  'ACCOUNT_ORDER_LIMIT_NOTIONAL_EXCEEDED',
  'ACCOUNT_ORDER_LIMIT_ACTIVE_INTENT_IMMUTABLE',
] as const;

export function accountOrderSizeLimitCode(error: unknown): (typeof CODES)[number] | null {
  if (!(error instanceof Error)) return null;
  return CODES.find((code) => error.message.includes(code)) ?? null;
}
