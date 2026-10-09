// # NEW — Renders canonical trader performance metrics, Actual vs Estimated provenance badge, and strategy/trade breakdown
// # Integrates performance charts and metric definition tooltips
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
import {
  TRADER_METRIC_DEFINITIONS,
  describeDataProvenance,
  formatWinRatePercent,
} from "./trader-metric-definitions";
import { TraderPerformanceChart } from "./trader-performance-chart";

export function TraderPerformancePage({ id }: { id: string }): JSX.Element {
  const [selectedMetricKey, setSelectedMetricKey] = useState<string>("realizedPnl");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["trader-performance-detail", id],
    queryFn: () => tradingApi.getTraderPerformanceDetail(id),
  });

  const profile = data?.profile;
  const performance = data?.performance;
  const strategies = data?.strategies ?? [];
  const provenance = performance ? describeDataProvenance(performance) : null;
  const activeDefinition = TRADER_METRIC_DEFINITIONS[selectedMetricKey] ?? TRADER_METRIC_DEFINITIONS.realizedPnl;

  return (
    <PageContainer
      title={profile ? `${profile.displayName} — Performance Analytics` : "Trader Performance Analytics"}
      description="Canonical ledger performance derived from verified fills, open positions, and strategy attribution"
    >
      <TradingStateBoundary
        isLoading={isLoading}
        error={error}
        isEmpty={!profile || !performance}
        emptyTitle="Trader performance unavailable"
        emptyDescription="This trader profile was not found or has no public performance record."
        onRetry={() => void refetch()}
      >
        {profile && performance && provenance && (
          <div className="space-y-6" data-testid="trader-performance-page">
            {/* Header & Provenance Badge */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded border bg-card p-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">{profile.displayName}</h2>
                  <StatusBadge status={profile.verificationState} />
                  <span
                    data-testid="provenance-badge"
                    className={`rounded px-2 py-0.5 text-xs font-semibold ${
                      performance.isActual
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {provenance.badgeLabel} ({provenance.sourceLabel})
                  </span>
                </div>
                <p className="text-xs text-muted">{provenance.explanation}</p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/traders/${profile.traderId}`}
                  className="rounded border px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
                >
                  Back to Trader Profile
                </Link>
                <Link
                  href={`/traders/compare?ids=${encodeURIComponent(profile.traderId)}`}
                  className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                >
                  Compare Trader
                </Link>
              </div>
            </div>

            {/* Key Metric Cards with Interactive Formula Inspector */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <button
                type="button"
                onClick={() => setSelectedMetricKey("realizedPnl")}
                className={`rounded border bg-card p-3 text-left transition hover:border-slate-400 ${
                  selectedMetricKey === "realizedPnl" ? "ring-2 ring-slate-900" : ""
                }`}
              >
                <div className="text-xs text-muted">Realized PnL</div>
                <div className="mt-1 font-mono text-base font-semibold">
                  <Money value={performance.realizedPnl} />
                </div>
                <div className="mt-1 text-[11px] text-muted">Click for formula</div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedMetricKey("unrealizedPnl")}
                className={`rounded border bg-card p-3 text-left transition hover:border-slate-400 ${
                  selectedMetricKey === "unrealizedPnl" ? "ring-2 ring-slate-900" : ""
                }`}
              >
                <div className="text-xs text-muted">Unrealized PnL</div>
                <div className="mt-1 font-mono text-base font-semibold">
                  <Money value={performance.unrealizedPnl ?? "0"} />
                </div>
                <div className="mt-1 text-[11px] text-muted">Mark-to-market</div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedMetricKey("winRate")}
                className={`rounded border bg-card p-3 text-left transition hover:border-slate-400 ${
                  selectedMetricKey === "winRate" ? "ring-2 ring-slate-900" : ""
                }`}
              >
                <div className="text-xs text-muted">Win Rate</div>
                <div className="mt-1 font-mono text-base font-semibold">
                  {formatWinRatePercent(performance.winRate)}
                </div>
                <div className="mt-1 text-[11px] text-muted">
                  {performance.winCount}W / {performance.lossCount}L ({performance.tradeCount} fills)
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedMetricKey("maxDrawdown")}
                className={`rounded border bg-card p-3 text-left transition hover:border-slate-400 ${
                  selectedMetricKey === "maxDrawdown" ? "ring-2 ring-slate-900" : ""
                }`}
              >
                <div className="text-xs text-muted">Max Drawdown</div>
                <div className="mt-1 font-mono text-base font-semibold">
                  {performance.maxDrawdown ? <Money value={performance.maxDrawdown} /> : "0.00"}
                </div>
                <div className="mt-1 text-[11px] text-muted">Peak-to-trough</div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedMetricKey("profitFactor")}
                className={`rounded border bg-card p-3 text-left transition hover:border-slate-400 ${
                  selectedMetricKey === "profitFactor" ? "ring-2 ring-slate-900" : ""
                }`}
              >
                <div className="text-xs text-muted">Profit Factor</div>
                <div className="mt-1 font-mono text-base font-semibold">
                  {performance.profitFactor ?? "—"}
                </div>
                <div className="mt-1 text-[11px] text-muted">Gross win / loss</div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedMetricKey("averageTrade")}
                className={`rounded border bg-card p-3 text-left transition hover:border-slate-400 ${
                  selectedMetricKey === "averageTrade" ? "ring-2 ring-slate-900" : ""
                }`}
              >
                <div className="text-xs text-muted">Average Trade</div>
                <div className="mt-1 font-mono text-base font-semibold">
                  {performance.averageTrade ? <Money value={performance.averageTrade} /> : "—"}
                </div>
                <div className="mt-1 text-[11px] text-muted">Per closed round-trip</div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedMetricKey("totalVolume")}
                className={`rounded border bg-card p-3 text-left transition hover:border-slate-400 ${
                  selectedMetricKey === "totalVolume" ? "ring-2 ring-slate-900" : ""
                }`}
              >
                <div className="text-xs text-muted">Executed Volume</div>
                <div className="mt-1 font-mono text-base font-semibold">
                  <Money value={performance.totalVolume} />
                </div>
                <div className="mt-1 text-[11px] text-muted">Canonical quote notional</div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedMetricKey("historyLengthDays")}
                className={`rounded border bg-card p-3 text-left transition hover:border-slate-400 ${
                  selectedMetricKey === "historyLengthDays" ? "ring-2 ring-slate-900" : ""
                }`}
              >
                <div className="text-xs text-muted">History Length</div>
                <div className="mt-1 font-mono text-base font-semibold">
                  {performance.historyLengthDays} days
                </div>
                <div className="mt-1 text-[11px] text-muted">Followers: {profile.followerCount}</div>
              </button>
            </div>

            {/* Metric Definition & Methodology Tooltip Panel */}
            {activeDefinition && (
              <div
                className="rounded border border-slate-200 bg-slate-50 p-4 text-xs"
                data-testid="metric-definition-panel"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">
                    Metric Methodology: {activeDefinition.label} ({activeDefinition.unit})
                  </span>
                  <code className="rounded bg-white px-2 py-0.5 font-mono text-[11px] text-slate-800">
                    {activeDefinition.formula}
                  </code>
                </div>
                <p className="mt-1 text-slate-700">{activeDefinition.description}</p>
                <p className="mt-1 text-[11px] text-muted">{activeDefinition.provenanceNote}</p>
              </div>
            )}

            {/* Charts */}
            <TraderPerformanceChart performance={performance} />

            {/* Published Strategies Breakdown */}
            <div className="rounded border bg-card p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Published Strategies & Copy Attribution</h3>
                <span className="text-xs text-muted">{strategies.length} strategies</span>
              </div>
              {strategies.length === 0 ? (
                <p className="mt-2 text-xs text-muted">No strategies published by this trader yet.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b text-muted">
                        <th className="py-2 pr-3">Strategy</th>
                        <th className="py-2 pr-3">Type</th>
                        <th className="py-2 pr-3">Status</th>
                        <th className="py-2 pr-3">Symbols</th>
                        <th className="py-2 pr-3">Venues</th>
                        <th className="py-2 pr-3">Followers</th>
                        <th className="py-2">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {strategies.map((strategy) => (
                        <tr key={strategy.strategyId} className="border-b last:border-0">
                          <td className="py-2 pr-3 font-medium">{strategy.name}</td>
                          <td className="py-2 pr-3">{strategy.type}</td>
                          <td className="py-2 pr-3">
                            <StatusBadge status={strategy.status} />
                          </td>
                          <td className="py-2 pr-3">{strategy.supportedSymbols.join(", ") || "All"}</td>
                          <td className="py-2 pr-3">{strategy.supportedVenues.join(", ") || "All"}</td>
                          <td className="py-2 pr-3">{strategy.followerCount}</td>
                          <td className="py-2">
                            <Link
                              href={`/strategies/${strategy.strategyId}`}
                              className="font-medium underline"
                            >
                              Inspect Strategy
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </TradingStateBoundary>
    </PageContainer>
  );
}
