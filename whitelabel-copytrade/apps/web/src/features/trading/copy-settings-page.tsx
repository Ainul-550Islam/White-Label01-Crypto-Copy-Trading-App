// # NEW — Form for sizing mode, allocation limits, symbol/venue allowlists, order type policy, slippage, execution delay, TP/SL, and follower risk policy
// # Adds TP/SL/trailing stop configuration inputs and effective policy preview
"use client";
import type { JSX } from 'react';

import React, { useState } from "react";
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

  const defaultSettings = {
    allocationMode: (sub?.allocationMode ?? "FIXED") as AllocationMode,
    allocationAmount: sub?.allocationAmount || "100",
    minAllocation: sub?.minAllocation ?? "",
    maxAllocation: sub?.maxAllocation ?? "",
    maxPositionSize: (sub?.copyPolicy ?? effectivePolicy)?.maxPositionSize ?? "",
    maxNotional: (sub?.copyPolicy ?? effectivePolicy)?.maxNotional ?? "",
    maxLeverage: (sub?.copyPolicy ?? effectivePolicy)?.maxLeverage ?? "1",
    allowedSymbolsText: (sub?.copyPolicy ?? effectivePolicy)?.allowedSymbols?.join(", ") ?? "",
    blockedSymbolsText: (sub?.copyPolicy ?? effectivePolicy)?.blockedSymbols?.join(", ") ?? "",
    allowedVenuesText: (sub?.copyPolicy ?? effectivePolicy)?.allowedVenues?.join(", ") ?? "",
    orderTypePolicy: (sub?.copyPolicy ?? effectivePolicy)?.orderTypePolicy || "MARKET_AND_LIMIT",
    slippageToleranceBps: (sub?.copyPolicy ?? effectivePolicy)?.slippageToleranceBps != null
      ? String((sub?.copyPolicy ?? effectivePolicy)?.slippageToleranceBps)
      : "50",
    executionDelayMs: (sub?.copyPolicy ?? effectivePolicy)?.executionDelayMs != null
      ? String((sub?.copyPolicy ?? effectivePolicy)?.executionDelayMs)
      : "0",
    takeProfitBps: (sub?.copyPolicy ?? effectivePolicy)?.takeProfitBps != null
      ? String((sub?.copyPolicy ?? effectivePolicy)?.takeProfitBps)
      : "",
    stopLossBps: (sub?.copyPolicy ?? effectivePolicy)?.stopLossBps != null
      ? String((sub?.copyPolicy ?? effectivePolicy)?.stopLossBps)
      : "",
    trailingStopBps: (sub?.copyPolicy ?? effectivePolicy)?.trailingStopBps != null
      ? String((sub?.copyPolicy ?? effectivePolicy)?.trailingStopBps)
      : "",
    maxDailyLoss: sub?.riskPolicy?.maxDailyLoss ?? "",
    maxDrawdown: sub?.riskPolicy?.maxDrawdown ?? "",
    maxOpenExposure: sub?.riskPolicy?.maxOpenExposure ?? "",
    maxDailyCopiedTrades: sub?.riskPolicy?.maxDailyCopiedTrades != null
      ? String(sub.riskPolicy.maxDailyCopiedTrades)
      : "",
    emergencyStopCopy: sub?.riskPolicy?.emergencyStopCopy ?? false,
  };
  type CopySettings = typeof defaultSettings;
  const [draft, setDraft] = useState<Partial<CopySettings>>({});
  const settings: CopySettings = { ...defaultSettings, ...draft };
  const updateSetting = <K extends keyof CopySettings,>(key: K, value: CopySettings[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const allowedSymbols = settings.allowedSymbolsText
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
      const blockedSymbols = settings.blockedSymbolsText
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
      const allowedVenues = settings.allowedVenuesText
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
      return tradingApi.updateCopySubscriptionSettings(subscriptionId, {
        allocationMode: settings.allocationMode,
        allocationAmount: settings.allocationAmount,
        minAllocation: settings.minAllocation.trim() || null,
        maxAllocation: settings.maxAllocation.trim() || null,
        copyPolicy: {
          sizingMode: settings.allocationMode,
          maxPositionSize: settings.maxPositionSize.trim() || null,
          maxNotional: settings.maxNotional.trim() || null,
          maxLeverage: settings.maxLeverage.trim() || null,
          allowedSymbols: allowedSymbols.length > 0 ? allowedSymbols : null,
          blockedSymbols: blockedSymbols.length > 0 ? blockedSymbols : null,
          allowedVenues: allowedVenues.length > 0 ? allowedVenues : null,
          orderTypePolicy: settings.orderTypePolicy,
          slippageToleranceBps: settings.slippageToleranceBps.trim() ? Number(settings.slippageToleranceBps) : null,
          executionDelayMs: settings.executionDelayMs.trim() ? Number(settings.executionDelayMs) : 0,
          takeProfitBps: settings.takeProfitBps.trim() ? Number(settings.takeProfitBps) : null,
          stopLossBps: settings.stopLossBps.trim() ? Number(settings.stopLossBps) : null,
          trailingStopBps: settings.trailingStopBps.trim() ? Number(settings.trailingStopBps) : null,
          emergencyStop: settings.emergencyStopCopy,
        },
        riskPolicy: {
          maxDailyLoss: settings.maxDailyLoss.trim() || null,
          maxDrawdown: settings.maxDrawdown.trim() || null,
          maxOpenExposure: settings.maxOpenExposure.trim() || null,
          maxDailyCopiedTrades: settings.maxDailyCopiedTrades.trim()
            ? Number(settings.maxDailyCopiedTrades)
            : null,
          emergencyStopCopy: settings.emergencyStopCopy,
        },
      });
    },
    onSuccess: () => {
      setDraft({});
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
                      value={settings.allocationMode}
                      onChange={(e) => updateSetting('allocationMode', e.target.value as AllocationMode)}
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
                      value={settings.allocationAmount}
                      onChange={(e) => updateSetting('allocationAmount', e.target.value)}
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Min Allocation</span>
                    <input
                      aria-label="Min Allocation"
                      value={settings.minAllocation}
                      onChange={(e) => updateSetting('minAllocation', e.target.value)}
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Max Allocation</span>
                    <input
                      aria-label="Max Allocation"
                      value={settings.maxAllocation}
                      onChange={(e) => updateSetting('maxAllocation', e.target.value)}
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Max Position Size</span>
                    <input
                      aria-label="Max Position Size"
                      value={settings.maxPositionSize}
                      onChange={(e) => updateSetting('maxPositionSize', e.target.value)}
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Max Notional per Order</span>
                    <input
                      aria-label="Max Notional per Order"
                      value={settings.maxNotional}
                      onChange={(e) => updateSetting('maxNotional', e.target.value)}
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Max Leverage</span>
                    <input
                      aria-label="Max Leverage"
                      value={settings.maxLeverage}
                      onChange={(e) => updateSetting('maxLeverage', e.target.value)}
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Order Type Policy</span>
                    <select
                      aria-label="Order Type Policy"
                      value={settings.orderTypePolicy}
                      onChange={(e) => updateSetting('orderTypePolicy', e.target.value)}
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
                      value={settings.slippageToleranceBps}
                      onChange={(e) => updateSetting('slippageToleranceBps', e.target.value)}
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Execution Delay (ms)</span>
                    <input
                      aria-label="Execution Delay (ms)"
                      value={settings.executionDelayMs}
                      onChange={(e) => updateSetting('executionDelayMs', e.target.value)}
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Take-Profit (bps)</span>
                    <input
                      aria-label="Take-Profit (bps)"
                      value={settings.takeProfitBps}
                      onChange={(e) => updateSetting('takeProfitBps', e.target.value)}
                      placeholder="e.g. 300"
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Stop-Loss (bps)</span>
                    <input
                      aria-label="Stop-Loss (bps)"
                      value={settings.stopLossBps}
                      onChange={(e) => updateSetting('stopLossBps', e.target.value)}
                      placeholder="e.g. 150"
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Trailing Stop (bps)</span>
                    <input
                      aria-label="Trailing Stop (bps)"
                      value={settings.trailingStopBps}
                      onChange={(e) => updateSetting('trailingStopBps', e.target.value)}
                      placeholder="e.g. 75"
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Allowed Symbols (comma-separated)</span>
                    <input
                      aria-label="Allowed Symbols"
                      value={settings.allowedSymbolsText}
                      onChange={(e) => updateSetting('allowedSymbolsText', e.target.value)}
                      placeholder="BTC-USDT, ETH-USDT"
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Blocked Symbols (comma-separated, * allowed as a wildcard)</span>
                    <input
                      aria-label="Blocked Symbols"
                      value={settings.blockedSymbolsText}
                      onChange={(e) => updateSetting('blockedSymbolsText', e.target.value)}
                      placeholder="e.g. *WITHDRAWAL*, DOGE-USDT"
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Allowed Venues (comma-separated)</span>
                    <input
                      aria-label="Allowed Venues"
                      value={settings.allowedVenuesText}
                      onChange={(e) => updateSetting('allowedVenuesText', e.target.value)}
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
                      value={settings.maxDailyLoss}
                      onChange={(e) => updateSetting('maxDailyLoss', e.target.value)}
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Max Drawdown</span>
                    <input
                      aria-label="Max Drawdown"
                      value={settings.maxDrawdown}
                      onChange={(e) => updateSetting('maxDrawdown', e.target.value)}
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Max Open Exposure</span>
                    <input
                      aria-label="Max Open Exposure"
                      value={settings.maxOpenExposure}
                      onChange={(e) => updateSetting('maxOpenExposure', e.target.value)}
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted">Max Daily Copied Trades</span>
                    <input
                      aria-label="Max Daily Copied Trades"
                      value={settings.maxDailyCopiedTrades}
                      onChange={(e) => updateSetting('maxDailyCopiedTrades', e.target.value)}
                      className="w-full rounded border px-2 py-1.5"
                    />
                  </label>
                </div>
                <label className="mt-3 flex items-center gap-2 text-xs font-medium text-rose-800">
                  <input
                    type="checkbox"
                    checked={settings.emergencyStopCopy}
                    onChange={(e) => updateSetting('emergencyStopCopy', e.target.checked)}
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
