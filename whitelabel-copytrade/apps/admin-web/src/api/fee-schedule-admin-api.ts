// # Responsibility: typed operator client for the effective-dated fee schedule — read the live schedule and its history, publish the next version behind a step-up proof minted for FEE_SCHEDULE_PUBLISH.
//
// The API has no `GET admin/fee-schedule`: `AdminFeeScheduleController` exposes only
// the publish POST, and the public controller already returns the effective
// schedule together with the last ten versions **for the same scope the caller is
// reading**. That is exactly what the console needs, so this client reads
// `public/fee-schedule` and treats its `source` field as the truth about whose
// schedule is on screen (`platform_default` = the platform row, `tenant_override` =
// the tenant's own override). Inventing an admin list route in the client would
// produce a call the contract checker rejects and the API 404s.
//
// Rates are decimal STRINGS (`"0.0025"`). Nothing here converts them to a number:
// a rate that renders as `0.0024999999` because a float rounded it is a rate the
// operator will publish.
import { apiClient } from '@/lib/api-client';
import { assertStepUpProof } from './step-up-proof';

/* ------------------------------------------------------------------ types */

/** The step-up action `@RequireStepUp` names on `POST admin/fee-schedule`. */
export type FeeScheduleStepUpAction = 'FEE_SCHEDULE_PUBLISH';

export type FeeScheduleSource = 'platform_default' | 'tenant_override';

/** One published version, as the API projects it. */
export interface FeeScheduleVersion {
  version: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  /** Decimal string, e.g. "0.0025". */
  managementFeeRate: string;
  /** Decimal string, e.g. "0.20". */
  profitShareRate: string;
  currency: string;
}

/** What `GET public/fee-schedule` returns. */
export interface EffectiveFeeSchedule extends FeeScheduleVersion {
  source: FeeScheduleSource;
  /** The ten most recent versions of the scope that is in force. */
  versions: FeeScheduleVersion[];
}

export interface PublishFeeScheduleInput {
  effectiveFrom: string;
  managementFeeRate: string;
  profitShareRate: string;
  currency: string;
}

export interface PublishedFeeScheduleVersion extends FeeScheduleVersion {
  source: FeeScheduleSource;
  publishedBy: string;
}

const API_BASE = '/v1/public/fee-schedule';

/**
 * The shapes `PublishFeeScheduleDto` accepts. `managementFeeRate` and
 * `profitShareRate` allow no leading zeros and no sign; `currency` is exactly
 * three upper-case letters. Re-checked here so the operator sees the problem in
 * the form instead of after a 422.
 */
export const RATE_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
export const FEE_CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function isRateInput(value: string): boolean {
  return RATE_PATTERN.test(value) && (value.split('.')[1]?.length ?? 0) <= 64;
}

export function isFeeCurrency(value: string): boolean {
  return FEE_CURRENCY_PATTERN.test(value);
}

/**
 * A rate as a percentage, by SHIFTING THE DIGITS two places - never by
 * multiplying a float. `0.0025` is "0.25 %", `0.20` and `0.2` are both "20 %",
 * and a rate with twenty decimals keeps every one of them.
 *
 * A value that is not a plain decimal rate is returned unchanged: showing the
 * operator what the API actually said beats a plausible percentage that is wrong.
 */
export function formatRatePercent(rate: string): string {
  if (!RATE_PATTERN.test(rate)) return rate;

  const [whole = '0', fraction = ''] = rate.split('.');
  const digits = `${whole}${fraction}`;
  // Multiplying by 100 moves the decimal point two places to the right.
  const pointAt = whole.length + 2;
  const shifted = digits.padEnd(pointAt, '0');
  const percentWhole = shifted.slice(0, pointAt).replace(/^0+(?=\d)/, '') || '0';
  const percentFraction = shifted.slice(pointAt).replace(/0+$/, '');
  return `${percentWhole}${percentFraction ? `.${percentFraction}` : ''} %`;
}

/* ----------------------------------------------------------------- client */

export const feeScheduleAdminApi = {
  /**
   * The effective schedule and its recent history. `at` asks for the schedule in
   * force at a moment other than now, which is how an operator checks what a
   * statement was billed under.
   */
  getEffective: (at?: string, signal?: AbortSignal) =>
    apiClient.get<EffectiveFeeSchedule>(API_BASE, {
      searchParams: at ? { at } : undefined,
      signal,
    }),

  /**
   * Mints the single-use proof for a publication. Call it immediately before
   * `publish`: the API consumes the proof on the next matching request, and a
   * proof minted when the form opened has often expired by the time it is sent.
   */
  requestStepUp: async (method: 'TOTP' | 'PASSWORD' | 'RECOVERY_CODE', value: string, idempotencyKey: string) => {
    const action: FeeScheduleStepUpAction = 'FEE_SCHEDULE_PUBLISH';
    const payload =
      method === 'TOTP'
        ? { action, method, code: value }
        : method === 'PASSWORD'
          ? { action, method, password: value }
          : { action, method, recoveryCode: value };
    const proof = await apiClient.post<unknown>('/v1/auth/step-up/verify', payload, { idempotencyKey });
    assertStepUpProof(proof, action, method);
  },

  /**
   * Publishes the next version. `effectiveFrom` must be later than the most
   * recent version's start (the API answers 409 otherwise), and the previous
   * version is closed at the new start rather than overwritten.
   */
  publish: (input: PublishFeeScheduleInput, idempotencyKey: string) =>
    apiClient.post<PublishedFeeScheduleVersion>(
      // The write is the platform route; the read above is the public one. Both are
      // literals so the contract checker can resolve them without a second constant.
      '/v1/admin/fee-schedule',
      {
        effectiveFrom: input.effectiveFrom,
        managementFeeRate: input.managementFeeRate,
        profitShareRate: input.profitShareRate,
        currency: input.currency,
      },
      { idempotencyKey },
    ),
};
