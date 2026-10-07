// # Integrates copy-trading notification filter and detail links
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { AuthGuard } from "@/auth/auth.guard";
import { AppShell } from "@/layout/app-shell";
import { PageContainer } from "@/layout/page-container";
import { notificationApi } from "@/api/notification-api";
import { CopyTradingNotifications, isCopyTradingNotification } from "@/features/notifications/copy-trading-notifications";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";

export default function Page(): JSX.Element {
  const qc = useQueryClient();
  const [filterMode, setFilterMode] = useState<"ALL" | "COPY_TRADING" | "UNREAD">("ALL");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => notificationApi.list(),
  });

  const markOne = useMutation({
    mutationFn: (id: string) => notificationApi.markAsRead(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAll = useMutation({
    mutationFn: () => notificationApi.markAllAsRead(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const allItems = data?.data ?? [];
  const filteredItems = allItems.filter((n) => {
    if (filterMode === "UNREAD") return !n.read;
    if (filterMode === "COPY_TRADING") return isCopyTradingNotification(n);
    return true;
  });

  return (
    <AuthGuard>
      <AppShell>
        <PageContainer
          title="Notifications"
          description={data ? `${data.unreadCount} unread` : undefined}
          actions={
            <div className="flex items-center gap-2">
              <div className="flex rounded border p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setFilterMode("ALL")}
                  className={`rounded px-2 py-1 ${filterMode === "ALL" ? "bg-slate-900 text-white" : ""}`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode("COPY_TRADING")}
                  className={`rounded px-2 py-1 ${filterMode === "COPY_TRADING" ? "bg-slate-900 text-white" : ""}`}
                >
                  Copy Trading
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode("UNREAD")}
                  className={`rounded px-2 py-1 ${filterMode === "UNREAD" ? "bg-slate-900 text-white" : ""}`}
                >
                  Unread
                </button>
              </div>
              {allItems.some((n) => !n.read) && (
                <button
                  type="button"
                  onClick={() => markAll.mutate()}
                  disabled={markAll.isPending}
                  className="rounded border px-3 py-1.5 text-xs"
                >
                  Mark all as read
                </button>
              )}
              <Link href="/notifications/preferences" className="rounded border px-3 py-1.5 text-xs">
                Preferences
              </Link>
            </div>
          }
        >
          {isLoading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState error={error} onRetry={() => void refetch()} />
          ) : (
            <div className="space-y-6">
              <CopyTradingNotifications
                notifications={allItems}
                onMarkAsRead={(id) => markOne.mutate(id)}
              />

              {filteredItems.length === 0 ? (
                <EmptyState
                  title="No notifications"
                  description="You have no notifications matching the selected filter"
                />
              ) : (
                <ul className="space-y-2">
                  {filteredItems.map((n) => {
                    const subscriptionId =
                      typeof n.data?.subscriptionId === "string" ? n.data.subscriptionId : null;
                    return (
                      <li
                        key={n.id}
                        className={`flex items-start justify-between gap-3 rounded border bg-card p-3 text-sm ${
                          n.read ? "opacity-60" : ""
                        }`}
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{n.title}</span>
                            <StatusBadge status={n.priority} />
                            <span className="text-xs text-muted">{n.channel}</span>
                          </div>
                          <p className="mt-1 text-xs text-muted">{n.message}</p>
                          {subscriptionId && (
                            <Link
                              href={`/copy-trading/${subscriptionId}`}
                              className="mt-1 inline-block text-xs font-medium underline"
                            >
                              View Subscription {subscriptionId} →
                            </Link>
                          )}
                        </div>
                        {!n.read && (
                          <button
                            type="button"
                            onClick={() => markOne.mutate(n.id)}
                            disabled={markOne.isPending}
                            className="shrink-0 rounded border px-2 py-1 text-xs"
                          >
                            Mark read
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </PageContainer>
      </AppShell>
    </AuthGuard>
  );
}
