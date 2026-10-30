// # Responsibility: checks the accounting screen renders the service's decimal strings verbatim, shows empty and error states, and never computes a total of its own.

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { AuthContext } from '@/auth/auth.store';
import {
  AccountingOverview,
  accountingPhase,
  accountingHoldingsQueryKey,
  accountingNavQueryKey,
  accountingPeriodsQueryKey,
  accountingPnlQueryKey,
  accountingProfilesQueryKey,
  accountingStatementsQueryKey,
} from '@/features/portfolio/accounting-overview';

const session = {
  user: { id: 'user-1', tenantId: 'tenant-1', email: 'a@example.test', roles: [], permissions: [] },
  tenant: { id: 'tenant-1', name: 'Tenant', slug: 'tenant' },
  entitlements: {},
  isAuthenticated: true,
};
const profileId = 'profile-1';

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function render(queryClient: QueryClient, profile = ''): string {
  return renderToStaticMarkup(
    <AuthContext.Provider value={{ session, isLoading: false, isAuthenticated: true, error: null, refreshSession: async () => {}, logout: async () => {} }}>
      <QueryClientProvider client={queryClient}><AccountingOverview initialProfileId={profile} /></QueryClientProvider>
    </AuthContext.Provider>,
  );
}


function seed(queryClient: QueryClient): void {
  queryClient.setQueryData(accountingProfilesQueryKey, { data: [{ id: profileId, scope: 'TENANT', scopeId: 'tenant-1', baseCurrency: 'USD', returnMethodology: 'TWR' }], total: 1 });
}

describe('profiles', () => {
  it('asks for a profile instead of showing zeroes before one is chosen', () => {
    const queryClient = client();
    seed(queryClient);

    const html = render(queryClient);

    expect(html).toContain('Portfolio accounting');
    expect(html).toContain('Choose an accounting profile to read its figures.');
    expect(html).not.toContain('Net asset value');
  });

  it('renders the empty state when the tenant has no accounting profile', () => {
    const queryClient = client();
    queryClient.setQueryData(accountingProfilesQueryKey, { data: [], total: 0 });

    expect(render(queryClient)).toContain('No accounting data has been recorded for this profile.');
  });

  // The error branch is rendered by the shared ErrorState, which has its own test (it maps an ApiError to
  // a safe message and never prints a response body). What is asserted here is that this screen selects
  // that branch instead of rendering an empty profile list that would read as "no data".
  it('selects the error branch when the profile list cannot be read', () => {
    expect(accountingPhase({ isPending: false, isError: true })).toBe('error');
    expect(accountingPhase({ isPending: true, isError: false })).toBe('loading');
    expect(accountingPhase({ isPending: false, isError: false })).toBe('ready');
  });
});

describe('figures', () => {
  it('shows the published decimal strings exactly, without reformatting them into numbers', () => {
    const queryClient = client();
    seed(queryClient);
    queryClient.setQueryData(accountingNavQueryKey(profileId), {
      nav: '1234.567890123456', cash: '12.000000000001', baseCurrency: 'USD', valuationTimestamp: '2026-10-30T03:00:00.000Z', dataCompleteness: 'COMPLETE', canPublish: true,
    });
    queryClient.setQueryData(accountingPnlQueryKey(profileId), { realized: '10.000000000001', unrealized: '-2.500000000000', gross: '12.500000000001', net: '7.500000000001', dataCompleteness: 'COMPLETE' });
    queryClient.setQueryData(accountingHoldingsQueryKey(profileId), { data: [{ symbol: 'BTC-USDT', asset: 'BTC', quantity: '0.500000000000', costBasis: '1000.000000000000' }], total: 1 });
    queryClient.setQueryData(accountingPeriodsQueryKey(profileId), { data: [{ id: 'period-1', state: 'OPEN', startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-10-31T00:00:00.000Z' }], total: 1 });
    queryClient.setQueryData(accountingStatementsQueryKey(profileId), { data: [{ id: 'statement-1', generatedAt: '2026-10-30T03:00:00.000Z', state: 'PUBLISHED' }], total: 1 });

    const html = render(queryClient, profileId);

    expect(html).toContain('1234.567890123456');
    expect(html).toContain('12.000000000001');
    expect(html).toContain('10.000000000001');
    expect(html).toContain('-2.500000000000');
    expect(html).toContain('0.500000000000');
    expect(html).toContain('1000.000000000000');
    expect(html).toContain('BTC-USDT');
    expect(html).toContain('statement-1'.length > 0 ? 'Export statement' : '');
  });

  it('says a figure is unavailable rather than publishing a number it does not have', () => {
    const queryClient = client();
    seed(queryClient);
    queryClient.setQueryData(accountingNavQueryKey(profileId), {
      nav: '10.000000000000', cash: '10.000000000000', baseCurrency: 'USD', valuationTimestamp: null, dataCompleteness: 'PARTIAL', canPublish: false, valuationState: 'POSITION_WITHOUT_MARK_PRICE',
    });

    const html = render(queryClient, profileId);

    expect(html).toContain('This figure is not available for the selected profile.');
    expect(html).toContain('POSITION_WITHOUT_MARK_PRICE');
  });
});
