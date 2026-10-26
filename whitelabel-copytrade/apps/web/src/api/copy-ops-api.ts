// # Responsibility: typed client for the copy-trading budget, liquidation-risk alerts and the copy-execution timeline.
//
// Money-shaped numbers cross this module as DECIMAL STRINGS and never as
// `number`. `0.1 + 0.2` is not `0.3`, and the difference between a follower's
// budget and their exposure decides whether an order is placed. String formatting
// is done where the value is rendered, with the tenant's own precision.
//
// Two rules the components on top of this rely on:
//
//   * A missing or unparsable value stays missing. `remaining` is `null` when the
//     server could not compute it (no equity reading, no FX rate), and a UI that
//     renders that as "0.00 remaining" tells a customer the opposite of the truth.
//   * The budget decision codes are a closed set. Anything unrecognised is shown
//     as-is with a neutral tone rather than being mapped to ALLOW, because a
//     decision this build does not understand must never read as permission.
import { apiClient } from './api-client';

/** How a copy order was treated by the budget. */
export type BudgetDecision = 'ALLOW' | 'REDUCE' | 'BLOCK';

export type BudgetReasonCode =
  | 'WITHIN_BUDGET'
  | 'REDUCED_TO_BUDGET'
  | 'BUDGET_EXHAUSTED'
  | 'EQUITY_UNKNOWN'
  | 'EQUITY_STALE'
  | 'FX_RATE_UNAVAILABLE'
  | 'NO_BUDGET_CONFIGURED'
  | 'EXPOSURE_UNKNOWN';

export interface CopyBudgetDecisionView {
  decision: BudgetDecision | string;
  reasonCode: BudgetReasonCode | string;
  message: string;
}

/** The follower's global budget across every active copy subscription. */
export interface CopyBudget {
  /** Cap on total active copy exposure, as a decimal string. */
  maxActiveExposure: string;
  /** Optional tighter bound for one trader, as a decimal string. */
  perTraderCap: string | null;
  currency: string;
  /** Sum of active copy exposure, or null when it could not be measured. */
  currentExposure: string | null;
  /** `maxActiveExposure - currentExposure`, or null when either side is unknown. */
  remaining: string | null;
  /** 0-100 integer percentage used by the meter; null when it cannot be computed. */
  utilisationPercent: number | null;
  updatedAt: string;
  /** Why a figure is missing, when one is. Rendered verbatim; never a raw venue string. */
  unavailableReason: string | null;
}

export interface CopyBudgetUpdate {
  maxActiveExposure: string;
  perTraderCap?: string | null;
}

/** One entry in an execution's retry/failure timeline. */
export interface CopyExecutionTimelineEntry {
  executionId: string;
  attempt: number;
  status: string;
  failureReasonCode: string | null;
  failureReasonText: string | null;
  retryCount: number;
  at: string;
  /** Present only on a non-terminal failure that will be retried. */
  nextRetryAt: string | null;
  followerQuantity: string | null;
  followerPrice: string | null;
}

export interface CopyExecutionTimeline {
  executionId: string;
  subscriptionId: string;
  terminal: boolean;
  currentStatus: string;
  entries: CopyExecutionTimelineEntry[];
}

/** Liquidation health for one open position, as the risk engine scored it. */
export interface LiquidationAlert {
  positionId: string;
  accountId: string | null;
  symbol: string;
  side: string;
  quantity: string;
  /** SAFE | WATCH | DANGER | CRITICAL | UNKNOWN. */
  bucket: string;
  /** Distance to liquidation as a percentage string, or null when unknown. */
  distancePercent: string | null;
  distanceBps: string | null;
  liquidationPrice: string | null;
  markPrice: string | null;
  /** Why the distance is unknown, when it is. */
  unavailableReason: string | null;
  evaluatedAt: string;
}

/** Wire types. Every field optional: a partial payload must not crash a screen. */
interface BackendBudget {
  maxActiveExposure?: string | null;
  perTraderCap?: string | null;
  currency?: string | null;
  currentExposure?: string | null;
  remaining?: string | null;
  utilisationPercent?: number | null;
  updatedAt?: string | null;
  unavailableReason?: string | null;
}

