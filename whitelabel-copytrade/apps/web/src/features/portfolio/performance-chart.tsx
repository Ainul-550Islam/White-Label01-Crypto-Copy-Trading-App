"use client";
import { useQuery } from "@tanstack/react-query";
import { portfolioApi } from "@/api/portfolio-api";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { ProfileGate } from "./profile-gate";

function PerformanceChartBody({
  profileId,
}: {
  profileId: string;
}): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["portfolio", "performance", profileId],
    queryFn: () => portfolioApi.getPerformance(profileId, { period: "30d" }),
  });
  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const points = data?.points ?? [];
  const navs = points
    .map((p) => parseFloat(p.nav))
    .filter((n) => Number.isFinite(n));
  const max = navs.length > 0 ? Math.max(...navs) : 0;
  const min = navs.length > 0 ? Math.min(...navs) : 0;
  const span = max - min;
  return (
    <div className="rounded border bg-card p-4">
      <h3 className="font-semibold">Performance (30 days)</h3>
      <p className="text-xs text-muted">
        Backend-returned series only: return and NAV points come from persisted
        snapshots, no frontend calculation
      </p>
      <p className="mt-2 text-sm">
        {data?.canCalculate && data.returnPct !== null ? (
          <>
            Time-weighted return:{" "}
            <span className="font-medium">{data.returnPct}%</span>
          </>
        ) : (
          <span className="text-xs text-muted">
            Return not available{data?.reason ? `: ${data.reason}` : ""}
          </span>
        )}
      </p>
      <div className="mt-4 h-40 overflow-x-auto">
        {points.length === 0 ? (
          <p className="text-xs text-muted">No NAV snapshots in this period</p>
        ) : (
          <div className="flex h-full items-end gap-1">
            {points.slice(-60).map((p) => {
              const value = parseFloat(p.nav);
              const height =
                span > 0 && Number.isFinite(value)
                  ? 10 + ((value - min) / span) * 90
                  : 50;
              return (
                <div
                  key={p.timestamp}
                  className="w-2 bg-primary"
                  style={{ height: `${height}%` }}
                  title={`${new Date(p.timestamp).toLocaleString()}: NAV ${p.nav}`}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function PerformanceChart(): JSX.Element {
  return (
    <ProfileGate title="Performance">
      {(profileId) => <PerformanceChartBody profileId={profileId} />}
    </ProfileGate>
  );
}
