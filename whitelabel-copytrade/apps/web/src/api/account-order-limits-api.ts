// # Responsibility: typed owner-only account order-size limit contract.
import { apiClient } from './api-client';

export type AccountOrderLimitAccount = { id: string; label: string; marketType: string; tradingMode: string; status: string };
export type AccountOrderLimitPage = { data: AccountOrderLimitAccount[]; total: number; page: number; limit: number };
export type AccountOrderLimitView = {
  tenantId: string;
  account: AccountOrderLimitAccount;
  limits: { maxBaseQuantity: string | null; maxOrderNotional: string | null; notionalCurrency: string | null };
  configured: boolean;
  revision: string | null;
  updatedAt: string | null;
  asOf: string;
};
export type AccountOrderLimitUpdate = {
  expectedRevision: string | null;
  maxBaseQuantity: string | null;
  maxOrderNotional: string | null;
  notionalCurrency: string | null;
};
const ROOT = '/v1/risk-management/my-account-order-limits';
export const accountOrderLimitsApi = {
  list(page: number, limit = 20): Promise<AccountOrderLimitPage> {
    return apiClient.get<AccountOrderLimitPage>(ROOT, { searchParams: { page, limit } });
  },
  get(accountId: string): Promise<AccountOrderLimitView> {
    return apiClient.get<AccountOrderLimitView>(`${ROOT}/${encodeURIComponent(accountId)}`);
  },
  update(accountId: string, input: AccountOrderLimitUpdate, idempotencyKey: string): Promise<AccountOrderLimitView> {
    return apiClient.put<AccountOrderLimitView>(`${ROOT}/${encodeURIComponent(accountId)}`, input, { idempotencyKey });
  },
};
