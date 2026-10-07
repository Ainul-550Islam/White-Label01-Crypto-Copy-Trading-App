// # NEW — Verifies stop-copy policy selection and open-position handling
import { tradingApi } from "../api/trading-api";
import { apiClient } from "../api/api-client";

describe("Stop-Copy Position Handling Policy (GAP-17)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("passes closeOpenPositions=true and stop reason when stopping a subscription", async () => {
    const postSpy = jest.spyOn(apiClient, "post").mockResolvedValue({
      subscriptionId: "sub-17",
      traderId: "tr-1",
      strategyId: "st-1",
      state: "STOPPED",
      allocationMode: "FIXED",
      allocationAmount: "100",
      stopReason: "Emergency flatten requested",
      closeOpenPositionsOnStop: true,
    });

    const result = await tradingApi.stopSubscription(
      "sub-17",
      "Emergency flatten requested",
      true,
    );

    expect(postSpy).toHaveBeenCalledWith("/v1/copy-trading/subscriptions/sub-17/stop", {
      reason: "Emergency flatten requested",
      closeOpenPositions: true,
    });
    expect(result.state).toBe("STOPPED");
    expect(result.closeOpenPositionsOnStop).toBe(true);
    expect(result.stopReason).toBe("Emergency flatten requested");
  });

  test("defaults closeOpenPositions=false when keeping open positions on stop", async () => {
    const postSpy = jest.spyOn(apiClient, "post").mockResolvedValue({
      subscriptionId: "sub-18",
      traderId: "tr-1",
      strategyId: "st-1",
      state: "STOPPED",
      allocationMode: "FIXED",
      allocationAmount: "100",
      stopReason: "Manual stop keep positions",
      closeOpenPositionsOnStop: false,
    });

    const result = await tradingApi.stopSubscription("sub-18", "Manual stop keep positions", false);
    expect(postSpy).toHaveBeenCalledWith("/v1/copy-trading/subscriptions/sub-18/stop", {
      reason: "Manual stop keep positions",
      closeOpenPositions: false,
    });
    expect(result.closeOpenPositionsOnStop).toBe(false);
  });
});
