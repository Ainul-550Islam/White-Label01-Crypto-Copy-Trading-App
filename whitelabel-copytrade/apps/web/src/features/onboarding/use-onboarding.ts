"use client";

import { useQuery } from "@tanstack/react-query";
import { clientLifecycleApi, type Onboarding } from "@/api/client-lifecycle-api";
import { useAuth } from "@/auth/auth.store";

/**
 * The caller's onboarding: resolve the caller's own client profile, then its
 * onboarding record (GET clients/:profileId/onboarding). One query shared by
 * the progress, steps and blockers widgets. `data === null` means the caller
 * has no client profile or no onboarding yet.
 */
export function useOnboarding() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery<Onboarding | null>({
    queryKey: ["onboarding", userId ?? "anonymous"],
    queryFn: async () => {
      const profileId = await clientLifecycleApi.getOwnClientProfileId();
      return profileId ? clientLifecycleApi.getOnboarding(profileId) : null;
    },
    enabled: Boolean(userId),
    staleTime: 30 * 1000,
  });
}
