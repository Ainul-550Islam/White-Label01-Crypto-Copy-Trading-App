"use client";
import type { JSX } from 'react';

import { useQuery } from "@tanstack/react-query";
import { clientLifecycleApi } from "@/api/client-lifecycle-api";
import { PageContainer } from "@/layout/page-container";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { StatusBadge } from "@/components/status-badge";

export function RelationshipsPage(): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["account", "relationships"],
    queryFn: () => clientLifecycleApi.listRelationships(),
  });
  const relationships = data ?? [];
  return (
    <PageContainer title="Relationships" description="Authorized trader/follower/strategy relationships">
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : relationships.length === 0 ? (
        <p className="text-xs text-muted">No relationships</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-y bg-gray-50 text-xs text-muted">
            <tr>
              <th className="p-2 text-left">Type</th>
              <th className="p-2">Status</th>
              <th className="p-2">Target</th>
            </tr>
          </thead>
          <tbody>
            {relationships.map((r) => (
              <tr key={r.id} className="border-b">
                <td className="p-2">{r.relationshipType.replace(/_/g, " ")}</td>
                <td className="p-2">
                  <StatusBadge status={r.status} />
                </td>
                <td className="p-2 font-mono text-xs">{r.targetId.slice(0, 8)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PageContainer>
  );
}
