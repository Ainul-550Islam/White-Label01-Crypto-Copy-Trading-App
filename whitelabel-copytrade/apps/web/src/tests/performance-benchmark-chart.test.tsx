// # Responsibility: verifies the benchmark UI renders verified series and honest unavailable/partial states.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PerformanceBenchmarkChart } from '@/features/trading/performance-benchmark-chart';
import type { PerformanceBenchmarkSeries } from '@/api/trading-api';

const base: PerformanceBenchmarkSeries = {
  status: 'AVAILABLE',
  traderId: 'trader-1',
  benchmarkKey: 'BTC-USDT',
  baseCurrency: 'USD',
  methodology: 'TIME_WEIGHTED_RETURN',
  flowBoundary: 'START_FLOWS_IN_OPENING_NAV_END_FLOWS_EXCLUDED_FROM_CLOSING_NAV',
  calculationVersion: 'twr-v1',
  dataCompleteness: 'COMPLETE',
  asOf: '2025-01-03T00:00:00.000Z',
  currentnessRule: 'AS_OF_DISPLAYED_CURRENTNESS_NOT_ASSERTED',
  observations: [
    { periodStart: '2025-01-01T00:00:00.000Z', periodEnd: '2025-01-02T00:00:00.000Z', traderPeriodReturnPercent: '10', benchmarkPeriodReturnPercent: '5', traderCumulativeReturnPercent: '10', benchmarkCumulativeReturnPercent: '5' },
    { periodStart: '2025-01-02T00:00:00.000Z', periodEnd: '2025-01-03T00:00:00.000Z', traderPeriodReturnPercent: '-5', benchmarkPeriodReturnPercent: '10', traderCumulativeReturnPercent: '4.5', benchmarkCumulativeReturnPercent: '15.5' },
  ],
  sourceReferences: ['nav:period-1', 'benchmark:period-1'],
};

describe('PerformanceBenchmarkChart', () => {
  it('renders the two persisted series, methodology, completeness, and source references', () => {
    const html = renderToStaticMarkup(<PerformanceBenchmarkChart series={base} />);
    expect(html).toContain('Trader vs. market benchmark');
    expect(html).toContain('BTC-USDT');
    expect(html).toContain('TIME_WEIGHTED_RETURN');
    expect(html).toContain('Start-boundary flows are included in opening NAV');
    expect(html).toContain('Data completeness: COMPLETE');
    expect(html).toContain('2025-01-03T00:00:00.000Z');
    expect(html).toContain('currentness is not asserted');
    expect(html).toContain('nav:period-1');
    expect(html).toContain('polyline');
  });

  it('does not draw a fabricated series when data is unavailable or incomplete', () => {
    const unavailable = renderToStaticMarkup(<PerformanceBenchmarkChart series={{ ...base, status: 'UNAVAILABLE', dataCompleteness: 'UNAVAILABLE', observations: [], reason: 'No persisted benchmark.' }} />);
    expect(unavailable).toContain('No persisted benchmark.');
    expect(unavailable).toContain('No synthetic market-price');
    expect(unavailable).not.toContain('polyline');

    const partial = renderToStaticMarkup(<PerformanceBenchmarkChart series={{ ...base, dataCompleteness: 'PARTIAL' }} />);
    expect(partial).toContain('A verified trader and benchmark series is not available for comparison.');
    expect(partial).not.toContain('polyline');
  });
});
