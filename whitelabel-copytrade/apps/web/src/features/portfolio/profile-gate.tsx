"use client";
import type { JSX } from 'react';

import type { ReactNode } from "react";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/empty-state";
import { usePortfolioProfile } from "./use-portfolio-profile";

/**
 * Resolves the user's portfolio profile once for a portfolio panel: loading,
 * error (a 403 shows the lock state) and "no portfolio yet" are handled here,
 * so the panel body always receives a real profileId.
 */
export function ProfileGate({
  title,
  compact,
  children,
}: {
  title: string;
  compact?: boolean;
  children: (profileId: string) => ReactNode;
}): JSX.Element {
  const { profileId, isLoading, error, refetch } = usePortfolioProfile();
  if (isLoading)
    return <LoadingState message={`Loading ${title.toLowerCase()}...`} />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!profileId) {
    if (compact)
      return (
        <div className="text-xs text-muted">{title}: no portfolio yet</div>
      );
    return (
      <EmptyState
        title="No portfolio yet"
        description="Your portfolio appears once an exchange account is connected and trades or copy positions are recorded."
        action={{ label: "Connect an exchange", href: "/exchanges/connect" }}
      />
    );
  }
  return <>{children(profileId)}</>;
}
