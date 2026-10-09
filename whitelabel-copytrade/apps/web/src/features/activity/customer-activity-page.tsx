// # NEW — Renders customer audit trail for subscriptions, settings changes, orders, funding, and security events
"use client";
import type { JSX } from 'react';

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { activityApi } from "@/api/activity-api";
import { PageContainer } from "@/layout/page-container";
import { StatusBadge } from "@/components/status-badge";
import { TradingStateBoundary } from "@/components/trading-state";

export function CustomerActivityPage(): JSX.Element {
  const [resourceType, setResourceType] = useState<string>("");
  const [outcome, setOutcome] = useState<string>("");
  const [actionFilter, setActionFilter] = useState<string>("");

  const activityQuery = useQuery({
    queryKey: ["customer-activity", resourceType, outcome, actionFilter],
    queryFn: () =>
      activityApi.listMyActivity({
        resourceType: resourceType || undefined,
        outcome: outcome || undefined,
        action: actionFilter.trim() || undefined,
        page: 1,
        limit: 50,
      }),
  });

  const items = activityQuery.data?.items ?? [];

  return (
    <PageContainer
      title="Account & Copy-Trading Activity Log"
      description="Immutable customer-scoped audit trail across copy subscriptions, policy updates, orders, funding, and security events"
    >
      <div
        className="mb-4 flex flex-wrap items-center gap-3 rounded border bg-card p-3 text-xs"
        data-testid="customer-activity-filters"
      >
        <input
          aria-label="Filter by action"
          placeholder="Filter by action (e.g. SUBSCRIPTION_CREATED)"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="w-64 rounded border px-2.5 py-1.5"
        />
        <select
          aria-label="Filter by resource type"
          value={resourceType}
          onChange={(e) => setResourceType(e.target.value)}
          className="rounded border px-2.5 py-1.5"
        >
          <option value="">All Resource Types</option>
          <option value="CopySubscription">Copy Subscriptions</option>
          <option value="Order">Orders & Fills</option>
          <option value="Funding">Funding & Withdrawals</option>
          <option value="ExchangeConnection">Exchange Connections</option>
          <option value="User">Security & Account</option>
        </select>
        <select
          aria-label="Filter by outcome"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          className="rounded border px-2.5 py-1.5"
        >
          <option value="">All Outcomes</option>
          <option value="SUCCESS">SUCCESS</option>
          <option value="FAILURE">FAILURE</option>
          <option value="DENIED">DENIED</option>
        </select>
      </div>

      <TradingStateBoundary
        isLoading={activityQuery.isLoading}
        error={activityQuery.error}
        isEmpty={items.length === 0}
        emptyTitle="No activity events found"
        emptyDescription="No audit events matched the selected filters."
        onRetry={() => void activityQuery.refetch()}
      >
        <div
          className="overflow-x-auto rounded border bg-card"
          data-testid="customer-activity-page"
        >
          <table className="w-full text-left text-xs" data-testid="customer-activity-table">
            <thead>
              <tr className="border-b bg-slate-50 text-muted">
                <th className="p-3">Timestamp</th>
                <th className="p-3">Action</th>
                <th className="p-3">Resource</th>
                <th className="p-3">Resource ID</th>
                <th className="p-3">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="p-3 font-mono">
                    {new Date(item.createdAt).toLocaleString()}
                  </td>
                  <td className="p-3 font-mono font-semibold">{item.action}</td>
                  <td className="p-3">{item.resourceType}</td>
                  <td className="p-3 font-mono">{item.resourceId ?? "—"}</td>
                  <td className="p-3">
                    <StatusBadge status={item.outcome} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TradingStateBoundary>
    </PageContainer>
  );
}
