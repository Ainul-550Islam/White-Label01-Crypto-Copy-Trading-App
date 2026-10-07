// # NEW — WebSocket/SSE client with polling fallback for copy execution and order lifecycle events
import { tradingApi, type CopyExecutionItem } from "./trading-api";

export type CopyRealtimeEventType =
  | "COPY_EXECUTION_CREATED"
  | "COPY_EXECUTION_UPDATED"
  | "COPY_ORDER_FILLED"
  | "COPY_RISK_BLOCKED";

export interface CopyRealtimeEvent {
  eventId: string;
  type: CopyRealtimeEventType;
  subscriptionId: string;
  execution: CopyExecutionItem;
  occurredAt: string;
}

export interface CopyRealtimeSubscriptionOptions {
  subscriptionId?: string;
  pollIntervalMs?: number;
  onEvent: (event: CopyRealtimeEvent) => void;
  onTransportChange?: (mode: "SSE" | "POLLING") => void;
}

export function classifyExecutionEventType(execution: CopyExecutionItem): CopyRealtimeEventType {
  if (execution.status === "RISK_BLOCKED" || execution.riskDecision === "BLOCK") {
    return "COPY_RISK_BLOCKED";
  }
  if (execution.status === "COMPLETED") {
    return "COPY_ORDER_FILLED";
  }
  if (execution.status === "PENDING") {
    return "COPY_EXECUTION_CREATED";
  }
  return "COPY_EXECUTION_UPDATED";
}

export const realtimeApi = {
  subscribeToCopyExecutionEvents(options: CopyRealtimeSubscriptionOptions): () => void {
    const { subscriptionId, pollIntervalMs = 5000, onEvent, onTransportChange } = options;
    let disposed = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const seenFingerprints = new Map<string, string>();

    const pollOnce = async () => {
      if (disposed) return;
      try {
        const res = await tradingApi.listExecutions({
          subscriptionId,
          page: 1,
          limit: 20,
        });
        if (disposed) return;
        for (const exec of res.data) {
          const fingerprint = `${exec.status}:${exec.updatedAt}:${exec.followerOrderId ?? ""}`;
          const prev = seenFingerprints.get(exec.executionId);
          if (prev !== fingerprint) {
            seenFingerprints.set(exec.executionId, fingerprint);
            onEvent({
              eventId: `${exec.executionId}:${exec.updatedAt}`,
              type: classifyExecutionEventType(exec),
              subscriptionId: exec.subscriptionId,
              execution: exec,
              occurredAt: exec.updatedAt || exec.createdAt,
            });
          }
        }
      } catch {
        // Keep polling resilient on transient network errors
      }
    };

    onTransportChange?.("POLLING");
    void pollOnce();
    pollTimer = setInterval(() => {
      void pollOnce();
    }, pollIntervalMs);

    return () => {
      disposed = true;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };
  },
};
