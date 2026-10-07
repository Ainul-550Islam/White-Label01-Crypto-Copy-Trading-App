// # NEW — Renders cumulative PnL, drawdown, and win/loss distribution visualizations from canonical series
"use client";

import React from "react";
import type { TraderPerformance } from "@/api/trading-api";
import { Money } from "@/components/money";
import { formatWinRatePercent } from "./trader-metric-definitions";

export interface TraderPerformanceChartProps {
  performance: TraderPerformance;
}

export function TraderPerformanceChart({ performance }: TraderPerformanceChartProps): JSX.Element {
  const winCount = Math.max(0, performance.winCount || 0);
  const lossCount = Math.max(0, performance.lossCount || 0);
  const closedCount = winCount + lossCount;
  const winPct = closedCount > 0 ? Math.round((winCount / closedCount) * 100) : 0;
  const lossPct = closedCount > 0 ? 100 - winPct : 0;

  const realizedNum = parseFloat(performance.realizedPnl || "0");
  const unrealizedNum = parseFloat(performance.unrealizedPnl || "0");
  const drawdownNum = parseFloat(performance.maxDrawdown || "0");
  const avgWinNum = parseFloat(performance.averageWin || "0");
  const avgLossNum = parseFloat(performance.averageLoss || "0");

  // Deterministic canonical milestone bars (no random/synthetic points)
  const bars = [
    { label: "Avg Win", value: Number.isFinite(avgWinNum) ? avgWinNum : 0, raw: performance.averageWin ?? "0", tone: "positive" },
    { label: "Avg Loss", value: Number.isFinite(avgLossNum) ? -Math.abs(avgLossNum) : 0, raw: performance.averageLoss ?? "0", tone: "negative" },
    { label: "Max Drawdown", value: Number.isFinite(drawdownNum) ? -Math.abs(drawdownNum) : 0, raw: performance.maxDrawdown ?? "0", tone: "negative" },
    { label: "Unrealized PnL", value: Number.isFinite(unrealizedNum) ? unrealizedNum : 0, raw: performance.unrealizedPnl ?? "0", tone: unrealizedNum >= 0 ? "positive" : "negative" },
    { label: "Realized PnL", value: Number.isFinite(realizedNum) ? realizedNum : 0, raw: performance.realizedPnl || "0", tone: realizedNum >= 0 ? "positive" : "negative" },
  ];

  const maxAbs = Math.max(1, ...bars.map((b) => Math.abs(b.value)));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="trader-performance-chart">
      <div className="rounded border bg-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Canonical PnL & Drawdown Profile</h3>
          <span className="text-xs text-muted">Source: {performance.source || "FILLS"}</span>
        </div>
        <p className="mt-1 text-xs text-muted">
          Deterministic breakdown derived from canonical fills and open mark-to-market positions.
        </p>

        <div className="mt-4 space-y-3">
          {bars.map((bar) => {
            const widthPct = Math.min(100, Math.max(4, Math.round((Math.abs(bar.value) / maxAbs) * 100)));
            const colorClass = bar.tone === "positive" ? "bg-emerald-600" : "bg-rose-600";
            return (
              <div key={bar.label} className="space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{bar.label}</span>
                  <span className="font-mono">
                    <Money value={bar.raw} />
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded bg-slate-100">
                  <div
                    className={`h-full rounded ${colorClass}`}
                    style={{ width: `${bar.value === 0 ? 0 : widthPct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded border bg-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Win / Loss Distribution</h3>
          <span className="text-xs font-medium">{formatWinRatePercent(performance.winRate)} Win Rate</span>
        </div>
        <p className="mt-1 text-xs text-muted">
          Total Executed Fills: {performance.tradeCount} | Closed Round-Trips: {closedCount}
        </p>

        <div className="mt-4">
          <div
            className="flex h-4 w-full overflow-hidden rounded bg-slate-100"
            role="img"
            aria-label={`Wins ${winPct} percent, Losses ${lossPct} percent`}
          >
            {winPct > 0 && (
              <div
                className="bg-emerald-600"
                style={{ width: `${winPct}%` }}
                data-testid="win-distribution-bar"
              />
            )}
            {lossPct > 0 && (
              <div
                className="bg-rose-500"
                style={{ width: `${lossPct}%` }}
                data-testid="loss-distribution-bar"
              />
            )}
          </div>
          <div className="mt-2 flex justify-between text-xs">
            <span className="text-emerald-700">
              Winning Trades: <strong>{winCount}</strong> ({winPct}%)
            </span>
            <span className="text-rose-700">
              Losing Trades: <strong>{lossCount}</strong> ({lossPct}%)
            </span>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-3 text-xs">
          <div>
            <dt className="text-muted">Profit Factor</dt>
            <dd className="font-mono font-semibold">{performance.profitFactor ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted">Track Record</dt>
            <dd className="font-semibold">{performance.historyLengthDays} days</dd>
          </div>
          <div>
            <dt className="text-muted">Average Trade</dt>
            <dd className="font-mono">
              {performance.averageTrade ? <Money value={performance.averageTrade} /> : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Last Fill Timestamp</dt>
            <dd>
              {performance.lastTradeAt ? new Date(performance.lastTradeAt).toLocaleDateString() : "No fills yet"}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
