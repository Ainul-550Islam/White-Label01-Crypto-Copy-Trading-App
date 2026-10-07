// # NEW — Verifies strategy detail analytics and effective policy summary
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrategyDetailPage } from "../features/trading/strategy-detail-page";

describe("StrategyDetailPage (GAP-05)", () => {
  test("renders strategy details, effective copy policy constraints, and lead trader attribution", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["strategy-analytics", "st-100"], {
      strategy: {
        strategyId: "st-100",
        traderId: "tr-10",
        name: "Delta Neutral Basis",
        description: "Perpetual basis capture",
        status: "PUBLISHED",
        type: "ALGORITHMIC",
        supportedSymbols: ["BTC-USDT", "ETH-USDT"],
        supportedVenues: ["BINANCE", "BYBIT"],
        followerCount: 64,
        totalCopies: 410,
        publishedAt: "2026-08-01T00:00:00.000Z",
        createdAt: "2026-07-15T00:00:00.000Z",
      },
      effectivePolicy: {
        sizingMode: "PROPORTIONAL",
        fixedQuantity: null,
        multiplier: "1.0",
        proportionalRatio: "0.10",
        maxPositionSize: "5000",
        maxNotional: "25000",
        maxOpenPositions: 10,
        maxLeverage: "3",
        allowedSymbols: ["BTC-USDT", "ETH-USDT"],
        blockedSymbols: [],
        allowedVenues: ["BINANCE", "BYBIT"],
        orderTypePolicy: "MARKET_ONLY",
        slippageToleranceBps: 45,
        executionDelayMs: 150,
        takeProfitBps: 250,
        stopLossBps: 120,
        trailingStopBps: null,
        emergencyStop: false,
      },
      traderPerformance: {
        traderId: "tr-10",
        tenantId: "t-1",
        realizedPnl: "9840.00",
        unrealizedPnl: "110.00",
        totalReturn: "9840.00",
        totalReturnPercent: null,
        maxDrawdown: "620.00",
        maxDrawdownPercent: null,
        winCount: 54,
        lossCount: 16,
        tradeCount: 70,
        winRate: "0.7714",
        lossRate: "0.2286",
        totalVolume: "1120000",
        averageTrade: "140.57",
        averageWin: "215.00",
        averageLoss: "110.00",
        profitFactor: "2.65",
        sharpeRatio: null,
        historyLengthDays: 88,
        lastTradeAt: "2026-10-01T00:00:00.000Z",
        isActual: true,
        source: "FILLS",
      },
    });
    queryClient.setQueryData(["trading-status"], {
      eligibility: "ELIGIBLE",
      canCopy: true,
      restrictions: [],
      maintenance: null,
    });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <StrategyDetailPage id="st-100" />
      </QueryClientProvider>,
    );

    expect(html).toContain("data-testid=\"strategy-detail-page\"");
    expect(html).toContain("PROPORTIONAL");
    expect(html).toContain("45 bps");
    expect(html).toContain("ACTUAL (FILLS)");
  });
});
