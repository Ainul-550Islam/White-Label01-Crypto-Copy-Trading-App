// # Uses shared TradingState
"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { tradingApi } from "@/api/trading-api";
import { PageContainer } from "@/layout/page-container";
import { StatusBadge } from "@/components/status-badge";
import { TradingStateBoundary } from "@/components/trading-state";

export function StrategiesPage(): JSX.Element {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["strategies", search, typeFilter],
    queryFn: () =>
      tradingApi.listStrategies({
        search: search || undefined,
        status: "PUBLISHED",
        type: typeFilter || undefined,
      }),
  });

  const strategies = data?.data ?? [];

  return (
    <PageContainer
      title="Strategies"
      description="Published copy-trading strategies with canonical copy policy, risk constraints, and symbol/venue coverage"
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          aria-label="Search strategies"
          placeholder="Search by strategy name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded border px-3 py-1.5 text-sm"
        />
        <select
          aria-label="Strategy type"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded border px-3 py-1.5 text-sm"
        >
          <option value="">All types</option>
          <option value="MANUAL">Manual</option>
          <option value="ALGORITHMIC">Algorithmic</option>
          <option value="HYBRID">Hybrid</option>
        </select>
      </div>

      <TradingStateBoundary
        isLoading={isLoading}
        error={error}
        isEmpty={strategies.length === 0}
        emptyTitle="No strategies available"
        emptyDescription="No published strategies matched your filter."
        onRetry={() => void refetch()}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {strategies.map((s) => (
            <Link
              key={s.strategyId}
              href={`/strategies/${s.strategyId}`}
              className="rounded border bg-card p-4 transition hover:bg-slate-50"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold">{s.name}</span>
                <StatusBadge status={s.status} />
              </div>
              {s.description && (
                <p className="mt-1 line-clamp-2 text-xs text-muted">{s.description}</p>
              )}
              <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <dt className="text-muted">Type</dt>
                  <dd className="font-semibold">{s.type}</dd>
                </div>
                <div>
                  <dt className="text-muted">Followers</dt>
                  <dd className="font-semibold">{s.followerCount}</dd>
                </div>
                <div>
                  <dt className="text-muted">Total Copies</dt>
                  <dd className="font-semibold">{s.totalCopies}</dd>
                </div>
              </dl>
              {s.supportedSymbols.length > 0 && (
                <div className="mt-2 text-xs text-muted">
                  Symbols: {s.supportedSymbols.join(", ")}
                </div>
              )}
              {s.supportedVenues.length > 0 && (
                <div className="mt-1 text-xs text-muted">
                  Venues: {s.supportedVenues.join(", ")}
                </div>
              )}
            </Link>
          ))}
        </div>
      </TradingStateBoundary>
    </PageContainer>
  );
}
