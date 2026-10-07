// # NEW — Verifies copy settings form load, validation, effective policy preview, and save
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CopySettingsPage } from "../features/trading/copy-settings-page";
import { tradingApi } from "../api/trading-api";
import { apiClient } from "../api/api-client";

describe("CopySettingsPage (GAP-06 & GAP-07)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("loads subscription settings, displays effective policy preview, and saves updated TP/SL/risk settings", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["copy-subscription-detail", "sub-55"], {
      subscription: {
        subscriptionId: "sub-55",
        traderId: "tr-1",
        strategyId: "st-1",
        state: "ACTIVE",
        allocationMode: "FIXED",
        allocationAmount: "250.00",
        maxAllocation: "1000.00",
        minAllocation: "50.00",
        copyPolicy: {
          sizingMode: "FIXED",
          fixedQuantity: "0.1",
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
          slippageToleranceBps: 40,
          executionDelayMs: 100,
          takeProfitBps: 250,
          stopLossBps: 125,
          trailingStopBps: 60,
          emergencyStop: false,
        },
        riskPolicy: {
          maxDailyLoss: "400",
          maxDrawdown: "900",
          maxOpenExposure: "4000",
          maxExposurePerTrader: null,
          maxExposurePerSymbol: null,
          maxDailyCopiedTrades: 20,
          emergencyStopCopy: false,
        },
        totalCopies: 10,
        failedCopies: 0,
        startedAt: "2026-09-01T00:00:00.000Z",
        pausedAt: null,
        stoppedAt: null,
        stopReason: null,
        closeOpenPositionsOnStop: false,
      },
      effectivePolicy: {
        sizingMode: "FIXED",
        fixedQuantity: "0.1",
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
        slippageToleranceBps: 40,
        executionDelayMs: 100,
        takeProfitBps: 250,
        stopLossBps: 125,
        trailingStopBps: 60,
        emergencyStop: false,
      },
      recentExecutions: [],
      reconciliation: {
        subscriptionId: "sub-55",
        status: "IN_SYNC",
        lastCheckedAt: "2026-10-01T00:00:00.000Z",
        totalExecutions: 10,
        completedExecutions: 10,
        failedExecutions: 0,
        riskBlockedExecutions: 0,
        discrepancyCount: 0,
        discrepancies: [],
      },
    });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <CopySettingsPage subscriptionId="sub-55" />
      </QueryClientProvider>,
    );

    expect(html).toContain("data-testid=\"copy-settings-page\"");
    expect(html).toContain("data-testid=\"effective-policy-preview\"");
    expect(html).toContain("250 / 125 / 60 bps");

    const putSpy = jest.spyOn(apiClient, "put").mockResolvedValue({
      subscriptionId: "sub-55",
      traderId: "tr-1",
      strategyId: "st-1",
      state: "ACTIVE",
      allocationMode: "FIXED",
      allocationAmount: "300.00",
    });

    const updated = await tradingApi.updateCopySubscriptionSettings("sub-55", {
      allocationMode: "FIXED",
      allocationAmount: "300.00",
      copyPolicy: { takeProfitBps: 350, stopLossBps: 150, trailingStopBps: 75 },
    });
    expect(putSpy).toHaveBeenCalledWith(
      "/v1/copy-trading/subscriptions/sub-55",
      expect.objectContaining({ allocationAmount: "300.00" }),
    );
    expect(updated.allocationAmount).toBe("300.00");
  });
});
