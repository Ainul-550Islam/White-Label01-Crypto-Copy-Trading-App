"use client";

import { useQuery } from "@tanstack/react-query";
import { tradingApi } from "@/api/trading-api";
import { useAuth } from "@/auth/auth.store";

/**
 * Trading status for the signed-in user (maintenance notice, own active
 * restrictions, whether the role may copy). Shared by the dashboard, the
 * trading status card and the strategy pages so they agree and share a cache.
 */
export function useTradingStatus() {
  const { session } = useAuth();
  const permissions = session?.user.permissions ?? [];
  return useQuery({
    queryKey: ["trading", "status", session?.user.id ?? "anonymous", permissions.join(",")],
    queryFn: () => tradingApi.getTradingStatus(permissions),
    enabled: Boolean(session),
    staleTime: 30 * 1000,
  });
}
