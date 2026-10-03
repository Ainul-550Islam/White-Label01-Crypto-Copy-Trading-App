import { Permission } from "@wlct/shared-types";
import { apiClient } from "./api-client";
import { ApiError } from "./api-errors";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import { permissionsAllowAny } from "@/auth/permissions";

/**
 * Copy-trading client for /v1/copy-trading.
 *
 * Every call in the previous version was broken: paths lacked /v1, trader
 * detail used traders/:id (the API route is traders/:id/profile), strategies
 * were fetched from a non-existent /strategies root, subscriptions were
 * listed from GET /subscriptions (the API has subscriptions/me) and updated
 * with a PATCH that does not exist, and trading-status had no API route at
 * all. The response types described fields the API never returns (`id`,
 * nested `performance`, `eligibility`, `traderName`, `health`). Types below
 * mirror the API records; parsers tolerate missing fields so a partial record
 * never crashes a page.
 */

type Raw = Record<string, unknown>;

export type CopySizingMode = "PROPORTIONAL" | "FIXED" | "PERCENTAGE_BALANCE";
export type CopySubscriptionState = "PENDING" | "ACTIVE" | "PAUSED" | "STOPPED" | "CANCELLED" | "EXPIRED";
export type StrategyStatus =
  | "DRAFT"
  | "PENDING_VALIDATION"
  | "VALIDATED"
  | "PUBLISHED"
  | "PAUSED"
  | "ARCHIVED"
  | "REJECTED";

export interface TraderProfile {
  traderId: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  verificationState: string;
  verifiedAt: string | null;
  supportedVenues: string[];
  supportedSymbols: string[];
  isPublic: boolean;
  isFeatured: boolean;
  followerCount: number;
  totalVolume: string;
  totalTrades: number;
  createdAt: string;
}

export interface Strategy {
  strategyId: string;
  traderId: string;
  name: string;
  description: string | null;
  status: string;
  type: string;
  supportedSymbols: string[];
  supportedVenues: string[];
  followerCount: number;
  totalCopies: number;
  publishedAt: string | null;
  createdAt: string;
}

export interface CopySubscription {
  subscriptionId: string;
  traderId: string;
  strategyId: string;
  state: string;
  allocationMode: string;
  allocationAmount: string;
  maxAllocation: string | null;
  followerAccountId: string | null;
  totalCopies: number;
  failedCopies: number;
  totalCopiedVolume: string;
  startedAt: string | null;
  createdAt: string;
}

export interface Paged<T> {
  data: T[];
  total: number;
}

export interface TradingRestriction {
  type: string;
  reason: string;
}

export interface TradingStatus {
  /** ELIGIBLE, RESTRICTED, MAINTENANCE or NOT_PERMITTED (the role cannot copy). */
  eligibility: "ELIGIBLE" | "RESTRICTED" | "MAINTENANCE" | "NOT_PERMITTED";
  canCopy: boolean;
  restrictions: TradingRestriction[];
  /**
   * The current notice, shown for any active window. Only `blocksTrading`
   * windows (platform-wide, this tenant, or trading) disable copying - the
   * API enforces the same rule and answers copy subscribe/resume with 503.
   */
  maintenance: {
    active: boolean;
    message: string;
    scope: string | null;
    endsAt: string | null;
    isEmergency: boolean;
    blocksTrading: boolean;
  } | null;
}

export interface CopyEligibility {
  canCopy: boolean;
  reasons: string[];
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});

export function parseTrader(input: unknown): TraderProfile {
  const r = obj(input);
  return {
    traderId: str(r.traderId ?? r.id),
    displayName: str(r.displayName, "Unnamed trader"),
    bio: strOrNull(r.bio),
    avatarUrl: strOrNull(r.avatarUrl),
    verificationState: str(r.verificationState, "UNVERIFIED"),
    verifiedAt: strOrNull(r.verifiedAt),
    supportedVenues: strList(r.supportedVenues),
    supportedSymbols: strList(r.supportedSymbols),
    isPublic: r.isPublic === true,
    isFeatured: r.isFeatured === true,
    followerCount: num(r.followerCount),
    totalVolume: str(r.totalVolume, "0"),
    totalTrades: num(r.totalTrades),
    createdAt: str(r.createdAt),
  };
}

