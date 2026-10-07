// # NEW — Renders follower risk headroom, policy block reasons, and emergency stop controls
"use client";

import React from "react";
import type { CopyExecutionItem, CopySubscriptionItem } from "@/api/trading-api";
import { Money } from "@/components/money";

export interface CopyRiskGuardrailsProps {
  subscription: CopySubscriptionItem;
  recentExecutions?: CopyExecutionItem[];
  onEmergencyStop?: (closeOpenPositions: boolean) => void;
  isStopping?: boolean;
}

export function CopyRiskGuardrails({
  subscription,
  recentExecutions = [],
  onEmergencyStop,
  isStopping = false,
}: CopyRiskGuardrailsProps): JSX.Element {
  const risk = subscription.riskPolicy;
  const blockedExecutions = recentExecutions.filter(
    (e) => e.status === "RISK_BLOCKED" || e.riskDecision === "BLOCK",
  );
  const emergencyActive = Boolean(
    risk?.emergencyStopCopy || subscription.copyPolicy?.emergencyStop,
  );

  return (
    <div
      className="space-y-4 rounded border bg-card p-4 text-xs"
      data-testid="copy-risk-guardrails"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Follower Risk Guardrails & Headroom</h3>
          <p className="text-muted">
            Pre-trade risk limits enforced automatically before routing any copied child order.
          </p>
        </div>
        <span
          data-testid="emergency-stop-badge"
          className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
            emergencyActive
              ? "bg-rose-100 text-rose-800"
              : "bg-emerald-100 text-emerald-800"
          }`}
        >
          {emergencyActive ? "EMERGENCY STOP ENGAGED" : "GUARDRAILS ACTIVE"}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-3 border-t pt-3 md:grid-cols-4">
        <div>
          <dt className="text-muted">Max Daily Loss</dt>
          <dd className="font-mono font-semibold" data-testid="guardrail-max-daily-loss">
            {risk?.maxDailyLoss ? <Money value={risk.maxDailyLoss} /> : "Platform Default"}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Max Drawdown</dt>
          <dd className="font-mono font-semibold" data-testid="guardrail-max-drawdown">
            {risk?.maxDrawdown ? <Money value={risk.maxDrawdown} /> : "Platform Default"}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Max Open Exposure</dt>
          <dd className="font-mono font-semibold">
            {risk?.maxOpenExposure ? <Money value={risk.maxOpenExposure} /> : "Platform Default"}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Daily Copy Cap</dt>
          <dd className="font-mono font-semibold">
            {risk?.maxDailyCopiedTrades ?? "Unlimited"} trades/day
          </dd>
        </div>
      </dl>

      {blockedExecutions.length > 0 && (
        <div
          role="region"
          aria-label="Recent risk block reasons"
          data-testid="guardrail-block-reasons"
          className="rounded border border-amber-300 bg-amber-50 p-3 text-amber-900"
        >
          <div className="font-semibold">
            Recent Guardrail Interventions ({blockedExecutions.length})
          </div>
          <ul className="mt-1 list-disc pl-4">
            {blockedExecutions.slice(0, 5).map((exec) => (
              <li key={exec.executionId}>
                <span className="font-mono">{exec.executionId}</span>:{" "}
                {exec.riskReasons.join("; ") || exec.failureReason || "Blocked by risk policy"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {onEmergencyStop && subscription.state !== "STOPPED" && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <span className="text-muted">
            Emergency stop halts new copy orders immediately and can optionally close open copied positions.
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isStopping}
              onClick={() => onEmergencyStop(false)}
              data-testid="emergency-stop-keep-btn"
              className="rounded border border-rose-300 bg-white px-3 py-1.5 font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-40"
            >
              Stop Copying (Keep Positions)
            </button>
            <button
              type="button"
              disabled={isStopping}
              onClick={() => onEmergencyStop(true)}
              data-testid="emergency-stop-close-btn"
              className="rounded bg-rose-700 px-3 py-1.5 font-medium text-white hover:bg-rose-800 disabled:opacity-40"
            >
              Emergency Stop & Close Positions
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
