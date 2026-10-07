// # Responsibility: verifies customer concentration/correlation disclosure, source timestamps, and withholding of stale or unknown statistics.

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CustomerRiskAnalysisView } from '@/api/risk-analysis-api';
import { CUSTOMER_RISK_ANALYSIS_QUERY_KEY, ConcentrationRiskPanel } from '@/features/trading/concentration-risk-panel';

const currentRiskAnalysis: CustomerRiskAnalysisView = {
  tenantId: 'tenant-from-api',
  requestedAt: '2026-10-06T11:45:00.000Z',
  dataScope: 'SIGNED_IN_USER_NON_SANDBOX_NON_SIMULATED_ACCOUNTS',
  concentration: {
    tenantId: 'tenant-from-api',
    asOf: '2026-10-06T11:44:58.000Z',
    state: 'CURRENT',
    eligibleAccountCount: 1,
    dataScope: 'SIGNED_IN_USER_NON_SANDBOX_NON_SIMULATED_ACCOUNTS',
    methodology: 'GROSS_POSITION_NOTIONAL_WITHIN_QUOTE_ASSET_NO_FX',
    marketDataMaxAgeMs: 30_000,
    metrics: [
      {
        dimension: 'ASSET',
        key: 'BTC',
        quoteAsset: 'USDT',
        currentNotional: '60',
        currentPercent: '60',
        thresholdPercent: '40',
        isBreach: true,
        state: 'CURRENT',
        source: 'MARKET_DATA_1M_CANDLE_CLOSE',
        observedAt: '2026-10-06T11:44:30.000Z',
        evidenceSymbols: ['BINANCE:BTC-USDT', 'BINANCE:ETH-USDT'],
        reason: 'Measured gross USDT concentration 60% for BTC exceeds configured threshold 40%.',
      },
    ],
    staleSymbols: [],
    unknownSymbols: [],
    notice: 'Concentration is measured within quote asset from fresh instrument-linked one-minute candle closes.',
  },
  correlation: {
    tenantId: 'tenant-from-api',
    asOf: '2026-10-06T11:44:59.000Z',
    state: 'CURRENT',
    dataScope: 'SIGNED_IN_USER_NON_SANDBOX_NON_SIMULATED_ACCOUNTS',
    method: 'PEARSON_30D_ALIGNED_DAILY',
    methodVersion: 'v2.0.0',
    interval: '1d',
    lookbackDays: 30,
    minObservations: 30,
    maxSourceAgeMs: 129_600_000,
    activePositionCount: 2,
    instrumentCount: 2,
    omittedPositionCount: 0,
    candidatePairCount: 1,
    evaluatedPairCount: 1,
    truncatedPairCount: 0,
    pairs: [
      {
        tenantId: 'tenant-from-api',
        method: 'PEARSON_30D_ALIGNED_DAILY',
        methodVersion: 'v2.0.0',
        lookbackDays: 30,
        minObservations: 30,
        observations: 30,
        pairKey: 'BINANCE:BTC-USDT:BINANCE:ETH-USDT',
        correlation: '0.912345',
        threshold: '0.8',
        isBreach: true,
        state: 'HIGH',
        ruleId: 'MAX_CORRELATION',
        policyVersion: 'tenant-risk-policy-v4',
        reason: 'Measured aligned daily price-return correlation 0.912345 exceeds the absolute threshold 0.8.',
        severity: 'WARNING',
        isUnknown: false,
        sourceInterval: '1d',
        sourceTimestamp: '2026-10-05T23:59:59.999Z',
        sourceMaxAgeMs: 129_600_000,
        sourceSymbols: ['BINANCE:BTC-USDT', 'BINANCE:ETH-USDT'],
        sourceMethodology: 'ALIGNED_DAILY_CLOSE_RETURNS',
        isStale: false,
      },
    ],
    notice: 'Correlation is a measured price-return statistic and does not imply hedge effectiveness.',
  },
};

function renderRiskAnalysis(view: CustomerRiskAnalysisView): string {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(CUSTOMER_RISK_ANALYSIS_QUERY_KEY, view);
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <ConcentrationRiskPanel />
    </QueryClientProvider>,
  );
}

describe('ConcentrationRiskPanel', () => {
  it('renders measured concentration and only server-sourced, timestamp-aligned correlation with provenance', () => {
    const html = renderRiskAnalysis(currentRiskAnalysis);

    expect(html).toContain('Measured concentration');
    expect(html).toContain('60 USDT');
    expect(html).toContain('60%');
    expect(html).toContain('Threshold exceeded');
    expect(html).toContain('1-minute candle close');
    expect(html).toContain('2026-10-06T11:44:30.000Z UTC');
    expect(html).toContain('Measured correlation');
    expect(html).toContain('0.912345');
    expect(html).toContain('30 aligned daily return observations');
    expect(html).toContain('ALIGNED_DAILY_CLOSE_RETURNS');
    expect(html).toContain('2026-10-05T23:59:59.999Z UTC');
    expect(html).toContain('maximum source age 36 hours');
    expect(html).toContain('not a hedge guarantee');
  });

  it('withholds stale and unknown concentration/correlation values instead of rendering zero or a safe score', () => {
    const unavailable: CustomerRiskAnalysisView = {
      ...currentRiskAnalysis,
      concentration: {
        ...currentRiskAnalysis.concentration,
        state: 'STALE',
        staleSymbols: ['BINANCE:BTC-USDT'],
        metrics: [{
          ...currentRiskAnalysis.concentration.metrics[0]!,
          currentNotional: null,
          currentPercent: null,
          isBreach: null,
          state: 'STALE',
          source: 'UNAVAILABLE',
          observedAt: '2026-10-06T11:42:00.000Z',
          reason: 'Concentration is withheld because the source candle is stale.',
        }],
      },
      correlation: {
        ...currentRiskAnalysis.correlation,
        state: 'UNKNOWN',
        pairs: [{
          ...currentRiskAnalysis.correlation.pairs[0]!,
          correlation: null,
          observations: 0,
          state: 'UNKNOWN',
          isUnknown: true,
          isStale: false,
          sourceTimestamp: null,
          reason: 'Only 0 valid timestamp-aligned daily return pairs are available.',
        }],
      },
    };
    const html = renderRiskAnalysis(unavailable);

    expect(html).toContain('Stale evidence — value withheld');
    expect(html).toContain('Unknown or incomplete — value withheld');
    expect(html).toContain('Unavailable');
    expect(html).toContain('Stale sources: BINANCE:BTC-USDT');
    expect(html).not.toContain('60 USDT');
    expect(html).not.toContain('0.912345');
    expect(html).not.toContain('0.000000');
  });

  it('discloses incomplete candidate-pair coverage rather than implying a full correlation matrix', () => {
    const incomplete: CustomerRiskAnalysisView = {
      ...currentRiskAnalysis,
      correlation: {
        ...currentRiskAnalysis.correlation,
        state: 'UNKNOWN',
        candidatePairCount: 27,
        evaluatedPairCount: 20,
        truncatedPairCount: 7,
      },
    };
    const html = renderRiskAnalysis(incomplete);

    expect(html).toContain('7 eligible pair(s) were not evaluated');
    expect(html).toContain('not a complete correlation matrix');
  });
});