export function parseStrategy(input: unknown): Strategy {
  const r = obj(input);
  return {
    strategyId: str(r.strategyId ?? r.id),
    traderId: str(r.traderId),
    name: str(r.name, "Unnamed strategy"),
    description: strOrNull(r.description),
    status: str(r.status, "DRAFT"),
    type: str(r.type, "MANUAL"),
    supportedSymbols: strList(r.supportedSymbols),
    supportedVenues: strList(r.supportedVenues),
    followerCount: num(r.followerCount),
    totalCopies: num(r.totalCopies),
    publishedAt: strOrNull(r.publishedAt),
    createdAt: str(r.createdAt),
  };
}

export function parseSubscription(input: unknown): CopySubscription {
  const r = obj(input);
  return {
    subscriptionId: str(r.subscriptionId ?? r.id),
    traderId: str(r.traderId),
    strategyId: str(r.strategyId),
    state: str(r.state, "PENDING"),
    allocationMode: str(r.allocationMode, "FIXED"),
    allocationAmount: str(r.allocationAmount, "0"),
    maxAllocation: strOrNull(r.maxAllocation),
    followerAccountId: strOrNull(r.followerAccountId),
    totalCopies: num(r.totalCopies),
    failedCopies: num(r.failedCopies),
    totalCopiedVolume: str(r.totalCopiedVolume, "0"),
    startedAt: strOrNull(r.startedAt),
    createdAt: str(r.createdAt),
  };
}

function parsePaged<T>(input: unknown, parse: (x: unknown) => T): Paged<T> {
  const r = obj(input);
  const rows = Array.isArray(r.data) ? r.data : Array.isArray(input) ? (input as unknown[]) : [];
  return { data: rows.map(parse), total: typeof r.total === "number" ? r.total : rows.length };
}

/** Copying requires copy_subscription:manage (FOLLOWER and super admins in the role matrix). */
export function permissionsAllowCopy(permissions: readonly string[]): boolean {
  return permissionsAllowAny(permissions, [Permission.COPY_SUBSCRIPTION_MANAGE]);
}

/**
 * Display-side eligibility for one strategy, mirroring the API's subscribe()
 * preconditions (strategy PUBLISHED, account not restricted, no maintenance,
 * role allowed to copy). The API still decides: it re-checks all of this plus
 * compliance blocks, plan limits and the allocation against the balance.
 */
export function copyEligibility(strategy: Pick<Strategy, "status">, status: TradingStatus | undefined): CopyEligibility {
  const reasons: string[] = [];
  if (strategy.status !== "PUBLISHED") reasons.push(`Strategy is ${strategy.status.toLowerCase().replace(/_/g, " ")}`);
  if (status) {
    if (status.eligibility === "NOT_PERMITTED") reasons.push("Your role cannot open copy subscriptions");
    if (status.eligibility === "MAINTENANCE") reasons.push(status.maintenance?.message || "Maintenance in progress");
    if (status.eligibility === "RESTRICTED") reasons.push("Your account has active restrictions");
  }
  return { canCopy: reasons.length === 0 && status !== undefined, reasons };
}

export function composeTradingStatus(
  permissions: readonly string[],
  maintenanceRaw: unknown,
  restrictionsRaw: unknown,
): TradingStatus {
  const m = obj(maintenanceRaw);
  const maintenance =
    m.active === true
      ? {
          active: true,
          message: str(m.message ?? m.title, "Scheduled maintenance"),
          scope: strOrNull(m.scope),
          endsAt: strOrNull(m.endsAt),
          isEmergency: m.isEmergency === true,
          // An API without the flag predates the rule: treat every window as blocking.
          blocksTrading: typeof m.blocksTrading === "boolean" ? m.blocksTrading : true,
        }
      : null;
  const rows = Array.isArray(obj(restrictionsRaw).data) ? (obj(restrictionsRaw).data as unknown[]) : [];
  const restrictions = rows
    .map(obj)
    .filter((r) => str(r.status, "ACTIVE") === "ACTIVE")
    .map((r) => ({ type: str(r.restrictionType ?? r.type, "RESTRICTION"), reason: str(r.reason) }));
  const permitted = permissionsAllowCopy(permissions);
  const eligibility: TradingStatus["eligibility"] = !permitted
    ? "NOT_PERMITTED"
    : maintenance?.blocksTrading
      ? "MAINTENANCE"
      : restrictions.length > 0
        ? "RESTRICTED"
        : "ELIGIBLE";
  return { eligibility, canCopy: eligibility === "ELIGIBLE", restrictions, maintenance };
}

