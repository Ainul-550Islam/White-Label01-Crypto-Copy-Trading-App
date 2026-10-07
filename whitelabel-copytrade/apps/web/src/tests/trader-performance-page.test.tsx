// # NEW — Verifies trader performance page, charts, and metric tooltips
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TraderPerformancePage } from "../features/trading/trader-performance-page";
import {
  TRADER_METRIC_DEFINITIONS,
  describeDataProvenance,
  formatWinRatePercent,
} from "../features/trading/trader-metric-definitions";

describe("TraderPerformancePage (GAP-01 & GAP-02)", () => {
  test("renders canonical trader performance metrics, ACTUAL provenance badge, charts, and formula definitions", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["trader-performance-detail", "tr-101"], {
      profile: {
        traderId: "tr-101",
        displayName: "Elena Quant",
        bio: "Systematic BTC & ETH perpetuals",
        avatarUrl: null,
        verificationState: "VERIFIED",
        verifiedAt: "2026-09-01T00:00:00.000Z",
        supportedVenues: ["BINANCE"],
        supportedSymbols: ["BTC-USDT", "ETH-USDT"],
        isPublic: true,
        isFeatured: true,
        followerCount: 84,
        totalVolume: "1450000.00",
        totalTrades: 210,
        createdAt: "2026-06-01T00:00:00.000Z",
      },
      performance: {
        traderId: "tr-101",
        tenantId: "tenant-1",
        realizedPnl: "18420.50",
        unrealizedPnl: "640.00",
        totalReturn: "18420.50",
        totalReturnPercent: null,
        maxDrawdown: "1250.00",
        maxDrawdownPercent: null,
        winCount: 68,
        lossCount: 22,
        tradeCount: 90,
        winRate: "0.7555",
        lossRate: "0.2445",
        totalVolume: "1450000.00",
        averageTrade: "204.67",
        averageWin: "320.00",
        averageLoss: "151.80",
        profitFactor: "2.81",
        sharpeRatio: null,
        historyLengthDays: 120,
        lastTradeAt: "2026-10-01T10:00:00.000Z",
        isActual: true,
        source: "FILLS",
      },
      strategies: [
        {
          strategyId: "strat-1",
          traderId: "tr-101",
          name: "Momentum Alpha",
          description: "Trend following",
          status: "PUBLISHED",
          type: "ALGORITHMIC",
          supportedSymbols: ["BTC-USDT"],
          supportedVenues: ["BINANCE"],
          followerCount: 84,
          totalCopies: 320,
          publishedAt: "2026-06-15T00:00:00.000Z",
          createdAt: "2026-06-01T00:00:00.000Z",
        },
      ],
    });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <TraderPerformancePage id="tr-101" />
      </QueryClientProvider>,
    );

    expect(html).toContain("data-testid=\"trader-performance-page\"");
    expect(html).toContain("ACTUAL (FILLS)");
    expect(html).toContain("data-testid=\"trader-performance-chart\"");
    expect(html).toContain("Momentum Alpha");
    expect(html).toContain("2.81");
    expect(TRADER_METRIC_DEFINITIONS.profitFactor.formula).toBe(
      "Gross Winning PnL ÷ |Gross Losing PnL|",
    );
    expect(describeDataProvenance({ isActual: true, source: "FILLS" }).badgeLabel).toBe("ACTUAL");
    expect(formatWinRatePercent("0.7555")).toBe("75.5%");
  });
});
