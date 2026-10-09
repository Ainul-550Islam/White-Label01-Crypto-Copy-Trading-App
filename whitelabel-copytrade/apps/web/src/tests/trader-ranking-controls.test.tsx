// # Responsibility: protects timeframe controls and clear ranking methodology/freshness disclosures.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TraderRankingControls } from '../features/trading/trader-ranking-controls';
import type { TraderRankingMethodology } from '../api/trading-api';

// `status` mirrors what the server can actually return: AVAILABLE or UNAVAILABLE. The case this
// fixture describes - four of five ranked - is AVAILABLE with a non-zero unrankedCount, and the
// unranked reason is carried in `reason`. The previous fixture used a status the API never emits.
const methodology: TraderRankingMethodology = {
  status: 'AVAILABLE',
  key: 'RECONCILED_CLOSED_PERIOD_TWR',
  description: 'Compounded return from verified periods.',
  timeframe: '30D',
  windowStart: '2026-09-01T00:00:00.000Z',
  asOf: '2026-10-01T00:00:00.000Z',
  boundaryRule: 'EXACT_CONTIGUOUS_PERIODS_ONLY',
  orderingRule: 'RETURN_DESCENDING_UNAVAILABLE_LAST',
  currentnessRule: 'AS_OF_DISPLAYED_CURRENTNESS_NOT_ASSERTED',
  minimumPeriodCount: 2,
  rankedCount: 4,
  unrankedCount: 1,
  reason: 'One profile lacks complete coverage.',
};

describe('TraderRankingControls', () => {
  it('offers documented 7D, 30D, and 90D windows and discloses exact coverage rules', () => {
    const html = renderToStaticMarkup(
      <TraderRankingControls timeframe="30D" onTimeframeChange={() => undefined} methodology={methodology} />,
    );
    expect(html).toContain('Ranking timeframe');
    expect(html).toContain('7 days');
    expect(html).toContain('30 days');
    expect(html).toContain('90 days');
    expect(html).toContain('compounded time-weighted return');
    expect(html).toContain('exact contiguous coverage');
    expect(html).toContain('minimum of 2 closed, reconciled periods');
    expect(html).toContain('2026-10-01T00:00:00.000Z');
    expect(html).toContain('not a claim of current market data');
  });
});
