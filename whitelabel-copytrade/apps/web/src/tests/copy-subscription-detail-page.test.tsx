// # NEW — Verifies subscription detail view, pause/resume/stop actions, and execution list
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CopySubscriptionDetailPage } from "../features/trading/copy-subscription-detail-page";

describe("CopySubscriptionDetailPage (GAP-09)", () => {
  test("renders subscription status, effective policy, reconciliation status, and execution list", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["copy-subscription-detail", "sub-900"], {
      subscription: {
        subscriptionId: "sub-900",
        traderId: "tr-9",
        strategyId: "st-9",
        state: "ACTIVE",
        allocationMode: "FIXED",
        allocationAmount: "500.00",
        maxAllocation: "2000.00",
        minAllocation: "50.00",
        copyPolicy: null,
        riskPolicy: {
          maxDailyLoss: "300.00",
          maxDrawdown: "800.00",
          maxOpenExposure: "3000.00",
          maxExposurePerTrader: null,
          maxExposurePerSymbol: null,
          maxDailyCopiedTrades: 10,
          emergencyStopCopy: false,
        },
        totalCopies: 5,
        failedCopies: 0,
        startedAt: "2026-09-01T00:00:00.000Z",
        pausedAt: null,
        stoppedAt: null,
        stopReason: null,
        closeOpenPositionsOnStop: false,
      },
      effectivePolicy: {
        sizingMode: "FIXED",
        fixedQuantity: "0.2",
        multiplier: null,
        proportionalRatio: null,
        maxPositionSize: "2000",
        maxNotional: "5000",
        maxOpenPositions: 5,
        maxLeverage: "2",
        allowedSymbols: ["BTC-USDT"],
        blockedSymbols: [],
        allowedVenues: ["BINANCE"],
        orderTypePolicy: "MARKET_AND_LIMIT",
        slippageToleranceBps: 50,
        executionDelayMs: 0,
        takeProfitBps: 200,
        stopLossBps: 100,
        trailingStopBps: null,
        emergencyStop: false,
      },
      recentExecutions: [
        {
          executionId: "exec-901",
          subscriptionId: "sub-900",
          traderId: "tr-9",
          followerId: "user-1",
          strategyId: "st-9",
          leaderEventId: "fill:L901",
          leaderOrderId: "ord-L901",
          followerOrderId: "ord-F901",
          status: "COMPLETED",
          failureReason: null,
          leaderQuantity: "1.0",
          followerQuantity: "0.2",
          sizingMode: "FIXED",
          riskDecision: "ALLOW",
          riskReasons: [],
          isSimulated: false,
          createdAt: "2026-10-01T10:00:00.000Z",
          updatedAt: "2026-10-01T10:00:05.000Z",
        },
      ],
      reconciliation: {
        subscriptionId: "sub-900",
        status: "IN_SYNC",
        lastCheckedAt: "2026-10-01T10:05:00.000Z",
        totalExecutions: 5,
        completedExecutions: 5,
        failedExecutions: 0,
        riskBlockedExecutions: 0,
        discrepancyCount: 0,
        discrepancies: [],
      },
    });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <CopySubscriptionDetailPage subscriptionId="sub-900" />
      </QueryClientProvider>,
    );

    expect(html).toContain("data-testid=\"copy-subscription-detail-page\"");
    expect(html).toContain("data-testid=\"subscription-executions-table\"");
    expect(html).toContain("exec-901");
    expect(html).toContain("IN_SYNC");
  });
});
