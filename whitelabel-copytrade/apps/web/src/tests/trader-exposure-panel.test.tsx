// # Responsibility: proves trader-profile exposure is owner-scoped and renders sourced exact values without inventing stale or missing valuations.

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { TraderExposureView } from "../api/customer-exposure-api";
import { TraderExposurePanel } from "../features/trading/trader-exposure-panel";

const TRADER_ID = "trader-owner-profile-1";

const currentExposure: TraderExposureView = {
  tenantId: "tenant-1",
  traderId: TRADER_ID,
  asOf: "2026-10-06T12:00:00.000Z",
  state: "CURRENT",
  eligibleAccountCount: 1,
  lines: [
    {
      symbol: "BTC-USDT",
      venue: "BINANCE",
      marketType: "SPOT",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      longQuantity: "0.5",
      shortQuantity: "0",
      netQuantity: "0.5",
      longPositionNotional: "30000.125",
      shortPositionNotional: "0",
      grossPositionNotional: "30000.125",
      netPositionNotional: "30000.125",
      openOrderCommitment: "0",
      totalNotional: "30000.125",
      openOrderCount: 0,
      openOrderCommitmentBasis: null,
      price: "60000.25",
      priceSource: "MARKET_DATA_1M_CANDLE_CLOSE",
      priceTimestamp: "2026-10-06T11:59:00.000Z",
      positionState: "CURRENT",
      openOrderState: "NO_OPEN_ORDERS",
      state: "CURRENT",
    },
  ],
  totalsByQuoteAsset: [
    {
      quoteAsset: "USDT",
      longPositionNotional: "30000.125",
      shortPositionNotional: "0",
      grossPositionNotional: "30000.125",
      openOrderCommitment: "0",
      totalNotional: "30000.125",
      state: "CURRENT",
    },
  ],
  staleSymbols: [],
  unknownSymbols: [],
  dataScope: "TRADER_PROFILE_OWNER_NON_SANDBOX_NON_SIMULATED_ACCOUNTS",
  simulatedRecordsIncluded: false,
  cashBalancesIncluded: false,
  currencyTreatment: "SEPARATE_QUOTE_ASSETS_NO_FX_CONVERSION",
  priceMethodology: "LATEST_1M_CANDLE_CLOSE_WITH_POLICY_FRESHNESS",
  notice: "Reference prices come from current tenant-instrument-linked one-minute candles; not exchange mark prices.",
};

function renderPanel(exposure: TraderExposureView): string {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["trader", TRADER_ID, "exposure"], exposure);

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <TraderExposurePanel traderId={TRADER_ID} />
    </QueryClientProvider>,
  );
}

describe("TraderExposurePanel (GAP-58)", () => {
  test("renders only the owner-scoped exposure response and exact, source-backed values", () => {
    const html = renderPanel(currentExposure);

    expect(html).toContain("Your trader-profile exposure");
    expect(html).toContain("Private to this trader-profile owner");
    expect(html).toContain("BTC-USDT");
    expect(html).toContain("0.5");
    expect(html).toContain("30000.125 USDT");
    expect(html).toContain("60000.25");
    expect(html).toContain("Different quote assets are never added together");
    expect(html).not.toContain("apiSecret");
    expect(html).not.toContain("accountId");
  });

  test("keeps stale or unavailable valuations explicit instead of formatting them as zero", () => {
    const unknownExposure: TraderExposureView = {
      ...currentExposure,
      state: "UNKNOWN",
      lines: [
        {
          ...currentExposure.lines[0]!,
          longPositionNotional: null,
          shortPositionNotional: null,
          grossPositionNotional: null,
          netPositionNotional: null,
          totalNotional: null,
          price: null,
          priceSource: null,
          priceTimestamp: null,
          positionState: "UNKNOWN",
          state: "UNKNOWN",
        },
      ],
      totalsByQuoteAsset: [
        {
          ...currentExposure.totalsByQuoteAsset[0]!,
          longPositionNotional: null,
          shortPositionNotional: null,
          grossPositionNotional: null,
          totalNotional: null,
          state: "UNKNOWN",
        },
      ],
      staleSymbols: [],
      unknownSymbols: ["BINANCE:BTC-USDT"],
    };
    const html = renderPanel(unknownExposure);

    expect(html).toContain("Valuation unavailable");
    expect(html).toContain("Unavailable");
    expect(html).toContain("Missing or invalid valuation evidence: BINANCE:BTC-USDT");
    expect(html).not.toContain("0.00 USDT");
    expect(html).not.toContain("30,000");
  });

  test("withholds rows when the API response does not prove the requested trader and private owner scope", () => {
    const untrusted = {
      ...currentExposure,
      traderId: "another-trader",
      dataScope: "SIGNED_IN_USER_NON_SANDBOX_NON_SIMULATED_ACCOUNTS",
    } as unknown as TraderExposureView;
    const html = renderPanel(untrusted);

    expect(html).toContain("The response did not confirm the requested trader-profile owner scope");
    expect(html).not.toContain("30000.125");
    expect(html).not.toContain("BTC-USDT");
  });
});
