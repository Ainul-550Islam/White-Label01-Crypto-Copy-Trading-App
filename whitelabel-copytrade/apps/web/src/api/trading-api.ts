import { apiClient } from './api-client';

export interface TraderProfile {
  id: string;
  displayName: string;
  bio?: string;
  verificationState: string;
  status: string;
  performance: {
    totalReturn: string;
    monthlyReturn: string;
    sharpeRatio?: string;
    maxDrawdown: string;
    winRate: string;
  };
  risk: {
    level: string;
    score?: string;
  };
  strategyCount: number;
  followerCount: number;
  createdAt: string;
}

export interface Strategy {
  id: string;
  name: string;
  description?: string;
  traderId: string;
  traderName: string;
  status: string;
  health: string;
  type: string;
  version: string;
  performance: {
    totalReturn: string;
    monthlyReturn: string;
    maxDrawdown: string;
  };
  risk: {
    level: string;
  };
  eligibility: {
    canCopy: boolean;
    reasons?: string[];
    requiresKyc?: boolean;
    requiresFunding?: boolean;
  };
  createdAt: string;
}

export interface CopySubscription {
  id: string;
  traderId: string;
  strategyId: string;
  status: string;
  allocationPct: string;
  allocationAmount: string;
  sizingMode: string;
  risk: {
    maxDrawdown?: string;
    stopLoss?: string;
  };
  performance: {
    pnl: string;
    returnPct: string;
  };
  createdAt: string;
  updatedAt: string;
}

export const tradingApi = {
  listTraders: (params?: { search?: string; sortBy?: string; page?: number; limit?: number }) =>
    apiClient.get<{ data: TraderProfile[]; total: number }>('/copy-trading/traders', {
      searchParams: params as Record<string, string | number | boolean | undefined>,
    }),

  getTrader: (id: string) => apiClient.get<TraderProfile>(`/copy-trading/traders/${id}`),

  listStrategies: (params?: { traderId?: string; status?: string; search?: string; page?: number; limit?: number }) =>
    apiClient.get<{ data: Strategy[]; total: number }>('/strategies', {
      searchParams: params as Record<string, string | number | boolean | undefined>,
    }),

  getStrategy: (id: string) => apiClient.get<Strategy>(`/strategies/${id}`),

  listCopySubscriptions: () =>
    apiClient.get<{ data: CopySubscription[]; total: number }>('/copy-trading/subscriptions'),

  createCopySubscription: (data: { strategyId: string; allocationAmount: string; sizingMode?: string }) =>
    apiClient.post<CopySubscription>('/copy-trading/subscriptions', data),

  updateCopySubscription: (id: string, data: { allocationAmount?: string; status?: string }) =>
    apiClient.patch<CopySubscription>(`/copy-trading/subscriptions/${id}`, data),

  cancelCopySubscription: (id: string) => apiClient.delete<void>(`/copy-trading/subscriptions/${id}`),

  getTradingStatus: () =>
    apiClient.get<{
      eligibility: string;
      isLive: boolean;
      restrictions: Array<{ type: string; reason: string }>;
      riskBlocks: Array<{ type: string; reason: string }>;
      complianceBlocks: Array<{ type: string; reason: string }>;
      maintenance?: { active: boolean; message: string; scope: string };
    }>('/copy-trading/trading-status'),
};
