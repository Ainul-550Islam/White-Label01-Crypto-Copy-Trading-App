"use client";

import type { JSX } from 'react';
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { billingApi, type Plan } from "@/api/billing-api";
import { ApiError } from "@/api/api-errors";
import { Money } from "@/components/money";
import { LoadingState } from "@/components/loading-state";
import { ErrorState, InlineError } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { ConfirmationDialog } from "@/components/confirmation-dialog";

/**
 * Plan catalogue from the backend. Without a subscription a plan goes to
 * checkout; with one, only the changes the backend marks eligible are offered
 * (change-plan), so the UI never proposes a transition the API would refuse.
 */
export function PlanComparison(): JSX.Element {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["billing", "plans"],
    queryFn: () => billingApi.listPlans(),
  });
  const [target, setTarget] = useState<Plan | null>(null);
  const [changing, setChanging] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (isLoading) return <LoadingState message="Loading plans..." />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const plans = data ?? [];
  if (plans.length === 0)
    return (
      <EmptyState
        title="No plans available"
        description="Your provider has not published any plans yet."
      />
    );
  const hasCurrent = plans.some((p) => p.isCurrent);

  const confirmChange = async (): Promise<void> => {
    if (!target) return;
    setChanging(true);
    setChangeError(null);
    try {
      const result = await billingApi.changePlan({ planId: target.id });
      setNotice(result.message ?? `Plan change to ${target.name} submitted.`);
      setTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["billing"] });
    } catch (err) {
      setChangeError(
        err instanceof ApiError
          ? err.getUserMessage()
          : "The plan could not be changed.",
      );
    } finally {
      setChanging(false);
    }
  };

  return (
    <div className="space-y-4">
      {notice && (
        <p className="rounded bg-green-50 p-2 text-xs text-green-800">
          {notice}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => (
          <div
            key={p.id}
            className={`rounded border bg-card p-4 ${p.isCurrent ? "border-primary" : ""}`}
          >
            <h3 className="font-semibold">
              {p.name}
              {p.isCurrent && (
                <span className="ml-2 rounded bg-primary px-2 py-0.5 text-xs text-white">
                  Current
                </span>
              )}
            </h3>
            {p.description && (
              <p className="mt-1 text-xs text-muted">{p.description}</p>
            )}
            <p className="mt-2">
              <Money value={p.price} currency={p.currency} /> /{" "}
              {p.billingInterval.toLowerCase()}
            </p>
            {p.trialDays > 0 && (
              <p className="text-xs text-muted">{p.trialDays}-day trial</p>
            )}
            <ul className="mt-3 space-y-1 text-xs">
              {p.features.map((f) => (
                <li key={f}>✓ {f}</li>
              ))}
            </ul>
            {!hasCurrent ? (
              <Link
                href={`/billing/checkout?planId=${encodeURIComponent(p.id)}`}
                className="mt-4 block rounded bg-primary px-4 py-2 text-center text-sm text-white"
              >
                Choose {p.name}
              </Link>
            ) : p.isCurrent ? (
              <p className="mt-4 rounded border px-4 py-2 text-center text-sm text-muted">
                Your current plan
              </p>
            ) : p.upgradeEligible || p.downgradeEligible ? (
              <button
                type="button"
                onClick={() => {
                  setChangeError(null);
                  setTarget(p);
                }}
                className="mt-4 w-full rounded bg-primary px-4 py-2 text-sm text-white"
              >
                {p.upgradeEligible ? "Upgrade" : "Downgrade"} to {p.name}
              </button>
            ) : (
              <p className="mt-4 rounded border px-4 py-2 text-center text-xs text-muted">
                Not available from your current plan
              </p>
            )}
          </div>
        ))}
      </div>
      <ConfirmationDialog
        open={target !== null}
        title="Change plan"
        description={
          target
            ? `Switch your subscription to ${target.name}? Proration and timing are calculated by the billing system.`
            : undefined
        }
        confirmLabel="Change plan"
        isLoading={changing}
        onConfirm={() => void confirmChange()}
        onCancel={() => setTarget(null)}
      >
        {changeError && <InlineError message={changeError} />}
      </ConfirmationDialog>
    </div>
  );
}
