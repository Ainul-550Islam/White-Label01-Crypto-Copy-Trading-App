"use client";

import { useEffect, useState } from "react";
import { operationsApi, type MaintenanceNotice } from "@/api/operations-api";

export function MaintenanceBanner(): JSX.Element | null {
  const [maintenance, setMaintenance] = useState<MaintenanceNotice | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchMaintenance = async () => {
      try {
        const notice = await operationsApi.getCurrentMaintenance();
        if (!cancelled) setMaintenance(notice.active ? notice : null);
      } catch {
        // The banner is optional: signed-out visitors (401) and transient
        // failures simply show no banner; the next poll retries.
      }
    };

    void fetchMaintenance();
    const interval = setInterval(() => void fetchMaintenance(), 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!maintenance?.active) return null;

  const bgColor = maintenance.isEmergency ? "bg-red-600" : "bg-blue-600";

  return (
    <div className={`${bgColor} px-4 py-2 text-center text-sm text-white`} role="alert">
      <span className="font-medium">{maintenance.isEmergency ? "Emergency maintenance:" : "Maintenance:"}</span>{" "}
      {maintenance.message ?? "Scheduled maintenance in progress"}
      {maintenance.endsAt && (
        <span className="ml-2 text-xs opacity-90">Until {new Date(maintenance.endsAt).toLocaleString()}</span>
      )}
    </div>
  );
}

export function DegradationBanner({ level, message }: { level: string; message: string }): JSX.Element | null {
  if (level === "NORMAL") return null;

  const bg =
    level === "DISABLED"
      ? "bg-red-100 border-red-200 text-red-800"
      : level === "PAUSED"
        ? "bg-orange-100 border-orange-200 text-orange-800"
        : "bg-yellow-100 border-yellow-200 text-yellow-800";

  return (
    <div className={`rounded border p-3 text-sm ${bg}`} role="alert">
      <strong>{level}:</strong> {message}
    </div>
  );
}
