import type { JSX } from 'react';
import type { UsageRecord } from "@/api/billing-api";

/**
 * One usage meter. Current value, limit, remaining and percentage all come from
 * the backend usage summary; nothing is derived here.
 */
export function UsageMeter({ usage }: { usage: UsageRecord }): JSX.Element {
  const percent =
    usage.percentageUsed === null
      ? null
      : Math.max(0, Math.min(100, usage.percentageUsed));
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span>{usage.label}</span>
        <span className="font-mono">
          {usage.current} /{" "}
          {usage.unlimited ? "Unlimited" : (usage.limit ?? "—")}
        </span>
      </div>
      {percent !== null && !usage.unlimited && (
        <div
          className="mt-1 h-2 w-full rounded bg-gray-200"
          role="progressbar"
          aria-label={usage.label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div
            className={`h-2 rounded ${percent >= 90 ? "bg-red-600" : "bg-primary"}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </div>
  );
}
