// # Shared retry, rate-limit backoff, clock-skew guard, and error normalization
import { BaseExchangeProvider } from '../base-exchange-provider';

export { BaseExchangeProvider };

export interface ExchangeRetryBackoffPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  maxClockSkewMs: number;
}

export const DEFAULT_EXCHANGE_RETRY_POLICY: ExchangeRetryBackoffPolicy = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 4_000,
  maxClockSkewMs: 5_000,
};

export function computeExponentialBackoffMs(
  attempt: number,
  policy: ExchangeRetryBackoffPolicy = DEFAULT_EXCHANGE_RETRY_POLICY,
): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const raw = policy.baseDelayMs * Math.pow(2, safeAttempt);
  return Math.min(raw, policy.maxDelayMs);
}

export default BaseExchangeProvider;
