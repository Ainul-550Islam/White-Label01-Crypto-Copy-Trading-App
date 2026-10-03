"use client";
import { useQuery } from "@tanstack/react-query";
import { portfolioApi } from "@/api/portfolio-api";
import { Money } from "@/components/money";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { ProfileGate } from "./profile-gate";

const PERIOD_LABELS: Record<string, string> = {
  "1d": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

function PnlPanelBody({ profileId }: { profileId: string }): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["portfolio", "pnl", profileId],
    queryFn: () =>
      portfolioApi.getPnl(profileId, { periods: ["1d", "7d", "30d"] }),
  });
  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const records = data ?? [];
  return (
    <div className="rounded border bg-card p-4">
      <h3 className="font-semibold">PnL</h3>
      <ul className="mt-3 space-y-2">
        {records.map((r) => (
          <li key={r.period} className="text-sm">
            <div className="flex justify-between">
              <span>{PERIOD_LABELS[r.period] ?? r.period}</span>
              <Money
                value={r.net}
                currency={r.currency || undefined}
                showSign
              />
            </div>
            <div className="flex justify-between text-xs text-muted">
              <span>
                Realized{" "}
                <Money
                  value={r.realized}
                  currency={r.currency || undefined}
                  showSign
                />
              </span>
              <span>
                Fees <Money value={r.fees} currency={r.currency || undefined} />
              </span>
            </div>
          </li>
        ))}
        {records.length === 0 && (
          <p className="text-xs text-muted">No PnL data</p>
        )}
      </ul>
    </div>
  );
}

export function PnlPanel(): JSX.Element {
  return (
    <ProfileGate title="PnL">
      {(profileId) => <PnlPanelBody profileId={profileId} />}
    </ProfileGate>
  );
}
