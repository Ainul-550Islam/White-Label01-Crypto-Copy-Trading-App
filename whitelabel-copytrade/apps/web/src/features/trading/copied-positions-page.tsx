// # NEW — Displays open and closed copied positions, average entry, mark price, unrealized/realized PnL, and leader attribution
// # Uses shared TradingState
"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { tradingApi } from "@/api/trading-api";
import { PageContainer } from "@/layout/page-container";
import { StatusBadge } from "@/components/status-badge";
import { Money } from "@/components/money";
import { TradingStateBoundary } from "@/components/trading-state";

export function CopiedPositionsPage({
  subscriptionId,
}: {
  subscriptionId: string;
}): JSX.Element {
  const [onlyOpen, setOnlyOpen] = useState<boolean>(true);
  const [symbolFilter, setSymbolFilter] = useState<string>("");

  const positionsQuery = useQuery({
    queryKey: ["copied-positions", subscriptionId, onlyOpen, symbolFilter],
    queryFn: () =>
      tradingApi.listSubscriptionPositions(subscriptionId, {
        onlyOpen,
        symbol: symbolFilter.trim() || undefined,
      }),
  });

  const positions = positionsQuery.data ?? [];

  return (
    <PageContainer
      title={`Copied Positions — Subscription ${subscriptionId}`}
      description="Open and closed copied positions attributed to this subscription with canonical average entry, mark price, and PnL"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded border bg-card p-3 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <input
            aria-label="Filter symbol"
            placeholder="Filter by symbol (e.g. BTC-USDT)"
            value={symbolFilter}
            onChange={(e) => setSymbolFilter(e.target.value)}
            className="rounded border px-2.5 py-1"
          />
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={onlyOpen}
              onChange={(e) => setOnlyOpen(e.target.checked)}
            />
            Open positions only
          </label>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/copy-trading/${subscriptionId}/orders`}
            className="font-medium underline"
          >
            View Copied Orders & Fills
          </Link>
          <Link
            href={`/copy-trading/${subscriptionId}`}
            className="font-medium underline"
          >
            ← Back to Subscription
          </Link>
        </div>
      </div>

      <TradingStateBoundary
        isLoading={positionsQuery.isLoading}
        error={positionsQuery.error}
        isEmpty={positions.length === 0}
        emptyTitle="No copied positions found"
        emptyDescription="No canonical positions match the current subscription and filter criteria."
        onRetry={() => void positionsQuery.refetch()}
      >
        <div className="overflow-x-auto rounded border bg-card" data-testid="copied-positions-page">
          <table className="w-full text-left text-xs" data-testid="copied-positions-table">
            <thead>
              <tr className="border-b bg-slate-50 text-muted">
                <th className="p-3">Symbol</th>
                <th className="p-3">Side</th>
                <th className="p-3">Quantity</th>
                <th className="p-3">Avg Entry</th>
                <th className="p-3">Mark Price</th>
                <th className="p-3">Unrealized PnL</th>
                <th className="p-3">Realized PnL</th>
                <th className="p-3">Leader Attribution</th>
                <th className="p-3">State</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {positions.map((pos) => (
                <tr key={pos.positionId}>
                  <td className="p-3 font-semibold">{pos.symbol}</td>
                  <td className="p-3">
                    <StatusBadge status={pos.side} />
                  </td>
                  <td className="p-3 font-mono">{pos.quantity}</td>
                  <td className="p-3 font-mono">
                    <Money value={pos.averageEntryPrice} />
                  </td>
                  <td className="p-3 font-mono">
                    <Money value={pos.markPrice} />
                  </td>
                  <td className="p-3 font-mono font-semibold">
                    <Money value={pos.unrealizedPnl} />
                  </td>
                  <td className="p-3 font-mono">
                    <Money value={pos.realizedPnl} />
                  </td>
                  <td className="p-3">
                    <Link href={`/traders/${pos.traderId}`} className="underline">
                      {pos.traderId}
                    </Link>{" "}
                    /{" "}
                    <Link href={`/strategies/${pos.strategyId}`} className="underline">
                      {pos.strategyId}
                    </Link>
                  </td>
                  <td className="p-3">
                    <StatusBadge status={pos.isOpen ? "OPEN" : "CLOSED"} />
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
