// # Responsibility: typed operator client for the tenant copy-budget ceiling and the followers at or near their effective cap, with the step-up proof verified before the write.
//
// The write is the one place in this app that moves the ceiling every follower's
// cap is clamped against, so the order matters: mint a single-use proof for
// COPY_BUDGET_DEFAULT_UPDATE, assert that the proof the API returned is really for
// that action and method, and only then send the update. `requestStepUp` is called
// immediately before the PUT - never when the form opens - because the API consumes
// the proof on the next matching request.
//
// Every amount is a decimal STRING on both sides of the wire. Nothing here calls
// `Number()` or `parseFloat` on money, and the editor validates with the same
// shape the API's DTO enforces, so a rejected string is a 422 with a field name
// rather than a silently rounded value.
import { apiClient } from '@/lib/api-client';
import { assertStepUpProof } from './step-up-proof';

/* ------------------------------------------------------------------ types */

export type CopyBudgetCapStatus = 'CONFIGURED' | 'NOT_CONFIGURED' | 'CONFIGURATION_UNREADABLE';
export type OverCapState = 'OVER' | 'NEAR' | 'UNMEASURABLE';

/** The tenant ceiling as the API reports it, including why it may be unusable. */
export interface TenantDefaultCaps {
  maxActiveExposure: string | null;
  currency: string | null;
  updatedAt: string | null;
  status: CopyBudgetCapStatus;
}

/** One follower at or near their effective cap. Amounts are exact decimal strings. */
export interface OverCapUserRow {
  userId: string;
  /** The follower's email, or null when the account was deleted. */
  label: string | null;
  currency: string | null;
  maxActiveExposure: string;
  perTraderCap: string | null;
  tenantCeiling: string | null;
  effectiveCap: string;
  /** Null when the follower's subscriptions mix allocation units and cannot be summed. */
  committed: string | null;
  utilisationBps: number | null;
  state: OverCapState;
}

export interface OverCapUsersPage {
  data: OverCapUserRow[];
  total: number;
}

export interface OverCapQuery {
  page?: number;
  limit?: number;
  /** Percentage of the effective cap at which a follower counts as NEAR. Default 9000 (90%). */
  utilisationBps?: number;
  status?: 'OVER' | 'NEAR';
}

export interface SetDefaultCapsInput {
  maxActiveExposure: string;
  perTraderCap?: string | null;
  currency: string;
}

/** The step-up action the API's `@RequireStepUp` names for this route. */
export type CopyBudgetStepUpAction = 'COPY_BUDGET_DEFAULT_UPDATE';

const API_BASE = '/v1/admin/copy-trading/budget';

/** The decimal shape `SetCopyBudgetDefaultCapsDto` accepts. Kept in sync by the spec. */
export const DECIMAL_AMOUNT = /^\d{1,40}(\.\d{1,18})?$/;
export const CURRENCY_CODE = /^[A-Z0-9]{2,12}$/;

/**
 * True when the value can be sent as an amount. Deliberately strict: `"1e3"`,
 * `" 10"` and `"-5"` are all rejected here as well as at the API, so the operator
 * sees the problem in the form rather than after a round trip.
 */
export function isAmountInput(value: string): boolean {
  return DECIMAL_AMOUNT.test(value);
}

function params(query: Record<string, string | number | undefined>): Record<string, string | number | undefined> {
  const cleaned: Record<string, string | number | undefined> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') cleaned[key] = value;
  }
  return cleaned;
}

/* ----------------------------------------------------------------- client */

export const copyBudgetAdminApi = {
  /** The tenant ceiling. Readable by anyone holding copy_subscription:read. */
  getDefaultCaps: (signal?: AbortSignal) =>
    apiClient.get<{ caps: TenantDefaultCaps }>(API_BASE, { signal }),

  /** Followers over or near their effective cap. Needs copy_subscription:manage. */
  listOverCapUsers: (query: OverCapQuery = {}, signal?: AbortSignal) =>
    apiClient.get<OverCapUsersPage>(`${API_BASE}/over-cap`, {
      searchParams: params({
        page: query.page,
        limit: query.limit,
        utilisationBps: query.utilisationBps,
        status: query.status,
      }),
      signal,
    }),

  /**
   * Mints the single-use proof for the ceiling update. Call it immediately before
   * `setDefaultCaps`, not when the form opens: the proof is short-lived and is
   * consumed by the next matching request.
   */
  requestStepUp: async (method: 'TOTP' | 'PASSWORD' | 'RECOVERY_CODE', value: string, idempotencyKey: string) => {
    const action: CopyBudgetStepUpAction = 'COPY_BUDGET_DEFAULT_UPDATE';
    const payload =
      method === 'TOTP'
        ? { action, method, code: value }
        : method === 'PASSWORD'
          ? { action, method, password: value }
          : { action, method, recoveryCode: value };
    const proof = await apiClient.post<unknown>('/v1/auth/step-up/verify', payload, { idempotencyKey });
    assertStepUpProof(proof, action, method);
  },

  /** Replaces the tenant ceiling. Requires a proof minted for this action a moment ago. */
  setDefaultCaps: (input: SetDefaultCapsInput, idempotencyKey: string) =>
    apiClient.put<{ caps: TenantDefaultCaps }>(
      API_BASE,
      {
        maxActiveExposure: input.maxActiveExposure,
        ...(input.perTraderCap === null || input.perTraderCap === undefined ? {} : { perTraderCap: input.perTraderCap }),
        currency: input.currency,
      },
      { idempotencyKey },
    ),
};
