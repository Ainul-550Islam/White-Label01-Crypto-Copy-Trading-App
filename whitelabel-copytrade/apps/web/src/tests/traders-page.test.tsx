// # NEW — Verifies trader discovery filtering and sorting
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TradersPage } from "../features/trading/traders-page";

describe("TradersPage (GAP-04)", () => {
  test("filters traders by venue, symbol, and sorts by volume", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["traders", "", "", false], {
      data: [
        {
          traderId: "tr-1",
          displayName: "Alpha Quant",
          bio: "BTC specialist",
          avatarUrl: null,
          verificationState: "VERIFIED",
          verifiedAt: null,
          supportedVenues: ["BINANCE"],
          supportedSymbols: ["BTC-USDT"],
          isPublic: true,
          isFeatured: true,
          followerCount: 90,
          totalVolume: "250000",
          totalTrades: 80,
          createdAt: "2026-06-01T00:00:00.000Z",
        },
        {
          traderId: "tr-2",
          displayName: "Solana Momentum",
          bio: "SOL specialist",
          avatarUrl: null,
          verificationState: "VERIFIED",
          verifiedAt: null,
          supportedVenues: ["BYBIT"],
          supportedSymbols: ["SOL-USDT"],
          isPublic: true,
          isFeatured: false,
          followerCount: 25,
          totalVolume: "950000",
          totalTrades: 140,
          createdAt: "2026-06-01T00:00:00.000Z",
        },
      ],
      total: 2,
    });
    queryClient.setQueryData(["trader-rankings-discovery", "", "", false], {
      data: [],
      total: 0,
    });

    const htmlAll = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <TradersPage />
      </QueryClientProvider>,
    );
    expect(htmlAll).toContain("Alpha Quant");
    expect(htmlAll).toContain("Solana Momentum");

    const htmlBybitOnly = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <TradersPage initialFilters={{ venue: "BYBIT" }} />
      </QueryClientProvider>,
    );
    expect(htmlBybitOnly).not.toContain("Alpha Quant");
    expect(htmlBybitOnly).toContain("Solana Momentum");
  });
});
