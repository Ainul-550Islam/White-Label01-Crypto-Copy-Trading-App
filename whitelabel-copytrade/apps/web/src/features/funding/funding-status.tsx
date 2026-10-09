"use client";

import type { JSX } from 'react';
import { useQuery } from "@tanstack/react-query";
import { fundingApi, OPEN_FUNDING_STATES } from "@/api/funding-api";
import { FundingStatusBadge } from "@/components/status-badge";
import { Money } from "@/components/money";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";

export function FundingStatus(): JSX.Element {
  // Requested state is initial, not completed. Pending does not mean completed.
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["funding", "status"],
    queryFn: () => fundingApi.listHistory({ limit: 20 }),
  });
  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const open = (data?.data ?? []).filter((f) =>
    OPEN_FUNDING_STATES.includes(f.state),
  );
  return (
    <div className="rounded border bg-card p-4">
      <h3 className="font-semibold">Open requests</h3>
      <p className="text-xs text-muted">
        Requested → Under Review → Approved → Submitted → Confirmed (or Failed /
        Reversed / Cancelled). Pending does not mean completed.
      </p>
      <ul className="mt-3 space-y-1">
        {open.map((f) => (
          <li
            key={`${f.type}-${f.id}`}
            className="flex items-center justify-between text-xs"
          >
            <span>
              {f.type === "DEPOSIT" ? "Deposit" : "Withdrawal"}{" "}
              <Money value={f.amount} currency={f.currency} />
            </span>
            <FundingStatusBadge state={f.state} />
          </li>
        ))}
        {open.length === 0 && (
          <p className="text-xs text-muted">No open funding requests</p>
        )}
      </ul>
    </div>
  );
}
