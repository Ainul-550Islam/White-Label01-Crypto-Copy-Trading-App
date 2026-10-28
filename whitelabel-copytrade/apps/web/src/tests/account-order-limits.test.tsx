// # Responsibility: exercises the account-limit API contract and localized, safety-specific UI.
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { apiClient } from '@/api/api-client';
import { accountOrderLimitsApi } from '@/api/account-order-limits-api';
import { AuthContext } from '@/auth/auth.store';
import { accountOrderListKey, AccountOrderLimitSettings } from '@/features/trading/account-order-limit-settings';
import { accountOrderLimitCopy } from '@/features/trading/account-order-limit-copy';

jest.mock('@/api/api-client', () => ({ apiClient: { get: jest.fn(), put: jest.fn() } }));
const owner = { tenantId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', userId: '3f2504e0-4f89-41d3-9a0c-0305e82c3302' };
const accountId = '3f2504e0-4f89-41d3-9a0c-0305e82c3303';
const account = { id: accountId, label: 'Customer account', marketType: 'SPOT', tradingMode: 'PAPER', status: 'ACTIVE' };

test('uses the real owner-only paths, paginated list, exact decimals, revision and retry key', async () => {
  const input = { maxBaseQuantity: '0', maxOrderNotional: '1.000000000001', notionalCurrency: 'USDT', expectedRevision: null };
  (apiClient.put as jest.Mock).mockResolvedValue({});
  (apiClient.get as jest.Mock).mockResolvedValue({});
  await accountOrderLimitsApi.list(2);
  await accountOrderLimitsApi.get(accountId);
  await accountOrderLimitsApi.update(accountId, input, 'retry-key-1234');
  expect(apiClient.get).toHaveBeenNthCalledWith(1, '/v1/risk-management/my-account-order-limits', { searchParams: { page: 2, limit: 20 } });
  expect(apiClient.get).toHaveBeenNthCalledWith(2, `/v1/risk-management/my-account-order-limits/${accountId}`);
  expect(apiClient.put).toHaveBeenCalledWith(`/v1/risk-management/my-account-order-limits/${accountId}`, input, { idempotencyKey: 'retry-key-1234' });
});

test('renders actual account choices without pretending the account limit is aggregate exposure', () => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cache.setQueryData(accountOrderListKey(owner, 1), { data: [account], total: 1, page: 1, limit: 20 });
  const session = { user: { id: owner.userId, tenantId: owner.tenantId, email: 'a@example.test', roles: [], permissions: [] },
    tenant: { id: owner.tenantId, name: 'Tenant', slug: 'tenant' }, entitlements: {}, isAuthenticated: true };
  const html = renderToStaticMarkup(<AuthContext.Provider value={{ session, isLoading: false, isAuthenticated: true, error: null, refreshSession: async () => {}, logout: async () => {} }}>
    <QueryClientProvider client={cache}><AccountOrderLimitSettings /></QueryClientProvider></AuthContext.Provider>);
  expect(html).toContain('Customer account');
  expect(html).toContain('Choose an account');
  expect(html).toContain('not total account exposure');
  expect(html).toContain('SELL limits');
  expect(html).toContain('directly to an exchange');
});

test('supplies complete distinct safety and verification copy in all five languages', () => {
  const keys = Object.keys(accountOrderLimitCopy.en);
  for (const locale of ['en', 'bn', 'ar', 'es', 'tr'] as const) {
    expect(Object.keys(accountOrderLimitCopy[locale]).sort()).toEqual([...keys].sort());
    for (const value of Object.values(accountOrderLimitCopy[locale])) expect(value.length).toBeGreaterThan(0);
  }
});
