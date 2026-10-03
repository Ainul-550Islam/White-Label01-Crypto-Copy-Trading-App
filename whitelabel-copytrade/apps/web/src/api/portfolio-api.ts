import { apiClient } from "./api-client";

/**
 * Portfolio accounting of the signed-in user - PortfolioAccountingController
 * (/v1/portfolio-accounting). Every figure is computed by the backend; the
 * frontend only formats the decimal strings it receives.
 *
 *   GET /profiles?scopeId=           own profiles (report readers see the tenant)
 *   GET /nav?profileId=               { nav, cash, baseCurrency, valuationTimestamp, dataCompleteness, canPublish, ... }
 *   GET /pnl?profileId=&from=&to=     { realized, unrealized, gross, net }
 *   GET /holdings?profileId=          [{ symbol, asset, quantity, classification, costBasis }]
 *   GET /performance?profileId=&periodStart=&periodEnd=&methodology=  { returnPercent, canCalculate, reason? }
 *   GET /attribution?profileId=&periodStart=&periodEnd=&dimension=    { attributions[], totalAttributed, unattributed, ... }
 *   GET /snapshots?profileId=&from=&to=  { data, total, page, limit }
 *
 * There is no "overview" or "valuation-status" route: both are composed here
 * from /nav and /pnl. Someone else's profile answers 404.
 */

export type ValuationState =
  | "VALID"
  | "STALE"
  | "MISSING_PRICE"
  | "MISSING_FX"
  | "INCOMPLETE"
  | "UNAVAILABLE";

export interface PortfolioProfile {
  id: string;
  scope: string;
  scopeId: string;
  portfolioType?: string;
  baseCurrency: string;
  returnMethodology?: string;
}

export interface PortfolioOverview {
  tenantId: string;
  profileId: string;
  nav: string; // backend-authoritative, string for precision
  cash: string;
  totalRealizedPnl: string;
  totalUnrealizedPnl: string;
  dailyPnl: string;
  periodPnl: string;
  currency: string;
  valuationState: ValuationState;
  lastValuationAt: string;
  fxStatus?: string;
  dataCompleteness?: string;
}

export interface Holding {
  id: string;
  symbol: string;
  asset: string;
  quantity: string;
  avgCost: string;
  currentPrice?: string;
  marketValue?: string;
  unrealizedPnl?: string;
  realizedPnl?: string;
  classification: string;
  venue?: string;
  valuationState?: string;
  lastUpdatedAt?: string;
}

export interface PnlRecord {
  period: string;
  realized: string;
  unrealized: string;
  gross: string;
  net: string;
  fees: string;
  currency: string;
  methodology: string;
}

export interface PerformancePoint {
  timestamp: string;
  nav: string;
  pnl: string;
  returnPct: string;
}

export interface PerformanceSummary {
  periodStart: string;
  periodEnd: string;
  methodology: string;
  returnPct: string | null;
  canCalculate: boolean;
  reason?: string;
  points: PerformancePoint[];
}

export interface AttributionRecord {
  dimension: string;
  key: string;
  pnl: string;
  allocationPct: string;
  returnPct: string;
}

export interface PortfolioSnapshot {
  id: string;
  timestamp: string;
  nav: string;
  cash: string;
  holdings: Holding[];
  valuationState: string;
  netPnl?: string;
  baseCurrency?: string;
}

export interface ValuationStatusView {
  state: ValuationState;
  lastValuationAt: string;
  missingPrices: string[];
  fxStatus: string;
  dataCompleteness: string;
}

export const ATTRIBUTION_DIMENSIONS = [
  "STRATEGY",
  "TRADER",
  "FOLLOWER",
  "SYMBOL",
  "ASSET",
  "VENUE",
] as const;
export type AttributionDimension = (typeof ATTRIBUTION_DIMENSIONS)[number];

/** Backend shapes. */
interface BackendNav {
  nav: string | null;
  cash: string;
  baseCurrency: string;
  valuationTimestamp: string;
  dataCompleteness: string;
  canPublish?: boolean;
}

interface BackendPnl {
  realized: { realizedPnl: string } | null;
  unrealized: {
    unrealizedPnl: string | null;
    hasMissingPrice?: boolean;
    hasStalePrice?: boolean;
  } | null;
  gross: { grossPnl: string | null } | null;
  net: { netPnl: string | null; grossPnl: string | null; fees: string } | null;
}

interface BackendHolding {
  symbol: string;
  asset: string;
  quantity: string;
  classification: string;
  costBasis: string | null;
}

interface BackendSnapshot {
  id: string;
  snapshotId?: string;
  timestamp: string;
  nav: string;
  cash: string;
  netPnl?: string | null;
  baseCurrency?: string;
  positions?: unknown;
  dataCompleteness?: string;
}

interface BackendAttribution {
  attributions: Array<{
    dimensionValue: string;
    pnl: string;
    percentage: string;
  }>;
}

