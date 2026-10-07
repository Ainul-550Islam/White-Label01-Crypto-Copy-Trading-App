// # NEW — Shared trading loading, empty, error, and degraded-venue banner states
"use client";

import React from "react";
import { LoadingState } from "@/components/loading-state";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";

export interface TradingDegradedBannerProps {
  venue?: string | null;
  reason?: string | null;
  isMaintenance?: boolean;
  blocksTrading?: boolean;
}

export function TradingDegradedBanner({
  venue,
  reason,
  isMaintenance = false,
  blocksTrading = false,
}: TradingDegradedBannerProps): JSX.Element | null {
  if (!venue && !reason && !isMaintenance) return null;

  const toneClass = blocksTrading
    ? "border-red-300 bg-red-50 text-red-900"
    : "border-amber-300 bg-amber-50 text-amber-900";

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="trading-degraded-banner"
      className={`mb-4 rounded-md border p-3 text-xs ${toneClass}`}
    >
      <div className="flex items-center justify-between gap-2 font-semibold">
        <span>
          {blocksTrading
            ? "Trading Halted — Safety Gate Engaged"
            : isMaintenance
              ? "Scheduled Maintenance Notice"
              : `Degraded Venue Telemetry${venue ? `: ${venue}` : ""}`}
        </span>
        <span className="rounded bg-white/80 px-2 py-0.5 text-[11px] font-medium uppercase">
          {blocksTrading ? "FAIL-CLOSED" : "DEGRADED"}
        </span>
      </div>
      {reason && <p className="mt-1">{reason}</p>}
    </div>
  );
}

export interface TradingStateProps {
  isLoading: boolean;
  error?: unknown;
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  loadingLabel?: string;
  degradedReason?: string | null;
  degradedVenue?: string | null;
  blocksTrading?: boolean;
  onRetry?: () => void;
  children: React.ReactNode;
}

export function TradingStateBoundary({
  isLoading,
  error,
  isEmpty = false,
  emptyTitle = "No trading records available",
  emptyDescription = "Canonical trading records will appear here once activity is recorded.",
  emptyAction,
  degradedReason,
  degradedVenue,
  blocksTrading = false,
  onRetry,
  children,
}: TradingStateProps): JSX.Element {
  return (
    <div data-testid="trading-state-boundary">
      {(degradedReason || degradedVenue || blocksTrading) && (
        <TradingDegradedBanner
          venue={degradedVenue}
          reason={degradedReason}
          blocksTrading={blocksTrading}
        />
      )}
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : isEmpty ? (
        <div className="space-y-3">
          <EmptyState title={emptyTitle} description={emptyDescription} />
          {emptyAction ? <div className="flex justify-center">{emptyAction}</div> : null}
        </div>
      ) : (
        <>{children}</>
      )}
    </div>
  );
}
