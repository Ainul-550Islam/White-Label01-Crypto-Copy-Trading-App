// # Displays strategy risk constraints, supported symbols/venues, execution statistics, and effective copy policy summary
"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  copyEligibility,
  tradingApi,
  type AllocationMode,
} from "@/api/trading-api";
import { PageContainer } from "@/layout/page-container";
import { StatusBadge } from "@/components/status-badge";
import { Money } from "@/components/money";
import { TradingStateBoundary } from "@/components/trading-state";
import { formatWinRatePercent } from "./trader-metric-definitions";

export function StrategyDetailPage({ id }: { id: string }): JSX.Element {
  const qc = useQueryClient();
  const [allocationMode, setAllocationMode] = useState<AllocationMode>("FIXED");
  const [allocationAmount, setAllocationAmount] = useState("100");
  const [maxAllocation, setMaxAllocation] = useState("");
  const [minAllocation, setMinAllocation] = useState("");
  const [slippageToleranceBps, setSlippageToleranceBps] = useState("50");
  const [takeProfitBps, setTakeProfitBps] = useState("");
  const [stopLossBps, setStopLossBps] = useState("");

  const analyticsQuery = useQuery({
    queryKey: ["strategy-analytics", id],
    queryFn: () => tradingApi.getStrategyAnalytics(id),
  });

  const tradingStatus = useQuery({
    queryKey: ["trading-status"],
    queryFn: () => tradingApi.getTradingStatus(),
  });

  const subscribe = useMutation({
    mutationFn: () => {
      const strategy = analyticsQuery.data?.strategy;
      if (!strategy) throw new Error("Strategy not loaded");
      const slippage = slippageToleranceBps.trim() ? Number(slippageToleranceBps) : undefined;
      const tp = takeProfitBps.trim() ? Number(takeProfitBps) : undefined;
      const sl = stopLossBps.trim() ? Number(stopLossBps) : undefined;
      return tradingApi.createSubscription({
        traderId: strategy.traderId,
        strategyId: strategy.strategyId,
        allocationMode,
        allocationAmount,
        maxAllocation: maxAllocation || undefined,
        minAllocation: minAllocation || undefined,
        copyPolicy: {
          sizingMode: allocationMode,
          slippageToleranceBps: Number.isFinite(slippage) ? slippage : null,
          takeProfitBps: Number.isFinite(tp) ? tp : null,
          stopLossBps: Number.isFinite(sl) ? sl : null,
        },
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["copy-subscriptions"] });
      void qc.invalidateQueries({ queryKey: ["strategy-analytics", id] });
    },
  });

  const data = analyticsQuery.data?.strategy;
  const effectivePolicy = analyticsQuery.data?.effectivePolicy;
  const traderPerformance = analyticsQuery.data?.traderPerformance;
  const gate = data ? copyEligibility(data, tradingStatus.data) : { canCopy: false, reasons: [] };

  return (
    <PageContainer
      title={data ? data.name : "Strategy Detail"}
      description="Strategy analytics, effective copy policy constraints, supported venues/symbols, and follower subscription controls"
    >
      <TradingStateBoundary
        isLoading={analyticsQuery.isLoading}
        error={analyticsQuery.error}
        isEmpty={!data}
        emptyTitle="Strategy not found"
        emptyDescription="This strategy does not exist or is not published."
        degradedReason={
          tradingStatus.data?.maintenance?.active ? tradingStatus.data.maintenance.message : null
        }
        blocksTrading={Boolean(tradingStatus.data?.maintenance?.blocksTrading)}
        onRetry={() => void analyticsQuery.refetch()}
      >
        {data && (
          <div className="space-y-6" data-testid="strategy-detail-page">
            {/* Strategy Overview Card */}
            <div className="space-y-3 rounded border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <StatusBadge status={data.status} />
                  <StatusBadge status={data.type} variant="info" />
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <Link href={`/traders/${data.traderId}`} className="underline">
                    View Lead Trader ({data.traderId})
                  </Link>
                  <Link
                    href={`/traders/${data.traderId}/performance`}
                    className="underline"
                  >
                    Trader Performance Analytics →
                  </Link>
                </div>
              </div>
              {data.description && <p className="text-sm text-muted">{data.description}</p>}
              <dl className="grid grid-cols-2 gap-3 border-t pt-3 text-xs md:grid-cols-4">
                <div>
                  <dt className="text-muted">Followers</dt>
                  <dd className="font-semibold">{data.followerCount}</dd>
                </div>
                <div>
                  <dt className="text-muted">Total Copy Executions</dt>
                  <dd className="font-semibold">{data.totalCopies}</dd>
                </div>
                <div>
                  <dt className="text-muted">Supported Venues</dt>
                  <dd className="font-semibold">{data.supportedVenues.join(", ") || "All"}</dd>
                </div>
                <div>
                  <dt className="text-muted">Supported Symbols</dt>
                  <dd className="font-semibold">{data.supportedSymbols.join(", ") || "All"}</dd>
                </div>
              </dl>
            </div>

            {/* Effective Copy Policy & Risk Constraints (GAP-05) */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div
                className="rounded border bg-card p-4"
                data-testid="strategy-effective-policy"
              >
                <h2 className="text-sm font-semibold">Effective Copy Policy & Guardrails</h2>
                <p className="mt-1 text-xs text-muted">
                  Merged platform, strategy, and default follower copy execution constraints.
                </p>
                {effectivePolicy ? (
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <dt className="text-muted">Default Sizing Mode</dt>
                      <dd className="font-semibold">{effectivePolicy.sizingMode}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Max Position Size</dt>
                      <dd className="font-mono">
                        {effectivePolicy.maxPositionSize ? (
                          <Money value={effectivePolicy.maxPositionSize} />
                        ) : (
                          "Platform Default"
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Max Notional / Order</dt>
                      <dd className="font-mono">
                        {effectivePolicy.maxNotional ? (
                          <Money value={effectivePolicy.maxNotional} />
                        ) : (
                          "Platform Default"
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Max Leverage</dt>
                      <dd className="font-mono">{effectivePolicy.maxLeverage ?? "1"}x</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Slippage Tolerance</dt>
                      <dd className="font-mono">
                        {effectivePolicy.slippageToleranceBps !== null
                          ? `${effectivePolicy.slippageToleranceBps} bps`
                          : "Market Default"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Execution Delay</dt>
                      <dd className="font-mono">{effectivePolicy.executionDelayMs ?? 0} ms</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Allowed Venues</dt>
                      <dd>{effectivePolicy.allowedVenues?.join(", ") || "All Strategy Venues"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Allowed Symbols</dt>
                      <dd>{effectivePolicy.allowedSymbols?.join(", ") || "All Strategy Symbols"}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mt-2 text-xs text-muted">Standard platform policy applies.</p>
                )}
              </div>

              {/* Lead Trader Attribution Summary */}
              <div
                className="rounded border bg-card p-4"
                data-testid="strategy-trader-attribution"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Lead Trader Track Record</h2>
                  {traderPerformance && (
                    <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                      {traderPerformance.isActual ? "ACTUAL" : "ESTIMATED"} (
                      {traderPerformance.source})
                    </span>
                  )}
                </div>
                {traderPerformance ? (
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <dt className="text-muted">Realized PnL</dt>
                      <dd className="font-mono font-semibold">
                        <Money value={traderPerformance.realizedPnl} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Win Rate</dt>
                      <dd className="font-mono font-semibold">
                        {formatWinRatePercent(traderPerformance.winRate)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Max Drawdown</dt>
                      <dd className="font-mono">
                        {traderPerformance.maxDrawdown ? (
                          <Money value={traderPerformance.maxDrawdown} />
                        ) : (
                          "0.00"
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Profit Factor</dt>
                      <dd className="font-mono">{traderPerformance.profitFactor ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Total Fills</dt>
                      <dd className="font-semibold">{traderPerformance.tradeCount}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">History Length</dt>
                      <dd className="font-semibold">{traderPerformance.historyLengthDays} days</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mt-2 text-xs text-muted">
                    No executed fill history recorded for this trader yet.
                  </p>
                )}
              </div>
            </div>

            {/* Subscribe Form */}
            <div className="space-y-3 rounded border bg-card p-4">
              <h2 className="text-sm font-semibold">Follow & Copy This Strategy</h2>

              {!gate.canCopy && gate.reasons.length > 0 && (
                <div
                  role="status"
                  className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
                >
                  <div className="font-semibold">Copying is not available right now</div>
                  <ul className="mt-1 list-disc pl-4">
                    {gate.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-4">
                <label className="space-y-1">
                  <span className="text-muted">Allocation mode</span>
                  <select
                    value={allocationMode}
                    onChange={(e) => setAllocationMode(e.target.value as AllocationMode)}
                    disabled={!gate.canCopy}
                    className="w-full rounded border px-2 py-1.5"
                  >
                    <option value="FIXED">Fixed amount per trade</option>
                    <option value="PROPORTIONAL">Proportional</option>
                    <option value="MULTIPLIER">Multiplier</option>
                    <option value="EQUITY_RATIO">Equity Ratio</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-muted">Allocation amount</span>
                  <input
                    value={allocationAmount}
                    onChange={(e) => setAllocationAmount(e.target.value)}
                    disabled={!gate.canCopy}
                    inputMode="decimal"
                    className="w-full rounded border px-2 py-1.5"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-muted">Min per trade (optional)</span>
                  <input
                    value={minAllocation}
                    onChange={(e) => setMinAllocation(e.target.value)}
                    disabled={!gate.canCopy}
                    inputMode="decimal"
                    className="w-full rounded border px-2 py-1.5"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-muted">Max per trade (optional)</span>
                  <input
                    value={maxAllocation}
                    onChange={(e) => setMaxAllocation(e.target.value)}
                    disabled={!gate.canCopy}
                    inputMode="decimal"
                    className="w-full rounded border px-2 py-1.5"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-3">
                <label className="space-y-1">
                  <span className="text-muted">Slippage Tolerance (bps)</span>
                  <input
                    value={slippageToleranceBps}
                    onChange={(e) => setSlippageToleranceBps(e.target.value)}
                    disabled={!gate.canCopy}
                    inputMode="numeric"
                    className="w-full rounded border px-2 py-1.5"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-muted">Take-Profit (bps, optional)</span>
                  <input
                    value={takeProfitBps}
                    onChange={(e) => setTakeProfitBps(e.target.value)}
                    disabled={!gate.canCopy}
                    inputMode="numeric"
                    placeholder="e.g. 300"
                    className="w-full rounded border px-2 py-1.5"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-muted">Stop-Loss (bps, optional)</span>
                  <input
                    value={stopLossBps}
                    onChange={(e) => setStopLossBps(e.target.value)}
                    disabled={!gate.canCopy}
                    inputMode="numeric"
                    placeholder="e.g. 150"
                    className="w-full rounded border px-2 py-1.5"
                  />
                </label>
              </div>

              {subscribe.isError && (
                <div role="alert" className="text-xs text-red-700">
                  {(subscribe.error as Error).message}
                </div>
              )}
              {subscribe.isSuccess && (
                <div role="status" className="text-xs text-green-700">
                  Subscription created — manage it in{" "}
                  <Link href="/copy-trading" className="underline">
                    Copy Trading
                  </Link>
                  .
                </div>
              )}

              <button
                type="button"
                disabled={!gate.canCopy || subscribe.isPending || !allocationAmount.trim()}
                onClick={() => subscribe.mutate()}
                className="rounded bg-slate-900 px-3 py-1.5 text-xs text-white disabled:opacity-40"
              >
                {subscribe.isPending ? "Starting…" : "Start copying"}
              </button>
            </div>
          </div>
        )}
      </TradingStateBoundary>
    </PageContainer>
  );
}