function keepDecimal(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function toBudget(raw: BackendBudget): CopyBudget {
  const max = keepDecimal(raw.maxActiveExposure);
  const exposure = keepDecimal(raw.currentExposure);
  const remaining = keepDecimal(raw.remaining);
  return {
    maxActiveExposure: max ?? '0',
    perTraderCap: keepDecimal(raw.perTraderCap),
    currency: raw.currency ?? 'USDT',
    currentExposure: exposure,
    remaining,
    utilisationPercent:
      typeof raw.utilisationPercent === 'number' && Number.isFinite(raw.utilisationPercent)
        ? Math.max(0, Math.min(100, Math.round(raw.utilisationPercent)))
        : null,
    updatedAt: raw.updatedAt ?? '',
    unavailableReason: raw.unavailableReason ?? null,
  };
}

export const copyOpsApi = {
  getBudget: async (): Promise<CopyBudget> =>
    toBudget(await apiClient.get<BackendBudget>('/v1/copy-trading/budget')),

  updateBudget: async (input: CopyBudgetUpdate): Promise<CopyBudget> =>
    toBudget(
      await apiClient.put<BackendBudget>('/v1/copy-trading/budget', {
        maxActiveExposure: input.maxActiveExposure,
        ...(input.perTraderCap === undefined ? {} : { perTraderCap: input.perTraderCap }),
      }),
    ),

  /**
   * The timeline for one execution chain.
   *
   * The server returns the chain already ordered; this client does not re-sort it,
   * because the order is the information.
   */
  getExecutionTimeline: async (executionId: string): Promise<CopyExecutionTimeline | null> => {
    const raw = await apiClient.get<CopyExecutionTimeline | null>(
      `/v1/copy-trading/executions/${encodeURIComponent(executionId)}/timeline`,
    );
    if (!raw || !Array.isArray(raw.entries)) return null;
    return raw;
  },

  /** Open positions the risk engine has scored, worst bucket first. */
  listLiquidationAlerts: async (): Promise<LiquidationAlert[]> => {
    const page = await apiClient.get<{ data?: LiquidationAlert[] } | LiquidationAlert[]>('/v1/risk/liquidation-alerts');
    const rows = Array.isArray(page) ? page : page?.data ?? [];
    return rows;
  },
};

/** Bucket severity, used to sort and to pick a banner tone. */
export function liquidationSeverity(bucket: string): number {
  switch (bucket.toUpperCase()) {
    case 'CRITICAL':
      return 4;
    case 'DANGER':
      return 3;
    case 'WATCH':
      return 2;
    case 'SAFE':
      return 1;
    default:
      return 0; // UNKNOWN sorts below SAFE: it is not reassurance, but it is not a measured emergency either
  }
}

/** A share link as the owner sees it in their own list. Never includes the token. */
export interface ShareLinkSummary {
  id: string;
  subjectType: 'TRADER' | 'STRATEGY';
  subjectId: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface ShareLinkCreated {
  created: boolean;
  id: string | null;
  /** The signed token. Shown once, to be copied; it cannot be recovered later. */
  token: string | null;
  url: string | null;
  expiresAt: string | null;
  fields: string[];
  reason: string | null;
  message: string;
}

/** Fields an owner may publish. Kept in step with the API's allow-list. */
export const SHAREABLE_FIELD_LABELS: ReadonlyArray<{ field: string; label: string; hint: string }> = [
  { field: 'displayName', label: 'Display name', hint: 'The name shown on your profile.' },
  { field: 'headline', label: 'Headline', hint: 'Your one-line description.' },
  { field: 'avatarUrl', label: 'Avatar', hint: 'Your profile picture.' },
  { field: 'strategyName', label: 'Strategy name', hint: 'Only for a shared strategy.' },
  { field: 'startedAt', label: 'Member since', hint: 'When the profile or strategy started.' },
  { field: 'returnPercent30d', label: '30-day return', hint: 'Shown as a percentage, no amounts.' },
  { field: 'returnPercent90d', label: '90-day return', hint: 'Shown as a percentage, no amounts.' },
  { field: 'maxDrawdownPercent', label: 'Maximum drawdown', hint: 'The worst peak-to-trough fall.' },
  { field: 'winRatePercent', label: 'Win rate', hint: 'Share of closed trades that made money.' },
  { field: 'tradesLast30d', label: 'Trades in the last 30 days', hint: 'A count, never the trades themselves.' },
  { field: 'riskScore', label: 'Risk score', hint: 'The platform’s own risk rating.' },
];

export const shareApi = {
  /** Create a link. `fields` is the opt-in list; nothing is shared that is not named here. */
  create: async (input: {
    subjectType: 'TRADER' | 'STRATEGY';
    subjectId: string;
    fields: string[];
    expiryDays: number;
  }): Promise<ShareLinkCreated> => {
    const raw = await apiClient.post<{
      created?: boolean;
      id?: string;
      token?: string;
      url?: string;
      expiresAt?: string;
      fields?: string[];
      reason?: string;
      message?: string;
    }>('/v1/copy-trading/shares', input);
    return {
      created: raw?.created === true,
      id: raw?.id ?? null,
      token: raw?.token ?? null,
      url: raw?.url ?? null,
      expiresAt: raw?.expiresAt ?? null,
      fields: Array.isArray(raw?.fields) ? raw.fields : [],
      reason: raw?.reason ?? null,
      message: raw?.message ?? 'The platform did not confirm that the link was created.',
    };
  },

  /** The owner's own links. A revoked link stays listed so "it is gone" is verifiable. */
  list: async (): Promise<ShareLinkSummary[]> => {
    const raw = await apiClient.get<{ data?: ShareLinkSummary[] } | ShareLinkSummary[]>('/v1/copy-trading/shares');
    return Array.isArray(raw) ? raw : raw?.data ?? [];
  },

  revoke: async (id: string): Promise<{ revoked: boolean; message: string }> => {
    const raw = await apiClient.delete<{ revoked?: boolean; message?: string }>(
      `/v1/copy-trading/shares/${encodeURIComponent(id)}`,
    );
    return {
      revoked: raw?.revoked === true,
      message: raw?.message ?? 'The platform did not confirm the revocation.',
    };
  },
};
