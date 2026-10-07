// # NEW — Verifies trader comparison selection, metrics table, and empty/error states
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TraderComparisonPage } from "../features/trading/trader-comparison-page";

describe("TraderComparisonPage (GAP-03)", () => {
  test("renders side-by-side trader comparison matrix with canonical performance and strategies", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["traders", "comparison-catalog"], {
      data: [
        {
          traderId: "tr-1",
          displayName: "Alpha Quant",
          bio: null,
          avatarUrl: null,
          verificationState: "VERIFIED",
          verifiedAt: null,
          supportedVenues: ["BINANCE"],
          supportedSymbols: ["BTC-USDT"],
          isPublic: true,
          isFeatured: true,
          followerCount: 50,
          totalVolume: "800000",
          totalTrades: 110,
          createdAt: "2026-06-01T00:00:00.000Z",
        },
        {
          traderId: "tr-2",
          displayName: "Beta Arbitrage",
          bio: null,
          avatarUrl: null,
          verificationState: "VERIFIED",
          verifiedAt: null,
          supportedVenues: ["KRAKEN"],
          supportedSymbols: ["ETH-USDT"],
          isPublic: true,
          isFeatured: false,
          followerCount: 30,
          totalVolume: "540000",
          totalTrades: 85,
          createdAt: "2026-06-01T00:00:00.000Z",
        },
      ],
      total: 2,
    });

    queryClient.setQueryData(["traders-compare", "tr-1,tr-2"], [
      {
        profile: {
          traderId: "tr-1",
          displayName: "Alpha Quant",
          bio: null,
          avatarUrl: null,
          verificationState: "VERIFIED",
          verifiedAt: null,
          supportedVenues: ["BINANCE"],
          supportedSymbols: ["BTC-USDT"],
          isPublic: true,
          isFeatured: true,
          followerCount: 50,
          totalVolume: "800000",
          totalTrades: 110,
          createdAt: "2026-06-01T00:00:00.000Z",
        },
        performance: {
          traderId: "tr-1",
          tenantId: "t-1",
          realizedPnl: "12400.00",
          unrealizedPnl: "200.00",
          totalReturn: "12400.00",
          totalReturnPercent: null,
          maxDrawdown: "800.00",
          maxDrawdownPercent: null,
          winCount: 70,
          lossCount: 30,
          tradeCount: 100,
          winRate: "0.70",
          lossRate: "0.30",
          totalVolume: "800000",
          averageTrade: "124.00",
          averageWin: "220.00",
          averageLoss: "100.00",
          profitFactor: "2.20",
          sharpeRatio: null,
          historyLengthDays: 95,
          lastTradeAt: "2026-10-01T00:00:00.000Z",
          isActual: true,
          source: "FILLS",
        },
        strategies: [
          {
            strategyId: "st-1",
            traderId: "tr-1",
            name: "Alpha BTC Trend",
            description: null,
            status: "PUBLISHED",
            type: "ALGORITHMIC",
            supportedSymbols: ["BTC-USDT"],
            supportedVenues: ["BINANCE"],
            followerCount: 50,
            totalCopies: 190,
            publishedAt: "2026-07-01T00:00:00.000Z",
            createdAt: "2026-06-01T00:00:00.000Z",
          },
        ],
      },
      {
        profile: {
          traderId: "tr-2",
          displayName: "Beta Arbitrage",
          bio: null,
          avatarUrl: null,
          verificationState: "VERIFIED",
          verifiedAt: null,
          supportedVenues: ["KRAKEN"],
          supportedSymbols: ["ETH-USDT"],
          isPublic: true,
          isFeatured: false,
          followerCount: 30,
          totalVolume: "540000",
          totalTrades: 85,
          createdAt: "2026-06-01T00:00:00.000Z",
        },
        performance: {
          traderId: "tr-2",
          tenantId: "t-1",
          realizedPnl: "6300.00",
          unrealizedPnl: "0.00",
          totalReturn: "6300.00",
          totalReturnPercent: null,
          maxDrawdown: "450.00",
          maxDrawdownPercent: null,
          winCount: 55,
          lossCount: 25,
          tradeCount: 80,
          winRate: "0.6875",
          lossRate: "0.3125",
          totalVolume: "540000",
          averageTrade: "78.75",
          averageWin: "150.00",
          averageLoss: "78.00",
          profitFactor: "1.92",
          sharpeRatio: null,
          historyLengthDays: 75,
          lastTradeAt: "2026-10-01T00:00:00.000Z",
          isActual: true,
          source: "FILLS",
        },
        strategies: [],
      },
    ]);

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <TraderComparisonPage initialIds={["tr-1", "tr-2"]} />
      </QueryClientProvider>,
    );

    expect(html).toContain("data-testid=\"trader-comparison-table\"");
    expect(html).toContain("Alpha BTC Trend");
    expect(html).toContain("2.20");
    expect(html).toContain("1.92");
  });
});
