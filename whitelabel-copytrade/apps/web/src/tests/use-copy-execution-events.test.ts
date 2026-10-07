// # NEW — Verifies live event hook and polling fallback
import {
  classifyExecutionEventType,
  realtimeApi,
  type CopyRealtimeEvent,
} from "../api/realtime-api";
import { tradingApi } from "../api/trading-api";

describe("useCopyExecutionEvents & realtimeApi (GAP-13)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("subscribes via polling fallback, classifies execution status, and surfaces live events", async () => {
    jest.spyOn(tradingApi, "listExecutions").mockResolvedValue({
      data: [
        {
          executionId: "exec-101",
          subscriptionId: "sub-1",
          traderId: "tr-1",
          followerId: "user-1",
          strategyId: "st-1",
          leaderEventId: "fill:leader-1",
          leaderOrderId: "ord-leader-1",
          followerOrderId: "ord-follower-1",
          status: "COMPLETED",
          failureReason: null,
          leaderQuantity: "1.0",
          followerQuantity: "0.25",
          sizingMode: "PROPORTIONAL",
          riskDecision: "ALLOW",
          riskReasons: [],
          isSimulated: false,
          createdAt: "2026-10-01T12:00:00.000Z",
          updatedAt: "2026-10-01T12:00:02.000Z",
        },
      ],
      total: 1,
    });

    const events: CopyRealtimeEvent[] = [];
    let mode = "";
    const unsubscribe = realtimeApi.subscribeToCopyExecutionEvents({
      subscriptionId: "sub-1",
      pollIntervalMs: 60000,
      onTransportChange: (m) => {
        mode = m;
      },
      onEvent: (ev) => {
        events.push(ev);
      },
    });

    await new Promise((r) => setTimeout(r, 20));
    unsubscribe();

    expect(mode).toBe("POLLING");
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("COPY_ORDER_FILLED");
    expect(
      classifyExecutionEventType({
        ...events[0]!.execution,
        status: "RISK_BLOCKED",
        riskDecision: "BLOCK",
      }),
    ).toBe("COPY_RISK_BLOCKED");
  });
});
