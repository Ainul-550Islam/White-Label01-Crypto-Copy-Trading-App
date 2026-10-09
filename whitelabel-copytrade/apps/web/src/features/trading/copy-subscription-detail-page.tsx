// # NEW — Displays subscription status, effective policy, risk headroom, recent executions, and lifecycle actions
"use client";
import type { JSX } from 'react';

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { tradingApi, type CopyExecutionItem } from "@/api/trading-api";
import { PageContainer } from "@/layout/page-container";
import { StatusBadge } from "@/components/status-badge";
import { Money } from "@/components/money";
import { TradingStateBoundary } from "@/components/trading-state";
import { CopyExecutionDetail } from "./copy-execution-detail";
import { CopyRiskGuardrails } from "./copy-risk-guardrails";
import { CopyReconciliationStatus } from "./copy-reconciliation-status";
import { useCopyExecutionEvents } from "./use-copy-execution-events";

export function CopySubscriptionDetailPage({
  subscriptionId,
}: {
  subscriptionId: string;
}): JSX.Element {
  const qc = useQueryClient();
  const [selectedExecution, setSelectedExecution] = useState<CopyExecutionItem | null>(null);
  const [closePositionsOnStop, setClosePositionsOnStop] = useState<boolean>(false);

  const detailQuery = useQuery({
    queryKey: ["copy-subscription-detail", subscriptionId],
    queryFn: () => tradingApi.getSubscriptionDetail(subscriptionId),
  });

  const { transportMode, lastEventAt } = useCopyExecutionEvents({
    subscriptionId,
    enabled: Boolean(detailQuery.data),
    pollIntervalMs: 15000,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["copy-subscription-detail", subscriptionId] });
    void qc.invalidateQueries({ queryKey: ["copy-subscriptions"] });
  };

  const pauseMutation = useMutation({
    mutationFn: () => tradingApi.pauseSubscription(subscriptionId),
    onSuccess: invalidate,
  });

  const resumeMutation = useMutation({
    mutationFn: () => tradingApi.resumeSubscription(subscriptionId),
    onSuccess: invalidate,
  });

  const stopMutation = useMutation({
    mutationFn: (closeOpen: boolean) =>
      tradingApi.stopSubscription(
        subscriptionId,
        closeOpen ? "Follower requested stop and close open positions" : "Follower requested stop",
        closeOpen,
      ),
    onSuccess: invalidate,
  });

  const sub = detailQuery.data?.subscription;
  const effectivePolicy = detailQuery.data?.effectivePolicy;
  const recentExecutions = detailQuery.data?.recentExecutions ?? [];
  const reconciliation = detailQuery.data?.reconciliation;

  return (
    <PageContainer
      title={sub ? `Subscription ${sub.subscriptionId}` : "Copy Subscription Detail"}
      description="Live copy subscription status, effective policy, risk guardrails, reconciliation health, and execution history"
    >
      <TradingStateBoundary
        isLoading={detailQuery.isLoading}
        error={detailQuery.error}
        isEmpty={!sub}
        emptyTitle="Subscription not found"
        emptyDescription="The requested copy subscription does not exist or belongs to another follower."
        onRetry={() => void detailQuery.refetch()}
      >
        {sub && (
          <div className="space-y-6" data-testid="copy-subscription-detail-page">
            {/* Top Navigation & Lifecycle Actions */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded border bg-card p-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold">
                    Strategy{" "}
                    <Link href={`/strategies/${sub.strategyId}`} className="underline">
                      {sub.strategyId}
                    </Link>
                  </span>
                  <StatusBadge status={sub.state} />
                  <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-700">
                    Stream: {transportMode}
                    {lastEventAt ? ` (${new Date(lastEventAt).toLocaleTimeString()})` : ""}
                  </span>
                </div>
                <p className="text-xs text-muted">
                  Lead Trader:{" "}
                  <Link href={`/traders/${sub.traderId}`} className="underline">
                    {sub.traderId}
                  </Link>{" "}
                  | Allocation: {sub.allocationMode} (<Money value={sub.allocationAmount} />)
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Link
                  href={`/copy-trading/${sub.subscriptionId}/settings`}
                  className="rounded border px-3 py-1.5 font-medium hover:bg-slate-50"
                >
                  Copy Settings
                </Link>
                <Link
                  href={`/copy-trading/${sub.subscriptionId}/positions`}
                  className="rounded border px-3 py-1.5 font-medium hover:bg-slate-50"
                >
                  Copied Positions
                </Link>
                <Link
                  href={`/copy-trading/${sub.subscriptionId}/orders`}
                  className="rounded border px-3 py-1.5 font-medium hover:bg-slate-50"
                >
                  Copied Orders & Fills
                </Link>

                {sub.state === "ACTIVE" && (
                  <button
                    type="button"
                    data-testid="pause-subscription-btn"
                    disabled={pauseMutation.isPending}
                    onClick={() => pauseMutation.mutate()}
                    className="rounded border px-3 py-1.5 font-medium hover:bg-slate-50"
                  >
                    Pause
                  </button>
                )}
                {sub.state === "PAUSED" && (
                  <button
                    type="button"
                    data-testid="resume-subscription-btn"
                    disabled={resumeMutation.isPending}
                    onClick={() => resumeMutation.mutate()}
                    className="rounded border px-3 py-1.5 font-medium hover:bg-slate-50"
                  >
                    Resume
                  </button>
                )}
                {sub.state !== "STOPPED" && (
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-[11px] text-muted">
                      <input
                        type="checkbox"
                        checked={closePositionsOnStop}
                        onChange={(e) => setClosePositionsOnStop(e.target.checked)}
                      />
                      Close positions on stop
                    </label>
                    <button
                      type="button"
                      data-testid="stop-subscription-btn"
                      disabled={stopMutation.isPending}
                      onClick={() => stopMutation.mutate(closePositionsOnStop)}
                      className="rounded border border-rose-300 px-3 py-1.5 font-medium text-rose-700 hover:bg-rose-50"
                    >
                      Stop
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Reconciliation Health */}
            {reconciliation && <CopyReconciliationStatus summary={reconciliation} />}

            {/* Risk Guardrails */}
            <CopyRiskGuardrails
              subscription={sub}
              recentExecutions={recentExecutions}
              onEmergencyStop={(closeOpen) => stopMutation.mutate(closeOpen)}
              isStopping={stopMutation.isPending}
            />

            {/* Effective Copy Policy Summary */}
            {effectivePolicy && (
              <div className="rounded border bg-card p-4 text-xs">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Effective Copy Policy</h2>
                  <Link
                    href={`/copy-trading/${sub.subscriptionId}/settings`}
                    className="underline"
                  >
                    Edit Policy →
                  </Link>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <div>
                    <dt className="text-muted">Sizing Mode</dt>
                    <dd className="font-semibold">{effectivePolicy.sizingMode}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Slippage Tolerance</dt>
                    <dd className="font-mono">
                      {effectivePolicy.slippageToleranceBps ?? 50} bps
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Execution Delay</dt>
                    <dd className="font-mono">{effectivePolicy.executionDelayMs ?? 0} ms</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Protective TP / SL</dt>
                    <dd className="font-mono">
                      {effectivePolicy.takeProfitBps ?? "—"} / {effectivePolicy.stopLossBps ?? "—"}{" "}
                      bps
                    </dd>
                  </div>
                </dl>
              </div>
            )}

            {/* Selected Execution Drilldown */}
            {selectedExecution && (
              <CopyExecutionDetail
                execution={selectedExecution}
                onClose={() => setSelectedExecution(null)}
              />
            )}

            {/* Recent Copy Executions Table */}
            <div className="rounded border bg-card p-4 text-xs">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Recent Copy Executions</h2>
                <span className="text-muted">
                  Total Copies: {sub.totalCopies} | Failed: {sub.failedCopies}
                </span>
              </div>
              {recentExecutions.length === 0 ? (
                <p className="mt-2 text-muted">No copy executions recorded yet for this subscription.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-xs" data-testid="subscription-executions-table">
                    <thead>
                      <tr className="border-b text-muted">
                        <th className="py-2 pr-3">Execution ID</th>
                        <th className="py-2 pr-3">Leader Event</th>
                        <th className="py-2 pr-3">Status</th>
                        <th className="py-2 pr-3">Sizing</th>
                        <th className="py-2 pr-3">Follower Qty</th>
                        <th className="py-2 pr-3">Child Order</th>
                        <th className="py-2">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {recentExecutions.map((exec) => (
                        <tr key={exec.executionId}>
                          <td className="py-2 pr-3 font-mono">{exec.executionId}</td>
                          <td className="py-2 pr-3 font-mono">{exec.leaderEventId}</td>
                          <td className="py-2 pr-3">
                            <StatusBadge status={exec.status} />
                          </td>
                          <td className="py-2 pr-3">{exec.sizingMode}</td>
                          <td className="py-2 pr-3 font-mono">{exec.followerQuantity}</td>
                          <td className="py-2 pr-3 font-mono">{exec.followerOrderId ?? "—"}</td>
                          <td className="py-2">
                            <button
                              type="button"
                              onClick={() => setSelectedExecution(exec)}
                              className="underline"
                            >
                              Inspect
                            </button>
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
