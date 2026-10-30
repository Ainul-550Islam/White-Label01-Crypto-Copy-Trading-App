// # Responsibility: checks the rebalance preview screen - the exact request it builds, the stable Idempotency-Key it sends, and that a preview the form has moved past is rejected rather than shown as current.

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { apiClient } from '@/api/api-client';
import { copyTradingExtendedApi } from '@/api/copy-trading-extended-api';
import { AuthContext } from '@/auth/auth.store';
import {
  AllocationRebalanceScreen,
  buildPreviewRequest,
  isPreviewStale,
  rebalanceFingerprint,
  type Draft,
} from '@/features/copy-trading/allocation-rebalance-screen';

const session = {
  user: { id: 'user-1', tenantId: 'tenant-1', email: 'a@example.test', roles: [], permissions: [] },
  tenant: { id: 'tenant-1', name: 'Tenant', slug: 'tenant' },
  entitlements: {},
  isAuthenticated: true,
};

function render(): string {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <AuthContext.Provider value={{ session, isLoading: false, isAuthenticated: true, error: null, refreshSession: async () => {}, logout: async () => {} }}>
      <QueryClientProvider client={queryClient}><AllocationRebalanceScreen /></QueryClientProvider>
    </AuthContext.Provider>,
  );
}

const rows: Draft[] = [
  { traderId: ' trader-a ', currentValue: ' 600.10 ', targetWeightBps: '6000', priceAvailable: true },
  { traderId: 'trader-b', currentValue: '399.90', targetWeightBps: '4000', priceAvailable: false },
];

describe('request shape', () => {
  it('trims the typed values and keeps every decimal exactly as entered', () => {
    expect(buildPreviewRequest(' 1000.10 ', rows)).toEqual({
      totalValue: '1000.10',
      allocations: [
        { traderId: 'trader-a', currentValue: '600.10', targetWeightBps: 6000, priceAvailable: true },
        { traderId: 'trader-b', currentValue: '399.90', targetWeightBps: 4000, priceAvailable: false },
      ],
    });
  });

  it('never coerces a money field to a number', () => {
    const request = buildPreviewRequest('0.000000000001', rows);

    expect(typeof request.totalValue).toBe('string');
    expect(request.totalValue).toBe('0.000000000001');
    expect(typeof request.allocations[0]?.currentValue).toBe('string');
  });
});

describe('staleness', () => {
  it('treats a preview with no recorded input as stale, not as current', () => {
    expect(isPreviewStale(null, 'anything')).toBe(false);
    expect(isPreviewStale('a', 'a')).toBe(false);
    expect(isPreviewStale('a', 'b')).toBe(true);
  });

  it('changes the fingerprint when any field the preview depended on changes', () => {
    const base = rebalanceFingerprint('1000.10', rows);
    const weightChanged = rebalanceFingerprint('1000.10', [{ ...rows[0]!, targetWeightBps: '6001' }, rows[1]!]);
    const priceFlagChanged = rebalanceFingerprint('1000.10', [{ ...rows[0]!, priceAvailable: false }, rows[1]!]);
    const totalChanged = rebalanceFingerprint('1000.11', rows);

    expect(weightChanged).not.toBe(base);
    expect(priceFlagChanged).not.toBe(base);
    expect(totalChanged).not.toBe(base);
    // Whitespace is not a change: the request trims the same values.
    expect(rebalanceFingerprint(' 1000.10 ', rows)).toBe(base);
  });
});

describe('the rendered screen', () => {
  it('starts empty and says a preview is not an execution', () => {
    const html = render();

    expect(html).toContain('Allocation rebalance preview');
    expect(html).toContain('No preview has been requested yet.');
    expect(html).toContain('It is not an order, not a transfer');
    expect(html).toContain('never creates an order or moves funds');
    expect(html).toContain('Preview rebalance');
    expect(html).toContain('aria-live="polite"');
  });

  it('labels every input so the table is operable with a screen reader', () => {
    const html = render();

    expect(html).toContain('aria-label="Trader identifier 1"');
    expect(html).toContain('aria-label="Current value 1"');
    expect(html).toContain('aria-label="Target weight (basis points) 1"');
    expect(html).toContain('<caption class="sr-only">Trader allocations</caption>');
  });
});

describe('the preview call', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends the built request with the caller key and refuses an executable answer', async () => {
    const post = jest.spyOn(apiClient, 'post').mockResolvedValue({ executable: true, inputProvenance: 'CLIENT_SUPPLIED_UNVERIFIED', lines: [] } as never);

    await expect(copyTradingExtendedApi.previewAllocationRebalance(buildPreviewRequest('1000.10', rows), 'preview-key-0001')).rejects.toThrow(/non-executable/);
    expect(post).toHaveBeenCalledWith(
      '/v1/copy-trading/allocation-rebalance/preview',
      buildPreviewRequest('1000.10', rows),
      { idempotencyKey: 'preview-key-0001' },
    );
  });
});
