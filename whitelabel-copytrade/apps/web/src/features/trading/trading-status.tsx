"use client";

import { StatusBadge } from "@/components/status-badge";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { useTradingStatus } from "./use-trading-status";

export function TradingStatus(): JSX.Element {
  const { data, isLoading, error, refetch } = useTradingStatus();
  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!data) return <div className="text-xs text-muted">Trading status unavailable</div>;
  return (
    <div className="rounded border bg-card p-4 text-sm">
      <div className="flex gap-2">
        <StatusBadge status={data.eligibility} variant={data.canCopy ? "success" : "warning"} />
        {data.maintenance?.active && (
          <StatusBadge status="MAINTENANCE" variant={data.maintenance.isEmergency ? "danger" : "warning"} />
        )}
      </div>
      {data.restrictions.length > 0 && (
        <div className="mt-2">
          <p className="font-medium">Restrictions:</p>
          <ul className="list-disc pl-4 text-xs">
            {data.restrictions.map((r, i) => (
              <li key={`${r.type}-${i}`}>
                {r.type}: {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.maintenance?.active && <p className="mt-2 text-xs text-yellow-700">Maintenance: {data.maintenance.message}</p>}
    </div>
  );
}
