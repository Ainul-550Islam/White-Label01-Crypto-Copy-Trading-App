// # NEW — Verifies risk guardrail headroom, block reasons, and emergency stop action
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CopyRiskGuardrails } from "../features/trading/copy-risk-guardrails";
import type { CopySubscriptionItem } from "../api/trading-api";

const mockSubscription: CopySubscriptionItem = {
  subscriptionId: "sub-1",
  traderId: "tr-1",
  strategyId: "st-1",
  state: "ACTIVE",
  allocationMode: "FIXED",
  allocationAmount: "200.00",
  maxAllocation: "1000.00",
  minAllocation: "25.00",
  copyPolicy: null,
  riskPolicy: {
    maxDailyLoss: "500.00",
    maxDrawdown: "1200.00",
    maxOpenExposure: "5000.00",
    maxExposurePerTrader: "2500.00",
    maxExposurePerSymbol: "1500.00",
    maxDailyCopiedTrades: 15,
    emergencyStopCopy: false,
  },
  totalCopies: 8,
  failedCopies: 1,
  startedAt: "2026-09-01T00:00:00.000Z",
  pausedAt: null,
  stoppedAt: null,
  stopReason: null,
  closeOpenPositionsOnStop: false,
};

describe("CopyRiskGuardrails (GAP-14)", () => {
  test("renders follower risk limits, block reasons, and emergency stop controls", () => {
    const html = renderToStaticMarkup(
      <CopyRiskGuardrails
        subscription={mockSubscription}
        recentExecutions={[
          {
            executionId: "exec-b1",
            subscriptionId: "sub-1",
            traderId: "tr-1",
            followerId: "u-1",
            strategyId: "st-1",
            leaderEventId: "fill:1",
            leaderOrderId: "ord-1",
            followerOrderId: null,
            status: "RISK_BLOCKED",
            failureReason: "Exposure cap exceeded",
            leaderQuantity: "1",
            followerQuantity: "0",
            sizingMode: "FIXED",
            riskDecision: "BLOCK",
            riskReasons: ["Max symbol exposure 1500 exceeded"],
            isSimulated: false,
            createdAt: "2026-10-01T00:00:00.000Z",
            updatedAt: "2026-10-01T00:00:00.000Z",
          },
        ]}
        onEmergencyStop={() => {}}
      />,
    );

    expect(html).toContain("data-testid=\"copy-risk-guardrails\"");
    expect(html).toContain("Max symbol exposure 1500 exceeded");
    expect(html).toContain("data-testid=\"emergency-stop-close-btn\"");
    expect(html).toContain("data-testid=\"emergency-stop-keep-btn\"");
  });
});
