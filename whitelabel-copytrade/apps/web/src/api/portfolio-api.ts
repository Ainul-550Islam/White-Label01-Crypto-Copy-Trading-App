import { apiClient } from './api-client';

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
  valuationState: 'VALID' | 'STALE' | 'MISSING_PRICE' | 'MISSING_FX' | 'INCOMPLETE' | 'UNAVAILABLE';
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
  valuationState: string;
  lastUpdatedAt: string;
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
}

export const portfolioApi = {
  getOverview: () => apiClient.get<PortfolioOverview>('/portfolio-accounting/overview'),

  getHoldings: (params?: { page?: number; limit?: number }) =>
    apiClient.get<{ data: Holding[]; total: number }>('/portfolio-accounting/holdings', {
      searchParams: params as Record<string, string | number | boolean | undefined>,
    }),

  getPnl: (params?: { period?: string; methodology?: string }) =>
    apiClient.get<PnlRecord[]>('/portfolio-accounting/pnl', {
      searchParams: params as Record<string, string | number | boolean | undefined>,
    }),

  getPerformance: (params?: { period?: string; granularity?: string }) =>
    apiClient.get<PerformancePoint[]>('/portfolio-accounting/performance', {
      searchParams: params as Record<string, string | number | boolean | undefined>,
    }),

  getAttribution: (params?: { dimension?: string; period?: string }) =>
    apiClient.get<AttributionRecord[]>('/portfolio-accounting/attribution', {
      searchParams: params as Record<string, string | number | boolean | undefined>,
    }),

  getSnapshots: (params?: { from?: string; to?: string; page?: number; limit?: number }) =>
    apiClient.get<{ data: PortfolioSnapshot[]; total: number }>('/portfolio-accounting/snapshots', {
      searchParams: params as Record<string, string | number | boolean | undefined>,
    }),

  getValuationStatus: () =>
    apiClient.get<{ state: string; lastValuationAt: string; missingPrices: string[]; fxStatus: string }>(
      '/portfolio-accounting/valuation-status'
    ),
};
