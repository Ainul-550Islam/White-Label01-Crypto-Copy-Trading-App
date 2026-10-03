"use client";

import { useQuery } from "@tanstack/react-query";
import { portfolioApi, type PortfolioProfile } from "@/api/portfolio-api";
import { useAuth } from "@/auth/auth.store";

/**
 * The signed-in user's own portfolio profile. Every portfolio query needs a
 * profileId; a user without a profile (nothing traded or copied yet) gets
 * `profile === null` so screens can show an empty state instead of an error.
 */
export function usePortfolioProfile(): {
  profile: PortfolioProfile | null;
  profileId: string | undefined;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
} {
  const { session } = useAuth();
  const userId = session?.user?.id;
  const query = useQuery({
    queryKey: ["portfolio", "profile", userId ?? "anonymous"],
    queryFn: () => portfolioApi.getPrimaryProfile(userId),
    enabled: Boolean(userId),
    staleTime: 5 * 60 * 1000,
  });
  const profile = query.data ?? null;
  return {
    profile,
    profileId: profile?.id,
    isLoading: Boolean(userId) && query.isLoading,
    error: query.error,
    refetch: () => {
      void query.refetch();
    },
  };
}
