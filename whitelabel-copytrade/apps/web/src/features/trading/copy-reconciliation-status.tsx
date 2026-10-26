// # NEW — Renders reconciliation health status, last checked timestamp, and discrepancy notices
"use client";
import type { JSX } from 'react';

import React from "react";
import type { CopyReconciliationSummary, CustomerReconciliationStatus } from "@/api/trading-api";

export interface CopyReconciliationStatusProps {
  summary: CopyReconciliationSummary | CustomerReconciliationStatus;
}

export function CopyReconciliationStatus({
  summary,
}: CopyReconciliationStatusProps): JSX.Element {
  const legacy = "totalExecutions" in summary;
  const styleByStatus = {
    IN_SYNC: "border-emerald-300 bg-emerald-50 text-emerald-900",
    DEGRADED: "border-amber-300 bg-amber-50 text-amber-900",
    DISCREPANCY_DETECTED: "border-rose-300 bg-rose-50 text-rose-900",
    SYNCED: "border-emerald-300 bg-emerald-50 text-emerald-900",
    PENDING_REVIEW: "border-amber-300 bg-amber-50 text-amber-900",
    ATTENTION_REQUIRED: "border-rose-300 bg-rose-50 text-rose-900",
  } as const;
  const statusStyle = styleByStatus[summary.status];
  const discrepancyRows = legacy
    ? summary.discrepancies
    : summary.items.filter((item) => !item.resolved).map((item) => ({ executionId: item.executionId ?? item.id, category: item.category, message: item.customerMessage }));

  return (
    <div
      className={`rounded border p-4 text-xs ${statusStyle}`}
      data-testid="copy-reconciliation-status"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold">Copy Execution Reconciliation Status</span>
          <span
            data-testid="reconciliation-status-badge"
            className="rounded bg-white/80 px-2 py-0.5 font-mono text-[11px] font-semibold"
          >
            {summary.status}
          </span>
        </div>
        <span className="text-[11px] opacity-80">
          Last Checked: {new Date(summary.lastCheckedAt).toLocaleString()}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        {legacy ? (
          <>
            <div><dt className="opacity-75">Total Executions</dt><dd className="font-mono font-semibold">{summary.totalExecutions}</dd></div>
            <div><dt className="opacity-75">Completed / Routed</dt><dd className="font-mono font-semibold">{summary.completedExecutions}</dd></div>
            <div><dt className="opacity-75">Risk Blocked</dt><dd className="font-mono font-semibold">{summary.riskBlockedExecutions}</dd></div>
            <div><dt className="opacity-75">Failed / Unlinked</dt><dd className="font-mono font-semibold">{summary.failedExecutions} ({summary.discrepancyCount} discrepancies)</dd></div>
          </>
        ) : (
          <>
            <div><dt className="opacity-75">Unresolved records</dt><dd className="font-mono font-semibold">{summary.unresolvedCount}</dd></div>
            <div><dt className="opacity-75">Resolved records</dt><dd className="font-mono font-semibold">{summary.resolvedCount}</dd></div>
            <div className="col-span-2"><dt className="opacity-75">Scope</dt><dd className="font-mono font-semibold">This subscription only</dd></div>
          </>
        )}
      </dl>

      {discrepancyRows.length > 0 && (
        <div
          role="alert"
          data-testid="reconciliation-discrepancy-warning"
          className="mt-3 rounded border border-rose-300 bg-white/90 p-3 text-rose-900"
        >
          <div className="font-semibold">
            Discrepancy Detected ({discrepancyRows.length})
          </div>
          <ul className="mt-1 list-disc pl-4">
            {discrepancyRows.map((d) => (
              <li key={d.executionId}>
                <span className="font-mono">{d.executionId}</span> [{d.category}]: {d.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