interface BackendPerformance {
  returnPercent: string | null;
  canCalculate: boolean;
  reason?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_DAYS: Record<string, number> = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
};

/** Resolves '30d'-style periods to an ISO window ending now. */
export function periodWindow(
  period: string = "30d",
  now: Date = new Date(),
): { from: string; to: string } {
  const days = PERIOD_DAYS[period] ?? 30;
  return {
    from: new Date(now.getTime() - days * DAY_MS).toISOString(),
    to: now.toISOString(),
  };
}

/** Maps the backend data-completeness flag to the valuation state the UI shows. */
export function toValuationState(
  dataCompleteness: string | null | undefined,
  nav: string | null | undefined,
): ValuationState {
  if (nav === null || nav === undefined) return "UNAVAILABLE";
  switch (dataCompleteness) {
    case "COMPLETE":
      return "VALID";
    case "STALE_PRICE":
      return "STALE";
    case "MISSING_PRICE":
    case "MISSING_PRICE_INCOMPLETE":
      return "MISSING_PRICE";
    case "MISSING_FX":
    case "MISSING_FX_NO_NAV":
      return "MISSING_FX";
    case "CALCULATION_FAILED":
      return "UNAVAILABLE";
    default:
      return "INCOMPLETE";
  }
}

function netOf(pnl: BackendPnl | null | undefined): string {
  return pnl?.net?.netPnl ?? pnl?.gross?.grossPnl ?? "0";
}

export function toPnlRecord(
  pnl: BackendPnl,
  period: string,
  currency: string,
): PnlRecord {
  return {
    period,
    realized: pnl.realized?.realizedPnl ?? "0",
    unrealized: pnl.unrealized?.unrealizedPnl ?? "0",
    gross: pnl.gross?.grossPnl ?? "0",
    net: netOf(pnl),
    fees: pnl.net?.fees ?? "0",
    currency,
    methodology: "NET",
  };
}

export function toHolding(raw: BackendHolding): Holding {
  return {
    id: raw.symbol,
    symbol: raw.symbol,
    asset: raw.asset,
    quantity: raw.quantity,
    avgCost: raw.costBasis ?? "",
    classification: raw.classification,
  };
}

export function toSnapshot(raw: BackendSnapshot): PortfolioSnapshot {
  return {
    id: raw.snapshotId ?? raw.id,
    timestamp: raw.timestamp,
    nav: raw.nav,
    cash: raw.cash,
    holdings: [],
    valuationState: toValuationState(
      raw.dataCompleteness ?? "COMPLETE",
      raw.nav,
    ),
    netPnl: raw.netPnl ?? undefined,
    baseCurrency: raw.baseCurrency,
  };
}

async function fetchNav(profileId: string): Promise<BackendNav> {
  return apiClient.get<BackendNav>("/v1/portfolio-accounting/nav", {
    searchParams: { profileId },
  });
}

async function fetchPnl(
  profileId: string,
  from?: string,
  to?: string,
): Promise<BackendPnl> {
  return apiClient.get<BackendPnl>("/v1/portfolio-accounting/pnl", {
    searchParams: { profileId, from, to },
  });
}

