"use client";

import { StatusBadge } from "@/components/status-badge";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { useOnboarding } from "./use-onboarding";

export function OnboardingSteps(): JSX.Element {
  const { data, isLoading, error, refetch } = useOnboarding();
  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const steps = data?.steps ?? [];
  return (
    <div className="rounded border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Steps</h3>
        <span className="text-xs text-muted">
          {steps.filter((s) => s.status === "COMPLETED" || s.status === "SKIPPED").length} / {steps.length} completed
        </span>
      </div>
      <ul className="mt-3 space-y-2">
        {steps.map((s) => (
          <li key={s.id} className="rounded border p-3 text-sm space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-medium">
                {s.stepType.replace(/_/g, " ")}
                {!s.required && <span className="ml-1 text-xs font-normal text-muted">(optional)</span>}
              </span>
              <StatusBadge status={s.status} />
            </div>
            {s.blockingReasons.length > 0 && (
              <ul className="list-disc pl-4 text-xs text-red-700">
                {s.blockingReasons.map((reason, idx) => (
                  <li key={`${s.id}-${idx}`}>{reason}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
        {steps.length === 0 && <p className="text-xs text-muted">No steps available</p>}
      </ul>
    </div>
  );
}
