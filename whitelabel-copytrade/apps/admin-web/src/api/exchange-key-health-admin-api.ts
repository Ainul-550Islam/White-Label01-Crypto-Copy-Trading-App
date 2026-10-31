// # Responsibility: typed, read-only operator client for the tenant's exchange-key capability health, with no write path and no key material in any type.
//
// The route is `GET admin/exchanges/key-health`: one page of accounts, each
// evaluated through `AccountCapabilityHealthService` into a per-capability matrix
// (`READ`, `TRADE`, `WITHDRAW`, `MARGIN`) plus what a human must do about it. There
// is deliberately no mutation here — rotating, revoking or re-verifying a key is an
// existing, separately step-up-gated exchange-account action, and a second write
// path to credentials is the one duplicate this app must not grow.
//
// The types below carry no credential reference and no blind index, because the
// API does not return them. `apiKeyLastFour` is present so an operator can tell two
// keys apart on screen; it is not usable on its own.
import { apiClient } from '@/lib/api-client';
import type { StatusTone } from '@/lib/theme';

/* ------------------------------------------------------------------ types */

export type CapabilityKind = 'READ' | 'TRADE' | 'WITHDRAW' | 'MARGIN';
export type CapabilityState = 'OK' | 'DEGRADED' | 'RISK' | 'UNKNOWN' | 'UNHEALTHY';
export type AccountCapabilityOverall = 'HEALTHY' | 'DEGRADED' | 'RISK' | 'UNHEALTHY' | 'UNKNOWN';
/** `AccountCapabilityHealthService`'s reason codes, verbatim. */
export type CapabilityReason =
  | 'PERMISSION_GRANTED'
  | 'PERMISSION_ABSENT'
  | 'PERMISSION_NEVER_VERIFIED'
  | 'PERMISSION_VERIFICATION_STALE'
  | 'WITHDRAWAL_ENABLED'
  | 'KEY_IS_READ_ONLY'
  | 'ACCOUNT_REVOKED'
  | 'ACCOUNT_ERROR'
  | 'ACCOUNT_DISABLED'
  | 'CREDENTIAL_EXPIRED'
  | 'REPEATED_CHECK_FAILURES'
  | 'VENUE_UNHEALTHY';
export type KeyAction = 'ROTATE_KEY_WITHOUT_WITHDRAWAL' | 'RECONNECT_KEY' | 'VERIFY_PERMISSIONS';

/** One capability row. `detail` is safe UI copy and never venue response text. */
export interface CapabilityRow {
  capability: CapabilityKind;
  state: CapabilityState;
  reason: CapabilityReason | string;
  granted: boolean;
  detail: string;
  /** False for a capability the venue simply does not offer. */
  countsTowardOverall: boolean;
}

/** One account's key posture. */
export interface ExchangeKeyHealthRow {
  tenantId: string;
  accountId: string;
  venue: string;
  environment: string;
  overall: AccountCapabilityOverall;
  capabilities: CapabilityRow[];
  verifiedAt: string | null;
  evidenceAgeMs: number | null;
  requiresAction: KeyAction[];
  checkedAt: string;
  label: string;
  userId: string | null;
  accountState: string;
  liveTradingEnabled: boolean;
  apiKeyLastFour: string | null;
}

export interface ExchangeKeyHealthSummary {
  healthy: number;
  degraded: number;
  risk: number;
  unhealthy: number;
  unknown: number;
  requiresAction: number;
}

export interface ExchangeKeyHealthPage {
  data: ExchangeKeyHealthRow[];
  /** Accounts matching the filters, before paging. */
  total: number;
  /** Rows this page actually evaluated; `total` may be larger. */
  evaluated: number;
  /** Counts over `evaluated` only — never presented as a tenant-wide figure. */
  summary: ExchangeKeyHealthSummary;
}

export interface KeyHealthQuery {
  page?: number;
  limit?: number;
  venue?: string;
  status?: string;
  environment?: string;
  userId?: string;
}

const API_BASE = '/v1/admin/exchanges/key-health';

function params(query: Record<string, string | number | undefined>): Record<string, string | number | undefined> {
  const cleaned: Record<string, string | number | undefined> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') cleaned[key] = value;
  }
  return cleaned;
}

/* ----------------------------------------------------------------- client */

export const exchangeKeyHealthAdminApi = {
  list: (query: KeyHealthQuery = {}, signal?: AbortSignal) =>
    apiClient.get<ExchangeKeyHealthPage>(API_BASE, {
      searchParams: params({
        page: query.page,
        limit: query.limit,
        venue: query.venue,
        status: query.status,
        environment: query.environment,
        userId: query.userId,
      }),
      signal,
    }),
};

/**
 * The badge tone for a verdict. Kept beside the client because two consoles must
 * not disagree about whether RISK is red or amber.
 */
export function toneForOverall(overall: AccountCapabilityOverall): StatusTone {
  switch (overall) {
    case 'HEALTHY':
      return 'success';
    case 'DEGRADED':
    case 'UNKNOWN':
      return 'warning';
    case 'RISK':
    case 'UNHEALTHY':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** Plain sentence for an action an operator must take. Never an instruction to the venue. */
export const KEY_ACTION_COPY: Record<KeyAction, string> = {
  ROTATE_KEY_WITHOUT_WITHDRAWAL: 'Rotate this key with withdrawal permission removed.',
  RECONNECT_KEY: 'Reconnect the key: the venue has refused it repeatedly.',
  VERIFY_PERMISSIONS: 'Re-verify the key: its permissions have not been checked recently.',
};
