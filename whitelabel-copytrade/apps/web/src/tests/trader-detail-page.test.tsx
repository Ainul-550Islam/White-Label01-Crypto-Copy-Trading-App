// # Responsibility: protects the customer trader page from presenting stale counters or unavailable AUM as verified trading activity.
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { parseTrader, type TraderProfilePublicMetrics } from "../api/trading-api";
import { TraderDetailPage } from "../features/trading/trader-detail-page";

const availableMetrics: TraderProfilePublicMetrics = {
  activeFollowers: {
    status: "AVAILABLE",
    value: 2,
    source: "ACTIVE_COPY_SUBSCRIPTIONS",
    asOf: "2026-10-05T09:00:00.000Z",
    reason: null,
  },
  aum: {
    status: "UNAVAILABLE",
    value: null,
    currency: null,
    source: null,
    asOf: null,
    reason: "NO_AUTHORITATIVE_FOLLOWER_PORTFOLIO_VALUATION",
  },
  activity: {
    status: "AVAILABLE",
    source: "NON_SIMULATED_CANONICAL_FILL_RECORDS",
    asOf: "2026-10-05T09:00:00.000Z",
    latestRecordedFillAt: "2026-10-05T08:00:00.000Z",
    sampledFillCount: 2,
    sampleLimit: 500,
    hasMore: false,
    volumeByQuoteAsset: [
      { asset: "BTC", amount: "0.000000000001" },
      { asset: "USDT", amount: "125.250000000001" },
    ],
    calculationMethod: "MIXED",
    reason: null,
  },
  riskScore: {
    status: "PARTIAL",
    score: 5,
    band: "LOW",
    confidence: "PARTIAL",
    factors: [
      { key: "maxDrawdownPercent", value: "5", score: 5, weightBps: 3500, status: "MEASURED", source: "RECONCILED_CLOSED_PERIOD_RECORDS" },
      { key: "leverage", value: null, score: null, weightBps: 2500, status: "MISSING", source: null },
      { key: "concentrationPercent", value: null, score: null, weightBps: 2500, status: "MISSING", source: null },
      { key: "lossStreak", value: null, score: null, weightBps: 1500, status: "MISSING", source: null },
    ],
    methodology: "risk-score-v1",
    asOf: "2026-10-05T09:00:00.000Z",
  },
};

function renderTrader(publicMetrics: TraderProfilePublicMetrics | null, viewerIsOwner = false): string {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const profile = parseTrader({
    traderId: "trader-1",
    displayName: "Verified Trader",
    bio: "Canonical profile",
    verificationState: "VERIFIED",
    supportedVenues: ["BINANCE"],
    supportedSymbols: ["BTC-USDT"],
    isPublic: true,
    isFeatured: false,
    viewerIsOwner,
    followerCount: 999,
    totalVolume: "999999999.99",
    totalTrades: 9999,
    createdAt: "2026-10-01T00:00:00.000Z",
    publicMetrics,
  });
  queryClient.setQueryData(["trader", "trader-1"], profile);
  queryClient.setQueryData(["trader", "trader-1", "strategies"], { data: [], total: 0 });

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <TraderDetailPage id="trader-1" />
    </QueryClientProvider>,
  );
}

describe("TraderDetailPage public metric provenance (GAP-51)", () => {
  test("renders active follower provenance, fresh canonical activity, asset-separated exact volume, and unavailable AUM", () => {
    const html = renderTrader(availableMetrics);

    expect(html).toContain("Active followers");
    expect(html).toContain("Stored profile follower totals are not displayed because they do not establish the number of active subscriptions.");
    expect(html).toContain("2");
    expect(html).toContain("ACTIVE_COPY_SUBSCRIPTIONS");
    expect(html).toContain("2026-10-05T09:00:00.000Z");
    expect(html).toContain("Assets under management (AUM)");
    expect(html).toContain("Unavailable");
    expect(html).toContain("no account equity or estimate is substituted");
    expect(html).toContain("Recent trading activity");
    expect(html).toContain("NON_SIMULATED_CANONICAL_FILL_RECORDS");
    expect(html).toContain("125.250000000001 USDT");
    expect(html).toContain("0.000000000001 BTC");
    expect(html).not.toContain("999999999.99");
    expect(html).toContain("Trader risk score");
    expect(html).toContain("5/100 · LOW");
    expect(html).toContain("Partial score uses measured factors only");
    expect(html).toContain("No verified source");
  });

  test("does not fall back to stale follower, volume, or trade counters when metric provenance is unavailable", () => {
    const unavailableMetrics: TraderProfilePublicMetrics = {
      activeFollowers: {
        status: "UNAVAILABLE",
        value: null,
        source: null,
        asOf: null,
        reason: "SOURCE_READ_FAILED",
      },
      aum: {
        status: "UNAVAILABLE",
        value: null,
        currency: null,
        source: null,
        asOf: null,
        reason: "NO_AUTHORITATIVE_FOLLOWER_PORTFOLIO_VALUATION",
      },
      activity: {
        status: "UNAVAILABLE",
        source: null,
        asOf: null,
        latestRecordedFillAt: null,
        sampledFillCount: null,
        sampleLimit: 500,
        hasMore: null,
        volumeByQuoteAsset: [],
        calculationMethod: null,
        reason: "SOURCE_READ_FAILED",
      },
      riskScore: {
        status: "UNAVAILABLE",
        score: null,
        band: "UNAVAILABLE",
        confidence: "UNAVAILABLE",
        factors: [
          { key: "maxDrawdownPercent", value: null, score: null, weightBps: 3500, status: "MISSING", source: null },
          { key: "leverage", value: null, score: null, weightBps: 2500, status: "MISSING", source: null },
          { key: "concentrationPercent", value: null, score: null, weightBps: 2500, status: "MISSING", source: null },
          { key: "lossStreak", value: null, score: null, weightBps: 1500, status: "MISSING", source: null },
        ],
        methodology: "risk-score-v1",
        asOf: "2026-10-05T09:00:00.000Z",
      },
    };
    const html = renderTrader(unavailableMetrics);

    expect(html).toContain("Active subscription records could not be verified");
    expect(html).toContain("Canonical fill provenance could not be verified");
    expect(html).toContain("AUM");
    expect(html).toContain("Unavailable");
    expect(html).not.toContain("999");
    expect(html).not.toContain("$0.00");
    expect(html).toContain("Trader risk score");
    expect(html).toContain("Status: UNAVAILABLE; confidence: UNAVAILABLE");
  });

  test("requests the private trader exposure panel only when the API identifies the profile owner", () => {
    const ownerHtml = renderTrader(availableMetrics, true);
    const otherViewerHtml = renderTrader(availableMetrics, false);

    expect(ownerHtml).toContain("Loading your trader-profile exposure");
    expect(otherViewerHtml).not.toContain("Loading your trader-profile exposure");
    expect(otherViewerHtml).not.toContain("Your trader-profile exposure");
  });
});
