// # Responsibility: verifies copy history reads use linked follower accounts and never fall back to unscoped queries.
// # Verifies copied-position reads use the subscription's linked account and canonical execution API schema.
import { apiClient } from "../api/api-client";
import { tradingApi } from "../api/trading-api";

describe("tradingApi.listSubscriptionPositions account scope", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("queries only the linked follower account and maps canonical position fields without invented subscription attribution", async () => {
    const get = jest.spyOn(apiClient, "get");
    get
      .mockResolvedValueOnce({
        subscriptionId: "sub-1",
        traderId: "trader-1",
        strategyId: "strategy-1",
        state: "ACTIVE",
        allocationMode: "FIXED",
        allocationAmount: "100.00",
        followerAccountId: "account-1",
      } as never)
      .mockResolvedValueOnce([
        {
          id: "position-1",
          accountId: "account-1",
          symbol: "BTC-USDT",
          side: "LONG",
          quantity: "0.25",
          averageEntryPrice: "60000.00",
          markPrice: "61000.00",
          unrealisedPnl: "250.00",
          realisedPnl: "12.50",
          cumulativeFee: "0.75",
          feeCurrency: "USDT",
          containsSimulatedFills: false,
          fillCount: 4,
          venue: "BINANCE",
          updatedAt: "2026-10-01T10:00:00.000Z",
        },
        {
          id: "position-flat",
          accountId: "account-1",
          symbol: "ETH-USDT",
          side: "FLAT",
          quantity: "0",
          averageEntryPrice: null,
          markPrice: null,
          unrealisedPnl: null,
          realisedPnl: "5.00",
          cumulativeFee: "0.10",
          feeCurrency: "USDT",
          containsSimulatedFills: true,
          fillCount: 2,
          venue: "BINANCE",
          updatedAt: "2026-10-01T10:01:00.000Z",
        },
      ] as never);

    const positions = await tradingApi.listSubscriptionPositions("sub-1", { onlyOpen: false });

    expect(get).toHaveBeenNthCalledWith(1, "/v1/copy-trading/subscriptions/sub-1");
    expect(get).toHaveBeenNthCalledWith(2, "/v1/execution/positions", {
      searchParams: { accountId: "account-1", symbol: undefined, includeFlat: true },
    });
    expect(positions).toHaveLength(2);
    expect(positions[0]).toMatchObject({
      id: "position-1",
      accountId: "account-1",
      unrealizedPnl: "250.00",
      realizedPnl: "12.50",
      containsSimulatedFills: false,
      isOpen: true,
    });
    expect(positions[1]).toMatchObject({ id: "position-flat", isOpen: false });
    expect(positions[0]).not.toHaveProperty("traderId");
    expect(positions[0]).not.toHaveProperty("strategyId");
  });

  test("uses the subscription-scoped execution route and joins only account-filtered order records", async () => {
    const get = jest.spyOn(apiClient, "get");
    get
      .mockResolvedValueOnce({
        data: [
          {
            id: "exec-1",
            subscriptionId: "sub-1",
            leaderEventId: "event-1",
            leaderOrderId: "leader-order-1",
            leaderFillId: null,
            traderId: "trader-1",
            followerId: "user-1",
            followerAccountId: "account-1",
            status: "FILLED",
            sizingMode: "FIXED",
            leaderQuantity: "1.00",
            leaderPrice: "100.00",
            followerQuantity: "0.25",
            followerPrice: "101.00",
            slippageTolerance: "50",
            maxNotional: "500.00",
            followerOrderId: "order-1",
            riskDecision: "ALLOW",
            riskRuleId: null,
            failureReason: null,
            executionIntent: { symbol: "BTC-USDT" },
            createdAt: "2026-10-01T10:00:00.000Z",
            updatedAt: "2026-10-01T10:00:01.000Z",
          },
        ],
        total: 1,
      } as never)
      .mockResolvedValueOnce({
        items: [
          {
            id: "order-1",
            clientOrderId: "client-1",
            exchangeOrderId: "exchange-1",
            accountId: "account-1",
            strategyId: "strategy-1",
            venue: "BINANCE",
            symbol: "BTC-USDT",
            side: "BUY",
            orderType: "MARKET",
            status: "FILLED",
            quantity: "0.25",
            filledQuantity: "0.25",
            averageFillPrice: "101.00",
            cumulativeFee: "0.10",
            feeCurrency: "USDT",
            isSimulated: false,
            rejectionCode: null,
            rejectionReason: null,
            createdAt: "2026-10-01T10:00:01.000Z",
          },
        ],
      } as never);

    const history = await tradingApi.listSubscriptionOrders("sub-1", {
      status: "FILLED",
      page: 2,
      limit: 5,
    });

    expect(get).toHaveBeenNthCalledWith(1, "/v1/copy-trading/subscriptions/sub-1/executions", {
      searchParams: { status: "FILLED", page: 2, limit: 5 },
    });
    expect(get).toHaveBeenNthCalledWith(2, "/v1/execution/orders", {
      searchParams: { accountId: "account-1", symbol: undefined, limit: 50 },
    });
    expect(history.items[0]).toMatchObject({
      execution: { executionId: "exec-1", status: "FILLED" },
      order: { id: "order-1", type: "MARKET", cumulativeFee: "0.10" },
    });
  });

  test("does not fall back to an unscoped position query without a linked follower account", async () => {
    const get = jest.spyOn(apiClient, "get");
    get.mockResolvedValueOnce({
      subscriptionId: "sub-unlinked",
      traderId: "trader-1",
      strategyId: "strategy-1",
      state: "ACTIVE",
      allocationMode: "FIXED",
      allocationAmount: "100.00",
      followerAccountId: null,
    } as never);

    await expect(tradingApi.listSubscriptionPositions("sub-unlinked")).resolves.toEqual([]);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
