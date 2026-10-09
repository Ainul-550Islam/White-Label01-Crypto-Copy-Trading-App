// # Uses shared TradingState
"use client";
import type { JSX } from 'react';

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { tradingApi } from "@/api/trading-api";
import { PageContainer } from "@/layout/page-container";
import { StatusBadge } from "@/components/status-badge";
import { Money } from "@/components/money";
import { TradingStateBoundary } from "@/components/trading-state";
import { formatWinRatePercent } from "./trader-metric-definitions";

export function LeaderboardPage(): JSX.Element {
  const [sortBy, setSortBy] = useState<string>("followers");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["leaderboard", sortBy],
    queryFn: () => tradingApi.getLeaderboard({ sortBy, limit: 25 }),
  });

  const rows = data?.data ?? [];

  return (
    <PageContainer
      title="Trader Leaderboard"
      description="Ranked traders evaluated by canonical realized PnL, executed volume, win rate, and follower trust"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs">
          <label htmlFor="leaderboard-sort" className="font-medium text-muted">
            Rank By:
          </label>
          <select
            id="leaderboard-sort"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="rounded border px-3 py-1.5 text-xs"
          >
            <option value="followers">Followers</option>
            <option value="pnl">Realized PnL</option>
            <option value="volume">Executed Volume</option>
            <option value="winRate">Win Rate</option>
          </select>
        </div>
        <Link href="/traders/compare" className="text-xs font-medium underline">
          Compare Top Traders →
        </Link>
      </div>

      <TradingStateBoundary
        isLoading={isLoading}
        error={error}
        isEmpty={rows.length === 0}
        emptyTitle="Leaderboard is empty"
        emptyDescription="No ranked traders are currently available for this tenant."
        onRetry={() => void refetch()}
      >
        <div className="overflow-x-auto rounded border bg-card">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b bg-slate-50 text-muted">
                <th className="p-3">Rank</th>
                <th className="p-3">Trader</th>
                <th className="p-3">Verification</th>
                <th className="p-3">Realized PnL</th>
                <th className="p-3">Win Rate</th>
                <th className="p-3">Volume</th>
                <th className="p-3">Followers</th>
                <th className="p-3">Provenance</th>
                <th className="p-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.traderId}>
                  <td className="p-3 font-mono font-semibold">#{row.rank}</td>
                  <td className="p-3 font-medium">
                    <Link href={`/traders/${row.traderId}`} className="underline">
                      {row.displayName}
                    </Link>
                  </td>
                  <td className="p-3">
                    <StatusBadge status={row.verificationState} />
                  </td>
                  <td className="p-3 font-mono font-semibold">
                    <Money value={row.performance.realizedPnl} />
                  </td>
                  <td className="p-3 font-mono">
                    {formatWinRatePercent(row.performance.winRate)}
                  </td>
                  <td className="p-3 font-mono">
                    <Money value={row.totalVolume} />
                  </td>
                  <td className="p-3">{row.followerCount}</td>
                  <td className="p-3">
                    <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                      {row.performance.isActual ? "ACTUAL" : "ESTIMATED"}
                    </span>
                  </td>
                  <td className="p-3">
                    <Link
                      href={`/traders/${row.traderId}/performance`}
                      className="underline"
                    >
                      Analytics
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TradingStateBoundary>
    </PageContainer>
  );
}
