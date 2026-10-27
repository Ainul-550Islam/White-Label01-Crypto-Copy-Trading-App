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
  tenantId: string;
  userId: string;
  /** Personal cap, effective cap, and tenant ceiling are distinct. */
  maxActiveExposure: string | null;
  perTraderCap: string | null;
  tenantCeiling: string | null;
  effectiveCap: string | null;
  currency: string | null;
  /** Sum of subscription allocation values, not verified live exposure. */
  currentExposure: string | null;
  exposureStatus: 'ALLOCATION_ESTIMATE' | 'UNAVAILABLE';
  remaining: string | null;
  /** May exceed 100%; null when the effective cap is absent or zero. */
  utilisationBps: number | null;
  updatedAt: string | null;
}

export interface CopyBudgetReduction {
  maxActiveExposure: string;
  currency: string;
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
  accountId: string;
  symbol: string;
  side: string;
  quantity: string | null;
  bucket: 'SAFE' | 'WATCH' | 'DANGER' | 'CRITICAL' | 'UNKNOWN';
  distancePercent: string | null;
  liquidationPrice: string | null;
  markPrice: string | null;
  sourceUpdatedAt: string | null;
  containsSimulatedFills: boolean | null;
}

const DECIMAL = /^\d{1,64}(?:\.\d{1,18})?$/;
const SIGNED_DECIMAL = /^-?\d{1,64}(?:\.\d{1,18})?$/;

export function parseLiquidationAlerts(value: unknown, owner: { tenantId: string; userId: string }): LiquidationAlert[] {
  const invalid = (): never => { throw new Error('Invalid liquidation response'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const page = value as Record<string, unknown>;
  if (page.tenantId !== owner.tenantId || page.userId !== owner.userId || !Array.isArray(page.data) ||
      !Number.isSafeInteger(page.total) || page.total !== page.data.length || !Number.isSafeInteger(page.unknownCount)) return invalid();
  const ids = new Set<string>();
  const rows = page.data.map((value): LiquidationAlert => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
    const row = value as Record<string, unknown>;
    if (typeof row.positionId !== 'string' || !row.positionId || ids.has(row.positionId) ||
        typeof row.accountId !== 'string' || !row.accountId || typeof row.symbol !== 'string' || typeof row.side !== 'string' ||
        !(row.quantity === null || (typeof row.quantity === 'string' && SIGNED_DECIMAL.test(row.quantity))) ||
        !(row.bucket === 'SAFE' || row.bucket === 'WATCH' || row.bucket === 'DANGER' || row.bucket === 'CRITICAL' || row.bucket === 'UNKNOWN') ||
        !nullableDecimal(row.distancePercent) || !nullableDecimal(row.liquidationPrice) || !nullableDecimal(row.markPrice) ||
        !(row.sourceUpdatedAt === null || (typeof row.sourceUpdatedAt === 'string' && Number.isFinite(Date.parse(row.sourceUpdatedAt)))) ||
        !(row.containsSimulatedFills === null || typeof row.containsSimulatedFills === 'boolean') ||
        typeof row.reason !== 'string' || typeof row.severity !== 'string' ||
        (row.quantity === null && (row.bucket !== 'UNKNOWN' || row.sourceUpdatedAt !== null || row.containsSimulatedFills !== null)) ||
        (row.quantity !== null && (!row.symbol || !row.sourceUpdatedAt || row.containsSimulatedFills === null)) ||
        (row.bucket !== 'UNKNOWN' && (row.quantity === null || row.containsSimulatedFills || row.distancePercent === null ||
          row.liquidationPrice === null || row.markPrice === null || !/[1-9]/.test(row.liquidationPrice) || !/[1-9]/.test(row.markPrice)))) return invalid();
    ids.add(row.positionId);
    return { positionId: row.positionId, accountId: row.accountId, symbol: row.symbol, side: row.side, quantity: row.quantity,
      bucket: row.bucket, distancePercent: row.distancePercent, liquidationPrice: row.liquidationPrice, markPrice: row.markPrice,
      sourceUpdatedAt: row.sourceUpdatedAt, containsSimulatedFills: row.containsSimulatedFills };
  });
  if (page.unknownCount !== rows.filter((row) => row.bucket === 'UNKNOWN').length) return invalid();
  return rows;
}

function nullableDecimal(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && DECIMAL.test(value));
}

