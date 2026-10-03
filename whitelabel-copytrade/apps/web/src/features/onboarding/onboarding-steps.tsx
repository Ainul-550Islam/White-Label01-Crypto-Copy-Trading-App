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
      <h3 className="font-semibold">Steps</h3>
      <ul className="mt-3 space-y-2">
        {steps.map((s) => (
          <li key={s.id} className="flex items-center justify-between rounded border p-2 text-sm">
            <span>
              {s.stepType.replace(/_/g, " ")}
              {!s.required && <span className="ml-1 text-xs text-muted">(optional)</span>}
            </span>
            <StatusBadge status={s.status} />
          </li>
        ))}
        {steps.length === 0 && <p className="text-xs text-muted">No steps available</p>}
      </ul>
    </div>
  );
}
