// # Responsibility: checks leaderboard timeframe sorting contract and renders incomplete period evidence as unranked.

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TraderLeaderboard } from '../api/trading-api';
import { LeaderboardPage } from '../features/trading/leaderboard-page';

const data: TraderLeaderboard = {
  page: 1,
  limit: 25,
  total: 2,
  methodology: {
    status: 'PARTIAL',
    key: 'RECONCILED_CLOSED_PERIOD_TWR',
    description: 'Ranks from closed, reconciled, contiguous periods.',
    timeframe: '30D',
    windowStart: '2026-09-01T00:00:00.000Z',
    asOf: '2026-10-01T00:00:00.000Z',
    boundaryRule: 'EXACT_CONTIGUOUS_PERIODS_ONLY',
    orderingRule: 'RETURN_DESCENDING_UNAVAILABLE_LAST',
    currentnessRule: 'AS_OF_DISPLAYED_CURRENTNESS_NOT_ASSERTED',
    minimumPeriodCount: 2,
    rankedCount: 1,
    unrankedCount: 1,
    reason: 'One trader lacks exact window coverage.',
  },
  data: [
    {
      traderId: 'ranked-1',
      tenantId: 'tenant-1',
      displayName: 'Ranked Trader',
      verificationState: 'VERIFIED',
      isPublic: true,
      isFeatured: false,
      followerCount: 0,
      performance: null,
      score: null,
      rank: 1,
      timeframe: '30D',
      periodStatus: 'AVAILABLE',
      periodReturnPercent: '4.25',
      periodStart: '2026-09-01T00:00:00.000Z',
      periodEnd: '2026-10-01T00:00:00.000Z',
      baseCurrency: 'USD',
      flowBoundary: 'START_FLOWS_IN_OPENING_NAV_END_FLOWS_EXCLUDED_FROM_CLOSING_NAV',
      calculationVersion: 'twr-linked-periods-v1-integer-decimal',
      sourceCalculationVersion: 'accounting-close-v3',
      observationCount: 2,
      sourceReferences: ['record-1'],
      unavailableReason: null,
      rankingMethodology: 'RECONCILED_CLOSED_PERIOD_TWR',
      metrics: { riskAdjustedReturn: null, drawdownScore: null, consistencyScore: null, historyLengthScore: null, followerScore: null, activityScore: null, verifiedScore: null },
      weighting: {},
    },
    {
      traderId: 'unranked-1',
      tenantId: 'tenant-1',
      displayName: 'Unranked Trader',
      verificationState: 'VERIFIED',
      isPublic: true,
      isFeatured: false,
      followerCount: 0,
      performance: null,
      score: null,
      rank: null,
      timeframe: '30D',
      periodStatus: 'UNAVAILABLE',
      periodReturnPercent: null,
      periodStart: null,
      periodEnd: null,
      baseCurrency: null,
      flowBoundary: null,
      calculationVersion: null,
      sourceCalculationVersion: null,
      observationCount: null,
      sourceReferences: [],
      unavailableReason: 'Accounting-period coverage contains a gap or overlap.',
      rankingMethodology: 'RECONCILED_CLOSED_PERIOD_TWR',
      metrics: { riskAdjustedReturn: null, drawdownScore: null, consistencyScore: null, historyLengthScore: null, followerScore: null, activityScore: null, verifiedScore: null },
      weighting: {},
    },
  ],
};

describe('LeaderboardPage', () => {
  it('shows the selected period return and leaves incomplete windows unranked', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['leaderboard', '30D'], data);
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <LeaderboardPage />
      </QueryClientProvider>,
    );

    expect(html).toContain('30D time-weighted return');
    expect(html).toContain('4.25%');
    expect(html).toContain('2 closed periods');
    expect(html).toContain('accounting-close-v3');
    expect(html).toContain('Start flows are included in opening NAV');
    expect(html).toContain('#1');
    expect(html).toContain('Unranked');
    expect(html).toContain('gap or overlap');
    expect(html).toContain('not a claim of current market data');
  });
});