/** A customer without a client profile has no restrictions record (403/404): that is "none", not an error. */
async function ownRestrictions(): Promise<unknown> {
  try {
    return await apiClient.get<unknown>("/v1/client-lifecycle/restrictions", { searchParams: { status: "ACTIVE" } });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) return { data: [] };
    throw err;
  }
}

export interface CreateCopySubscriptionInput {
  traderId: string;
  strategyId: string;
  allocationMode: CopySizingMode;
  allocationAmount: string;
  maxAllocation?: string;
  followerAccountId?: string;
}

export const tradingApi = {
  listTraders: async (params?: { search?: string; verificationState?: string; isFeatured?: boolean; page?: number; limit?: number }) =>
    parsePaged(
      await apiClient.get<unknown>("/v1/copy-trading/traders", {
        searchParams: {
          search: params?.search || undefined,
          verificationState: params?.verificationState,
          isFeatured: params?.isFeatured,
          page: params?.page,
          limit: params?.limit,
        },
      }),
      parseTrader,
    ),

  getTrader: async (traderId: string) =>
    parseTrader(await apiClient.get<unknown>(`/v1/copy-trading/traders/${encodeURIComponent(traderId)}/profile`)),

  listTraderStrategies: async (traderId: string, params?: { page?: number; limit?: number }) =>
    parsePaged(
      await apiClient.get<unknown>(`/v1/copy-trading/traders/${encodeURIComponent(traderId)}/strategies`, {
        searchParams: { page: params?.page, limit: params?.limit },
      }),
      parseStrategy,
    ),

  /** The API filter accepts status, traderId, page and limit only (extra fields are rejected with 422). */
  listStrategies: async (params?: { traderId?: string; status?: StrategyStatus; page?: number; limit?: number }) =>
    parsePaged(
      await apiClient.get<unknown>("/v1/copy-trading/strategies", {
        searchParams: { traderId: params?.traderId, status: params?.status, page: params?.page, limit: params?.limit },
      }),
      parseStrategy,
    ),

  getStrategy: async (strategyId: string) =>
    parseStrategy(await apiClient.get<unknown>(`/v1/copy-trading/strategies/${encodeURIComponent(strategyId)}`)),

  listCopySubscriptions: async (params?: { state?: CopySubscriptionState; page?: number; limit?: number }) =>
    parsePaged(
      await apiClient.get<unknown>("/v1/copy-trading/subscriptions/me", {
        searchParams: { state: params?.state, page: params?.page, limit: params?.limit },
      }),
      parseSubscription,
    ),

  createCopySubscription: async (input: CreateCopySubscriptionInput) =>
    parseSubscription(
      await apiClient.post<unknown>("/v1/copy-trading/subscriptions", {
        traderId: input.traderId,
        strategyId: input.strategyId,
        allocationMode: input.allocationMode,
        allocationAmount: input.allocationAmount,
        ...(input.maxAllocation ? { maxAllocation: input.maxAllocation } : {}),
        ...(input.followerAccountId ? { followerAccountId: input.followerAccountId } : {}),
        idempotencyKey: newIdempotencyKey("copy-sub"),
      }),
    ),

  pauseCopySubscription: async (subscriptionId: string) =>
    parseSubscription(await apiClient.post<unknown>(`/v1/copy-trading/subscriptions/${encodeURIComponent(subscriptionId)}/pause`)),

  resumeCopySubscription: async (subscriptionId: string) =>
    parseSubscription(await apiClient.post<unknown>(`/v1/copy-trading/subscriptions/${encodeURIComponent(subscriptionId)}/resume`)),

  stopCopySubscription: async (subscriptionId: string) =>
    parseSubscription(await apiClient.post<unknown>(`/v1/copy-trading/subscriptions/${encodeURIComponent(subscriptionId)}/stop`)),

  cancelCopySubscription: async (subscriptionId: string) =>
    parseSubscription(await apiClient.delete<unknown>(`/v1/copy-trading/subscriptions/${encodeURIComponent(subscriptionId)}`)),

  /**
   * There is no trading-status route: the status is composed from the tenant
   * maintenance notice, the caller's own active restrictions and whether the
   * caller's role may copy at all.
   */
  getTradingStatus: async (permissions: readonly string[]): Promise<TradingStatus> => {
    const [maintenance, restrictions] = await Promise.all([
      apiClient.get<unknown>("/v1/operations/maintenance/current"),
      ownRestrictions(),
    ]);
    return composeTradingStatus(permissions, maintenance, restrictions);
  },
};
