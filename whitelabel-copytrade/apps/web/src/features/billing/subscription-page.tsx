"use client";

import type { JSX } from 'react';
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { billingApi } from "@/api/billing-api";
import { ApiError } from "@/api/api-errors";
import { PageContainer } from "@/layout/page-container";
import { StatusBadge } from "@/components/status-badge";
import { Money } from "@/components/money";
import { LoadingState } from "@/components/loading-state";
import { ErrorState, InlineError } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { ConfirmationDialog } from "@/components/confirmation-dialog";

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "—";
}

export function SubscriptionPage(): JSX.Element {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["billing", "overview"],
    queryFn: () => billingApi.getOverview(),
  });
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [reason, setReason] = useState<string>("");
  const [pending, setPending] = useState<"cancel" | "resume" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async (kind: "cancel" | "resume"): Promise<void> => {
    setPending(kind);
    setActionError(null);
    try {
      const result =
        kind === "cancel"
          ? await billingApi.cancelSubscription({
              reason: reason.trim() || undefined,
            })
          : await billingApi.resumeSubscription();
      setNotice(
        result.message ??
          (kind === "cancel"
            ? "Your subscription will end at the close of the current period."
            : "Your subscription has been resumed."),
      );
      setConfirmOpen(false);
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["billing"] });
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.getUserMessage()
          : "The request could not be completed.",
      );
    } finally {
      setPending(null);
    }
  };

  if (isLoading) return <LoadingState message="Loading subscription..." />;
  if (error || !data) {
    return (
      <PageContainer title="Subscription">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </PageContainer>
    );
  }

  const sub = data.subscription;
  if (!sub) {
    return (
      <PageContainer title="Subscription">
        <EmptyState
          title="No active subscription"
          description="Choose a plan to get started"
          action={{ label: "View Plans", href: "/billing/plans" }}
        />
      </PageContainer>
    );
  }

  // Only offer what the backend says is allowed for the current state.
  const canCancel = data.availableActions.includes("CANCEL_AT_PERIOD_END");
  const canResume = data.availableActions.includes("RESUME");

  return (
    <PageContainer
      title="Subscription"
      description="Subscription status and lifecycle from backend"
    >
      {notice && (
        <p className="mb-4 rounded bg-green-50 p-2 text-xs text-green-800">
          {notice}
        </p>
      )}
      <div className="rounded border bg-card p-4">
        <div className="flex justify-between">
          <h3 className="font-semibold">
            {sub.planName ?? sub.planCode ?? "Current plan"}
          </h3>
          <StatusBadge status={sub.status} />
        </div>
        {data.currentPlan && (
          <p className="mt-1 text-sm">
            <Money
              value={data.currentPlan.price}
              currency={data.currentPlan.currency}
            />{" "}
            / {data.currentPlan.billingInterval.toLowerCase()}
          </p>
        )}
        <p className="mt-2 text-xs text-muted">
          Current period: {formatDate(sub.currentPeriodStart)} –{" "}
          {formatDate(sub.currentPeriodEnd)}
        </p>
        {sub.isTrialing && (
          <p className="text-xs text-muted">
            Trial ends {formatDate(sub.trialEnd)}
          </p>
        )}
        <p className="text-xs">
          {sub.cancelAtPeriodEnd
            ? `Cancels on ${formatDate(sub.currentPeriodEnd)}`
            : `Renews on ${formatDate(sub.renewalDate ?? sub.currentPeriodEnd)}`}
        </p>
        {actionError && !confirmOpen && (
          <div className="mt-2">
            <InlineError message={actionError} />
          </div>
        )}
        <div className="mt-4 flex gap-2">
          {canCancel && (
            <button
              type="button"
              onClick={() => {
                setActionError(null);
                setConfirmOpen(true);
              }}
              className="rounded border px-3 py-1 text-xs"
              disabled={pending !== null}
            >
              Cancel subscription
            </button>
          )}
          {canResume && (
            <button
              type="button"
              onClick={() => void run("resume")}
              className="rounded border px-3 py-1 text-xs"
              disabled={pending !== null}
            >
              {pending === "resume" ? "Resuming..." : "Resume subscription"}
            </button>
          )}
        </div>
      </div>
      <ConfirmationDialog
        open={confirmOpen}
        title="Cancel Subscription"
        description="Are you sure you want to cancel your subscription? You will retain access until period end."
        variant="destructive"
        confirmLabel="Cancel Subscription"
        isLoading={pending === "cancel"}
        onConfirm={() => void run("cancel")}
        onCancel={() => setConfirmOpen(false)}
      >
        <label className="block text-xs">
          Reason (optional)
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={3}
            className="mt-1 w-full rounded border px-2 py-1 text-sm"
          />
        </label>
        {actionError && <InlineError message={actionError} />}
      </ConfirmationDialog>
    </PageContainer>
  );
}
