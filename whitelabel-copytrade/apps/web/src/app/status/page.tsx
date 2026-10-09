"use client";
import type { JSX } from 'react';

import { useQuery } from "@tanstack/react-query";
import { operationsApi } from "@/api/operations-api";
import { ApiError } from "@/api/api-errors";
import { PageContainer } from "@/layout/page-container";
import { StatusBadge } from "@/components/status-badge";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";

export default function Page(): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["status", "maintenance"],
    queryFn: () => operationsApi.getCurrentMaintenance(),
    retry: false,
  });
  const signedOut = error instanceof ApiError && error.status === 401;
  return (
    <PageContainer title="System Status">
      <div className="rounded border p-4">
        {isLoading ? (
          <LoadingState />
        ) : signedOut ? (
          <p className="text-sm text-muted">Sign in to see maintenance notices for your workspace.</p>
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data?.active ? (
          <>
            <StatusBadge status={data.isEmergency ? "EMERGENCY MAINTENANCE" : "MAINTENANCE"} variant={data.isEmergency ? "danger" : "warning"} />
            <p className="mt-2 text-sm">{data.message ?? "Scheduled maintenance in progress"}</p>
            {data.endsAt && <p className="mt-1 text-xs text-muted">Expected to end {new Date(data.endsAt).toLocaleString()}</p>}
          </>
        ) : (
          <>
            <StatusBadge status="OPERATIONAL" variant="success" />
            <p className="mt-2 text-sm">All systems operational</p>
          </>
        )}
      </div>
    </PageContainer>
  );
}
