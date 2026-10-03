"use client";
import { useQuery } from "@tanstack/react-query";
import { portfolioApi } from "@/api/portfolio-api";
import { StatusBadge } from "@/components/status-badge";
import { ProfileGate } from "./profile-gate";

function ValuationStatusBody({
  profileId,
}: {
  profileId: string;
}): JSX.Element {
  const { data, error } = useQuery({
    queryKey: ["portfolio", "valuation-status", profileId],
    queryFn: () => portfolioApi.getValuationStatus(profileId),
  });
  if (error || !data)
    return (
      <div className="text-xs text-muted">Valuation status unavailable</div>
    );
  return (
    <div className="rounded border bg-card p-3 text-xs">
      <div className="flex items-center gap-2">
        <span>Valuation:</span>
        <StatusBadge status={data.state} />
        {data.lastValuationAt && (
          <span>Last: {new Date(data.lastValuationAt).toLocaleString()}</span>
        )}
      </div>
      {data.state === "MISSING_PRICE" && (
        <p className="mt-1 text-yellow-700">
          Some positions have no current price; NAV is incomplete.
        </p>
      )}
      {data.state === "STALE" && (
        <p className="mt-1 text-yellow-700">
          Prices are stale; NAV may lag the market.
        </p>
      )}
      {data.fxStatus !== "VALID" && (
        <p className="mt-1 text-yellow-700">FX: {data.fxStatus}</p>
      )}
    </div>
  );
}

export function ValuationStatus(): JSX.Element {
  return (
    <ProfileGate title="Valuation" compact>
      {(profileId) => <ValuationStatusBody profileId={profileId} />}
    </ProfileGate>
  );
}
