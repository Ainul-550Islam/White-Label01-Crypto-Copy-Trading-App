// # Responsibility: verifies customers see the active fee rate and HWM scope without fabricated fee amounts.

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicLeaderFeePolicy } from '../api/trading-api';
import { LeaderFeeSettingsPage } from '../features/trading/leader-fee-settings-page';

const response: PublicLeaderFeePolicy = {
  traderId: '22222222-3333-4444-8555-666666666666',
  currency: 'USD',
  status: 'AVAILABLE',
  policy: {
    id: '44444444-5555-4666-8777-888888888888',
    traderId: '22222222-3333-4444-8555-666666666666',
    currency: 'USD',
    profitShareBps: 750,
    highWaterMarkScope: 'PER_FOLLOWER_CURRENCY',
    version: 2,
    effectiveFrom: '2030-01-01T00:00:00.000Z',
    effectiveTo: null,
    createdAt: '2029-12-15T12:00:00.000Z',
  },
  feeCalculation: {
    status: 'UNAVAILABLE',
    reason: 'A verified, reconciled, posted follower-profit source and settlement integration are not connected to this fee disclosure.',
  },
};

function renderDisclosure(value: PublicLeaderFeePolicy): string {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['leader-fee-policy', value.traderId, value.currency], value);
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <LeaderFeeSettingsPage traderId={value.traderId} currency={value.currency} />
    </QueryClientProvider>,
  );
}

describe('LeaderFeeSettingsPage', () => {
  it('shows policy rate, scope, version, effective date, and honest unavailable calculation state', () => {
    const html = renderDisclosure(response);
    expect(html).toContain('Lead trader fee disclosure');
    expect(html).toContain('750 bps (7.5%)');
    expect(html).toContain('Per follower and currency');
    expect(html).toContain('v2');
    expect(html).toContain('2030-01-01T00:00:00.000Z');
    expect(html).toContain('Fee amount unavailable');
    expect(html).toContain('not a charge, statement, or estimate');
  });

  it('does not infer a zero fee when the trader has not published a policy', () => {
    const html = renderDisclosure({ ...response, status: 'UNCONFIGURED', policy: null });
    expect(html).toContain('No policy published');
    expect(html).toContain('No active profit-share policy has been published');
    expect(html).not.toContain('0 bps');
    expect(html).not.toContain('0.00%');
  });
});
