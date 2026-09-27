import { apiClient } from './api-client';

export interface Statement {
  id: string;
  periodStart: string;
  periodEnd: string;
  state: string;
  type: string;
  nav: string;
  pnl: string;
  currency: string;
  downloadUrl?: string;
  createdAt: string;
}

export interface StatementDetail extends Statement {
  holdings: Array<{
    symbol: string;
    quantity: string;
    marketValue: string;
  }>;
  cashFlows: Array<{
    type: string;
    amount: string;
    timestamp: string;
  }>;
  performance: {
    returnPct: string;
    realizedPnl: string;
    unrealizedPnl: string;
  };
}

export const reportingApi = {
  listStatements: (params?: { type?: string; state?: string; page?: number; limit?: number }) =>
    apiClient.get<{ data: Statement[]; total: number }>('/portfolio-accounting/statements', {
      searchParams: params as Record<string, string | number | boolean | undefined>,
    }),

  getStatement: (id: string) => apiClient.get<StatementDetail>(`/portfolio-accounting/statements/${id}`),

  downloadStatement: (id: string) =>
    apiClient.get<{ url: string; expiresAt: string }>(`/portfolio-accounting/statements/${id}/download`),

  exportReport: (data: { type: string; from: string; to: string; format?: string }) =>
    apiClient.post<{ exportId: string; status: string }>('/portfolio-accounting/reports/export', data),

  getExportStatus: (exportId: string) =>
    apiClient.get<{ status: string; downloadUrl?: string; error?: string }>(`/portfolio-accounting/reports/${exportId}`),
};
