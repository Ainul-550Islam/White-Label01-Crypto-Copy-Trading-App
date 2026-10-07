// # NEW — Side-by-side trader comparison matrix for performance, risk, venues, and strategy stats
"use client";

import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { tradingApi } from "@/api/trading-api";
import { PageContainer } from "@/layout/page-container";
import { StatusBadge } from "@/components/status-badge";
import { Money } from "@/components/money";
import { TradingStateBoundary } from "@/components/trading-state";
import { formatWinRatePercent } from "./trader-metric-definitions";

export interface TraderComparisonPageProps {
  initialIds?: string[];
}

export function TraderComparisonPage({ initialIds = [] }: TraderComparisonPageProps): JSX.Element {
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    Array.from(new Set(initialIds.map((x) => x.trim()).filter(Boolean))).slice(0, 4),
  );

  const tradersCatalog = useQuery({
    queryKey: ["traders", "comparison-catalog"],
    queryFn: () => tradingApi.listTraders({ page: 1, limit: 50 }),
  });

  const activeIds = useMemo(() => {
    if (selectedIds.length > 0) return selectedIds.slice(0, 4);
    const catalog = tradersCatalog.data?.data ?? [];
    return catalog.slice(0, 3).map((t) => t.traderId);
  }, [selectedIds, tradersCatalog.data]);

  const comparisonQuery = useQuery({
    queryKey: ["traders-compare", activeIds.join(",")],
    queryFn: () => tradingApi.compareTraders(activeIds),
    enabled: activeIds.length > 0,
  });

  const allTraders = tradersCatalog.data?.data ?? [];
  const entries = comparisonQuery.data ?? [];

  const toggleTrader = (traderId: string) => {
    setSelectedIds((prev) => {
      const base = prev.length > 0 ? prev : activeIds;
      if (base.includes(traderId)) {
        return base.filter((id) => id !== traderId);
      }
      if (base.length >= 4) return base;
      return [...base, traderId];
    });
  };

  return (
    <PageContainer
      title="Compare Traders"
      description="Evaluate up to 4 traders side by side across canonical performance, risk, venues, and published strategies"
    >
      <div className="space-y-6" data-testid="trader-comparison-page">
        {/* Trader Selector */}
        <div className="rounded border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Select Traders to Compare (Max 4)</h2>
              <p className="text-xs text-muted">
                All comparison metrics are sourced from canonical fills and open position ledgers.
              </p>
            </div>
            <Link href="/traders" className="text-xs font-medium underline">
              Back to Trader Discovery
            </Link>
          </div>
          {allTraders.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {allTraders.map((trader) => {
                const isSelected = activeIds.includes(trader.traderId);
                return (
                  <button
                    key={trader.traderId}
                    type="button"
                    data-testid={`compare-toggle-${trader.traderId}`}
                    onClick={() => toggleTrader(trader.traderId)}
                    className={`rounded border px-3 py-1 text-xs font-medium transition ${
                      isSelected
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {trader.displayName} {isSelected ? "✓" : "+"}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <TradingStateBoundary
          isLoading={tradersCatalog.isLoading || comparisonQuery.isLoading}
          error={tradersCatalog.error ?? comparisonQuery.error}
          isEmpty={entries.length === 0}
          emptyTitle="No traders selected for comparison"
          emptyDescription="Select up to 4 public traders above to compare their canonical performance and risk metrics."
          onRetry={() => {
            void tradersCatalog.refetch();
            void comparisonQuery.refetch();
          }}
        >
          <div className="overflow-x-auto rounded border bg-card">
            <table className="w-full text-left text-xs" data-testid="trader-comparison-table">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="p-3 font-semibold text-slate-700">Metric / Attribute</th>
                  {entries.map((entry) => (
                    <th key={entry.profile.traderId} className="p-3 font-semibold text-slate-900">
                      <div className="flex flex-col gap-1">
                        <Link
                          href={`/traders/${entry.profile.traderId}`}
                          className="text-sm font-semibold underline"
                        >
                          {entry.profile.displayName}
                        </Link>
                        <div className="flex items-center gap-1">
                          <StatusBadge status={entry.profile.verificationState} />
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                            {entry.performance.isActual ? "ACTUAL" : "ESTIMATED"}
                          </span>
                        </div>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr>
                  <td className="p-3 font-medium text-muted">Realized PnL</td>
                  {entries.map((entry) => (
                    <td key={entry.profile.traderId} className="p-3 font-mono font-semibold">
                      <Money value={entry.performance.realizedPnl} />
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="p-3 font-medium text-muted">Unrealized PnL</td>
                  {entries.map((entry) => (
                    <td key={entry.profile.traderId} className="p-3 font-mono">
                      <Money value={entry.performance.unrealizedPnl ?? "0"} />
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="p-3 font-medium text-muted">Win Rate</td>
                  {entries.map((entry) => (
                    <td key={entry.profile.traderId} className="p-3 font-mono font-semibold">
                      {formatWinRatePercent(entry.performance.winRate)} ({entry.performance.winCount}W /{" "}
                      {entry.performance.lossCount}L)
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="p-3 font-medium text-muted">Max Drawdown</td>
                  {entries.map((entry) => (
                    <td key={entry.profile.traderId} className="p-3 font-mono">
                      {entry.performance.maxDrawdown ? (
                        <Money value={entry.performance.maxDrawdown} />
                      ) : (
                        "0.00"
                      )}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="p-3 font-medium text-muted">Profit Factor</td>
                  {entries.map((entry) => (
                    <td key={entry.profile.traderId} className="p-3 font-mono">
                      {entry.performance.profitFactor ?? "—"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="p-3 font-medium text-muted">Executed Volume</td>
                  {entries.map((entry) => (
                    <td key={entry.profile.traderId} className="p-3 font-mono">
                      <Money value={entry.performance.totalVolume} />
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="p-3 font-medium text-muted">Total Fills / Track Record</td>
                  {entries.map((entry) => (
                    <td key={entry.profile.traderId} className="p-3">
                      {entry.performance.tradeCount} fills ({entry.performance.historyLengthDays}d)
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="p-3 font-medium text-muted">Followers</td>
                  {entries.map((entry) => (
                    <td key={entry.profile.traderId} className="p-3 font-semibold">
                      {entry.profile.followerCount}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="p-3 font-medium text-muted">Supported Venues</td>
                  {entries.map((entry) => (
                    <td key={entry.profile.traderId} className="p-3">
                      {entry.profile.supportedVenues.join(", ") || "All"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="p-3 font-medium text-muted">Supported Symbols</td>
                  {entries.map((entry) => (
                    <td key={entry.profile.traderId} className="p-3">
                      {entry.profile.supportedSymbols.join(", ") || "All"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="p-3 font-medium text-muted">Published Strategies</td>
                  {entries.map((entry) => (
                    <td key={entry.profile.traderId} className="p-3">
                      {entry.strategies.length === 0 ? (
                        <span className="text-muted">None</span>
                      ) : (
                        <ul className="space-y-1">
                          {entry.strategies.map((s) => (
                            <li key={s.strategyId}>
                              <Link href={`/strategies/${s.strategyId}`} className="underline">
                                {s.name}
                              </Link>{" "}
                              ({s.status})
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="p-3 font-medium text-muted">Deep Dive</td>
                  {entries.map((entry) => (
                    <td key={entry.profile.traderId} className="p-3">
                      <Link
                        href={`/traders/${entry.profile.traderId}/performance`}
                        className="rounded border px-2.5 py-1 text-xs font-medium hover:bg-slate-50"
                      >
                        Performance Detail →
                      </Link>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </TradingStateBoundary>
      </div>
    </PageContainer>
  );
}
