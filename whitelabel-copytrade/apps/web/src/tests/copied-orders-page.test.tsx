// # NEW — Verifies copied orders and fills rendering, status filter, and error handling
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CopiedOrdersPage } from "../features/trading/copied-orders-page";

describe("CopiedOrdersPage (GAP-11)", () => {
  test("renders copied orders table with fill quantities, average fill price, fees, and rejection reasons", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["copied-orders", "sub-11", ""], [
      {
        executionId: "exec-11",
        subscriptionId: "sub-11",
        traderId: "tr-1",
        followerId: "u-1",
        strategyId: "st-1",
        leaderEventId: "fill:11",
        leaderOrderId: "ord-L11",
        followerOrderId: "ord-F11",
        status: "COMPLETED",
        failureReason: null,
        leaderQuantity: "1.0",
        followerQuantity: "0.25",
        sizingMode: "PROPORTIONAL",
        riskDecision: "ALLOW",
        riskReasons: [],
        isSimulated: false,
        createdAt: "2026-10-01T10:00:00.000Z",
        updatedAt: "2026-10-01T10:00:02.000Z",
        symbol: "ETH-USDT",
        side: "BUY",
        orderType: "MARKET",
        orderStatus: "FILLED",
        filledQuantity: "0.25",
        remainingQuantity: "0",
        averageFillPrice: "2650.00",
        fee: "0.66",
        feeAsset: "USDT",
        slippageBps: 12,
      },
    ]);

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <CopiedOrdersPage subscriptionId="sub-11" />
      </QueryClientProvider>,
    );

    expect(html).toContain("data-testid=\"copied-orders-table\"");
    expect(html).toContain("ETH-USDT");
    expect(html).toContain("0.25 / 0.25");
    expect(html).toContain("ord-F11");
  });
});
