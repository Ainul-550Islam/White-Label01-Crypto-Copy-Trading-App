// # Responsibility: typed customer API contract for authenticated user-wide position and open-order limits.

import { apiClient } from './api-client';

export type UserPositionLimitUsage = {
  ownedAccountCount: number;
  openPositionSlots: number;
  openOrderCount: number;
};

export type UserPositionLimitsView = {
  tenantId: string;
  limits: {
    maxConcurrentPositions: number | null;
    maxOpenOrders: number | null;
  };
  configured: boolean;
  updatedAt: string | null;
  usage: UserPositionLimitUsage | null;
  usageState: 'CURRENT' | 'UNKNOWN';
  accountScope: 'USER_OWNED_NON_DELETED_ACCOUNTS_INCLUDING_PAPER_AND_LIVE';
  asOf: string;
};

export type UpdateUserPositionLimitsInput = {
  maxConcurrentPositions?: number | null;
  maxOpenOrders?: number | null;
};

export const userPositionLimitsApi = {
  getMyLimits(): Promise<UserPositionLimitsView> {
    return apiClient.get<UserPositionLimitsView>('/v1/risk-management/my-position-limits');
  },

  updateMyLimits(input: UpdateUserPositionLimitsInput): Promise<UserPositionLimitsView> {
    return apiClient.put<UserPositionLimitsView>('/v1/risk-management/my-position-limits', input);
  },
};
