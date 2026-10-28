// # Responsibility: verifies customer position-limit settings, current usage provenance, zero semantics, and unknown-data disclosure.

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UserPositionLimitsView } from '@/api/user-position-limits-api';
import { AuthContext } from '@/auth/auth.store';
import { PositionLimitSettings, positionLimitsQueryKey } from '@/features/trading/position-limit-settings';

const baseView: UserPositionLimitsView = {
  tenantId: 'tenant-from-authenticated-api',
  limits: { maxConcurrentPositions: 3, maxOpenOrders: 8 },
  configured: true,
  updatedAt: '2026-10-07T10:00:00.000Z',
  usage: { ownedAccountCount: 2, openPositionSlots: 2, openOrderCount: 5 },
  usageState: 'CURRENT',
  accountScope: 'USER_OWNED_NON_DELETED_ACCOUNTS_INCLUDING_PAPER_AND_LIVE',
  asOf: '2026-10-07T10:05:00.000Z',
};

function renderSettings(view: UserPositionLimitsView): string {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(positionLimitsQueryKey(view.tenantId, 'user-a'), view);
  const session = { user: { id: 'user-a', tenantId: view.tenantId, email: 'a@example.test', roles: [], permissions: [] },
    tenant: { id: view.tenantId, name: 'Tenant', slug: 'tenant' }, entitlements: {}, isAuthenticated: true };
  return renderToStaticMarkup(
    <AuthContext.Provider value={{ session, isLoading: false, isAuthenticated: true, error: null, refreshSession: async () => {}, logout: async () => {} }}>
      <QueryClientProvider client={queryClient}><PositionLimitSettings /></QueryClientProvider>
    </AuthContext.Provider>,
  );
}

describe('PositionLimitSettings', () => {
  it('renders saved count ceilings, sourced usage, and the account scope without presenting them as notional risk', () => {
    const html = renderSettings(baseView);

    expect(html).toContain('Concurrent position and order limits');
    expect(html).toContain('value="3"');
    expect(html).toContain('value="8"');
    expect(html).toContain('Position slots');
    expect(html).toContain('Open orders');
    expect(html).toContain('Owned accounts included');
    expect(html).toContain('>2</dd>');
    expect(html).toContain('>5</dd>');
    expect(html).toContain('These are count limits, not notional or balance limits');
    expect(html).toContain('Orders placed directly at an exchange cannot be blocked');
  });

  it('distinguishes unknown usage from zero and describes zero as a blocking ceiling', () => {
    const unknown: UserPositionLimitsView = {
      ...baseView,
      limits: { maxConcurrentPositions: 0, maxOpenOrders: null },
      usage: null,
      usageState: 'UNKNOWN',
    };
    const html = renderSettings(unknown);

    expect(html).toContain('value="0"');
    expect(html).toContain('Usage is unknown');
    expect(html).toContain('does not substitute zero');
    expect(html).toContain('zero blocks new reservations');
    expect(html).not.toContain('data-testid="position-limit-usage"');
  });

  it('keeps clear as a form action and does not imply that existing orders or positions are canceled', () => {
    const html = renderSettings(baseView);

    expect(html).toContain('Clear fields');
    expect(html).toContain('Lowering a limit does not cancel existing orders or positions');
    expect(html).toContain('Save limits');
  });
});
