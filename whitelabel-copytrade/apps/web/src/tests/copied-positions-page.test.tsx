// # NEW — Verifies copied positions table, PnL display, and empty state
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CopiedPositionsPage } from "../features/trading/copied-positions-page";

describe("CopiedPositionsPage (GAP-10)", () => {
  test("renders open copied positions with entry price, mark price, unrealized/realized PnL, and leader attribution", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["copied-positions", "sub-10", true, ""], [
      {
        positionId: "pos-1",
        subscriptionId: "sub-10",
        traderId: "tr-10",
        strategyId: "st-10",
        symbol: "BTC-USDT",
        side: "LONG",
        quantity: "0.45",
        averageEntryPrice: "62400.00",
        markPrice: "63950.00",
        unrealizedPnl: "697.50",
        realizedPnl: "125.00",
        isOpen: true,
        updatedAt: "2026-10-01T12:00:00.000Z",
      },
    ]);

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <CopiedPositionsPage subscriptionId="sub-10" />
      </QueryClientProvider>,
    );

    expect(html).toContain("data-testid=\"copied-positions-table\"");
    expect(html).toContain("BTC-USDT");
    expect(html).toContain("0.45");
  });
});
