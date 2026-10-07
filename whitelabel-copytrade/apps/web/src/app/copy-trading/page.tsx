"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { AuthGuard } from "@/auth/auth.guard";
import { AppShell } from "@/layout/app-shell";
import { PageContainer } from "@/layout/page-container";
import { tradingApi, type CopySubscription } from "@/api/trading-api";
import { ApiError } from "@/api/api-errors";
import { StatusBadge } from "@/components/status-badge";
import { Money } from "@/components/money";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";

type Action = "pause" | "resume" | "stop";

const ACTIONS: Record<Action, (id: string) => Promise<CopySubscription>> = {
  pause: tradingApi.pauseCopySubscription,
  resume: tradingApi.resumeCopySubscription,
  stop: tradingApi.stopCopySubscription,
};

/** Actions the API accepts for a state (pause ACTIVE, resume PAUSED, stop anything not already ended). */
function actionsFor(state: string): Action[] {
  if (state === "ACTIVE") return ["pause", "stop"];
  if (state === "PAUSED") return ["resume", "stop"];
  if (state === "PENDING") return ["stop"];
  return [];
}

export default function Page(): JSX.Element {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string>("");
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["copy-subs"],
    queryFn: () => tradingApi.listCopySubscriptions({ page: 1, limit: 50 }),
  });
  const mutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: Action }) => ACTIONS[action](id),
    onSuccess: () => {
      setActionError("");
      void queryClient.invalidateQueries({ queryKey: ["copy-subs"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard", "copy", "subscriptions"] });
    },
    onError: (err: unknown) => setActionError(err instanceof ApiError ? err.getUserMessage() : "The action failed."),
  });
  const subs = data?.data ?? [];

  return (
    <AuthGuard>
      <AppShell>
        <PageContainer title="Copy Trading" description="Your copy subscriptions">
          {actionError && <p className="mb-2 text-xs text-red-600">{actionError}</p>}
          {isLoading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState error={error} onRetry={() => void refetch()} />
          ) : subs.length === 0 ? (
            <EmptyState
              title="No subscriptions"
              description="You are not copying any strategies yet"
              action={{ label: "Browse Strategies", href: "/strategies" }}
            />
          ) : (
            <ul className="space-y-2">
              {subs.map((s) => (
                <li key={s.subscriptionId} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm">
                  <span>
                    <Link href={`/strategies/${s.strategyId}`} className="underline">
                      Strategy {s.strategyId.slice(0, 8)}
                    </Link>
                    <span className="ml-2 text-xs text-muted">
                      {s.allocationMode.toLowerCase().replace(/_/g, " ")} | {s.totalCopies} copies
                      {s.failedCopies > 0 ? `, ${s.failedCopies} failed` : ""}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Money value={s.allocationAmount} />
                    <StatusBadge status={s.state} />
                    <Link
                      href={`/copy-trading/${s.subscriptionId}`}
                      className="rounded border px-2 py-1 text-xs font-medium hover:bg-slate-50"
                    >
                      Overview
                    </Link>
                    <Link
                      href={`/copy-trading/${s.subscriptionId}/settings`}
                      className="rounded border px-2 py-1 text-xs hover:bg-slate-50"
                    >
                      Settings
                    </Link>
                    <Link
                      href={`/copy-trading/${s.subscriptionId}/positions`}
                      className="rounded border px-2 py-1 text-xs hover:bg-slate-50"
                    >
                      Positions
                    </Link>
                    <Link
                      href={`/copy-trading/${s.subscriptionId}/orders`}
                      className="rounded border px-2 py-1 text-xs hover:bg-slate-50"
                    >
                      Orders
                    </Link>
                    {actionsFor(s.state).map((action) => (
                      <button
                        key={action}
                        type="button"
                        disabled={mutation.isPending}
                        onClick={() => mutation.mutate({ id: s.subscriptionId, action })}
                        className="rounded border px-2 py-1 text-xs capitalize disabled:opacity-50"
                      >
                        {action}
                      </button>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PageContainer>
      </AppShell>
    </AuthGuard>
  );
}
