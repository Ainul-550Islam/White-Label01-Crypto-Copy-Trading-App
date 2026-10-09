// # NEW — Displays copied order lifecycle states, fill breakdown, fees, slippage, and rejection reasons
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

export function CopiedOrdersPage({
  subscriptionId,
}: {
  subscriptionId: string;
}): JSX.Element {
  const [statusFilter, setStatusFilter] = useState<string>("");

  const ordersQuery = useQuery({
    queryKey: ["copied-orders", subscriptionId, statusFilter],
    queryFn: () =>
      tradingApi.listSubscriptionOrders(subscriptionId, {
        status: statusFilter || undefined,
      }),
  });

  const rows = ordersQuery.data ?? [];

  return (
    <PageContainer
      title={`Copied Orders & Fills — Subscription ${subscriptionId}`}
      description="Child order lifecycle states, fill progress, execution fees, slippage, and risk/rejection diagnostics"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded border bg-card p-3 text-xs">
        <div className="flex items-center gap-2">
          <label htmlFor="copied-order-status" className="text-muted">
            Execution Status:
          </label>
          <select
            id="copied-order-status"
            aria-label="Execution Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded border px-2.5 py-1"
          >
            <option value="">All States</option>
            <option value="COMPLETED">COMPLETED</option>
            <option value="ROUTED">ROUTED</option>
            <option value="PENDING">PENDING</option>
            <option value="RISK_BLOCKED">RISK_BLOCKED</option>
            <option value="FAILED">FAILED</option>
            <option value="SKIPPED">SKIPPED</option>
          </select>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/copy-trading/${subscriptionId}/positions`}
            className="font-medium underline"
          >
            View Copied Positions
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
        isLoading={ordersQuery.isLoading}
        error={ordersQuery.error}
        isEmpty={rows.length === 0}
        emptyTitle="No copied orders or executions found"
        emptyDescription="No child orders or executions matched the selected status filter."
        onRetry={() => void ordersQuery.refetch()}
      >
        <div className="overflow-x-auto rounded border bg-card" data-testid="copied-orders-page">
          <table className="w-full text-left text-xs" data-testid="copied-orders-table">
            <thead>
              <tr className="border-b bg-slate-50 text-muted">
                <th className="p-3">Execution ID</th>
                <th className="p-3">Child Order ID</th>
                <th className="p-3">Symbol / Side</th>
                <th className="p-3">Exec State</th>
                <th className="p-3">Order State</th>
                <th className="p-3">Filled / Requested</th>
                <th className="p-3">Avg Fill Price</th>
                <th className="p-3">Fee</th>
                <th className="p-3">Risk / Rejection Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.executionId}>
                  <td className="p-3 font-mono">{row.executionId}</td>
                  <td className="p-3 font-mono">{row.followerOrderId ?? "—"}</td>
                  <td className="p-3">
                    <span className="font-semibold">{row.symbol}</span>{" "}
                    <span className="text-muted">({row.side}/{row.orderType})</span>
                  </td>
                  <td className="p-3">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="p-3">
                    <StatusBadge status={row.orderStatus} />
                  </td>
                  <td className="p-3 font-mono">
                    {row.filledQuantity} / {row.followerQuantity}
                  </td>
                  <td className="p-3 font-mono">
                    {row.averageFillPrice ? <Money value={row.averageFillPrice} /> : "—"}
                  </td>
                  <td className="p-3 font-mono">
                    {row.fee ? (
                      <>
                        <Money value={row.fee} /> {row.feeAsset ?? ""}
                      </>
                    ) : (
                      "0.00"
                    )}
                  </td>
                  <td className="p-3">
                    {row.failureReason || row.riskReasons.join("; ") || "—"}
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
