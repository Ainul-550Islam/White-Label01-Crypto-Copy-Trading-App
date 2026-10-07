// # NEW — Verifies execution detail rendering and rejection/failure reason display
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CopyExecutionDetail } from "../features/trading/copy-execution-detail";

describe("CopyExecutionDetail (GAP-12)", () => {
  test("renders leader event details, sizing calculation, and child order linkage", () => {
    const html = renderToStaticMarkup(
      <CopyExecutionDetail
        execution={{
          executionId: "exec-1",
          subscriptionId: "sub-1",
          traderId: "tr-1",
          followerId: "user-1",
          strategyId: "st-1",
          leaderEventId: "fill:leader-99",
          leaderOrderId: "ord-L99",
          followerOrderId: "ord-F99",
          status: "ROUTED",
          failureReason: null,
          leaderQuantity: "2.0",
          followerQuantity: "0.5",
          sizingMode: "PROPORTIONAL",
          riskDecision: "ALLOW",
          riskReasons: [],
          isSimulated: false,
          createdAt: "2026-10-01T10:00:00.000Z",
          updatedAt: "2026-10-01T10:00:01.000Z",
        }}
      />,
    );

    expect(html).toContain("data-testid=\"copy-execution-detail\"");
    expect(html).toContain("ord-F99");
    expect(html).toContain("ALLOW");
  });

  test("displays risk block and failure reasons when execution is RISK_BLOCKED", () => {
    const html = renderToStaticMarkup(
      <CopyExecutionDetail
        execution={{
          executionId: "exec-2",
          subscriptionId: "sub-1",
          traderId: "tr-1",
          followerId: "user-1",
          strategyId: "st-1",
          leaderEventId: "fill:leader-100",
          leaderOrderId: "ord-L100",
          followerOrderId: null,
          status: "RISK_BLOCKED",
          failureReason: "Follower daily loss limit exceeded",
          leaderQuantity: "1.0",
          followerQuantity: "0",
          sizingMode: "FIXED",
          riskDecision: "BLOCK",
          riskReasons: ["Daily loss 520 exceeds maxDailyLoss 500"],
          isSimulated: false,
          createdAt: "2026-10-01T11:00:00.000Z",
          updatedAt: "2026-10-01T11:00:01.000Z",
        }}
      />,
    );

    expect(html).toContain("data-testid=\"execution-block-reasons\"");
    expect(html).toContain("Follower daily loss limit exceeded");
    expect(html).toContain("Daily loss 520 exceeds maxDailyLoss 500");
  });
});
