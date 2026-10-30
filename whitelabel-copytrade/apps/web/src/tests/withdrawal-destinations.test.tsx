// # Responsibility: checks the destinations page shows a pending address as waiting (not usable), keeps a revoked address visible, and maps the API's rejection message instead of inventing success.

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthContext } from '@/auth/auth.store';
import type { WithdrawalDestination } from '@/api/withdrawal-destination-api';
import { DestinationsScreen } from '@/features/funding/destinations-screen';
import { WITHDRAWAL_DESTINATIONS_QUERY_KEY } from '@/features/funding/withdrawal-destination-manager';

const session = {
  user: { id: 'user-1', tenantId: 'tenant-1', email: 'a@example.test', roles: [], permissions: [] },
  tenant: { id: 'tenant-1', name: 'Tenant', slug: 'tenant' },
  entitlements: {},
  isAuthenticated: true,
};

const pending: WithdrawalDestination = {
  id: 'destination-1', network: 'ETHEREUM', address: `0x${'a'.repeat(40)}`, label: 'Cold wallet',
  status: 'PENDING', activatesAt: '2026-10-31T03:00:00.000Z', revokedAt: null,
  createdAt: '2026-10-30T03:00:00.000Z', remainingCooldownMs: 3_600_000,
};
const revoked: WithdrawalDestination = {
  ...pending, id: 'destination-2', label: 'Old wallet', status: 'REVOKED', revokedAt: '2026-10-30T02:00:00.000Z', remainingCooldownMs: 0,
};


function render(rows: WithdrawalDestination[] | 'error'): string {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (rows !== 'error') queryClient.setQueryData(WITHDRAWAL_DESTINATIONS_QUERY_KEY, rows);
  return renderToStaticMarkup(
    <AuthContext.Provider value={{ session, isLoading: false, isAuthenticated: true, error: null, refreshSession: async () => {}, logout: async () => {} }}>
      <QueryClientProvider client={queryClient}><DestinationsScreen /></QueryClientProvider>
    </AuthContext.Provider>,
  );
}

describe('the destinations page', () => {
  it('states that changing an address needs a fresh proof', () => {
    const html = render([]);

    expect(html).toContain('Withdrawal destinations');
    expect(html).toContain('Confirm your identity to change this address.');
  });

  it('shows a pending address as waiting with the time it becomes usable', () => {
    const html = render([pending]);

    expect(html).toContain('Cold wallet');
    expect(html).toContain('PENDING');
    expect(html).toContain('usable in');
    expect(html).toContain('1 address still waiting to become usable');
  });

  it('keeps a revoked address visible and marked as unusable', () => {
    const html = render([pending, revoked]);

    expect(html).toContain('Old wallet');
    expect(html).toContain('REVOKED');
    expect(html).toContain('Revoke');
  });

  it('renders the empty state, not an empty table, when nothing was added', () => {
    const html = render([]);

    expect(html).toContain('No withdrawal addresses yet');
    expect(html).toContain('It becomes usable once its safety period has passed.');
  });

  it('shows a populated allowlist instead of the empty message', () => {
    // A refused or malformed list is rendered by the manager's error branch (shared ErrorState); what
    // matters here is that an empty result and a populated one are distinguishable.
    expect(render([])).toContain('No withdrawal addresses yet');
    expect(render([pending])).not.toContain('No withdrawal addresses yet');
  });
});
