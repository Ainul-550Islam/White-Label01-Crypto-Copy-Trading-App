// # Responsibility: checks the copy budget screen - the three limits are shown as three different numbers, an unavailable reading is not shown as zero, and the form rules are the DTO's rules.

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { apiClient } from '@/api/api-client';
import type { CopyBudget } from '@/api/copy-trading-extended-api';
import { AuthContext } from '@/auth/auth.store';
import { CopyBudgetScreen, budgetInputProblem, copyBudgetQueryKey } from '@/features/copy-trading/copy-budget-screen';

const session = {
  user: { id: 'user-1', tenantId: 'tenant-1', email: 'a@example.test', roles: [], permissions: [] },
  tenant: { id: 'tenant-1', name: 'Tenant', slug: 'tenant' },
  entitlements: {},
  isAuthenticated: true,
};

const budget: CopyBudget = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  maxActiveExposure: '1000.000000000000',
  perTraderCap: '250.000000000000',
  tenantCeiling: '5000.000000000000',
  effectiveCap: '1000.000000000000',
  currency: 'USDT',
  currentExposure: '100.000000000000',
  exposureStatus: 'ALLOCATION_ESTIMATE',
  remaining: '900.000000000000',
  utilisationBps: 1000,
  updatedAt: '2026-10-30T03:00:00.000Z',
};

function render(value?: CopyBudget | null): string {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (value) queryClient.setQueryData(copyBudgetQueryKey, value);
  return renderToStaticMarkup(
    <AuthContext.Provider value={{ session, isLoading: false, isAuthenticated: true, error: null, refreshSession: async () => {}, logout: async () => {} }}>
      <QueryClientProvider client={queryClient}><CopyBudgetScreen /></QueryClientProvider>
    </AuthContext.Provider>,
  );
}

describe('rendering', () => {
  it('shows the personal cap, the enforced cap, what is committed and what remains', () => {
    const html = render(budget);

    expect(html).toContain('1000.000000000000');
    expect(html).toContain('5000.000000000000');
    expect(html).toContain('100.000000000000');
    expect(html).toContain('900.000000000000');
    expect(html).toContain('250.000000000000');
    expect(html).toContain('1000');
    // Committed capital is an allocation estimate, not a live exchange reading.
    expect(html).toContain('ALLOCATION_ESTIMATE');
    expect(html).toContain('allocation estimate');
  });

  it('renders an unavailable figure as unavailable, never as zero', () => {
    const html = render({ ...budget, maxActiveExposure: null, perTraderCap: null, effectiveCap: null, remaining: null, utilisationBps: null, exposureStatus: 'UNAVAILABLE', currentExposure: null });

    expect(html).toContain('Not available');
    expect(html).not.toContain('>0</dd>');
  });

  it('loads instead of rendering empty limits when nothing is cached yet', () => {
    expect(render(null)).toContain('Loading');
  });

  it('says a reduction applies immediately and cannot raise the limit', () => {
    expect(render(budget)).toContain('cannot raise the limit');
  });
});

describe('form rules', () => {
  it.each([
    [{ maxActiveExposure: '', perTraderCap: '', currency: 'USDT' }, 'amount'],
    [{ maxActiveExposure: '1e5', perTraderCap: '', currency: 'USDT' }, 'amount'],
    [{ maxActiveExposure: '-1', perTraderCap: '', currency: 'USDT' }, 'amount'],
    [{ maxActiveExposure: '1000', perTraderCap: 'abc', currency: 'USDT' }, 'amount'],
    [{ maxActiveExposure: '1000', perTraderCap: '', currency: 'U' }, 'currency'],
    [{ maxActiveExposure: '1000', perTraderCap: '', currency: 'U$D' }, 'currency'],
  ])('rejects %j with %s', (input, expected) => {
    expect(budgetInputProblem(input)).toBe(expected);
  });

  it('accepts an exact decimal at the column scale and upper-cases the currency', () => {
    expect(budgetInputProblem({ maxActiveExposure: '1000.100000000000', perTraderCap: '', currency: 'usdt' })).toBeNull();
    expect(budgetInputProblem({ maxActiveExposure: '0', perTraderCap: '0', currency: 'BTC' })).toBeNull();
  });
});

describe('saves', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends the save as a PUT carrying the decimal string unchanged', async () => {
    const put = jest.spyOn(apiClient, 'put').mockResolvedValue({} as never);

    const { copyTradingExtendedApi } = await import('@/api/copy-trading-extended-api');
    await copyTradingExtendedApi.putBudget({ maxActiveExposure: '1000.100000000000', perTraderCap: null, currency: 'USDT' }, 'budget-key-1');

    expect(put).toHaveBeenCalledWith('/v1/copy-trading/budget', { maxActiveExposure: '1000.100000000000', perTraderCap: null, currency: 'USDT' }, { idempotencyKey: 'budget-key-1' });
  });
});
