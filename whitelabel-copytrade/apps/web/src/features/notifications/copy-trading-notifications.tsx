// # NEW — Renders copy-trading specific notification feed and alert preferences
"use client";

import React from "react";
import Link from "next/link";
import type { Notification } from "@/api/notification-api";
import { StatusBadge } from "@/components/status-badge";

export interface CopyTradingNotificationsProps {
  notifications: Notification[];
  onMarkAsRead?: (id: string) => void;
}

export function isCopyTradingNotification(notification: Notification): boolean {
  const t = (notification.type || "").toUpperCase();
  return (
    t.startsWith("COPY_") ||
    t.includes("SUBSCRIPTION") ||
    t.includes("EXECUTION") ||
    t.includes("TRADING") ||
    Boolean(notification.data?.subscriptionId) ||
    Boolean(notification.data?.executionId)
  );
}

export function CopyTradingNotifications({
  notifications,
  onMarkAsRead,
}: CopyTradingNotificationsProps): JSX.Element {
  const copyNotifications = notifications.filter(isCopyTradingNotification);

  return (
    <div
      className="space-y-3 rounded border bg-card p-4 text-xs"
      data-testid="copy-trading-notifications"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Copy-Trading Lifecycle Alerts</h2>
          <p className="text-muted">
            Execution fills, risk guardrail blocks, and subscription state changes with direct deep links.
          </p>
        </div>
        <Link
          href="/notifications/preferences"
          className="rounded border px-2.5 py-1 text-xs font-medium hover:bg-slate-50"
        >
          Alert Preferences
        </Link>
      </div>

      {copyNotifications.length === 0 ? (
        <p className="text-muted">No copy-trading specific notifications yet.</p>
      ) : (
        <ul className="space-y-2">
          {copyNotifications.map((n) => {
            const subscriptionId =
              typeof n.data?.subscriptionId === "string" ? n.data.subscriptionId : null;
            return (
              <li
                key={n.id}
                className={`flex flex-wrap items-start justify-between gap-3 rounded border p-3 ${
                  n.read ? "opacity-70" : "border-slate-400 bg-slate-50/60"
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{n.title}</span>
                    <StatusBadge status={n.priority} />
                    <span className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[10px]">
                      {n.type}
                    </span>
                  </div>
                  <p className="text-muted">{n.message}</p>
                  {subscriptionId && (
                    <div className="flex gap-3 pt-1">
                      <Link
                        href={`/copy-trading/${subscriptionId}`}
                        className="font-medium underline"
                      >
                        Inspect Subscription ({subscriptionId})
                      </Link>
                      <Link
                        href={`/copy-trading/${subscriptionId}/orders`}
                        className="underline"
                      >
                        Copied Orders
                      </Link>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted">
                    {new Date(n.createdAt).toLocaleString()}
                  </span>
                  {!n.read && onMarkAsRead && (
                    <button
                      type="button"
                      onClick={() => onMarkAsRead(n.id)}
                      className="rounded border px-2 py-0.5 text-[11px] hover:bg-white"
                    >
                      Mark read
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
