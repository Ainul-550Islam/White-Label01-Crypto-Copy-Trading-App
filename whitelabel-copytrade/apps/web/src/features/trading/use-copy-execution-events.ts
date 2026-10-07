// # NEW — React hook subscribing to live copy execution and order fill updates with React Query cache invalidation
"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { realtimeApi, type CopyRealtimeEvent } from "@/api/realtime-api";

export interface UseCopyExecutionEventsOptions {
  subscriptionId?: string;
  enabled?: boolean;
  pollIntervalMs?: number;
}

export interface UseCopyExecutionEventsResult {
  events: CopyRealtimeEvent[];
  transportMode: "SSE" | "POLLING";
  lastEventAt: string | null;
}

export function useCopyExecutionEvents(
  options: UseCopyExecutionEventsOptions = {},
): UseCopyExecutionEventsResult {
  const { subscriptionId, enabled = true, pollIntervalMs = 5000 } = options;
  const queryClient = useQueryClient();
  const [events, setEvents] = useState<CopyRealtimeEvent[]>([]);
  const [transportMode, setTransportMode] = useState<"SSE" | "POLLING">("POLLING");
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const unsubscribe = realtimeApi.subscribeToCopyExecutionEvents({
      subscriptionId,
      pollIntervalMs,
      onTransportChange: (mode) => setTransportMode(mode),
      onEvent: (event) => {
        setLastEventAt(event.occurredAt);
        setEvents((prev) => {
          const filtered = prev.filter((e) => e.execution.executionId !== event.execution.executionId);
          return [event, ...filtered].slice(0, 25);
        });
        void queryClient.invalidateQueries({ queryKey: ["copy-subscription-detail", event.subscriptionId] });
        void queryClient.invalidateQueries({ queryKey: ["copy-executions", event.subscriptionId] });
        void queryClient.invalidateQueries({ queryKey: ["copied-orders", event.subscriptionId] });
        void queryClient.invalidateQueries({ queryKey: ["copied-positions", event.subscriptionId] });
      },
    });

    return () => {
      unsubscribe();
    };
  }, [enabled, subscriptionId, pollIntervalMs, queryClient]);

  return { events, transportMode, lastEventAt };
}