export const portfolioApi = {
  /** Own portfolio profiles. `scopeId` keeps a tenant-wide reader on their own profile. */
  listProfiles: async (params?: {
    scopeId?: string;
    scope?: string;
  }): Promise<PortfolioProfile[]> => {
    const page = await apiClient.get<{ data: PortfolioProfile[] }>(
      "/v1/portfolio-accounting/profiles",
      {
        searchParams: { scopeId: params?.scopeId, scope: params?.scope },
      },
    );
    return page?.data ?? [];
  },

  /** The profile the portfolio screens show: own follower profile first, then trader, then any own profile. */
  getPrimaryProfile: async (
    userId?: string,
  ): Promise<PortfolioProfile | null> => {
    const profiles = await portfolioApi.listProfiles(
      userId ? { scopeId: userId } : undefined,
    );
    const rank = (p: PortfolioProfile): number =>
      p.scope === "FOLLOWER" ? 0 : p.scope === "TRADER" ? 1 : 2;
    return [...profiles].sort((a, b) => rank(a) - rank(b))[0] ?? null;
  },

  /** NAV, cash and P&L for one profile (composed from /nav and /pnl). */
  getOverview: async (profileId: string): Promise<PortfolioOverview> => {
    const day = periodWindow("1d");
    const month = periodWindow("30d");
    const [nav, total, daily, period] = await Promise.all([
      fetchNav(profileId),
      fetchPnl(profileId),
      fetchPnl(profileId, day.from, day.to),
      fetchPnl(profileId, month.from, month.to),
    ]);
    return {
      tenantId: "",
      profileId,
      nav: nav.nav ?? "",
      cash: nav.cash,
      totalRealizedPnl: total.realized?.realizedPnl ?? "0",
      totalUnrealizedPnl: total.unrealized?.unrealizedPnl ?? "0",
      dailyPnl: netOf(daily),
      periodPnl: netOf(period),
      currency: nav.baseCurrency,
      valuationState: toValuationState(nav.dataCompleteness, nav.nav),
      lastValuationAt: nav.valuationTimestamp,
      fxStatus: nav.dataCompleteness.startsWith("MISSING_FX")
        ? "MISSING_FX"
        : "VALID",
      dataCompleteness: nav.dataCompleteness,
    };
  },

  getHoldings: async (
    profileId: string,
  ): Promise<{ data: Holding[]; total: number }> => {
    const rows = await apiClient.get<BackendHolding[]>(
      "/v1/portfolio-accounting/holdings",
      { searchParams: { profileId } },
    );
    const data = (Array.isArray(rows) ? rows : []).map(toHolding);
    return { data, total: data.length };
  },

  /** P&L over the requested windows, newest window first. */
  getPnl: async (
    profileId: string,
    params?: { periods?: string[]; currency?: string },
  ): Promise<PnlRecord[]> => {
    const periods = params?.periods ?? ["1d", "7d", "30d"];
    const results = await Promise.all(
      periods.map(async (period) => {
        const window = periodWindow(period);
        return toPnlRecord(
          await fetchPnl(profileId, window.from, window.to),
          period,
          params?.currency ?? "",
        );
      }),
    );
    return results;
  },

  /** Period return from the backend plus the NAV series of persisted snapshots. */
  getPerformance: async (
    profileId: string,
    params?: {
      period?: string;
      methodology?: "TIME_WEIGHTED_RETURN" | "MONEY_WEIGHTED_RETURN";
    },
  ): Promise<PerformanceSummary> => {
    const window = periodWindow(params?.period ?? "30d");
    const methodology = params?.methodology ?? "TIME_WEIGHTED_RETURN";
    const [performance, snapshots] = await Promise.all([
      apiClient.get<BackendPerformance>(
        "/v1/portfolio-accounting/performance",
        {
          searchParams: {
            profileId,
            periodStart: window.from,
            periodEnd: window.to,
            methodology,
          },
        },
      ),
      apiClient.get<{ data: BackendSnapshot[] }>(
        "/v1/portfolio-accounting/snapshots",
        {
          searchParams: {
            profileId,
            from: window.from,
            to: window.to,
            limit: 100,
          },
        },
      ),
    ]);
    const points = (snapshots?.data ?? [])
      .map((s) => ({
        timestamp: s.timestamp,
        nav: s.nav,
        pnl: s.netPnl ?? "",
        returnPct: "",
      }))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return {
      periodStart: window.from,
      periodEnd: window.to,
      methodology,
      returnPct: performance?.returnPercent ?? null,
      canCalculate: performance?.canCalculate ?? false,
      reason: performance?.reason,
      points,
    };
  },

  getAttribution: async (
    profileId: string,
    params?: { dimension?: AttributionDimension; period?: string },
  ): Promise<AttributionRecord[]> => {
    const window = periodWindow(params?.period ?? "30d");
    const dimension = params?.dimension ?? "STRATEGY";
    const result = await apiClient.get<BackendAttribution>(
      "/v1/portfolio-accounting/attribution",
      {
        searchParams: {
          profileId,
          periodStart: window.from,
          periodEnd: window.to,
          dimension,
        },
      },
    );
    return (result?.attributions ?? []).map((a) => ({
      dimension,
      key: a.dimensionValue,
      pnl: a.pnl,
      allocationPct: a.percentage,
      // The backend reports each key's share of total P&L, not a return.
      returnPct: "",
    }));
  },

  getSnapshots: async (
    profileId: string,
    params?: { from?: string; to?: string; page?: number; limit?: number },
  ): Promise<{ data: PortfolioSnapshot[]; total: number }> => {
    const page = await apiClient.get<{
      data: BackendSnapshot[];
      total: number;
    }>("/v1/portfolio-accounting/snapshots", {
      searchParams: {
        profileId,
        from: params?.from,
        to: params?.to,
        page: params?.page,
        limit: params?.limit,
      },
    });
    const data = (page?.data ?? []).map(toSnapshot);
    return { data, total: page?.total ?? data.length };
  },

  /** Valuation freshness of one profile, from the backend NAV run. */
  getValuationStatus: async (
    profileId: string,
  ): Promise<ValuationStatusView> => {
    const nav = await fetchNav(profileId);
    const state = toValuationState(nav.dataCompleteness, nav.nav);
    return {
      state,
      lastValuationAt: nav.valuationTimestamp,
      missingPrices: [],
      fxStatus: state === "MISSING_FX" ? "MISSING_FX" : "VALID",
      dataCompleteness: nav.dataCompleteness,
    };
  },
};
