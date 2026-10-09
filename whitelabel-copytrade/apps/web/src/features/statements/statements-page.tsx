"use client";

import type { JSX } from 'react';
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { reportingApi } from "@/api/reporting-api";
import { PageContainer } from "@/layout/page-container";
import { StatusBadge } from "@/components/status-badge";
import { Money } from "@/components/money";
import { Percentage } from "@/components/percentage";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";

const PAGE_SIZE = 20;

export function StatementsPage(): JSX.Element {
  const [page, setPage] = useState(1);
  // The API returns only statements of profiles the caller may see.
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["statements", page],
    queryFn: () => reportingApi.listStatements({ page, limit: PAGE_SIZE }),
  });

  const statements = data?.data ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <PageContainer
      title="Statements"
      description="Historical account statements from persisted backend"
    >
      {isLoading ? (
        <LoadingState message="Loading statements..." />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : statements.length === 0 ? (
        <EmptyState
          title="No statements yet"
          description="Statements appear here once an accounting period has been closed."
        />
      ) : (
        <div className="space-y-2">
          {statements.map((s) => (
            <Link
              key={s.id}
              href={`/statements/${encodeURIComponent(s.id)}`}
              className="flex items-center justify-between rounded border bg-card p-3 hover:shadow"
            >
              <div>
                <p className="text-sm font-medium">
                  {new Date(s.periodStart).toLocaleDateString()} –{" "}
                  {new Date(s.periodEnd).toLocaleDateString()}
                </p>
                <p className="text-xs text-muted">
                  Closing NAV{" "}
                  <Money value={s.closingNav} currency={s.currency} /> · Return{" "}
                  <Percentage value={s.returnPercent} />
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Money value={s.netPnl} currency={s.currency} showSign />
                <StatusBadge status={s.state} />
              </div>
            </Link>
          ))}
          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-2 pt-2 text-sm">
              <button
                type="button"
                className="rounded border px-3 py-1 disabled:opacity-50"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <span className="text-muted">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className="rounded border px-3 py-1 disabled:opacity-50"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
}
