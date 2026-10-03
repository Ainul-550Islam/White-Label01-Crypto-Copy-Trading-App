"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  portfolioApi,
  ATTRIBUTION_DIMENSIONS,
  type AttributionDimension,
} from "@/api/portfolio-api";
import { Money } from "@/components/money";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { ProfileGate } from "./profile-gate";

function AttributionTableBody({
  profileId,
}: {
  profileId: string;
}): JSX.Element {
  const [dimension, setDimension] = useState<AttributionDimension>("STRATEGY");
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["portfolio", "attribution", profileId, dimension],
    queryFn: () =>
      portfolioApi.getAttribution(profileId, { dimension, period: "30d" }),
  });
  const rows = data ?? [];
  return (
    <div className="rounded border bg-card">
      <div className="flex items-center justify-between p-4">
        <h3 className="font-semibold">Attribution (30 days)</h3>
        <select
          aria-label="Attribution dimension"
          value={dimension}
          onChange={(e) => setDimension(e.target.value as AttributionDimension)}
          className="rounded border px-2 py-1 text-xs"
        >
          {ATTRIBUTION_DIMENSIONS.map((d) => (
            <option key={d} value={d}>
              {d.charAt(0) + d.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      </div>
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <div className="p-4">
          <ErrorState error={error} onRetry={() => refetch()} />
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-y bg-gray-50 text-xs text-muted">
            <tr>
              <th className="p-2 text-left">Dimension</th>
              <th className="p-2 text-left">Key</th>
              <th className="p-2 text-right">PnL</th>
              <th className="p-2 text-right">Share of PnL</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.dimension}-${r.key}`} className="border-b">
                <td className="p-2">{r.dimension}</td>
                <td className="p-2">{r.key}</td>
                <td className="p-2 text-right">
                  <Money value={r.pnl} showSign />
                </td>
                <td className="p-2 text-right">{r.allocationPct}%</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="p-4 text-center text-xs text-muted">
                  No attribution data
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function AttributionTable(): JSX.Element {
  return (
    <ProfileGate title="Attribution">
      {(profileId) => <AttributionTableBody profileId={profileId} />}
    </ProfileGate>
  );
}
