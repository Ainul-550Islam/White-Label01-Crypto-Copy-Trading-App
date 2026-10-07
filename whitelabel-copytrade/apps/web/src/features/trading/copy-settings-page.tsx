// # NEW — Form for sizing mode, allocation limits, symbol/venue allowlists, order type policy, slippage, execution delay, TP/SL, and follower risk policy
// # Adds TP/SL/trailing stop configuration inputs and effective policy preview
"use client";

import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { tradingApi, type AllocationMode } from "@/api/trading-api";
import { PageContainer } from "@/layout/page-container";
import { StatusBadge } from "@/components/status-badge";
import { Money } from "@/components/money";
import { TradingStateBoundary } from "@/components/trading-state";

export function CopySettingsPage({ subscriptionId }: { subscriptionId: string }): JSX.Element {
  const qc = useQueryClient();

  const detailQuery = useQuery({
    queryKey: ["copy-subscription-detail", subscriptionId],
    queryFn: () => tradingApi.getSubscriptionDetail(subscriptionId),
  });

  const sub = detailQuery.data?.subscription;
  const effectivePolicy = detailQuery.data?.effectivePolicy;

  const [allocationMode, setAllocationMode] = useState<AllocationMode>("FIXED");
  const [allocationAmount, setAllocationAmount] = useState("100");
  const [minAllocation, setMinAllocation] = useState("");
  const [maxAllocation, setMaxAllocation] = useState("");
  const [maxPositionSize, setMaxPositionSize] = useState("");
  const [maxNotional, setMaxNotional] = useState("");
  const [maxLeverage, setMaxLeverage] = useState("1");
  const [allowedSymbolsText, setAllowedSymbolsText] = useState("");
  const [allowedVenuesText, setAllowedVenuesText] = useState("");
  const [orderTypePolicy, setOrderTypePolicy] = useState("MARKET_AND_LIMIT");
  const [slippageToleranceBps, setSlippageToleranceBps] = useState("50");
  const [executionDelayMs, setExecutionDelayMs] = useState("0");
  const [takeProfitBps, setTakeProfitBps] = useState("");
  const [stopLossBps, setStopLossBps] = useState("");
  const [trailingStopBps, setTrailingStopBps] = useState("");
  const [maxDailyLoss, setMaxDailyLoss] = useState("");
  const [maxDrawdown, setMaxDrawdown] = useState("");
  const [maxOpenExposure, setMaxOpenExposure] = useState("");
  const [maxDailyCopiedTrades, setMaxDailyCopiedTrades] = useState("");
  const [emergencyStopCopy, setEmergencyStopCopy] = useState(false);

  useEffect(() => {
    if (!sub) return;
    setAllocationMode(sub.allocationMode);
    setAllocationAmount(sub.allocationAmount || "100");
    setMinAllocation(sub.minAllocation ?? "");
    setMaxAllocation(sub.maxAllocation ?? "");
    const cp = sub.copyPolicy ?? effectivePolicy;
    if (cp) {
      setMaxPositionSize(cp.maxPositionSize ?? "");
      setMaxNotional(cp.maxNotional ?? "");
      setMaxLeverage(cp.maxLeverage ?? "1");
      setAllowedSymbolsText(cp.allowedSymbols?.join(", ") ?? "");
      setAllowedVenuesText(cp.allowedVenues?.join(", ") ?? "");
      setOrderTypePolicy(cp.orderTypePolicy || "MARKET_AND_LIMIT");
      setSlippageToleranceBps(
        cp.slippageToleranceBps !== null ? String(cp.slippageToleranceBps) : "50",
      );
      setExecutionDelayMs(cp.executionDelayMs !== null ? String(cp.executionDelayMs) : "0");
      setTakeProfitBps(cp.takeProfitBps !== null ? String(cp.takeProfitBps) : "");
      setStopLossBps(cp.stopLossBps !== null ? String(cp.stopLossBps) : "");
      setTrailingStopBps(cp.trailingStopBps !== null ? String(cp.trailingStopBps) : "");
    }
    if (sub.riskPolicy) {
      setMaxDailyLoss(sub.riskPolicy.maxDailyLoss ?? "");
      setMaxDrawdown(sub.riskPolicy.maxDrawdown ?? "");
      setMaxOpenExposure(sub.riskPolicy.maxOpenExposure ?? "");
      setMaxDailyCopiedTrades(
        sub.riskPolicy.maxDailyCopiedTrades !== null
          ? String(sub.riskPolicy.maxDailyCopiedTrades)
          : "",
      );
      setEmergencyStopCopy(sub.riskPolicy.emergencyStopCopy);
    }
  }, [sub, effectivePolicy]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const allowedSymbols = allowedSymbolsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const allowedVenues = allowedVenuesText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return tradingApi.updateCopySubscriptionSettings(subscriptionId, {
        allocationMode,
        allocationAmount,
        minAllocation: minAllocation.trim() || null,
        maxAllocation: maxAllocation.trim() || null,
        copyPolicy: {
          sizingMode: allocationMode,
          maxPositionSize: maxPositionSize.trim() || null,
          maxNotional: maxNotional.trim() || null,
          maxLeverage: maxLeverage.trim() || null,
          allowedSymbols: allowedSymbols.length > 0 ? allowedSymbols : null,
          allowedVenues: allowedVenues.length > 0 ? allowedVenues : null,
          orderTypePolicy,
          slippageToleranceBps: slippageToleranceBps.trim() ? Number(slippageToleranceBps) : null,
          executionDelayMs: executionDelayMs.trim() ? Number(executionDelayMs) : 0,
          takeProfitBps: takeProfitBps.trim() ? Number(takeProfitBps) : null,
          stopLossBps: stopLossBps.trim() ? Number(stopLossBps) : null,
          trailingStopBps: trailingStopBps.trim() ? Number(trailingStopBps) : null,
          emergencyStop: emergencyStopCopy,
        },
        riskPolicy: {
          maxDailyLoss: maxDailyLoss.trim() || null,
          maxDrawdown: maxDrawdown.trim() || null,
          maxOpenExposure: maxOpenExposure.trim() || null,
          maxDailyCopiedTrades: maxDailyCopiedTrades.trim()
            ? Number(maxDailyCopiedTrades)
            : null,
          emergencyStopCopy,
        },
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["copy-subscription-detail", subscriptionId] });
      void qc.invalidateQueries({ queryKey: ["copy-subscriptions"] });
    },
  });

  return (
    <PageContainer
      title="Copy Subscription Settings & Risk Policy"
      description="Configure order sizing, slippage tolerance, execution delay, TP/SL/trailing stops, and follower risk guardrails"
    >
      <TradingStateBoundary
        isLoading={detailQuery.isLoading}
        error={detailQuery.error}
        isEmpty={!sub}
        emptyTitle="Subscription not found"
        emptyDescription="Could not load settings for this copy subscription."
        onRetry={() => void detailQuery.refetch()}
      >
        {sub && (
          <div className="space-y-6" data-testid="copy-settings-page">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded border bg-card p-4 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-semibold">Subscription {sub.subscriptionId}</span>
                <StatusBadge status={sub.state} />
              </div>
              <div className="flex gap-3">
                <Link
                  href={`/copy-trading/${sub.subscriptionId}`}
                  className="font-medium underline"
                >
                  ← Back to Subscription Overview
                </Link>
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveMutation.mutate();
              }}
              className="space-y-6"
              data-testid="copy-settings-form"
            >
              {/* Sizing & Allocation Limits */}
              <div className="rounded border bg-card p-4">
                <h2 className="text-sm font-semibold">1. Order Sizing & Allocation Limits</h2>
                <div className="mt-3 grid grid-cols-1 gap-3 text-xs md:grid-cols-4">
                  <label className="space-y-1">
                    <span className="text-muted">Sizing Mode</span>
                    <select
                      aria-label="Sizing Mode"
                      value={allocationMode}
                      onChange={(e) => setAllocationMode(e.target.value as AllocationMode)}
                      className="w-full rounded border px-2 py-1.5"
                    >
                      <option value="FIXED">FIXED</option>
                      <option value="PROPORTIONAL">PROPORTIONAL</option>
                      <option value="MULTIPLIER">MULTIPLIER</option>
                      <option value="EQUITY_RATIO">EQUITY_RATIO</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Allocation Amount</span>
                    <input
                      aria-label="Allocation Amount"
                      value={allocationAmount}
                      onChange={(e) => setAllocationAmount(e.target.value)}
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Min Allocation</span>
                    <input
                      aria-label="Min Allocation"
                      value={minAllocation}
                      onChange={(e) => setMinAllocation(e.target.value)}
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Max Allocation</span>
                    <input
                      aria-label="Max Allocation"
                      value={maxAllocation}
                      onChange={(e) => setMaxAllocation(e.target.value)}
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Max Position Size</span>
                    <input
                      aria-label="Max Position Size"
                      value={maxPositionSize}
                      onChange={(e) => setMaxPositionSize(e.target.value)}
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Max Notional per Order</span>
                    <input
                      aria-label="Max Notional per Order"
                      value={maxNotional}
                      onChange={(e) => setMaxNotional(e.target.value)}
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Max Leverage</span>
                    <input
                      aria-label="Max Leverage"
                      value={maxLeverage}
                      onChange={(e) => setMaxLeverage(e.target.value)}
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Order Type Policy</span>
                    <select
                      aria-label="Order Type Policy"
                      value={orderTypePolicy}
                      onChange={(e) => setOrderTypePolicy(e.target.value)}
                      className="w-full rounded border px-2 py-1.5"
                    >
                      <option value="MARKET_AND_LIMIT">MARKET_AND_LIMIT</option>
                      <option value="MARKET_ONLY">MARKET_ONLY</option>
                      <option value="LIMIT_ONLY">LIMIT_ONLY</option>
                    </select>
                  </label>
                </div>
              </div>

              {/* Execution Controls & TP/SL/Trailing Stop (GAP-06 & GAP-07) */}
              <div className="rounded border bg-card p-4">
                <h2 className="text-sm font-semibold">
                  2. Execution Controls, Slippage & Protective TP/SL/Trailing Stop
                </h2>
                <div className="mt-3 grid grid-cols-1 gap-3 text-xs md:grid-cols-3">
                  <label className="space-y-1">
                    <span className="text-muted">Slippage Tolerance (bps)</span>
                    <input
                      aria-label="Slippage Tolerance (bps)"
                      value={slippageToleranceBps}
                      onChange={(e) => setSlippageToleranceBps(e.target.value)}
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Execution Delay (ms)</span>
                    <input
                      aria-label="Execution Delay (ms)"
                      value={executionDelayMs}
                      onChange={(e) => setExecutionDelayMs(e.target.value)}
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Take-Profit (bps)</span>
                    <input
                      aria-label="Take-Profit (bps)"
                      value={takeProfitBps}
                      onChange={(e) => setTakeProfitBps(e.target.value)}
                      placeholder="e.g. 300"
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Stop-Loss (bps)</span>
                    <input
                      aria-label="Stop-Loss (bps)"
                      value={stopLossBps}
                      onChange={(e) => setStopLossBps(e.target.value)}
                      placeholder="e.g. 150"
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Trailing Stop (bps)</span>
                    <input
                      aria-label="Trailing Stop (bps)"
                      value={trailingStopBps}
                      onChange={(e) => setTrailingStopBps(e.target.value)}
                      placeholder="e.g. 75"
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Allowed Symbols (comma-separated)</span>
                    <input
                      aria-label="Allowed Symbols"
                      value={allowedSymbolsText}
                      onChange={(e) => setAllowedSymbolsText(e.target.value)}
                      placeholder="BTC-USDT, ETH-USDT"
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Allowed Venues (comma-separated)</span>
                    <input
                      aria-label="Allowed Venues"
                      value={allowedVenuesText}
                      onChange={(e) => setAllowedVenuesText(e.target.value)}
                      placeholder="BINANCE, BYBIT"
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                </div>
              </div>

              {/* Follower Risk Policy */}
              <div className="rounded border bg-card p-4">
                <h2 className="text-sm font-semibold">3. Follower Risk Policy Guardrails</h2>
                <div className="mt-3 grid grid-cols-1 gap-3 text-xs md:grid-cols-4">
                  <label className="space-y-1">
                    <span className="text-muted">Max Daily Loss</span>
                    <input
                      aria-label="Max Daily Loss"
                      value={maxDailyLoss}
                      onChange={(e) => setMaxDailyLoss(e.target.value)}
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Max Drawdown</span>
                    <input
                      aria-label="Max Drawdown"
                      value={maxDrawdown}
                      onChange={(e) => setMaxDrawdown(e.target.value)}
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Max Open Exposure</span>
                    <input
                      aria-label="Max Open Exposure"
                      value={maxOpenExposure}
                      onChange={(e) => setMaxOpenExposure(e.target.value)}
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Max Daily Copied Trades</span>
                    <input
                      aria-label="Max Daily Copied Trades"
                      value={maxDailyCopiedTrades}
                      onChange={(e) => setMaxDailyCopiedTrades(e.target.value)}
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                </div>
                <label className="mt-3 flex items-center gap-2 text-xs font-medium text-rose-800">
                  <input
                    type="checkbox"
                    checked={emergencyStopCopy}
                    onChange={(e) => setEmergencyStopCopy(e.target.checked)}
                  />
                  Engage Emergency Copy Stop (blocks all new copied child orders immediately)
                </label>
              </div>

              {/* Effective Policy Preview */}
              {effectivePolicy && (
                <div
                  className="rounded border border-slate-200 bg-slate-50 p-4 text-xs"
                  data-testid="effective-policy-preview"
                >
                  <h3 className="font-semibold">Effective Policy Preview (Platform ∩ Strategy ∩ Follower)</h3>
                  <dl className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                    <div>
                      <dt className="text-muted">Effective Sizing</dt>
                      <dd className="font-semibold">{effectivePolicy.sizingMode}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">Effective Max Notional</dt>
                      <dd className="font-mono">
                        {effectivePolicy.maxNotional ? (
                          <Money value={effectivePolicy.maxNotional} />
                        ) : (
                          "Default"
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Slippage Cap</dt>
                      <dd className="font-mono">{effectivePolicy.slippageToleranceBps ?? 50} bps</dd>
                    </div>
                    <div>
                      <dt className="text-muted">TP / SL / Trailing</dt>
                      <dd className="font-mono">
                        {effectivePolicy.takeProfitBps ?? "—"} / {effectivePolicy.stopLossBps ?? "—"} /{" "}
                        {effectivePolicy.trailingStopBps ?? "—"} bps
                      </dd>
                    </div>
                  </dl>
                </div>
              )}

              {saveMutation.isError && (
                <div role="alert" className="text-xs text-red-700">
                  {(saveMutation.error as Error).message}
                </div>
              )}
              {saveMutation.isSuccess && (
                <div role="status" data-testid="settings-saved-banner" className="text-xs text-green-700">
                  Copy subscription settings and risk policy saved.
                </div>
              )}

              <button
                type="submit"
                disabled={saveMutation.isPending}
                data-testid="save-copy-settings-btn"
                className="rounded bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40"
              >
                {saveMutation.isPending ? "Saving…" : "Save Copy Policy & Risk Settings"}
              </button>
            </form>
          </div>
        )}
      </TradingStateBoundary>
    </PageContainer>
  );
}
