"use client";
import type { JSX } from 'react';

import { StatusBadge } from "@/components/status-badge";
import { useOnboarding } from "./use-onboarding";

/** Blocking reasons of the onboarding record and of its blocked/failed steps. */
export function OnboardingBlockers(): JSX.Element {
  const { data } = useOnboarding();
  const blockers: Array<{ type: string; reason: string }> = [
    ...(data?.blockingReasons ?? []).map((reason) => ({ type: "ONBOARDING", reason })),
    ...(data?.steps ?? [])
      .filter((s) => s.status === "BLOCKED" || s.status === "FAILED" || s.blockingReasons.length > 0)
      .flatMap((s) =>
        (s.blockingReasons.length > 0 ? s.blockingReasons : [s.status.toLowerCase()]).map((reason) => ({
          type: s.stepType,
          reason,
        })),
      ),
  ];
  return (
    <div className="rounded border bg-card p-4">
      <h3 className="font-semibold">Blockers</h3>
      {blockers.length === 0 ? (
        <p className="mt-2 text-xs text-muted">No blocking issues</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {blockers.map((b, i) => (
            <li key={`${b.type}-${i}`} className="rounded border p-2 text-xs">
              <StatusBadge status={b.type} /> <span className="ml-1">{b.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