/** Reject incomplete or rounded responses rather than inventing a limit or currency. */
export function parseCopyBudget(value: unknown): CopyBudget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid budget response');
  const raw = value as Record<string, unknown>;
  if (typeof raw.tenantId !== 'string' || !raw.tenantId || typeof raw.userId !== 'string' || !raw.userId ||
      !nullableDecimal(raw.maxActiveExposure) || !nullableDecimal(raw.perTraderCap) ||
      !nullableDecimal(raw.tenantCeiling) || !nullableDecimal(raw.effectiveCap) ||
      !nullableDecimal(raw.remaining) || !nullableDecimal(raw.committed) ||
      !(raw.exposureStatus === 'ALLOCATION_ESTIMATE' || raw.exposureStatus === 'UNAVAILABLE') ||
      !(raw.currency === null || (typeof raw.currency === 'string' && /^[A-Z0-9]{2,12}$/.test(raw.currency))) ||
      !(raw.utilisationBps === null || (typeof raw.utilisationBps === 'number' && Number.isSafeInteger(raw.utilisationBps) && raw.utilisationBps >= 0)) ||
      !(raw.updatedAt === null || (typeof raw.updatedAt === 'string' && Number.isFinite(Date.parse(raw.updatedAt)))) ||
      ((raw.maxActiveExposure !== null || raw.tenantCeiling !== null) && raw.effectiveCap === null) ||
      (raw.exposureStatus === 'ALLOCATION_ESTIMATE' && raw.committed === null) ||
      (raw.exposureStatus === 'UNAVAILABLE' && (raw.committed !== null || raw.remaining !== null || raw.utilisationBps !== null)) ||
      (raw.effectiveCap !== null && raw.currency === null) ||
      (raw.effectiveCap !== null && raw.exposureStatus === 'ALLOCATION_ESTIMATE' && raw.remaining === null) ||
      (raw.effectiveCap === null && raw.remaining !== null) ||
      (raw.effectiveCap !== null && raw.maxActiveExposure === null && raw.tenantCeiling === null)) throw new Error('Invalid budget response');
  if (raw.effectiveCap !== null) {
    const caps = [raw.maxActiveExposure, raw.tenantCeiling].filter((cap): cap is string => cap !== null);
    const tightest = caps.reduce((a, b) => compareCopyBudgetDecimals(a, b) <= 0 ? a : b);
    if (compareCopyBudgetDecimals(raw.effectiveCap, tightest) !== 0) throw new Error('Invalid budget response');
  }
  return {
    tenantId: raw.tenantId, userId: raw.userId,
    maxActiveExposure: raw.maxActiveExposure, perTraderCap: raw.perTraderCap,
    tenantCeiling: raw.tenantCeiling, effectiveCap: raw.effectiveCap, currency: raw.currency,
    currentExposure: raw.committed, exposureStatus: raw.exposureStatus, remaining: raw.remaining, utilisationBps: raw.utilisationBps,
    updatedAt: raw.updatedAt,
  };
}

/** Compare non-negative decimal strings exactly, never using floating-point money. */
export function compareCopyBudgetDecimals(a: string, b: string): number {
  if (!DECIMAL.test(a) || !DECIMAL.test(b)) throw new Error('Invalid decimal');
  const [wholeA = '0', fractionA = ''] = a.split('.');
  const [wholeB = '0', fractionB = ''] = b.split('.');
  const x = wholeA.replace(/^0+(?=\d)/, '');
  const y = wholeB.replace(/^0+(?=\d)/, '');
  if (x.length !== y.length) return x.length > y.length ? 1 : -1;
  if (x !== y) return x > y ? 1 : -1;
  const width = Math.max(fractionA.length, fractionB.length);
  const p = fractionA.padEnd(width, '0');
  const q = fractionB.padEnd(width, '0');
  return p === q ? 0 : p > q ? 1 : -1;
}

export const copyOpsApi = {
  getBudget: async (): Promise<CopyBudget> =>
    parseCopyBudget(await apiClient.get<unknown>('/v1/copy-trading/budget')),

  /** This action is self-scoped and tighten-only; a stable key survives retries. */
  reduceBudget: async (input: CopyBudgetReduction, key: string, owner: { tenantId: string; userId: string }): Promise<CopyBudget> => {
    if (!/^\d{1,16}(?:\.\d{1,12})?$/.test(input.maxActiveExposure) ||
        !/^[A-Z0-9]{2,12}$/.test(input.currency) || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
      throw new Error('Invalid budget reduction');
    }
    const budget = parseCopyBudget(await apiClient.post<unknown>('/v1/copy-trading/budget/reduce', input, { idempotencyKey: key }));
    // A replay may return a later view. Never confirm if the cap was raised or
    // changed currency between the commit and this response.
    if (budget.tenantId !== owner.tenantId || budget.userId !== owner.userId || budget.currency !== input.currency || budget.maxActiveExposure === null || budget.effectiveCap === null ||
        compareCopyBudgetDecimals(budget.maxActiveExposure, input.maxActiveExposure) > 0 ||
        compareCopyBudgetDecimals(budget.effectiveCap, input.maxActiveExposure) > 0) throw new Error('Budget reduction not confirmed');
    return budget;
  },

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

  /** Missing, incomplete or wrong-owner responses are errors, never empty positions. */
  listLiquidationAlerts: async (owner: { tenantId: string; userId: string }): Promise<LiquidationAlert[]> =>
    parseLiquidationAlerts(await apiClient.get<unknown>('/v1/risk/liquidation-alerts'), owner),
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
      return 0;
    default:
      return 1; // UNKNOWN needs attention, even when there is no measured emergency.
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
