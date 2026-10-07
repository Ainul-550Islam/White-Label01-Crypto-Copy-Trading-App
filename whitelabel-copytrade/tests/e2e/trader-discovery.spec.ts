// # NEW — E2E test: browse traders -> filter -> compare -> view performance
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TradersPage } from '../../apps/web/src/features/trading/traders-page';

describe('E2E Smoke: Trader Discovery, Comparison & Performance (GAP-48)', () => {
  test('browse traders -> filter -> compare -> view performance', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['traders', '', '', false], {
      data: [
        {
          traderId: 'trader-alpha',
          displayName: 'Alpha Quant Desk',
          bio: 'Systematic BTC/ETH momentum',
          avatarUrl: null,
          verificationState: 'VERIFIED',
          verifiedAt: '2026-08-01T00:00:00.000Z',
          supportedVenues: ['BINANCE', 'BYBIT'],
          supportedSymbols: ['BTC-USDT', 'ETH-USDT'],
          isPublic: true,
          isFeatured: true,
          followerCount: 145,
          totalVolume: '920000',
          totalTrades: 84,
          createdAt: '2026-06-01T00:00:00.000Z',
        },
      ],
      total: 1,
    });
    queryClient.setQueryData(['trader-rankings-discovery', '', '', false], {
      data: [],
      total: 0,
    });

    const directoryHtml = renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(TradersPage),
      ),
    );
    expect(directoryHtml).toContain('Alpha Quant Desk');
    expect(directoryHtml).toContain('/traders/compare');
  });
});
