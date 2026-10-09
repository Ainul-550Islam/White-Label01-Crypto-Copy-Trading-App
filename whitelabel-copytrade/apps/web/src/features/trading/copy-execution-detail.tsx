// # NEW — Renders leader event details, sizing calculation, risk decision, child order linkage, and execution timeline
"use client";
import type { JSX } from 'react';

import React from "react";
import type { CopyExecutionItem } from "@/api/trading-api";
import { StatusBadge } from "@/components/status-badge";

export interface CopyExecutionDetailProps {
  execution: CopyExecutionItem;
  onClose?: () => void;
}

export function CopyExecutionDetail({ execution, onClose }: CopyExecutionDetailProps): JSX.Element {
  const isBlockedOrFailed =
    execution.status === "RISK_BLOCKED" ||
    execution.status === "FAILED" ||
    execution.status === "SKIPPED" ||
    execution.riskDecision === "BLOCK";

  return (
    <div
      className="space-y-4 rounded border bg-card p-4 text-xs"
      data-testid="copy-execution-detail"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">
              Copy Execution Attribution — {execution.executionId}
            </h3>
            <StatusBadge status={execution.status} />
            {execution.isSimulated && <StatusBadge status="SIMULATED" variant="info" />}
          </div>
          <p className="mt-0.5 text-muted">
            Leader Event ID: <code className="font-mono">{execution.leaderEventId}</code>
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded border px-2.5 py-1 text-xs hover:bg-slate-50"
          >
            Close
          </button>
        )}
      </div>

      {/* Sizing & Order Linkage */}
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <dt className="text-muted">Sizing Mode</dt>
          <dd className="font-semibold">{execution.sizingMode}</dd>
        </div>
        <div>
          <dt className="text-muted">Leader Quantity</dt>
          <dd className="font-mono font-semibold">{execution.leaderQuantity}</dd>
        </div>
        <div>
          <dt className="text-muted">Follower Quantity</dt>
          <dd className="font-mono font-semibold">{execution.followerQuantity}</dd>
        </div>
        <div>
          <dt className="text-muted">Risk Decision</dt>
          <dd className="font-semibold" data-testid="execution-risk-decision">
            {execution.riskDecision ?? "ALLOW"}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Leader Order ID</dt>
          <dd className="font-mono">{execution.leaderOrderId ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-muted">Follower Child Order ID</dt>
          <dd className="font-mono" data-testid="follower-order-id">
            {execution.followerOrderId ?? "Not dispatched"}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Created At</dt>
          <dd>{execution.createdAt ? new Date(execution.createdAt).toLocaleString() : "—"}</dd>
        </div>
        <div>
          <dt className="text-muted">Updated At</dt>
          <dd>{execution.updatedAt ? new Date(execution.updatedAt).toLocaleString() : "—"}</dd>
        </div>
      </dl>

      {/* Rejection / Risk Block / Failure Reasons */}
      {isBlockedOrFailed && (
        <div
          role="alert"
          data-testid="execution-block-reasons"
          className="rounded border border-rose-300 bg-rose-50 p-3 text-rose-900"
        >
          <div className="font-semibold">
            Execution Halted ({execution.status} / {execution.riskDecision ?? "BLOCK"})
          </div>
          {execution.failureReason && (
            <p className="mt-1">Reason: {execution.failureReason}</p>
          )}
          {execution.riskReasons.length > 0 && (
            <ul className="mt-1 list-disc pl-4">
              {execution.riskReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Execution Lifecycle Timeline */}
      <div className="border-t pt-3">
        <div className="font-semibold text-slate-800">Execution Lifecycle Progression</div>
        <ol className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          <li className="rounded bg-slate-100 px-2 py-1 font-medium text-slate-800">
            1. Leader Event Ingested ({execution.leaderEventId})
          </li>
          <span>→</span>
          <li className="rounded bg-slate-100 px-2 py-1 font-medium text-slate-800">
            2. Policy & Risk Check ({execution.riskDecision ?? "ALLOW"})
          </li>
          <span>→</span>
          <li className="rounded bg-slate-100 px-2 py-1 font-medium text-slate-800">
            3. Order Sizing ({execution.sizingMode}: {execution.followerQuantity})
          </li>
          <span>→</span>
          <li
            className={`rounded px-2 py-1 font-semibold ${
              execution.status === "COMPLETED" || execution.status === "ROUTED"
                ? "bg-emerald-100 text-emerald-900"
                : isBlockedOrFailed
                  ? "bg-rose-100 text-rose-900"
                  : "bg-amber-100 text-amber-900"
            }`}
          >
            4. Terminal / Current State: {execution.status}
          </li>
        </ol>
      </div>
    </div>
  );
}
