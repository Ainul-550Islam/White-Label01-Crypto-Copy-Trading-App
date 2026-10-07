// # Adds search, verification state, featured, venue, symbol, min win-rate, max drawdown, and sort controls
// # Uses shared TradingState
"use client";

import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  filterTradersByDiscovery,
  tradingApi,
  type TraderPerformance,
  type TraderProfile,
  type TraderVerificationState,
} from "@/api/trading-api";
import { PageContainer } from "@/layout/page-container";
import { StatusBadge } from "@/components/status-badge";
import { Money } from "@/components/money";
import { TradingStateBoundary } from "@/components/trading-state";

export interface TradersPageInitialFilters {
  search?: string;
  verificationState?: string;
  isFeatured?: boolean;
  venue?: string;
  symbol?: string;
  minWinRate?: number;
  maxDrawdown?: number;
  sortBy?: "followers" | "volume" | "pnl" | "winRate";
}

export function TradersPage({
  initialFilters,
}: {
  initialFilters?: TradersPageInitialFilters;
} = {}): JSX.Element {
  const [search, setSearch] = useState(initialFilters?.search ?? "");
  const [verificationState, setVerificationState] = useState<string>(
    initialFilters?.verificationState ?? "",
  );
  const [onlyFeatured, setOnlyFeatured] = useState<boolean>(initialFilters?.isFeatured ?? false);
  const [venue, setVenue] = useState<string>(initialFilters?.venue ?? "");
  const [symbol, setSymbol] = useState<string>(initialFilters?.symbol ?? "");
  const [minWinRate, setMinWinRate] = useState<string>(
    initialFilters?.minWinRate !== undefined ? String(initialFilters.minWinRate) : "",
  );
  const [maxDrawdown, setMaxDrawdown] = useState<string>(
    initialFilters?.maxDrawdown !== undefined ? String(initialFilters.maxDrawdown) : "",
  );
  const [sortBy, setSortBy] = useState<"followers" | "volume" | "pnl" | "winRate">(
    initialFilters?.sortBy ?? "followers",
  );
  const [compareIds, setCompareIds] = useState<string[]>([]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["traders", search, verificationState, onlyFeatured],
    queryFn: () =>
      tradingApi.listTraders({
        search: search || undefined,
        verificationState: (verificationState || undefined) as TraderVerificationState | undefined,
        isFeatured: onlyFeatured ? true : undefined,
      }),
  });

  const rankingsQuery = useQuery({
    queryKey: ["trader-rankings-discovery", search, verificationState, onlyFeatured],
    queryFn: () =>
      tradingApi.getLeaderboard({
        search: search || undefined,
        verificationState: verificationState || undefined,
        isFeatured: onlyFeatured ? true : undefined,
        limit: 50,
      }),
  });

  const performanceByTraderId = useMemo(() => {
    const map: Record<string, TraderPerformance> = {};
    for (const r of rankingsQuery.data?.data ?? []) {
      map[r.traderId] = r.performance;
    }
    return map;
  }, [rankingsQuery.data]);

  const rawTraders: TraderProfile[] = useMemo(() => data?.data ?? [], [data]);

  const filteredTraders = useMemo(() => {
    const parsedMinWinRate = minWinRate.trim() !== "" ? Number(minWinRate) : undefined;
    const parsedMaxDrawdown = maxDrawdown.trim() !== "" ? Number(maxDrawdown) : undefined;
    return filterTradersByDiscovery(
      rawTraders,
      {
        search: search || undefined,
        verificationState: (verificationState || undefined) as TraderVerificationState | undefined,
        isFeatured: onlyFeatured ? true : undefined,
        venue: venue || undefined,
        symbol: symbol || undefined,
        minWinRate: Number.isFinite(parsedMinWinRate) ? parsedMinWinRate : undefined,
        maxDrawdown: Number.isFinite(parsedMaxDrawdown) ? parsedMaxDrawdown : undefined,
        sortBy,
      },
      performanceByTraderId,
    );
  }, [
    rawTraders,
    search,
    verificationState,
    onlyFeatured,
    venue,
    symbol,
    minWinRate,
    maxDrawdown,
    sortBy,
    performanceByTraderId,
  ]);

  const toggleCompare = (traderId: string) => {
    setCompareIds((prev) =>
      prev.includes(traderId)
        ? prev.filter((id) => id !== traderId)
        : prev.length < 4
          ? [...prev, traderId]
          : prev,
    );
  };

  return (
    <PageContainer
      title="Traders"
      description="Verified lead traders you can follow, filter by venue/symbol/risk, and compare side by side"
    >
      <div className="mb-4 space-y-3 rounded border bg-card p-4" data-testid="trader-discovery-filters">
        <div className="flex flex-wrap items-center gap-3">
          <input
            aria-label="Search traders"
            placeholder="Search by display name or bio..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded border px-3 py-1.5 text-sm"
          />
          <select
            aria-label="Verification filter"
            value={verificationState}
            onChange={(e) => setVerificationState(e.target.value)}
            className="rounded border px-3 py-1.5 text-sm"
          >
            <option value="">All verification states</option>
            <option value="VERIFIED">Verified only</option>
            <option value="UNVERIFIED">Unverified</option>
          </select>
          <select
            aria-label="Venue filter"
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            className="rounded border px-3 py-1.5 text-sm"
          >
            <option value="">All Venues</option>
            <option value="BINANCE">BINANCE</option>
            <option value="BYBIT">BYBIT</option>
            <option value="OKX">OKX</option>
            <option value="KRAKEN">KRAKEN</option>
            <option value="COINBASE">COINBASE</option>
          </select>
          <input
            aria-label="Symbol filter"
            placeholder="Symbol (e.g. BTC-USDT)"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="w-44 rounded border px-3 py-1.5 text-sm"
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={onlyFeatured}
              onChange={(e) => setOnlyFeatured(e.target.checked)}
            />
            Featured only
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <div className="flex flex-wrap items-center gap-3">
            <input
              aria-label="Minimum win rate"
              type="number"
              min="0"
              max="100"
              placeholder="Min Win Rate %"
              value={minWinRate}
              onChange={(e) => setMinWinRate(e.target.value)}
              className="w-36 rounded border px-3 py-1.5 text-xs"
            />
            <input
              aria-label="Maximum drawdown"
              type="number"
              min="0"
              placeholder="Max Drawdown"
              value={maxDrawdown}
              onChange={(e) => setMaxDrawdown(e.target.value)}
              className="w-36 rounded border px-3 py-1.5 text-xs"
            />
            <select
              aria-label="Sort traders"
              value={sortBy}
              onChange={(e) =>
                setSortBy(e.target.value as "followers" | "volume" | "pnl" | "winRate")
              }
              className="rounded border px-3 py-1.5 text-xs"
            >
              <option value="followers">Sort by Followers</option>
              <option value="volume">Sort by Executed Volume</option>
              <option value="pnl">Sort by Realized PnL</option>
              <option value="winRate">Sort by Win Rate</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={
                compareIds.length > 0
                  ? `/traders/compare?ids=${encodeURIComponent(compareIds.join(","))}`
                  : "/traders/compare"
              }
              className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
            >
              Compare Traders {compareIds.length > 0 ? `(${compareIds.length})` : ""}
            </Link>
          </div>
        </div>
      </div>

      <TradingStateBoundary
        isLoading={isLoading}
        error={error}
        isEmpty={filteredTraders.length === 0}
        emptyTitle="No traders found"
        emptyDescription="No public trader profiles matched the current discovery filters."
        onRetry={() => void refetch()}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredTraders.map((trader) => {
            const perf = performanceByTraderId[trader.traderId];
            const isSelectedForCompare = compareIds.includes(trader.traderId);
            return (
              <div
                key={trader.traderId}
                data-testid={`trader-card-${trader.traderId}`}
                className="flex flex-col justify-between rounded border bg-card p-4"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/traders/${trader.traderId}`}
                      className="font-semibold hover:underline"
                    >
                      {trader.displayName}
                    </Link>
                    <div className="flex gap-1">
                      {trader.isFeatured && <StatusBadge status="FEATURED" variant="info" />}
                      <StatusBadge status={trader.verificationState} />
                    </div>
                  </div>
                  {trader.bio && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted">{trader.bio}</p>
                  )}
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <dt className="text-muted">Followers</dt>
                      <dd className="font-semibold">{trader.followerCount}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Trades</dt>
                      <dd className="font-semibold">{trader.totalTrades}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Volume</dt>
                      <dd className="font-semibold">
                        <Money value={trader.totalVolume} />
                      </dd>
                    </div>
                  </dl>
                  {perf && (
                    <dl className="mt-2 grid grid-cols-2 gap-2 border-t pt-2 text-xs">
                      <div>
                        <dt className="text-muted">Realized PnL</dt>
                        <dd className="font-mono font-semibold">
                          <Money value={perf.realizedPnl} />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted">Win Rate</dt>
                        <dd className="font-mono font-semibold">
                          {perf.winRate
                            ? `${(Number(perf.winRate) <= 1 ? Number(perf.winRate) * 100 : Number(perf.winRate)).toFixed(1)}%`
                            : "—"}
                        </dd>
                      </div>
                    </dl>
                  )}
                  {trader.supportedVenues.length > 0 && (
                    <div className="mt-2 text-[11px] text-muted">
                      Venues: {trader.supportedVenues.join(", ")}
                    </div>
                  )}
                  {trader.supportedSymbols.length > 0 && (
                    <div className="mt-0.5 text-[11px] text-muted">
                      Symbols: {trader.supportedSymbols.join(", ")}
                    </div>
                  )}
                </div>

                <div className="mt-4 flex items-center justify-between gap-2 border-t pt-3 text-xs">
                  <div className="flex gap-2">
                    <Link href={`/traders/${trader.traderId}`} className="underline">
                      Profile
                    </Link>
                    <Link
                      href={`/traders/${trader.traderId}/performance`}
                      className="underline"
                    >
                      Performance
                    </Link>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleCompare(trader.traderId)}
                    className={`rounded border px-2 py-0.5 text-[11px] font-medium ${
                      isSelectedForCompare
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {isSelectedForCompare ? "Comparing ✓" : "+ Compare"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </TradingStateBoundary>
    </PageContainer>
  );
}
