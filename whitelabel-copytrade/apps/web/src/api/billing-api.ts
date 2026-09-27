import { apiClient } from './api-client';

export interface Plan {
  id: string;
  name: string;
  slug: string;
  description?: string;
  price: string;
  currency: string;
  billingInterval: string;
  features: string[];
  limits: Record<string, number>;
  entitlements: Record<string, boolean>;
  isPopular?: boolean;
}

export interface Subscription {
  id: string;
  planId: string;
  planName: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  trialEnd?: string;
  createdAt: string;
}

export interface Invoice {
  id: string;
  number: string;
  status: string;
  amount: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  paidAt?: string;
  downloadUrl?: string;
  createdAt: string;
}

export interface UsageRecord {
  meter: string;
  current: number;
  limit: number;
  remaining: number;
  periodStart: string;
  periodEnd: string;
}

export interface Payment {
  id: string;
  amount: string;
  currency: string;
  status: string;
  method?: string;
  createdAt: string;
}

export const billingApi = {
  listPlans: () => apiClient.get<Plan[]>('/v1/billing/plans'),

  getCurrentSubscription: () => apiClient.get<Subscription>('/v1/billing/subscription/current'),

  getSubscription: (id: string) => apiClient.get<Subscription>(`/v1/billing/subscription/${id}`),

  createCheckout: (data: { planId: string; successUrl?: string; cancelUrl?: string }) =>
    apiClient.post<{ checkoutUrl: string; sessionId: string }>('/v1/billing/checkout', data),

  cancelSubscription: (data: { reason?: string; cancelAtPeriodEnd?: boolean }) =>
    apiClient.post<Subscription>('/v1/billing/subscription/cancel', data),

  resumeSubscription: () => apiClient.post<Subscription>('/v1/billing/subscription/resume'),

  listInvoices: (params?: { page?: number; limit?: number }) =>
    apiClient.get<{ data: Invoice[]; total: number }>('/v1/billing/portal/invoices', {
      searchParams: params as Record<string, string | number | boolean | undefined>,
    }),

  getInvoice: (id: string) => apiClient.get<Invoice>(`/v1/billing/portal/invoices/${id}`),

  listPayments: (params?: { page?: number; limit?: number }) =>
    apiClient.get<{ data: Payment[]; total: number }>('/v1/billing/portal/payments', {
      searchParams: params as Record<string, string | number | boolean | undefined>,
    }),

  getUsage: () => apiClient.get<UsageRecord[]>('/v1/billing/portal/usage'),

  getPortalUrl: () => apiClient.get<{ url: string }>('/v1/billing/portal/url'),
};
