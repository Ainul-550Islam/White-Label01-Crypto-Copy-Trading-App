// # Responsibility: verifies that the customer exposure panel labels price provenance and never renders unavailable totals as zero/current.

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CustomerExposureView } from '@/api/customer-exposure-api';
import { CUSTOMER_EXPOSURE_QUERY_KEY, CustomerExposurePanel } from '@/features/portfolio/customer-exposure-panel';
import { APP_ROUTES } from '@/config/routes';
import { featureCatalog } from '@/config/feature-config';

const baseView: CustomerExposureView = {
  tenantId: 'tenant-owned',
  traderId: null,
  asOf: '2026-10-06T00:00:00.000Z',
  state: 'CURRENT',
  eligibleAccountCount: 1,
  lines: [{
    symbol: 'BTC-USDT',
    venue: 'BINANCE',
    marketType: 'SPOT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    longQuantity: '1',
    shortQuantity: '0',
    netQuantity: '1',
    longPositionNotional: '100',
    shortPositionNotional: '0',
    grossPositionNotional: '100',
    netPositionNotional: '100',
    openOrderCommitment: '0',
    totalNotional: '100',
    openOrderCount: 0,
    openOrderCommitmentBasis: null,
    price: '100',
    priceSource: 'MARKET_DATA_1M_CANDLE_CLOSE',
    priceTimestamp: '2026-10-06T00:00:00.000Z',
    positionState: 'CURRENT',
    openOrderState: 'NO_OPEN_ORDERS',
    state: 'CURRENT',
  }],
  totalsByQuoteAsset: [{
    quoteAsset: 'USDT',
    longPositionNotional: '100',
    shortPositionNotional: '0',
    grossPositionNotional: '100',
    openOrderCommitment: '0',
    totalNotional: '100',
    state: 'CURRENT',
  }],
  staleSymbols: [],
  unknownSymbols: [],
  dataScope: 'SIGNED_IN_USER_NON_SANDBOX_NON_SIMULATED_ACCOUNTS',
  simulatedRecordsIncluded: false,
  cashBalancesIncluded: false,
  currencyTreatment: 'SEPARATE_QUOTE_ASSETS_NO_FX_CONVERSION',
  priceMethodology: 'LATEST_1M_CANDLE_CLOSE_WITH_POLICY_FRESHNESS',
  notice: 'Positions use a fresh tenant-instrument-linked 1-minute close. Cash and FX are not included.',
};

function renderView(view: CustomerExposureView): string {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(CUSTOMER_EXPOSURE_QUERY_KEY, view);
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <CustomerExposurePanel />
    </QueryClientProvider>,
  );
}

describe('CustomerExposurePanel', () => {
  it('shows the fresh one-minute reference and separates position and order values by quote asset', () => {
    const html = renderView(baseView);

    expect(html).toContain('Current reference data');
    expect(html).toContain('1-minute close reference');
    expect(html).toContain('100 USDT');
    expect(html).toContain('Totals by quote asset');
    expect(html).toContain('Cash balances excluded');
    expect(html).toContain('No FX rate is assumed');
  });

  it('withholds stale values and quote totals instead of presenting them as current', () => {
    const stale: CustomerExposureView = {
      ...baseView,
      state: 'STALE',
      staleSymbols: ['BINANCE:BTC-USDT'],
      lines: [{
        ...baseView.lines[0]!,
        price: null,
        priceSource: null,
        priceTimestamp: '2026-10-05T23:58:00.000Z',
        grossPositionNotional: null,
        totalNotional: null,
        positionState: 'STALE',
        state: 'STALE',
      }],
      totalsByQuoteAsset: [{
        ...baseView.totalsByQuoteAsset[0]!,
        longPositionNotional: null,
        shortPositionNotional: null,
        grossPositionNotional: null,
        openOrderCommitment: null,
        totalNotional: null,
        state: 'STALE',
      }],
    };
    const html = renderView(stale);

    expect(html).toContain('Stale price data');
    expect(html).toContain('Stale prices: BINANCE:BTC-USDT');
    expect(html).toContain('Totals for affected quote assets are not shown');
    expect(html).toContain('Unavailable');
    expect(html).not.toContain('100 USDT');
  });

  it('withholds missing-price totals and never changes unknown values into zero', () => {
    const unknown: CustomerExposureView = {
      ...baseView,
      state: 'UNKNOWN',
      unknownSymbols: ['BINANCE:BTC-USDT'],
      lines: [{
        ...baseView.lines[0]!,
        price: null,
        priceSource: null,
        priceTimestamp: null,
        grossPositionNotional: null,
        netPositionNotional: null,
        totalNotional: null,
        positionState: 'UNKNOWN',
        state: 'UNKNOWN',
      }],
      totalsByQuoteAsset: [{
        ...baseView.totalsByQuoteAsset[0]!,
        longPositionNotional: null,
        shortPositionNotional: null,
        grossPositionNotional: null,
        openOrderCommitment: null,
        totalNotional: null,
        state: 'UNKNOWN',
      }],
    };
    const html = renderView(unknown);

    expect(html).toContain('Valuation unavailable');
    expect(html).toContain('Missing or invalid prices/data: BINANCE:BTC-USDT');
    expect(html).toContain('Unavailable');
    expect(html).not.toContain('<td class=\"p-3 text-right font-mono\">0 USDT</td>');
  });

  it('renders an honest empty state rather than a fabricated zero total', () => {
    const empty: CustomerExposureView = {
      ...baseView,
      state: 'EMPTY',
      eligibleAccountCount: 0,
      lines: [],
      totalsByQuoteAsset: [],
    };
    const html = renderView(empty);

    expect(html).toContain('No open exposure found');
    expect(html).toContain('no non-deleted non-sandbox exchange accounts');
    expect(html).not.toContain('<td class=\"p-3 text-right font-mono\">0 USDT</td>');
  });

  it('registers a portfolio route with UX-only permission gates for risk or portfolio readers', () => {
    expect(APP_ROUTES.riskExposure).toMatchObject({
      path: '/risk/exposure',
      section: 'portfolio',
      requiresAuth: true,
    });
    expect(featureCatalog.find((feature) => feature.key === 'risk_exposure')?.requiresPermission).toEqual([
      'risk:read',
      'portfolio:read',
    ]);
  });
});
